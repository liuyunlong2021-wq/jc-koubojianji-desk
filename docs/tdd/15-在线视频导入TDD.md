# TDD-15：在线视频导入

> 日期：2026-08-24  
> 状态：MVP 已实施，真实站点验收进行中
> 实施分支：`codex/online-video-import`  
> 基线：已合入影片拉片工作台的本地 `main` (`07035e4`)

## 1. 目标

在现有“影片拉片”工作台增加第二种影片来源：用户粘贴公开单条视频链接，应用使用内置 `yt-dlp` 下载后，将下载结果交给现有本地原片导入链。

下载完成后，自动切镜、人工校正、图片分析、资产提示词、视频反推、全片总览和文档导出不增加任何网络来源分支。

## 2. MVP 边界

### 2.1 本轮实施

1. 仅接受 `http:` 和 `https:` 链接。
2. 仅下载公开、单条、非直播视频。
3. 下载解析用的单文件最佳格式，高度不超过 1080p；不向用户暴露格式和清晰度参数。
4. 显示下载状态，允许用户停止当前下载。
5. 下载文件先落入程序创建的临时目录，验证通过后再原子导入项目。
6. 界面提示“请仅下载有权使用的内容”。

### 2.2 明确不做

- 播放列表、直播和多链接队列。
- 下载历史、断点续传和独立下载管理器。
- 登录、Cookie、会员内容、私密链接或自动读取浏览器数据。
- 站点专用解析器和站点适配界面。
- 任意网页图片下载。`yt-dlp` 不作为通用图片下载器；独立图片组导入另立 TDD。

## 3. 交互设计

### 3.1 影片来源入口

将左栏原有“上传影片”改为一个“导入影片”菜单：

```text
[导入影片 ▾]
  本地影片
  视频链接
```

- “本地影片”继续调用现有 `chooseFilmBreakdownSource()`。
- “视频链接”打开小对话框。
- 已有原片时，“更换影片”使用同一菜单，不再实现第二个入口。

### 3.2 链接对话框

```text
导入视频链接
[粘贴 https://...                         ]
仅支持公开的单条视频
请仅下载有权使用的内容

                         [取消] [下载并导入]
```

交互规则：

1. 去除首尾空白后校验 URL；空值、语法错误和非 HTTP(S) 协议直接阻止。
2. 未选择项目时，先复用“选择项目”流程；用户取消则不启动下载。
3. 下载期间禁用其他原片导入和会覆写项目分析状态的操作。
4. 主按钮显示“正在下载…”，同时显示“停止下载”。
5. 成功后关闭对话框、刷新原片和项目状态；失败时保留 URL 便于重试。
6. 更换原片的清空规则与本地导入完全一致，不额外弹出第二次确认。

## 4. 后端设计

### 4.1 单一原片导入函数

从现有 `chooseFilmBreakdownSource()` 中提取一个共用函数：

```ts
importFilmBreakdownSource(rootPath: string, sourceFile: string)
```

该函数是本地文件和网络文件唯一的项目写入入口，负责：

1. FFmpeg 检查视频轨和真实时长。
2. 根据已验证的源文件扩展名生成 `拉片原片.<ext>`。
3. 先复制到同目录临时文件，再原子重命名。
4. 计算 SHA-256 指纹。
5. 清空旧分析片段、抽帧、镜头、资产和全片总览。
6. 原子写入新项目状态。

`chooseFilmBreakdownSource()` 只负责选文件和选项目，然后调用该函数。网络下载函数不复制上述任何步骤。

### 4.2 URL 下载流程

```text
渲染层 URL
  ↓ IPC 结构化克隆
主进程再次校验 HTTP(S)
  ↓
fs.mkdtemp() 创建唯一临时目录
  ↓
spawn(yt-dlp, args, { shell: false })
  ↓
取得 yt-dlp 最终文件路径
  ↓
确认文件仍在临时目录内
  ↓
importFilmBreakdownSource(rootPath, downloadedFile)
  ↓
finally 删除临时目录
```

主进程新增：

```ts
downloadFilmBreakdownSource(
  rootPath: string,
  url: string,
  reportProgress: (message: string) => void,
): Promise<FilmBreakdownSourceResult>

stopFilmBreakdownSourceDownload(): void
```

应用只有一个主窗口，MVP 仅保留一个活动下载的 `AbortController`，不建立下载任务表。

### 4.3 yt-dlp 参数合同

