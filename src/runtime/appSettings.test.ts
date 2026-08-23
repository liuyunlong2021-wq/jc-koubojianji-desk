import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_TEXT_MODEL, resolveAppTextModel } from './appSettings.ts'

test('应用文本模型默认使用 Gemini 3.7 Flash，并拒绝未知旧值', () => {
  assert.equal(DEFAULT_TEXT_MODEL, 'gemini-3.7-flash')
  assert.equal(resolveAppTextModel(null), 'gemini-3.7-flash')
  assert.equal(resolveAppTextModel('unknown'), 'gemini-3.7-flash')
  assert.equal(resolveAppTextModel('gemini-3.6-flash'), 'gemini-3.6-flash')
})
