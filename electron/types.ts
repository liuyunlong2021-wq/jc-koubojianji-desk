export interface OpenExternalParams {
  url: string
}

export type TextModel =
  | 'gemini-3.7-flash'
  | 'gemini-3.6-flash'
  | 'doubao-seed-evolving'
  | 'claude-fable-5'
  | 'claude-opus-5'
  | 'gpt-5.6-sol'
  | 'deepseek-v4-pro'

export interface StatEventParams {
  title: string
  screen?: string
  language?: string
  url?: string
  userAgent?: string
}
