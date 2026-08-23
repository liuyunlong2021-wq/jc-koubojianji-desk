import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, ipcMain, shell } from 'electron'
import { isDev } from './lib/is-dev'
import { OpenExternalParams, StatEventParams } from './types'
import { sendStatEvent } from './lib/stat'
import { hasApiKey, saveApiKey, testApiKey } from './talking-head-cloud'
import { getFunAsrInstallStatus, getFunAsrSubtitleInstallStatus, installFunAsr, scanFunAsr } from './funasr-installer'
import { getFFmpegStatus } from './ffmpeg/index'
import { calibrateTalkingHeadCues, chooseTalkingHeadBackgroundMusic, chooseTalkingHeadProject, chooseTalkingHeadSource, composeTalkingHeadEditPlan, generateTalkingHeadEditPlanForProject, generateTalkingHeadHighlightsForProject, listTalkingHeadFonts, loadTalkingHeadProjectState, prepareTalkingHeadSoundEffects, previewTalkingHeadFrame, renameTalkingHeadProject, restoreTalkingHeadRecognizedCues, saveTalkingHeadBackgroundMusic, saveTalkingHeadCues, saveTalkingHeadEditPlan, saveTalkingHeadHighlightPlan, saveTalkingHeadSubtitleStyle, setTalkingHeadSoundEffectsEnabled, showTalkingHeadOutput, showTalkingHeadProject, transcribeTalkingHeadSource } from './talking-head-project'
import { analyzeFilmBreakdownShots, chooseFilmBreakdownProject, chooseFilmBreakdownSource, confirmFilmBreakdownShots, detectFilmBreakdownShots, exportFilmBreakdownCompletePrompts, exportFilmBreakdownImages, exportFilmBreakdownVideos, generateFilmBreakdownFramePrompts, generateFilmBreakdownProjectOverview, generateFilmBreakdownSelectedAssets, identifyFilmBreakdownProjectAssets, loadFilmBreakdownProject, saveFilmBreakdownAssetPrompt, saveFilmBreakdownAssetSelection, saveFilmBreakdownFramePrompt, saveFilmBreakdownProjectOverview, saveFilmBreakdownPrompt, saveFilmBreakdownShots, saveFilmBreakdownVideoResult, showFilmBreakdownProject, stopFilmBreakdownAnalysis } from './film-breakdown-project'
import { toIpcValue } from '../src/runtime/ipcValue'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let windowMaximizedByApp = false

process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 使用['ENV_NAME'] 避免 vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = isDev ? process.env['VITE_DEV_SERVER_URL'] : undefined
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

