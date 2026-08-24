import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { app, dialog, shell } from 'electron'
import { executeFFmpeg, getFFmpegPath } from './ffmpeg/index.ts'
import { analyzeFilmBreakdownClip, generateFilmBreakdownAssetPrompt, generateFilmBreakdownImagePrompt, generateFilmBreakdownVideoOverview, hasApiKey, identifyFilmBreakdownAssets } from './talking-head-cloud.ts'
import { chooseFilmBreakdownDetectionCuts, filmBreakdownFrameTimestamp, formatFilmBreakdownCompletePrompts, formatFilmBreakdownImageDocument, formatFilmBreakdownMarkdown, formatFilmBreakdownVideoDocument, mergeFilmBreakdownAssetResults, normalizeFilmBreakdownAssets, normalizeFilmBreakdownVideoOverview, normalizeFilmBreakdownVideoTemplates, selectFilmBreakdownAssetReferences, shotsFromSceneCuts, validateFilmBreakdownShots, type FilmBreakdownAssetCategory, type FilmBreakdownFramePosition, type FilmBreakdownProjectState, type FilmBreakdownShot, type FilmBreakdownVideoOverview, type FilmBreakdownVideoTemplate } from '../src/runtime/filmBreakdown.ts'
import { talkingHeadMediaDirectories, talkingHeadMediaRelativePath } from '../src/runtime/talkingHeadProject.ts'
import { buildOnlineVideoDownloadArgs, isPathInside, validateOnlineVideoUrl } from '../src/runtime/onlineVideoImport.ts'
import type { TextModel } from './types.ts'

