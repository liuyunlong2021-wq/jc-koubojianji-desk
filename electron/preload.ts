import { contextBridge, ipcRenderer } from 'electron'
import type { OpenExternalParams, StatEventParams, TextModel } from './types'
import type {
  TalkingHeadBackgroundMusic,
  TalkingHeadComposeOptions,
  TalkingHeadCue,
  TalkingHeadEditPlan,
  TalkingHeadHighlight,
  TalkingHeadHighlightPlan,
} from '../src/runtime/talkingHeadProject'

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
  talkingHeadProject: {
    choose: () => ipcRenderer.invoke('talking-head-project-choose'),
    show: (rootPath: string) => ipcRenderer.invoke('talking-head-project-show', rootPath),
    showOutput: (rootPath: string) => ipcRenderer.invoke('talking-head-output-show', rootPath),
    chooseSource: (rootPath?: string) => ipcRenderer.invoke('talking-head-source-choose', rootPath),
    transcribe: (rootPath: string) => ipcRenderer.invoke('talking-head-transcribe', rootPath),
    load: (rootPath: string) => ipcRenderer.invoke('talking-head-project-load', rootPath),
    previewFrame: (rootPath: string, timestampMs: number, cue?: Pick<TalkingHeadCue, 'cueId' | 'confirmedText'>, subtitleStyle?: TalkingHeadComposeOptions['subtitleStyle'], highlight?: TalkingHeadHighlight) => ipcRenderer.invoke('talking-head-preview-frame', rootPath, timestampMs, cue, subtitleStyle, highlight),
    listFonts: () => ipcRenderer.invoke('talking-head-fonts-list'),
    chooseBackgroundMusic: (rootPath: string) => ipcRenderer.invoke('talking-head-background-music-choose', rootPath),
    saveBackgroundMusic: (rootPath: string, music?: TalkingHeadBackgroundMusic) => ipcRenderer.invoke('talking-head-background-music-save', rootPath, music),
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
    testApiKey: () => ipcRenderer.invoke('cloud-test-api-key'),
    funAsrInstallStatus: () => ipcRenderer.invoke('funasr-install-status'),
    funAsrSubtitleInstallStatus: () => ipcRenderer.invoke('funasr-subtitle-install-status'),
    installFunAsr: () => ipcRenderer.invoke('funasr-install'),
    onFunAsrInstallProgress: (listener: (message: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, message: string) => listener(message)
      ipcRenderer.on('funasr-install-progress', handler)
      return () => ipcRenderer.off('funasr-install-progress', handler)
    },
  },
})
