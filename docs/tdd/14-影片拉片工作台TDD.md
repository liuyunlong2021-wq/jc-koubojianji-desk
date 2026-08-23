# TDD-14：影片拉片工作台

> 日期：2026-08-20  
> 状态：切镜 MVP 已实施；图片分析按“识别资产 → 用户选择 → 生成提示词”实施  
> 实施分支：`codex/film-breakdown-mvp`  
> 基线：口播剪辑器 `main`

## 1. 目标

在现有口播剪辑器内新增一个独立的“影片拉片”产品模式。用户导入原片后，先由 FFmpeg 自动检测镜头边界，再由用户人工确认或调整。确认后按时间码生成真实的短 MP4 分析片段，逐镜直接提交给 Gemini 视频理解，为每个镜头产出：

1. 视频生成提示词。
2. 以该镜头中间帧为依据的图片生成提示词。

结果逐镜持久化，并自动生成一份可继续人工编辑的 Markdown 拉片文档。

## 2. 核心原则

1. 切镜是为了降低单次视频理解的时长和幻觉，不是为了制作可交付的剪辑成片。
2. Gemini 必须直接读取每个真实 MP4 片段；禁止用抽帧代替视频理解。
3. 单帧只用于中栏缩略图和图片提示词输入。
4. 镜头边界必须先经人工确认，才能开始付费的逐镜分析。
5. 每分析完一镜立即原子保存；中断后只继续未完成镜头。
6. 口播剪辑的路由、项目数据和现有行为保持不变。

## 3. 产品入口与页面布局

### 3.1 一级模式切换

在现有项目栏最左侧增加两项分段控件：

```text
[口播剪辑] [影片拉片]  |  选择项目……
```

- `/`：现有口播剪辑工作台。
- `/film-breakdown`：新建影片拉片工作台。
- 不新增首页、侧边栏或第二个 Electron 应用。
- 拉片页面使用独立 `FilmBreakdownDesk`，不向现有 `TalkingHeadDesk` 叠加模式分支。

### 3.2 三栏工作台

```text
左栏                         中栏                              右栏
原片播放器                   镜头时间段与分析结果              镜头检测
点击某镜后只播放该区间     shot-001                         切镜灵敏度
                             时间码 / 时长 / 中间帧            [自动切镜]
                             视频提示词
                             图片提示词                      人工校正
                                                               拆分 / 合并 / 设开始 / 设结束 / 删除
                                                               [确认镜头切分]

                                                               逐镜分析
                                                               [逐镜分析]
```

中栏每行支持人工编辑两种提示词。点击行后，左侧播放器从该镜头开始点播放，到结束点自动暂停。

## 4. 项目与数据合同

拉片项目使用独立状态文件，不读写口播项目的 `项目.json`：

```text
.raw/jc-media/
├── 视频/
│   ├── 拉片原片.<ext>
│   └── 拉片分析片段/
│       ├── shot-001.mp4
│       └── shot-002.mp4
├── 图片/
│   └── 拉片中间帧/
│       ├── shot-001.jpg
│       └── shot-002.jpg
└── 文档/
    ├── 拉片项目.json
    └── 影片拉片.md
```

```ts
interface FilmBreakdownProjectState {
  schemaVersion: 1
  name: string
  createdAt: string
  updatedAt: string
  source?: {
    fileName: string
    fingerprint: string
    durationMs: number
  }
  detectionThreshold: number
  boundariesConfirmed: boolean
  shots: FilmBreakdownShot[]
}

interface FilmBreakdownShot {
  shotId: string
  startMs: number
  endMs: number
  clipFileName?: string
  frameFileName?: string
  analysisStatus: 'pending' | 'running' | 'ready' | 'failed'
  videoPrompt: string
  imagePrompt: string
  error?: string
}
```

约束：

- `shotId` 按时间顺序重新生成为 `shot-001` 开始的连续 ID。
- 第一镜从 `0` 开始，相邻镜头无缝连续，最后一镜结束于原片真实时长。
- 每镜必须满足 `0 <= startMs < endMs <= durationMs`。
- 更换原片必须清空镜头、分析片段、中间帧和分析结果。
- 修改某个边界只使与该边界相邻的镜头失效，不清空其他已完成镜头。

## 5. FFmpeg 自动切镜

### 5.1 检测

使用内置 FFmpeg `scene` 分数检测画面突变，解析命中帧的 `pts_time`，与 `0` 和原片时长合成连续镜头区间。

界面保留一个切镜灵敏度控件，默认使用“标准”。灵敏度只映射为少量固定阈值，不在 MVP 开放任意 FFmpeg 参数。

FFmpeg 检测只是候选边界：闪光、甩镜可能误切，叠化可能漏切，因此不得跳过人工确认。

### 5.2 人工校正

复用字幕工作台的播放头交互语义：

- 在当前播放头拆分所选镜头。
- 所选镜头与下一镜合并。
- 将当前播放头设为所选镜头开始或结束。
- 删除镜头时，其时间区间并入相邻镜头，不得在时间轴留空洞。

