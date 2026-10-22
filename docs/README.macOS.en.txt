Markdown-Editor-Mindmap 0.1.31 macOS preview

Requires macOS 13 Ventura or later. Choose arm64 for Apple Silicon or x64 for Intel.
DMG: drag MD.app into Applications, eject the disk image, then launch from Applications.
ZIP: extract the complete MD.app and move it to Applications. Keep the app bundle intact.

This test build is ad-hoc signed, without Apple Developer ID signing or notarization.
macOS may block the first launch. After verifying the project source and SHA256, follow Apple's per-app approval guidance under System Settings > Privacy & Security. Do not disable system-wide security checks.
https://support.apple.com/en-us/102445

Command+O opens, Command+N creates, Command+S saves, Shift+Command+S saves as, and Command+W closes a tab.
Command+Z undoes, Shift+Command+Z redoes, Command+, opens Settings, and Control+Tab switches documents.
Command+Plus/Minus/0 adjusts document zoom. Control+wheel and trackpad pinch also work.
The red close button hides the workspace while retaining documents and drafts. Click MD in the Dock to return.
Command+Q or MD > Quit MD exits after asking about unsaved work.

Settings and drafts are stored in ~/Library/Application Support/MD. Save original documents explicitly.
To choose MD as the default, select a file in Finder, press Command+I, choose MD under Open with, and click Change All. Set .md, .markdown and .mdmap separately.

Mindmaps reference separate Markdown files. Share the complete directory with relative links and extract ZIP archives before opening. Windows C:\... absolute paths cannot directly locate files on Mac.
Manual update checks select only public packages for your platform and architecture. No automatic download, installation or restart.

Project: https://github.com/AkiNariT/Markdown-Editor-Mindmap
Mac guide: https://github.com/AkiNariT/Markdown-Editor-Mindmap/blob/feat/macos-support/docs/MACOS.md
Developed primarily with AI tools. Source is MIT licensed; third-party notices are included.
