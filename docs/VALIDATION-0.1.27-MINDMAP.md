# 0.1.27 本地优化版：思维导图验证

日期：2026-10-16。现有 Electron 架构，Windows 11 x64 实机；本次未发布 GitHub Release。

## 功能

- Ctrl / Shift 点击多选（也支持 Meta），普通点击恢复单选。工具栏和右键菜单均提供横向、纵向对齐。
- 对齐以当前节点所在行或列为基准，沿另一轴保留顺序和现有间隔；间距不足时至少留出 24 像素。支持撤销、重做和保存。
- 父子节点同时选中时按继承的相对偏移补偿；群组拖动不重复移动后代。仅选一个节点、阅读、锁定及输入法组合期间不能执行对齐。
- 实线与虚线保留无障碍时的原曲线；受阻时从节点边缘绕行。说明使用实际路线的中点，画布范围随路线扩展。
- 修复恢复画布位置产生的滞后 scroll 事件立即关闭右键菜单；真实滚动仍关闭菜单。

## 实际检查

1. 修改过程中完整 `npm test`：331 项通过，无失败、跳过。
2. 后续菜单及路由性能修补后，最终 `node --test tests/mindmap-*.test.mjs tests/mindmap.test.mjs tests/locales.test.mjs tests/workspace-i18n.test.mjs`：127 项通过，无失败、跳过。
3. `npm run package:portable`：成功。
4. 使用 `.packaged/MD-win32-x64/MD.exe` 执行以下实际桌面检查，均退出 0：
   - `tests/mindmap-alignment.cjs`：Ctrl/Shift 多选、横纵对齐及间距、父子同选、群组拖动、撤销重做、右键、150% 缩放、六种风格实线与虚线每 2 像素采样避障、保存关闭重开、阅读保护。
   - `tests/mindmap-interaction.cjs`：拖动、取消、缩放、右键连接与删除、关联文件、重开及窄窗口菜单。
   - `tests/mindmap-features.cjs`：颜色、说明编辑和清空、说明随移动缩放、新建草稿与保存关联、冲突保护、中英文与黑色外观、会话恢复。
5. 对最终交付 EXE 执行 `tests/portable.cjs`：成功。覆盖单独复制到中文路径、改名、相对路径打开、编辑保存、第二实例、缓存复用、会话恢复、缺失与截断缓存修复及并发首次准备。
6. `git diff --check`：通过。独立只读审查复核了选择状态、父子偏移、IME 保护及路由碰撞检查。

打包版对齐桌面检查目录：`.desktop-test/mindmap-alignment-no6zoQ/`；单文件检查目录：`.desktop-test/single-file-DDijwx/`。开发版截图 `.desktop-test/mindmap-alignment-1a720Y/alignment-routed-connections.png` 已目视检查。

## 交付

- `outputs/MD-Windows-x64-0.1.27.exe`（相对本任务目录 `C:/Users/user/Documents/Codex/2026-10-05/n`）
- 大小：337,376,549 字节。
- SHA-256：`DF9E2D94FA0D12CCDC9867AD80431EF2AEF070F8594F1FFD31A37957DA2842AA`。

## 已知边界

- 节点完全重叠、没有可用边缘端口或达到有限搜索上限时，保留备用连线；无法保证重叠卡片里的线路可见。对齐会分开所选节点，但不会自动重排未选节点。
- 1000 节点的复杂跨图连线仍有明显计算成本；测试中纯路由约 0.65–0.72 秒，不代表整体渲染时间，也不承诺大型导图达到 60 FPS。
- 本次没有重做启动性能基准；此前的“首次稳定 2 秒内”目标仍未达成。未迁移到 WebView2，也没有在 Windows 10 实机验证。