const allowedRoots = new Set<string>()
const analysisControllers = new Map<string, AbortController>()
let sourceDownloadController: AbortController | undefined
const framePositions: FilmBreakdownFramePosition[] = ['start', 'middle', 'end']
const videoPromptInstructions: Record<FilmBreakdownVideoTemplate, string> = {
  'video-prompt': `只输出当前镜头的一条可直接用于视频生成的中文提示词正文，不要解释、标题说明、代码块或 JSON 之外的文字。严格使用以下固定格式，并保持字段顺序：
镜头N（起始秒至结束秒）功能标签
特效：无；有速度、时间或物理特效时写清变化过程
摄影：景别，机位高度，拍摄角度
运动：镜头运动方式，运动特征
动作：主体表演、环境反应、物理细节。情绪/意图
SFX：环境音、动作音、情绪音和特殊音效；听不见的内容不要虚构
对白语言：仅在确有对白时填写语言类型
对白：仅在确有对白时填写角色、声音特征和原话；无对白时省略这两行
出口：画面出口、动作出口、声音出口
（转场类型到，转场承接说明）

硬性要求：
- 镜头标题中的起始秒和结束秒必须使用用户提供的精确时间，不得猜测；功能标签仅在能从当前镜头判断时填写。
- 摄影必须同时包含景别、机位高度、拍摄角度；运动必须同时包含方式和运动特征。
- 动作必须写主体表演、环境反应、接触/重量/惯性等可见物理细节，以及一句情绪或意图。
- 出口和转场必须紧跟在动作与声音之后；根据当前镜头真实结束状态选择硬切到、动作相位切到、L型声音延续到、遮挡擦拭到、匹配剪接到或其他规范转场。
- 只描述视频中真实可见、可听的内容；无法确认的人物身份、对白、声音、资产编号和画外信息不得虚构。没有特效就写“特效：无”，没有对白就省略对白字段。`,
  script: `将当前短视频反推为中文剧本，只输出剧本正文，不要解释、代码块或分析过程。严格使用以下格式：
#第X集
## 场X-Y
时间：具体时段，如黄昏
场景：[[wiki/场景/场景名]]
人物：[[wiki/角色/角色名]]（有动作或台词的次要人物用甲、乙、丙标注）
道具：[[wiki/道具/关键道具名]]

△ 场景描述或动作描述

角色名（情绪）："台词"
△ 动作描述

规则：
- △ 只用于叙述、动作和描写，每行独立。
- 不同人物的台词各占一行。
- OS 表示内心独白，VO 表示画外音。
- 闪回使用【闪回开始】和【闪回结束】包围。
- 场景转换时新建一场，单集通常 1-3 场、500-1200 字，单场通常 200-400 字。
- 第 8-10 集设置第一个付费卡点，之后每 20 集设置一个，并在对应集末尾标注【付费卡点】。
- 当前输入是一个已切分镜头，只还原视频中真实可见、可听的信息；无法从画面确定的集号、场号用 X 占位，未知专名使用稳定的可见特征命名。
- 不得为了达到建议字数补写不存在的剧情、台词、人物、道具或付费卡点。无对白时不创造对白；非关键普通陈设不列为道具。`,
}
const imagePromptInstruction = `只输出一条可直接用于生图的中文提示词正文，不要输出分析过程、标题、解释、代码块或结构化数据。\n画幅和布局放最前面；精确文字使用引号并保留原文；有主要人物时必须描述国别、年龄段、五官和发型；用 5-12 个具体物件建立场景密度；材质、光线、调色板分开写；风格锚点必须具体；写明焦段、光圈、角度等相机语境；复杂场景按环境、主体、材质、光线和渲染目标组织；海报类写明信息层级和远处可读；最后加针对画面的否定约束。没有在图中看到的信息不得凭空补充。`
const assetPromptInstructions: Record<FilmBreakdownAssetCategory, string> = {
  character: `综合所有参考图，只输出一条可直接用于生图的中文三视图角色设定参考图提示词，不要解释、标题或代码块。使用有参考图版，严格生成 16:9 横向画面，等分为三个并排竖直分格，格间使用干净纤细的分隔线；三格必须是同一角色、同一套造型，严格保持参考图的面部、发型发色、身材比例、服装和配饰一致。

左格：0° 正面无头全身。身体正对镜头，从肩部以下到脚部完整入镜，双臂自然垂放身侧、双手放松张开、双脚均匀承重；头部和头发完全不存在，不得有任何东西高出肩线或垂落到胸前，颈部在喉咙根部以干净平整清晰的水平切口收束，如无头人台模特；切口之上只有空白背景，肩线上方保留与正常全身像一致的头顶留白。不得出现血迹、解剖细节、烟雾、残影、透明或消散效果。

中格：180° 正后方带头全身。同一角色从正后方拍摄，站姿笔直，头发从背后自然垂落，后脑轮廓、服装背面结构、裙摆或裤型、配饰和鞋履清晰可见；双臂自然垂放、双手放松、双脚均匀承重，从头顶到鞋子完整入镜。

右格：约 35° 左或右前方斜侧齐胸大特写，作为身份锁定主锚点。相机位于人物一侧前方约 30° 至 35°，人物肩线、胸口和头部向相反方向整体转动约 30° 至 35°，不得是完全对称正面；从头顶略上方到锁骨、仅露出服装最上缘，脸部占画面大部分。近侧脸轮廓、远侧眼睛、鼻梁侧向线条、颧骨转折、下颌线、耳部或耳侧发际线必须清晰可辨；头部保持水平，双眼看向镜头附近或回看镜头，双唇闭合放松。把参考图中可见的眉眼、鼻梁、唇形、虹膜、疤痕、痣、耳饰、发饰等身份特征在本格再次点名。

三格统一背景与摄影：平坦均匀的 18% 中灰无缝背景，单一色值，无渐变和衰减；无方向无阴影的正面照明，四周补光均匀，无主光侧、轮廓光、边缘光、背景投影和脚下接触阴影，三格曝光、白平衡、光照完全一致。真实照片级质感，真实人类和真实相机拍摄，清晰毛孔、发丝和织物纹理，保留自然皮肤质感与轻微胶片颗粒，绝非塑料感、渲染感、CGI、AI 磨皮或过度平滑。

参考图没有覆盖的角度只做身份一致性延伸；多个角度或景别冲突时，以多数参考图和最清晰的身份特写为准。`,
  scene: `综合所有参考图中同一场景的不同机位，只输出一条可直接用于生图的中文场景空镜提示词，不要标题、解释或代码块。严格按以下顺序组织：
1. 第一行写年代、地点、时间状态和固定机位：默认使用“3/4斜角俯拍视角”，明确相机位于空间一侧前上方约30°至45°、机位略高于主体并向下俯拍；只有当多数清晰参考图明确显示其他机位时才按参考图修正，不得自行改成平视正面。
2. 先还原稳定的空间结构、各区域相对方位、入口出口、主要视线关系和纵深，再按“前景 / 中景 / 远景”分层描述建筑、家具、陈设、地面和自然环境；同一物件只写一次，不把单张参考图的透视错误当成真实结构。
3. 单独写天空或天花板，以及环境上方的空间延伸；写清材质、年代痕迹、磨损、使用痕迹和符合时代的建筑与陈设，不凭空加入参考图没有的时代符号。
4. 写清光源方向、主次光关系、色温、光线软硬、空气介质、对比度、色彩、胶片或数字摄影质感和整体情绪氛围；相机语境至少给出真实焦段或俯拍高度感。
5. 结尾必须写“电影级质感，纯空镜无人物”，并补充针对画面的否定约束：不要人物、人体局部、群演、现代违和物、重复物件、错误透视、漂浮物体、CGI塑料感或虚假文字。`,
  prop: `综合所有参考图，只输出一条可直接用于生图的中文道具参考图提示词，不要解释、标题或代码块。先判断道具复杂度：武器、机械、交通工具、复杂工具和需要跨镜头长期复用的核心道具，严格使用六视图版本；老照片、信件、票据等平面文件，使用简化三图版本。

六视图版本：生成 16:9 横向 4K 道具转面参考图，六个视图固定采用干净的 3×2 网格、均匀间距、统一比例和清晰标签；六格是同一个静止实物，只有相机改变位置。按以下顺序写：
SHEET：16:9、4K、3×2 网格、统一道具比例、视图下方标签。
MEDIUM：真实实物摄影或与原片一致的摄影媒介、相机/镜头、细节解析、微反差和材质还原。
OBJECT：年代风格、道具名称、整体结构、形状、组件关系、方向；写整体长宽高/厚度和关键组件尺寸，优先使用厘米或毫米；分开写主体与组件材质、颜色、连接方式、表面光泽、纹理、反光、铸造或加工痕迹；写固定磨损、污渍、划痕、折痕、变形的准确位置、形态、颜色、程度和材质反应；指定一个跨视图可识别的方向锚点。
SCENE：统一摄影棚背景颜色和材质、地面关系、道具与地面的接触方式、每格接触阴影的范围和软硬；主体单独呈现，不出现人物手或其他物件。
LIGHT：按主光 key、补光 fill、轮廓光 rim、统一白平衡 note 描述方向、软硬、强度和阴影开放程度，六格灯光、曝光和白平衡完全一致，优先准确读取材质。
LOOK：目录级调色，主体与背景分离；写焦段、光圈、景深、锐度、颗粒、真实摄影质感和统一媒介。
VIEWS：front 正面平视；back 正面相反方向 180°；left 左侧 90°；right 右侧 90°；top 沿道具垂直轴正上方俯视；bottom 沿垂直轴正下方仰视。每个视图必须写对应轮廓、结构、组件、固定磨损和方向锚点，并使用清晰的 FRONT VIEW、BACK VIEW、LEFT VIEW、RIGHT VIEW、TOP VIEW、BOTTOM VIEW 标签。
SHEET_GRAPHICS：左上角写道具英文名称，下面写 PROP TURNAROUND — 6 VIEWS；标签使用统一小号无衬线字体，4K 下字形清晰可读，不生成乱码。
CONSISTENCY_LOCK：六个视图必须是同一个单一道具，比例、结构、材质、颜色、组件、固定磨损和方向坐标完全一致；道具保持静止，只改变相机位置；背景、地面、接触阴影、灯光、媒介、白平衡、曝光和镜头保持一致。

简化三图版本：针对老照片、信件、票据等平面文件，写明年代风格、名称、纸张/金属等具体材质、尺寸规格、新旧程度和主要特征；分别写正面文字/图案/装饰、背面结构与文字、侧面或特写的厚度/边缘/磨损；最后写摄影类型、布光、统一背景和色调。所有文字必须来自参考图，无法确认的内容不得虚构。`,
}

