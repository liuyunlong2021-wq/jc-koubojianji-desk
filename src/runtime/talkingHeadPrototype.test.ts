import assert from 'node:assert/strict'
import test from 'node:test'
import { movePrototypeCue, togglePrototypeCue, type PrototypeCue } from './talkingHeadPrototype.ts'

const cues: PrototypeCue[] = [
  { cueId: 'cue-01', startMs: 0, endMs: 4000, text: '第一句', removed: false },
  { cueId: 'cue-02', startMs: 4000, endMs: 8000, text: '第二句', removed: false },
]

test('结构编辑原型可重排并删除或恢复原始 cue', () => {
  assert.deepEqual(movePrototypeCue(cues, 'cue-02', -1).map((cue) => cue.cueId), ['cue-02', 'cue-01'])
  assert.equal(togglePrototypeCue(cues, 'cue-01')[0].removed, true)
  assert.equal(togglePrototypeCue(togglePrototypeCue(cues, 'cue-01'), 'cue-01')[0].removed, false)
})
