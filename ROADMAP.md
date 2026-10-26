# 开发计划 / Roadmap

这里记录后续方向。计划中的内容在完成验证并发布前，不作为当前版本已支持的功能。

## 持续优化

- 优化现有 Markdown 阅读、可视化编辑、源码与双向对照体验。
- 改进思维导图的操作、布局和文件关联体验。
- 持续检查保存保护、草稿恢复、性能及中英文界面，根据实际问题修复和迭代。

具体改动会记录在 [CHANGELOG.md](CHANGELOG.md)，公开下载通过 [Releases](https://github.com/AkiNariT/Markdown-Editor-Mindmap/releases) 发布。

## macOS 版本

**状态：0.1.31 预览构建已通过 Apple Silicon 与 Intel 的原生自动化，等待个人 Mac 试用；公开下载以 Releases 附件为准。**

适配范围包括 Finder 打开、原生菜单、Command 快捷键、安全重命名、窗口隐藏与退出保护，以及 Apple 芯片和 Intel 的独立 DMG/ZIP。最低 macOS 13；原生自动化使用 macOS 15。具体操作与限制见 [Mac 说明](docs/MACOS.md)，执行结果以对应构建日志为准。

当前使用 ad-hoc 签名。Apple Developer ID 签名、公证及更多实际设备验证仍是后续工作，尚无确认日期。

## 参与反馈

可以通过 [Issues](https://github.com/AkiNariT/Markdown-Editor-Mindmap/issues) 提交现有问题，或描述 macOS 使用需求与设备环境。请不要上传私人文档和恢复记录。参与开发前请阅读 [贡献指南](CONTRIBUTING.md)。

---

## English

MD will continue improving its existing Markdown editing, mindmap, file-protection, recovery, performance and language features.

**The 0.1.31 macOS preview has passed native automation on Apple Silicon and Intel and is ready for personal-device testing.** It targets macOS 13+ with native automation on macOS 15. Public availability depends on actual Releases assets. See [the Mac guide](docs/MACOS.md) and [validation record](docs/VALIDATION-0.1.31-MACOS.md). Developer ID signing, notarization and broader device validation remain planned without a committed date.

Actual changes belong in the changelog and published versions in Releases. Planned work is not a claim of current support.
