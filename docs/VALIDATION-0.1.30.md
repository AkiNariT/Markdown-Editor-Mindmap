# 0.1.30 公开预览版验证记录

日期：2026-10-20。实际环境：Windows x64（10.0.26100）、Node.js 24.15.0、Electron 44.5.1、Playwright 1.58.2；原生窗口记录的 devicePixelRatio 为 1.25。本记录包含本地修复及后续公开发布检查；公开结果以 [v0.1.30 Release](https://github.com/AkiNariT/Markdown-Editor-Mindmap/releases/tag/v0.1.30) 为准。

## 问题与修改

- 主节点拖动会带动后代；旧逻辑把所有可见后代限制在画布左、上边界内，任一后代碰到边界都会限制整组。现在允许越过原画布边界，通过增加画布留白并补偿滚动保持鼠标与节点同步；保留文件偏移量范围限制。
- 折叠后只有一个节点的小图也保留足够滚动空间。补偿依据整次手势的起点计算，避免 125% 显示缩放逐次舍入积累误差；吸附参考线同步平移。
- 鼠标未按键的移动事件不再改变正在进行的节点拖动或画布平移；失去指针捕获、窗口焦点等原有取消行为继续保留。
- 直角线原先根据两个节点的水平、垂直距离选择端点。远处节点触发避障后采用另一处中线，导致同列节点形成两条竖线。现在先使用已通过避障检查的统一列间通道，受阻时仍使用既有绕行逻辑；曲线、直线及导出共用模块保持兼容。

## 复现与单元检查

- 使用用户 ZIP 中课程导图的只读副本复现：8 条直角分支原先分别使用 x=254 和 x=261；修正后统一为 x=261，并与 SVG 导出路径逐条一致。没有修改用户原始资料，课程正文和原始导图未加入仓库。
- 新增边界、分组、小图、显示缩放、鼠标悬停和直角路由回归，先确认旧行为失败再修改实现。原生回归旧构建断言为 `root screen x displacement: 0 vs -70`，记录在 `.desktop-test/boundary-red.log`。
- 完整串行单元测试：397 项通过，0 失败，耗时 216391.4785 ms。日志 `.desktop-test/unit-0.1.30.log`。
- 上述完整运行后追加鼠标悬停防护；最终视图与对齐专项重新运行 58 项，全部通过。日志 `.desktop-test/root-drag-focused.log`。未把两次有重叠的测试相加为总数，也未将较早的全量结果冒充最终全量复测。
- 路由与导出独立复查：26 项通过。完整单元运行的 1000 节点星形与不规则网格路由分别约 123.4 ms、948.0 ms，未放宽原阈值。

## 修复完成时的 Windows 包交互检查

`npm run build`、`npm run package`、`node scripts/package-portable.mjs` 均退出 0。文件夹包的 `resources/app/dist/app.js` 与最终 `dist/app.js` 的 SHA-256 相同。

以下四组脚本均对最终 `.packaged/MD-win32-x64/MD.exe` 运行，全部退出 0：

| 脚本 | 实际检查 |
| --- | --- |
| `tests/mindmap-boundary.cjs` | 主节点首次拖动、越过左上边界、所有后代跟随、撤销重做、Esc 取消、保存重开、只读保护、折叠为单节点及 8 条直角分支统一竖线 |
| `tests/mindmap-alignment.cjs` | 吸附参考线、Alt 暂停、150% 文档缩放、多选父子只移动一次、六种主题避障、保存与只读 |
| `tests/mindmap-interaction.cjs` | 原有分支拖动、关系线、撤销取消、缩放、右键、文档关联、恢复布局、菜单边界 |
| `tests/mindmap-feedback.cjs` | 完整标题及备注、节点宽度与主题、关系线属性、另存重开、SVG/PNG/PDF 导出、黑色外观、英语、窄窗口及标题转导图 |

日志为 `.desktop-test/<脚本名>-packaged-0.1.30.log`。

测试窗口使用独立配置和资料。可见窗口自动拖动时，事件跟踪捕获到电脑物理鼠标的悬停以及 `lostpointercapture`，会干扰注入的手势。交互复测仅隐藏测试自己的窗口，并关闭这些窗口的后台节流，以隔离物理输入；保留生产程序的焦点与指针取消逻辑。最终交互检查使用真实 Electron 渲染及鼠标事件，不是只检查数据模型。可见原生窗口启动另行检查。

## 本地测试包启动与交付

- 最终文件夹版和单文件版各 4 个启动场景全部通过：正常环境、`ELECTRON_RUN_AS_NODE`、非法 `NODE_OPTIONS`、两者同时存在。实际读取指定 Markdown，创建隔离配置，5 秒后仍有非零原生窗口句柄，实际版本均为 0.1.30。日志 `.desktop-test/startup-0.1.30-final.log`，证据目录 `.desktop-test/packaged-startup-XWinPq/`。
- 首次启动脚本运行在截图阶段超时，窗口句柄、已打开文档及版本检查此前均通过；测试脚本增加截图前激活自身页面后，以上 8 场景全部完成。生产代码未为此改变。原始失败日志 `.desktop-test/startup-0.1.30.log` 保留。
- 交付文件 `outputs/MD-Windows-x64-0.1.30.exe` 位于本次聊天工作区根目录，337840315 字节。SHA-256：`e137e7fa82e27f21cd9d931351e5bed7ebdd5aa04ff7e7ab372f2f91347dc9f0`。已与构建产物逐一计算并确认摘要相同；单文件启动检查使用的就是该交付路径。
- 独立代理进行了只读代码复查，核对路由避障、导出共用逻辑、小图滚动范围及鼠标按键保护，最终无未解决的阻断发现。`git diff --check` 通过。

## 公开发布包核对

- 用户确认发布后，对最终源码重新执行 `node --test --test-concurrency=1 tests/*.test.mjs`：398 项通过，0 失败、0 跳过，耗时 216153.3371 ms。该次包括鼠标悬停防护，日志 `.desktop-test/release-0.1.30-unit.log`。
- 更新中英文公开说明与下载链接，重新构建文件夹版和单文件版。最终 52 个运行文件与此前通过交互检查的测试包逐一比较 SHA-256，只有 `resources/app/README.txt`、`resources/app/README.en.txt` 不同；程序代码和运行时一致。记录 `.desktop-test/release-0.1.30-package-comparison.json`。单文件最终封装日志 `.desktop-test/release-0.1.30-portable-final-build.log`。
- 最终文件夹包重新执行边界拖动和更新界面回归，均退出 0：`.desktop-test/release-0.1.30-mindmap-boundary.log`、`.desktop-test/release-0.1.30-updates.log`。更新检查覆盖手动入口、预览版、官方地址校验、错误处理和关闭弹窗后继续编辑保存。
- 完整读取文件夹 ZIP 内的 52 个文件，对解压内容逐一计算 SHA-256，与最终构建目录完全一致；记录 `.desktop-test/release-0.1.30-zip-verification.json`。包内包含运行时、项目和第三方许可、使用说明、独立模板与 Windows 集成脚本。
- 最终公开文件夹包、单文件 EXE 各 4 个启动场景全部通过，实际版本均为 0.1.30；日志 `.desktop-test/release-0.1.30-startup.log`。随后 `tests/portable.cjs` 退出 0，确认复制并改名的单文件程序、相对路径打开和保存、第二实例转交、会话恢复、损坏缓存修复及并发首次解压；日志 `.desktop-test/release-0.1.30-portable.log`。这组包含自动化连接及缓存修复的功能测试，不用于声称首次启动达到 2 秒。

| 公开包 | 字节数 | SHA-256 |
| --- | ---: | --- |
| MD-Windows-x64-0.1.30.exe | 337840892 | `c774a462482b52a1ca114ef7e99c50cd3c765d198162b634d2d9468e8e4cdf7f` |
| MD-Windows-x64-0.1.30.zip | 150059930 | `007732b9b6b921e94b8662e5176a20f0928154d304982f5db9092b5e8b012f2c` |

公开包包含更新后的发布说明，因此不能用上方本地测试包的摘要验证公开下载。源码 ZIP 来自对应 Git 标签；两个程序包、源码 ZIP 和两个独立模板的摘要由发布附件 `SHA256SUMS.txt` 提供。工作流不会自动公开 Release，远端检查结果以对应 GitHub Actions 运行为准。

## 范围

本轮未修改启动器、安装方式、导图格式或 Markdown 文件内容。没有重跑所有历史桌面脚本，也没有进行新的 Windows 10 实机或 macOS 验证。现有框架、便携运行方式及阅读模式保护保留。
