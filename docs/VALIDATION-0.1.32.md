# 0.1.32 Windows 验证记录

日期：2026-10-27。实际环境：Windows 11 x64（10.0.26100）、Node.js 24.15.0、Electron 44.5.1、Playwright 1.58.2。本次基于 Windows 0.1.30 开发；下文保留本地测试阶段记录，公开发布检查另列。未验证 Windows 10 独立设备或 macOS，公开状态以 [v0.1.32 发布页](https://github.com/AkiNariT/Markdown-Editor-Mindmap/releases/tag/v0.1.32) 为准。

## 改动范围

- 编辑正文、源码或对照视图时，可通过 Ctrl+V 粘贴截图，或拖入 PNG、JPEG、GIF、WebP。现有“图片”按钮也支持未保存草稿和批量选择。
- 草稿图片在本机用户数据目录持久保存；首次保存将实际引用的图片复制到文档旁的 `.assets` 文件夹，并改写相对路径。取消或写入失败保留草稿缓存。
- 导入期间固定文档、光标和内容状态，切换标签或内容变化时停止插入，避免落到其他文档。导入批次可整体撤销和重做。
- 导入限制：最多 10 张、每张 20 MiB、合计 50 MiB。按文件特征识别格式；这不等于对所有图片内容完整解码验证。
- 分享仍须同时提供 Markdown 与图片文件夹；无图片上传服务。操作见 [图片说明](IMAGE-PASTE.md)。

## 基线与复现

- 修改前运行 `node --test --test-concurrency=1 tests/*.test.mjs`，398 项通过，0 失败、0 跳过。日志 `.desktop-test/baseline.log`。此结果仅作原有行为基线。
- 新增原生 `tests/image-paste.cjs`，使用实际 Windows 剪贴板图片与 Ctrl+V；旧构建在首次草稿粘贴后等待图片出现时失败，确认旧版缺少该功能。日志 `.desktop-test/image-paste-red.log`。
- 测试使用隔离配置和临时文档。系统剪贴板原内容只在测试进程内存中暂存，在主动重启和最终退出前恢复，不写入日志或测试文件。

## 验证边界

`node scripts/build.mjs` 与 `node scripts/package.mjs` 均退出 0。包内版本为 0.1.32；包内 renderer 与最终 `dist/app.js` 的 SHA-256 同为 `d5202d9d76a0425fbeb64d82988090f619f2abc348da973669945e79c8f4ae34`。

以下五组对最终 `.packaged/MD-win32-x64/MD.exe` 的原生回归全部退出 0：

| 脚本 | 覆盖内容 |
| --- | --- |
| `tests/image-paste.cjs` | 真实截图 Ctrl+V、草稿恢复与图片转存、批量拖入事件、撤销重做、普通文本框保护和跨文档竞态 |
| `tests/source.cjs` | 完整源码、原格式保存、实时对照、源码撤销、多标签位置与内容、SKILL、退出冻结 |
| `tests/compare.cjs` | 两侧编辑同步、共享撤销、延迟 IPC、精确保存、特殊格式保护、宽窄布局和只读模式 |
| `tests/mindmap-drafts.cjs` | 导图新建草稿先写后存、取消与冲突保护、恢复、首次保存关联及撤销、原节点变动保护 |
| `tests/recovery-close.cjs` | 明确放弃、后续取消、关闭标签、原文件缺失或外部修改、持久备份时关闭 |

对应日志：`.desktop-test/<脚本名>-packaged-0.1.32.log`。

最终前端、编辑器、源码历史、普通输入框保护及语言检查 27 项全部通过：`.desktop-test/frontend-final-0.1.32.log`。最终开发构建原生图片流程退出 0：`.desktop-test/image-paste-green.log`，覆盖真实 Ctrl+V、草稿取消保存及重启恢复、首次保存转存、源码/对照插图与撤销、多文件 drop 事件、非法图片拒绝、普通文字粘贴、命名框保护、导入过程中切换文档、空白草稿先存后插图、原“图片”按钮；渲染错误为 0。

联调期间修正了两处测试与实现问题：恢复测试必须等对照模式本身写入快照，图片计数须排除 ProseMirror 的占位图；源码插图补足段落边界以符合块图片结构，纯图片粘贴到普通文本框时阻止浏览器用空文字替换选区。没有为通过测试而强制切换回对照模式。

全量回归日志 `.desktop-test/unit-final-0.1.32.log`：437 项中 436 项通过，1 项导图性能计时超出原阈值（1000 节点星形用时 778.8 ms）；未修改该导图代码或放宽阈值。随后单独重跑同一导图路由文件，14 项全部通过，星形用时 57.0 ms，日志 `.desktop-test/routing-recheck-0.1.32.log`。推测差异与当时系统负载有关；不将此前失败的全量记录改写成全部通过。

全量运行后补充引用迁移遗漏时拒绝保存的保护及多行参考标签处理，最终后端、恢复、导图草稿及语言检查 64 项全部通过：`.desktop-test/backend-final-0.1.32.log`。不将有重叠的测试次数相加为总数。

真实截图粘贴通过系统剪贴板和键盘组合执行；拖入测试通过浏览器的 DataTransfer / DragEvent 注入文件，未进行资源管理器鼠标拖入的人工测试。保存与选择文件弹窗由自动化返回隔离测试路径。不会据此声称所有第三方截图软件、所有格式变体、所有 Windows 设备均已验证。

本地测试包沿用未签名的 Windows 便携版，图片功能不改变安装方式或默认文件关联。

## 本地测试阶段的单文件交付

`node scripts/package-portable.mjs` 退出 0。最终交付文件为工作区 `outputs/MD-Windows-x64-0.1.32.exe`，337928562 字节，SHA-256：`eb1bd44c23b7e5ff7f860e811db8c8f8d06198c7dd8ad7abe2f5349f456a1072`；已与构建产物逐一计算并确认相同。

对该交付文件执行 `tests/portable.cjs`，退出 0。确认中文和空格目录内单独 EXE 启动、复制改名、相对路径文档打开与保存、第二实例转交、会话恢复、缓存复用、缺失/截断缓存修复及并发首次启动。日志 `.desktop-test/portable-0.1.32.log`，隔离证据目录 `.desktop-test/single-file-T6qJTV`。该测试包含自动化连接和缓存准备，不作为首次启动 2 秒达标证明。

独立代理对图片存储、恢复、关闭清理、前端文档身份核对和引用迁移做了复查；发现项已修正并执行针对性回归。该阶段 `git diff --check` 和 main/preload 语法检查通过，本地测试包未直接上传 GitHub；公开包在更新随附说明后重新构建。

## 公开发布检查

- 用户确认发布后，对最终源码执行完整串行单元测试：**442 项通过，0 失败、0 跳过**，耗时 299317.1375 ms。包含最终源码插图边界、普通输入框保护、多行参考标签和迁移遗漏保护；日志 `.desktop-test/release-0.1.32-unit.log`。此次 1000 节点星形路由为 79.9 ms，未更改原性能阈值。
- 更新中英文公开说明与下载链接，重新构建文件夹版和单文件版，两项构建均退出 0。53 个运行文件与本地测试包逐项比较，只有 `resources/app/README.txt` 和 `resources/app/README.en.txt` 不同；代码和运行时一致。记录 `.desktop-test/release-0.1.32-package-comparison.json`。
- 最终公开文件夹包重新执行图片粘贴与检查更新界面回归，全部通过、渲染错误为 0。日志 `.desktop-test/release-0.1.32-image-paste.log` 和 `.desktop-test/release-0.1.32-updates.log`。
- 对最终文件夹版和单文件版执行 `tests/packaged-startup.cjs`：各自覆盖干净环境、`ELECTRON_RUN_AS_NODE`、非法 `NODE_OPTIONS` 和两者同时存在，共 **8 种场景全部通过**。逐项确认实际打开测试 Markdown、独立用户目录、五秒后仍存在非零原生窗口句柄、实际版本 0.1.32 和有效 PNG；日志 `.desktop-test/release-0.1.32-startup-view.log`，证据目录 `.desktop-test/packaged-startup-JJdTiS`。截图亦确认显示测试正文。
- 此前两次启动检查在 Playwright 截图阶段超时，截图前的窗口、文档和版本断言均成功。测试改用 CDP 的 `fromSurface:false` 视图取图，保留 30 秒超时及全部功能断言，没有改变产品或启动参数；随后完整 8 场景成功。原日志保留为 `.desktop-test/release-0.1.32-startup.log` 和 `.desktop-test/release-0.1.32-startup-recheck.log`。桌面遮挡可能与超时有关，但未确认其唯一原因；启动测试耗时不作为性能承诺。
- 完整读取文件夹 ZIP 的 53 个文件，逐个核对解压内容的 SHA-256，与最终构建目录完全一致。记录 `.desktop-test/release-0.1.32-zip-verification.json`。包内包含项目、运行时和第三方许可，以及中英文说明和模板。

| 公开包 | 字节数 | SHA-256 |
| --- | ---: | --- |
| MD-Windows-x64-0.1.32.exe | 337928418 | `0afd3af786b9806edba72ebbe3ff8e5106aee718438755ea6369af7799a9015e` |
| MD-Windows-x64-0.1.32.zip | 150082356 | `0b65a6ea2eaeedc9a4d923cda850d450a44d1faeab135f3eeac023da892d238a` |

Mac 0.1.31 仍为独立预览版本，本次没有更新其资产或合并 Mac 草稿 PR。Windows 10 独立设备和 Mac 实机未在本次验证范围内。