调用参数由程序生成，不接受用户参数或网页标题插入：

```text
--no-playlist
--match-filter !is_live
--newline
--progress
--no-part
--restrict-filenames
--format bv*[height<=1080]+ba/b[height<=1080]/b
--ffmpeg-location <app-ffmpeg>
--output <temp>/source.%(ext)s
--print after_move:filepath
<validated-url>
```

优先下载不超过 1080p 的最佳视频和最佳音频，并显式复用 App 已有的内置 FFmpeg 合并；如站点提供带音频单文件则回退到该文件。2026-08-24 真实 Bilibili 解析证明单文件 `b[height<=1080]/b` 不足，因此合并为 MVP 必要能力，不是可选扩展。

不将 URL 放入 shell 字符串，不使用 `exec()`，不使用网页标题作为临时路径。

### 4.4 进度和错误

- 复用现有 `film-breakdown-progress` 事件，不新增第二套事件总线。
- 只从 yt-dlp 的换行输出中提取百分比；无法提取时显示“正在下载…”，不估算虚假进度。
- 用户停止时向子进程发送 `SIGTERM`，并返回统一文案“下载已停止”。
- yt-dlp 启动失败、站点不支持、链接无效、播放列表、直播、需登录、网络失败和下载结果不是视频，都保留可操作的简短中文错误。
- 任何失败和停止都不得修改项目已有原片和分析结果。

## 5. IPC 合同

新增两个通道：

```text
film-breakdown-source-download(rootPath, url)
film-breakdown-source-download-stop()
```

- `preload` 只暴露 `downloadSource(rootPath, url)` 和 `stopSourceDownload()`。
- IPC 只传递普通字符串和普通结果对象。
- 主进程不信任渲染层已做过的 URL 校验。
- 成功结果与 `chooseSource()` 保持同一结构：`rootPath`/`name`/`fileName`/`fingerprint`/`durationMs`。

## 6. yt-dlp 内置与打包

### 6.1 二进制

使用 yt-dlp 官方独立发行文件，不要求用户安装 Python、Homebrew 或全局 yt-dlp：

```text
runtime/yt-dlp/
├── darwin/yt-dlp      # 官方 yt-dlp_macos
├── win32/yt-dlp.exe  # 官方 yt-dlp.exe
└── linux/yt-dlp      # 官方 yt-dlp_linux
```

- 版本必须固定，不在 App 运行时自动更新。
- 构建脚本可通过固定 GitHub 转发地址获取官方发行文件，但必须根据已固定的官方 SHA-256 校验；校验失败立即终止。
- 开发环境从仓库 `runtime/yt-dlp/<platform>/` 解析，打包后从 `process.resourcesPath/yt-dlp/<platform>/` 解析。
- macOS/Linux 启动前检查可执行权限。
- `electron-builder.json5` 仅增加一条 `extraResources`，将 `runtime/yt-dlp` 复制到应用资源。

### 6.2 JavaScript 解析边界

新版 yt-dlp 对部分 YouTube 格式建议使用 `yt-dlp-ejs` 和可被发现的 JavaScript 运行时。MVP 不假定 yt-dlp 能自动使用 Electron 内置 Node；实施时先用 YouTube 真实公开链接验证。

如不携带额外运行时时已能满足单文件下载，不增加 `yt-dlp-ejs`；只有真实测试失败且错误明确指向 JS challenge 时，再将它作为本 TDD 的兼容修正。

## 7. 安全与数据保护

1. URL 在渲染层与主进程各校验一次，主进程校验是安全边界。
2. 子进程使用 `spawn(executable, args)`，不开启 shell。
3. 输出文件名固定为 `source.%(ext)s`，不使用视频标题、上传者或 URL 生成路径。
4. 对 yt-dlp 返回路径执行 `path.resolve` 和临时目录包含检查，拒绝越界路径和符号链接跳转。
5. 项目已有数据只在下载结果通过 FFmpeg 验证且新原片成功导入时才失效。
6. 临时目录在成功、失败和停止时都使用 `finally` 清理。
7. 不上传 URL，不保存下载历史，不在项目状态中保存原站链接。

## 8. 错误优先级

面向用户的错误必须先说可执行结论，不直接暴露完整 yt-dlp 日志：

