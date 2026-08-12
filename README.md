# 口播剪辑器

桌面端口播视频整理与剪辑工具：导入原视频，使用本地 FunASR 识别字幕，完成字幕校准、结构重排、重点大字、音乐和音效设置，最后用 FFmpeg 输出成片。

## 开发

需要 Node.js 22、pnpm 10。

```bash
pnpm install
pnpm dev
```

验证：

```bash
pnpm exec vue-tsc --noEmit
pnpm test
```

## 项目文件

每个项目由用户选择的项目文件夹承载，媒体和文档统一写入：

```text
项目文件夹/
  .raw/jc-media/
    视频/
    文档/
    图片/
    音频/
```

成片位于 `.raw/jc-media/视频/`，项目文档位于 `.raw/jc-media/文档/`。应用数据、FunASR 环境和模型使用口播剪辑器自己的 `jc-koubojianji-desk` 路径，不读取视频翻译工作台数据。

## 本地识别

在应用右上角设置中检查并安装 FunASR。若系统已有兼容环境，应用会复用；否则安装到当前产品自己的应用数据目录。

## 构建

```bash
pnpm build
```

安装包输出到 `release-koubojianji/<版本号>/`。
