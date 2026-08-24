import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOnlineVideoDownloadArgs, isPathInside, validateOnlineVideoUrl } from './onlineVideoImport.ts'

test('网络视频只接受 HTTP(S)', () => {
  assert.equal(validateOnlineVideoUrl('  https://example.com/watch?v=1  '), 'https://example.com/watch?v=1')
  for (const value of ['', 'file:///tmp/a.mp4', 'javascript:alert(1)', 'https://user:secret@example.com/v', 'not-a-url']) assert.throws(() => validateOnlineVideoUrl(value), /HTTP\(S\)/)
})

test('yt-dlp 参数固定为单条、非直播和 1080p 上限', () => {
  const args = buildOnlineVideoDownloadArgs('/tmp/jc-download', 'https://example.com/v', '/app/bin/ffmpeg')
  assert.ok(args.includes('--no-playlist'))
  assert.deepEqual(args.slice(args.indexOf('--match-filter'), args.indexOf('--match-filter') + 2), ['--match-filter', '!is_live'])
  assert.ok(args.includes('bv*[height<=1080]+ba/b[height<=1080]/b'))
  assert.deepEqual(args.slice(args.indexOf('--ffmpeg-location'), args.indexOf('--ffmpeg-location') + 2), ['--ffmpeg-location', '/app/bin/ffmpeg'])
  assert.ok(args.includes('--no-colors'))
  assert.equal(args.at(-1), 'https://example.com/v')
  assert.ok(args[args.indexOf('--output') + 1].endsWith('source.%(ext)s'))
})

test('下载结果必须留在临时目录', () => {
  assert.equal(isPathInside('/tmp/jc-download', '/tmp/jc-download/source.mp4'), true)
  assert.equal(isPathInside('/tmp/jc-download', '/tmp/jc-download-other/source.mp4'), false)
  assert.equal(isPathInside('/tmp/jc-download', '/tmp/jc-download/../secret.mp4'), false)
})