function stateFile(rootPath: string) { return path.join(rootPath, talkingHeadMediaRelativePath('文档', '拉片项目.json')) }
function markdownFile(rootPath: string) { return path.join(rootPath, talkingHeadMediaRelativePath('文档', '影片拉片.md')) }

async function hashFile(filePath: string) {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function inspectVideo(filePath: string) {
  const { stderr } = await executeFFmpeg(['-hide_banner', '-i', filePath, '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-'])
  const duration = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  const durationMs = duration ? Math.round((Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])) * 1000) : 0
  if (!durationMs) throw new Error('上传文件不是可读取的视频')
  return durationMs
}

function fallbackState(rootPath: string): FilmBreakdownProjectState {
  const now = new Date().toISOString()
  return { schemaVersion: 1, name: path.basename(rootPath), createdAt: now, updatedAt: now, detectionThreshold: .3, boundariesConfirmed: false, shots: [], imageAssets: [] }
}

async function writeState(rootPath: string, state: FilmBreakdownProjectState) {
  const next = { ...state, updatedAt: new Date().toISOString() }
  const files = [
    { target: stateFile(rootPath), content: `${JSON.stringify(next, null, 2)}\n` },
    { target: markdownFile(rootPath), content: formatFilmBreakdownMarkdown(next) },
  ]
  const temporary = files.map((file) => `${file.target}.${randomUUID()}.tmp`)
  try {
    await Promise.all(files.map(async (file, index) => {
      await fs.promises.mkdir(path.dirname(file.target), { recursive: true })
      await fs.promises.writeFile(temporary[index], file.content, 'utf8')
    }))
    for (let index = 0; index < files.length; index++) await fs.promises.rename(temporary[index], files[index].target)
  } finally {
    await Promise.all(temporary.map((file) => fs.promises.rm(file, { force: true })))
  }
  return next
}

export async function ensureFilmBreakdownProject(rootPath: string) {
  const root = path.resolve(rootPath)
  if (!(await fs.promises.stat(root)).isDirectory()) throw new Error('项目文件夹不可用')
  allowedRoots.add(root)
  await Promise.all(talkingHeadMediaDirectories.map((directory) => fs.promises.mkdir(path.join(root, talkingHeadMediaRelativePath(directory)), { recursive: true })))
  if (!(await fs.promises.stat(stateFile(root)).catch(() => null))) await writeState(root, fallbackState(root))
  return { rootPath: root, name: path.basename(root) }
}

export async function loadFilmBreakdownProject(rootPath: string) {
  const project = await ensureFilmBreakdownProject(rootPath)
  const parsed = JSON.parse(await fs.promises.readFile(stateFile(project.rootPath), 'utf8')) as FilmBreakdownProjectState
  const state: FilmBreakdownProjectState = {
    ...fallbackState(project.rootPath),
    ...parsed,
    shots: Array.isArray(parsed.shots) ? parsed.shots.map((shot) => ({
      ...shot,
      frameFileNames: shot.frameFileNames || (shot.frameFileName ? { middle: shot.frameFileName } : undefined),
      imagePrompts: shot.imagePrompts || (shot.imagePrompt ? { middle: shot.imagePrompt } : undefined),
      videoResults: { ...(shot.videoPrompt ? { 'video-prompt': shot.videoPrompt } : {}), ...shot.videoResults },
      ...(shot.analysisStatus === 'running' ? { analysisStatus: 'pending' as const } : {}),
    })) : [],
    imageAssets: Array.isArray(parsed.imageAssets) ? parsed.imageAssets.map((asset) => asset.status === 'running' ? { ...asset, status: 'pending' as const } : asset) : [],
  }
  if (state.source && state.shots.length) validateFilmBreakdownShots(state.shots, state.source.durationMs)
  if (state.boundariesConfirmed && state.shots.some((shot) => framePositions.some((position) => !shot.frameFileNames?.[position] || !fs.existsSync(path.join(project.rootPath, talkingHeadMediaRelativePath('图片', shot.frameFileNames[position]!)))))) state.boundariesConfirmed = false
  return state
}

export async function chooseFilmBreakdownProject() {
  const result = await dialog.showOpenDialog({ title: '选择或新建影片拉片项目文件夹', buttonLabel: '用此文件夹创建项目', properties: ['openDirectory', 'createDirectory'] })
  return result.canceled || !result.filePaths[0] ? null : ensureFilmBreakdownProject(result.filePaths[0])
}

