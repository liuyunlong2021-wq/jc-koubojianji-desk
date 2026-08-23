import assert from 'node:assert/strict'
import test from 'node:test'
import { reactive } from 'vue'
import { toIpcValue } from './ipcValue.ts'
import { parseModelJson } from './modelJson.ts'

test('IPC 边界把 Vue 响应式数据转换为普通可克隆值', () => {
  const source = reactive({ templates: ['video-prompt'], nested: { selected: true } })
  const value = toIpcValue(source)
  assert.deepEqual(value, { templates: ['video-prompt'], nested: { selected: true } })
  assert.doesNotThrow(() => structuredClone(value))
})

test('模型 JSON 解析兼容代码块和前后说明', () => {
  assert.deepEqual(parseModelJson('说明\n```json\n{"assets":[]}\n```', '资产识别'), { assets: [] })
})

test('模型 JSON 无法恢复时提供任务、截断状态和响应摘要', () => {
  assert.throws(() => parseModelJson('我看到了人物，但没有按要求输出。', '资产识别第 2/3 批', 'length'), /资产识别第 2\/3 批.*输出被截断.*我看到了人物/)
})
