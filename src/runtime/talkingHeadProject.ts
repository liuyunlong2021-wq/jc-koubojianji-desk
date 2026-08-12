export const talkingHeadMediaDirectories = ['视频', '文档', '图片', '音频'] as const
export type TalkingHeadMediaDirectory = (typeof talkingHeadMediaDirectories)[number]

export function talkingHeadMediaRelativePath(directory: TalkingHeadMediaDirectory, fileName = '') {
  const normalized = String(fileName).replace(/\\/g, '/').replace(/^\/+/, '')
  if (normalized.split('/').some((part: string) => part === '..')) throw new Error('媒体文件路径无效')
  return ['.raw', 'jc-media', directory, normalized].filter(Boolean).join('/')
}

export function talkingHeadMediaUrl(rootPath: string, fileName: string, directory: TalkingHeadMediaDirectory = '视频') {
  return `talking-head-media://asset?${new URLSearchParams({ root: rootPath, path: `${directory}/${fileName}` })}`
}

export interface TalkingHeadCue {
  cueId: string
  startMs: number
  endMs: number
  recognizedText: string
  confirmedText: string
  deleted?: boolean
}

export interface TalkingHeadEditPlan {
  sourceFingerprint: string
  cueIds: string[]
  removedCueIds: string[]
  updatedAt: string
}

export const talkingHeadHighlightTemplates = [
  { id: '爆点黄', label: '荧光标签', color: '#101010', background: '#A6FF00', scale: 1.12 },
  { id: '结论绿', label: '奶油大字', color: '#FFF0B8', background: 'transparent', scale: 1.28 },
] as const

export const talkingHeadSoundEffects = [
  { style: '爆点黄', fileName: '重点音效-CLICK11.wav', label: 'CLICK11 · 荧光标签' },
  { style: '结论绿', fileName: '重点音效-X_ci.wav', label: 'X_ci · 奶油大字' },
] as const

export type TalkingHeadHighlightStyle = (typeof talkingHeadHighlightTemplates)[number]['id']
export const talkingHeadHighlightPositions = ['左上', '右上', '左中', '右中', '上中'] as const
export type TalkingHeadHighlightPosition = (typeof talkingHeadHighlightPositions)[number]

export interface TalkingHeadHighlight {
  cueId: string
  phrase: string
  style: TalkingHeadHighlightStyle
  position?: TalkingHeadHighlightPosition
}

export interface TalkingHeadHighlightPlan {
  sourceFingerprint: string
  items: TalkingHeadHighlight[]
  updatedAt: string
}

export interface TalkingHeadBackgroundMusic {
  fileName: string
  volume: number
}

export type TalkingHeadOutputRatio = 'source' | '9:16'

export interface TalkingHeadSubtitleStyle {
  fontFamily: string
  fontScale: number
  verticalPosition: number
  bold: boolean
  outline: boolean
  fontColor: string
  outlineColor: string
  highlightScale: number
}

export const defaultTalkingHeadSubtitleStyle: TalkingHeadSubtitleStyle = { fontFamily: 'Arial', fontScale: 1, verticalPosition: 76, bold: true, outline: true, fontColor: '#FFFFFF', outlineColor: '#000000', highlightScale: 1 }

export interface TalkingHeadComposeOptions {
  ratio: TalkingHeadOutputRatio
  burnSubtitles: boolean
  subtitleStyle: TalkingHeadSubtitleStyle
}

export interface TalkingHeadProjectState {
  schemaVersion: 1
  name: string
  createdAt: string
  updatedAt: string
  source?: { fileName: string; fingerprint: string; durationMs: number }
  cues: TalkingHeadCue[]
  editPlan?: TalkingHeadEditPlan
  highlightPlan?: TalkingHeadHighlightPlan
  backgroundMusic?: TalkingHeadBackgroundMusic
  soundEffectsEnabled?: boolean
  subtitleStyle?: TalkingHeadSubtitleStyle
  editPlanStale: boolean
}

export function validateTalkingHeadCues(cues: TalkingHeadCue[]) {
  const ids = new Set<string>()
  let lastEnd = 0
  for (const cue of cues) {
    if (!/^cue-\d+$/.test(cue.cueId) || ids.has(cue.cueId)) throw new Error('字幕 ID 无效')
    if (!Number.isFinite(cue.startMs) || !Number.isFinite(cue.endMs) || cue.startMs < lastEnd || cue.endMs <= cue.startMs)
      throw new Error('字幕时间轴无效')
    if (!cue.recognizedText.trim() || !cue.confirmedText.trim()) throw new Error('字幕内容不能为空')
    ids.add(cue.cueId)
    lastEnd = cue.endMs
  }
  return cues
}

