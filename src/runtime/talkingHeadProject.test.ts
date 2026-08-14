import assert from 'node:assert/strict'
import test from 'node:test'
import { editTalkingHeadCues, formatTalkingHeadAss, isTalkingHeadEditPlanValid, normalizeTalkingHeadCues, normalizeTalkingHeadSubtitleStyle, splitTalkingHeadCues, talkingHeadHighlightLayout, talkingHeadMediaDirectories, talkingHeadMediaRelativePath, talkingHeadMediaUrl, validateTalkingHeadCues } from './talkingHeadProject.ts'

test('口播字幕单条最多 15 字并统一修复 ID', () => {
  const text = '你们是不是这样的人对着镜头夸夸二十多分钟全是干货'
  const words = [...text].map((char, index) => ({ text: char, startMs: index * 100, endMs: (index + 1) * 100 }))
  const cues = normalizeTalkingHeadCues(splitTalkingHeadCues([{ cueId: 'bad', startMs: 0, endMs: text.length * 100, recognizedText: text, confirmedText: text, words }]))
  assert.ok(cues.every((cue) => [...cue.confirmedText].length <= 15))
  assert.deepEqual(cues.map((cue) => cue.cueId), cues.map((_, index) => `cue-${String(index + 1).padStart(3, '0')}`))
  assert.doesNotThrow(() => validateTalkingHeadCues(cues))
})

test('口播项目的媒体与文档只写入 .raw/jc-media', () => {
  assert.deepEqual(talkingHeadMediaDirectories, ['视频', '文档', '图片', '音频'])
  assert.equal(talkingHeadMediaRelativePath('视频', '成片.mp4'), '.raw/jc-media/视频/成片.mp4')
  assert.equal(talkingHeadMediaRelativePath('文档', '剪辑计划.json'), '.raw/jc-media/文档/剪辑计划.json')
  assert.throws(() => talkingHeadMediaRelativePath('视频', '../outside.mp4'))
  assert.match(talkingHeadMediaUrl('/Projects/demo', '原始口播.mp4'), /^talking-head-media:\/\/asset\?/)
})

test('字幕编辑不会产生重叠时间轴', () => {
  const cues = [{ cueId: 'cue-001', startMs: 0, endMs: 500, recognizedText: '甲', confirmedText: '甲' }, { cueId: 'cue-002', startMs: 500, endMs: 1000, recognizedText: '乙', confirmedText: '乙' }]
  assert.equal(editTalkingHeadCues(cues, 'cue-001', 'set-end', 900)[0].endMs, 500)
  assert.equal(editTalkingHeadCues(cues, 'cue-001', 'merge-next', 0).length, 1)
})

test('按播放头拆分时，文字和逐字时间戳一起切开', () => {
  const cues = [{ cueId: 'cue-001', startMs: 0, endMs: 4000, recognizedText: '第一段第二段第三段', confirmedText: '第一段第二段第三段', words: [{ text: '第一段', startMs: 0, endMs: 900 }, { text: '第二段', startMs: 1000, endMs: 1900 }, { text: '第三段', startMs: 2000, endMs: 4000 }] }]
  const split = editTalkingHeadCues(cues, 'cue-001', 'split', 2100)
  assert.deepEqual(split.map((cue) => [cue.startMs, cue.endMs, cue.confirmedText]), [[0, 1950, '第一段第二段'], [1950, 4000, '第三段']])
  assert.deepEqual(split.map((cue) => cue.words?.map((word) => word.text)), [['第一段', '第二段'], ['第三段']])
})

test('确认字幕必须保持唯一 ID、有效时间轴和原始文本', () => {
  assert.deepEqual(validateTalkingHeadCues([{ cueId: 'cue-001', startMs: 0, endMs: 500, recognizedText: '原文', confirmedText: '确认稿' }]), [{ cueId: 'cue-001', startMs: 0, endMs: 500, recognizedText: '原文', confirmedText: '确认稿' }])
  assert.throws(() => validateTalkingHeadCues([{ cueId: 'cue-001', startMs: 0, endMs: 500, recognizedText: '原文', confirmedText: '确认稿' }, { cueId: 'cue-001', startMs: 500, endMs: 800, recognizedText: '重复', confirmedText: '重复' }]))
})

