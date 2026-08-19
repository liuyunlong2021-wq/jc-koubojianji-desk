import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { app } from 'electron'
import axios from 'axios'

export type FunAsrInstallStatus = {
  state: 'ready' | 'missing' | 'installing' | 'failed'
  message: string
}

const MODEL_DIRS = [
  'models/iic--SenseVoiceSmall/snapshots/master',
  'models/iic--speech_fsmn_vad_zh-cn-16k-common-pytorch/snapshots/master',
  'models/iic--punc_ct-transformer_cn-en-common-vocab471067-large/snapshots/master',
  'models/iic--speech_campplus_sv_zh-cn_16k-common/snapshots/master',
]
const SEPARATION_MODELS = {
  vocals: 'vocals.fp16.onnx',
  accompaniment: 'accompaniment.fp16.onnx',
} as const
const SEPARATION_MODEL_URL =
  'https://www.modelscope.cn/models/himyworld/videotrans/resolve/master/onnx/'

let installing: Promise<FunAsrInstallStatus> | null = null
let boundRuntimeRoot = ''
let boundModelRoot = ''
let bindingLoaded = false

function pythonIn(root: string) {
  return path.join(root, 'runtime', 'funasr-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
}

function modelsInstalledAt(root: string) {
  return MODEL_DIRS.every((relative) =>
    fs.existsSync(path.join(root, relative)) || fs.existsSync(path.join(root, relative.slice('models/'.length))),
  )
}

function candidateDataRoots() {
  const appData = app.getPath('appData')
  const sharedRoot = path.join(appData, 'Jiucaihezi', 'funasr')
  const productRoots = fs.existsSync(appData)
    ? fs.readdirSync(appData, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('jc-'))
        .map((entry) => path.join(appData, entry.name))
    : []
  return [...new Set([process.env.FUNASR_HOME && path.resolve(process.env.FUNASR_HOME), sharedRoot, app.getPath('userData'), ...productRoots].filter(Boolean) as string[])]
}

function bindingFile() {
  return path.join(app.getPath('userData'), 'funasr-binding.json')
}

function loadBinding() {
  if (bindingLoaded) return
  bindingLoaded = true
  try {
    const binding = JSON.parse(fs.readFileSync(bindingFile(), 'utf8')) as { runtimeRoot?: string; modelRoot?: string }
    if (binding.runtimeRoot && binding.modelRoot && fs.existsSync(pythonIn(binding.runtimeRoot)) && modelsInstalledAt(binding.modelRoot)) {
      boundRuntimeRoot = binding.runtimeRoot
      boundModelRoot = binding.modelRoot
    }
  } catch {}
}

async function bindFunAsr(runtimeRoot: string, modelRoot: string) {
  boundRuntimeRoot = runtimeRoot
  boundModelRoot = modelRoot
  await fs.promises.mkdir(path.dirname(bindingFile()), { recursive: true })
  await fs.promises.writeFile(bindingFile(), `${JSON.stringify({ runtimeRoot, modelRoot }, null, 2)}\n`, 'utf8')
}

async function clearBinding() {
  boundRuntimeRoot = ''
  boundModelRoot = ''
  await fs.promises.rm(bindingFile(), { force: true })
}

function cachedModelRoots() {
  const home = os.homedir()
  return [
    path.join(home, '.cache', 'modelscope', 'hub'),
    path.join(home, '.cache', 'huggingface', 'hub'),
  ]
}

export function funAsrRuntimeRoot() {
  loadBinding()
  return boundRuntimeRoot || candidateDataRoots().find((root) => fs.existsSync(pythonIn(root))) || path.join(app.getPath('appData'), 'Jiucaihezi', 'funasr')
}

export function funAsrModelRoot() {
  loadBinding()
  if (boundModelRoot) return boundModelRoot
  const bundled = candidateDataRoots()
    .map((root) => path.join(root, 'models', 'funasr'))
    .find(modelsInstalledAt)
  const cached = cachedModelRoots().find(modelsInstalledAt)
  if (bundled) return bundled
  if (cached) return cached
  return path.join(app.getPath('appData'), 'Jiucaihezi', 'funasr', 'models', 'funasr')
}

function pythonPath() {
  return pythonIn(funAsrRuntimeRoot())
}

function runtimePath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'funasr', 'runtime.py')
    : path.join(process.cwd(), 'runtime', 'funasr', 'runtime.py')
}

function modelRoot() {
  return funAsrModelRoot()
}

function separationModelsInstalled() {
  return separationModelsInstalledAt(funAsrRuntimeRoot())
}

