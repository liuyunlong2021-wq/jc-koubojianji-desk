import assert from 'node:assert/strict'
import test from 'node:test'
import { editFilmBreakdownShots, filmBreakdownFrameTimestamp, formatFilmBreakdownCompletePrompts, formatFilmBreakdownImageDocument, formatFilmBreakdownMarkdown, formatFilmBreakdownVideoDocument, groupFilmBreakdownShots, mergeFilmBreakdownAssetResults, normalizeFilmBreakdownAssets, normalizeFilmBreakdownVideoTemplates, selectFilmBreakdownAssetReferences, shotsFromSceneCuts, validateFilmBreakdownShots, type FilmBreakdownProjectState } from './filmBreakdown.ts'

test('切镜点生成首尾完整且连续的镜头时间轴', () => {
  const shots = shotsFromSceneCuts([3000, 3000, -1, 50, 7400, 9999], 8000)
  assert.deepEqual(shots.map((shot) => [shot.shotId, shot.startMs, shot.endMs]), [
    ['shot-001', 0, 3000],
    ['shot-002', 3000, 7400],
    ['shot-003', 7400, 8000],
  ])
  assert.doesNotThrow(() => validateFilmBreakdownShots(shots, 8000))
})

test('尚未检测的空镜头列表不冒充有效时间轴', () => {
  assert.throws(() => validateFilmBreakdownShots([], 8000))
})

test('人工拆分、调整和合并保持时间轴连续并只清空受影响镜头', () => {
  const ready = shotsFromSceneCuts([3000], 8000).map((shot) => ({ ...shot, analysisStatus: 'ready' as const, videoPrompt: '视频', imagePrompt: '图片', clipFileName: `${shot.shotId}.mp4` }))
  const split = editFilmBreakdownShots(ready, 'shot-002', 'split', 5000)
  assert.deepEqual(split.map((shot) => [shot.startMs, shot.endMs, shot.analysisStatus]), [[0, 3000, 'ready'], [3000, 5000, 'pending'], [5000, 8000, 'pending']])
  const moved = editFilmBreakdownShots(split, 'shot-002', 'set-start', 2500)
  assert.deepEqual(moved.map((shot) => [shot.startMs, shot.endMs]), [[0, 2500], [2500, 5000], [5000, 8000]])
  assert.ok(moved.slice(0, 2).every((shot) => shot.analysisStatus === 'pending'))
  const merged = editFilmBreakdownShots(moved, 'shot-002', 'merge-next', 0)
  assert.deepEqual(merged.map((shot) => [shot.startMs, shot.endMs]), [[0, 2500], [2500, 8000]])
})

test('删除镜头会并入相邻镜头而不留下空洞', () => {
  const shots = shotsFromSceneCuts([1000, 2000], 3000)
  assert.deepEqual(editFilmBreakdownShots(shots, 'shot-002', 'delete', 0).map((shot) => [shot.startMs, shot.endMs]), [[0, 2000], [2000, 3000]])
  assert.deepEqual(editFilmBreakdownShots(shots, 'shot-001', 'delete', 0).map((shot) => [shot.startMs, shot.endMs]), [[0, 2000], [2000, 3000]])
})

test('Markdown 按镜头顺序包含毫秒时间码和两种提示词', () => {
  const state: FilmBreakdownProjectState = { schemaVersion: 1, name: '测试', createdAt: '', updatedAt: '', source: { fileName: '电影.mp4', fingerprint: 'x', durationMs: 8000 }, detectionThreshold: .3, boundariesConfirmed: true, shots: shotsFromSceneCuts([3000], 8000) }
  state.shots[0].videoPrompt = '推镜头'
  state.shots[0].imagePrompt = '逆光人像'
  const markdown = formatFilmBreakdownMarkdown(state)
  assert.match(markdown, /shot-001｜00:00:00\.000 - 00:00:03\.000/)
  assert.match(markdown, /推镜头[\s\S]*逆光人像/)
})

test('首帧、中间帧和尾帧时间都留在当前镜头内', () => {
  const shot = shotsFromSceneCuts([920], 1800)[0]
  assert.deepEqual(['start', 'middle', 'end'].map((position) => filmBreakdownFrameTimestamp(shot, position as 'start' | 'middle' | 'end')), [0, 460, 840])
})

