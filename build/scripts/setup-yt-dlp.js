const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

const VERSION = '2026.08.19'
const RELEASE_BASES = [
  'https://ghfast.top/https://github.com/yt-dlp/yt-dlp/releases/download',
  'https://github.com/yt-dlp/yt-dlp/releases/download',
]
const releases = {
  darwin: { asset: 'yt-dlp_macos', sha256: '0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202' },
  'linux-x64': { asset: 'yt-dlp_linux', sha256: '58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a' },
  'linux-arm64': { asset: 'yt-dlp_linux_aarch64', sha256: 'b16e4dab368a816cd05d477d698a605a6ae87ccee1c8ffd38fa21d7254141fcc' },
  'win32-x64': { asset: 'yt-dlp.exe', sha256: '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a' },
  'win32-arm64': { asset: 'yt-dlp_arm64.exe', sha256: '05b438997bafc3affdfda9d041353c9d73e04dc842207254b655b0887c4445b0' },
}

function digest(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

async function main() {
  const key = process.platform === 'darwin' ? 'darwin' : `${process.platform}-${process.arch}`
  const release = releases[key]
  if (!release) throw new Error(`yt-dlp does not support build target ${key}`)
  const directory = path.join(__dirname, '..', '..', 'runtime', 'yt-dlp', process.platform)
  const target = path.join(directory, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
  if (fs.existsSync(target) && digest(target) === release.sha256) return console.log(`yt-dlp ${VERSION} is ready`)
  fs.mkdirSync(directory, { recursive: true })
  const temporary = `${target}.download`
  let failure
  for (const base of RELEASE_BASES) {
    try {
      const response = await fetch(`${base}/${VERSION}/${release.asset}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary))
      if (digest(temporary) !== release.sha256) throw new Error('checksum verification failed')
      failure = undefined
      break
    } catch (error) {
      failure = error
      fs.rmSync(temporary, { force: true })
    }
  }
  if (failure) throw new Error(`yt-dlp download failed: ${failure.message}`)
  fs.chmodSync(temporary, 0o755)
  fs.rmSync(target, { force: true })
  fs.renameSync(temporary, target)
  console.log(`yt-dlp ${VERSION} downloaded and verified`)
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