任何边界修改都会将 `boundariesConfirmed` 恢复为 `false`。

### 5.3 分析片段

确认边界后，按时间码对原片进行转码，生成适合模型读取的 720p MP4：

- H.264 视频，AAC 音频。
- 保留原片声音，便于模型结合台词、环境声和音画关系理解镜头。
- 必须转码，不使用受关键帧限制的流复制。
- 同时从镜头中点提取一张 JPEG。
- 已存在且与当前原片指纹、开始和结束时间一致的片段可复用。

## 6. Gemini 视频分析

### 6.1 模型与输入

应用的默认文本与视频理解模型为 `gemini-3.7-flash`，同时保留 `gemini-3.6-flash` 供人工切换。口播剪辑与影片拉片共用同一份模型设置。

每个镜头一次请求，输入为：

```text
当前镜头 MP4
+ 当前镜头中间帧 JPEG
+ 视频提示词反推 Prompt
+ 图片提示词反推 Prompt
```

两份正式 Prompt 由用户在 AI 接口实施前提供。此前数据模型只保留 `videoPrompt` 和 `imagePrompt` 两个字符串占位，不自行发明临时生产 Prompt。

请求必须使用网关支持的 `video_url` 视频输入合同。如果实际上传大小超过网关或 NewAPI 限制，应明确失败并显示当前片段，不得自动降级为单帧分析。

### 6.2 输出

模型结果必须与当前 `shotId` 绑定，并同时返回两个非空字段：

```ts
interface FilmBreakdownAnalysisResult {
  shotId: string
  videoPrompt: string
  imagePrompt: string
}
```

程序只校验 ID 和字段完整性，不尝试二次解析或改写用户的提示词内容。

### 6.3 执行与恢复

- 按镜头顺序逐个执行，MVP 不并发付费请求。
- `ready` 且分析片段未变的镜头自动跳过。
- 单镜头失败时记录错误并继续下一镜，不丢失已完成结果。
- 再次点击“逐镜分析”时只重试 `pending` 和 `failed`。
- 用户可随时停止；已返回结果必须保留。

## 7. Markdown 产物

每次镜头边界、分析结果或人工文字变更后，程序从 JSON 状态确定性重建：

```text
.raw/jc-media/文档/影片拉片.md
```

文档默认结构：

```markdown
# 影片拉片

- 原片：拉片原片.mp4
- 镜头数：2

## shot-001｜00:00:00.000 - 00:00:03.240

### 视频提示词

<videoPrompt>

### 图片提示词

<imagePrompt>
```

JSON 是工作状态真源，Markdown 是用户交付物。MVP 不反向解析人工在外部编辑的 Markdown。

## 8. 失效规则

| 变更 | 失效范围 |
| --- | --- |
| 更换原片 | 全部镜头、片段、中间帧和分析结果 |
| 重新自动切镜 | 全部人工边界、片段和分析结果 |
| 调整单个边界 | 该边界两侧镜头的片段、中间帧和分析结果 |
| 人工修改提示词 | 只保存当前文字，不重跑 AI |
| 更换正式 Prompt | 已有结果不自动清空；由用户显式选择重新分析 |

## 9. MVP 明确不做

- 不输出重新剪辑的成片。
- 不让 AI 决定最终切点。
- 不对多镜头合并请求。
- 不并发分析多个镜头。
- 不新增任务队列或数据库。
- 不做电影数据库、标签检索、横向对比或统计图表。
- 不支持人工选择中间帧以外的图片反推帧。
- 不抽取共享工作台框架；实际出现稳定的第三个工作台时再抽取。

## 10. 测试清单

### 10.1 纯逻辑测试

1. FFmpeg 命中时间与首尾时间合成连续、不重叠的镜头。
2. 非法、重复、越界或过近的检测点被拒绝或去重。
3. 拆分、合并、设开始、设结束和删除后时间轴仍完整连续。
4. 单边界变更只使相邻两镜头失效。
5. Gemini 返回缺失 ID、ID 不匹配或任一结果为空时拒绝写入 `ready`。
6. Markdown 按镜头顺序稳定生成，包含精确毫秒时间码和两种提示词。

### 10.2 合同测试

1. 视频分析请求包含真实 `video_url` MP4，不是图片帧集合。
2. 请求同时包含中间帧和两份正式 Prompt。
3. 一个镜头只产生一次请求，同时返回 `videoPrompt` 和 `imagePrompt`。
4. 中断后重试不再请求已完成且片段未变的镜头。
5. 网关拒绝视频时显式失败，不降级到单帧。

### 10.3 端到端验收

1. 口播剪辑的原有路由和工作流仍可使用。
2. 可从顶部切换到影片拉片，并独立记住拉片项目历史。

## 11. 图片分析（本轮）

### 11.1 执行顺序

