import fs from 'node:fs'
import path from 'node:path'
import axios, { AxiosError } from 'axios'
import { app, safeStorage } from 'electron'
import type { TextModel } from './types'
import type { FilmBreakdownVideoTemplate } from '../src/runtime/filmBreakdown'
import { parseModelJson } from '../src/runtime/modelJson'

export const TEXT_MODELS: TextModel[] = [
  'gemini-3.7-flash', 'gemini-3.6-flash', 'doubao-seed-evolving', 'claude-fable-5',
  'claude-opus-5', 'gpt-5.6-sol', 'deepseek-v4-pro',
]

export const API_ORIGIN = 'https://api.jiucaihezi.studio'
const KEY_FILE = 'jiucai-api-key.bin'
let sessionApiKey = ''

function keyPath() { return path.join(app.getPath('userData'), KEY_FILE) }

export async function readApiKey() {
  if (sessionApiKey) return sessionApiKey
  const encrypted = await fs.promises.readFile(keyPath()).catch(() => { throw new Error('请先配置韭菜盒子 API Key') })
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用')
  return safeStorage.decryptString(encrypted).trim()
}

export async function hasApiKey() { return readApiKey().then(Boolean).catch(() => false) }

export async function saveApiKey(apiKey: string) {
  const clean = apiKey.trim()
  sessionApiKey = clean
  if (!clean) { await fs.promises.rm(keyPath(), { force: true }); return true }
  if (!safeStorage.isEncryptionAvailable()) return false
  await fs.promises.mkdir(path.dirname(keyPath()), { recursive: true })
  await fs.promises.writeFile(keyPath(), safeStorage.encryptString(clean), { mode: 0o600 })
  return true
}

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (axios.isCancel(error)) return new Error('任务已停止')
  if (!(error instanceof AxiosError)) return new Error(message)
  if ([401, 403].includes(error.response?.status || 0)) return new Error('API Key 无效或没有权限')
  if (error.response?.status === 429) return new Error('请求过于频繁，请稍后重试')
  const detail = typeof error.response?.data === 'string' ? error.response.data : (error.response?.data as any)?.error?.message
  return new Error(detail ? `云端请求失败：${detail}` : `云端请求失败 (${error.response?.status || '网络错误'})`)
}

function modelText(content: unknown) {
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) return content.map((part: any) => typeof part === 'string' ? part : String(part?.text || part?.output_text || '')).join('').trim()
  return typeof (content as any)?.text === 'string' ? (content as any).text.trim() : ''
}

async function requestCompletion(system: string, content: string | Record<string, unknown>[], model: TextModel, json = true, maxTokens = 16000, signal?: AbortSignal) {
  if (!TEXT_MODELS.includes(model)) throw new Error('不支持的文本模型')
  try {
    const key = await readApiKey()
    const response = await axios.post(`${API_ORIGIN}/v1/chat/completions`, {
      model, messages: [{ role: 'system', content: system }, { role: 'user', content }],
      ...(json ? { response_format: { type: 'json_object' } } : {}), temperature: 0.2, max_tokens: maxTokens,
    }, { timeout: 300_000, signal, headers: { Authorization: `Bearer ${key}`, 'x-api-key': key } })
    const choice = response.data?.choices?.[0]
    const output = modelText(choice?.message?.content)
    if (!output) throw new Error('模型没有返回内容')
    return { output, finishReason: String(choice?.finish_reason || '') }
  } catch (error) { throw friendlyError(error) }
}

async function request(system: string, content: string | Record<string, unknown>[], model: TextModel, json = true, maxTokens = 16000, signal?: AbortSignal) {
  return (await requestCompletion(system, content, model, json, maxTokens, signal)).output
}

async function requestJson(context: string, system: string, content: string | Record<string, unknown>[], model: TextModel, maxTokens = 16000, signal?: AbortSignal, retries = 0) {
  for (let attempt = 0; ; attempt++) {
    const completion = await requestCompletion(system, content, model, true, maxTokens, signal)
    try { return parseModelJson(completion.output, context, completion.finishReason) } catch (error) {
      if (attempt >= retries) throw error
    }
  }
}