export async function chooseFilmBreakdownSource(rootPath?: string) {
  const selected = await dialog.showOpenDialog({ title: '导入拉片原视频', buttonLabel: '选择视频', properties: ['openFile'], filters: [{ name: '视频', extensions: ['mp4', 'mov', 'm4v', 'mkv', 'avi', 'webm'] }] })
  if (selected.canceled || !selected.filePaths[0]) return null
  const project = rootPath ? await ensureFilmBreakdownProject(rootPath) : await chooseFilmBreakdownProject()
  if (!project) return null
  return importFilmBreakdownSource(project.rootPath, selected.filePaths[0])
}

export async function importFilmBreakdownSource(rootPath: string, source: string) {
  const project = await ensureFilmBreakdownProject(rootPath)
  const durationMs = await inspectVideo(source)
  const extension = path.extname(source).toLowerCase() || '.mp4'
  const target = path.join(project.rootPath, talkingHeadMediaRelativePath('视频', `拉片原片${extension}`))
  const temporary = `${target}.${randomUUID()}.tmp`
  await fs.promises.copyFile(source, temporary, fs.constants.COPYFILE_FICLONE)
  await fs.promises.rename(temporary, target)
  const state = await loadFilmBreakdownProject(project.rootPath)
  const fingerprint = await hashFile(target)
  await Promise.all([
    fs.promises.rm(path.join(project.rootPath, talkingHeadMediaRelativePath('视频', '拉片分析片段')), { recursive: true, force: true }),
    fs.promises.rm(path.join(project.rootPath, talkingHeadMediaRelativePath('图片', '拉片中间帧')), { recursive: true, force: true }),
    fs.promises.rm(path.join(project.rootPath, talkingHeadMediaRelativePath('图片', '拉片帧')), { recursive: true, force: true }),
  ])
  await writeState(project.rootPath, { ...state, source: { fileName: path.basename(target), fingerprint, durationMs }, shots: [], imageAssets: [], videoOverview: undefined, boundariesConfirmed: false })
  return { ...project, fileName: path.basename(target), fingerprint, durationMs }
}

function ytDlpExecutable() {
  const fileName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
  const root = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'runtime')
  return path.join(root, 'yt-dlp', process.platform, fileName)
}

function runYtDlp(args: string[], signal: AbortSignal, reportProgress: (message: string) => void) {
  return new Promise<string>((resolve, reject) => {
    const executable = ytDlpExecutable()
    if (!fs.existsSync(executable)) return reject(new Error('内置视频下载组件不可用，请重新安装应用'))
    const child = spawn(executable, args, { env: process.env, shell: false })
    let stdout = ''
    let stderr = ''
    const abort = () => child.kill('SIGTERM')
    const collect = (chunk: Buffer, target: 'stdout' | 'stderr') => {
      const text = chunk.toString()
      if (target === 'stdout') stdout += text
      else stderr += text
      const percent = text.match(/\[download\]\s+([\d.]+)%/)?.[1]
      if (percent) reportProgress(`正在下载… ${percent}%`)
    }
    child.stdout.on('data', (chunk) => collect(chunk, 'stdout'))
    child.stderr.on('data', (chunk) => collect(chunk, 'stderr'))
    child.on('error', (error) => reject(new Error(`无法启动视频下载组件：${error.message}`)))
    child.on('close', (code) => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) return reject(new Error('下载已停止'))
      if (code !== 0) {
        if (/live video|is_live/i.test(stderr)) return reject(new Error('暂不支持直播链接'))
        if (/cookies|sign in|login/i.test(stderr)) return reject(new Error('该视频需要登录，当前仅支持公开视频'))
        return reject(new Error('视频下载失败，请检查链接和网络后重试'))
      }
      resolve(stdout)
    })
    signal.addEventListener('abort', abort, { once: true })
  })
}

export async function downloadFilmBreakdownSource(rootPath: string, rawUrl: string, reportProgress: (message: string) => void) {
  if (sourceDownloadController) throw new Error('已有视频正在下载')
  const url = validateOnlineVideoUrl(rawUrl)
  const project = await ensureFilmBreakdownProject(rootPath)
  const temporaryDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jc-film-download-'))
  const controller = new AbortController()
  sourceDownloadController = controller
  try {
    reportProgress('正在解析视频链接…')
    const output = await runYtDlp(buildOnlineVideoDownloadArgs(temporaryDirectory, url, getFFmpegPath()), controller.signal, reportProgress)
    const candidates = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse()
    const downloaded = candidates.find((candidate) => isPathInside(temporaryDirectory, candidate) && fs.existsSync(candidate))
    if (!downloaded) throw new Error('视频下载失败，未找到下载文件')
    const [realDirectory, realDownloaded] = await Promise.all([fs.promises.realpath(temporaryDirectory), fs.promises.realpath(downloaded)])
    if (!isPathInside(realDirectory, realDownloaded)) throw new Error('视频下载结果路径无效')
    reportProgress('下载完成，正在导入原片…')
    return await importFilmBreakdownSource(project.rootPath, realDownloaded)
  } finally {
    if (sourceDownloadController === controller) sourceDownloadController = undefined
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true })
  }
}

export function stopFilmBreakdownSourceDownload() {
  sourceDownloadController?.abort()
}

