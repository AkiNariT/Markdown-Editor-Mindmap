# Markdown-Editor-Mindmap（Markdown 可视化编辑与思维导图）

Markdown-Editor-Mindmap (MD) is a minimal desktop Markdown reader and editor with visual editing, source/split views, and mindmaps linked to local Markdown files.

[简体中文](README.md) · [Download 0.1.23](https://github.com/AkiNariT/Markdown-Editor-Mindmap/releases/tag/v0.1.23) · [User guide](README.en.txt) · [Changelog](CHANGELOG.md) · [Roadmap](ROADMAP.md)

**New in 0.1.23:** Manual update checks, fixed color palettes, and six whole-map styles: Classic, Rounded, Capsule, Branches, Vines and Crystal. Whole-map styles use map format v5 and require 0.1.22 or later.

## Development approach

This project is developed primarily with AI tools.

## Download

**[Windows x64 portable ZIP](https://github.com/AkiNariT/Markdown-Editor-Mindmap/releases/download/v0.1.23/MD-Windows-x64-0.1.23.zip)**

Extract the whole archive and run `MD.exe`. Keep the application folder intact. For an upgrade, extract the new version to a separate folder, save your work and close the previous version normally, then run the new executable. Run only one instance with the same user data. Node.js is not required to use the download.

Version **0.1.23 is a public preview**. Windows 10/11 x64 are the targets; existing desktop validation uses Windows 11 x64. A separate Windows 10 machine has not been tested. The portable build is unsigned and has no installer. See the [validation record](docs/VALIDATION-0.1.23.md) for the checks actually performed for this version. Downloads and checksums are on the [0.1.23 release page](https://github.com/AkiNariT/Markdown-Editor-Mindmap/releases/tag/v0.1.23).

To check for updates, open **More (…) → Check for updates** or **Settings → Check for updates**, then click the check button in the dialog. This manually retrieves public releases from this repository, including public prereleases, and shows your version, the newest compatible Windows x64 version and plain-text release notes. The release-page button opens a verified official release page in your browser. Download and upgrade using the steps above. MD does not check automatically in the background or automatically download, install or restart. Close the dialog to continue editing and saving documents.

**A macOS version is planned; no Mac download is currently available.** Work will continue on the existing features alongside macOS adaptation and testing on Mac hardware. Supported macOS versions, chip architectures and a release date will be announced after validation. See the [roadmap](ROADMAP.md).

## Features

- Read and edit formatted Markdown, including headings, lists, tasks, quotes, tables, images and highlighted code blocks.
- Edit source and formatted content together in Split view, with shared undo/redo.
- Keep multiple documents, individual reading positions, zoom and unsaved changes.
- Create mindmap nodes, drag branches, add labeled relationships, apply fixed palettes and choose six whole-map styles.
- Link nodes to Markdown files; double-click an unlinked node to create and open a file.
- Recover local drafts and session state. Original files still require Save.
- Manually check public releases and release notes, then open the official release page in your browser.
- Switch between Chinese/English and light/black appearance; zoom with Ctrl+mouse wheel.
- Create documents from the included Chinese/English SKILL templates, preserving YAML frontmatter.

Fixed palettes and relationship labels use map format **v4**. Whole-map styles use **v5**, requiring MD 0.1.22 or later. Existing v1 through v4 maps still open; old colors are preserved and retired Note/Double border shapes display as Classic. Keep linked Markdown files and their relative directory structure when sharing maps.

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
```

Packaging produces `.packaged/MD-win32-x64`. The first dependency installation/package operation may download Electron. Read [CONTRIBUTING.md](CONTRIBUTING.md), [release maintenance](docs/RELEASING.md), [validation](docs/VALIDATION-0.1.23.md) and [security reporting](SECURITY.md) before contributing.
