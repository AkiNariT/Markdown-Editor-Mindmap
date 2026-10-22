// Register this adapter before app.whenReady(): Finder can deliver open-file
// while the renderer and its document queue are still being initialized.
export function createMacLifecycle({ app, getWindow, enqueueOpen, onHide = () => {} }) {
  let quitting = false, approved = false;
  function showWindow() {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
  }
  app.on('open-file', (event, file) => {
    if (typeof file !== 'string' || file.includes('\0') || !/\.(?:md|markdown|mdmap)$/i.test(file)) return;
    event.preventDefault();
    enqueueOpen(file); showWindow();
  });
  app.on('activate', showWindow);
  app.on('before-quit', event => {
    if (approved) return;
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    // Own the asynchronous guard instead of letting an initial preventDefault
    // cancel Electron's quit request and strand an invisible process.
    event.preventDefault();
    if (quitting) return;
    quitting = true; showWindow(); window.close();
  });
  return {
    showWindow,
    hideOnClose(event) {
      if (quitting || approved) return false;
      event.preventDefault();
      onHide(); getWindow()?.hide();
      return true;
    },
    cancelQuit() { quitting = false; showWindow(); },
    confirmQuit() { approved = true; app.quit(); },
    // Startup errors cannot complete a renderer handshake; permit termination.
    allowQuit() { approved = true; },
  };
}
