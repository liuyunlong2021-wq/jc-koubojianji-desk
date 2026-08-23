export type FilmBreakdownAnalysisStatus = 'pending' | 'running' | 'ready' | 'failed'
export type FilmBreakdownFramePosition = 'start' | 'middle' | 'end'
export type FilmBreakdownAssetCategory = 'character' | 'scene' | 'prop'
export type FilmBreakdownVideoTemplate = 'video-prompt' | 'script'

export interface FilmBreakdownAssetOccurrence {
  shotId: string
  position: FilmBreakdownFramePosition
}

export interface FilmBreakdownAsset {
  assetId: string
  category: FilmBreakdownAssetCategory
  name: string
  description: string
  occurrences: FilmBreakdownAssetOccurrence[]
  representative: FilmBreakdownAssetOccurrence & { fileName: string }
  selected: boolean
  prompt: string
  status: FilmBreakdownAnalysisStatus
  error?: string
}

export interface FilmBreakdownShot {
  shotId: string
  startMs: number
  endMs: number
  clipFileName?: string
  frameFileName?: string
  frameFileNames?: Partial<Record<FilmBreakdownFramePosition, string>>
  analysisStatus: FilmBreakdownAnalysisStatus
  videoPrompt: string
  videoResults?: Partial<Record<FilmBreakdownVideoTemplate, string>>
  imagePrompt: string
  imagePrompts?: Partial<Record<FilmBreakdownFramePosition, string>>
  error?: string
}

export interface FilmBreakdownProjectState {
  schemaVersion: 1
  name: string
  createdAt: string
  updatedAt: string
  source?: { fileName: string; fingerprint: string; durationMs: number }
  detectionThreshold: number
  boundariesConfirmed: boolean
  shots: FilmBreakdownShot[]
  imageAssets?: FilmBreakdownAsset[]
  videoOverview?: FilmBreakdownVideoOverview
}

export interface FilmBreakdownVideoOverview {
  narrative: string
  lightingPhilosophy: string
  colorGrading: string
  timeRules: string
  setting: string
  ambientSound: string
  crowd: string
  technicalConstraints: string[]
  shotRoles: Record<string, string>
}

export type FilmBreakdownEditAction = 'split' | 'merge-next' | 'set-start' | 'set-end' | 'delete'

const resetShot = (shot: FilmBreakdownShot): FilmBreakdownShot => ({
  ...shot,
  clipFileName: undefined,
  frameFileName: undefined,
  frameFileNames: undefined,
  analysisStatus: 'pending',
  videoPrompt: '',
  videoResults: undefined,
  imagePrompt: '',
  imagePrompts: undefined,
  error: undefined,
})

export function normalizeFilmBreakdownShots(shots: FilmBreakdownShot[]) {
  return shots.map((shot, index) => ({ ...shot, shotId: `shot-${String(index + 1).padStart(3, '0')}` }))
}

export function shotsFromSceneCuts(cutsMs: number[], durationMs: number, minimumShotMs = 120) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('原片时长无效')
  const cuts = [...new Set(cutsMs.map(Math.round))]
    .filter((cut) => Number.isFinite(cut) && cut >= minimumShotMs && cut <= durationMs - minimumShotMs)
    .sort((left, right) => left - right)
    .filter((cut, index, values) => index === 0 || cut - values[index - 1] >= minimumShotMs)
  return normalizeFilmBreakdownShots([0, ...cuts].map((startMs, index, boundaries) => ({
    shotId: '',
    startMs,
    endMs: boundaries[index + 1] ?? durationMs,
    analysisStatus: 'pending' as const,
    videoPrompt: '',
    imagePrompt: '',
  })))
}

export function chooseFilmBreakdownDetectionCuts(primaryCuts: number[], fallbackCuts: number[], durationMs: number) {
  return primaryCuts.length || durationMs > 30_000 ? primaryCuts : fallbackCuts
}

