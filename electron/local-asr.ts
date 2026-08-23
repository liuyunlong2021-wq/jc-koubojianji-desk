import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { app } from 'electron'
import { funAsrModelRoot, funAsrRuntimeRoot } from './funasr-installer.ts'

const runFile = promisify(execFile)

export interface FunAsrCue {
  cueId: string
  startMs: number
  endMs: number
  recognizedText: string
  speakerCluster?: string
  language?: string
  emotion?: string
  audioEvent?: string
  words?: Array<{ text: string; startMs: number; endMs: number }>
}

interface FunAsrTranscript {
  schemaVersion: 1
  engine: string
  device: string
  sourceHash: string
  sourceAudioPath: string
  loadSeconds?: number
  inferSeconds?: number
  cues: FunAsrCue[]
}

function funAsrHome() {
  return funAsrRuntimeRoot()
}

function pythonPath() {
  if (process.env.FUNASR_PYTHON) return path.resolve(process.env.FUNASR_PYTHON)
  return path.join(
    funAsrHome(),
    'runtime',
    'funasr-venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  )
}

function runtimeScriptPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'funasr', 'runtime.py')
    : path.join(process.cwd(), 'runtime', 'funasr', 'runtime.py')
}

function modelRoot() {
  return funAsrModelRoot()
}

function srtTime(milliseconds: number) {
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  const seconds = Math.floor((milliseconds % 60_000) / 1_000)
  const millis = milliseconds % 1_000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

export function funAsrCuesToSrt(cues: FunAsrCue[], text: (cue: FunAsrCue) => string) {
  return cues
    .map(
      (cue, index) =>
        `${index + 1}\n${srtTime(cue.startMs)} --> ${srtTime(cue.endMs)}\n${text(cue)}\n`,
    )
    .join('\n')
}

function validateTranscript(value: unknown, durationMs: number): FunAsrTranscript {
  const transcript = value as FunAsrTranscript
  if (transcript?.schemaVersion !== 1 || !Array.isArray(transcript.cues))
    throw new Error('FunASR 没有返回有效转写结果')
  const ids = new Set<string>()
  for (const cue of transcript.cues) {
    if (
      !cue?.cueId ||
      ids.has(cue.cueId) ||
      !Number.isFinite(cue.startMs) ||
      !Number.isFinite(cue.endMs) ||
      cue.startMs < 0 ||
      cue.endMs <= cue.startMs ||
      cue.endMs > durationMs + 100 ||
      !cue.recognizedText?.trim()
    )
      throw new Error('FunASR 字幕时间或文字无效')
    ids.add(cue.cueId)
  }
  return transcript
}

export async function transcribeAudioWithFunAsr(audioPath: string, durationMs: number, abortSignal?: AbortSignal) {
  const python = pythonPath()
  const runtime = runtimeScriptPath()
  await Promise.all([
    fs.promises.access(python, fs.constants.X_OK),
    fs.promises.access(runtime),
  ]).catch(() => {
    throw new Error('本地字幕引擎尚未安装，请打开“生成设置”并点击“一键安装”')
  })
  let stdout = ''
  try {
    ;({ stdout } = await runFile(
      python,
      [runtime, 'transcribe', '--model-root', modelRoot(), '--audio', audioPath],
      {
        maxBuffer: 64 * 1024 * 1024,
        signal: abortSignal,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
          PYTORCH_ENABLE_MPS_FALLBACK: '1',
        },
      },
    ))
  } catch (error) {
    if (abortSignal?.aborted) throw error
    throw new Error('FunASR 识别失败，请运行 pnpm probe:funasr 检查本地环境和模型')
  }
  const resultLine = stdout
    .split(/\r?\n/)
    .reverse()
    .find((line) => line.startsWith('FUNASR_RESULT_JSON='))
  if (!resultLine) throw new Error('FunASR 没有返回结构化结果')
  return validateTranscript(
    JSON.parse(resultLine.slice('FUNASR_RESULT_JSON='.length)),
    durationMs,
  )
}