export async function detectFilmBreakdownShots(rootPath: string, threshold: number, reportProgress: (message: string) => void) {
  const project = await ensureFilmBreakdownProject(rootPath)
  const state = await loadFilmBreakdownProject(project.rootPath)
  if (!state.source) throw new Error('请先导入拉片原视频')
  if (![.2, .3, .4].includes(threshold)) throw new Error('切镜灵敏度无效')
  reportProgress('FFmpeg 正在检测镜头边界…')
  const source = path.join(project.rootPath, talkingHeadMediaRelativePath('视频', state.source.fileName))
  const detect = async (value: number) => {
    const { stderr } = await executeFFmpeg(['-hide_banner', '-i', source, '-vf', `select=gt(scene\\,${value}),showinfo`, '-an', '-f', 'null', '-'])
    return [...stderr.matchAll(/pts_time:([0-9.]+)/g)].map((match) => Number(match[1]) * 1000)
  }
  const primaryCuts = await detect(threshold)
  let cuts = primaryCuts
  if (!primaryCuts.length && state.source.durationMs <= 30_000) {
    reportProgress('短片未检出明显硬切，正在进行敏感补检…')
    cuts = chooseFilmBreakdownDetectionCuts(primaryCuts, await detect(.12), state.source.durationMs)
  }
  const shots = shotsFromSceneCuts(cuts, state.source.durationMs, cuts === primaryCuts ? 120 : 500)
  await writeState(project.rootPath, { ...state, detectionThreshold: threshold, boundariesConfirmed: false, shots, imageAssets: [], videoOverview: undefined })
  reportProgress(`镜头检测完成，共 ${shots.length} 镜`)
  return { shots }
}

export async function saveFilmBreakdownShots(rootPath: string, shots: FilmBreakdownShot[]) {
  const project = await ensureFilmBreakdownProject(rootPath)
  const state = await loadFilmBreakdownProject(project.rootPath)
  if (!state.source) throw new Error('请先导入拉片原视频')
  validateFilmBreakdownShots(shots, state.source.durationMs)
  const next = await writeState(project.rootPath, { ...state, boundariesConfirmed: false, shots, imageAssets: [], videoOverview: undefined })
  return { shots: next.shots }
}

async function renderShotAssets(rootPath: string, state: FilmBreakdownProjectState, shot: FilmBreakdownShot) {
  const source = path.join(rootPath, talkingHeadMediaRelativePath('视频', state.source!.fileName))
  const stem = `${shot.shotId}-${shot.startMs}-${shot.endMs}`
  const clipFileName = `拉片分析片段/${stem}.mp4`
  const frameFileName = `拉片中间帧/${stem}.jpg`
  const frameFileNames = Object.fromEntries(framePositions.map((position) => [position, `拉片帧/${stem}-${position}.jpg`])) as Record<FilmBreakdownFramePosition, string>
  const clip = path.join(rootPath, talkingHeadMediaRelativePath('视频', clipFileName))
  const frame = path.join(rootPath, talkingHeadMediaRelativePath('图片', frameFileName))
  const frameDirectory = path.dirname(path.join(rootPath, talkingHeadMediaRelativePath('图片', frameFileNames.start)))
  await Promise.all([fs.promises.mkdir(path.dirname(clip), { recursive: true }), fs.promises.mkdir(path.dirname(frame), { recursive: true }), fs.promises.mkdir(frameDirectory, { recursive: true })])
  const start = shot.startMs / 1000
  const duration = (shot.endMs - shot.startMs) / 1000
  await executeFFmpeg(['-ss', String(start), '-i', source, '-t', String(duration), '-map', '0:v:0', '-map', '0:a?', '-vf', 'scale=720:-2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-y', clip])
  await executeFFmpeg(['-ss', String((shot.startMs + shot.endMs) / 2000), '-i', source, '-frames:v', '1', '-vf', 'scale=720:-2', '-q:v', '4', '-y', frame])
  for (const position of framePositions) {
    const target = path.join(rootPath, talkingHeadMediaRelativePath('图片', frameFileNames[position]))
    await executeFFmpeg(['-ss', String(filmBreakdownFrameTimestamp(shot, position) / 1000), '-i', source, '-frames:v', '1', '-vf', 'scale=720:-2', '-q:v', '4', '-y', target])
    if (!fs.existsSync(target)) throw new Error(`${shot.shotId} ${position}帧提取失败`)
  }
  return { ...shot, clipFileName, frameFileName, frameFileNames, imagePrompts: shot.imagePrompts || {}, analysisStatus: 'pending' as const, error: undefined }
}

export async function confirmFilmBreakdownShots(rootPath: string, reportProgress: (message: string) => void) {
  const project = await ensureFilmBreakdownProject(rootPath)
  let state = await loadFilmBreakdownProject(project.rootPath)
  if (!state.source) throw new Error('请先导入拉片原视频')
  validateFilmBreakdownShots(state.shots, state.source.durationMs)
  for (let index = 0; index < state.shots.length; index++) {
    const shot = state.shots[index]
    const clipExists = shot.clipFileName && await fs.promises.stat(path.join(project.rootPath, talkingHeadMediaRelativePath('视频', shot.clipFileName))).catch(() => null)
    const framesExist = framePositions.every((position) => shot.frameFileNames?.[position] && fs.existsSync(path.join(project.rootPath, talkingHeadMediaRelativePath('图片', shot.frameFileNames[position]!))))
    if (clipExists && framesExist) continue
    reportProgress(`正在生成分析片段 ${index + 1}/${state.shots.length}`)
    state.shots[index] = await renderShotAssets(project.rootPath, state, shot)
    state = await writeState(project.rootPath, state)
  }
  state = await writeState(project.rootPath, { ...state, boundariesConfirmed: true })
  reportProgress('镜头切分已确认')
  return { shots: state.shots }
}

export async function saveFilmBreakdownPrompt(rootPath: string, shotId: string, videoPrompt: string, imagePrompt: string) {
  const project = await ensureFilmBreakdownProject(rootPath)
  const state = await loadFilmBreakdownProject(project.rootPath)
  const index = state.shots.findIndex((shot) => shot.shotId === shotId)
  if (index < 0) throw new Error('镜头不存在')
  state.shots[index] = { ...state.shots[index], videoPrompt: String(videoPrompt), videoResults: { ...state.shots[index].videoResults, 'video-prompt': String(videoPrompt) }, imagePrompt: String(imagePrompt) }
  await writeState(project.rootPath, { ...state, videoOverview: undefined })
  return state.shots[index]
}

