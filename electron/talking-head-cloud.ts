import fs from 'node:fs'
import path from 'node:path'
import axios, { AxiosError } from 'axios'
import { app, safeStorage } from 'electron'
import type { TextModel } from './types'

export const TEXT_MODELS: TextModel[] = [
  'gemini-3.6-flash', 'doubao-seed-evolving', 'claude-fable-5',
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

async function request(system: string, content: string | Record<string, unknown>[], model: TextModel, json = true) {
  if (!TEXT_MODELS.includes(model)) throw new Error('不支持的文本模型')
  try {
    const key = await readApiKey()
    const response = await axios.post(`${API_ORIGIN}/v1/chat/completions`, {
      model, messages: [{ role: 'system', content: system }, { role: 'user', content }],
      ...(json ? { response_format: { type: 'json_object' } } : {}), temperature: 0.2, max_tokens: 16000,
    }, { timeout: 300_000, headers: { Authorization: `Bearer ${key}`, 'x-api-key': key } })
    const output = String(response.data?.choices?.[0]?.message?.content || '').trim()
    if (!output) throw new Error('模型没有返回内容')
    return output
  } catch (error) { throw friendlyError(error) }
}

function json(text: string) {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(clean) } catch {
    const start = clean.indexOf('{'); const end = clean.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1))
    throw new Error('模型返回的 JSON 无法解析')
  }
}

export async function testApiKey() { await readApiKey(); return true }

export async function calibrateTalkingHeadSubtitles(params: { textModel: TextModel; instruction: string; cues: Array<{ cueId: string; text: string }> }) {
  if (!params.instruction.trim() || !params.cues.length) throw new Error('字幕校准参数无效')
  const output = await request('你是口播字幕校对助手。只输出逐条 Markdown 字幕建议。', `根据上下文和用户要求校正错别字、同音字、断句和专有名词；不得改写原意、合并或拆分字幕。用户要求：${params.instruction}\n\n字幕：${JSON.stringify(params.cues)}\n\n每条严格使用：\n## cue-001\n校准后的原文`, params.textModel, false)
  const entries = [...output.matchAll(/^##\s+([A-Za-z0-9_-]+)\s*\n([\s\S]*?)(?=^##\s+|$(?![\s\S]))/gm)].map((match) => ({ cueId: match[1], text: match[2].trim() }))
  if (entries.length !== params.cues.length || entries.some((item, index) => item.cueId !== params.cues[index].cueId || !item.text)) throw new Error('语义校准结果不完整')
  return { subtitles: entries }
}

export async function generateTalkingHeadEditPlan(params: { textModel: TextModel; instruction: string; cues: Array<{ cueId: string; text: string }> }) {
  if (!params.instruction.trim() || !params.cues.length) throw new Error('结构整理参数无效')
  const result = json(await request('你是口播视频结构编辑助手。只输出合法 JSON。', `只能重排或删除已有字幕，绝不能改写、合并、拆分或新增。用户要求：${params.instruction}\n\n字幕：${JSON.stringify(params.cues)}\n\n返回：{"cueIds":["按新顺序列出 cueId"],"removedCueIds":["删除的 cueId"]}`, params.textModel)) as { cueIds?: unknown; removedCueIds?: unknown }
  const known = params.cues.map((cue) => cue.cueId)
  const cueIds = Array.isArray(result.cueIds) ? result.cueIds.map(String).filter((id) => known.includes(id)) : []
  const removedCueIds = Array.isArray(result.removedCueIds) ? result.removedCueIds.map(String).filter((id) => known.includes(id)) : []
  if (new Set(cueIds).size !== cueIds.length || new Set(removedCueIds).size !== removedCueIds.length) throw new Error('结构整理结果含有重复字幕 ID')
  return { cueIds: [...cueIds, ...known.filter((id) => !cueIds.includes(id))], removedCueIds }
}

export async function generateTalkingHeadHighlights(params: { textModel: TextModel; cues: Array<{ cueId: string; text: string }> }) {
  const result = json(await request('你是短视频口播重点大字编辑助手。只输出合法 JSON。', `按口播完整语义挑重点大字，绝不按固定数量挑选。必须从头到尾逐段检查全部字幕：相邻细碎字幕先合在脑中理解成一句话或一个观点，再在原字幕中选择重点。重点分三层：第一层是信息重点，包括结论、痛点、结果、反差、数字、方法、行动指令、关键名词、风险和错误认知；第二层是情绪重点，包括惊讶、愤怒吐槽、焦虑危险、爽感胜利、委屈共鸣、挑衅争议、紧迫感、幽默、方言和有辨识度的口头爆点；第三层是节奏重点，包括开场第一句、观点转折、信息密度高点、情绪升级和结尾金句。每个语义段只要有任一层重点，就必须输出该段最有冲击力的一条原字幕中的一个短语；只有确实没有重点才不输出。情绪冲击和观众表达欲优先于普通说明词，但不要把普通连接词硬做成花字。同一连续观点最多一个，相邻重点过近或语义重复时只保留信息更强的一个；整条口播重点密度通常每 6 到 12 秒一个，内容情绪强或观点密集时可以更密，不得为了凑数量乱选。每条字幕最多一项；短语必须是原文连续词，2 到 8 个字，绝不改写或凭空生成。数字、结果、反差、风险、愤怒和警告用爆点黄；结论、方法、工具、模型、情绪共鸣、金句和英文术语用结论绿。返回全部符合条件的项目，不要自行限制数量。返回：{"items":[{"cueId":"cue-001","phrase":"原文短语","style":"爆点黄"}]}\n\n字幕：${JSON.stringify(params.cues)}`, params.textModel)) as { items?: unknown }
  const byId = new Map(params.cues.map((cue) => [cue.cueId, cue.text]))
  const items = Array.isArray(result.items) ? result.items : []
  const valid = items.flatMap((item: any) => byId.get(String(item?.cueId))?.includes(String(item?.phrase || '')) && ['爆点黄', '结论绿'].includes(item?.style) ? [{ cueId: String(item.cueId), phrase: String(item.phrase), style: item.style as '爆点黄' | '结论绿' }] : [])
  return { items: valid.filter((item, index) => valid.findIndex((candidate) => candidate.cueId === item.cueId) === index) }
}

export async function chooseTalkingHeadHighlightPositions(params: { textModel: TextModel; items: Array<{ cueId: string; phrase: string; style: '爆点黄' | '结论绿' }>; frames: Array<{ cueId: string; image: string }> }) {
  if (!params.items.length) return { positions: [] as Array<{ cueId: string; position: '左上' | '右上' | '左中' | '右中' | '上中' }> }
  const content: Record<string, unknown>[] = [{ type: 'text', text: '为每个重点词选择不遮挡主体的位置，只能选 左上、右上、左中、右中、上中。返回 {"positions":[{"cueId":"cue-001","position":"左上"}]}' }]
  params.items.forEach((item) => { content.push({ type: 'text', text: `${item.cueId}: ${item.phrase}` }); const frame = params.frames.find((candidate) => candidate.cueId === item.cueId); if (frame) content.push({ type: 'image_url', image_url: { url: frame.image } }) })
  const result = json(await request('你是短视频画面排版助手。只输出合法 JSON。', content, params.textModel)) as { positions?: any[] }
  const allowed = ['左上', '右上', '左中', '右中', '上中']
  return { positions: (Array.isArray(result.positions) ? result.positions : []).flatMap((item) => params.items.some((candidate) => candidate.cueId === item?.cueId) && allowed.includes(item?.position) ? [{ cueId: item.cueId, position: item.position }] : []) }
}
