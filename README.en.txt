MD 0.1.21 — A minimal Markdown reader and visual editor

Run MD.exe. Keep the portable application folder intact. When updating, close the old version normally and save any changes you want to keep before opening the new executable.

Language: More (…) → Settings → Language → English or 简体中文. Changes apply immediately and are remembered after restart. Your existing documents and mindmap node text stay in their original language.

Open reads .md, .markdown and .mdmap files. Each document has its own tab, reading position, display mode, zoom and unsaved changes. New and SKILL template create additional tabs. Click the document name or press F2 to name a draft or rename an existing file.

Click Edit to write directly in the formatted document. The formatting bar provides headings, lists, quotes, tables, images, code blocks and dividers. Selecting text also shows bold, italic and link controls. Code blocks have live syntax highlighting and a language selector.

Use Document, Source and Split view to choose your view. In Split view, both source and formatted text can be edited; changes and undo history are shared. Narrow windows stack the two panes. Sync scrolling can be turned off. Ctrl+mouse wheel changes document zoom from 50% to 200%; Ctrl+0 restores 100%.

Mindmaps: create a map, add child or sibling topics, then link a node to a local Markdown file. A linked node shows a star; click the star or double-click the node to open the file. In Edit mode, drag nodes, change text colors, or right-click to connect nodes. Drag the background to pan. Save maps as .mdmap files. Existing v1/v2 maps can still be read; custom colors require MD 0.1.16 or newer.

Map details: Select a dashed line to add a description. Labels avoid cards and other labels, with a thin leader when moved aside. Double-click the line or its label to edit it. With the canvas focused in Edit mode, F2 edits the selected node text or connection description; use the top document name to rename the map. Node backgrounds and styles (Classic, Rounded, Note, Capsule, Double border) are available in Edit mode. These properties require map format v4 and MD 0.1.21 or later; older maps still open.

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

Validation was performed on Windows 11 x64. A separate Windows 10 machine was not available. This portable build is unsigned and does not include an installer or automatic updates.