export async function saveFilmBreakdownVideoResult(rootPath: string, shotId: string, template: FilmBreakdownVideoTemplate, prompt: string) {
  const project = await ensureFilmBreakdownProject(rootPath)
  const state = await loadFilmBreakdownProject(project.rootPath)
  const index = state.shots.findIndex((shot) => shot.shotId === shotId)
  if (index < 0 || !['video-prompt', 'script'].includes(template)) throw new Error('视频分析结果不存在')
  state.shots[index] = { ...state.shots[index], videoResults: { ...state.shots[index].videoResults, [template]: String(prompt) }, ...(template === 'video-prompt' ? { videoPrompt: String(prompt) } : {}) }
  await writeState(project.rootPath, { ...state, ...(template === 'video-prompt' ? { videoOverview: undefined } : {}) })
  return state.shots[index]
}

async function readFrame(rootPath: string, fileName: string) {
  const frame = await fs.promises.readFile(path.join(rootPath, talkingHeadMediaRelativePath('图片', fileName)))
  return `data:image/jpeg;base64,${frame.toString('base64')}`
}

function startAnalysis(rootPath: string) {
  const controller = new AbortController()
  analysisControllers.get(rootPath)?.abort()
  analysisControllers.set(rootPath, controller)
  return controller
}

export async function identifyFilmBreakdownProjectAssets(rootPath: string, textModel: TextModel, reportProgress: (message: string) => void) {
  const project = await ensureFilmBreakdownProject(rootPath)
  let state = await loadFilmBreakdownProject(project.rootPath)
  if (!state.source || !state.boundariesConfirmed) throw new Error('请先确认镜头切分')
  if (!(await hasApiKey())) throw new Error('请先配置韭菜盒子 API Key')
  const controller = startAnalysis(project.rootPath)
  try {
    const frames = []
    for (const shot of state.shots) for (const position of framePositions) {
      const fileName = shot.frameFileNames?.[position]
      if (!fileName) throw new Error(`${shot.shotId} 缺少${position}帧`)
      frames.push({ shotId: shot.shotId, position, image: await readFrame(project.rootPath, fileName) })
    }
    reportProgress(`Gemini 正在识别 ${frames.length} 张画面中的资产…`)
    const result = await identifyFilmBreakdownAssets({ textModel, frames, signal: controller.signal })
    state = await writeState(project.rootPath, { ...state, imageAssets: mergeFilmBreakdownAssetResults(normalizeFilmBreakdownAssets(result.assets as any[], state.shots), state.imageAssets) })
    reportProgress(`资产分析完成，识别到 ${state.imageAssets?.length || 0} 项`)
    return { assets: state.imageAssets || [] }
  } finally { analysisControllers.delete(project.rootPath) }
}

export async function saveFilmBreakdownAssetSelection(rootPath: string, selectedIds: string[]) {
  const project = await ensureFilmBreakdownProject(rootPath)
  const state = await loadFilmBreakdownProject(project.rootPath)
  const selected = new Set(selectedIds.map(String))
  const imageAssets = (state.imageAssets || []).map((asset) => ({ ...asset, selected: selected.has(asset.assetId) }))
  await writeState(project.rootPath, { ...state, imageAssets })
  return { assets: imageAssets }
}

export async function saveFilmBreakdownFramePrompt(rootPath: string, shotId: string, position: FilmBreakdownFramePosition, prompt: string) {
  const project = await ensureFilmBreakdownProject(rootPath)
  const state = await loadFilmBreakdownProject(project.rootPath)
  const index = state.shots.findIndex((shot) => shot.shotId === shotId)
  if (index < 0 || !framePositions.includes(position)) throw new Error('镜头画面不存在')
  state.shots[index] = { ...state.shots[index], imagePrompts: { ...state.shots[index].imagePrompts, [position]: String(prompt) } }
  await writeState(project.rootPath, state)
  return state.shots[index]
}

export async function saveFilmBreakdownAssetPrompt(rootPath: string, assetId: string, prompt: string) {
  const project = await ensureFilmBreakdownProject(rootPath)
  const state = await loadFilmBreakdownProject(project.rootPath)
  const index = (state.imageAssets || []).findIndex((asset) => asset.assetId === assetId)
  if (index < 0) throw new Error('资产不存在')
  state.imageAssets![index] = { ...state.imageAssets![index], prompt: String(prompt), status: String(prompt).trim() ? 'ready' : 'pending', error: undefined }
  await writeState(project.rootPath, state)
  return state.imageAssets![index]
}

export async function exportFilmBreakdownImages(rootPath: string, format: 'md' | 'txt') {
  if (!['md', 'txt'].includes(format)) throw new Error('导出格式无效')
  const project = await ensureFilmBreakdownProject(rootPath)
  const state = await loadFilmBreakdownProject(project.rootPath)
  const result = await dialog.showSaveDialog({ title: '导出图片分析文档', defaultPath: path.join(project.rootPath, `${state.name}-图片分析.${format}`), filters: [{ name: format === 'md' ? 'Markdown' : '文本', extensions: [format] }] })
  if (result.canceled || !result.filePath) return null
  await fs.promises.writeFile(result.filePath, formatFilmBreakdownImageDocument(state, format), 'utf8')
  return result.filePath
}

