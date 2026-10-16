# 后续维护与发布

## 版本与分支

项目公开名称为 **Markdown-Editor-Mindmap（Markdown 可视化编辑与思维导图）**，程序名仍为 `MD.exe`，便携包使用 `MD-Windows-x64-版本号.zip`。已经发布的 0.1.21 下载文件沿用原文件名。后续调整程序内部名称时，应验证恢复目录、Windows 文件关联等兼容行为。

- `main` 保存开发中的源码。每次公开发布使用独立的 `v版本号` 标签，例如 `v0.1.25`。
- 已公开的标签和下载资产保持不变；修复后发布新版本，不静默替换旧包。
- `package.json`、`package-lock.json`、界面帮助、使用说明和更新记录中的版本应同步更新。
- 改变导图格式时，明确读取版本与最低应用版本，保留旧版读取测试，防止静默丢字段。
- 0.1.23 公开包包含 0.1.22 的固定色卡与六种整图风格；v5 导图最低读取版本仍为 0.1.22，不因本次发布改成 0.1.23。历史变更记录和验证文件保持原版本。
- 0.1.25 公开包包含 0.1.24 本地版本的导图草稿和默认应用设置功能。更新当前下载与验证链接时保留历史版本的原始记录。
- `package.json` 的 `private: true` 用于防止误发布到 npm，不改变源码的 MIT 许可与 GitHub 公开发布方式。

## 发布前

1. 使用 Windows x64 和项目记录的 Node.js 版本，执行 `npm ci`。
2. 执行 `node --test --test-concurrency=1 tests/*.test.mjs` 和 `npm run build`。
3. 按改动选择相关原生测试，依次运行。不得使用私人文档或真实恢复目录作为测试输入。
4. 执行 `npm run package`，再设置 `MOYE_EXE` 指向新包的 MD.exe，复验相关桌面行为。
5. 更新相关改动需验证两个入口、手动触发、公开预览版选择、兼容 Windows x64 资产筛选、纯文本说明、官方发布页校验、错误提示，以及关闭弹窗后的编辑与保存。启动应用或仅打开弹窗不得发起更新检查；测试不得将任意远程地址作为请求或打开目标。0.1.25 还需复验导图草稿首次保存与关联、取消及恢复，以及默认应用的注册／设置分阶段结果、手动入口、路径复制、中文错误详情和双语界面；使用隔离用户配置与注册表，避免更改真实默认应用。
6. 更新 CHANGELOG、版本对应的 release notes 和实际验证范围，检查 LICENSE 及第三方 notices。只记录实际运行的检查，不把已有 0.1.21/0.1.22 的结果当成本次验证。
7. 核对 Git 暂存清单，没有 node_modules、生成目录、个人文档、日志或凭据，再提交。

Windows 10/11 x64 是兼容目标；已有原生桌面验证使用 Windows 11 x64，不能据此声称已经验证 Windows 10。macOS 仍在计划中，在完成适配和验证前不提供下载或发布日期。项目开发说明统一使用“本项目主要借助 AI 工具开发。”。

## 标签与下载文件

在已经确认的提交上创建标签并推送，不覆盖已有标签：

```powershell
git tag -a v0.1.25 -m "MD 0.1.25"
git push origin main
git push origin v0.1.25
```

后续版本将命令中的版本替换为本次版本。将完整 `.packaged/MD-win32-x64` 目录复制到独立交付目录后制作 ZIP，保留运行时、项目许可证及第三方 notices。避免覆盖正在运行的旧版。用户升级时也应将完整 ZIP 解压到独立目录，保存并正常退出旧版后再打开新版。

源码包应来自对应标签，不能从含本地测试文件的整个工作目录直接压缩：

```powershell
git archive --format=zip --prefix=MD-source-0.1.25/ --output=../MD-source-0.1.25.zip v0.1.25
```

使用 `Get-FileHash -Algorithm SHA256` 为实际下载文件生成 `SHA256SUMS.txt`。校验清单中的名称与上传资产完全一致。完整读取 ZIP 内容，检查版本、目录结构及许可证。

## GitHub Release

先创建 draft，上传便携包、源码包、独立模板和校验清单，确认资产齐全后再公开。GitHub CLI 示例：

```powershell
gh release create v0.1.25 --verify-tag --draft --prerelease --title "Markdown-Editor-Mindmap 0.1.25（Markdown 可视化编辑与思维导图）" --notes-file docs/releases/v0.1.25.md
gh release upload v0.1.25 ../MD-Windows-x64-0.1.25.zip ../MD-source-0.1.25.zip ../SHA256SUMS.txt
gh release view v0.1.25 --json url,assets,isDraft,isPrerelease
```

上传独立模板时还需明确列出两个模板文件。确认 tag 指向测试的提交、资产 SHA256 与本地一致后，使用 `gh release edit v0.1.25 --draft=false` 公开。当前 0.x 版本使用预览标记，README 应链接明确版本或 Releases 列表，不依赖会跳过预览版的 latest 链接。发布后核对 [0.1.25 发布页](https://github.com/AkiNariT/Markdown-Editor-Mindmap/releases/tag/v0.1.25)、附件下载与公开 API 中的对应条目。

## 手动检查更新的发布约定

应用只在用户点击检查时读取 `api.github.com` 上本仓库的公开发布信息，包括公开预览版；草稿不会作为公开更新展示。发布项需有可识别的版本标签和对应 Windows x64 便携资产，才能作为兼容更新展示。保持 `v版本号` 标签和 `MD-Windows-x64-版本号.zip` 文件名一致，避免把其他系统、架构或缺少便携包的发布推荐给用户。

更新说明在应用内以纯文本展示；可包含普通说明，但不能依赖 HTML、脚本或交互内容。应用仅允许用户打开核对后的本仓库官方发布页，下载仍由浏览器完成。更新检查不上传文档、本地路径、草稿或账户令牌；不会后台检查、自动下载、安装或重启。发布说明、README 与 PRIVACY.md 必须与这些行为一致。

此仓库使用人工验证后的发布流程，尚未声称已启用自动构建或自动安装更新。后续接入 CI 时，需要检查 Actions 权限、Windows 原生测试环境及构建产物，再更新本说明。
