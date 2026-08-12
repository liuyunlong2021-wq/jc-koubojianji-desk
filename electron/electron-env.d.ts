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
    talkingHeadProject: {
      choose: () => Promise<{ rootPath: string; name: string } | null>
      show: (rootPath: string) => Promise<string>
      showOutput: (rootPath: string) => Promise<string>
      chooseSource: (rootPath?: string) => Promise<{ rootPath: string; name: string; fileName: string; fingerprint: string; durationMs: number } | null>
      transcribe: (rootPath: string) => Promise<{ cues: import('../src/runtime/talkingHeadProject').TalkingHeadCue[] }>
      load: (rootPath: string) => Promise<import('../src/runtime/talkingHeadProject').TalkingHeadProjectState>
      listFonts: () => Promise<string[]>
      chooseBackgroundMusic: (rootPath: string) => Promise<import('../src/runtime/talkingHeadProject').TalkingHeadBackgroundMusic | null>
      saveBackgroundMusic: (rootPath: string, music?: import('../src/runtime/talkingHeadProject').TalkingHeadBackgroundMusic) => Promise<{ backgroundMusic?: import('../src/runtime/talkingHeadProject').TalkingHeadBackgroundMusic }>
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
      testApiKey: () => Promise<boolean>
      funAsrInstallStatus: () => Promise<{ state: 'ready' | 'missing' | 'installing' | 'failed'; message: string }>
      funAsrSubtitleInstallStatus: () => Promise<{ state: 'ready' | 'missing' | 'installing' | 'failed'; message: string }>
      installFunAsr: () => Promise<{ state: 'ready' | 'missing' | 'installing' | 'failed'; message: string }>
      onFunAsrInstallProgress: (listener: (message: string) => void) => () => void
    }
  }
}
