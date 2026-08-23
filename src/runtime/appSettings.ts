import { ref } from 'vue'
import type { TextModel } from '~/electron/types'

export const DEFAULT_TEXT_MODEL: TextModel = 'gemini-3.7-flash'
export const textModelItems: Array<{ title: string; value: TextModel }> = [
  { title: 'Gemini 3.7 Flash', value: 'gemini-3.7-flash' },
  { title: 'Gemini 3.6 Flash', value: 'gemini-3.6-flash' },
  { title: '豆包', value: 'doubao-seed-evolving' },
]

const STORAGE_KEY = 'jc-app-text-model'
const allowedModels = new Set(textModelItems.map((item) => item.value))

export function resolveAppTextModel(value: string | null): TextModel {
  return value && allowedModels.has(value as TextModel) ? value as TextModel : DEFAULT_TEXT_MODEL
}

export const appTextModel = ref<TextModel>(resolveAppTextModel(localStorage.getItem(STORAGE_KEY)))

export function saveAppTextModel(value: TextModel) {
  appTextModel.value = resolveAppTextModel(value)
  localStorage.setItem(STORAGE_KEY, appTextModel.value)
}