function separationModelsInstalledAt(runtimeRoot: string) {
  return Object.values(SEPARATION_MODELS).every((name) => fs.existsSync(path.join(runtimeRoot, 'models', 'separation', name)))
}

function separationModelRoot() {
  return path.join(funAsrRuntimeRoot(), 'models', 'separation')
}

async function downloadFile(
  url: string,
  destination: string,
  reportProgress: (message: string) => void,
) {
  const response = await axios.get<NodeJS.ReadableStream>(url, { responseType: 'stream' })
  await fs.promises.mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.tmp`
  const file = fs.createWriteStream(temporary)
  let bytes = 0
  for await (const chunk of response.data as AsyncIterable<Buffer>) {
    file.write(chunk)
    bytes += chunk.byteLength
    if (bytes % (4 * 1024 * 1024) < chunk.byteLength)
      reportProgress(`已下载 ${Math.round(bytes / 1024 / 1024)} MB：${path.basename(destination)}`)
  }
  await new Promise<void>((resolve, reject) => {
    file.once('error', reject)
    file.end(resolve)
  })
  await fs.promises.rename(temporary, destination)
}

function sendProgress(reportProgress: (message: string) => void, data: Buffer) {
  for (const line of data.toString().split(/\r?\n/)) if (line.trim()) reportProgress(line.trim())
}

function run(command: string, args: string[], reportProgress: (message: string) => void) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, PYTORCH_ENABLE_MPS_FALLBACK: '1' },
    })
    child.stdout.on('data', (data) => sendProgress(reportProgress, data))
    child.stderr.on('data', (data) => sendProgress(reportProgress, data))
    child.once('error', reject)
    child.once('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${path.basename(command)} 执行失败（退出码 ${code}）`)),
    )
  })
}

function canRun(command: string) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, ['--version'], { stdio: 'ignore' })
    child.once('error', () => resolve(false))
    child.once('close', (code) => resolve(code === 0))
  })
}

async function findUv(reportProgress: (message: string) => void) {
  const names = process.platform === 'win32' ? ['uv.exe', 'uv'] : ['uv']
  const candidates = [
    ...names,
    path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv'),
    path.join(os.homedir(), '.local', 'bin', 'uv.exe'),
    path.join(os.homedir(), '.local', 'bin', 'uv'),
    path.join(process.env.LOCALAPPDATA || '', 'uv', 'uv.exe'),
  ].filter(Boolean)
  for (const candidate of candidates)
    if (
      (candidate === 'uv' || candidate === 'uv.exe' || fs.existsSync(candidate)) &&
      (await canRun(candidate))
    )
      return candidate
  reportProgress('正在安装本地运行环境…')
  if (process.platform === 'win32')
    await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'ByPass',
        '-Command',
        'irm https://astral.sh/uv/install.ps1 | iex',
      ],
      reportProgress,
    )
  else
    await run('/bin/sh', ['-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh'], reportProgress)
  const installed = candidates.find(
    (candidate) => candidate !== 'uv' && candidate !== 'uv.exe' && fs.existsSync(candidate),
  )
  if (!installed) throw new Error('本地运行环境安装后仍未找到 uv，请检查网络和系统权限')
  return installed
}

export async function getFunAsrInstallStatus(): Promise<FunAsrInstallStatus> {
  if (installing) return { state: 'installing', message: '正在安装本地音频引擎…' }
  loadBinding()
  if (boundRuntimeRoot && boundModelRoot && separationModelsInstalled())
    return { state: 'ready', message: `已绑定本地字幕与人声分离引擎：${path.basename(boundRuntimeRoot)}` }
  if (candidateDataRoots().some((root) => fs.existsSync(pythonIn(root))) && [...candidateDataRoots().map((root) => path.join(root, 'models', 'funasr')), ...cachedModelRoots()].some(modelsInstalledAt))
    return { state: 'missing', message: '检测到已有本地组件，请扫描验证并绑定。' }
  return { state: 'missing', message: '未找到完整本地引擎，请一键安装（约 2 GB）。' }
}

export async function getFunAsrSubtitleInstallStatus(): Promise<FunAsrInstallStatus> {
  if (installing) return { state: 'installing', message: '正在安装本地字幕引擎…' }
  loadBinding()
  if (boundRuntimeRoot && boundModelRoot && fs.existsSync(pythonIn(boundRuntimeRoot)) && modelsInstalledAt(boundModelRoot))
    return { state: 'ready', message: `已绑定本地字幕识别引擎：${path.basename(boundRuntimeRoot)}` }
  return { state: 'missing', message: '本地字幕识别引擎尚未验证，请前往设置扫描或安装。' }
}

