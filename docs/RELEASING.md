# 后续维护与发布

## 版本与分支

项目公开名称为 **Markdown-Editor-Mindmap（Markdown 可视化编辑与思维导图）**。已经发布的 0.1.21 下载文件沿用原文件名。后续调整程序内部名称时，应验证恢复目录、Windows 文件关联等兼容行为。

- `main` 保存开发中的源码。每次公开发布使用独立的 `v版本号` 标签，例如 `v0.1.21`。
- 已公开的标签和下载资产保持不变；修复后发布新版本，不静默替换旧包。
- `package.json`、`package-lock.json`、界面帮助、使用说明和更新记录中的版本应同步更新。
- 改变导图格式时，明确读取版本与最低应用版本，保留旧版读取测试，防止静默丢字段。

## 发布前

1. 使用 Windows x64 和项目记录的 Node.js 版本，执行 `npm ci`。
2. 执行 `node --test --test-concurrency=1 tests/*.test.mjs` 和 `npm run build`。
3. 按改动选择相关原生测试，依次运行。不得使用私人文档或真实恢复目录作为测试输入。
4. 执行 `npm run package`，再设置 `MOYE_EXE` 指向新包的 MD.exe，复验相关桌面行为。
5. 更新 CHANGELOG、版本对应的 release notes 和实际验证范围，检查 LICENSE 及第三方 notices。
6. 核对 Git 暂存清单，没有 node_modules、生成目录、个人文档、日志或凭据，再提交。

## 标签与下载文件

在已经确认的提交上创建标签并推送，不覆盖已有标签：

```powershell
git tag -a v0.1.21 -m "MD 0.1.21"
git push origin main
git push origin v0.1.21
```

后续版本将命令中的版本替换为本次版本。将完整 `.packaged/MD-win32-x64` 目录复制到独立交付目录后制作 ZIP，保留运行时、项目许可证及第三方 notices。避免覆盖正在运行的旧版。

源码包应来自对应标签，不能从含本地测试文件的整个工作目录直接压缩：

```powershell
git archive --format=zip --prefix=MD-source-0.1.21/ --output=../MD-source-0.1.21.zip v0.1.21
```

使用 `Get-FileHash -Algorithm SHA256` 为实际下载文件生成 `SHA256SUMS.txt`。校验清单中的名称与上传资产完全一致。完整读取 ZIP 内容，检查版本、目录结构及许可证。

## GitHub Release

先创建 draft，上传便携包、源码包、独立模板和校验清单，确认资产齐全后再公开。GitHub CLI 示例：

```powershell
gh release create v0.1.21 --verify-tag --draft --prerelease --title "MD 0.1.21" --notes-file docs/releases/v0.1.21.md
gh release upload v0.1.21 ../MD-Windows-x64-0.1.21.zip ../MD-source-0.1.21.zip ../SHA256SUMS.txt
gh release view v0.1.21 --json url,assets,isDraft,isPrerelease
```

上传独立模板时还需明确列出两个模板文件。确认 tag 指向测试的提交、资产 SHA256 与本地一致后，使用 `gh release edit v0.1.21 --draft=false` 公开。当前 0.x 版本使用预览标记，README 应链接明确版本或 Releases 列表，不依赖会跳过预览版的 latest 链接。

此仓库初始发布使用人工验证后的流程，没有声称已经启用自动构建或自动更新。后续接入 CI 时，需要检查 Actions 权限、Windows 原生测试环境及构建产物，再更新本说明。