export async function analyzeFilmBreakdownClip(params: { textModel: TextModel; shotId: string; startMs: number; endMs: number; video: string; requests: Array<{ template: FilmBreakdownVideoTemplate; instruction: string }>; signal?: AbortSignal }) {
  if (!params.shotId || !params.video.startsWith('data:video/mp4;base64,') || !params.requests.length) throw new Error('逐镜视频分析参数无效')
  const fields = Object.fromEntries(params.requests.map(({ template }) => [template, `${template} 的完整结果`]))
  const result = await requestJson(
    `视频反推 ${params.shotId}`,
    '你是专业影视导演拉片助手。必须完整观看提供的短视频，只描述真实可见、可听内容，并只输出合法 JSON。',
    [
      { type: 'video_url', video_url: params.video },
      { type: 'text', text: `镜头 ID：${params.shotId}\n精确时间：${(params.startMs / 1000).toFixed(3)}秒至${(params.endMs / 1000).toFixed(3)}秒\n\n${params.requests.map(({ template, instruction }) => `${template}：\n${instruction}`).join('\n\n')}\n\n返回：${JSON.stringify({ shotId: params.shotId, results: fields })}` },
    ],
    params.textModel,
    24000,
    params.signal,
    1,
  ) as { shotId?: unknown; results?: Record<string, unknown> }
  if (result.shotId !== params.shotId || !result.results || params.requests.some(({ template }) => !String(result.results?.[template] || '').trim())) throw new Error('视频反推结果不完整')
  return { shotId: params.shotId, results: Object.fromEntries(params.requests.map(({ template }) => [template, String(result.results![template]).trim()])) as Partial<Record<FilmBreakdownVideoTemplate, string>> }
}

type BreakdownFrame = { shotId: string; position: 'start' | 'middle' | 'end'; image: string }

export async function identifyFilmBreakdownAssets(params: { textModel: TextModel; frames: BreakdownFrame[]; signal?: AbortSignal }) {
  if (!params.frames.length || params.frames.some((frame) => !frame.shotId || !['start', 'middle', 'end'].includes(frame.position) || !frame.image.startsWith('data:image/jpeg;base64,'))) throw new Error('资产识别参数无效')
  const batches: unknown[] = []
  const totalBatches = Math.ceil(params.frames.length / 15)
  for (let offset = 0; offset < params.frames.length; offset += 15) {
    const content: Record<string, unknown>[] = [{ type: 'text', text: '识别这批影片帧中可复用的角色、场景和关键道具。同一角色、同一场景、同一道具在批内只列一次。关键道具是参与剧情、被人物操作、或对视觉识别至关重要的物件；普通桌椅、墙面和无关陈设不要列为道具。只记录画面可见信息，不猜测身份或剧情。返回 {"assets":[{"category":"character|scene|prop","name":"简洁稳定名称","description":"可见特征","occurrences":[{"shotId":"shot-001","position":"start|middle|end"}]}]}' }]
    params.frames.slice(offset, offset + 15).forEach((frame) => { content.push({ type: 'text', text: `${frame.shotId} ${frame.position}` }, { type: 'image_url', image_url: { url: frame.image } }) })
    const batch = Math.floor(offset / 15) + 1
    const result = await requestJson(`资产识别第 ${batch}/${totalBatches} 批`, '你是影视资产管理师。只输出合法 JSON。', content, params.textModel, 12000, params.signal, 1) as { assets?: unknown }
    if (!Array.isArray(result.assets)) throw new Error(`资产识别第 ${batch}/${totalBatches} 批结果缺少 assets 数组`)
    batches.push(...result.assets)
  }
  if (!batches.length) return { assets: [] }
  const consolidated = await requestJson('资产识别合并', '你是影视资产管理师。只输出合法 JSON。', `合并下列分批识别结果中的同一角色、同一场景和同一关键道具。合并 occurrences 并去重；不要新增候选中没有的资产或帧。同类但无证据为同一实体时保持分开。返回相同的 {"assets":[]} 结构。\n\n${JSON.stringify(batches)}`, params.textModel, 16000, params.signal, 1) as { assets?: unknown }
  if (!Array.isArray(consolidated.assets)) throw new Error('资产识别合并结果缺少 assets 数组')
  return { assets: consolidated.assets }
}

export async function generateFilmBreakdownImagePrompt(params: { textModel: TextModel; image: string; instruction: string; signal?: AbortSignal }) {
  if (!params.image.startsWith('data:image/jpeg;base64,') || !params.instruction.trim()) throw new Error('画面反推参数无效')
  return { prompt: (await request('你是专业的图片提示词反推助手。', [{ type: 'image_url', image_url: { url: params.image } }, { type: 'text', text: params.instruction }], params.textModel, false, 8000, params.signal)).trim() }
}

