import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dialog, shell } from 'electron'
import { formatTalkingHeadAss, normalizeTalkingHeadSubtitleStyle, talkingHeadHighlightPositions, talkingHeadHighlightTemplates, talkingHeadMediaDirectories, talkingHeadMediaRelativePath, talkingHeadSoundEffects, validateTalkingHeadCues, type TalkingHeadBackgroundMusic, type TalkingHeadComposeOptions, type TalkingHeadCue, type TalkingHeadEditPlan, type TalkingHeadHighlightPlan, type TalkingHeadProjectState } from '../src/runtime/talkingHeadProject.ts'
import { executeFFmpeg } from './ffmpeg/index.ts'
import { funAsrCuesToSrt, transcribeAudioWithFunAsr } from './video-translation-asr.ts'
import { calibrateTalkingHeadSubtitles, chooseTalkingHeadHighlightPositions, generateTalkingHeadEditPlan, generateTalkingHeadHighlights } from './cloud.ts'
import type { TextModel } from './types.ts'

const runFile = promisify(execFile)
const allowedProjectRoots = new Set<string>()

export type TalkingHeadProject = { rootPath: string; name: string }

function projectFile(rootPath: string) {
  return path.join(rootPath, talkingHeadMediaRelativePath('文档', '项目.json'))
}

async function fileHash(filePath: string) {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function probeVideo(filePath: string) {
  const { stdout } = await runFile(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', filePath])
  const value = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string }> }
  const durationMs = Math.round(Number(value.format?.duration) * 1000)
  if (!value.streams?.some((stream) => stream.codec_type === 'video') || !Number.isFinite(durationMs) || durationMs <= 0)
    throw new Error('上传文件不是可读取的视频')
  return durationMs
}

async function probeVideoSize(filePath: string) {
  const { stdout } = await runFile(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', filePath])
  const stream = (JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number }> }).streams?.[0]
  if (!stream?.width || !stream.height) throw new Error('无法读取原视频画面尺寸')
  return { width: stream.width, height: stream.height }
}

export async function loadTalkingHeadProjectState(rootPath: string): Promise<TalkingHeadProjectState> {
  const project = await ensureTalkingHeadProject(rootPath)
  const fallback: TalkingHeadProjectState = { schemaVersion: 1, name: project.name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), cues: [], editPlanStale: false }
  return fs.promises.readFile(projectFile(project.rootPath), 'utf8').then((content) => ({ ...fallback, ...JSON.parse(content), cues: Array.isArray(JSON.parse(content).cues) ? JSON.parse(content).cues : [] })).catch(() => fallback)
}