function formatAssTime(milliseconds: number) {
  const centiseconds = Math.max(0, Math.floor(milliseconds / 10))
  const hours = Math.floor(centiseconds / 360_000)
  const minutes = Math.floor((centiseconds % 360_000) / 6_000)
  const seconds = Math.floor((centiseconds % 6_000) / 100)
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}`
}

export function normalizeTalkingHeadSubtitleStyle(style?: Partial<TalkingHeadSubtitleStyle>): TalkingHeadSubtitleStyle {
  const fontFamily = String(style?.fontFamily || defaultTalkingHeadSubtitleStyle.fontFamily).replace(/[\r\n,]/g, ' ').trim() || defaultTalkingHeadSubtitleStyle.fontFamily
  const fontScale = Number(style?.fontScale)
  const verticalPosition = Number(style?.verticalPosition)
  const color = (value: unknown, fallback: string) => /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value).toUpperCase() : fallback
  const highlightScale = Number(style?.highlightScale)
  return { fontFamily, fontScale: Number.isFinite(fontScale) ? Math.max(0.7, Math.min(1.5, fontScale)) : 1, verticalPosition: Number.isFinite(verticalPosition) ? Math.max(8, Math.min(92, verticalPosition)) : defaultTalkingHeadSubtitleStyle.verticalPosition, bold: typeof style?.bold === 'boolean' ? style.bold : defaultTalkingHeadSubtitleStyle.bold, outline: typeof style?.outline === 'boolean' ? style.outline : defaultTalkingHeadSubtitleStyle.outline, fontColor: color(style?.fontColor, defaultTalkingHeadSubtitleStyle.fontColor), outlineColor: color(style?.outlineColor, defaultTalkingHeadSubtitleStyle.outlineColor), highlightScale: Number.isFinite(highlightScale) ? Math.max(0.7, Math.min(1.3, highlightScale)) : 1 }
}

export function formatTalkingHeadAss(cues: Array<{ cueId?: string; startMs: number; endMs: number; text: string }>, resolution = { width: 1080, height: 1920 }, subtitleStyle?: Partial<TalkingHeadSubtitleStyle>, highlights: TalkingHeadHighlight[] = []) {
  const width = Math.max(1, Math.round(resolution.width))
  const height = Math.max(1, Math.round(resolution.height))
  const style = normalizeTalkingHeadSubtitleStyle(subtitleStyle)
  const position = `{\\an2\\pos(${Math.round(width / 2)},${Math.round(height * style.verticalPosition / 100)})}`
  const escapeAssText = (text: string) => text.replace(/\\/g, '\\\\').replace(/[{}]/g, '\\$&').replace(/\r?\n/g, '\\N')
  const assColor = (hex: string) => `&H00${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`
  const fontSize = Math.round(height * 0.052 * style.fontScale)
  // Keep generated subtitles inside a fixed visual safe area; source captions remain untouched.
  const maxColumns = Math.max(8, Math.floor((width - 128) / (fontSize * .9)))
  const lineBreaks = (text: string) => {
    const breaks = new Set<number>()
    let columns = 0
    for (let index = 0; index < text.length; index++) {
      if (/\r|\n/.test(text[index])) { columns = 0; continue }
      if (columns >= maxColumns) { breaks.add(index); columns = 0 }
      columns++
    }
    return breaks
  }
  const events = cues.map((cue) => {
    if (!Number.isFinite(cue.startMs) || !Number.isFinite(cue.endMs) || cue.endMs <= cue.startMs) throw new Error('成片字幕时间轴无效')
    const breaks = lineBreaks(cue.text)
    const text = [...cue.text].map((character, index) => {
      const before = breaks.has(index) ? '\\N' : ''
      return `${before}${escapeAssText(character)}`
    }).join('')
    return `Dialogue: 0,${formatAssTime(cue.startMs)},${formatAssTime(cue.endMs)},Default,,0,0,0,,${position}${text}`
  })
  const highlightEvents = highlights.flatMap((highlight) => {
    const cue = cues.find((candidate) => candidate.cueId === highlight.cueId)
    const template = talkingHeadHighlightTemplates.find((candidate) => candidate.id === highlight.style)
    if (!cue || !template || !cue.text.includes(highlight.phrase)) return []
    // Keep preview and rendered video aligned to the same output-safe position.
    const anchor = ({ 左上: { x: .1, y: .22, alignment: 7 }, 右上: { x: .9, y: .22, alignment: 9 }, 左中: { x: .1, y: .43, alignment: 7 }, 右中: { x: .9, y: .43, alignment: 9 }, 上中: { x: .5, y: .16, alignment: 8 } } as const)[highlight.position || '左上']
    const size = Math.round(fontSize * template.scale * 1.65 * style.highlightScale)
    const tag = template.id === '爆点黄'
    const effect = `{\\an${anchor.alignment}\\pos(${Math.round(width * anchor.x)},${Math.round(height * anchor.y + 24)})\\alpha&H35&\\fscx78\\fscy78\\t(0,220,\\alpha&H00&\\fscx100\\fscy100\\pos(${Math.round(width * anchor.x)},${Math.round(height * anchor.y)}))\\fs${size}\\b1\\c${assColor(template.color)}\\3c${assColor(tag ? template.background : '#000000')}\\bord${tag ? Math.round(size * .24) : Math.max(3, Math.round(size * .045))}\\shad${tag ? 0 : Math.max(2, Math.round(size * .03))}\\4c&H66000000&}`
    return `Dialogue: 1,${formatAssTime(cue.startMs)},${formatAssTime(cue.endMs)},Default,,0,0,0,,${effect}${escapeAssText(highlight.phrase)}`
  })
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Default,${style.fontFamily},${fontSize},${assColor(style.fontColor)},${assColor(style.fontColor)},${assColor(style.outlineColor)},&HFF000000,${style.bold ? -1 : 0},0,0,0,100,100,0,0,1,${style.outline ? Math.max(1, Math.round(fontSize * .02)) : 0},0,2,64,64,0,1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n${[...events, ...highlightEvents].join('\n')}\n`
}