async function scanFunAsrCandidates(reportProgress: (message: string) => void): Promise<FunAsrInstallStatus> {
  const runtimeRoots = candidateDataRoots().filter((root) => fs.existsSync(pythonIn(root)))
    .sort((left, right) => Number(separationModelsInstalledAt(right)) - Number(separationModelsInstalledAt(left)))
  const modelRoots = [...new Set([...candidateDataRoots().map((root) => path.join(root, 'models', 'funasr')), ...cachedModelRoots()])].filter(modelsInstalledAt)
  if (!runtimeRoots.length || !modelRoots.length) {
    await clearBinding()
    return { state: 'missing', message: '未找到完整的 Python 字幕环境和模型，请一键安装。' }
  }

  let verifiedWithoutSeparation: { runtimeRoot: string; modelRoot: string } | null = null
  let lastError = ''
  for (const runtimeRoot of runtimeRoots) {
    const preferredModelRoot = path.join(runtimeRoot, 'models', 'funasr')
    const candidates = [...new Set([preferredModelRoot, ...modelRoots])].filter(modelsInstalledAt)
    for (const existingModelRoot of candidates) {
      reportProgress(`正在验证已有字幕引擎：${path.basename(runtimeRoot)}`)
      try {
        await run(pythonIn(runtimeRoot), [runtimePath(), 'probe', '--model-root', existingModelRoot], reportProgress)
        if (separationModelsInstalledAt(runtimeRoot)) {
          await bindFunAsr(runtimeRoot, existingModelRoot)
          return { state: 'ready', message: `已验证并绑定现有字幕与人声分离引擎：${path.basename(runtimeRoot)}` }
        }
        verifiedWithoutSeparation ||= { runtimeRoot, modelRoot: existingModelRoot }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
    }
  }
  if (verifiedWithoutSeparation) {
    await bindFunAsr(verifiedWithoutSeparation.runtimeRoot, verifiedWithoutSeparation.modelRoot)
    return { state: 'missing', message: '已绑定现有字幕识别引擎，但缺少人声分离模型，请一键安装补全。' }
  }
  await clearBinding()
  return { state: 'failed', message: `发现已有组件但验证失败，请一键安装修复。${lastError ? ` ${lastError}` : ''}` }
}

export async function scanFunAsr(reportProgress: (message: string) => void) {
  if (installing) return { state: 'installing' as const, message: '正在安装本地音频引擎…' }
  return scanFunAsrCandidates(reportProgress)
}

async function installFunAsrEngine(reportProgress: (message: string) => void, includeSeparation: boolean) {
  if (installing) return installing
  const existing = await scanFunAsrCandidates(reportProgress)
  if (existing.state === 'ready') return existing
  installing = (async () => {
    try {
      const root = funAsrRuntimeRoot()
      const venv = path.dirname(path.dirname(pythonPath()))
      if (!boundRuntimeRoot || !boundModelRoot) {
        const uv = await findUv(reportProgress)
        reportProgress('正在准备 Python 3.10 环境…')
        if (!fs.existsSync(pythonPath()))
          await run(uv, ['venv', '--python', '3.10', venv], reportProgress)
        reportProgress('正在安装字幕识别依赖…')
        await run(uv, ['pip', 'install', '--python', pythonPath(), 'torch', 'torchaudio', 'funasr==1.4.1', 'sherpa-onnx==1.13.4', 'soundfile==0.13.1'], reportProgress)
        reportProgress('正在下载字幕识别模型，请保持网络连接…')
        await run(pythonPath(), [runtimePath(), 'download', '--model-root', modelRoot()], reportProgress)
      }
      if (includeSeparation) {
        reportProgress('正在下载人声分离模型，请保持网络连接…')
        for (const name of Object.values(SEPARATION_MODELS)) {
          const destination = path.join(separationModelRoot(), name)
          if (!fs.existsSync(destination))
            await downloadFile(`${SEPARATION_MODEL_URL}${name}`, destination, reportProgress)
        }
      }
      boundRuntimeRoot = root
      boundModelRoot = modelRoot()
      return scanFunAsrCandidates(reportProgress)
    } catch (error) {
      return {
        state: 'failed' as const,
        message: error instanceof Error ? error.message : String(error),
      }
    } finally {
      installing = null
    }
  })()
  return installing
}

export function installFunAsr(reportProgress: (message: string) => void) {
  return installFunAsrEngine(reportProgress, true)
}