export function validateFilmBreakdownShots(shots: FilmBreakdownShot[], durationMs: number) {
  if (!shots.length || shots[0].startMs !== 0 || shots.at(-1)?.endMs !== durationMs) throw new Error('镜头时间轴没有覆盖完整原片')
  shots.forEach((shot, index) => {
    if (shot.shotId !== `shot-${String(index + 1).padStart(3, '0')}` || shot.endMs <= shot.startMs || (index > 0 && shots[index - 1].endMs !== shot.startMs))
      throw new Error('镜头时间轴无效')
  })
  return shots
}

export function editFilmBreakdownShots(shots: FilmBreakdownShot[], selectedShotId: string, action: FilmBreakdownEditAction, playheadMs: number, minimumShotMs = 120) {
  const index = shots.findIndex((shot) => shot.shotId === selectedShotId)
  if (index < 0) return shots
  const next = shots.map((shot) => ({ ...shot }))
  const shot = next[index]
  const at = Math.round(playheadMs)

  if (action === 'split') {
    if (at - shot.startMs < minimumShotMs || shot.endMs - at < minimumShotMs) return shots
    next.splice(index, 1, resetShot({ ...shot, endMs: at }), resetShot({ ...shot, startMs: at }))
  } else if (action === 'merge-next') {
    if (!next[index + 1]) return shots
    next.splice(index, 2, resetShot({ ...shot, endMs: next[index + 1].endMs }))
  } else if (action === 'set-start') {
    if (!next[index - 1] || at - next[index - 1].startMs < minimumShotMs || shot.endMs - at < minimumShotMs) return shots
    next[index - 1] = resetShot({ ...next[index - 1], endMs: at })
    next[index] = resetShot({ ...shot, startMs: at })
  } else if (action === 'set-end') {
    if (!next[index + 1] || at - shot.startMs < minimumShotMs || next[index + 1].endMs - at < minimumShotMs) return shots
    next[index] = resetShot({ ...shot, endMs: at })
    next[index + 1] = resetShot({ ...next[index + 1], startMs: at })
  } else if (action === 'delete') {
    if (next.length === 1) return shots
    if (index > 0) next.splice(index - 1, 2, resetShot({ ...next[index - 1], endMs: shot.endMs }))
    else next.splice(0, 2, resetShot({ ...next[1], startMs: 0 }))
  }
  return normalizeFilmBreakdownShots(next)
}

export function formatFilmBreakdownTime(milliseconds: number) {
  const value = Math.max(0, Math.round(milliseconds))
  const hours = Math.floor(value / 3_600_000)
  const minutes = Math.floor((value % 3_600_000) / 60_000)
  const seconds = Math.floor((value % 60_000) / 1000)
  const millis = value % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}

export function filmBreakdownFrameTimestamp(shot: Pick<FilmBreakdownShot, 'startMs' | 'endMs'>, position: FilmBreakdownFramePosition) {
  if (position === 'start') return shot.startMs
  if (position === 'middle') return Math.round((shot.startMs + shot.endMs) / 2)
  return Math.max(shot.startMs, shot.endMs - 80)
}

export function normalizeFilmBreakdownAssets(candidates: Array<{ category?: unknown; name?: unknown; description?: unknown; occurrences?: Array<{ shotId?: unknown; position?: unknown }> }>, shots: FilmBreakdownShot[]) {
  const categories: FilmBreakdownAssetCategory[] = ['character', 'scene', 'prop']
  const counts = new Map<FilmBreakdownAssetCategory, number>()
  return candidates.flatMap((candidate): FilmBreakdownAsset[] => {
    const category = String(candidate.category || '') as FilmBreakdownAssetCategory
    const name = String(candidate.name || '').trim()
    const description = String(candidate.description || '').trim()
    if (!categories.includes(category) || !name || !description) return []
    const occurrences = (Array.isArray(candidate.occurrences) ? candidate.occurrences : []).flatMap((occurrence): FilmBreakdownAssetOccurrence[] => {
      const shot = shots.find((item) => item.shotId === String(occurrence.shotId || ''))
      const position = String(occurrence.position || '') as FilmBreakdownFramePosition
      return shot?.frameFileNames?.[position] ? [{ shotId: shot.shotId, position }] : []
    }).filter((occurrence, index, values) => values.findIndex((item) => item.shotId === occurrence.shotId && item.position === occurrence.position) === index).sort(compareFilmBreakdownOccurrences)
    if (!occurrences.length) return []
    const number = (counts.get(category) || 0) + 1
    counts.set(category, number)
    const representative = occurrences[0]
    const fileName = shots.find((shot) => shot.shotId === representative.shotId)!.frameFileNames![representative.position]!
    return [{ assetId: `${category}-${String(number).padStart(3, '0')}`, category, name, description, occurrences, representative: { ...representative, fileName }, selected: false, prompt: '', status: 'pending' }]
  })
}