export function editTalkingHeadCues(cues: TalkingHeadCue[], cueId: string, action: 'add' | 'split' | 'merge-next' | 'set-start' | 'set-end' | 'delete', playheadMs: number) {
  const index = cues.findIndex((cue) => cue.cueId === cueId)
  if (action === 'add') {
    const startMs = Math.max(cues.at(-1)?.endMs || 0, playheadMs)
    return [...cues, { cueId: `cue-${String(cues.length + 1).padStart(3, '0')}`, startMs, endMs: startMs + 1000, recognizedText: '人工新增字幕', confirmedText: '人工新增字幕' }]
  }
  if (index < 0) throw new Error('请先选择一条字幕')
  const current = cues[index]
  const previousEnd = cues[index - 1]?.endMs || 0
  const nextStart = cues[index + 1]?.startMs || Number.POSITIVE_INFINITY
  if (action === 'delete') return cues.filter((cue) => cue.cueId !== cueId)
  if (action === 'merge-next') {
    const next = cues[index + 1]
    if (!next) throw new Error('没有可合并的下一条字幕')
    return [...cues.slice(0, index), { ...current, endMs: next.endMs, recognizedText: `${current.recognizedText}${next.recognizedText}`, confirmedText: `${current.confirmedText}${next.confirmedText}` }, ...cues.slice(index + 2)]
  }
  if (action === 'split') {
    const split = Math.max(current.startMs + 1, Math.min(playheadMs, current.endMs - 1))
    if (split <= current.startMs || split >= current.endMs) throw new Error('播放头不在所选字幕内部')
    const half = Math.ceil(current.confirmedText.length / 2)
    return [...cues.slice(0, index), { ...current, endMs: split, recognizedText: current.recognizedText.slice(0, half), confirmedText: current.confirmedText.slice(0, half) }, { ...current, cueId: `cue-${String(cues.length + 1).padStart(3, '0')}`, startMs: split, recognizedText: current.recognizedText.slice(half), confirmedText: current.confirmedText.slice(half) }, ...cues.slice(index + 1)]
  }
  if (action === 'set-start') {
    const startMs = Math.max(previousEnd, Math.min(playheadMs, current.endMs - 1))
    return cues.map((cue, position) => position === index ? { ...cue, startMs } : cue)
  }
  const endMs = Math.min(nextStart, Math.max(playheadMs, current.startMs + 1))
  return cues.map((cue, position) => position === index ? { ...cue, endMs } : cue)
}
