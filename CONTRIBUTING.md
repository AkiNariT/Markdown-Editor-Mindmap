# 贡献指南

感谢帮助改进 MD。开始较大的功能之前，先开 Issue 说明使用场景、期望行为和兼容影响。

## 开发环境

当前正式打包目标为 Windows x64，使用 Node.js 24.15.0 和 npm。安装依赖后先构建：

```powershell
npm ci
npm run build
npm start
```

`package.json` 中的 `private: true` 用于防止误发布到 npm，不代表 GitHub 仓库私有。内部包名和部分 Windows 标识沿用旧名称，修改它们前需考虑本地恢复目录与文件关联兼容性。

## 修改与验证

遵循现有 JavaScript ES modules / Electron 结构，优先完成一个可独立检查的改动。修复应覆盖真实问题，避免仅复述实现的测试。

```powershell
node --test --test-concurrency=1 tests/*.test.mjs
npm run build
```

部分测试调用 Windows PowerShell，不能将其他系统下的结果当作 Windows 文件操作验证。涉及界面的修改，再选择 `package.json` 中对应的 `test:*` 原生测试；这些测试会打开独立测试窗口，请在可交互的 Windows 桌面中依次运行，避免同时运行多个 UI 测试。

打包后可指定 `MOYE_EXE` 对实际便携程序复验：

```powershell
npm run package
$env:MOYE_EXE = (Resolve-Path '.packaged/MD-win32-x64/MD.exe').Path
npm run test:mindmap-features
Remove-Item Env:MOYE_EXE
```

## 需要保持的行为

- 同一文档的阅读位置、草稿、撤销与标签状态不能因切换而丢失。
- 保存与重命名不能静默覆盖外部修改或已存在的目标。
- YAML、源码标记、图片相对路径与导图关联必须按已有保护规则处理。
- UI 文案需提供简体中文与 English；新增导图字段需验证并明确格式版本。
- 不把个人文档、恢复目录、令牌、依赖目录或本地测试输出提交到仓库。

## Pull request

说明实际问题、修改后的行为、验证命令与结果，以及已知限制。界面改动可提供不含私人路径和内容的截图。提交贡献即表示该贡献按项目现有 MIT 许可证提供。

发布流程见 [docs/RELEASING.md](docs/RELEASING.md)。安全问题请使用 [私下报告方式](SECURITY.md)。
