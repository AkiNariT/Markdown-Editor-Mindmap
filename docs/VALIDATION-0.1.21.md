# MD 0.1.21 验证范围

首次公开包来自已经完成本地验证的 0.1.21 便携构建。以下记录不是 GitHub Actions 运行结果。

## 环境与结果

- Windows 11 x64，10.0.26100；Electron 44.5.1；Node.js 24.15.0。
- 全量单元测试曾串行执行：182 项通过，0 失败，0 跳过。
- 最终标签布局优化后，9 项相关功能单元再次通过。
- 已对实际 MD.exe 通过以下 10 组原生测试：`mindmap-features`、`mindmap`、`mindmap-open`、`mindmap-interaction`、`mindmap-style`、`recovery-map`、`language`、`desktop`、`naming`、`compare`。
- 最终 F2 修正后，重新通过 `desktop`、`naming`、`mindmap-features`、`compare`。
- 已检查宽窄窗口、黑色外观、中英切换、保存／另存／重命名、冲突保护、异常退出恢复，以及新说明与节点外观。

## 限制

- 没有独立 Windows 10 实机／虚拟机验证，也没有把强制 DPI 缩放当作实际多屏混合 DPI 测试。
- 原生颜色选择器的提交通过 change 事件模拟；真实输入法候选窗口未逐一人工测试。
- 不支持硬链接时的 wx 回退已模拟相关错误并执行真实磁盘写入；没有真实 exFAT／网络盘挂载测试，回退不宣称原子发布。
- 大型导图的纯几何基准不能当作完整桌面帧率保证。
- 初次并行单测中一次系统 PowerShell 重命名超过 15 秒，随后串行全量通过；原生 UI 测试按顺序运行。

后续版本应记录实际运行的检查，不直接沿用这份记录宣称新版通过。

## 首次公开前复查

公开发布准备时，对当前源码重新执行全量单测：182 项通过，0 失败、0 跳过；重新构建成功。对便携包又依次通过 `mindmap-features`、`language`、`compare`、`mindmap-interaction`、`mindmap`、`naming`、`mindmap-style`、`zoom` 八组原生检查。

本次仅整理公开文档、仓库元数据和测试路径。缩放测试曾在异步编辑状态未完成时过早发送快捷键，增加就绪条件后通过；没有据此改动程序缩放行为。程序界面脚本与已验证的便携包保持一致。
