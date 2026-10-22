Markdown-Editor-Mindmap（Markdown 可视化编辑与思维导图）0.1.31 Mac 预览版

需要 macOS 13 Ventura 或更新版本。Apple 芯片使用 arm64 包，Intel 使用 x64 包。
DMG：将 MD.app 拖入 Applications，推出磁盘映像，再从“应用程序”打开。
ZIP：完整解压，将整个 MD.app 移入“应用程序”。不要拆开 .app 内部文件。

这是 ad-hoc 临时签名的测试构建，没有 Apple Developer ID 签名或 Apple 公证。
macOS 可能阻止首次打开。确认来自项目并核对 SHA256 后，可按 Apple 官方说明在“系统设置 → 隐私与安全性”中批准这一个应用。不要关闭系统整体安全检查。
https://support.apple.com/en-us/102445

⌘O 打开，⌘N 新建，⌘S 保存，⇧⌘S 另存，⌘W 关闭标签。
⌘Z 撤销，⇧⌘Z 重做，⌘, 设置，Control+Tab 切换文档。
⌘+、⌘−、⌘0 调节文档缩放；Control+滚轮与触控板捏合也可使用。
点击红色关闭按钮隐藏工作区并保留文档；点击 Dock 中的 MD 可继续。
⌘Q 或“MD → 退出 MD”真正退出，有未保存修改时会询问保存、放弃或取消。

设置与草稿默认保存在 ~/Library/Application Support/MD，原始文件仍需主动保存。
Finder 默认打开方式：选中文件 → ⌘I“显示简介” → 打开方式选 MD → 全部更改。
.md、.markdown 和 .mdmap 分别设置。软件不会自动接管默认应用。

导图与 Markdown 是独立文件，分享时保留完整资料目录及相对路径；ZIP 请先完整解压。
Windows 的 C:\... 绝对路径不能直接在 Mac 使用。
检查更新只会选择当前系统与芯片的公开版本；不会自动下载、安装或重启。

项目与下载：https://github.com/AkiNariT/Markdown-Editor-Mindmap
Mac 说明：https://github.com/AkiNariT/Markdown-Editor-Mindmap/blob/feat/macos-support/docs/MACOS.md
本项目主要借助 AI 工具开发，源码使用 MIT 许可证；第三方许可随包提供。