export async function exportFilmBreakdownVideos(rootPath: string, templates: FilmBreakdownVideoTemplate[], format: 'md' | 'txt') {
  if (!['md', 'txt'].includes(format)) throw new Error('导出格式无效')
  const selected = normalizeFilmBreakdownVideoTemplates(templates)
  const project = await ensureFilmBreakdownProject(rootPath)
  const state = await loadFilmBreakdownProject(project.rootPath)
  const result = await dialog.showSaveDialog({ title: '导出视频反推文档', defaultPath: path.join(project.rootPath, `${state.name}-视频反推.${format}`), filters: [{ name: format === 'md' ? 'Markdown' : '文本', extensions: [format] }] })
  if (result.canceled || !result.filePath) return null
  await fs.promises.writeFile(result.filePath, formatFilmBreakdownVideoDocument(state, selected, format), 'utf8')
  return result.filePath
}

export async function generateFilmBreakdownProjectOverview(rootPath: string, textModel: TextModel, reportProgress: (message: string) => void) {
  const project = await ensureFilmBreakdownProject(rootPath)
  let state = await loadFilmBreakdownProject(project.rootPath)
  if (!(await hasApiKey())) throw new Error('请先配置韭菜盒子 API Key')
  const shots = state.shots.map((shot) => ({ shotId: shot.shotId, startMs: shot.startMs, endMs: shot.endMs, prompt: String(shot.videoResults?.['video-prompt'] || shot.videoPrompt).trim() }))
  if (!shots.length || shots.some((shot) => !shot.prompt)) throw new Error('请先完成全部镜头的视频提示词反推')
  const controller = startAnalysis(project.rootPath)
  try {
    reportProgress('Gemini 正在生成全片总览…')
    const assets = (state.imageAssets || []).map((asset) => ({ category: asset.category, name: asset.name, description: asset.description, shotIds: [...new Set(asset.occurrences.map((occurrence) => occurrence.shotId))] }))
    const result = await generateFilmBreakdownVideoOverview({ textModel, shots, assets, signal: controller.signal })
    const videoOverview = normalizeFilmBreakdownVideoOverview(result as Partial<FilmBreakdownVideoOverview>, state.shots)
    state = await writeState(project.rootPath, { ...state, videoOverview })
    reportProgress('全片总览生成完成')
    return { videoOverview: state.videoOverview! }
  } finally { analysisControllers.delete(project.rootPath) }
}

export async function saveFilmBreakdownProjectOverview(rootPath: string, overview: FilmBreakdownVideoOverview) {
  const project = await ensureFilmBreakdownProject(rootPath)
  const state = await loadFilmBreakdownProject(project.rootPath)
  const videoOverview = normalizeFilmBreakdownVideoOverview(overview, state.shots)
  await writeState(project.rootPath, { ...state, videoOverview })
  return { videoOverview }
}

export async function exportFilmBreakdownCompletePrompts(rootPath: string, targetSeconds: number, format: 'md' | 'txt') {
  if (!['md', 'txt'].includes(format)) throw new Error('导出格式无效')
  const project = await ensureFilmBreakdownProject(rootPath)
  const state = await loadFilmBreakdownProject(project.rootPath)
  const content = formatFilmBreakdownCompletePrompts(state, Number(targetSeconds), format)
  const result = await dialog.showSaveDialog({ title: '导出完整视频提示词', defaultPath: path.join(project.rootPath, `${state.name}-完整视频提示词-${targetSeconds}秒.${format}`), filters: [{ name: format === 'md' ? 'Markdown' : '文本', extensions: [format] }] })
  if (result.canceled || !result.filePath) return null
  await fs.promises.writeFile(result.filePath, content, 'utf8')
  return result.filePath
}

export async function generateFilmBreakdownFramePrompts(rootPath: string, textModel: TextModel, positions: FilmBreakdownFramePosition[], reportProgress: (message: string) => void) {
  const project = await ensureFilmBreakdownProject(rootPath)
  let state = await loadFilmBreakdownProject(project.rootPath)
  const requested = [...new Set(positions)].filter((position): position is FilmBreakdownFramePosition => framePositions.includes(position))
  if (!state.boundariesConfirmed || !requested.length) throw new Error('请确认镜头并至少选择一种画面')
  if (!(await hasApiKey())) throw new Error('请先配置韭菜盒子 API Key')
  const controller = startAnalysis(project.rootPath)
  const total = state.shots.length * requested.length
  let completed = 0
  reportProgress(`正在准备反推全片所选画面，共 ${total} 张…`)
  try {
    for (let shotIndex = 0; shotIndex < state.shots.length; shotIndex++) for (const position of requested) {
      if (controller.signal.aborted) throw new Error('任务已停止')
      const shot = state.shots[shotIndex]
      completed++
      if (shot.imagePrompts?.[position]?.trim()) continue
      const fileName = shot.frameFileNames?.[position]
      if (!fileName) throw new Error(`${shot.shotId} 缺少${position}帧`)
      reportProgress(`Gemini 正在反推画面 ${completed}/${total}：${shot.shotId} ${position}`)
      const result = await generateFilmBreakdownImagePrompt({ textModel, image: await readFrame(project.rootPath, fileName), instruction: imagePromptInstruction, signal: controller.signal })
      state.shots[shotIndex] = { ...shot, imagePrompts: { ...shot.imagePrompts, [position]: result.prompt } }
      state = await writeState(project.rootPath, state)
    }
    reportProgress('镜头画面提示词生成完成')
    return { shots: state.shots }
  } finally { analysisControllers.delete(project.rootPath) }
}

