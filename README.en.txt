Markdown-Editor-Mindmap（Markdown 可视化编辑与思维导图）0.1.23

Run MD.exe. Keep the portable application folder intact. When updating, extract the new version to a separate folder, save any changes you want to keep and close the old version normally, then open the new executable. Run only one instance with the same user data.

Check for updates: Open More (…) → Check for updates or Settings → Check for updates, then click the check button in the dialog. MD requests public releases from the fixed official repository AkiNariT/Markdown-Editor-Mindmap, including public prereleases. The dialog shows your version, the newest compatible Windows x64 version and plain-text release notes. The release-page button opens a verified official release page in your browser, where you can download the portable ZIP.
MD does not check automatically in the background or automatically download, install or restart. Close the dialog to continue editing and saving; an offline or failed check does not prevent normal use after closing the dialog.
A manual check contacts api.github.com. GitHub can receive your IP address and normal request metadata; the check sends no documents, local paths, drafts or account tokens. Remote images retain their existing behavior, and browser downloads use the external browser's network behavior. See PRIVACY.md.
0.1.23 release page: https://github.com/AkiNariT/Markdown-Editor-Mindmap/releases/tag/v0.1.23

Language: More (…) → Settings → Language → English or 简体中文. Changes apply immediately and are remembered after restart. Your existing documents and mindmap node text stay in their original language.

Open reads .md, .markdown and .mdmap files. Each document has its own tab, reading position, display mode, zoom and unsaved changes. New and SKILL template create additional tabs. Click the document name or press F2 to name a draft or rename an existing file.

Click Edit to write directly in the formatted document. The formatting bar provides headings, lists, quotes, tables, images, code blocks and dividers. Selecting text also shows bold, italic and link controls. Code blocks have live syntax highlighting and a language selector.

Use Document, Source and Split view to choose your view. In Split view, both source and formatted text can be edited; changes and undo history are shared. Narrow windows stack the two panes. Sync scrolling can be turned off. Ctrl+mouse wheel changes document zoom from 50% to 200%; Ctrl+0 restores 100%.

Mindmaps: create a map, add child or sibling topics, then link a node to a local Markdown file. A linked node shows a star; click the star or double-click the node to open the file. In Edit mode, drag nodes, apply a fixed palette, or right-click to connect nodes. Drag the background to pan. Save maps as .mdmap files. Older map formats remain readable; fixed palettes use at least v4, and whole-map styles use v5 as described below.

Map details: Select a dashed line to add a description. Labels avoid cards and other labels, with a thin leader when moved aside. Double-click the line or its label to edit it. With the canvas focused in Edit mode, F2 edits the selected node text or connection description; use the top document name to rename the map. Fixed palettes set background and text colors together. Default restores appearance-based colors. Map styles (Classic, Rounded, Capsule, Branches, Vines, Crystal) change nodes and branches across the entire map. Whole-map styles require format v5 and MD 0.1.22 or later. Maps in formats v1 through v4 still open; existing colors are preserved and retired Note/Double border shapes display as Classic.

Double-click an unlinked node to create a new Markdown file. Choose its location; the file is linked and opened for editing. Existing files are never overwritten. Canceling changes nothing. Undoing the association retains the file on disk.

SKILL template creates an editable template in the current interface language. Fill in the skill name and description, edit the instructions, and save as SKILL.md. Other YAML frontmatter fields are preserved. Source mode lets you edit the entire file.

Drafts and reading positions are backed up locally. Original files still require Save. After a restart, MD restores the last successful backup, tabs, modes, zoom and positions. Undo history does not survive a restart. Drafts that you explicitly discard or close are not recovered. Backup status appears at the bottom. Limits: 8 MB per document, 80 tabs, 128 MB total recovery data.

Keyboard shortcuts
Ctrl+O Open; Ctrl+N New; Ctrl+S Save; Ctrl+Shift+S Save as
Ctrl+Tab / Ctrl+Shift+Tab Switch tabs; Ctrl+W Close tab; F2 Rename
Ctrl+Shift+E Switch reading/editing; Ctrl+B Bold; Ctrl+I Italic
Ctrl+Z Undo; Ctrl+Y or Ctrl+Shift+Z Redo

Images are stored next to a saved document in its .assets folder. Include this folder when sharing the document. Local images can be PNG, JPEG, GIF or WebP, up to 20 MB. Displaying remote images contacts their servers.

UTF-8 Markdown is supported. Editing the formatted view can normalize Markdown syntax. Unsupported extensions show a protection message and require saving a copy after visual edits. Source-only editing preserves the original markup.

Windows: x64 portable build targeting Windows 10 and Windows 11. Window size, position and maximized state are remembered and corrected to fit the available display. Optional Register-MD.cmd adds an Open with entry and shortcut for the current user without replacing default associations; Unregister-MD.cmd removes this folder's registrations. Unregister before moving the folder and register the new location afterward.

Existing desktop validation uses Windows 11 x64. A separate Windows 10 machine has not been tested. See docs/VALIDATION-0.1.23.md for the checks actually performed for this version. This portable build is unsigned and does not include an installer, automatic update checks or automatic installation.

This project is developed primarily with AI tools. Source is available under the MIT License; third-party dependencies retain their own licenses. A macOS version is planned. No Mac download or release date is currently available.
