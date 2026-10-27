# Windows 图片粘贴与拖入

0.1.32 增加本地图片粘贴与拖入。进入 Markdown 的“编辑”模式后，将光标放在正文或源码输入区：

- 截图或复制图片后按 **Ctrl+V**，图片直接出现在正文中。
- 从资源管理器将图片拖入正文，也可以一次拖入多张。
- 原来的“图片”按钮继续保留。
- 在源码或对照左侧粘贴时，软件自动填写图片引用；对照右侧会显示图片。

新文档可以先粘贴图片、再保存。未保存的图片暂存在本机用户数据目录中，随草稿恢复；首次保存后，引用到的图片会复制到文档旁的 `文件名.assets` 文件夹，并使用相对路径。取消保存不会丢掉草稿图片。一次导入的多张图片作为一次编辑，可一起撤销和重做。

支持 PNG、JPEG、GIF、WebP。一次最多 10 张，单张不超过 20 MiB，合计不超过 50 MiB。阅读模式、文件名输入框和思维导图不会自动插入图片；正文中的代码块应先移出光标再插图。普通文字和网页文字的粘贴仍按原来的编辑方式处理。

图片保存在本机，不会上传到 GitHub 或其他服务器。Markdown 文件中保存的仍是图片引用：分享或移动文件时，请将 `.md` 和相应的 `.assets` 文件夹一起带上。复制程序不会自动带走尚未另行保存的个人草稿。

## English

In Markdown edit mode, paste a copied image or screenshot with **Ctrl+V**, or drop image files into the document. The existing Image button is also available. Source and comparison views insert the Markdown references automatically.

New drafts can contain images before their first save. Draft images are kept in the local user-data directory for recovery; saving copies referenced images into the document's adjacent `.assets` folder. Canceling Save preserves the draft. A batch of images is one undo/redo step.

PNG, JPEG, GIF and WebP are supported: up to 10 images per import, 20 MiB per image and 50 MiB per batch. Images stay on your computer. Share the Markdown file together with its image assets.
