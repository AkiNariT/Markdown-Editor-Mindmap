# 项目声明 / Project notices

## AI 辅助开发

本项目主要借助 AI 工具开发。

## 许可证与第三方软件

MD 源码使用仓库内的 [MIT License](LICENSE)，以该许可证原文为准，保留原有版权声明。第三方组件的许可证独立适用，见 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)。便携包根目录的 LICENSE 和 LICENSES.chromium.html 属于运行时；项目自身许可证也位于 resources/app/LICENSE。

本项目为独立软件项目。文中提及的 GitHub、Markdown、Windows、Electron 等名称及相关商标归各自权利人所有；名称的使用不表示相关机构为本项目提供担保。

## 预览状态与使用边界

0.1.21 为首个公开预览版本，当前 Windows 0.1.32 仍为公开预览版。此版本实际验证的功能、平台和局限在 [验证记录](docs/VALIDATION-0.1.32.md) 与 [使用说明](README.txt) 中列明，不把兼容目标表述为已经完成的实机测试。Windows x64 便携包未签名，不含安装器。

软件按 MIT 许可证以 “AS IS” 方式提供，其担保与责任条款以许可证原文为准。重要文档请保留备份；自动草稿恢复依赖最近一次成功备份，不能代替保存原文件。

## 数据与格式

可视化编辑可能标准化 Markdown 标记；某些扩展语法不能完整显示或编辑。思维导图不嵌入关联 Markdown 文件。新建文件后撤销节点关联，不会删除磁盘文件。新版导图字段可能需要新版程序读取。

后续升级会通过版本标签、更新记录和 Releases 提供。应用支持手动检查更新与打开官方下载页，不会自动下载或安装更新；没有固定支持期限承诺。默认打开方式由 Windows 界面确认，注册成功或打开设置不代表默认值已经更改。

## 后续开发计划

项目继续优化现有体验与稳定性。macOS 独立预览包见 [0.1.31 发布页](https://github.com/AkiNariT/Markdown-Editor-Mindmap/releases/tag/v0.1.31)，尚未经过 Mac 实机验证；具体下载与平台说明以该预览页为准。本次 Windows 0.1.32 不更新 Mac 下载包，不据此承诺 Mac 兼容性。计划与进展见 [ROADMAP.md](ROADMAP.md)。
