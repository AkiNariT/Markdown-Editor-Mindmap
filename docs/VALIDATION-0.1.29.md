# 0.1.29 公开预览版验证记录

验证日期：2026-10-18（Asia/Tokyo）。本轮实际环境为 Windows 11 x64、Node.js 24.15.0、Electron 44.5.1、Playwright 1.58.2。本文件记录首位使用者反馈更新的实现验证及后续公开发布检查。发布信息以 [v0.1.29 Release](https://github.com/AkiNariT/Markdown-Editor-Mindmap/releases/tag/v0.1.29) 为准。

## 构建与单元测试

- 最终串行单元测试：389 项通过，0 失败、0 取消、0 跳过，总耗时 308983.2129 ms（约 309 秒）。范围包含 v6 格式、节点完整文字布局、可变尺寸路由和吸附、标题转导图、导出边界、启动开关，以及既有文件保存和 Windows 集成测试。
- 最终 `npm run build` 与 `npm run package` 成功，文件夹版位于 `.packaged/MD-win32-x64/`。
- 单文件封装成功，生成 `.packaged/portable/MD-Windows-x64-0.1.29.exe`。封装完成不等于便携版运行验证完成，运行结果需见下方独立检查。
- 最终日志：`.desktop-test/feedback-0.1.29-final-unit.log`、`.desktop-test/feedback-0.1.29-final-package.log`。
- 先前全量运行曾有 1 项语言目录检查失败：测试枚举尚未包含新增反馈词条目录；补齐枚举并完成相关检查后，以上最终全量 389 项全部通过。

## 最终文件夹版桌面回归

以下 11 组测试均将 `MOYE_EXE` 设置为最终 `.packaged/MD-win32-x64/MD.exe`，依次运行，退出码全部为 0。各组使用隔离配置与测试文件，完成后关闭自己的窗口；没有关闭用户原有窗口。日志路径均相对于仓库根目录。

| 测试脚本 | 实际验证范围 | 日志 |
| --- | --- | --- |
| `tests/mindmap-feedback.cjs` | 完整长标题与备注；三档宽度和装饰主题；连线类型、颜色、箭头；短边双向箭头不重叠；整理布局和撤销；v6 另存重开及相对链接；只读保护；SVG 导出；黑色英文窄屏；标题转导图保留原 Markdown 与标签 | `.desktop-test/feedback-release-final.log` |
| `tests/mindmap-alignment.cjs` | 拖动虚线与吸附、Alt 暂停、Esc 取消、150% 缩放阈值、多选父子移动、撤销重做、六种风格连线绕避、保存重开和阅读保护 | `.desktop-test/alignment-release-final.log` |
| `tests/mindmap-interaction.cjs` | 分支拖动、缩放坐标、撤销取消、v2 位置保存、只读保护、右键关联/打开、恢复布局、窄窗口菜单边界 | `.desktop-test/interaction-release-final.log` |
| `tests/mindmap-features.cjs` | 配色、关系说明、草稿先写后存、重复打开复用、取消/冲突保护、首次保存关联、另存相对路径、黑色英文窄屏与未保存内容恢复 | `.desktop-test/features-release-final.log` |
| `tests/mindmap-style.cjs` | 六种整图风格、旧节点样式、明暗对比、主题切换几何稳定、撤销保存、关联星标、英文窄屏与 v5 恢复 | `.desktop-test/style-release-final.log` |
| `tests/mindmap-drafts.cjs` | 草稿不预先建文件、位置和内容保留、取消/冲突处理、恢复、首次保存及撤销关联、节点删除或重新关联保护、退出保存顺序 | `.desktop-test/drafts-release-final.log` |
| `tests/mindmap-open.cjs` | 阅读/编辑模式下真实双击、已有脏标签与位置复用、未关联节点草稿、取消保存、右键文字编辑、连接/拖动防误打开、星标单击 | `.desktop-test/open-release-final.log` |
| `tests/layout.cjs` | 编辑栏整行分布、三个滚动位置、宽窄窗口与大纲打开时不遮正文、MD 标识与黑色外观 | `.desktop-test/layout-release-final.log` |
| `tests/tabs.cjs` | 独立阅读位置、内容、模式和撤销；重复打开复用；后台元数据；关闭保存/取消；另存冲突；末标签回退；退出保存与标签溢出布局 | `.desktop-test/tabs-release-final.log` |
| `tests/source.cjs` | 完整源码保留、实时对照、源码撤销、每标签状态、后台保存、可视化切换、宽窄布局、主题、SKILL 校验及退出冻结 | `.desktop-test/source-release-final.log` |
| `tests/compare.cjs` | 双栏编辑与双向同步、格式控件、共享撤销重做、延迟 IPC、精确保存、位置与副本保护、独立标签、窄屏缩放和只读模式 | `.desktop-test/compare-release-final.log` |

最终包截图在 `.desktop-test/mindmap-feedback-HMqkyw/`，包括 `light-chinese-overview.png`、`dark-english-1180.png` 和 `dark-english-720.png`；主题截图在 `.desktop-test/map-themes-Sq1Zqp/`。720 宽黑色英文截图已目视检查，五列两排工具栏和画布边界正常。长标题检查使用浏览器实际文字矩形核对卡片边界、装饰安全区和关联星标，允许画布正常滚动，不以隐藏文字替代完整显示。

## 导出专项与代码复查

- `tests/mindmap-export.cjs` 的最终源码专项运行退出码 0；使用独立 Electron 窗口调用导出辅助模块。SVG、PNG、PDF 均生成总览与两章，共 3 页；PNG 尺寸为 1920 × 1200，A4 横向 PNG 为 3508 × 2480；PDF 验证 3 页和文本映射。另检查长卡片导出、有效图片像素，以及导出完成后隐藏窗口销毁。
- 导出专项日志：`.desktop-test/export-release-final.log`；文件及结果位于 `.desktop-test/mindmap-export-OXxyeu/`。这是源码辅助模块专项，总览 PNG 已目视检查，中文、节点背景和箭头正常。
- 另外扩展 `tests/mindmap-feedback.cjs` 后对同一最终文件夹产物再运行一次，退出码 0：真实界面的 SVG、PNG、PDF 三条导出路径均通过，PNG 1920 × 1200、PDF 单页和文字映射符合预期；隐藏窗口被清理，原图内容和保存状态不变。日志 `.desktop-test/feedback-export-release-final.log`，文件和截图 `.desktop-test/mindmap-feedback-Xk9k8r/`。此次仅增强测试，未修改生产产物。
- 独立代理代码复查确认两项 P2 导出问题已修复：长章节标题挤占页头造成负缩放比例，以及晶体风格关系线忽略显式曲线选项。复查确认 `entities` 生产依赖与锁文件一致，主进程辅助模块及动态模块构建路径正确，取消、覆盖确认、目标变更保护和临时文件清理仍保留；复查未发现新的阻断问题。该结论来自代理代码复查，没有单独的外部审查报告文件。
- 原生截图检查曾发现短关系线的双向箭头随选中线宽放大而重叠；修正为独立于线宽并受线长约束的尺寸后，专项断言和最终文件夹版回归均通过。

## 最终产物启动与便携运行

- 最终 `tests/packaged-startup.cjs`：文件夹版和单文件版各 4 场景，共 8 项通过，退出码 0。环境分别为正常、`ELECTRON_RUN_AS_NODE=1`、非法 `NODE_OPTIONS`、两者同时存在。每项实际加载指定 Markdown，创建独立 userData，启动超过 5 秒后仍有有效原生窗口句柄，报告版本均为 0.1.29。测试自建进程正常退出。
- 启动通过日志 `.desktop-test/startup-release-final-pass.log`，逐项日志与截图 `.desktop-test/packaged-startup-xUiOKb/`。最初失败日志 `.desktop-test/startup-release-final.log` 保留：测试自身用 `windowsHide:true` 启动 GUI，导致原生句柄为 0。相同产物 A/B 比较证实 PID 正确，仅取消隐藏被测应用便恢复有效句柄；检查和清理辅助进程仍隐藏。诊断日志 `.desktop-test/startup-diagnose-hidden.log` 和 `.desktop-test/startup-diagnose-visible.log`，生产程序无需因此修改。
- 最终单文件版 `tests/portable.cjs`：退出码 0，覆盖仅复制一个 EXE 到中文及空格目录、改名运行、相对路径打开 Markdown 与导图、编辑保存、第二次启动复用窗口、关联标签复用、关闭重开恢复、缓存文件缺失和截断修复、两次并发首次启动共用完整缓存。日志 `.desktop-test/portable-release-final.log`，隔离文件 `.desktop-test/single-file-EhFW3X/`。
- 首次本地测试包为 337836213 字节，SHA-256：`1E004370E57406DB608D04D92BB26D8AAE1D401D3198C6A727B8E300435A950C`。正式公开包会包含更新后的发布说明，不能用本地测试包的摘要验证公开下载；公开文件以 Release 附带的 `SHA256SUMS.txt` 为准。
- 实现完成时 `git diff --check` 通过。

## 公开发布包复核

用户确认发布后同步中英文下载说明，再执行 `npm run package:portable`，构建退出码 0。将最终文件夹包的 52 个文件与上述通过测试的本地包逐一比较 SHA-256，只有 `resources/app/README.txt` 和 `resources/app/README.en.txt` 不同，所有程序代码与运行时字节相同；记录在 `.desktop-test/release-0.1.29-package-comparison.log`。因此未因说明文件变更重复全量单元测试。

- 最终文件夹及单文件包重新运行 `tests/packaged-startup.cjs`：8 项通过；日志 `.desktop-test/release-0.1.29-startup.log`。
- 最终文件夹包重新运行 `tests/mindmap-feedback.cjs`：通过，包含真实 UI 的 SVG、PNG、PDF 导出、长标题、备注、关系线、整理布局、格式读写、只读保护及标题转导图；日志 `.desktop-test/release-0.1.29-feedback.log`。
- 最终文件夹包运行 `tests/updates.cjs`：通过，覆盖两个手动检查入口、公开预览版识别、纯文本说明、官方下载页、错误处理与检查期间继续编辑保存；日志 `.desktop-test/release-0.1.29-updates.log`。
- 最终单文件包重新运行 `tests/portable.cjs`：通过，覆盖独立复制、改名、中文及空格路径、相对文件参数、保存、单实例转交、关联文档、会话恢复、缓存复用与修复、并发首次准备；日志 `.desktop-test/release-0.1.29-portable.log`，隔离目录 `.desktop-test/single-file-GSjP8l/`。
- 完整读取发布 ZIP 的 52 个文件并逐一计算 SHA-256，与最终构建目录一致；检查运行时、项目许可、Chromium 许可、第三方声明、中英文说明、模板与 Windows 脚本齐全。记录在 `.desktop-test/release-0.1.29-zip.log`。
- 已安装的直接依赖通过 `npm ls --depth=0` 检查。待提交源码不含生成目录、日志或恢复状态；常见凭据模式扫描未发现匹配。

| 公开包 | 字节数 | SHA-256 |
| --- | ---: | --- |
| MD-Windows-x64-0.1.29.exe | 337839278 | `9bc0c82bc3f9801030b57ad0233925b994e325677beb63c6c0db4d7ceb12ead2` |
| MD-Windows-x64-0.1.29.zip | 150059479 | `aff268dac6d9f1dccee2494bc9250c69d538e3bffe6aa8ae89d2dbdf38d7cefe` |

对应标签的源码 ZIP、两份独立模板及以上文件的校验值随 Release 的 `SHA256SUMS.txt` 提供。发布包包含公开使用说明，摘要与先前同版本本地测试包不同。

## 范围与限制

- 本轮按用户后续要求准备公开预览版。新增 Windows 构建/启动工作流只负责自动检查，不会自动上传或发布软件；本地验证不等于 GitHub Actions 已运行成功。
- Windows 10/11 x64 为兼容目标，本轮实际桌面验证环境为 Windows 11；未新增 Windows 10 实机测试，也未验证 macOS 版本。当前 Windows 产物未签名。
- 本轮功能和启动检查不构成完整性能基准，不能据此承诺首次运行稳定在 2 秒内。
- v1–v5 导图保持可读；使用本轮新增字段的文件保存为 v6，旧版程序不支持这些新增字段。
- 标题转导图建立导航结构并保留原文，不能补回原本未交付的 Markdown 正文。此前提到的 AI 讲义首次打开找不到文件，仍缺少原始讲义文件，具体根因尚未确认，本轮不宣称已修复该具体讲义。
- 这里仅列出本轮实际执行的检查，没有宣称重跑全部历史独立桌面脚本。`.desktop-test/` 下的日志与截图是本机验证证据，不属于程序运行所需文件。
