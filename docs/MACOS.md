# macOS 适配预览 / macOS preview

本分支提供 MD 0.1.31 的 Mac 预览构建，使用现有 Electron 框架和 `.mdmap` 文件格式。两种芯片的原生自动化已通过，具体结果与人工验收边界见 [验证记录](VALIDATION-0.1.31-MACOS.md)。正式公开下载仍以仓库 Releases 中实际提供的附件为准；GitHub Actions 的构建附件用于测试，不等于正式发布。

## 系统与芯片

- **macOS 13 Ventura 或更新版本**。这是 Electron 44 的最低系统要求；不能据此声称每个 macOS 版本都已实机测试。[Electron 官方版本变更](https://github.com/electron/electron/blob/v44.5.1/docs/breaking-changes.md)
- Apple 芯片：选择 `MD-macOS-arm64-0.1.31.dmg` 或 `.zip`。
- Intel 芯片：选择 `MD-macOS-x64-0.1.31.dmg` 或 `.zip`。
- 不清楚芯片时，在 Apple 菜单中打开“关于本机”。显示 Apple M 系列选择 arm64，显示 Intel 选择 x64。

## 安装与首次打开

打开 DMG，将 `MD.app` 拖到“应用程序”（Applications），推出磁盘映像后从“应用程序”打开 MD。ZIP 则先完整解压，再将其中的整个 `MD.app` 移入“应用程序”。保留 `.app` 的完整结构；可以将它拖到 Dock 方便打开。不需要安装 Node.js。

当前预览包使用本地临时签名（ad-hoc），**没有 Apple Developer ID 签名，也未经过 Apple 公证**。macOS 可能阻止首次打开。仅在确认文件来自本项目并核对校验值后，按 Apple 提供的“系统设置 → 隐私与安全性 → 仍要打开”流程处理；受管理的电脑可能不允许此操作。不要关闭系统整体的安全检查。若提示文件损坏或恶意软件，请停止打开并反馈。[Apple 官方说明](https://support.apple.com/en-us/102445)

## 日常操作

- 阅读、可视化编辑、源码、双向对照、导图、导出和 SKILL 模板沿用现有界面。
- `⌘O` 打开、`⌘N` 新建、`⌘S` 保存、`⇧⌘S` 另存、`⌘W` 关闭当前标签、`⌘Z` 撤销、`⇧⌘Z` 重做、`⌘,` 设置。系统顶部菜单提供同样的操作。
- `Control+Tab` / `Control+Shift+Tab` 切换文档；`⌘+`、`⌘−`、`⌘0` 调节文档缩放。Control+滚轮或触控板捏合也可调节，普通滚动保留。
- 点击红色关闭按钮会隐藏工作区，保留当前文档与草稿；点击 Dock 中的 MD 或再次打开文件可继续。**使用 `⌘Q` 或“MD → 退出 MD”真正退出**，有未保存修改时会提示保存、放弃或取消。
- 原始文件仍需主动保存。设置与草稿默认在 `~/Library/Application Support/MD`，不随复制 `.app` 转移。

## 文件与默认应用

将 MD 放入“应用程序”并打开一次后，可以在 Finder 中选中文件，按 `⌘I` 打开“显示简介”，在“打开方式”中选择 MD，点击“全部更改”。`.md`、`.markdown`、`.mdmap` 可以分别设置。MD 不会擅自覆盖其他软件的默认关联。[Apple 官方说明](https://support.apple.com/guide/mac-help/choose-an-app-to-open-a-file-on-mac-mh35597/mac)

MD 接收 Finder 发送的文档打开请求；重复打开同一文件会回到现有标签。重命名保留不覆盖已有文件的检查。导图仍引用独立 Markdown 文件；跨 Windows/Mac 分享时应将导图、Markdown 和图片放在同一资料目录，保留相对路径并完整解压。`C:\...` 等 Windows 绝对路径不能自动在 Mac 上定位。

检查更新只选择与当前系统、芯片相符的公开发布包。仍由用户手动检查和下载，不自动安装或重启。未发布 Mac 附件时，Windows 包不会被误报成可安装的 Mac 更新。

## 开发与验证

在对应芯片的 Mac 上运行：

```sh
npm ci
npm run package:mac -- --arch arm64
# Intel: npm run package:mac -- --arch x64
```

构建会使用已生成的 ICNS 图标、编译安全重命名辅助程序、设置 Finder 文档类型、关闭环境变量驱动的 Electron Node 启动，然后完成 ad-hoc 签名与校验。ZIP 保留应用中的可执行权限和符号链接。

GitHub Actions 使用 `macos-15`（arm64）及 `macos-15-intel`（x64），分别构建、检查架构/签名/元数据，并执行打包后应用的原生回归。每次运行的实际结论以对应工作流日志为准。自动化在 macOS 上运行也不代表已完成各种个人设备、外接屏幕和系统安全提示的人工验收。

## English

MD 0.1.31 introduces a macOS preview using the existing Electron editor and mindmap format. It requires macOS 13 Ventura or later. Choose arm64 for Apple Silicon and x64 for Intel. Public availability depends on actual release assets; workflow artifacts are test builds.

Open the DMG, drag the complete MD.app into Applications, eject the disk image, and launch from Applications. ZIP users should extract the complete app first. No Node.js installation is needed. The preview is ad-hoc signed, without Apple Developer ID signing or notarization. Follow Apple's per-app approval guidance only after checking the source and checksum; do not disable system-wide protections.

Command shortcuts and native menus provide opening, saving, undo, redo and settings. Control+Tab switches document tabs. Closing the red window button hides the retained workspace; Dock activation returns to it. Command+Q quits after checking unsaved work. Settings and drafts remain in ~/Library/Application Support/MD. Choose MD as the default using Finder → Get Info → Open with → Change All for each extension.

Mac and Windows exchange the same document formats, but linked files must retain their relative directory structure. Windows absolute paths do not become Mac paths automatically. Manual update checks select only packages for the current platform and CPU architecture. Automated builds and native smoke tests use macOS 15 on both architectures; this is not certification of every supported OS and device.
