# Markdown-Editor-Mindmap（Markdown 可视化编辑与思维导图）

Markdown-Editor-Mindmap (MD) is a minimal desktop Markdown reader and editor with visual editing, source/split views, and mindmaps linked to local Markdown files.

[简体中文](README.md) · [Download 0.1.30](https://github.com/AkiNariT/Markdown-Editor-Mindmap/releases/tag/v0.1.30) · [User guide](README.en.txt) · [Changelog](CHANGELOG.md) · [Roadmap](ROADMAP.md)

**New in 0.1.30:** Fixes roots, branches and selected groups getting stuck at canvas edges, and inconsistent bends in orthogonal lines to aligned nodes. The canvas expands during dragging, children follow, and obstacle avoidance remains. Unpressed mouse movement no longer affects a drag. The canvas and SVG/PNG/PDF exports share the corrected routing. See the [changelog](CHANGELOG.md) and [validation record](docs/VALIDATION-0.1.30.md).

## Development approach

This project is developed primarily with AI tools.

## Download

### Recommended: single-file EXE

**[Download the Windows x64 single-file EXE](https://github.com/AkiNariT/Markdown-Editor-Mindmap/releases/download/v0.1.30/MD-Windows-x64-0.1.30.exe)**

1. Put `MD-Windows-x64-0.1.30.exe` on your Desktop or in another convenient location. Renaming is supported.
2. Double-click it. No installation, administrator access or additional runtime download is required.
3. The first launch prepares runtime files under `%LOCALAPPDATA%\MD\Runtime`. Later launches reuse a complete cache; missing, truncated or explicitly failed runtimes trigger preparation of a new copy. Please wait while “Opening MD” is shown; startup time depends on your disk and system load. Before upgrading, save your work and close the old version normally, then open the new file.

The single-file download is about **338 MB**. It embeds uncompressed runtime files to reduce preparation steps, trading a larger download for startup improvements; first launch within two seconds is not guaranteed. The runtime cache contains program files only and remains after exit. Updates and repairs may retain older copies. To clear it, save your documents and close every MD instance before deleting that runtime cache; the next launch prepares it again.

Settings and draft backups remain in `%APPDATA%\MD` for the current Windows user. Copying the executable does not transfer this data. Save your documents in your own folders. If you set MD as the default app, repeat that setup after moving or renaming the executable.

### Alternative: complete folder ZIP

**[Download the Windows x64 complete folder ZIP](https://github.com/AkiNariT/Markdown-Editor-Mindmap/releases/download/v0.1.30/MD-Windows-x64-0.1.30.zip)**

Extract the whole archive and run `MD.exe`. Keep the application folder intact: the `MD.exe` inside a folder ZIP needs its accompanying files and cannot be copied on its own. For an upgrade, extract the new version to a separate folder, save your work and close the previous version normally, then run the new executable. Run only one instance with the same user data. Node.js is not required to use the download.

The current download, **0.1.30, is a public preview**. Windows 10/11 x64 are the targets; existing desktop validation uses Windows 11 x64. A separate Windows 10 machine has not been tested. The portable builds are unsigned and have no installer. See the [validation record](docs/VALIDATION-0.1.30.md) for this release's actual checks and limitations. The [0.1.30 release page](https://github.com/AkiNariT/Markdown-Editor-Mindmap/releases/tag/v0.1.30) provides six assets: the single-file EXE, complete folder ZIP, source ZIP, `SKILL.md`, `SKILL.en.md` and `SHA256SUMS.txt`.

Default app: Open **More (…) → Settings → Set default app** to register the current application locally and open Windows Settings, then choose MD for `.md` and `.markdown`. If registration fails, use Open Windows Settings to continue manually. Copy program path supplies the path for the system file picker, and View error details shows the cause and error code. Windows confirms the final default selection. Repeat this from the new location after upgrading, moving or renaming the application.

The single-file version registers the outer EXE that you saved. Copy program path also uses that file's location.

To check for updates, open **More (…) → Check for updates** or **Settings → Check for updates**, then click the check button in the dialog. This manually retrieves public releases from this repository, including public prereleases, and shows your version, the newest compatible Windows x64 version and plain-text release notes. The release-page button opens a verified official release page in your browser. Download and upgrade using the steps above. MD does not check automatically in the background or automatically download, install or restart. Close the dialog to continue editing and saving documents.

**A macOS version is planned; no Mac download is currently available.** Work will continue on the existing features alongside macOS adaptation and testing on Mac hardware. Supported macOS versions, chip architectures and a release date will be announced after validation. See the [roadmap](ROADMAP.md).

## Features

- Read and edit formatted Markdown, including headings, lists, tasks, quotes, tables, images and highlighted code blocks.
- Edit source and formatted content together in Split view, with shared undo/redo.
- Keep multiple documents, individual reading positions, zoom and unsaved changes.
- Create mindmap nodes, use drag alignment guides, move multiple selected nodes, route connections around nodes, add labeled relationships, apply fixed palettes and choose six whole-map styles.
- Choose curved, orthogonal or straight connections; use three node widths, full long titles, notes, relationship line styles, arrows and colors, and undoable Arrange.
- Export SVG, PNG or PDF with natural, 16:9, 16:10 or A4 landscape pages; export the visible map or an overview plus chapter pages.
- Turn Markdown headings into a new map while keeping the original document open; saved source files can be linked to the nodes.
- Link nodes to Markdown files; double-click an unlinked node to write a draft, then create and link its file on the first successful save.
- Register the portable app with Windows, open default-app settings, copy its path and inspect errors; the final default selection remains yours.
- Recover local drafts and session state. Original files still require Save.
- Manually check public releases and release notes, then open the official release page in your browser.
- Switch between Chinese/English and light/black appearance; zoom with Ctrl+mouse wheel.
- Create documents from the included Chinese/English SKILL templates, preserving YAML frontmatter.

New line styles, node widths, notes and relationship appearances use map format **v6, requiring MD 0.1.29 or later**. Existing v1 through v5 maps still open; maps using only v5 whole-map styles retain MD 0.1.22 as their minimum version. Old colors are preserved and retired Note/Double border shapes display as Classic. Keep linked Markdown files and their relative directory structure when sharing maps; their contents are not embedded in the map.

In Edit mode, drag a node near another node's row or column to show blue dashed alignment guides and snap into place. Drag farther to release, or hold `Alt` to move freely. `Ctrl`/`Shift`-click multiple nodes, release the modifier key, then drag the group. Selecting both a parent and a child does not move the child twice. Guides disappear on release or cancellation. Alignment and connection routing do not rearrange the whole map; leave space between cards, as fully overlapping nodes may still obscure connections. Large, complex maps still incur routing costs.

Dragging roots, branches or selected groups beyond the original top or left canvas edge expands the canvas while children continue to follow. Mouse movement without a pressed button does not affect the drag. Orthogonal branches use a consistent bend in clear corridors between aligned columns, while retaining detours around nodes.

Arrange clears manual offsets and compacts visible branches while retaining collapsed branches; the action supports undo. Export creates numbered SVG/PNG files or a multipage PDF. Exports use a light theme on white pages; PNG output is limited to about 16 million pixels and 8192 pixels per edge.

## Privacy and license

MD has no built-in document upload, account sync or telemetry feature. Files and recovery data remain local. A manual update check contacts `api.github.com`, which receives your IP address and normal request metadata; the check sends no documents, local paths, drafts or account tokens. Remote images still contact their servers, and web links and update release pages may open your browser. See [privacy details](PRIVACY.md).

Source is available under the existing [MIT License](LICENSE), with its copyright notice retained. Third-party licenses are listed in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt); Electron/Chromium notices accompany the portable runtime. See [project notices](NOTICE.md) for limitations.

## Development

Use Windows, Node.js 24.15.0 and npm:

```powershell
npm ci
npm run build
npm start
node --test --test-concurrency=1 tests/*.test.mjs
npm run package
npm run package:portable
```

`npm run package` produces the folder build in `.packaged/MD-win32-x64`; `npm run package:portable` builds that folder and then `.packaged/portable/MD-Windows-x64-VERSION.exe`. Initial dependency installation/builds may download runtimes and packaging tools. The finished single-file app does not download runtime components when launched. Read [CONTRIBUTING.md](CONTRIBUTING.md), [release maintenance](docs/RELEASING.md), [0.1.30 validation](docs/VALIDATION-0.1.30.md) and [security reporting](SECURITY.md) before contributing.
