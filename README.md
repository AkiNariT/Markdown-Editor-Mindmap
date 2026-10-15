<p align="center"><img src="assets/icon.svg" width="80" height="80" alt="MD"></p>

# MD — 极简 Markdown 阅读、编辑与思维导图

极简的 Markdown 桌面阅读与编辑器。直接编辑排版后的文字，也可以查看源码、双向对照，并用思维导图连接本地 Markdown 文件。

[English](README.en.md) · [下载 0.1.21](https://github.com/AkiNariT/MD/releases/tag/v0.1.21) · [更新记录](CHANGELOG.md) · [开发计划](ROADMAP.md) · [使用说明](README.txt)

## 开发方式

本项目主要借助 **AI 工具** 开发。

## 下载与运行

**[下载 Windows x64 便携版](https://github.com/AkiNariT/MD/releases/download/v0.1.21/MD-Windows-x64-0.1.21.zip)**

1. 解压整个 ZIP，双击其中的 `MD.exe`，无需安装 Node.js。
2. 保留程序目录内的 DLL、resources 等文件；仅复制 EXE 无法正常运行。
3. 升级时，先保存并正常退出旧版，再打开新版。同一用户配置只运行一个实例。

适配目标是 **Windows 10 / 11 x64**；已进行 Windows 11 x64 桌面测试，尚未在独立 Windows 10 机器验证。当前是 **0.1.21 公开预览版**，便携包未签名，不含安装器或自动更新。下载包与 SHA256 校验清单均在 [Releases](https://github.com/AkiNariT/MD/releases)。

**macOS 版本已列入后续开发计划，目前尚未发布 Mac 下载包。** 后续会继续优化现有功能，并进行 macOS 适配与实机验证；支持的系统版本、芯片架构和发布日期将在确认后公布，见 [开发计划](ROADMAP.md)。

## 功能

| 功能 | 支持内容 |
| --- | --- |
| 阅读与编辑 | 所见即所得编辑；标题、列表、待办、引用、表格、图片、代码块；语法高亮 |
| 源码与对照 | 查看完整 Markdown；双向编辑、实时预览、共享撤销重做 |
| 多文档 | 独立标签、阅读位置、编辑状态、缩放和未保存内容；提前命名文件 |
| 思维导图 | 手动节点、分支拖动、额外关系线、连接说明、折叠、颜色与五种方块样式 |
| 文件关联 | 关联本地 Markdown；星标打开；双击未关联节点创建并进入编辑 |
| 本地恢复 | 草稿备份与重启恢复；原文件仍需显式保存 |
| 外观与语言 | 浅色／黑色外观，简体中文／English，Ctrl+滚轮缩放 |
| SKILL 模板 | 按钮打开中英文模板；编辑名称、用途和正文；保留 YAML 文件头 |

思维导图保存为 `.mdmap`。新增背景、样式或连接说明使用 **v4 格式**，需要 MD 0.1.21 或更新版本；旧 v1/v2/v3 导图仍可读取。分享导图时请同时提供其关联的 Markdown 文件，并保留相对目录结构。

## 使用与限制

- `Ctrl+O` 打开，`Ctrl+S` 保存，`Ctrl+Shift+S` 另存，`Ctrl+N` 新建。
- `Ctrl+Shift+E` 切换阅读／编辑；`Ctrl+滚轮` 缩放，`Ctrl+0` 恢复 100%。
- 点击顶部文件名可命名。导图编辑时，画布内的 `F2` 编辑当前节点文字或连接说明。
- 简体中文／English：右上角 **… → 设置 → 语言**。
- 支持 UTF-8；单份文件最大 8 MB。部分 Markdown 扩展不能完整可视化编辑，检测到后会要求另存副本；源码模式可保留原始标记。
- Mermaid、数学公式暂不提供图形渲染。完整兼容范围见 [使用说明](README.txt)。

## 隐私、许可与声明

MD 不内置账户同步、文档上传或遥测功能。文档、设置与恢复记录保存在本机；文档中的远程图片会请求相应服务器，网页链接可打开外部浏览器。详见 [隐私与数据说明](PRIVACY.md)。

项目沿用 [MIT License](LICENSE)，保留既有版权声明。第三方依赖使用各自许可证，详见 [第三方许可](THIRD_PARTY_NOTICES.txt)；Electron／Chromium 许可随便携包提供。预览版的使用边界与无担保条款见 [项目声明](NOTICE.md)。

## 从源码运行

在 Windows 上使用 Node.js 24.15.0 和 npm：

```powershell
npm ci
npm run build
npm start
```

```powershell
node --test --test-concurrency=1 tests/*.test.mjs
npm run package
```

打包目录为 `.packaged/MD-win32-x64`。首次安装依赖或打包可能下载 Electron 运行时。运行测试和原生桌面检查的方法见 [贡献指南](CONTRIBUTING.md)；当前版本已执行的范围见 [验证记录](docs/VALIDATION-0.1.21.md)。

## 维护与反馈

源码在 `main` 分支持续维护，公开下载按版本标签发布。问题和功能建议请使用 [Issues](https://github.com/AkiNariT/MD/issues)，提交代码前请阅读 [贡献指南](CONTRIBUTING.md)。更新过程和格式兼容要求见 [发布维护说明](docs/RELEASING.md)。安全问题请按 [安全报告说明](SECURITY.md) 私下报告。