test('失效的结构方案会被拒绝，避免渲染不存在的字幕', () => {
  const cues = [{ cueId: 'cue-001', startMs: 0, endMs: 500, recognizedText: '原文', confirmedText: '确认稿' }]
  assert.equal(isTalkingHeadEditPlanValid({ sourceFingerprint: 'source', cueIds: ['cue-001'], removedCueIds: [], updatedAt: '' }, cues, 'source'), true)
  assert.equal(isTalkingHeadEditPlanValid({ sourceFingerprint: 'source', cueIds: ['cue-missing'], removedCueIds: [], updatedAt: '' }, cues, 'source'), false)
})

test('成片字幕使用重排后的连续时间轴并转义 ASS 文本', () => {
  const ass = formatTalkingHeadAss([
    { startMs: 0, endMs: 1200, text: '第一句' },
    { startMs: 1200, endMs: 2500, text: '第二{句}\\换行\n内容' },
  ])
  assert.match(ass, /Dialogue: 0,0:00:00\.00,0:00:01\.20,Default.*第一句/)
  assert.match(ass, /\{\\an2\\pos\(540,1459\)\}/)
  assert.match(ass, /第二\\\{句\\\}\\\\换行\\N内容/)
})

test('成片字幕样式限制字号、颜色并按字号生成描边', () => {
  assert.deepEqual(normalizeTalkingHeadSubtitleStyle({ fontFamily: '我的,字体\n', fontScale: 9, fontColor: '#ff1100', outlineColor: 'invalid' }), { fontFamily: '我的 字体', fontScale: 1.5, verticalPosition: 76, bold: true, outline: true, fontColor: '#FF1100', outlineColor: '#000000', highlightScale: 1 })
  assert.match(formatTalkingHeadAss([{ startMs: 0, endMs: 1000, text: '字幕' }], { width: 1080, height: 1920 }, { fontScale: 1, fontColor: '#FF1100', outlineColor: '#123456' }), /&H000011FF,&H000011FF,&H00563412,&HFF000000,-1,0,0,0,100,100,0,0,1,2,0/)
  const highlighted = formatTalkingHeadAss([{ cueId: 'cue-001', startMs: 0, endMs: 1000, text: 'GitHub 很好用' }], { width: 1080, height: 1920 }, undefined, [{ cueId: 'cue-001', phrase: 'GitHub', style: '结论绿' }])
  assert.match(highlighted, /Dialogue: 0.*GitHub 很好用/)
  assert.match(highlighted, /Dialogue: 1.*\\pos\(108,422\).*Git\\NHub/)
  assert.doesNotMatch(formatTalkingHeadAss([{ startMs: 0, endMs: 1000, text: '有，标点。' }]), /，|。/)
})

test('竖屏成片会把长字幕限制在安全宽度内', () => {
  const ass = formatTalkingHeadAss([{ startMs: 0, endMs: 1000, text: '给大家录制一个插除影片字幕的这么一个教程啊' }])
  assert.match(ass, /给大家录制一个插除影\\N片字幕的这么一个教程\\N啊/)
})

test('长重点词会在导出与预览共用的安全宽度内换行', () => {
  const layout = talkingHeadHighlightLayout({ cueId: 'cue-001', phrase: '是不是这样的人', style: '爆点黄', position: '左上' })
  assert.match(layout.text, /\\N/)
  assert.match(formatTalkingHeadAss([{ cueId: 'cue-001', startMs: 0, endMs: 1000, text: '你们是不是这样的人' }], undefined, undefined, [{ cueId: 'cue-001', phrase: '是不是这样的人', style: '爆点黄', position: '左上' }]), /是不是这\\N样的人/)
})
