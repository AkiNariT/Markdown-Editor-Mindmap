Markdown-Editor-Mindmap（Markdown 可视化编辑与思维导图）0.1.29 public preview

The recommended download is MD-Windows-x64-0.1.29.exe. A complete folder ZIP, tagged source and standalone SKILL templates are also available.

New: line shapes, node width presets, full titles, notes, relationship arrows/colors, undoable Arrange, SVG/PNG/PDF export with natural/16:9/16:10/A4 landscape pages and overview + chapters. Headings to map keeps the original Markdown open. New properties use map format v6 and require MD 0.1.29 or later; existing v1 through v5 maps remain readable. Packaged startup is hardened against external Node environment variables.

Recommended single-file version: Copy MD-Windows-x64-0.1.29.exe to your Desktop or another convenient location and double-click it. You can rename it. No installation, administrator access or additional runtime download is required. The first launch prepares runtime files under %LOCALAPPDATA%\MD\Runtime. Later launches reuse the complete cache; missing or truncated files trigger preparation of a new copy. Please wait while “Opening MD” is shown; startup time depends on your disk and system load. This cache contains runtime files only, separate from documents and drafts.
The single-file download is about 338 MB. It embeds uncompressed runtime files to reduce preparation steps; first launch within two seconds is not guaranteed. The cache remains after exit, and updates or repairs keep older copies to avoid interrupting running instances. To clear it, save your documents and close every MD instance, then delete %LOCALAPPDATA%\MD\Runtime. The next launch prepares runtime files again.
Folder ZIP version: Extract the entire archive and run MD.exe inside it. This MD.exe needs its accompanying DLLs, resources and other files; keep the folder intact and do not copy that executable on its own.
When updating, save your work and close the old version normally, then open the new version. Extract folder ZIPs to a separate folder. Run only one instance with the same user data.
Settings and draft backups remain in %APPDATA%\MD for the current Windows user, unless you specify another location with --user-data-dir. Copying the application does not transfer this personal data. Save your documents in your own folders.
0.1.29 is an unsigned public preview. Its six release assets are the single-file EXE, complete folder ZIP, source ZIP, SKILL.md, SKILL.en.md and SHA256SUMS.txt: https://github.com/AkiNariT/Markdown-Editor-Mindmap/releases/tag/v0.1.29

Check for updates: Open More (…) → Check for updates or Settings → Check for updates, then click the check button in the dialog. MD requests public releases from the fixed official repository AkiNariT/Markdown-Editor-Mindmap, including public prereleases. The dialog shows your version, the newest compatible Windows x64 version and plain-text release notes. The release-page button opens a verified official release page in your browser, where you can choose an available download.
MD does not check automatically in the background or automatically download, install or restart. Close the dialog to continue editing and saving; an offline or failed check does not prevent normal use after closing the dialog.
A manual check contacts api.github.com. GitHub can receive your IP address and normal request metadata; the check sends no documents, local paths, drafts or account tokens. Remote images retain their existing behavior, and browser downloads use the external browser's network behavior. Privacy details: https://github.com/AkiNariT/Markdown-Editor-Mindmap/blob/v0.1.29/PRIVACY.md
Current public 0.1.29 release page: https://github.com/AkiNariT/Markdown-Editor-Mindmap/releases/tag/v0.1.29

Language: More (…) → Settings → Language → English or 简体中文. Changes apply immediately and are remembered after restart. Your existing documents and mindmap node text stay in their original language.

Open reads .md, .markdown and .mdmap files. Each document has its own tab, reading position, display mode, zoom and unsaved changes. New and SKILL template create additional tabs. Click the document name or press F2 to name a draft or rename an existing file.

Click Edit to write directly in the formatted document. The formatting bar provides headings, lists, quotes, tables, images, code blocks and dividers. Selecting text also shows bold, italic and link controls. Code blocks have live syntax highlighting and a language selector.

Use Document, Source and Split view to choose your view. In Split view, both source and formatted text can be edited; changes and undo history are shared. Narrow windows stack the two panes. Sync scrolling can be turned off. Ctrl+mouse wheel changes document zoom from 50% to 200%; Ctrl+0 restores 100%.

Mindmaps: create a map, add child or sibling topics, then link a node to a local Markdown file. A linked node shows a star; click the star or double-click the node to open the file. In Edit mode, drag nodes, apply a fixed palette, or right-click to connect nodes. Drag the background to pan. Save maps as .mdmap files. Older map formats remain readable; fixed palettes use at least v4, and whole-map styles use v5 as described below.

Map details: Select a relationship to add a description. Labels avoid cards and other labels, with a thin leader when moved aside. Double-click the line or its label to edit it. With the canvas focused in Edit mode, F2 edits the selected node text or connection description; use the top document name to rename the map. Fixed palettes set background and text colors together. Default restores appearance-based colors. Map styles (Classic, Rounded, Capsule, Branches, Vines, Crystal) change nodes and branches across the entire map. Whole-map styles require format v5 and MD 0.1.22 or later. Maps in formats v1 through v5 still open; existing colors are preserved and retired Note/Double border shapes display as Classic. New line styles, widths, notes and relationship appearance properties require v6 and MD 0.1.29 or later.

