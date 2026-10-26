function shortcutText(value) {
  return value.replace(/Ctrl\+Y\b/g, '⌘+Shift+Z')
    .replace(/Ctrl([+＋])(?!(?:Shift\+)?Tab\b|wheel\b|滚轮)/gi, '⌘$1');
}

export function createPlatformUI({ document, platform }) {
  // Capture only application chrome before any user document is mounted.
  const labels = [...document.querySelectorAll('[data-i18n], [data-i18n-title], [data-i18n-aria-label], .shortcut')];
  const mac = platform === 'darwin';
  function refresh() {
    document.querySelector('.settings-default-app').hidden = platform !== 'win32';
    document.getElementById('mac-default-app').hidden = !mac;
    if (!mac) return;
    for (const node of labels) {
      if (node.hasAttribute('data-i18n') || node.classList.contains('shortcut')) node.textContent = shortcutText(node.textContent);
      for (const attribute of ['title', 'aria-label']) {
        if (node.hasAttribute(attribute)) node.setAttribute(attribute, shortcutText(node.getAttribute(attribute)));
      }
    }
  }
  return { refresh };
}

export function createNativeCommandHandler({ document, canAct, actions, history, nativeHistory }) {
  return command => {
    if (typeof command !== 'string' || !canAct()) return false;
    if (command === 'undo' || command === 'redo') {
      const active = document.activeElement;
      const text = active?.closest('input, textarea, [contenteditable="true"]');
      const inDocument = text?.closest('#editor, .source-input, .mindmap-view');
      if (text && !inDocument) { nativeHistory(command); return true; }
      if (document.querySelector('dialog[open]')) return false;
      history(command); return true;
    }
    if (document.querySelector('dialog[open]') || !Object.hasOwn(actions, command)) return false;
    actions[command](); return true;
  };
}
