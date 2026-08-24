/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    APP_ROOT: string
    VITE_PUBLIC: string
  }
}

interface Window {
  i18n: {
    getLocalesPath: () => Promise<string>
    getLanguage: () => Promise<string>
    changeLanguage: (lng: string) => Promise<string>
    onLanguageChanged: (listener: (lng: string) => void) => () => void
  }
  electron: {
    platform: NodeJS.Platform
    isWinMaxed: () => Promise<boolean>
    winMin: () => void
    winMax: () => void
    winClose: () => void
    setZoomFactor: (factor: number) => void
    openExternal: (params: import('./types').OpenExternalParams) => Promise<void>
    statTrack: (params: import('./types').StatEventParams) => Promise<void>
    filmBreakdownProject: {
      choose: () => Promise<{ rootPath: string; name: string } | null>
      show: (rootPath: string) => Promise<string>
      chooseSource: (rootPath?: string) => Promise<{ rootPath: string; name: string; fileName: string; fingerprint: string; durationMs: number } | null>
      downloadSource: (rootPath: string, url: string) => Promise<{ rootPath: string; name: string; fileName: string; fingerprint: string; durationMs: number }>
      stopSourceDownload: () => Promise<void>
      load: (rootPath: string) => Promise<import('../src/runtime/filmBreakdown').FilmBreakdownProjectState>
      detect: (rootPath: string, threshold: number) => Promise<{ shots: import('../src/runtime/filmBreakdown').FilmBreakdownShot[] }>
      saveShots: (rootPath: string, shots: import('../src/runtime/filmBreakdown').FilmBreakdownShot[]) => Promise<{ shots: import('../src/runtime/filmBreakdown').FilmBreakdownShot[] }>
      confirmShots: (rootPath: string) => Promise<{ shots: import('../src/runtime/filmBreakdown').FilmBreakdownShot[] }>
      savePrompt: (rootPath: string, shotId: string, videoPrompt: string, imagePrompt: string) => Promise<import('../src/runtime/filmBreakdown').FilmBreakdownShot>
      saveVideoResult: (rootPath: string, shotId: string, template: import('../src/runtime/filmBreakdown').FilmBreakdownVideoTemplate, prompt: string) => Promise<import('../src/runtime/filmBreakdown').FilmBreakdownShot>
      analyze: (rootPath: string, textModel: import('./types').TextModel, templates: import('../src/runtime/filmBreakdown').FilmBreakdownVideoTemplate[]) => Promise<{ shots: import('../src/runtime/filmBreakdown').FilmBreakdownShot[] }>
      identifyAssets: (rootPath: string, textModel: import('./types').TextModel) => Promise<{ assets: import('../src/runtime/filmBreakdown').FilmBreakdownAsset[] }>
      saveAssetSelection: (rootPath: string, selectedIds: string[]) => Promise<{ assets: import('../src/runtime/filmBreakdown').FilmBreakdownAsset[] }>
      saveFramePrompt: (rootPath: string, shotId: string, position: import('../src/runtime/filmBreakdown').FilmBreakdownFramePosition, prompt: string) => Promise<import('../src/runtime/filmBreakdown').FilmBreakdownShot>
      saveAssetPrompt: (rootPath: string, assetId: string, prompt: string) => Promise<import('../src/runtime/filmBreakdown').FilmBreakdownAsset>
      generateFramePrompts: (rootPath: string, textModel: import('./types').TextModel, positions: import('../src/runtime/filmBreakdown').FilmBreakdownFramePosition[]) => Promise<{ shots: import('../src/runtime/filmBreakdown').FilmBreakdownShot[] }>
      generateAssetPrompts: (rootPath: string, textModel: import('./types').TextModel) => Promise<{ assets: import('../src/runtime/filmBreakdown').FilmBreakdownAsset[] }>
      exportImages: (rootPath: string, format: 'md' | 'txt') => Promise<string | null>
      exportVideos: (rootPath: string, templates: import('../src/runtime/filmBreakdown').FilmBreakdownVideoTemplate[], format: 'md' | 'txt') => Promise<string | null>
      generateOverview: (rootPath: string, textModel: import('./types').TextModel) => Promise<{ videoOverview: import('../src/runtime/filmBreakdown').FilmBreakdownVideoOverview }>
      saveOverview: (rootPath: string, overview: import('../src/runtime/filmBreakdown').FilmBreakdownVideoOverview) => Promise<{ videoOverview: import('../src/runtime/filmBreakdown').FilmBreakdownVideoOverview }>
      exportCompletePrompts: (rootPath: string, targetSeconds: number, format: 'md' | 'txt') => Promise<string | null>
      stopAnalysis: (rootPath: string) => Promise<void>
      onProgress: (listener: (message: string) => void) => () => void
    }
    talkingHeadProject: {
      choose: () => Promise<{ rootPath: string; name: string } | null>
      rename: (rootPath: string, name: string) => Promise<{ rootPath: string; name: string }>
      show: (rootPath: string) => Promise<string>
      showOutput: (rootPath: string) => Promise<string>
      chooseSource: (rootPath?: string) => Promise<{ rootPath: string; name: string; fileName: string; fingerprint: string; durationMs: number } | null>
      transcribe: (rootPath: string) => Promise<{ cues: import('../src/runtime/talkingHeadProject').TalkingHeadCue[] }>
      load: (rootPath: string) => Promise<import('../src/runtime/talkingHeadProject').TalkingHeadProjectState>
      previewFrame: (rootPath: string, timestampMs: number, cue?: Pick<import('../src/runtime/talkingHeadProject').TalkingHeadCue, 'cueId' | 'confirmedText'>, subtitleStyle?: import('../src/runtime/talkingHeadProject').TalkingHeadComposeOptions['subtitleStyle'], highlight?: import('../src/runtime/talkingHeadProject').TalkingHeadHighlight) => Promise<string>
      listFonts: () => Promise<string[]>
      chooseBackgroundMusic: (rootPath: string) => Promise<import('../src/runtime/talkingHeadProject').TalkingHeadBackgroundMusic | null>
      saveBackgroundMusic: (rootPath: string, music?: import('../src/runtime/talkingHeadProject').TalkingHeadBackgroundMusic) => Promise<{ backgroundMusic?: import('../src/runtime/talkingHeadProject').TalkingHeadBackgroundMusic }>
      saveSubtitleStyle: (rootPath: string, style: import('../src/runtime/talkingHeadProject').TalkingHeadSubtitleStyle) => Promise<{ subtitleStyle: import('../src/runtime/talkingHeadProject').TalkingHeadSubtitleStyle }>
      setSoundEffectsEnabled: (rootPath: string, enabled: boolean) => Promise<boolean>
      prepareSoundEffects: (rootPath: string) => Promise<Array<{ style: import('../src/runtime/talkingHeadProject').TalkingHeadHighlightStyle; fileName: string; label: string }>>
      saveCues: (rootPath: string, cues: import('../src/runtime/talkingHeadProject').TalkingHeadCue[]) => Promise<{ cues: import('../src/runtime/talkingHeadProject').TalkingHeadCue[] }>
      saveEditPlan: (rootPath: string, plan: import('../src/runtime/talkingHeadProject').TalkingHeadEditPlan) => Promise<{ plan: import('../src/runtime/talkingHeadProject').TalkingHeadEditPlan }>
      generateEditPlan: (rootPath: string, textModel: import('./types').TextModel, instruction: string) => Promise<{ plan: import('../src/runtime/talkingHeadProject').TalkingHeadEditPlan }>
      generateHighlights: (rootPath: string, textModel: import('./types').TextModel) => Promise<{ items: import('../src/runtime/talkingHeadProject').TalkingHeadHighlight[] }>
      saveHighlights: (rootPath: string, plan: import('../src/runtime/talkingHeadProject').TalkingHeadHighlightPlan) => Promise<{ plan: import('../src/runtime/talkingHeadProject').TalkingHeadHighlightPlan }>
      compose: (rootPath: string, options: import('../src/runtime/talkingHeadProject').TalkingHeadComposeOptions) => Promise<{ fileName: string }>
      calibrate: (rootPath: string, textModel: import('./types').TextModel, instruction: string) => Promise<{ createdAt: string; instruction: string; suggestions: Array<{ cueId: string; text: string }> }>
      restoreRecognized: (rootPath: string) => Promise<{ cues: import('../src/runtime/talkingHeadProject').TalkingHeadCue[] }>
      onProgress: (listener: (message: string) => void) => () => void
    }
    cloud: {
      hasApiKey: () => Promise<boolean>
      saveApiKey: (apiKey: string) => Promise<boolean>
      testApiKey: (textModel: import('./types').TextModel) => Promise<boolean>
      funAsrInstallStatus: () => Promise<{ state: 'ready' | 'missing' | 'installing' | 'failed'; message: string }>
      funAsrSubtitleInstallStatus: () => Promise<{ state: 'ready' | 'missing' | 'installing' | 'failed'; message: string }>
      scanFunAsr: () => Promise<{ state: 'ready' | 'missing' | 'installing' | 'failed'; message: string }>
      ffmpegStatus: () => Promise<{ state: 'ready' | 'failed'; message: string }>
      installFunAsr: () => Promise<{ state: 'ready' | 'missing' | 'installing' | 'failed'; message: string }>
      onFunAsrInstallProgress: (listener: (message: string) => void) => () => void
    }
  }
}
