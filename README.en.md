# MD

A minimal desktop Markdown reader and editor with visual editing, source/split views, and mindmaps linked to local Markdown files.

[简体中文](README.md) · [Download 0.1.21](https://github.com/AkiNariT/MD/releases/tag/v0.1.21) · [User guide](README.en.txt) · [Changelog](CHANGELOG.md) · [Roadmap](ROADMAP.md)

## Development approach

This project is developed primarily with **AI coding tools, including OpenAI Codex**, for implementation, debugging and documentation. The maintainer decides the product direction, design choices and public releases. AI-generated code still requires verification; completed checks and known limitations are documented in the [validation record](docs/VALIDATION-0.1.21.md).

## Download

**[Windows x64 portable ZIP](https://github.com/AkiNariT/MD/releases/download/v0.1.21/MD-Windows-x64-0.1.21.zip)**

Extract the whole archive and run `MD.exe`. Keep the application folder intact. Save your work and close the previous version before upgrading. Node.js is not required to use the download.

Version **0.1.21 is a public preview**. Windows 10/11 x64 are the targets; desktop validation was performed on Windows 11 x64. A separate Windows 10 machine was not tested. The portable build is unsigned and has no installer or automatic updater. Checksums are provided with each [release](https://github.com/AkiNariT/MD/releases).

**A macOS version is planned; no Mac download is currently available.** Work will continue on the existing features alongside macOS adaptation and testing on Mac hardware. Supported macOS versions, chip architectures and a release date will be announced after validation. See the [roadmap](ROADMAP.md).

## Features

- Read and edit formatted Markdown, including headings, lists, tasks, quotes, tables, images and highlighted code blocks.
- Edit source and formatted content together in Split view, with shared undo/redo.
- Keep multiple documents, individual reading positions, zoom and unsaved changes.
- Create mindmap nodes, drag branches, add labeled relationships, set colors and choose five card styles.
- Link nodes to Markdown files; double-click an unlinked node to create and open a file.
- Recover local drafts and session state. Original files still require Save.
- Switch between Chinese/English and light/black appearance; zoom with Ctrl+mouse wheel.
- Create documents from the included Chinese/English SKILL templates, preserving YAML frontmatter.

Mindmap backgrounds, card styles and relationship labels use map format **v4**, requiring MD 0.1.21 or later. Existing v1/v2/v3 maps still open. Keep linked Markdown files and their relative directory structure when sharing maps.

## Privacy and license

MD has no built-in document upload, account sync or telemetry feature. Files and recovery data remain local. Remote images contact their servers, and web links may open your browser. See [privacy details](PRIVACY.md).

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

Packaging produces `.packaged/MD-win32-x64`. The first dependency installation/package operation may download Electron. Read [CONTRIBUTING.md](CONTRIBUTING.md), [release maintenance](docs/RELEASING.md), [validation](docs/VALIDATION-0.1.21.md) and [security reporting](SECURITY.md) before contributing.
