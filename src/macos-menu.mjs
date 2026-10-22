export function createMacMenuTemplate({ t, dispatch }) {
  const command = (name, label, accelerator) => ({
    id: 'md-' + name, label: t(label), ...(accelerator ? { accelerator } : {}), click: () => dispatch(name),
  });
  const role = (name, label) => ({ role: name, label: t(label) });
  const separator = () => ({ type: 'separator' });
  return [
    { label: 'MD', submenu: [
      role('about', '关于 MD'), separator(), command('settings', '设置', 'Command+,'),
      command('check-updates', '检查更新'), separator(),
      role('hide', '隐藏 MD'), role('hideOthers', '隐藏其他'), role('unhide', '显示全部'), separator(), role('quit', '退出 MD'),
    ] },
    { label: t('文件'), submenu: [
      command('new', '新建', 'Command+N'), command('new-mindmap', '新建思维导图'), command('open', '打开', 'Command+O'),
      separator(), command('save', '保存', 'Command+S'), command('save-as', '另存为', 'Command+Shift+S'),
      separator(), command('close-tab', '关闭标签', 'Command+W'),
    ] },
    { label: t('编辑'), submenu: [
      command('undo', '撤销', 'Command+Z'), command('redo', '重做', 'Command+Shift+Z'), separator(),
      role('cut', '剪切'), role('copy', '复制'), role('paste', '粘贴'), role('selectAll', '全选'),
    ] },
    { label: t('窗口'), role: 'windowMenu', submenu: [role('minimize', '最小化'), role('zoom', '缩放窗口'), separator(), role('front', '前置全部窗口')] },
    { label: t('帮助'), role: 'help', submenu: [command('help', '使用帮助')] },
  ];
}