export async function listTalkingHeadFonts() {
  const fallback = ['Arial', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei']
  try {
    const { stdout } = await runFile('fc-list', [':lang=zh', 'family'], { maxBuffer: 4 * 1024 * 1024 })
    const fonts = stdout.split(/\r?\n/).flatMap((line) => line.split(',')).map((font) => font.trim()).filter(Boolean)
    return [...new Set([...fallback, ...fonts])].sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
  } catch {
    return fallback
  }
}

async function writeProjectState(rootPath: string, state: TalkingHeadProjectState) {
  const target = projectFile(rootPath)
  const temporary = `${target}.${randomUUID()}.tmp`
  await fs.promises.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await fs.promises.rename(temporary, target)
}

async function replaceFiles(files: Array<{ path: string; content: string }>) {
  const backups = await Promise.all(files.map((file) => fs.promises.readFile(file.path, 'utf8').catch((error: any) => error?.code === 'ENOENT' ? null : Promise.reject(error))))
  const temporary = files.map((file) => `${file.path}.${randomUUID()}.tmp`)
  try {
    await Promise.all(files.map(async (file, index) => {
      await fs.promises.mkdir(path.dirname(file.path), { recursive: true })
      await fs.promises.writeFile(temporary[index], file.content, 'utf8')
    }))
    for (let index = 0; index < files.length; index++) await fs.promises.rename(temporary[index], files[index].path)
  } catch (error) {
    await Promise.all(files.map(async (file, index) => {
      if (backups[index] === null) await fs.promises.rm(file.path, { force: true })
      else await fs.promises.writeFile(file.path, backups[index]!, 'utf8')
      await fs.promises.rm(temporary[index], { force: true })
    }))
    throw error
  }
}

export async function ensureTalkingHeadProject(rootPath: string): Promise<TalkingHeadProject> {
  const root = path.resolve(rootPath)
  const stat = await fs.promises.stat(root)
  if (!stat.isDirectory()) throw new Error('项目文件夹不可用')
  allowedProjectRoots.add(root)
  await Promise.all(
    talkingHeadMediaDirectories.map((directory) =>
      fs.promises.mkdir(path.join(root, talkingHeadMediaRelativePath(directory)), { recursive: true }),
    ),
  )
  const descriptor = projectFile(root)
  if (!(await fs.promises.stat(descriptor).catch(() => null))) {
    const now = new Date().toISOString()
    const project: TalkingHeadProjectState = { schemaVersion: 1, name: path.basename(root), createdAt: now, updatedAt: now, cues: [], editPlanStale: false }
    await fs.promises.writeFile(descriptor, `${JSON.stringify(project, null, 2)}\n`, 'utf8')
  }
  return { rootPath: root, name: path.basename(root) }
}

export function resolveTalkingHeadMedia(rootPath: string, relativePath: string) {
  const root = path.resolve(rootPath)
  if (!allowedProjectRoots.has(root)) throw new Error('项目未打开')
  const relative = String(relativePath).replace(/\\/g, '/').replace(/^\/+/, '')
  if (!relative || relative.split('/').some((part) => part === '..')) throw new Error('媒体路径无效')
  const base = path.join(root, '.raw', 'jc-media')
  const target = path.resolve(base, relative)
  if (!['视频', '音频'].includes(relative.split('/')[0]) || !target.startsWith(`${base}${path.sep}`)) throw new Error('媒体路径无效')
  return target
}

export async function chooseTalkingHeadBackgroundMusic(rootPath: string) {
  const project = await ensureTalkingHeadProject(rootPath)
  const selected = await dialog.showOpenDialog({ title: '选择背景音乐', buttonLabel: '导入音乐', properties: ['openFile'], filters: [{ name: '音频', extensions: ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg'] }] })
  if (selected.canceled || !selected.filePaths[0]) return null
  const source = selected.filePaths[0]
  const extension = path.extname(source).toLowerCase() || '.mp3'
  const fileName = `背景音乐${extension}`
  const target = path.join(project.rootPath, talkingHeadMediaRelativePath('音频', fileName))
  await fs.promises.copyFile(source, target)
  const state = await loadTalkingHeadProjectState(project.rootPath)
  const backgroundMusic: TalkingHeadBackgroundMusic = { fileName, volume: state.backgroundMusic?.volume ?? 0.12 }
  await writeProjectState(project.rootPath, { ...state, backgroundMusic, updatedAt: new Date().toISOString() })
  return backgroundMusic
}

export async function saveTalkingHeadBackgroundMusic(rootPath: string, backgroundMusic?: TalkingHeadBackgroundMusic) {
  const project = await ensureTalkingHeadProject(rootPath)
  const state = await loadTalkingHeadProjectState(project.rootPath)
  if (backgroundMusic) {
    const volume = Number(backgroundMusic.volume)
    const fileName = path.basename(backgroundMusic.fileName)
    if (!fileName || !Number.isFinite(volume) || volume < 0 || volume > 0.3 || !(await fs.promises.stat(path.join(project.rootPath, talkingHeadMediaRelativePath('音频', fileName))).catch(() => null))) throw new Error('背景音乐无效')
    backgroundMusic = { fileName, volume }
  }
  await writeProjectState(project.rootPath, { ...state, backgroundMusic, updatedAt: new Date().toISOString() })
  return { backgroundMusic }
}

async function ensureTalkingHeadSoundEffects(rootPath: string) {
  await Promise.all(talkingHeadSoundEffects.map(async (effect) => {
    const target = path.join(rootPath, talkingHeadMediaRelativePath('音频', effect.fileName))
    if (await fs.promises.stat(target).catch(() => null)) return
    await fs.promises.copyFile(path.join(process.env.VITE_PUBLIC!, 'talking-head-sounds', effect.fileName), target)
  }))
}

export async function prepareTalkingHeadSoundEffects(rootPath: string) {
  const project = await ensureTalkingHeadProject(rootPath)
  await ensureTalkingHeadSoundEffects(project.rootPath)
  return talkingHeadSoundEffects
}

export async function setTalkingHeadSoundEffectsEnabled(rootPath: string, enabled: boolean) {
  const project = await ensureTalkingHeadProject(rootPath)
  const state = await loadTalkingHeadProjectState(project.rootPath)
  await writeProjectState(project.rootPath, { ...state, soundEffectsEnabled: Boolean(enabled), updatedAt: new Date().toISOString() })
  return Boolean(enabled)
}

export async function chooseTalkingHeadSource(rootPath?: string) {
  const selected = await dialog.showOpenDialog({
    title: '导入口播原视频',
    buttonLabel: '选择视频',
    properties: ['openFile'],
    filters: [
      { name: '视频', extensions: ['mp4', 'mov', 'm4v', 'mkv', 'avi', 'webm'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  })
  if (selected.canceled || !selected.filePaths[0]) return null
  const source = selected.filePaths[0]
  const durationMs = await probeVideo(source)
  const project = rootPath ? await ensureTalkingHeadProject(rootPath) : await chooseTalkingHeadProject()
  if (!project) return null
  const extension = path.extname(source).toLowerCase() || '.mp4'
  const target = path.join(project.rootPath, talkingHeadMediaRelativePath('视频', `原始口播${extension}`))
  const temporary = `${target}.${randomUUID()}.tmp`
  await fs.promises.copyFile(source, temporary, fs.constants.COPYFILE_FICLONE)
  await fs.promises.rename(temporary, target)
  const state = await loadTalkingHeadProjectState(project.rootPath)
  const fingerprint = await fileHash(target)
  await writeProjectState(project.rootPath, { ...state, updatedAt: new Date().toISOString(), source: { fileName: path.basename(target), fingerprint, durationMs }, cues: [], editPlan: undefined, highlightPlan: undefined, editPlanStale: true })
  return { rootPath: project.rootPath, name: project.name, fileName: path.basename(target), fingerprint, durationMs }
}

export async function transcribeTalkingHeadSource(rootPath: string, reportProgress: (message: string) => void) {
  const project = await ensureTalkingHeadProject(rootPath)
  const state = await loadTalkingHeadProjectState(project.rootPath)
  if (!state.source) throw new Error('请先导入口播原视频')
  const source = path.join(project.rootPath, talkingHeadMediaRelativePath('视频', state.source.fileName))
  const audio = path.join(project.rootPath, talkingHeadMediaRelativePath('视频', '原始口播.wav'))
  reportProgress('正在提取音频')
  await executeFFmpeg(['-i', source, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', audio])
  reportProgress('FunASR 正在识别字幕')
  const transcript = await transcribeAudioWithFunAsr(audio, state.source.durationMs)
  const cues = transcript.cues.map((cue) => ({ cueId: cue.cueId, startMs: cue.startMs, endMs: cue.endMs, recognizedText: cue.recognizedText, confirmedText: cue.recognizedText }))
  const docs = path.join(project.rootPath, talkingHeadMediaRelativePath('文档'))
  await Promise.all([
    fs.promises.writeFile(path.join(docs, '原始转写.json'), `${JSON.stringify(transcript, null, 2)}\n`, 'utf8'),
    fs.promises.writeFile(path.join(docs, '原始转写.srt'), funAsrCuesToSrt(transcript.cues, (cue) => cue.recognizedText), 'utf8'),
    writeProjectState(project.rootPath, { ...state, updatedAt: new Date().toISOString(), cues, editPlan: undefined, highlightPlan: undefined, editPlanStale: true }),
  ])
  reportProgress('字幕识别完成')
  return { cues }
}

export async function saveTalkingHeadCues(rootPath: string, cues: TalkingHeadCue[]) {
  const project = await ensureTalkingHeadProject(rootPath)
  validateTalkingHeadCues(cues)
  const state = await loadTalkingHeadProjectState(project.rootPath)
  const docs = path.join(project.rootPath, talkingHeadMediaRelativePath('文档'))
  const nextState = { ...state, updatedAt: new Date().toISOString(), cues, editPlan: undefined, highlightPlan: undefined, editPlanStale: true }
  await replaceFiles([
    { path: path.join(docs, '确认字幕.json'), content: `${JSON.stringify(cues, null, 2)}\n` },
    { path: path.join(docs, '确认字幕.srt'), content: funAsrCuesToSrt(cues.map((cue) => ({ ...cue, recognizedText: cue.confirmedText })), (cue) => cue.recognizedText) },
    { path: projectFile(project.rootPath), content: `${JSON.stringify(nextState, null, 2)}\n` },
  ])
  return { cues }
}

export async function saveTalkingHeadEditPlan(rootPath: string, plan: TalkingHeadEditPlan) {
  const project = await ensureTalkingHeadProject(rootPath)
  const state = await loadTalkingHeadProjectState(project.rootPath)
  if (!state.source || plan.sourceFingerprint !== state.source.fingerprint) throw new Error('原视频已更换，请重新整理结构')
  const cueIds = state.cues.map((cue) => cue.cueId)
  if (
    plan.cueIds.length !== cueIds.length ||
    new Set(plan.cueIds).size !== cueIds.length ||
    plan.cueIds.some((cueId) => !cueIds.includes(cueId)) ||
    new Set(plan.removedCueIds).size !== plan.removedCueIds.length ||
    plan.removedCueIds.some((cueId) => !cueIds.includes(cueId))
  ) throw new Error('结构编辑计划无效')
  const nextPlan = { ...plan, updatedAt: new Date().toISOString() }
  const nextState = { ...state, updatedAt: nextPlan.updatedAt, editPlan: nextPlan, editPlanStale: false }
  await replaceFiles([
    { path: path.join(project.rootPath, talkingHeadMediaRelativePath('文档', '结构编辑计划.json')), content: `${JSON.stringify(nextPlan, null, 2)}\n` },
    { path: projectFile(project.rootPath), content: `${JSON.stringify(nextState, null, 2)}\n` },
  ])
  return { plan: nextPlan }
}

export async function generateTalkingHeadEditPlanForProject(rootPath: string, textModel: TextModel, instruction: string) {
  const project = await ensureTalkingHeadProject(rootPath)
  const state = await loadTalkingHeadProjectState(project.rootPath)
  if (!state.source || !state.cues.length) throw new Error('请先确认字幕')
  const result = await generateTalkingHeadEditPlan({ textModel, instruction, cues: state.cues.map((cue) => ({ cueId: cue.cueId, text: cue.confirmedText })) })
  return saveTalkingHeadEditPlan(project.rootPath, {
    sourceFingerprint: state.source.fingerprint,
    cueIds: result.cueIds,
    removedCueIds: result.removedCueIds,
    updatedAt: new Date().toISOString(),
  })
}

export async function saveTalkingHeadHighlightPlan(rootPath: string, plan: TalkingHeadHighlightPlan) {
  const project = await ensureTalkingHeadProject(rootPath)
  const state = await loadTalkingHeadProjectState(project.rootPath)
  if (!state.source || plan.sourceFingerprint !== state.source.fingerprint) throw new Error('原视频已更换，请重新生成花字建议')
  const cuesById = new Map(state.cues.map((cue) => [cue.cueId, cue]))
  const styles = new Set(talkingHeadHighlightTemplates.map((template) => template.id))
  if (plan.items.length > 12 || new Set(plan.items.map((item) => item.cueId)).size !== plan.items.length || plan.items.some((item) => !cuesById.get(item.cueId)?.confirmedText.includes(item.phrase) || !styles.has(item.style) || (item.position && !talkingHeadHighlightPositions.includes(item.position))))
    throw new Error('花字方案无效')
  const nextPlan = { ...plan, updatedAt: new Date().toISOString() }
  const nextState = { ...state, updatedAt: nextPlan.updatedAt, highlightPlan: nextPlan }
  await replaceFiles([
    { path: path.join(project.rootPath, talkingHeadMediaRelativePath('文档', '花字方案.json')), content: `${JSON.stringify(nextPlan, null, 2)}\n` },
    { path: projectFile(project.rootPath), content: `${JSON.stringify(nextState, null, 2)}\n` },
  ])
  return { plan: nextPlan }
}

export async function generateTalkingHeadHighlightsForProject(rootPath: string, textModel: TextModel) {
  const project = await ensureTalkingHeadProject(rootPath)
  const state = await loadTalkingHeadProjectState(project.rootPath)
  if (!state.source || !state.editPlan || state.editPlanStale) throw new Error('请先确认结构整理方案')
  const removed = new Set(state.editPlan.removedCueIds)
  const cuesById = new Map(state.cues.map((cue) => [cue.cueId, cue]))
  const cues = state.editPlan.cueIds.filter((cueId) => !removed.has(cueId)).map((cueId) => cuesById.get(cueId)).filter(Boolean).map((cue) => ({ cueId: cue!.cueId, text: cue!.confirmedText }))
  const result = await generateTalkingHeadHighlights({ textModel, cues })
  if (!result.items.length) return result
  const source = path.join(project.rootPath, talkingHeadMediaRelativePath('视频', state.source.fileName))
  const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jc-highlight-'))
  try {
    const frames = await Promise.all(result.items.map(async (item) => {
      const cue = cuesById.get(item.cueId)!
      const target = path.join(temporary, `${item.cueId}.jpg`)
      await executeFFmpeg(['-ss', String(cue.startMs / 1000), '-i', source, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', '-y', target])
      return { cueId: item.cueId, image: `data:image/jpeg;base64,${await fs.promises.readFile(target, 'base64')}` }
    }))
    const placement = await chooseTalkingHeadHighlightPositions({ textModel, items: result.items, frames })
    const byCueId = new Map(placement.positions.map((item: { cueId: string; position: import('../src/runtime/talkingHeadProject.ts').TalkingHeadHighlightPosition }) => [item.cueId, item.position]))
    return { items: result.items.map((item) => ({ ...item, position: byCueId.get(item.cueId) || '左上' as const })) }
  } finally {
    await fs.promises.rm(temporary, { recursive: true, force: true })
  }
}

function escapeFfmpegFilterPath(filePath: string) {
  return filePath.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/[,\[\]]/g, '\\$&')
}

export async function composeTalkingHeadEditPlan(rootPath: string, options: TalkingHeadComposeOptions, reportProgress: (message: string) => void) {
  if (!options || !['source', '9:16'].includes(options.ratio) || typeof options.burnSubtitles !== 'boolean') throw new Error('成片设置无效')
  const project = await ensureTalkingHeadProject(rootPath)
  const state = await loadTalkingHeadProjectState(project.rootPath)
  if (!state.source || !state.editPlan || state.editPlanStale || state.editPlan.sourceFingerprint !== state.source.fingerprint)
    throw new Error('请先确认并保存结构整理方案')

  const cuesById = new Map(state.cues.map((cue) => [cue.cueId, cue]))
  const cues = state.editPlan.cueIds
    .filter((cueId) => !state.editPlan!.removedCueIds.includes(cueId))
    .map((cueId) => cuesById.get(cueId))
  if (!cues.length || cues.some((cue) => !cue)) throw new Error('没有可生成的口播片段')

  const source = path.join(project.rootPath, talkingHeadMediaRelativePath('视频', state.source.fileName))
  const output = path.join(project.rootPath, talkingHeadMediaRelativePath('视频', '口播剪辑成片.mp4'))
  const subtitlePath = path.join(project.rootPath, talkingHeadMediaRelativePath('文档', '成片字幕.ass'))
  const sourceSize = await probeVideoSize(source)
  const filters = cues.flatMap((cue, index) => {
    const start = cue!.startMs / 1000
    const end = cue!.endMs / 1000
    return [
      `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${index}]`,
      `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,aresample=48000[a${index}]`,
    ]
  })
  filters.push(`${cues.map((_, index) => `[v${index}][a${index}]`).join('')}concat=n=${cues.length}:v=1:a=1[vout][aout]`)
  const subtitleCues = cues.reduce<Array<{ cueId: string; startMs: number; endMs: number; text: string }>>((timeline, cue) => {
    const startMs = timeline.at(-1)?.endMs || 0
    timeline.push({ cueId: cue!.cueId, startMs, endMs: startMs + cue!.endMs - cue!.startMs, text: cue!.confirmedText })
    return timeline
  }, [])
  const subtitleStyle = normalizeTalkingHeadSubtitleStyle(options.subtitleStyle)
  const highlights = state.highlightPlan?.sourceFingerprint === state.source.fingerprint
    ? state.highlightPlan.items.map((item) => ({ ...item, style: item.style === '爆点黄' ? '爆点黄' as const : '结论绿' as const }))
    : []
  if (options.burnSubtitles) await fs.promises.writeFile(subtitlePath, formatTalkingHeadAss(subtitleCues, options.ratio === '9:16' ? { width: 1080, height: 1920 } : sourceSize, subtitleStyle, highlights), 'utf8')
  if (options.ratio === '9:16') {
    filters.push('[vout]split[foreground][background]')
    filters.push('[background]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:10[blurred]')
    filters.push('[foreground]scale=1080:1920:force_original_aspect_ratio=decrease[centered]')
    filters.push('[blurred][centered]overlay=(W-w)/2:(H-h)/2[framed]')
  }
  const pictureInput = options.ratio === '9:16' ? '[framed]' : '[vout]'
  filters.push(options.burnSubtitles
    ? `${pictureInput}subtitles=filename='${escapeFfmpegFilterPath(subtitlePath)}',format=yuv420p[video]`
    : `${pictureInput}format=yuv420p[video]`)

  const durationSeconds = subtitleCues.at(-1)!.endMs / 1000
  const music = state.backgroundMusic
  if (music) filters.push(`[1:a]atrim=duration=${durationSeconds},volume=${music.volume},aresample=48000[bgm]`, `[aout][bgm]amix=inputs=2:duration=first:dropout_transition=0[mixed]`)
  const soundEvents = state.soundEffectsEnabled !== false ? highlights.map((item) => ({ item, cue: subtitleCues.find((cue) => cue.cueId === item.cueId) })).filter((event) => event.cue).filter((event, index, events) => index === 0 || event.cue!.startMs - events[index - 1].cue!.startMs >= 1200) : []
  if (soundEvents.length) {
    await ensureTalkingHeadSoundEffects(project.rootPath)
    const audioStart = music ? 2 : 1
    soundEvents.forEach((event, index) => filters.push(`[${audioStart + index}:a]adelay=${event.cue!.startMs}|${event.cue!.startMs},volume=0.5[fx${index}]`))
    filters.push(`[${music ? 'mixed' : 'aout'}]${soundEvents.map((_, index) => `[fx${index}]`).join('')}amix=inputs=${soundEvents.length + 1}:duration=first:dropout_transition=0[mixedfx]`)
  }
  reportProgress('正在按确认顺序拼接视频…')
  await executeFFmpeg([
    '-i', source,
    ...(music ? ['-stream_loop', '-1', '-i', path.join(project.rootPath, talkingHeadMediaRelativePath('音频', music.fileName))] : []),
    ...soundEvents.flatMap((event) => ['-i', path.join(project.rootPath, talkingHeadMediaRelativePath('音频', talkingHeadSoundEffects.find((effect) => effect.style === event.item.style)!.fileName))]),
    '-filter_complex', filters.join(';'),
    '-map', '[video]', '-map', soundEvents.length ? '[mixedfx]' : music ? '[mixed]' : '[aout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', output,
  ], { onProgress: (progress) => reportProgress(`正在生成成片… ${progress}%`) })
  await replaceFiles([
    { path: path.join(project.rootPath, talkingHeadMediaRelativePath('文档', '字幕样式.json')), content: `${JSON.stringify(subtitleStyle, null, 2)}\n` },
    { path: projectFile(project.rootPath), content: `${JSON.stringify({ ...state, subtitleStyle, updatedAt: new Date().toISOString() }, null, 2)}\n` },
  ])
  reportProgress('成片已生成')
  return { fileName: '口播剪辑成片.mp4' }
}

export async function calibrateTalkingHeadCues(rootPath: string, textModel: TextModel, instruction: string) {
  const project = await ensureTalkingHeadProject(rootPath)
  const state = await loadTalkingHeadProjectState(project.rootPath)
  const result = await calibrateTalkingHeadSubtitles({ textModel, instruction, cues: state.cues.map((cue) => ({ cueId: cue.cueId, text: cue.confirmedText })) })
  const record = { createdAt: new Date().toISOString(), instruction, suggestions: result.subtitles }
  await fs.promises.writeFile(path.join(project.rootPath, talkingHeadMediaRelativePath('文档', '字幕校准记录.json')), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return record
}

export async function restoreTalkingHeadRecognizedCues(rootPath: string) {
  const project = await ensureTalkingHeadProject(rootPath)
  const rawPath = path.join(project.rootPath, talkingHeadMediaRelativePath('文档', '原始转写.json'))
  const raw = JSON.parse(await fs.promises.readFile(rawPath, 'utf8')) as { cues?: Array<{ cueId: string; startMs: number; endMs: number; recognizedText: string }> }
  if (!raw.cues?.length) throw new Error('没有可恢复的 FunASR 原始转写')
  const cues = raw.cues.map((cue) => ({ ...cue, confirmedText: cue.recognizedText }))
  return saveTalkingHeadCues(project.rootPath, cues)
}

export async function chooseTalkingHeadProject() {
  const result = await dialog.showOpenDialog({
    title: '选择或新建口播剪辑项目文件夹',
    buttonLabel: '用此文件夹创建项目',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || !result.filePaths[0]) return null
  return ensureTalkingHeadProject(result.filePaths[0])
}

export async function showTalkingHeadProject(rootPath: string) {
  const project = await ensureTalkingHeadProject(rootPath)
  return shell.openPath(project.rootPath)
}

export async function showTalkingHeadOutput(rootPath: string) {
  const project = await ensureTalkingHeadProject(rootPath)
  return shell.openPath(path.join(project.rootPath, talkingHeadMediaRelativePath('视频')))
}