Line and node settings: Choose curved, orthogonal or straight connections, which still try to route around other nodes. Node width has Compact, Standard and Wide presets. Titles wrap without truncation, and card height grows with the text. Select a node to add multiline notes. Select a relationship to set solid/dashed lines, no/end/both arrows and a fixed color; changes support undo and saving.
Arrange: Clear manual offsets across the map and compact its visible branches. Collapsed branches remain collapsed, and the entire action supports undo.
Export: Use the map toolbar to select SVG, PNG or PDF, natural/16:9/16:10/A4 landscape pages, and the visible map or Overview and chapters. The overview includes two levels below the root; each top-level branch gets its own expanded page. SVG/PNG create numbered files; PDF produces one multipage file. Exports use a light theme on white pages; fixed page ratios fit the map with margins. PNG is limited to about 16 million pixels and 8192 pixels per edge. Use vector output or smaller chapters for large maps.
Headings to map: Create a new map from the Markdown heading hierarchy while keeping the original document and tab. Headings inside code blocks or frontmatter are ignored. Saved source files are linked to the new nodes; unsaved drafts create no fictional path. Full lecture text is not embedded in the map.

Drag alignment: In Edit mode, drag a node near another node's row or column to see a blue dashed guide and snap into alignment. Drag farther to release, or hold Alt to move freely. Guides disappear on release and are never saved as connections.
Group movement: Ctrl/Shift-click multiple nodes, release the modifier key, then drag any selected node to move the group while keeping its relative positions. The grabbed node aligns with stationary nodes. Selecting both a parent and its child does not apply movement twice. Moves support undo, redo and saving. An ordinary click returns to a single selection.
Connections attach to card edges and route around other nodes, updating after movement or alignment. Descriptions follow the actual route. Avoid completely overlapping cards so there is room for their connections.
The drag guides and group movement introduced in 0.1.28 remain available. Drag alignment does not rearrange the whole map; use Arrange for that. Large, complex maps still incur routing costs. Inactive Markdown tabs unload editor views to reduce memory use while preserving documents, undo history and reading positions.

Double-click an unlinked node to open an editable Markdown draft with a heading and suggested filename based on the node text. No save dialog opens and no disk file is created yet. Double-clicking the same node again returns to that draft. Write your content, then press Ctrl+S to choose a location. The first successful save links the file to the original node and adds its star. Canceling or failing to save retains the draft and its content; existing files are never overwritten. The association supports undo and redo, and undo retains the file on disk. If the original node was deleted, already linked to another file, or its map tab was closed, the Markdown still saves but is not attached automatically.

SKILL template creates an editable template in the current interface language. Fill in the skill name and description, edit the instructions, and save as SKILL.md. Other YAML frontmatter fields are preserved. Source mode lets you edit the entire file.

Drafts and reading positions are backed up locally. Original files still require Save. After a restart, MD restores the last successful backup, tabs, modes, zoom and positions. Undo history does not survive a restart. Drafts that you explicitly discard or close are not recovered. Backup status appears at the bottom. Limits: 8 MB per document, 80 tabs, 128 MB total recovery data.

Keyboard shortcuts
Ctrl+O Open; Ctrl+N New; Ctrl+S Save; Ctrl+Shift+S Save as
Ctrl+Tab / Ctrl+Shift+Tab Switch tabs; Ctrl+W Close tab; F2 Rename
Ctrl+Shift+E Switch reading/editing; Ctrl+B Bold; Ctrl+I Italic
Ctrl+Z Undo; Ctrl+Y or Ctrl+Shift+Z Redo

Images are stored next to a saved document in its .assets folder. Include this folder when sharing the document. Local images can be PNG, JPEG, GIF or WebP, up to 20 MB. Displaying remote images contacts their servers.

UTF-8 Markdown is supported. Editing the formatted view can normalize Markdown syntax. Unsupported extensions show a protection message and require saving a copy after visual edits. Source-only editing preserves the original markup.

Windows: x64 portable build targeting Windows 10 and Windows 11. Window size, position and maximized state are remembered and corrected to fit the available display.
More (…) → Settings → Set default app (设置默认打开方式) registers the current app and its Start Menu entry, then opens Windows Settings. Choose MD for .md and .markdown there; Windows confirms the default application. The single-file version registers the outer EXE you saved. This button creates no desktop shortcut; you can copy the single-file EXE directly to the Desktop. Repeat the default-app setup after moving or renaming the application.
If automatic registration fails, a specific cause is shown; View error details retains the error code and system output. Open Windows Settings works independently of registration. Copy program path copies the running executable path for pasting into the file picker. Opening Settings does not confirm a default change. If MD is already your default, there is no need to register again.
If Windows cannot find MD by app name, choose the .md or .markdown file type instead. You can also right-click a Markdown file, choose Open with > Choose another app > Choose an app on your PC, browse to your single-file EXE or MD.exe inside the complete folder build, and choose Always.
Folder ZIP only: Optional Register-MD.cmd adds an Open with entry and shortcut for the current user without replacing default associations. Unregister-MD.cmd removes this folder's registrations. Unregister before moving the folder and register the new location afterward. The app does not register file associations automatically on launch.

Existing desktop validation uses Windows 11 x64. A separate Windows 10 machine has not been tested. Actual checks and limitations for this release: https://github.com/AkiNariT/Markdown-Editor-Mindmap/blob/v0.1.29/docs/VALIDATION-0.1.29.md . This portable build is unsigned and does not include an installer, automatic update checks or automatic installation.

Source builds: npm run package creates the complete folder build. npm run package:portable builds the folder and then .packaged/portable/MD-Windows-x64-VERSION.exe. npm run test:portable runs isolated native checks; set MOYE_PORTABLE_EXE to test a particular single-file EXE.

This project is developed primarily with AI tools. Source is available under the MIT License; third-party dependencies retain their own licenses. A macOS version is planned. No Mac download or release date is currently available.