test('资产识别结果只保留真实镜头帧并按类别稳定编号', () => {
  const shots = shotsFromSceneCuts([920], 1800).map((shot) => ({ ...shot, frameFileNames: { start: `${shot.shotId}-start.jpg`, middle: `${shot.shotId}-middle.jpg`, end: `${shot.shotId}-end.jpg` } }))
  const assets = normalizeFilmBreakdownAssets([
    { category: 'character', name: '女主角', description: '东亚青年女性', occurrences: [{ shotId: 'shot-001', position: 'start' }, { shotId: 'bad', position: 'start' }] },
    { category: 'prop', name: '落地风扇', description: '灰绿色金属风扇', occurrences: [{ shotId: 'shot-002', position: 'middle' }] },
    { category: 'prop', name: '无效', description: '', occurrences: [] },
  ], shots)
  assert.deepEqual(assets.map((asset) => [asset.assetId, asset.name, asset.occurrences.length, asset.representative.fileName]), [
    ['character-001', '女主角', 1, 'shot-001-start.jpg'],
    ['prop-001', '落地风扇', 1, 'shot-002-middle.jpg'],
  ])
})

test('资产参考帧覆盖全部出现范围而不是只取开头相邻画面', () => {
  const occurrences = Array.from({ length: 20 }, (_, index) => ({ shotId: `shot-${String(index + 1).padStart(3, '0')}`, position: 'middle' as const }))
  assert.deepEqual(selectFilmBreakdownAssetReferences(occurrences, 6).map((item) => item.shotId), ['shot-001', 'shot-005', 'shot-009', 'shot-012', 'shot-016', 'shot-020'])
})

test('资产参考帧先按镜头时间排序再抽样', () => {
  const occurrences = [
    { shotId: 'shot-010', position: 'end' as const },
    { shotId: 'shot-002', position: 'middle' as const },
    { shotId: 'shot-001', position: 'start' as const },
  ]
  assert.deepEqual(selectFilmBreakdownAssetReferences(occurrences).map((item) => `${item.shotId}-${item.position}`), ['shot-001-start', 'shot-002-middle', 'shot-010-end'])
})

test('重新资产分析保留同名资产的生成结果和选择状态', () => {
  const previous = normalizeFilmBreakdownAssets([{ category: 'character', name: '女主角', description: '旧描述', occurrences: [{ shotId: 'shot-001', position: 'start' }] }], [{ ...shotsFromSceneCuts([], 1000)[0], frameFileNames: { start: 'a.jpg' } }])
  previous[0].assetId = 'character-009'
  previous[0].prompt = '已生成'
  previous[0].status = 'ready'
  previous[0].selected = true
  const next = normalizeFilmBreakdownAssets([{ category: 'character', name: '女主角', description: '新描述', occurrences: [{ shotId: 'shot-001', position: 'start' }] }], [{ ...shotsFromSceneCuts([], 1000)[0], frameFileNames: { start: 'b.jpg' } }])
  const merged = mergeFilmBreakdownAssetResults(next, previous)
  assert.deepEqual([merged[0].assetId, merged[0].prompt, merged[0].status, merged[0].selected], ['character-009', '已生成', 'ready', true])
})

