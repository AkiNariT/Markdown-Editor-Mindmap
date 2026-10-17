# 0.1.28 本地测试版：拖动对齐与多选移动

验证日期：2026-10-16。环境：Windows 11 x64、Node.js 24.15.0、Electron 44.5.1。本记录描述公开发布前的本地测试包；正式包与发布前复验见 [0.1.28 公开验证记录](VALIDATION-0.1.28.md)。

## 行为

- 移除 0.1.27 本地版的横向、纵向对齐按钮及菜单项。拖动卡片接近其他可见静止卡片所在行或列时，显示蓝色虚线并吸附。
- 吸附距离为 6 屏幕像素，随画布缩放换算；同尺寸节点的同类边缘和中心对齐等价，参考线显示在中心。拖远脱离，按住 Alt 暂停吸附；松手、Esc、失焦、取消、锁定及切换模式后清除参考线。
- Ctrl / Shift 点击多选，松开修改键后拖动整组，保持组内相对位置。以鼠标抓住的节点作为对齐基准，移动中的后代不作为吸附目标，父子同时选中只移动一次。
- 拖动预览不写入文档，松手提交一个可撤销操作；参考线不会保存为关系边。保留已有连线避让。
- 修复旧文件包含负偏移时每次布局重新移动原点的问题：保留所需画布留白，防止静止节点和参考线随拖动错位。

## 实际验证

1. 新交互测试先确认旧实现失败，再完成吸附实现；负偏移边界另有失败复现及修复验证。
2. `npm test`：348/348 通过。此轮在最后的负偏移修复前启动；修复后另跑下面完整相关回归。
3. 最终源码执行 `node --test tests/mindmap-*.test.mjs tests/mindmap.test.mjs tests/locales.test.mjs tests/workspace-i18n.test.mjs`：140/140 通过，含新增负偏移场景。
4. `npm run package:portable`：成功生成 0.1.28 文件夹版及单文件版。
5. 最终文件夹版通过真实 Electron 的 `mindmap-alignment.cjs`、`mindmap-interaction.cjs`、`mindmap-features.cjs`。覆盖虚线与吸附、Alt、Esc、150% 缩放阈值、多选父子拖动、撤销重做、六种样式的连线绕避、保存重开、阅读保护、草稿、配色、中英文及黑色窄屏。
6. 最终单文件版通过 `tests/portable.cjs`：独立复制和改名、打开与保存 Markdown、第二次启动转交导图、缓存复用与修复、并发首次启动。使用隔离数据与缓存，不关闭用户原有 MD 窗口。
7. `git diff --check` 通过；独立代码复核未发现尚待修复的问题。复核额外检查负偏移首次挂载、session 留白恢复、独立重开相对布局及撤销重做。

实际文件夹版截图目录：`.desktop-test/mindmap-alignment-kxDB1f/`，其中 `drag-alignment-guides.png` 已目视检查。开发版参考线截图 `.desktop-test/mindmap-alignment-3qH9SW/drag-alignment-guides.png` 也已目视检查。其他桌面检查目录为 `.desktop-test/mindmap-interaction-1792143184337/`、`.desktop-test/mindmap-features-nbwzs6/`；单文件检查目录为 `.desktop-test/single-file-XpbBAn/`。

## 交付

- `outputs/MD-Windows-x64-0.1.28.exe`（相对任务目录 `C:/Users/user/Documents/Codex/2026-10-05/n`）。
- 大小：337,378,685 字节。
- SHA-256：`F868F3B95107B7E42A2C13631EFB78C46F62496B1314C817730189C7810944F1`。

## 边界

- 吸附辅助人工拖动，不自动重排整张导图或避开节点重叠。完全重叠的节点仍可能使连线没有可用出口。
- 大型复杂导图的连线路由仍有计算成本；本次未重新测量启动或内存性能，不能据此宣称首次启动 2 秒目标达成。
- 本次验证环境为 Windows 11；未增加 Windows 10 实机验证，也未改用 WebView2。