export default function initIPC() {
  // 是否最大化
  ipcMain.handle('is-win-maxed', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return Boolean(win?.isMaximized() || windowMaximizedByApp)
  })
  //最小化
  ipcMain.on('win-min', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.minimize()
  })
  //最大化
  ipcMain.on('win-max', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win?.isMaximized() || windowMaximizedByApp) {
      win?.restore()
      windowMaximizedByApp = false
    } else {
      win?.maximize()
      windowMaximizedByApp = true
    }
  })
  // 切换最大化/还原
  ipcMain.on('toggle-window-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    if (win.isMaximized() || windowMaximizedByApp) {
      win.restore()
      windowMaximizedByApp = false
    } else {
      win.maximize()
      windowMaximizedByApp = true
    }
  })
  // 拖拽前准备窗口状态：最大化时先还原，再返回还原后的窗口尺寸
  ipcMain.handle('prepare-window-drag', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null

    const wasMaximized = win.isMaximized() || windowMaximizedByApp
    if (wasMaximized) {
      win.restore()
      windowMaximizedByApp = false
    }

    return {
      bounds: win.getBounds(),
      wasMaximized,
    }
  })
  // 获取窗口位置和大小
  ipcMain.handle('get-window-bounds', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.getBounds()
  })
  // 设置窗口位置
  ipcMain.on('set-window-position', (event, x: number, y: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.setPosition(Math.round(x), Math.round(y))
  })
  //关闭程序
  ipcMain.on('win-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.close()
  })

  // 设置缩放倍率
  ipcMain.on('set-zoom-factor', (event, factor: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.webContents.setZoomFactor(factor)
  })

  // 打开外部链接
  ipcMain.handle('open-external', (_event, params: OpenExternalParams) => {
    const url = new URL(String(params?.url || ''))
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol))
      throw new Error('不允许打开该外部地址')
    return shell.openExternal(url.toString())
  })

  ipcMain.handle('cloud-has-api-key', () => hasApiKey())
  ipcMain.handle('film-breakdown-project-choose', () => chooseFilmBreakdownProject())
  ipcMain.handle('film-breakdown-project-show', (_event, rootPath: string) => showFilmBreakdownProject(rootPath))
  ipcMain.handle('film-breakdown-source-choose', (_event, rootPath?: string) => chooseFilmBreakdownSource(rootPath))
  ipcMain.handle('film-breakdown-project-load', (_event, rootPath: string) => loadFilmBreakdownProject(rootPath))
  ipcMain.handle('film-breakdown-detect', (event, rootPath: string, threshold: number) => detectFilmBreakdownShots(rootPath, threshold, (message) => event.sender.send('film-breakdown-progress', message)))
  ipcMain.handle('film-breakdown-shots-save', (_event, rootPath: string, shots) => saveFilmBreakdownShots(rootPath, shots))
  ipcMain.handle('film-breakdown-shots-confirm', (event, rootPath: string) => confirmFilmBreakdownShots(rootPath, (message) => event.sender.send('film-breakdown-progress', message)))
  ipcMain.handle('film-breakdown-prompt-save', (_event, rootPath: string, shotId: string, videoPrompt: string, imagePrompt: string) => saveFilmBreakdownPrompt(rootPath, shotId, videoPrompt, imagePrompt))
  ipcMain.handle('film-breakdown-video-result-save', (_event, rootPath: string, shotId, template, prompt) => saveFilmBreakdownVideoResult(rootPath, shotId, template, prompt))
  ipcMain.handle('film-breakdown-analyze', async (event, rootPath: string, textModel, instructions) => {
    try {
      const templates = Array.isArray(instructions) ? instructions.map(String).filter((value) => value === 'video-prompt' || value === 'script') : []
      const result = await analyzeFilmBreakdownShots(String(rootPath), textModel, templates, (message) => event.sender.send('film-breakdown-progress', String(message)))
      return toIpcValue(result)
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error))
    }
  })
  ipcMain.handle('film-breakdown-assets-identify', (event, rootPath: string, textModel) => identifyFilmBreakdownProjectAssets(rootPath, textModel, (message) => event.sender.send('film-breakdown-progress', message)))
  ipcMain.handle('film-breakdown-assets-select', (_event, rootPath: string, selectedIds) => saveFilmBreakdownAssetSelection(rootPath, selectedIds))
  ipcMain.handle('film-breakdown-frame-prompt-save', (_event, rootPath: string, shotId, position, prompt) => saveFilmBreakdownFramePrompt(rootPath, shotId, position, prompt))
  ipcMain.handle('film-breakdown-asset-prompt-save', (_event, rootPath: string, assetId, prompt) => saveFilmBreakdownAssetPrompt(rootPath, assetId, prompt))
  ipcMain.handle('film-breakdown-frame-prompts-generate', (event, rootPath: string, textModel, positions) => generateFilmBreakdownFramePrompts(rootPath, textModel, positions, (message) => event.sender.send('film-breakdown-progress', message)))
  ipcMain.handle('film-breakdown-asset-prompts-generate', (event, rootPath: string, textModel) => generateFilmBreakdownSelectedAssets(rootPath, textModel, (message) => event.sender.send('film-breakdown-progress', message)))
  ipcMain.handle('film-breakdown-images-export', (_event, rootPath: string, format) => exportFilmBreakdownImages(rootPath, format))
  ipcMain.handle('film-breakdown-videos-export', (_event, rootPath: string, templates, format) => exportFilmBreakdownVideos(rootPath, templates, format))
  ipcMain.handle('film-breakdown-overview-generate', (event, rootPath: string, textModel) => generateFilmBreakdownProjectOverview(rootPath, textModel, (message) => event.sender.send('film-breakdown-progress', String(message))))
  ipcMain.handle('film-breakdown-overview-save', (_event, rootPath: string, overview) => saveFilmBreakdownProjectOverview(rootPath, overview))
  ipcMain.handle('film-breakdown-complete-prompts-export', (_event, rootPath: string, targetSeconds, format) => exportFilmBreakdownCompletePrompts(rootPath, targetSeconds, format))
  ipcMain.handle('film-breakdown-analysis-stop', (_event, rootPath: string) => stopFilmBreakdownAnalysis(rootPath))
  ipcMain.handle('talking-head-project-choose', () => chooseTalkingHeadProject())
  ipcMain.handle('talking-head-project-rename', (_event, rootPath: string, name: string) => renameTalkingHeadProject(rootPath, name))
  ipcMain.handle('talking-head-project-show', (_event, rootPath: string) =>
    showTalkingHeadProject(rootPath),
  )
  ipcMain.handle('talking-head-output-show', (_event, rootPath: string) => showTalkingHeadOutput(rootPath))
  ipcMain.handle('talking-head-source-choose', (_event, rootPath?: string) => chooseTalkingHeadSource(rootPath))
  ipcMain.handle('talking-head-transcribe', (event, rootPath: string) =>
    transcribeTalkingHeadSource(rootPath, (message) => event.sender.send('talking-head-progress', message)),
  )
  ipcMain.handle('talking-head-project-load', (_event, rootPath: string) => loadTalkingHeadProjectState(rootPath))
  ipcMain.handle('talking-head-preview-frame', (_event, rootPath: string, timestampMs: number, cue, subtitleStyle, highlight) => previewTalkingHeadFrame(rootPath, timestampMs, cue, subtitleStyle, highlight))
  ipcMain.handle('talking-head-fonts-list', () => listTalkingHeadFonts())
  ipcMain.handle('talking-head-background-music-choose', (_event, rootPath: string) => chooseTalkingHeadBackgroundMusic(rootPath))
  ipcMain.handle('talking-head-background-music-save', (_event, rootPath: string, music) => saveTalkingHeadBackgroundMusic(rootPath, music))
  ipcMain.handle('talking-head-subtitle-style-save', (_event, rootPath: string, style) => saveTalkingHeadSubtitleStyle(rootPath, style))
  ipcMain.handle('talking-head-sound-effects-enabled', (_event, rootPath: string, enabled: boolean) => setTalkingHeadSoundEffectsEnabled(rootPath, enabled))
  ipcMain.handle('talking-head-sound-effects-prepare', (_event, rootPath: string) => prepareTalkingHeadSoundEffects(rootPath))
  ipcMain.handle('talking-head-cues-save', (_event, rootPath: string, cues) => saveTalkingHeadCues(rootPath, cues))
  ipcMain.handle('talking-head-edit-plan-save', (_event, rootPath: string, plan) => saveTalkingHeadEditPlan(rootPath, plan))
  ipcMain.handle('talking-head-edit-plan-generate', (_event, rootPath: string, textModel, instruction) => generateTalkingHeadEditPlanForProject(rootPath, textModel, instruction))
  ipcMain.handle('talking-head-highlights-generate', (_event, rootPath: string, textModel) => generateTalkingHeadHighlightsForProject(rootPath, textModel))
  ipcMain.handle('talking-head-highlights-save', (_event, rootPath: string, plan) => saveTalkingHeadHighlightPlan(rootPath, plan))
  ipcMain.handle('talking-head-compose', (event, rootPath: string, options) =>
    composeTalkingHeadEditPlan(rootPath, options, (message) => event.sender.send('talking-head-progress', message)),
  )
  ipcMain.handle('talking-head-cues-calibrate', (_event, rootPath: string, textModel, instruction) => calibrateTalkingHeadCues(rootPath, textModel, instruction))
  ipcMain.handle('talking-head-cues-restore-recognized', (_event, rootPath: string) => restoreTalkingHeadRecognizedCues(rootPath))
  ipcMain.handle('cloud-save-api-key', (_event, apiKey: string) => saveApiKey(apiKey))
  ipcMain.handle('cloud-test-api-key', (_event, textModel) => testApiKey(textModel))
  ipcMain.handle('funasr-install-status', () => getFunAsrInstallStatus())
  ipcMain.handle('funasr-subtitle-install-status', () => getFunAsrSubtitleInstallStatus())
  ipcMain.handle('funasr-scan', (event) => scanFunAsr((message) => event.sender.send('funasr-install-progress', message)))
  ipcMain.handle('ffmpeg-status', () => getFFmpegStatus())
  ipcMain.handle('funasr-install', (event) =>
    installFunAsr((message) => event.sender.send('funasr-install-progress', message)),
  )

  // 统计事件上报
  ipcMain.handle('stat-track', (_event, params: StatEventParams) => sendStatEvent(params))
}
