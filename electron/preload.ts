import { contextBridge, ipcRenderer } from 'electron'
import type { OpenExternalParams, StatEventParams, TextModel } from './types'
import { toIpcValue } from '../src/runtime/ipcValue'
import type {
  TalkingHeadBackgroundMusic,
  TalkingHeadComposeOptions,
  TalkingHeadCue,
  TalkingHeadEditPlan,
  TalkingHeadHighlight,
  TalkingHeadHighlightPlan,
} from '../src/runtime/talkingHeadProject'

const filmInvoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args.map(toIpcValue))

contextBridge.exposeInMainWorld('i18n', {
  getLocalesPath: () => ipcRenderer.invoke('i18n-getLocalesPath'),
  getLanguage: () => ipcRenderer.invoke('i18n-getLanguage'),
  changeLanguage: (lng: string) => ipcRenderer.invoke('i18n-changeLanguage', lng),
  onLanguageChanged: (listener: (lng: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, lng: string) => listener(lng)
    ipcRenderer.on('i18n-changeLanguage', handler)
    return () => ipcRenderer.off('i18n-changeLanguage', handler)
  },
})

contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  isWinMaxed: () => ipcRenderer.invoke('is-win-maxed'),
  winMin: () => ipcRenderer.send('win-min'),
  winMax: () => ipcRenderer.send('win-max'),
  winClose: () => ipcRenderer.send('win-close'),
  setZoomFactor: (factor: number) => ipcRenderer.send('set-zoom-factor', factor),
  openExternal: (params: OpenExternalParams) => ipcRenderer.invoke('open-external', params),
  statTrack: (params: StatEventParams) => ipcRenderer.invoke('stat-track', params),
  filmBreakdownProject: {
    choose: () => filmInvoke('film-breakdown-project-choose'),
    show: (rootPath: string) => filmInvoke('film-breakdown-project-show', rootPath),
    chooseSource: (rootPath?: string) => filmInvoke('film-breakdown-source-choose', rootPath),
    downloadSource: (rootPath: string, url: string) => filmInvoke('film-breakdown-source-download', rootPath, url),
    stopSourceDownload: () => filmInvoke('film-breakdown-source-download-stop'),
    load: (rootPath: string) => filmInvoke('film-breakdown-project-load', rootPath),
    detect: (rootPath: string, threshold: number) => filmInvoke('film-breakdown-detect', rootPath, threshold),
    saveShots: (rootPath: string, shots: import('../src/runtime/filmBreakdown').FilmBreakdownShot[]) => filmInvoke('film-breakdown-shots-save', rootPath, shots),
    confirmShots: (rootPath: string) => filmInvoke('film-breakdown-shots-confirm', rootPath),
    savePrompt: (rootPath: string, shotId: string, videoPrompt: string, imagePrompt: string) => filmInvoke('film-breakdown-prompt-save', rootPath, shotId, videoPrompt, imagePrompt),
    saveVideoResult: (rootPath: string, shotId: string, template: import('../src/runtime/filmBreakdown').FilmBreakdownVideoTemplate, prompt: string) => filmInvoke('film-breakdown-video-result-save', rootPath, shotId, template, prompt),
    analyze: (rootPath: string, textModel: TextModel, templates: import('../src/runtime/filmBreakdown').FilmBreakdownVideoTemplate[]) => filmInvoke('film-breakdown-analyze', rootPath, textModel, templates),
    identifyAssets: (rootPath: string, textModel: TextModel) => filmInvoke('film-breakdown-assets-identify', rootPath, textModel),
    saveAssetSelection: (rootPath: string, selectedIds: string[]) => filmInvoke('film-breakdown-assets-select', rootPath, selectedIds),
    saveFramePrompt: (rootPath: string, shotId: string, position: import('../src/runtime/filmBreakdown').FilmBreakdownFramePosition, prompt: string) => filmInvoke('film-breakdown-frame-prompt-save', rootPath, shotId, position, prompt),
    saveAssetPrompt: (rootPath: string, assetId: string, prompt: string) => filmInvoke('film-breakdown-asset-prompt-save', rootPath, assetId, prompt),
    generateFramePrompts: (rootPath: string, textModel: TextModel, positions: import('../src/runtime/filmBreakdown').FilmBreakdownFramePosition[]) => filmInvoke('film-breakdown-frame-prompts-generate', rootPath, textModel, positions),
    generateAssetPrompts: (rootPath: string, textModel: TextModel) => filmInvoke('film-breakdown-asset-prompts-generate', rootPath, textModel),
    exportImages: (rootPath: string, format: 'md' | 'txt') => filmInvoke('film-breakdown-images-export', rootPath, format),
    exportVideos: (rootPath: string, templates: import('../src/runtime/filmBreakdown').FilmBreakdownVideoTemplate[], format: 'md' | 'txt') => filmInvoke('film-breakdown-videos-export', rootPath, templates, format),
    generateOverview: (rootPath: string, textModel: TextModel) => filmInvoke('film-breakdown-overview-generate', rootPath, textModel),
    saveOverview: (rootPath: string, overview: import('../src/runtime/filmBreakdown').FilmBreakdownVideoOverview) => filmInvoke('film-breakdown-overview-save', rootPath, overview),
    exportCompletePrompts: (rootPath: string, targetSeconds: number, format: 'md' | 'txt') => filmInvoke('film-breakdown-complete-prompts-export', rootPath, targetSeconds, format),
    stopAnalysis: (rootPath: string) => filmInvoke('film-breakdown-analysis-stop', rootPath),
    onProgress: (listener: (message: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, message: string) => listener(message)
      ipcRenderer.on('film-breakdown-progress', handler)
      return () => ipcRenderer.off('film-breakdown-progress', handler)
    },
  },
  talkingHeadProject: {
    choose: () => ipcRenderer.invoke('talking-head-project-choose'),
    rename: (rootPath: string, name: string) => ipcRenderer.invoke('talking-head-project-rename', rootPath, name),
    show: (rootPath: string) => ipcRenderer.invoke('talking-head-project-show', rootPath),
    showOutput: (rootPath: string) => ipcRenderer.invoke('talking-head-output-show', rootPath),
    chooseSource: (rootPath?: string) => ipcRenderer.invoke('talking-head-source-choose', rootPath),
    transcribe: (rootPath: string) => ipcRenderer.invoke('talking-head-transcribe', rootPath),
    load: (rootPath: string) => ipcRenderer.invoke('talking-head-project-load', rootPath),
    previewFrame: (rootPath: string, timestampMs: number, cue?: Pick<TalkingHeadCue, 'cueId' | 'confirmedText'>, subtitleStyle?: TalkingHeadComposeOptions['subtitleStyle'], highlight?: TalkingHeadHighlight) => ipcRenderer.invoke('talking-head-preview-frame', rootPath, timestampMs, cue, subtitleStyle, highlight),
    listFonts: () => ipcRenderer.invoke('talking-head-fonts-list'),
    chooseBackgroundMusic: (rootPath: string) => ipcRenderer.invoke('talking-head-background-music-choose', rootPath),
    saveBackgroundMusic: (rootPath: string, music?: TalkingHeadBackgroundMusic) => ipcRenderer.invoke('talking-head-background-music-save', rootPath, music),
    saveSubtitleStyle: (rootPath: string, style: TalkingHeadComposeOptions['subtitleStyle']) => ipcRenderer.invoke('talking-head-subtitle-style-save', rootPath, style),
    setSoundEffectsEnabled: (rootPath: string, enabled: boolean) => ipcRenderer.invoke('talking-head-sound-effects-enabled', rootPath, enabled),
    prepareSoundEffects: (rootPath: string) => ipcRenderer.invoke('talking-head-sound-effects-prepare', rootPath),
    saveCues: (rootPath: string, cues: TalkingHeadCue[]) => ipcRenderer.invoke('talking-head-cues-save', rootPath, cues),
    saveEditPlan: (rootPath: string, plan: TalkingHeadEditPlan) => ipcRenderer.invoke('talking-head-edit-plan-save', rootPath, plan),
    generateEditPlan: (rootPath: string, textModel: TextModel, instruction: string) => ipcRenderer.invoke('talking-head-edit-plan-generate', rootPath, textModel, instruction),
    generateHighlights: (rootPath: string, textModel: TextModel) => ipcRenderer.invoke('talking-head-highlights-generate', rootPath, textModel),
    saveHighlights: (rootPath: string, plan: TalkingHeadHighlightPlan) => ipcRenderer.invoke('talking-head-highlights-save', rootPath, plan),
    compose: (rootPath: string, options: TalkingHeadComposeOptions) => ipcRenderer.invoke('talking-head-compose', rootPath, options),
    calibrate: (rootPath: string, textModel: TextModel, instruction: string) => ipcRenderer.invoke('talking-head-cues-calibrate', rootPath, textModel, instruction),
    restoreRecognized: (rootPath: string) => ipcRenderer.invoke('talking-head-cues-restore-recognized', rootPath),
    onProgress: (listener: (message: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, message: string) => listener(message)
      ipcRenderer.on('talking-head-progress', handler)
      return () => ipcRenderer.off('talking-head-progress', handler)
    },
  },
  cloud: {
    hasApiKey: () => ipcRenderer.invoke('cloud-has-api-key'),
    saveApiKey: (apiKey: string) => ipcRenderer.invoke('cloud-save-api-key', apiKey),
    testApiKey: (textModel: TextModel) => ipcRenderer.invoke('cloud-test-api-key', textModel),
    funAsrInstallStatus: () => ipcRenderer.invoke('funasr-install-status'),
    funAsrSubtitleInstallStatus: () => ipcRenderer.invoke('funasr-subtitle-install-status'),
    scanFunAsr: () => ipcRenderer.invoke('funasr-scan'),
    ffmpegStatus: () => ipcRenderer.invoke('ffmpeg-status'),
    installFunAsr: () => ipcRenderer.invoke('funasr-install'),
    onFunAsrInstallProgress: (listener: (message: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, message: string) => listener(message)
      ipcRenderer.on('funasr-install-progress', handler)
      return () => ipcRenderer.off('funasr-install-progress', handler)
    },
  },
})