| 场景 | 文案 |
| --- | --- |
| URL 不合法 | `请输入有效的 HTTP(S) 视频链接` |
| 检测到播放列表 | `暂不支持播放列表，请粘贴单条视频链接` |
| 检测到直播 | `暂不支持直播链接` |
| 需要登录/Cookie | `该视频需要登录，当前仅支持公开视频` |
| yt-dlp 不可用 | `内置视频下载组件不可用，请重新安装应用` |
| 站点/网络失败 | `视频下载失败，请检查链接和网络后重试` |
| 结果不是视频 | `下载结果不是可读取的视频` |
| 用户停止 | `下载已停止` |

开发日志可保留精简的 yt-dlp stderr 摘要，但不得包含 Cookie、请求头或任何未来可能增加的凭证。

## 9. 测试策略

### 9.1 自动测试

最小回归测试覆盖：

1. URL 校验接受 HTTP(S)，拒绝空值、非法 URL、`file:`、`javascript:` 和其他协议。
2. yt-dlp 参数强制单条、非直播、1080p 上限、固定临时输出名，URL 是独立参数。
3. 返回路径不在临时目录内时拒绝。
4. 原片共用导入函数保持现有本地导入的文件名、指纹、时长和清空规则。
5. 子进程失败、停止和 FFmpeg 验证失败时，临时目录被清理且项目旧状态不变。
6. 现有全部拉片与口播测试仍然通过。

### 9.2 真实站点冒烟测试

自动测试不代替站点兼容性验收。开发包至少验证：

1. YouTube 公开单条视频。
2. Bilibili 公开单条视频。
3. 抖音可直接访问的公开单条视频。
4. 一个无效链接和一个播放列表链接。
5. 下载中途手动停止，确认旧项目未受影响。
6. 下载成功后执行“自动切镜→确认镜头切分→图片分析”，证明网络原片没有形成第二套下游流程。

## 10. 实施顺序

1. 先为 URL 校验、参数生成和路径边界写失败测试。
2. 提取 `importFilmBreakdownSource()`，保持本地导入行为不变，并先跑通旧测试。
3. 实现 yt-dlp 可执行解析、下载、停止、临时目录清理和 IPC。
4. 实现“导入影片”菜单和链接对话框。
5. 运行自动测试、类型检查、构建和差异检查。
6. 打包内置 yt-dlp，完成三个真实站点冒烟测试。

## 11. 验收标准

1. 用户可以在同一个“导入影片”入口选择本地影片或视频链接。
2. 公开单条视频能下载、通过 FFmpeg 验证并成为项目原片。
3. 下载失败或停止不改变旧原片、镜头、资产和分析结果。
4. 成功后的网络原片可以使用全部现有拉片功能，项目状态不记录原站 URL。
5. 不安装 Python/Homebrew 的干净机器也可启动内置 yt-dlp。
6. 本地影片导入与现有 32 项自动测试无回归。

## 12. 后续独立需求

任意网页图片应使用 Node/Electron 原生 HTTP(S) 下载，然后进入一个“图片组”输入模型。每张图片可进行画面反推和资产分析，但不参与自动切镜、视频反推和时长导出。本轮不伪造一秒视频来复用视频数据结构。

## 13. 2026-08-24 实施验证

- 自动测试 `35/35` 通过，新增 URL 协议与凭据拒绝、yt-dlp 参数合同和临时路径边界测试。
- `vue-tsc --noEmit` 和 `git diff --check` 通过。
- yt-dlp 固定为 `2026.08.19`；本地官方 macOS 发行文件 SHA-256 与官方清单一致，并确认同时包含 x64 和 arm64。
- 一条公开 5.76 秒、1920×1080 MP4 已使用内置 yt-dlp 真实下载，内置 FFmpeg 成功读取视频轨、音频轨和时长，测试临时文件已清理。
- Bilibili 公开链接 `BV1xx411c7mD` 已成功解析；测试证明必须复用内置 FFmpeg 合并分离的视频和音频流，实施已按此修正。
- Universal macOS App 和 211MB DMG 构建成功，深度签名校验通过；成品 App 内 yt-dlp 版本、双架构、可执行权限和内置 FFmpeg 路径均已验证。
- Electron 影片拉片首屏已检查，“导入影片”入口布局正常，无文字溢出或重叠。继续点击时 macOS 锁屏，链接弹窗的最终人工点击验收待解锁后完成。
- YouTube 在当前网络下连接被重置，未进入 JS challenge 阶段；抖音未获得稳定公开测试链接。这两项保留为真实环境验收，不标记为已通过。