test('图片文档包含逐帧提示词和已生成的资产提示词', () => {
  const state: FilmBreakdownProjectState = { schemaVersion: 1, name: '测试', createdAt: '', updatedAt: '', source: { fileName: '电影.mp4', fingerprint: 'x', durationMs: 8000 }, detectionThreshold: .3, boundariesConfirmed: true, shots: shotsFromSceneCuts([], 8000), imageAssets: [] }
  state.shots[0].imagePrompts = { start: '首帧画面' }
  state.imageAssets = normalizeFilmBreakdownAssets([{ category: 'scene', name: '木屋', description: '夏日室内', occurrences: [{ shotId: 'shot-001', position: 'start' }] }], [{ ...state.shots[0], frameFileNames: { start: 'start.jpg' } }])
  state.imageAssets[0].status = 'ready'
  state.imageAssets[0].prompt = '木屋空镜提示词'
  const markdown = formatFilmBreakdownMarkdown(state)
  assert.match(markdown, /首帧图片提示词[\s\S]*首帧画面[\s\S]*场景资产[\s\S]*木屋空镜提示词/)
  const exported = formatFilmBreakdownImageDocument(state, 'txt')
  assert.match(exported, /首帧画面[\s\S]*木屋空镜提示词/)
  assert.doesNotMatch(exported, /视频提示词|^#/m)
})

test('视频模板去重、排序并拒绝空选择', () => {
  assert.deepEqual(normalizeFilmBreakdownVideoTemplates(['script', 'video-prompt', 'script']), ['video-prompt', 'script'])
  assert.throws(() => normalizeFilmBreakdownVideoTemplates([]), /至少选择一种视频分析模板/)
})

test('视频文档兼容旧视频提示词并按固定顺序导出多模板', () => {
  const state: FilmBreakdownProjectState = { schemaVersion: 1, name: '测试', createdAt: '', updatedAt: '', source: { fileName: '电影.mp4', fingerprint: 'x', durationMs: 8000 }, detectionThreshold: .3, boundariesConfirmed: true, shots: shotsFromSceneCuts([3000], 8000) }
  state.shots[0].videoPrompt = '旧版视频提示词'
  state.shots[0].videoResults = { script: '内景。人物走进房间。' }
  const markdown = formatFilmBreakdownVideoDocument(state, ['script', 'video-prompt'], 'md')
  assert.match(markdown, /视频提示词[\s\S]*旧版视频提示词[\s\S]*剧本[\s\S]*人物走进房间/)
  const text = formatFilmBreakdownVideoDocument(state, ['video-prompt', 'script'], 'txt')
  assert.doesNotMatch(text, /^#/m)
  assert.doesNotMatch(text, /图片提示词|资产提示词/)
})

test('完整提示词按 4-30 秒目标寻找最近镜头边界', () => {
  const shots = shotsFromSceneCuts([3000, 7000, 11000], 16000)
  assert.deepEqual(groupFilmBreakdownShots(shots, 10).map((group) => group.map((shot) => shot.shotId)), [['shot-001', 'shot-002', 'shot-003'], ['shot-004']])
  assert.throws(() => groupFilmBreakdownShots(shots, 3), /4-30/)
  assert.throws(() => groupFilmBreakdownShots(shots, 31), /4-30/)
})

test('完整提示词由程序拼装全局总览、片段资产占位符和归零镜头时间', () => {
  const shots = shotsFromSceneCuts([3000], 8000)
  shots[0].videoPrompt = '镜头1（0至3秒）\n摄影：中景'
  shots[1].videoPrompt = '镜头2（3至8秒）\n摄影：特写'
  const state: FilmBreakdownProjectState = {
    schemaVersion: 1, name: '测试', createdAt: '', updatedAt: '', source: { fileName: '电影.mp4', fingerprint: 'x', durationMs: 8000 }, detectionThreshold: .3, boundariesConfirmed: true, shots,
    videoOverview: { narrative: '相遇 → 告别', lightingPhilosophy: '窗外柔光', colorGrading: '低饱和', timeRules: '', setting: '木屋', ambientSound: '风声', crowd: '无', technicalConstraints: ['角色一致', 'no subtitles'], shotRoles: { 'shot-001': 'HOOK', 'shot-002': 'RIDE OUT' } },
  }
  state.imageAssets = normalizeFilmBreakdownAssets([
    { category: 'character', name: '扎马尾印花吊带裙女子', description: '年轻女子', occurrences: [{ shotId: 'shot-001', position: 'start' }] },
    { category: 'prop', name: '浅蓝色复古落地风扇', description: '风扇', occurrences: [{ shotId: 'shot-002', position: 'start' }] },
  ], shots.map((shot) => ({ ...shot, frameFileNames: { start: `${shot.shotId}.jpg` } })))
  const output = formatFilmBreakdownCompletePrompts(state, 4, 'txt')
  assert.match(output, /片段1[\s\S]*@Image1 = 扎马尾印花吊带裙女子[\s\S]*镜头1（0至3秒） HOOK[\s\S]*参考资产：@Image1/)
  assert.match(output, /片段2[\s\S]*@Image1 = 浅蓝色复古落地风扇[\s\S]*镜头1（0至5秒） RIDE OUT/)
  assert.match(output, /灯光哲学：窗外柔光[\s\S]*技术约束：[\s\S]*角色一致/)
})
