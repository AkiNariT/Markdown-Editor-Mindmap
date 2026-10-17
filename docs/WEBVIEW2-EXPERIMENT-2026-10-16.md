# WebView2 性能验证记录（2026-10-16）

结论：**当前不迁移到 WebView2，保留 Electron。首次稳定低于 2 秒的目标仍未达到。**

这是一项用户授权的可行性试验，不是功能完整的新版本。试验没有替换桌面程序、修改默认文件关联或发布 GitHub Release。试验时公开版本为 0.1.26，本地 Electron 优化版为尚未发布的 0.1.27；后续公开版信息以发布页为准。

## 最终对照

两组依次运行于同一台 Windows 11 电脑。下面保留全部三次启动的范围，不使用最快一次代表结果。

| 指标 | Electron 0.1.27 单文件 | WebView2 内嵌单文件原型 |
| --- | ---: | ---: |
| 新用户配置、空程序组件缓存启动 | 5.46–7.68 秒 | 1.57–2.01 秒 |
| 同一配置重复启动 | 2.00–2.38 秒 | 5.69–6.25 秒 |
| 欢迎页私有提交内存 | 156.02 MiB | 159.81 MiB |
| 打开 8 份文档、最后一份活动 | 194.23 MiB | 198.39 MiB |
| 逐一阅读 8 份文档后 | 284.01 MiB | 239.91 MiB |
| 逐一编辑并保存 8 份文档后 | 277.10 MiB | 254.63 MiB |

最终三次首次启动原始值（毫秒）：Electron 5462.3 / 7682.1 / 6876.7；WebView2 2014.4 / 1565.3 / 1604.3。

最终三次重复启动原始值（毫秒）：Electron 1997.6 / 2069.8 / 2376.8；WebView2 5694.6 / 6110.6 / 6246.7。

WebView2 的首次启动明显有潜力，但重复启动退步且内存收益随工作阶段变化。在用户更重视稳定、快速使用的条件下，这些证据不足以支持当前进行完整迁移。它们也不代表 WebView2 在其他软件或电脑上普遍更慢。

## 方法与限制

- CPU：Intel Core i7-1165G7，约 16 GiB RAM，Windows 11 10.0.26100。没有在真实 Windows 10 机器上验证。
- 系统已安装 WebView2 Runtime 155.0.4283.45 和 .NET Framework 4.8。组件安装或下载时间没有计入。
- 官方 Microsoft.Web.WebView2 SDK 1.0.4258.31；Electron 使用 Chromium 152.0.7977.130。内核版本不同。
- 两个版本使用相同的现有编辑器 JS、CSS、初始欢迎文档。最终视口都是 1164 × 782 CSS 像素、DPR 1.25，均使用软件合成。
- 启动从创建进程开始，计到页面可见、文档加载、sessionReady 完成后的两帧 `md-document-ready` 标记。另记录包含 CDP 连接与观察开销的 readyMs。真实点击源码/正文切换验证输入可用。
- 每次首次启动都有全新的应用/浏览器配置和空组件缓存；不是重启后的磁盘冷启动，未清除操作系统文件缓存，也未验证真实下载后的 SmartScreen 流程。
- 内存为本次应用进程树的 PrivateMemorySize64 之和，每阶段自然等待 15 秒后采样三次并取中位数。没有强制 GC。WorkingSet64 也保留于 JSON，但共享页可能重复计数，不能称作独占物理内存。
- 8 份生成的 Markdown 文档，每份约 61 KB、100 个章节、9 个 JavaScript 代码块，无图片。逐一阅读、编辑、保存后，核对磁盘内容、章节、代码块和新增文字。最终两组均完成这项验证。
- 原型仅接通测试文档范围内的 Markdown 读取、标签切换、可视化/源码/对照编辑和保存。检查点有真实原子写入与 Flush(true)，但完整会话恢复、备份、思维导图文件操作、默认程序关联等未迁移；不能称作功能等价的替换版本。
- 原型通过测试专用接口打开 8 个文件；Electron 使用第二实例打开文件。开文件耗时不作直接比较。
- 测试期间系统负载发生变化：一次只读采样可用物理内存约 1.66 GiB，另一次 WMI CPU 采样报告 1201 MHz / 最大 2803 MHz、负载 62%。这些是离散采样，不足以确定各次变慢的原因。更早的 Electron 试验曾测得首次 3.20–3.96 秒、重复约 0.95–1.12 秒，因此不能把本轮较慢的对照泛化为日常固定性能。