1. 确认镜头切分时，每镜提取首帧、中间帧、尾帧三张 JPEG。
2. “资产分析”读取全片三帧，识别并跨镜头合并角色、场景、关键道具。
3. 识别结果只建立资产目录，不自动生成全部长提示词。
4. 用户在左栏按分类全选或单选资产，再点击“生成所选资产”。
5. 镜头画面反推与资产生成独立；默认选首帧，可同时选首帧、中间帧、尾帧批量生成。

### 11.2 数据合同

```ts
type FilmBreakdownFramePosition = 'start' | 'middle' | 'end'
type FilmBreakdownAssetCategory = 'character' | 'scene' | 'prop'

interface FilmBreakdownShot {
  frameFileNames?: Partial<Record<FilmBreakdownFramePosition, string>>
  imagePrompts?: Partial<Record<FilmBreakdownFramePosition, string>>
}

interface FilmBreakdownAsset {
  assetId: string
  category: FilmBreakdownAssetCategory
  name: string
  description: string
  occurrences: Array<{ shotId: string; position: FilmBreakdownFramePosition }>
  representative: { shotId: string; position: FilmBreakdownFramePosition; fileName: string }
  selected: boolean
  prompt: string
  status: 'pending' | 'running' | 'ready' | 'failed'
  error?: string
}
```

兼容旧项目：原 `frameFileName` 和 `imagePrompt` 在读取时映射为中间帧，不丢已有数据。

### 11.3 Prompt 责任

- 画面提示词：使用用户提供的《反推图片提示词》。
- 角色、场景、道具：使用《MV生成规范》中对应的三份正式规范。
- 资产识别：内置结构化 Prompt，只返回类别、名称、可见特征和出现帧；普通日用物不冒充关键道具。

### 11.4 失效与产物

- 重新自动切镜、更换原片或人工修改边界：清空全片资产目录。
- 单独重新生成某帧画面提示词：只覆盖该镜头该帧。
- 未选中的资产不请求模型，已完成资产不重复请求。
- 显式导出支持 Markdown 和 TXT，按镜头输出画面提示词，再按角色、场景、道具输出已生成的资产提示词；不夹带视频分析结果。

### 11.5 本轮不做

- 不改造视频分析模板与导出。
- 不做资产图自动裁剪、三视图生成或 Wiki 写入。
- 不做资产手工拆分/合并；先保留删除、改名和重新识别的升级位置。
3. 导入一段 3 至 10 分钟测试片，自动切镜后可逐镜预览。
4. 在播放头拆分一镜、合并一镜并确认，重启应用后边界保留。
5. 至少选取三个镜头执行真实 Gemini 视频分析，确认模型看到镜头内的连续动作和声音。
6. 两种提示词可人工编辑，重启后保留，`影片拉片.md` 与界面一致。
7. `pnpm test`、`pnpm exec vue-tsc --noEmit`、`git diff --check` 通过。

## 11. 实施顺序

1. 新增独立路由、拉片页面和项目状态。
2. 实现切镜检测、时间轴校验和人工边界编辑。
3. 生成真实 MP4 分析片段和中间帧。
4. 由用户提供两份正式 Prompt，确认 Gemini 3.7 Flash 的准确模型 ID。
5. 接入逐镜视频分析、断点续跑和 Markdown 生成。
6. 使用短片做真实付费验收，通过后再评估长片并发与任务管理。

## 12. 完成标准

MVP 只在以下条件全部满足时视为完成：

- 稳定口播剪辑流程无回归。
- 自动切镜可见、可播放、可人工修正并可恢复。
- 实际上传给 Gemini 的是经人工确认边界生成的短 MP4。
- 每镜一次请求产出视频提示词和图片提示词。
- 失败可重试、进度可续跑、人工编辑不丢失。
- 最终 Markdown 文档按镜头顺序完整可用。

## 13. 执行结果

- 已新增 `/film-breakdown` 独立路由和顶部“口播剪辑 / 影片拉片”模式切换，现有口播工作台保持独立。
- 已完成拉片项目、原片、镜头时间轴、分析状态和 Markdown 的独立持久化。
- 已完成 FFmpeg 三档自动切镜，以及播放头拆分、合并、设开始、设结束和删除。
- 已完成确认切分后逐镜转码为 720p H.264 MP4、保留可选音频，并提取中间帧。
- 已接入逐镜串行分析、停止、单镜失败继续和断点续跑；请求合同携带真实 `video_url` MP4 与中间帧。
- 已使用本地生成的 2 秒红蓝硬切片做真实桌面验收：准确得到 2 镜，并生成 2 个 MP4、2 张 JPEG、独立 JSON 和 Markdown。
- `pnpm test` 通过 `18/18`，`pnpm exec vue-tsc --noEmit`、生产 Vite/Electron 构建和 `git diff --check` 通过。
- 本轮未执行付费 Gemini 请求：两份正式 Prompt 尚未提供；界面保留占位 Prompt，模型白名单已加入并默认使用 `gemini-3.7-flash`。