function compareFilmBreakdownOccurrences(left: FilmBreakdownAssetOccurrence, right: FilmBreakdownAssetOccurrence) {
  const leftNumber = Number(left.shotId.match(/(\d+)$/)?.[1] || Number.POSITIVE_INFINITY)
  const rightNumber = Number(right.shotId.match(/(\d+)$/)?.[1] || Number.POSITIVE_INFINITY)
  return leftNumber - rightNumber || ['start', 'middle', 'end'].indexOf(left.position) - ['start', 'middle', 'end'].indexOf(right.position) || left.shotId.localeCompare(right.shotId)
}

export function selectFilmBreakdownAssetReferences(occurrences: FilmBreakdownAssetOccurrence[], limit = 6) {
  const ordered = [...occurrences].sort(compareFilmBreakdownOccurrences)
  if (ordered.length <= limit) return ordered
  return Array.from({ length: limit }, (_, index) => ordered[Math.round(index * (ordered.length - 1) / (limit - 1))])
}

export function mergeFilmBreakdownAssetResults(next: FilmBreakdownAsset[], previous: FilmBreakdownAsset[] = []) {
  const oldByKey = new Map(previous.map((asset) => [`${asset.category}\u0000${asset.name}`, asset]))
  return next.map((asset) => {
    const old = oldByKey.get(`${asset.category}\u0000${asset.name}`)
    return old ? { ...asset, assetId: old.assetId, selected: old.selected, prompt: old.prompt, status: old.status, error: old.error } : asset
  })
}

export function formatFilmBreakdownMarkdown(state: FilmBreakdownProjectState) {
  const source = state.source?.fileName || '未导入'
  const positionNames: Record<FilmBreakdownFramePosition, string> = { start: '首帧', middle: '中间帧', end: '尾帧' }
  const shots = state.shots.map((shot) => {
    const imagePrompts = (Object.entries(shot.imagePrompts || {}) as Array<[FilmBreakdownFramePosition, string]>).filter(([, prompt]) => prompt.trim()).map(([position, prompt]) => `### ${positionNames[position]}图片提示词\n\n${prompt}`).join('\n\n')
    return `## ${shot.shotId}｜${formatFilmBreakdownTime(shot.startMs)} - ${formatFilmBreakdownTime(shot.endMs)}\n\n### 视频提示词\n\n${shot.videoPrompt}\n\n${imagePrompts || `### 图片提示词\n\n${shot.imagePrompt}`}`
  }).join('\n\n')
  const categoryNames: Record<FilmBreakdownAssetCategory, string> = { character: '角色资产', scene: '场景资产', prop: '关键道具' }
  const assets = (state.imageAssets || []).filter((asset) => asset.status === 'ready' && asset.prompt.trim()).map((asset) => `## ${categoryNames[asset.category]}｜${asset.name}\n\n${asset.prompt}`).join('\n\n')
  return `# 影片拉片\n\n- 原片：${source}\n- 镜头数：${state.shots.length}\n\n${shots}${assets ? `\n\n# 图片资产\n\n${assets}` : ''}${shots || assets ? '\n' : ''}`
}

