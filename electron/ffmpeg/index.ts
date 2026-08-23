import fs from 'node:fs'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { isDev } from '../lib/is-dev.ts'

const ffmpegPath: string = isDev
  ? require('ffmpeg-static')
  : (require('ffmpeg-static') as string).replace('app.asar', 'app.asar.unpacked')

export async function getFFmpegStatus() {
  try {
    fs.accessSync(ffmpegPath, fs.constants.X_OK)
    const [{ stdout: filters }, { stdout: encoders }] = await Promise.all([
      executeFFmpeg(['-hide_banner', '-filters']),
      executeFFmpeg(['-hide_banner', '-encoders']),
    ])
    const missing = [
      ...['subtitles', 'trim', 'atrim', 'concat', 'scale', 'overlay', 'amix', 'alimiter', 'adelay', 'aresample'].filter((name) => !new RegExp(`\\b${name}\\b`).test(filters)),
      ...['libx264', 'aac'].filter((name) => !new RegExp(`\\b${name}\\b`).test(encoders)),
    ]
    if (missing.length) throw new Error(`缺少导出组件：${missing.join('、')}`)
    return { state: 'ready' as const, message: '内置 FFmpeg、字幕滤镜、视频和音频编码组件均已验证' }
  } catch (error) {
    return { state: 'failed' as const, message: `内置 FFmpeg 不可用：${error instanceof Error ? error.message : String(error)}` }
  }
}

export async function executeFFmpeg(
  args: string[],
  options?: { cwd?: string; onProgress?: (progress: number) => void; abortSignal?: AbortSignal },
): Promise<{ stdout: string; stderr: string; code: number }> {
  validateExecutable()
  return new Promise((resolve, reject) => {
    if (options?.abortSignal?.aborted) return reject(new Error('任务已停止'))
    const child = spawn(ffmpegPath, args, { cwd: options?.cwd || process.cwd(), env: process.env })
    const abort = () => child.kill('SIGTERM')
    const clearAbort = () => options?.abortSignal?.removeEventListener('abort', abort)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data) => { stdout += data.toString() })
    child.stderr.on('data', (data) => { stderr += data.toString() })
    child.on('close', (code) => {
      clearAbort()
      if (code === 0) {
        options?.onProgress?.(100)
        resolve({ stdout, stderr, code })
      } else reject(new Error(options?.abortSignal?.aborted ? '任务已停止' : `FFmpeg exited with code ${code}: ${stderr}`))
    })
    child.on('error', (error) => { clearAbort(); reject(new Error(`Failed to start FFmpeg: ${error.message}`)) })
    options?.abortSignal?.addEventListener('abort', abort, { once: true })
  })
}

function validateExecutable() {
  if (!fs.existsSync(ffmpegPath)) throw new Error(`FFmpeg not found at: ${ffmpegPath}`)
  try { fs.accessSync(ffmpegPath, fs.constants.X_OK) }
  catch { if (os.platform() !== 'win32') throw new Error('FFmpeg executable does not have execute permission') }
}
