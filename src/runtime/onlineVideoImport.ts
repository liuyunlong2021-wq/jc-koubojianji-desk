import path from 'node:path'

export function validateOnlineVideoUrl(value: string) {
  const raw = value.trim()
  if (!raw) throw new Error('请输入有效的 HTTP(S) 视频链接')
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('请输入有效的 HTTP(S) 视频链接') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('请输入有效的 HTTP(S) 视频链接')
  return url.toString()
}

export function buildOnlineVideoDownloadArgs(tempDirectory: string, url: string, ffmpegLocation: string) {
  const output = path.join(path.resolve(tempDirectory), 'source.%(ext)s')
  return [
    '--no-playlist', '--match-filter', '!is_live', '--newline', '--progress', '--no-colors', '--no-part', '--restrict-filenames',
    '--format', 'bv*[height<=1080]+ba/b[height<=1080]/b', '--ffmpeg-location', ffmpegLocation,
    '--output', output, '--print', 'after_move:filepath', url,
  ]
}

export function isPathInside(directory: string, candidate: string) {
  const root = path.resolve(directory) + path.sep
  return path.resolve(candidate).startsWith(root)
}