export function formatFilmBreakdownImageDocument(state: FilmBreakdownProjectState, format: 'md' | 'txt') {
  const positionNames: Record<FilmBreakdownFramePosition, string> = { start: '首帧', middle: '中间帧', end: '尾帧' }
  const shots = state.shots.flatMap((shot) => {
    const prompts = (Object.entries(shot.imagePrompts || {}) as Array<[FilmBreakdownFramePosition, string]>).filter(([, prompt]) => prompt.trim()).map(([position, prompt]) => `### ${positionNames[position]}图片提示词\n\n${prompt}`).join('\n\n')
    return prompts ? [`## ${shot.shotId}｜${formatFilmBreakdownTime(shot.startMs)} - ${formatFilmBreakdownTime(shot.endMs)}\n\n${prompts}`] : []
  }).join('\n\n')
  const categoryNames: Record<FilmBreakdownAssetCategory, string> = { character: '角色资产', scene: '场景资产', prop: '关键道具' }
  const assets = (state.imageAssets || []).filter((asset) => asset.status === 'ready' && asset.prompt.trim()).map((asset) => `## ${categoryNames[asset.category]}｜${asset.name}\n\n${asset.prompt}`).join('\n\n')
  const markdown = `# ${state.name}｜图片分析\n\n${shots || '暂无镜头画面提示词'}${assets ? `\n\n# 资产提示词\n\n${assets}` : ''}\n`
  return format === 'md' ? markdown : markdown.replace(/^#{1,3}\s+/gm, '')
}

const videoTemplateOrder: FilmBreakdownVideoTemplate[] = ['video-prompt', 'script']

export function normalizeFilmBreakdownVideoTemplates(templates: FilmBreakdownVideoTemplate[]) {
  const selected = new Set(templates)
  const normalized = videoTemplateOrder.filter((template) => selected.has(template))
  if (!normalized.length) throw new Error('至少选择一种视频分析模板')
  return normalized
}

export function normalizeFilmBreakdownVideoOverview(candidate: Partial<FilmBreakdownVideoOverview>, shots: FilmBreakdownShot[]): FilmBreakdownVideoOverview {
  const required = ['narrative', 'lightingPhilosophy', 'colorGrading', 'setting', 'ambientSound'] as const
  if (required.some((field) => !String(candidate[field] || '').trim())) throw new Error('全片总览结果不完整')
  const technicalConstraints = Array.isArray(candidate.technicalConstraints) ? candidate.technicalConstraints.map(String).map((value) => value.trim()).filter(Boolean) : []
  if (!technicalConstraints.length) throw new Error('全片总览缺少技术约束')
  const roles = candidate.shotRoles && typeof candidate.shotRoles === 'object' ? candidate.shotRoles : {}
  return {
    narrative: String(candidate.narrative).trim(), lightingPhilosophy: String(candidate.lightingPhilosophy).trim(), colorGrading: String(candidate.colorGrading).trim(),
    timeRules: String(candidate.timeRules || '').trim(), setting: String(candidate.setting).trim(), ambientSound: String(candidate.ambientSound).trim(), crowd: String(candidate.crowd || '').trim(), technicalConstraints,
    shotRoles: Object.fromEntries(shots.map((shot) => [shot.shotId, String(roles[shot.shotId] || '').trim()])),
  }
}

export function formatFilmBreakdownVideoDocument(state: FilmBreakdownProjectState, templates: FilmBreakdownVideoTemplate[], format: 'md' | 'txt') {
  const selected = normalizeFilmBreakdownVideoTemplates(templates)
  const names: Record<FilmBreakdownVideoTemplate, string> = { 'video-prompt': '视频提示词', script: '剧本' }
  const shots = state.shots.flatMap((shot) => {
    const results = { 'video-prompt': shot.videoResults?.['video-prompt'] || shot.videoPrompt, script: shot.videoResults?.script || '' }
    const sections = selected.flatMap((template) => results[template]?.trim() ? [`### ${names[template]}\n\n${results[template].trim()}`] : []).join('\n\n')
    return sections ? [`## ${shot.shotId}｜${formatFilmBreakdownTime(shot.startMs)} - ${formatFilmBreakdownTime(shot.endMs)}\n\n${sections}`] : []
  }).join('\n\n')
  const markdown = `# ${state.name}｜视频反推\n\n${shots || '暂无视频反推结果'}\n`
  return format === 'md' ? markdown : markdown.replace(/^#{1,3}\s+/gm, '')
}

export function groupFilmBreakdownShots(shots: FilmBreakdownShot[], targetSeconds: number) {
  if (!Number.isInteger(targetSeconds) || targetSeconds < 4 || targetSeconds > 30) throw new Error('目标片段时长必须是 4-30 秒整数')
  const groups: FilmBreakdownShot[][] = []
  for (let start = 0; start < shots.length;) {
    let bestEnd = start + 1
    let bestDifference = Math.abs(shots[start].endMs - shots[start].startMs - targetSeconds * 1000)
    for (let end = start + 2; end <= shots.length; end++) {
      const duration = shots[end - 1].endMs - shots[start].startMs
      const difference = Math.abs(duration - targetSeconds * 1000)
      if (difference <= bestDifference) { bestEnd = end; bestDifference = difference }
      if (duration >= targetSeconds * 1000) break
    }
    groups.push(shots.slice(start, bestEnd))
    start = bestEnd
  }
  return groups
}

function compactSeconds(milliseconds: number) {
  return String(Number((milliseconds / 1000).toFixed(3)))
}

export function formatFilmBreakdownCompletePrompts(state: FilmBreakdownProjectState, targetSeconds: number, format: 'md' | 'txt') {
  if (!state.videoOverview) throw new Error('请先生成全片总览')
  if (state.shots.some((shot) => !String(shot.videoResults?.['video-prompt'] || shot.videoPrompt).trim())) throw new Error('请先完成全部镜头的视频提示词反推')
  const groups = groupFilmBreakdownShots(state.shots, targetSeconds)
  const documents = groups.map((shots) => {
    const startMs = shots[0].startMs
    const endMs = shots.at(-1)!.endMs
    const shotIds = new Set(shots.map((shot) => shot.shotId))
    const assets = (state.imageAssets || []).filter((asset) => asset.occurrences.some((occurrence) => shotIds.has(occurrence.shotId)))
    const assetNumbers = new Map(assets.map((asset, index) => [asset.assetId, `@Image${index + 1}`]))
    const references = assets.length ? assets.map((asset) => `  ${assetNumbers.get(asset.assetId)} = ${asset.name}`).join('\n') : '  无'
    const sequence = shots.map((shot, index) => {
      const prompt = String(shot.videoResults?.['video-prompt'] || shot.videoPrompt).trim()
      const role = state.videoOverview!.shotRoles[shot.shotId]?.trim()
      const title = `镜头${index + 1}（${compactSeconds(shot.startMs - startMs)}至${compactSeconds(shot.endMs - startMs)}秒）${role ? ` ${role}` : ''}`
      const body = prompt.replace(/^镜头[^\n]*/, title)
      const used = assets.filter((asset) => asset.occurrences.some((occurrence) => occurrence.shotId === shot.shotId)).map((asset) => assetNumbers.get(asset.assetId))
      return used.length ? body.replace(/\n/, `\n参考资产：${used.join('、')}\n`) : body
    }).join('\n\n')
    const overview = state.videoOverview!
    return `场景：${compactSeconds(endMs - startMs)}秒 单条片 ｜ ${overview.narrative}\n镜头结构：${shots.length}个镜头，${compactSeconds(endMs - startMs)}秒\n\n全局风格说明：\n- 参考映射：\n${references}\n- 灯光哲学：${overview.lightingPhilosophy}\n- 色彩分级：${overview.colorGrading}\n- 时间状态语法：${overview.timeRules || '无特殊时间效果'}\n- 场所：${overview.setting}\n- 环境音：${overview.ambientSound}\n- 人群：${overview.crowd || '按原片可见状态'}\n\n序列列表：\n${sequence}\n\n技术约束：\n${overview.technicalConstraints.map((constraint) => `- ${constraint}`).join('\n')}`
  })
  const markdown = `# ${state.name}｜完整视频提示词\n\n- 目标片段时长：${targetSeconds}秒\n- 输出片段数：${documents.length}\n\n${documents.map((document, index) => `## 片段${index + 1}\n\n${document}`).join('\n\n')}`
  return format === 'md' ? `${markdown}\n` : `${markdown.replace(/^#{1,2}\s+/gm, '')}\n`
}

export function filmBreakdownMediaUrl(rootPath: string, directory: '视频' | '图片', fileName: string) {
  return `talking-head-media://asset?${new URLSearchParams({ root: rootPath, path: `${directory}/${fileName}` })}`
}