## 试验过程与问题

1. 首个 WinForms + WebView2 宿主成功显示现有编辑器，中文输入、可视化编辑、源码对照、实际保存通过。开发首轮启动约 5 秒，不作最终性能结论。
2. `https://md.local/` 虚拟域名出现约 2 秒固定等待：HTML 已返回，样式和脚本约两秒后才开始加载。微软问题记录描述相同现象。改用本机保留域名 `md.localhost` 后，三次新配置启动降到 1.91 / 1.46 / 1.46 秒；这只是目录版，未计单文件展开成本。
3. 用 NSIS 打包约 2 MB 宿主，每次展开独立目录，首次为 2.14–2.70 秒，未稳定达到 2 秒。最后一次内存采样前窗口关闭，原因未确认；该轮不能作为完整的内存对照。
4. 内嵌托管 SDK 和界面资源，仅缓存 194,912 字节的原生 Loader。SDK 程序集在内存中加载，UI 通过固定白名单响应；没有关闭浏览器安全检查。Loader 使用完整 SHA-256 校验和原子分代发布。首次烟测发现深层测试路径过长，缩短缓存子目录后，DPI、读取、编辑、对照、保存烟测通过。
5. 最终内嵌版本完成全部 8 文档负载。重复启动时 WebView2 控制器创建耗时约 4.6–5.4 秒，而新配置约 0.7–0.9 秒；具体原因尚未确认。没有将这项异常描述成已解决。

微软参考资料（实际查阅）：

- [WebView2 本地内容加载](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/working-with-local-content)
- [微软问题库：虚拟域名导致约两秒导航等待](https://github.com/MicrosoftEdge/WebView2Feedback/issues/2381)
- [WebView2 分发与运行时依赖](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
- [Windows Forms 高 DPI 支持](https://learn.microsoft.com/en-us/dotnet/desktop/winforms/high-dpi-support-in-windows-forms)

## 可复查证据

以下路径相对仓库根目录，均为本地隔离试验；原型源码没有接入生产构建。

- 最终 Electron：`.desktop-test/webview2-spike/runs/electron-rcR0Xa/performance.json`，完成时间 `2026-10-16T08:31:19.440Z`，测试进程退出码 0。
- 最终 WebView2：`.desktop-test/webview2-spike/runs/webview2-INUu5N/performance.json`，完成时间 `2026-10-16T08:37:42.106Z`，测试进程退出码 0。
- 原型：`.desktop-test/webview2-spike/HostEmbedded.cs`、`build-embedded.mjs`、`bridge.js`；基准脚本 `performance.cjs`。
- 内嵌版烟测：`.desktop-test/webview2-spike/smoke-qvlY5y/`，包含对照视图截图与实际修改后的测试文件。
- 完整目录版试验：`.desktop-test/webview2-spike/runs/webview2-pc0XUL/performance.json`。
- 不完整的 NSIS 内存试验：`.desktop-test/webview2-spike/runs/webview2-Huh0vp/performance.json`。
- 早先 Electron 轮次的测量已采齐，但最后截图超时：`.desktop-test/webview2-spike/runs/electron-5lUyl1/performance.json`。最终对照使用后来完整通过的一轮。

最终内嵌 EXE 为 2,076,160 字节；SHA-256：`2eb26d6eb6f26acb9a8222a23d620fd09acace0ecf44d102fc1330dea747032e`。这是依赖系统已有运行时、功能不完整的试验包，其体积不能直接等同于完整软件及其运行时的占用。

最终 Electron 单文件 SHA-256：`5cc6e3bf18a4aa24fed06af4f5c3879027f1753a72acf77306496d0c74466630`。