export async function generateFilmBreakdownAssetPrompt(params: { textModel: TextModel; name: string; description: string; images: string[]; instruction: string; signal?: AbortSignal }) {
  if (!params.name.trim() || !params.images.length || params.images.some((image) => !image.startsWith('data:image/jpeg;base64,')) || !params.instruction.trim()) throw new Error('资产提示词参数无效')
  const content: Record<string, unknown>[] = [{ type: 'text', text: `资产名称：${params.name}\n已识别可见特征：${params.description}` }]
  params.images.forEach((image, index) => content.push({ type: 'text', text: `参考图 ${index + 1}/${params.images.length}` }, { type: 'image_url', image_url: { url: image } }))
  content.push({ type: 'text', text: params.instruction })
  return { prompt: (await request('你是专业的影视视觉资产设计师。', content, params.textModel, false, 10000, params.signal)).trim() }
}

export async function generateFilmBreakdownVideoOverview(params: { textModel: TextModel; shots: Array<{ shotId: string; startMs: number; endMs: number; prompt: string }>; assets: Array<{ category: string; name: string; description: string; shotIds: string[] }>; signal?: AbortSignal }) {
  if (!params.shots.length || params.shots.some((shot) => !shot.prompt.trim())) throw new Error('请先完成全部镜头的视频提示词反推')
  return requestJson(
    '全片总览分析',
    '你是专业影视项目总监。根据已确认的逐镜拉片结果总结全片，不得改写逐镜内容，不得虚构看不见或听不见的信息，只输出合法 JSON。',
    `根据全部镜头的连续关系，生成一次可复用的全片总览。灯光哲学描述全片稳定的光源逻辑、阴影、反光和高光；色彩分级描述媒介质感、对比度、饱和度、肤色和高光；时间状态语法只在原片确有变速、定格或特殊时间效果时填写；技术约束必须包含画面一致性、真实物理和原片可确认的声音限制。为每个镜头判断其在全片中的功能，可使用 HOOK、SETUP、RISING、CRISIS、SIGNATURE、LAUNCH、LANDING、INVITE、PUNCHLINE、RIDE OUT，无法确定时返回空字符串。\n\n返回结构：${JSON.stringify({ narrative: '叙事主线，用箭头连接', lightingPhilosophy: '灯光哲学', colorGrading: '色彩分级', timeRules: '时间状态语法，无则空字符串', setting: '场所', ambientSound: '环境音', crowd: '人群规则，无则空字符串', technicalConstraints: ['约束1'], shotRoles: Object.fromEntries(params.shots.map((shot) => [shot.shotId, '功能标签或空字符串'])) })}\n\n镜头：${JSON.stringify(params.shots)}\n\n资产：${JSON.stringify(params.assets)}`,
    params.textModel, 24000, params.signal, 1,
  )
}

export async function testApiKey(textModel: TextModel) {
  await request('你是连接测试助手。', '只回复 OK', textModel, false, 8)
  return true
}