export async function generateFilmBreakdownSelectedAssets(rootPath: string, textModel: TextModel, reportProgress: (message: string) => void) {
  const project = await ensureFilmBreakdownProject(rootPath)
  let state = await loadFilmBreakdownProject(project.rootPath)
  const targets = (state.imageAssets || []).filter((asset) => asset.selected && asset.status !== 'ready')
  if (!targets.length) throw new Error('请先选择资产')
  if (!(await hasApiKey())) throw new Error('请先配置韭菜盒子 API Key')
  const controller = startAnalysis(project.rootPath)
  try {
    for (let index = 0; index < targets.length; index++) {
      if (controller.signal.aborted) throw new Error('任务已停止')
      const assetIndex = state.imageAssets!.findIndex((asset) => asset.assetId === targets[index].assetId)
      const asset = state.imageAssets![assetIndex]
      reportProgress(`Gemini 正在生成资产 ${index + 1}/${targets.length}：${asset.name}`)
      state.imageAssets![assetIndex] = { ...asset, status: 'running', error: undefined }
      state = await writeState(project.rootPath, state)
      try {
        const images = await Promise.all(selectFilmBreakdownAssetReferences(asset.occurrences).map((occurrence) => {
          const fileName = state.shots.find((shot) => shot.shotId === occurrence.shotId)?.frameFileNames?.[occurrence.position]
          if (!fileName) throw new Error('资产参考帧不存在')
          return readFrame(project.rootPath, fileName)
        }))
        const result = await generateFilmBreakdownAssetPrompt({ textModel, name: asset.name, description: asset.description, images, instruction: assetPromptInstructions[asset.category], signal: controller.signal })
        state.imageAssets![assetIndex] = { ...state.imageAssets![assetIndex], prompt: result.prompt, status: 'ready', selected: false }
      } catch (error) {
        if (controller.signal.aborted) throw error
        state.imageAssets![assetIndex] = { ...state.imageAssets![assetIndex], status: 'failed', error: error instanceof Error ? error.message : String(error) }
      }
      state = await writeState(project.rootPath, state)
    }
    reportProgress('所选资产提示词生成完成')
    return { assets: state.imageAssets || [] }
  } finally { analysisControllers.delete(project.rootPath) }
}

export async function analyzeFilmBreakdownShots(rootPath: string, textModel: TextModel, templates: FilmBreakdownVideoTemplate[], reportProgress: (message: string) => void) {
  const project = await ensureFilmBreakdownProject(rootPath)
  let state = await loadFilmBreakdownProject(project.rootPath)
  if (!state.source || !state.boundariesConfirmed) throw new Error('请先确认镜头切分')
  const selected = normalizeFilmBreakdownVideoTemplates(templates)
  if (!(await hasApiKey())) throw new Error('请先配置韭菜盒子 API Key')
  const controller = new AbortController()
  analysisControllers.get(project.rootPath)?.abort()
  analysisControllers.set(project.rootPath, controller)
  try {
    for (let index = 0; index < state.shots.length; index++) {
      if (controller.signal.aborted) throw new Error('任务已停止')
      const shot = state.shots[index]
      const missing = selected.filter((template) => !String(shot.videoResults?.[template] || (template === 'video-prompt' ? shot.videoPrompt : '')).trim())
      if (!missing.length) continue
      if (!shot.clipFileName) throw new Error(`${shot.shotId} 缺少分析片段`)
      reportProgress(`Gemini 正在反推 ${index + 1}/${state.shots.length}：${shot.shotId}`)
      state.shots[index] = { ...shot, analysisStatus: 'running', error: undefined }
      state = await writeState(project.rootPath, state)
      try {
        const clip = await fs.promises.readFile(path.join(project.rootPath, talkingHeadMediaRelativePath('视频', shot.clipFileName)))
        if (clip.byteLength > 60 * 1024 * 1024) throw new Error('分析片段超过 60 MiB，请提高切镜灵敏度')
        const result = await analyzeFilmBreakdownClip({ textModel, shotId: shot.shotId, startMs: shot.startMs, endMs: shot.endMs, video: `data:video/mp4;base64,${clip.toString('base64')}`, requests: missing.map((template) => ({ template, instruction: videoPromptInstructions[template] })), signal: controller.signal })
        const videoResults = { ...state.shots[index].videoResults, ...result.results }
        state.shots[index] = { ...state.shots[index], analysisStatus: 'ready', videoResults, videoPrompt: videoResults['video-prompt'] || state.shots[index].videoPrompt }
      } catch (error) {
        if (controller.signal.aborted) throw error
        state.shots[index] = { ...state.shots[index], analysisStatus: 'failed', error: error instanceof Error ? error.message : String(error) }
      }
      state = await writeState(project.rootPath, state)
    }
    reportProgress('视频反推完成')
    return { shots: state.shots }
  } finally {
    analysisControllers.delete(project.rootPath)
  }
}

export function stopFilmBreakdownAnalysis(rootPath: string) {
  analysisControllers.get(path.resolve(rootPath))?.abort()
}

export async function showFilmBreakdownProject(rootPath: string) {
  const project = await ensureFilmBreakdownProject(rootPath)
  return shell.openPath(project.rootPath)
}

export function resolveFilmBreakdownMedia(rootPath: string, relativePath: string) {
  const root = path.resolve(rootPath)
  if (!allowedRoots.has(root)) throw new Error('拉片项目未打开')
  const relative = String(relativePath).replace(/\\/g, '/').replace(/^\/+/, '')
  if (!relative || relative.split('/').some((part) => part === '..')) throw new Error('媒体路径无效')
  const base = path.join(root, '.raw', 'jc-media')
  const target = path.resolve(base, relative)
  if (!['视频', '图片'].includes(relative.split('/')[0]) || !target.startsWith(`${base}${path.sep}`)) throw new Error('媒体路径无效')
  return target
}