export async function calibrateTalkingHeadSubtitles(params: { textModel: TextModel; instruction: string; cues: Array<{ cueId: string; text: string }> }) {
  if (!params.instruction.trim() || !params.cues.length) throw new Error('字幕校准参数无效')
  const output = await request('你是口播字幕校对助手。只输出逐条 Markdown 字幕建议。', `根据上下文和用户要求校正错别字、同音字、断句和专有名词；不得改写原意、合并或拆分字幕。用户要求：${params.instruction}\n\n字幕：${JSON.stringify(params.cues)}\n\n每条严格使用：\n## cue-001\n校准后的原文`, params.textModel, false)
  const entries = [...output.matchAll(/^##\s+([A-Za-z0-9_-]+)\s*\n([\s\S]*?)(?=^##\s+|$(?![\s\S]))/gm)].map((match) => ({ cueId: match[1], text: match[2].trim() }))
  if (entries.length !== params.cues.length || entries.some((item, index) => item.cueId !== params.cues[index].cueId || !item.text)) throw new Error('语义校准结果不完整')
  return { subtitles: entries }
}

export async function generateTalkingHeadEditPlan(params: { textModel: TextModel; instruction: string; cues: Array<{ cueId: string; text: string }> }) {
  if (!params.instruction.trim() || !params.cues.length) throw new Error('结构整理参数无效')
  const result = await requestJson('口播结构整理', '你是口播视频结构编辑助手。只输出合法 JSON。', `只能重排或删除已有字幕，绝不能改写、合并、拆分或新增。用户要求：${params.instruction}\n\n字幕：${JSON.stringify(params.cues)}\n\n返回：{"cueIds":["按新顺序列出 cueId"],"removedCueIds":["删除的 cueId"]}`, params.textModel) as { cueIds?: unknown; removedCueIds?: unknown }
  const known = params.cues.map((cue) => cue.cueId)
  const cueIds = Array.isArray(result.cueIds) ? result.cueIds.map(String).filter((id) => known.includes(id)) : []
  const removedCueIds = Array.isArray(result.removedCueIds) ? result.removedCueIds.map(String).filter((id) => known.includes(id)) : []
  if (new Set(cueIds).size !== cueIds.length || new Set(removedCueIds).size !== removedCueIds.length) throw new Error('结构整理结果含有重复字幕 ID')
  return { cueIds: [...cueIds, ...known.filter((id) => !cueIds.includes(id))], removedCueIds }
}

export async function generateTalkingHeadHighlights(params: { textModel: TextModel; cues: Array<{ cueId: string; text: string }> }) {
  const result = await requestJson('重点大字生成', '你是短视频口播重点大字编辑助手。只输出合法 JSON。', `按口播完整语义挑重点大字，绝不按固定数量挑选。必须从头到尾逐段检查全部字幕：相邻细碎字幕先合在脑中理解成一句话或一个观点，再在原字幕中选择重点。重点分三层：第一层是信息重点，包括结论、痛点、结果、反差、数字、方法、行动指令、关键名词、风险和错误认知；第二层是情绪重点，包括惊讶、愤怒吐槽、焦虑危险、爽感胜利、委屈共鸣、挑衅争议、紧迫感、幽默、方言和有辨识度的口头爆点；第三层是节奏重点，包括开场第一句、观点转折、信息密度高点、情绪升级和结尾金句。每个语义段只要有任一层重点，就必须输出该段最有冲击力的一条原字幕中的一个短语；只有确实没有重点才不输出。情绪冲击和观众表达欲优先于普通说明词，但不要把普通连接词硬做成花字。同一连续观点最多一个，相邻重点过近或语义重复时只保留信息更强的一个；整条口播重点密度通常每 6 到 12 秒一个，内容情绪强或观点密集时可以更密，不得为了凑数量乱选。每条字幕最多一项；短语必须是原文连续词，2 到 8 个字，绝不改写或凭空生成。数字、结果、反差、风险、愤怒和警告用爆点黄；结论、方法、工具、模型、情绪共鸣、金句和英文术语用结论绿。返回全部符合条件的项目，不要自行限制数量。返回：{"items":[{"cueId":"cue-001","phrase":"原文短语","style":"爆点黄"}]}\n\n字幕：${JSON.stringify(params.cues)}`, params.textModel) as { items?: unknown }
  const byId = new Map(params.cues.map((cue) => [cue.cueId, cue.text]))
  const items = Array.isArray(result.items) ? result.items : []
  const valid = items.flatMap((item: any) => byId.get(String(item?.cueId))?.includes(String(item?.phrase || '')) && ['爆点黄', '结论绿'].includes(item?.style) ? [{ cueId: String(item.cueId), phrase: String(item.phrase), style: item.style as '爆点黄' | '结论绿' }] : [])
  return { items: valid.filter((item, index) => valid.findIndex((candidate) => candidate.cueId === item.cueId) === index) }
}

export async function chooseTalkingHeadHighlightPositions(params: { textModel: TextModel; items: Array<{ cueId: string; phrase: string; style: '爆点黄' | '结论绿' }>; frames: Array<{ cueId: string; image: string }> }) {
  if (!params.items.length) return { positions: [] as Array<{ cueId: string; position: '左上' | '右上' | '左中' | '右中' | '上中' }> }
  const content: Record<string, unknown>[] = [{ type: 'text', text: '为每个重点词选择不遮挡主体的位置，只能选 左上、右上、左中、右中、上中。返回 {"positions":[{"cueId":"cue-001","position":"左上"}]}' }]
  params.items.forEach((item) => { content.push({ type: 'text', text: `${item.cueId}: ${item.phrase}` }); const frame = params.frames.find((candidate) => candidate.cueId === item.cueId); if (frame) content.push({ type: 'image_url', image_url: { url: frame.image } }) })
  const result = await requestJson('重点大字排版', '你是短视频画面排版助手。只输出合法 JSON。', content, params.textModel) as { positions?: any[] }
  const allowed = ['左上', '右上', '左中', '右中', '上中']
  return { positions: (Array.isArray(result.positions) ? result.positions : []).flatMap((item) => params.items.some((candidate) => candidate.cueId === item?.cueId) && allowed.includes(item?.position) ? [{ cueId: item.cueId, position: item.position }] : []) }
}
