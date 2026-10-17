import { t, onLocaleChange } from './i18n.mjs';
import { validateMindmap, serializeMindmap } from './mindmap.mjs';
import { applyNodeAppearance } from './mindmap-appearance.mjs';
import { nodePalettes, createNodeArtwork } from './mindmap-themes.mjs';
import { createMindmapRouter } from './mindmap-routing.mjs';
import { createMindmapSnapper } from './mindmap-snapping.mjs';

const NODE_WIDTH = 216, NODE_HEIGHT = 96, COLUMN_GAP = 76, ROW_GAP = 24;
const clone = value => ({ ...value,
  nodes: value.nodes.map(node => ({ ...node, ...(node.offset ? { offset: { ...node.offset } } : {}) })),
  ...(value.connections ? { connections: value.connections.map(connection => ({ ...connection })) } : {}),
});
const fileKey = path => typeof path === 'string' ? path.replaceAll('\\', '/').toLowerCase() : path;
const fileName = path => path?.split(/[\\/]/).at(-1) || '';

export function createMindmapView(initialData, options = {}) {
  let data = validateMindmap(initialData), selected = data.root;
  let selectedNodes = new Set([selected]);
  let editable = true, locked = false, destroyed = false, composing = false, textBefore = null;
  let zoom = 100, pendingLink = false, pendingCreate = false, deleteTarget = null, drag = null, initialized = false;
  let savedPosition = { left: 0, top: 0 }, positions = new Map(), dimensions = { width: 1, height: 1 };
  let pendingSessionPosition = false;
  let layoutPadding = { x: 400, y: 250 }, restoredLayoutPadding = false;
  let contextMenu = null, suppressClickUntil = 0, connectionSource = null, selectedConnection = null;
  let menuCanvasPosition = null;
  let suppressOpenUntil = 0;
  const undoStack = [], redoStack = [], nodeElements = new Map();
  const host = document.createElement('section');
  host.className = 'mindmap-view'; host.setAttribute('aria-label', t('思维导图'));
  const toolbar = document.createElement('div'); toolbar.className = 'mindmap-toolbar'; toolbar.setAttribute('aria-label', t('思维导图工具'));
  const editorRow = document.createElement('div'); editorRow.className = 'mindmap-editor-row';
  const label = document.createElement('label'); label.className = 'mindmap-text-label'; label.textContent = t('节点');
  const input = document.createElement('input'); input.className = 'mindmap-text-input'; input.setAttribute('aria-label', t('节点文字')); input.maxLength = 500; input.spellcheck = false; input.autocomplete = 'off';
  label.append(input);
  const paletteControls = document.createElement('div'); paletteControls.className = 'mindmap-palette-controls'; paletteControls.setAttribute('role', 'group'); paletteControls.setAttribute('aria-label', t('节点配色'));
  const paletteLabel = document.createElement('span'); paletteLabel.className = 'mindmap-palette-label'; paletteLabel.textContent = t('配色'); paletteControls.append(paletteLabel);
  const paletteButtons = new Map();
  for (const palette of nodePalettes) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'mindmap-palette'; button.dataset.palette = palette.id;
    button.textContent = palette.id === 'default' ? '◐' : 'A';
    const name = t('配色：{name}', { name: t(palette.label) }); button.title = name; button.setAttribute('aria-label', name);
    if (palette.background) { button.style.setProperty('--swatch-background', palette.background); button.style.setProperty('--swatch-color', palette.color); }
    button.addEventListener('click', () => setPalette(palette)); paletteButtons.set(palette.id, button); paletteControls.append(button);
  }
  const themeLabel = document.createElement('label'); themeLabel.className = 'mindmap-style-label'; themeLabel.textContent = t('整图风格');
  const themeInput = document.createElement('select'); themeInput.className = 'mindmap-theme-select'; themeInput.setAttribute('aria-label', t('整图风格'));
  for (const [value, text] of [['classic', '经典'], ['rounded', '圆角'], ['capsule', '胶囊'], ['tree', '树枝'], ['vine', '藤蔓'], ['crystal', '晶体']]) {
    const option = document.createElement('option'); option.value = value; option.dataset.mindmapLabel = text; option.textContent = t(text); themeInput.append(option);
  }
  themeLabel.append(themeInput);
  const detail = document.createElement('span'); detail.className = 'mindmap-selection-detail';
  editorRow.append(label, paletteControls, themeLabel, detail);
  const connectionRow = document.createElement('div'); connectionRow.className = 'mindmap-connection-editor'; connectionRow.hidden = true;
  const connectionLabel = document.createElement('label'); connectionLabel.className = 'mindmap-connection-field'; connectionLabel.textContent = t('连接说明');
  const connectionInput = document.createElement('input'); connectionInput.className = 'mindmap-connection-input'; connectionInput.maxLength = 200; connectionInput.autocomplete = 'off'; connectionInput.spellcheck = false;
  connectionInput.setAttribute('aria-label', t('连接说明')); connectionInput.placeholder = t('为这条连接添加说明…'); connectionLabel.append(connectionInput);
  const clearConnectionButton = makeButton('清空说明', clearConnectionLabel, 'mindmap-clear-connection'); connectionRow.append(connectionLabel, clearConnectionButton);
  const confirmation = document.createElement('div'); confirmation.className = 'mindmap-confirm'; confirmation.hidden = true;
  confirmation.setAttribute('role', 'alertdialog'); confirmation.setAttribute('aria-label', t('删除主题确认'));
  const confirmationText = document.createElement('span');
  const canvas = document.createElement('div'); canvas.className = 'mindmap-canvas'; canvas.tabIndex = 0; canvas.setAttribute('aria-label', t('思维导图画布'));
  const stage = document.createElement('div'); stage.className = 'mindmap-stage';
  const world = document.createElement('div'); world.className = 'mindmap-world';
  const lines = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); lines.classList.add('mindmap-lines'); lines.setAttribute('aria-hidden', 'true');
  const nodesLayer = document.createElement('div'); nodesLayer.className = 'mindmap-nodes';
  const connectionLabels = document.createElement('div'); connectionLabels.className = 'mindmap-connection-labels';
  const guides = document.createElementNS(lines.namespaceURI, 'svg'); guides.classList.add('mindmap-guides'); guides.setAttribute('aria-hidden', 'true');
  world.append(lines, connectionLabels, nodesLayer, guides); stage.append(world); canvas.append(stage);
  const hint = document.createElement('div'); hint.className = 'mindmap-hint'; hint.textContent = t('拖动节点调整位置 · 拖动空白处平移 · 右键快捷操作');
  host.append(toolbar, editorRow, connectionRow, confirmation, canvas, hint);

  const node = id => data.nodes.find(item => item.id === id);
  const connection = id => data.connections?.find(item => item.id === id);
  const snapshot = () => ({ data: clone(data), selected, selectedNodes: [...selectedNodes], selectedConnection });
  const report = error => options.onError?.(error instanceof Error ? error.message : String(error));
  function push(stack, value) { stack.push(value); if (stack.length > 100) stack.shift(); }
  function changed() { options.onChange?.(); }
  function resetHint() {
    hint.textContent = connectionSource ? t('点击要连接的节点 · Esc 取消') : editable
      ? selectedNodes.size > 1 ? t('已选 {count} 个节点 · 拖动一起移动并对齐 · Alt 暂停吸附', { count: selectedNodes.size })
        : t('Ctrl / Shift + 点击多选 · 拖动节点靠近时对齐 · Alt 暂停吸附 · 右键快捷操作')
      : t('双击节点打开文件 · 拖动空白处平移 · 右键快捷操作');
  }
  function cancelConnection() { connectionSource = null; resetHint(); renderSelection(); }
  function finishText() {
    if (composing || !textBefore) return;
    if (JSON.stringify(textBefore.data) !== JSON.stringify(data)) push(undoStack, textBefore);
    textBefore = null;
  }
  function mutate(operation, { allowLocked = false, allowBackground = false } = {}) {
    if (destroyed || (locked && !allowBackground) || composing || (!editable && !allowLocked)) return false;
    cancelDrag(); closeMenu(); finishText();
    const before = snapshot(), draft = clone(data);
    let nextSelection = selected;
    try {
      nextSelection = operation(draft) || selected;
      const next = validateMindmap(draft);
      if (JSON.stringify(next) === JSON.stringify(data)) return false;
      data = next;
    } catch (error) { report(error); return false; }
    push(undoStack, before); redoStack.length = 0;
    selected = node(nextSelection) ? nextSelection : data.root;
    if (selected !== before.selected) selectedNodes = new Set([selected]);
    if (selected !== before.selected || !connection(selectedConnection)) selectedConnection = null;
    dismissDelete(); render(); changed(); return true;
  }
  function makeButton(text, action, className = 'mindmap-tool') {
    const button = document.createElement('button'); button.type = 'button'; button.className = className;
    button.dataset.mindmapLabel = text; button.textContent = t(text); button.setAttribute('aria-label', t(text));
    button.addEventListener('click', action); return button;
  }
  const childButton = makeButton('子主题', () => addNode(false));
  const siblingButton = makeButton('同级主题', () => addNode(true));
  const deleteButton = makeButton('删除', requestDelete);
  const linkButton = makeButton('关联 Markdown', linkSelected);
  const openButton = makeButton('打开文件', () => openNode(selected));
  const unlinkButton = makeButton('取消关联', () => mutate(draft => { draft.nodes.find(item => item.id === selected).file = null; }));
  const collapseButton = makeButton('折叠', () => toggleCollapsed(selected));
  const centerButton = makeButton('居中', centerRoot);
  toolbar.append(childButton, siblingButton, deleteButton, linkButton, openButton, unlinkButton, collapseButton, centerButton);
  const confirmButton = makeButton('确认删除', confirmDelete, 'mindmap-confirm-button');
  const cancelButton = makeButton('取消删除', () => { dismissDelete(); canvas.focus({ preventScroll: true }); }, 'mindmap-confirm-button');
  confirmation.append(confirmationText, cancelButton, confirmButton);

  function select(id, focusCanvas = true, { toggle = false, preserve = false } = {}) {
    if (!node(id) || composing || locked || destroyed) return;
    finishText();
    if (toggle && editable) {
      if (selectedNodes.has(id) && selectedNodes.size > 1) { selectedNodes.delete(id); selected = [...selectedNodes].at(-1); }
      else { selectedNodes.add(id); selected = id; }
    } else {
      selected = id;
      if (!preserve || !selectedNodes.has(id)) selectedNodes = new Set([id]);
    }
    selectedConnection = null; dismissDelete(); preserveCanvasOrigin(() => { renderSelection(); renderLines(); });
    if (focusCanvas) canvas.focus({ preventScroll: true });
  }
  function preserveCanvasOrigin(update) {
    const rect = canvas.getBoundingClientRect(), left = canvas.scrollLeft, top = canvas.scrollTop;
    update();
    const next = canvas.getBoundingClientRect();
    canvas.scrollLeft = Math.max(0, left + next.left - rect.left); canvas.scrollTop = Math.max(0, top + next.top - rect.top);
    if (host.isConnected && canvas.clientWidth && canvas.clientHeight) capturePosition();
  }
  function selectConnection(id, focusInput = false) {
    if (!connection(id) || locked || composing || connectionSource || destroyed || drag) return;
    finishText(); closeMenu(); selectedConnection = id; dismissDelete();
    preserveCanvasOrigin(renderSelection);
    for (const line of lines.querySelectorAll('[data-connection-line]')) line.classList.toggle('mindmap-connection-selected', line.dataset.connectionLine === id);
    for (const label of connectionLabels.children) { label.classList.toggle('mindmap-connection-label-selected', label.dataset.connectionLabel === id); label.setAttribute('aria-pressed', String(label.dataset.connectionLabel === id)); }
    if (focusInput && editable) { connectionInput.focus({ preventScroll: true }); connectionInput.select(); }
    else canvas.focus({ preventScroll: true });
  }
  function editConnection() { selectConnection(selectedConnection, true); }
  function editSelected() {
    if (!editable || locked || composing || destroyed || selectedNodes.size !== 1) return;
    input.focus({ preventScroll: true }); input.select();
  }
  function addNode(sibling) {
    if (selectedNodes.size !== 1) return;
    const current = node(selected);
    if (!current || (sibling && current.parent === null)) return;
    const parent = sibling ? current.parent : current.id;
    let id;
    do { id = `node-${document.defaultView.crypto.randomUUID()}`; } while (node(id));
    if (mutate(draft => {
      draft.nodes.find(item => item.id === parent).collapsed = false;
      const newNode = { id, parent, text: t('新主题'), file: null, collapsed: false };
      if (sibling) draft.nodes.splice(draft.nodes.findIndex(item => item.id === current.id) + 1, 0, newNode);
      else draft.nodes.push(newNode);
      return id;
    })) { revealNode(id); editSelected(); }
  }
  function descendants(id) {
    const ids = new Set([id]);
    const children = new Map();
    for (const item of data.nodes) {
      if (!children.has(item.parent)) children.set(item.parent, []);
      children.get(item.parent).push(item.id);
    }
    const visit = current => { for (const child of children.get(current) || []) { ids.add(child); visit(child); } };
    visit(id); return ids;
  }
  function requestDelete() {
    if (!editable || locked || composing || selectedNodes.size !== 1 || selected === data.root) return;
    finishText(); deleteTarget = selected;
    refreshDeleteMessage();
    confirmation.hidden = false; cancelButton.focus({ preventScroll: true });
  }
  function refreshDeleteMessage() {
    if (!node(deleteTarget)) return;
    const count = descendants(deleteTarget).size;
    const name = node(deleteTarget).text.slice(0, 32) || t('未命名主题');
    confirmationText.textContent = count > 1 ? t('删除“{name}”及其 {count} 个子主题？', { name, count: count - 1 }) : t('删除“{name}”？', { name });
  }
  function dismissDelete() { deleteTarget = null; confirmation.hidden = true; }
  function confirmDelete() {
    const target = node(deleteTarget);
    if (!target || target.id === data.root) return dismissDelete();
    const removed = descendants(target.id);
    if (mutate(draft => {
      draft.nodes = draft.nodes.filter(item => !removed.has(item.id));
      if (draft.connections) draft.connections = draft.connections.filter(item => !removed.has(item.from) && !removed.has(item.to));
      return target.parent;
    })) canvas.focus({ preventScroll: true });
  }
  function toggleCollapsed(id) {
    if (!data.nodes.some(item => item.parent === id)) return;
    mutate(draft => { const item = draft.nodes.find(item => item.id === id); item.collapsed = !item.collapsed; return id; });
  }
  async function linkSelected() {
    if (!editable || locked || composing || selectedNodes.size !== 1 || pendingLink || !options.onLink) return;
    finishText(); const id = selected; pendingLink = true; renderSelection();
    try {
      const path = await options.onLink(id);
      if (path && !destroyed && node(id)) mutate(draft => { draft.nodes.find(item => item.id === id).file = path; }, { allowLocked: true });
    } catch (error) { if (!destroyed) report(error); }
    finally { pendingLink = false; if (!destroyed) renderSelection(); }
  }
  async function openNode(id, openOptions) {
    if (!node(id)?.file || locked || destroyed) return;
    try { await options.onOpen?.(id, openOptions); } catch (error) { if (!destroyed) report(error); }
  }
  async function createNodeFile(id) {
    if (!node(id) || node(id).file || !options.onCreate || locked || destroyed || composing || pendingCreate || pendingLink || drag || connectionSource || Date.now() < suppressOpenUntil || Date.now() < suppressClickUntil) return;
    finishText(); pendingCreate = true;
    try {
      await options.onCreate(id);
    } catch (error) { if (!destroyed) report(error); }
    finally { pendingCreate = false; if (!destroyed) renderSelection(); }
  }
  function attachFile(id, path) {
    if (!node(id) || node(id).file) return false;
    return mutate(draft => { draft.nodes.find(item => item.id === id).file = path; }, { allowLocked: true, allowBackground: true });
  }
  function beginConnection() {
    if (!editable || locked || composing || destroyed || selectedNodes.size !== 1) return;
    cancelDrag(); closeMenu(); finishText(); connectionSource = selected; selectedConnection = null;
    resetHint(); renderSelection(); renderLines(); canvas.focus({ preventScroll: true });
  }
  function connectTo(id) {
    if (!connectionSource || !editable || locked || composing) return;
    const from = connectionSource;
    if (from === id) { report(t('请选择另一个节点建立连接。')); return; }
    if (data.connections?.some(item => (item.from === from && item.to === id) || (item.from === id && item.to === from))) {
      report(t('这两个节点已经建立连接。')); return;
    }
    if (mutate(draft => {
      draft.version = Math.max(draft.version, 2); draft.connections ||= [];
      draft.connections.push({ id: `connection-${document.defaultView.crypto.randomUUID()}`, from, to: id });
      return id;
    })) {
      suppressOpenUntil = Date.now() + 600;
      cancelConnection();
    }
  }
  function deleteConnection() {
    const id = selectedConnection;
    if (!id) return;
    if (mutate(draft => { draft.connections = draft.connections.filter(item => item.id !== id); })) {
      selectedConnection = null; renderLines();
    }
  }
  function applyText() {
    if (!editable || locked || destroyed || composing || selectedNodes.size !== 1) return;
    const current = node(selected), value = input.value;
    if (!current || value === current.text) return;
    if (value.length > 500) { report(t('节点文字最多支持 500 个字符。')); input.value = current.text; return; }
    if (!textBefore) textBefore = snapshot();
    current.text = value; redoStack.length = 0;
    const elements = nodeElements.get(selected);
    if (elements) { elements.title.textContent = value || t('未命名主题'); elements.button.title = value; elements.button.setAttribute('aria-label', value || t('未命名主题')); }
    changed();
  }
  function applyConnectionLabel() {
    if (!editable || locked || destroyed || composing) return;
    const current = connection(selectedConnection), value = connectionInput.value;
    if (!current || value === (current.label || '')) return;
    if (value.length > 200 || /[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(value)) {
      report(t('连接说明最多支持 200 个字符，且不能包含换行或控制字符。')); connectionInput.value = current.label || ''; return;
    }
    if (!textBefore) textBefore = snapshot();
    data.version = Math.max(data.version, 4);
    if (value) current.label = value; else delete current.label;
    redoStack.length = 0; renderLines(); clearConnectionButton.disabled = !value; changed();
  }
  function clearConnectionLabel() {
    if (!editable || locked || composing || destroyed) return;
    finishText(); connectionInput.value = ''; applyConnectionLabel(); finishText(); connectionInput.focus({ preventScroll: true });
  }
  function setPalette(palette) {
    mutate(draft => {
      const current = draft.nodes.find(item => item.id === selected);
      if (palette.background) {
        draft.version = Math.max(draft.version, 4); draft.connections ||= [];
        current.background = palette.background; current.color = palette.color;
      } else { delete current.background; delete current.color; }
    });
    renderSelection();
  }
  function setTheme(value) {
    mutate(draft => {
      draft.version = Math.max(draft.version, 5); draft.connections ||= []; draft.theme = value;
    });
    renderSelection();
  }
  themeInput.addEventListener('change', () => setTheme(themeInput.value));
  connectionInput.addEventListener('input', event => { if (!event.isComposing) applyConnectionLabel(); });
  connectionInput.addEventListener('compositionstart', () => { finishText(); composing = true; renderSelection(); });
  connectionInput.addEventListener('compositionend', () => { composing = false; applyConnectionLabel(); finishText(); renderSelection(); });
  connectionInput.addEventListener('blur', finishText);
  connectionInput.addEventListener('keydown', event => {
    if (composing || event.isComposing) return;
    if (event.key === 'Enter' || event.key === 'Escape') { finishText(); canvas.focus({ preventScroll: true }); event.preventDefault(); }
  });
  input.addEventListener('input', event => { if (!event.isComposing) applyText(); });
  input.addEventListener('compositionstart', () => { finishText(); composing = true; renderSelection(); });
  input.addEventListener('compositionend', () => { composing = false; applyText(); finishText(); renderSelection(); });
  input.addEventListener('blur', finishText);
  input.addEventListener('keydown', event => {
    if (event.isComposing || composing) return;
    if (event.key === 'Enter' || event.key === 'Escape') { finishText(); canvas.focus({ preventScroll: true }); event.preventDefault(); }
  });
  host.addEventListener('keydown', event => {
    if (event.key === 'Escape' && deleteTarget && !event.isComposing) { dismissDelete(); canvas.focus({ preventScroll: true }); event.preventDefault(); }
  });
  canvas.addEventListener('keydown', event => {
    if (event.isComposing || composing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !editable || locked || drag) return;
    if (event.target.closest('.mindmap-file, .mindmap-fold')) return;
    if (event.key === 'F2') { event.preventDefault(); if (selectedConnection) editConnection(); else editSelected(); }
    else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedConnection) { event.preventDefault(); deleteConnection(); }
    else if (event.key === 'Tab') { event.preventDefault(); addNode(false); }
    else if (event.key === 'Enter') { event.preventDefault(); addNode(true); }
    else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); requestDelete(); }
  });

  function renderSelection() {
    selectedNodes = new Set([...selectedNodes].filter(id => positions.has(id)));
    if (!positions.has(selected)) selected = selectedNodes.values().next().value || data.root;
    selectedNodes.add(selected);
    const current = node(selected);
    if (!current) return;
    const multiple = selectedNodes.size > 1;
    editorRow.hidden = !editable || multiple || Boolean(connection(selectedConnection));
    const currentConnection = connection(selectedConnection);
    connectionRow.hidden = !currentConnection;
    connectionInput.readOnly = !editable || locked;
    if (!composing && connectionInput.value !== (currentConnection?.label || '')) connectionInput.value = currentConnection?.label || '';
    clearConnectionButton.hidden = !editable;
    clearConnectionButton.disabled = !editable || locked || composing || !currentConnection?.label;
    for (const button of [childButton, siblingButton, deleteButton, linkButton, unlinkButton, collapseButton]) button.hidden = !editable;
    openButton.hidden = !editable && !current.file;
    input.readOnly = !editable || locked;
    if (!composing && input.value !== current.text) input.value = current.text;
    for (const palette of nodePalettes) {
      const button = paletteButtons.get(palette.id); button.disabled = !editable || locked || composing;
      button.setAttribute('aria-pressed', String(palette.background ? current.background === palette.background && current.color === palette.color : !current.background && !current.color));
    }
    const legacyShapes = !Object.hasOwn(data, 'theme') && data.nodes.some(item => ['rounded', 'capsule'].includes(item.style));
    let legacyOption = themeInput.querySelector('[value=legacy]');
    if (legacyShapes && !legacyOption) {
      legacyOption = document.createElement('option'); legacyOption.value = 'legacy'; legacyOption.disabled = true;
      legacyOption.dataset.mindmapLabel = '原有样式'; legacyOption.textContent = t('原有样式'); themeInput.prepend(legacyOption);
    } else if (!legacyShapes) legacyOption?.remove();
    themeInput.disabled = !editable || locked || composing; themeInput.value = legacyShapes ? 'legacy' : data.theme || 'classic';
    detail.textContent = current.file ? fileName(current.file) : ''; detail.title = current.file || ''; detail.hidden = !current.file;
    childButton.disabled = !editable || locked || multiple; siblingButton.disabled = !editable || locked || multiple || current.parent === null;
    deleteButton.disabled = !editable || locked || multiple || current.id === data.root;
    linkButton.disabled = !editable || locked || multiple || pendingLink || !options.onLink;
    openButton.disabled = locked || multiple || !current.file || !options.onOpen;
    unlinkButton.disabled = !editable || locked || multiple || !current.file;
    collapseButton.disabled = !editable || locked || multiple || !data.nodes.some(item => item.parent === current.id);
    centerButton.disabled = locked; confirmButton.disabled = !editable || locked;
    cancelButton.disabled = locked;
    collapseButton.textContent = t(current.collapsed ? '展开' : '折叠'); collapseButton.setAttribute('aria-label', collapseButton.textContent);
    host.classList.toggle('mindmap-readonly', !editable);
    host.classList.toggle('mindmap-locked', locked);
    host.classList.toggle('mindmap-connecting', Boolean(connectionSource));
    for (const [id, elements] of nodeElements) {
      elements.card.classList.toggle('mindmap-selected', selectedNodes.has(id));
      elements.card.classList.toggle('mindmap-connection-source', connectionSource === id);
      elements.button.setAttribute('aria-pressed', String(selectedNodes.has(id)));
      elements.button.disabled = locked;
      if (elements.attachment) elements.attachment.disabled = locked || !options.onOpen;
      if (elements.fold) elements.fold.disabled = !editable || locked;
    }
    resetHint();
  }
  function measureTree() {
    const children = new Map(data.nodes.map(item => [item.id, []]));
    for (const item of data.nodes) if (item.parent !== null) children.get(item.parent).push(item);
    const heights = new Map();
    const height = item => {
      const list = item.collapsed ? [] : children.get(item.id);
      const result = Math.max(NODE_HEIGHT, list.reduce((sum, child) => sum + height(child), 0) + Math.max(0, list.length - 1) * ROW_GAP);
      heights.set(item.id, result); return result;
    };
    height(node(data.root));
    positions = new Map();
    if (!initialized && !restoredLayoutPadding && canvas.clientWidth && canvas.clientHeight) {
      layoutPadding = { x: Math.max(180, canvas.clientWidth / (zoom / 100) / 2), y: Math.max(120, canvas.clientHeight / (zoom / 100) / 2) };
    }
    const { x: paddingX, y: paddingY } = layoutPadding;
    let maxX = 0, maxY = 0, minX = Infinity, minY = Infinity;
    const place = (item, depth, top, ancestorOffset = { x: 0, y: 0 }) => {
      const offset = { x: ancestorOffset.x + (item.offset?.x || 0), y: ancestorOffset.y + (item.offset?.y || 0) };
      if (drag?.kind === 'node' && drag.nodeIds.has(item.id)) { offset.x += drag.dx; offset.y += drag.dy; }
      const x = paddingX + depth * (NODE_WIDTH + COLUMN_GAP) + offset.x;
      const y = top + (heights.get(item.id) - NODE_HEIGHT) / 2 + offset.y;
      positions.set(item.id, { x, y });
      maxX = Math.max(maxX, x + NODE_WIDTH); maxY = Math.max(maxY, y + NODE_HEIGHT);
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      if (!item.collapsed) { let childTop = top; for (const child of children.get(item.id)) { place(child, depth + 1, childTop, offset); childTop += heights.get(child.id) + ROW_GAP; } }
    };
    place(node(data.root), 0, paddingY);
    // A loaded map or a changed tree can bring an offset past the origin.
    // Retain the added canvas padding so later drags do not move stationary
    // cards or invalidate the alignment coordinates captured at pointerdown.
    const shift = { x: Math.max(0, 24 - minX), y: Math.max(0, 24 - minY) };
    layoutPadding = { x: paddingX + shift.x, y: paddingY + shift.y };
    for (const position of positions.values()) { position.x += shift.x; position.y += shift.y; }
    dimensions = { width: maxX + shift.x + layoutPadding.x, height: maxY + shift.y + layoutPadding.y };
    return children;
  }
  function sizeStage() {
    const scale = zoom / 100;
    world.style.width = `${dimensions.width}px`; world.style.height = `${dimensions.height}px`;
    world.style.transform = `scale(${scale})`;
    stage.style.width = `${dimensions.width * scale}px`; stage.style.height = `${dimensions.height * scale}px`;
    for (const layer of [lines, guides]) {
      layer.setAttribute('width', dimensions.width); layer.setAttribute('height', dimensions.height);
      layer.setAttribute('viewBox', `0 0 ${dimensions.width} ${dimensions.height}`);
    }
  }
  function renderLines() {
    lines.replaceChildren(); connectionLabels.replaceChildren();
    const labels = [];
    const byId = new Map(data.nodes.map(item => [item.id, item]));
    const router = createMindmapRouter(positions, { width: NODE_WIDTH, height: NODE_HEIGHT, columnGap: COLUMN_GAP });
    const routeBetween = (from, to, options) => {
      const route = router.route(from, to, options);
      if (route) {
        dimensions.width = Math.max(dimensions.width, route.bounds.right + 24);
        dimensions.height = Math.max(dimensions.height, route.bounds.bottom + 24);
      }
      return route;
    };
    for (const item of data.nodes) {
      const position = positions.get(item.id); if (!position) continue;
      if (item.parent !== null) {
        const parent = positions.get(item.parent);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.classList.add('mindmap-branch');
        const route = routeBetween(item.parent, item.id, { crystal: data.theme === 'crystal' });
        path.setAttribute('d', route.d);
        if (data.theme === 'tree') {
          let depth = 0, ancestor = item;
          while (ancestor.parent !== null) { depth++; ancestor = byId.get(ancestor.parent); }
          path.style.strokeWidth = String(Math.max(1.6, 5 - depth * .65));
        }
        lines.append(path);
        if (data.theme === 'vine' && !route.rerouted && !route.blocked && position.x - parent.x > NODE_WIDTH + 38) {
          const leaf = document.createElementNS(lines.namespaceURI, 'path'); leaf.classList.add('mindmap-vine-leaf');
          const x = position.x - 21, y = position.y + NODE_HEIGHT / 2;
          leaf.setAttribute('d', `M ${x} ${y} Q ${x - 15} ${y - 3} ${x - 10} ${y - 16} Q ${x + 3} ${y - 13} ${x} ${y} Z`); lines.append(leaf);
        }
      }
    }
    for (const connection of data.connections || []) {
      const from = positions.get(connection.from), to = positions.get(connection.to);
      if (!from || !to) continue;
      const route = routeBetween(connection.from, connection.to, { bow: 32 });
      const curve = route.d;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.classList.add('mindmap-connection'); path.classList.toggle('mindmap-connection-selected', connection.id === selectedConnection);
      path.dataset.connectionLine = connection.id; path.setAttribute('d', curve); lines.append(path);
      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hit.classList.add('mindmap-connection-hit'); hit.dataset.connectionId = connection.id; hit.setAttribute('d', curve);
      hit.addEventListener('click', event => {
        if (locked || composing || connectionSource || destroyed) return;
        event.stopPropagation(); selectConnection(connection.id);
      });
      hit.addEventListener('dblclick', event => { event.stopPropagation(); selectConnection(connection.id, true); });
      lines.append(hit);
      if (connection.label) {
        const label = document.createElement('button'); label.type = 'button'; label.className = 'mindmap-connection-label';
        label.dataset.connectionId = connection.id; label.dataset.connectionLabel = connection.id;
        label.textContent = connection.label; label.title = connection.label; label.setAttribute('aria-label', t('连接说明：{text}', { text: connection.label }));
        label.classList.toggle('mindmap-connection-label-selected', connection.id === selectedConnection); label.setAttribute('aria-pressed', String(connection.id === selectedConnection));
        const anchor = route.midpoint;
        label.addEventListener('click', event => { event.stopPropagation(); selectConnection(connection.id); });
        label.addEventListener('dblclick', event => { event.stopPropagation(); selectConnection(connection.id, true); });
        connectionLabels.append(label);
        labels.push({ label, anchor, from, to, id: connection.id });
      }
    }
    placeConnectionLabels(labels);
    sizeStage();
  }
  function clearLabelDistance(anchor, direction, width, height, obstacles) {
    const x = anchor.x, y = anchor.y, dx = direction.x, dy = direction.y;
    const halfWidth = width / 2, halfHeight = height / 2;
    const parallelX = Math.abs(dx) < 1e-8, parallelY = Math.abs(dy) < 1e-8;
    let minimum = 0, maximum = Infinity;
    if (parallelX) { if (x < halfWidth + 12) return null; }
    else if (dx > 0) minimum = Math.max(minimum, (halfWidth + 12 - x) / dx);
    else maximum = Math.min(maximum, (halfWidth + 12 - x) / dx);
    if (parallelY) { if (y < halfHeight + 12) return null; }
    else if (dy > 0) minimum = Math.max(minimum, (halfHeight + 12 - y) / dy);
    else maximum = Math.min(maximum, (halfHeight + 12 - y) / dy);
    if (minimum > maximum) return null;
    const intervals = [];
    for (const obstacle of obstacles) {
      const left = obstacle.left - halfWidth - 8, right = obstacle.right + halfWidth + 8;
      const top = obstacle.top - halfHeight - 8, bottom = obstacle.bottom + halfHeight + 8;
      if ((parallelX && (x < left || x > right)) || (parallelY && (y < top || y > bottom))) continue;
      let enter = 0, exit = Infinity;
      if (!parallelX) {
        const a = (left - x) / dx, b = (right - x) / dx;
        enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
      }
      if (!parallelY) {
        const a = (top - y) / dy, b = (bottom - y) / dy;
        enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
      }
      if (exit >= enter) intervals.push([enter, exit]);
    }
    // Jump across each intersected rectangle instead of scanning pixel by pixel.
    // This remains bounded even when many nodes share the same position.
    intervals.sort((a, b) => a[0] - b[0]);
    let distance = minimum;
    for (const interval of intervals) {
      if (interval[0] > distance) break;
      if (interval[1] >= distance) distance = interval[1] + 1;
    }
    return distance <= maximum ? distance : null;
  }
  function placeConnectionLabels(labels) {
    if (!labels.length) return;
    // Include the fold button extending 14px beyond the right edge of a card.
    const obstacles = [...positions.values()].map(point => ({ left: point.x - 4, top: point.y - 4, right: point.x + NODE_WIDTH + 16, bottom: point.y + NODE_HEIGHT + 4 }));
    // Read all sizes before writing positions, avoiding one forced layout per label.
    const measured = labels.map(item => ({ ...item, width: item.label.offsetWidth || 200, height: item.label.offsetHeight || 32 }));
    for (const { label, anchor, from, to, id, width, height } of measured) {
      const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
      const normal = length ? { x: -dy / length, y: dx / length } : { x: 1, y: 0 };
      let best = null;
      const consider = direction => {
        const distance = clearLabelDistance(anchor, direction, width, height, obstacles);
        if (distance !== null && (!best || distance < best.distance)) best = { distance, x: anchor.x + direction.x * distance, y: anchor.y + direction.y * distance };
      };
      consider(normal); consider({ x: -normal.x, y: -normal.y });
      // A normal pointing outside the reachable stage can be blocked both ways.
      if (!best) { consider({ x: 1, y: 0 }); consider({ x: 0, y: 1 }); }
      label.style.left = `${best.x}px`; label.style.top = `${best.y}px`;
      const box = { left: best.x - width / 2, top: best.y - height / 2, right: best.x + width / 2, bottom: best.y + height / 2 };
      obstacles.push(box);
      dimensions.width = Math.max(dimensions.width, box.right + 24); dimensions.height = Math.max(dimensions.height, box.bottom + 24);
      if (best.distance > 1) {
        const x = best.x - anchor.x, y = best.y - anchor.y;
        const edge = Math.min(x ? width / 2 / Math.abs(x) : Infinity, y ? height / 2 / Math.abs(y) : Infinity, 1);
        const leader = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        leader.classList.add('mindmap-connection-leader'); leader.dataset.connectionLeader = id;
        leader.setAttribute('d', `M ${anchor.x} ${anchor.y} L ${best.x - x * edge} ${best.y - y * edge}`); lines.append(leader);
      }
    }
    sizeStage();
  }
  function previewLayout() {
    measureTree(); sizeStage(); renderLines();
    for (const [id, elements] of nodeElements) {
      const position = positions.get(id);
      elements.card.style.left = `${position.x}px`; elements.card.style.top = `${position.y}px`;
    }
  }
  function render() {
    const activeNode = document.activeElement?.getAttribute('data-node-id');
    host.dataset.mapTheme = data.theme || 'classic';
    host.classList.toggle('mindmap-explicit-theme', Object.hasOwn(data, 'theme'));
    const children = measureTree(); sizeStage(); renderLines(); nodesLayer.replaceChildren(); nodeElements.clear();
    for (const item of data.nodes) {
      const position = positions.get(item.id); if (!position) continue;
      const card = document.createElement('div'); card.className = 'mindmap-node';
      applyNodeAppearance(card, item);
      const artwork = createNodeArtwork(document, data.theme); if (artwork) card.append(artwork);
      card.dataset.nodeCard = item.id;
      card.classList.toggle('mindmap-root', item.id === data.root); card.style.left = `${position.x}px`; card.style.top = `${position.y}px`;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'mindmap-node-button'; button.dataset.nodeId = item.id;
      button.title = item.text; button.setAttribute('aria-label', item.text || t('未命名主题'));
      const title = document.createElement('span'); title.className = 'mindmap-node-title'; title.textContent = item.text || t('未命名主题');
      button.append(title);
      button.addEventListener('click', event => { if (connectionSource) connectTo(item.id); else select(item.id, true, { toggle: event.ctrlKey || event.metaKey || event.shiftKey }); });
      card.addEventListener('dblclick', event => {
        if (locked || composing || destroyed || drag || connectionSource || event.ctrlKey || event.metaKey || event.shiftKey || Date.now() < suppressOpenUntil || event.target.closest('.mindmap-file, .mindmap-fold')) return;
        select(item.id, false);
        if (node(item.id)?.file) openNode(item.id);
        else createNodeFile(item.id);
      });
      card.append(button);
      let attachment;
      if (item.file) {
        card.classList.add('mindmap-linked');
        attachment = makeButton('★', () => openNode(item.id), 'mindmap-file');
        attachment.setAttribute('aria-label', t('打开关联文件：{name}', { name: fileName(item.file) })); attachment.title = item.file; attachment.dataset.openNode = item.id;
        card.append(attachment);
      }
      let fold;
      if (children.get(item.id).length) {
        fold = makeButton(item.collapsed ? `+${descendants(item.id).size - 1}` : '−', () => { select(item.id); toggleCollapsed(item.id); }, 'mindmap-fold');
        fold.setAttribute('aria-label', t(item.collapsed ? '展开子主题' : '折叠子主题')); card.append(fold);
      }
      nodeElements.set(item.id, { card, button, title, fold, attachment }); nodesLayer.append(card);
    }
    renderSelection();
    if (activeNode) canvas.focus({ preventScroll: true });
    if (!initialized && canvas.clientWidth && canvas.clientHeight) {
      initialized = true;
      if (pendingSessionPosition) restorePosition(); else centerRoot();
    }
  }
  function capturePosition() { savedPosition = { left: canvas.scrollLeft, top: canvas.scrollTop }; return { ...savedPosition }; }
  function restorePosition() {
    if (destroyed || !host.isConnected) return;
    if (pendingSessionPosition) {
      renderSelection();
      if (canvas.clientWidth && canvas.clientHeight) {
        savedPosition = {
          left: Math.min(savedPosition.left, Math.max(0, (canvas.scrollWidth || dimensions.width * zoom / 100) - canvas.clientWidth)),
          top: Math.min(savedPosition.top, Math.max(0, (canvas.scrollHeight || dimensions.height * zoom / 100) - canvas.clientHeight)),
        };
        pendingSessionPosition = false;
      }
    }
    canvas.scrollLeft = savedPosition.left; canvas.scrollTop = savedPosition.top;
  }
  function captureSessionState() {
    if (host.isConnected && canvas.clientWidth && canvas.clientHeight && !pendingSessionPosition) capturePosition();
    return { selected, position: { ...savedPosition }, layoutPadding: { ...layoutPadding } };
  }
  function restoreSessionState(value) {
    if (destroyed || composing || !value || typeof value !== 'object' || Array.isArray(value)) return false;
    const restoreLayout = value.layoutPadding && [value.layoutPadding.x, value.layoutPadding.y].every(coordinate => Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1e6);
    if (restoreLayout) {
      layoutPadding = { x: value.layoutPadding.x, y: value.layoutPadding.y };
      restoredLayoutPadding = true;
    }
    if (typeof value.selected === 'string' && node(value.selected)) { selected = value.selected; selectedNodes = new Set([selected]); selectedConnection = null; }
    if (value.position && [value.position.left, value.position.top].every(coordinate => Number.isFinite(coordinate) && coordinate >= 0)) {
      savedPosition = { left: value.position.left, top: value.position.top };
      pendingSessionPosition = true;
    }
    if (host.isConnected) {
      if (restoreLayout || (!initialized && canvas.clientWidth && canvas.clientHeight)) render();
      else { renderSelection(); renderLines(); }
      restorePosition();
    } else if (restoreLayout) previewLayout();
    return true;
  }
  function centerRoot() {
    if (locked || destroyed) return;
    cancelDrag(); closeMenu();
    const position = positions.get(data.root); if (!position) return;
    canvas.scrollLeft = Math.max(0, (position.x + NODE_WIDTH / 2) * zoom / 100 - canvas.clientWidth / 2);
    canvas.scrollTop = Math.max(0, (position.y + NODE_HEIGHT / 2) * zoom / 100 - canvas.clientHeight / 2);
    capturePosition();
  }
  function revealNode(id) {
    const position = positions.get(id); if (!position || !canvas.clientWidth) return;
    const scale = zoom / 100, left = position.x * scale, top = position.y * scale, margin = 28;
    if (left < canvas.scrollLeft + margin) canvas.scrollLeft = Math.max(0, left - margin);
    else if (left + NODE_WIDTH * scale > canvas.scrollLeft + canvas.clientWidth - margin) canvas.scrollLeft = left + NODE_WIDTH * scale - canvas.clientWidth + margin;
    if (top < canvas.scrollTop + margin) canvas.scrollTop = Math.max(0, top - margin);
    else if (top + NODE_HEIGHT * scale > canvas.scrollTop + canvas.clientHeight - margin) canvas.scrollTop = top + NODE_HEIGHT * scale - canvas.clientHeight + margin;
    capturePosition();
  }
  function closeMenu() { contextMenu?.remove(); contextMenu = null; menuCanvasPosition = null; }
  function menuHeading(connectionId) {
    return connectionId ? t('节点连接') : selectedNodes.size > 1 ? t('已选 {count} 个节点', { count: selectedNodes.size }) : t('当前节点：{name}', { name: node(selected).text || t('未命名主题') });
  }
  function showMenu(event, connectionId = null) {
    closeMenu(); cancelDrag(); suppressClickUntil = 0;
    if (locked || composing || destroyed) return;
    const menu = document.createElement('div'); menu.className = 'mindmap-context-menu';
    menu.dataset.connectionMenu = connectionId || '';
    menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', t('思维导图菜单'));
    const header = document.createElement('div'); header.className = 'mindmap-menu-header';
    header.textContent = menuHeading(connectionId);
    menu.append(header);
    const add = (action, text, handler, disabled = false) => {
      const item = makeButton(text, () => { closeMenu(); if (!locked && !composing) handler(); }, 'mindmap-menu-item');
      item.dataset.action = action; item.setAttribute('role', 'menuitem'); item.disabled = disabled; menu.append(item);
    };
    if (!editable && options.onEdit) add('edit-map', '编辑导图', async () => {
      try { await options.onEdit(); } catch (error) { if (!destroyed) report(error); }
    });
    if (connectionId) {
      selectConnection(connectionId);
      add('edit-connection', '编辑说明', editConnection, !editable);
      add('delete-connection', '删除连接', deleteConnection, !editable);
    } else {
      const current = node(selected);
      add('edit', '编辑文字', editSelected, !editable || selectedNodes.size > 1);
      add('add-child', '新增子主题', () => addNode(false), childButton.disabled);
      add('add-sibling', '新增同级主题', () => addNode(true), siblingButton.disabled);
      add('connect', '建立连接', beginConnection, !editable || selectedNodes.size > 1);
      add('create-markdown', '新建 Markdown', () => createNodeFile(selected), selectedNodes.size > 1 || Boolean(current.file) || pendingCreate || pendingLink || !options.onCreate);
      add('link-markdown', '关联 Markdown 文件', linkSelected, linkButton.disabled);
      add('open', '打开文件', () => openNode(selected), openButton.disabled);
      add('unlink', '取消关联', () => unlinkButton.click(), unlinkButton.disabled);
      add('toggle', current.collapsed ? '展开子主题' : '折叠子主题', () => toggleCollapsed(selected), collapseButton.disabled);
      add('delete', '删除', requestDelete, deleteButton.disabled);
      add('reset-layout', '恢复自动布局', () => mutate(draft => { for (const item of draft.nodes) if (selectedNodes.has(item.id)) delete item.offset; }), !editable || !data.nodes.some(item => selectedNodes.has(item.id) && item.offset));
      add('center', '居中', centerRoot);
    }
    contextMenu = menu; host.append(menu);
    menuCanvasPosition = { left: canvas.scrollLeft, top: canvas.scrollTop };
    const rect = menu.getBoundingClientRect(), win = document.defaultView, inset = 8;
    menu.style.left = `${Math.max(inset, Math.min(event.clientX, win.innerWidth - rect.width - inset))}px`;
    menu.style.top = `${Math.max(inset, Math.min(event.clientY, win.innerHeight - rect.height - inset))}px`;
    menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }
  canvas.addEventListener('contextmenu', event => {
    if (event.target.closest('input, textarea, [contenteditable="true"]')) return;
    event.preventDefault();
    if (locked || composing) return;
    const connection = event.target.closest('[data-connection-id]');
    const card = event.target.closest('[data-node-card]');
    if (card) select(card.dataset.nodeCard, true, { preserve: true });
    showMenu(event, connection?.dataset.connectionId);
  });
  function outsidePointer(event) {
    if (contextMenu && !contextMenu.contains(event.target)) closeMenu();
    if (drag && !host.contains(event.target)) cancelDrag();
  }
  function globalKey(event) {
    if (event.isComposing || composing) return;
    if (event.key === 'Alt' && drag?.kind === 'node' && drag.moved) { previewNodeDrag(true); event.preventDefault(); }
    if (event.key === 'Escape' && (drag || contextMenu || connectionSource)) {
      cancelDrag(); closeMenu(); cancelConnection(); event.preventDefault();
      if (host.isConnected) canvas.focus({ preventScroll: true });
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') cancelDrag();
    if (!contextMenu || !contextMenu.contains(event.target)) return;
    if (event.key === 'Tab') { closeMenu(); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const items = [...contextMenu.querySelectorAll('button:not(:disabled)')];
      if (!items.length) return;
      const current = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next].focus({ preventScroll: true }); event.preventDefault();
    }
  }
  function globalKeyUp(event) {
    if (event.key === 'Alt' && drag?.kind === 'node' && drag.moved) { previewNodeDrag(false); event.preventDefault(); }
  }
  function dismissTransient() { cancelDrag(); closeMenu(); cancelConnection(); }
  function outsideScroll(event) {
    if (!contextMenu || contextMenu.contains(event.target)) return;
    // Restoring the viewport can queue a scroll event delivered after the menu
    // opens. Only dismiss for an actual change from its opening position.
    if (event.target === canvas && menuCanvasPosition && Math.abs(canvas.scrollLeft - menuCanvasPosition.left) < .5 && Math.abs(canvas.scrollTop - menuCanvasPosition.top) < .5) return;
    closeMenu();
  }
  document.addEventListener('pointerdown', outsidePointer, true);
  document.addEventListener('keydown', globalKey, true);
  document.addEventListener('keyup', globalKeyUp, true);
  document.addEventListener('scroll', outsideScroll, true);
  document.defaultView.addEventListener('resize', dismissTransient);
  document.defaultView.addEventListener('blur', dismissTransient);
  canvas.addEventListener('scroll', event => { outsideScroll(event); if (host.isConnected && canvas.clientWidth && canvas.clientHeight) capturePosition(); }, { passive: true });
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || locked || composing || destroyed || event.target.closest('.mindmap-file, .mindmap-fold, input, [data-connection-id]')) return;
    cancelDrag(); closeMenu(); suppressClickUntil = 0;
    const card = event.target.closest('[data-node-card]');
    if (connectionSource || (card && !editable)) return;
    if (card && (event.ctrlKey || event.metaKey || event.shiftKey)) return;
    finishText(); canvas.focus({ preventScroll: true });
    if (card) {
      const nodeId = card.dataset.nodeCard; select(nodeId, true, { preserve: true });
      const nodeIds = new Set([...selectedNodes].filter(id => {
        let parent = node(node(id).parent);
        while (parent) { if (selectedNodes.has(parent.id)) return false; parent = node(parent.parent); }
        return true;
      }));
      const branchIds = new Set([...nodeIds].flatMap(id => [...descendants(id)]));
      const visible = [...positions].filter(([id]) => branchIds.has(id)).map(([, point]) => point);
      const offsets = new Map([...nodeIds].map(id => [id, { x: node(id).offset?.x || 0, y: node(id).offset?.y || 0 }]));
      const stored = [...offsets.values()];
      drag = { kind: 'node', id: event.pointerId, nodeIds, offsets, x: event.clientX, y: event.clientY, dx: 0, dy: 0, rawDx: 0, rawDy: 0, moved: false,
        snapper: createMindmapSnapper(positions, { anchorId: nodeId, movingIds: branchIds, width: NODE_WIDTH, height: NODE_HEIGHT }),
        bounds: {
          minDx: Math.max(24 - Math.min(...visible.map(point => point.x)), ...stored.map(point => -100000 - point.x)),
          minDy: Math.max(24 - Math.min(...visible.map(point => point.y)), ...stored.map(point => -100000 - point.y)),
          maxDx: Math.min(...stored.map(point => 100000 - point.x)), maxDy: Math.min(...stored.map(point => 100000 - point.y)),
        },
      };
    } else {
      if (event.target.closest('button')) return;
      finishText(); selectedConnection = null; preserveCanvasOrigin(() => { renderSelection(); renderLines(); });
      drag = { kind: 'pan', id: event.pointerId, x: event.clientX, y: event.clientY, left: canvas.scrollLeft, top: canvas.scrollTop };
      canvas.classList.add('mindmap-panning');
    }
    if (drag.kind === 'pan') try { canvas.setPointerCapture?.(event.pointerId); } catch { /* Pointer already released. */ }
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    if (drag.kind === 'pan') {
      canvas.scrollLeft = drag.left - event.clientX + drag.x; canvas.scrollTop = drag.top - event.clientY + drag.y; capturePosition(); return;
    }
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
    if (!drag.moved) try { canvas.setPointerCapture?.(event.pointerId); } catch { /* Pointer already released. */ }
    drag.moved = true;
    drag.rawDx = (event.clientX - drag.x) / (zoom / 100); drag.rawDy = (event.clientY - drag.y) / (zoom / 100);
    previewNodeDrag(event.altKey); event.preventDefault();
  });
  function previewNodeDrag(disabled) {
    const { minDx, maxDx, minDy, maxDy } = drag.bounds;
    const dx = Math.max(minDx, Math.min(maxDx, drag.rawDx)), dy = Math.max(minDy, Math.min(maxDy, drag.rawDy));
    const snapped = drag.snapper.snap(dx, dy, { zoom, disabled, bounds: drag.bounds });
    drag.dx = snapped.dx; drag.dy = snapped.dy;
    host.classList.add('mindmap-dragging'); previewLayout();
    guides.replaceChildren();
    for (const guide of snapped.guides) {
      const line = document.createElementNS(guides.namespaceURI, 'line');
      line.dataset.guideAxis = guide.axis;
      const vertical = guide.axis === 'x';
      line.setAttribute('x1', vertical ? guide.value : guide.start); line.setAttribute('y1', vertical ? guide.start : guide.value);
      line.setAttribute('x2', vertical ? guide.value : guide.end); line.setAttribute('y2', vertical ? guide.end : guide.value);
      guides.append(line);
    }
  }
  function releaseDrag() {
    const previous = drag; drag = null;
    guides.replaceChildren();
    canvas.classList.remove('mindmap-panning'); host.classList.remove('mindmap-dragging');
    if (previous) try { if (canvas.hasPointerCapture?.(previous.id)) canvas.releasePointerCapture(previous.id); } catch { /* Capture can be lost outside the window. */ }
    return previous;
  }
  function cancelDrag() {
    const previous = releaseDrag();
    if (previous?.kind === 'node' && previous.moved) { suppressClickUntil = Date.now() + 400; previewLayout(); }
  }
  canvas.addEventListener('pointerup', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const previous = releaseDrag();
    if (previous.kind !== 'node' || !previous.moved) return;
    suppressClickUntil = Date.now() + 400; previewLayout();
    if (previous.dx || previous.dy) mutate(draft => {
      draft.version = Math.max(draft.version, 2); draft.connections ||= [];
      for (const [id, offset] of previous.offsets) draft.nodes.find(item => item.id === id).offset = { x: offset.x + previous.dx, y: offset.y + previous.dy };
    });
  });
  const cancelPointer = event => { if (drag?.id === event.pointerId) cancelDrag(); };
  canvas.addEventListener('pointercancel', cancelPointer); canvas.addEventListener('lostpointercapture', cancelPointer);
  const suppressDragClick = event => {
    if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  canvas.addEventListener('click', suppressDragClick, true); canvas.addEventListener('dblclick', suppressDragClick, true);
  function setZoom(percent) {
    if (locked || destroyed) return;
    cancelDrag(); closeMenu();
    const next = Math.max(50, Math.min(200, Math.round(Number(percent)) || 100));
    if (next === zoom || destroyed) return;
    const center = { x: (canvas.scrollLeft + canvas.clientWidth / 2) / (zoom / 100), y: (canvas.scrollTop + canvas.clientHeight / 2) / (zoom / 100) };
    zoom = next; sizeStage();
    canvas.scrollLeft = Math.max(0, center.x * zoom / 100 - canvas.clientWidth / 2);
    canvas.scrollTop = Math.max(0, center.y * zoom / 100 - canvas.clientHeight / 2); capturePosition(); options.onZoom?.(zoom);
  }
  function travel(from, to) {
    if (!editable || locked || composing || destroyed) return false;
    dismissTransient();
    finishText(); const previous = from.pop(); if (!previous) return false;
    push(to, snapshot()); data = clone(previous.data); selected = previous.selected;
    selectedNodes = new Set(previous.selectedNodes || [selected]);
    selectedConnection = connection(previous.selectedConnection) ? previous.selectedConnection : null;
    dismissDelete(); render(); changed(); return true;
  }
  function rewriteLinks(value, oldPath, newPath) {
    let count = 0;
    for (const item of value.nodes) if (item.file !== null && fileKey(item.file) === fileKey(oldPath)) { item.file = newPath; count++; }
    return count;
  }
  function replaceFile(oldPath, newPath) {
    if (!oldPath || oldPath === newPath || destroyed) return;
    cancelDrag(); closeMenu();
    const draft = clone(data), count = rewriteLinks(draft, oldPath, newPath);
    try { validateMindmap(draft); } catch (error) { report(error); return; }
    data = draft;
    for (const item of [...undoStack, ...redoStack, ...(textBefore ? [textBefore] : [])]) rewriteLinks(item.data, oldPath, newPath);
    if (count) { render(); changed(); }
  }
  function refreshLabels() {
    if (destroyed) return;
    const measured = host.isConnected && canvas.clientWidth && canvas.clientHeight && !pendingSessionPosition;
    const previousRect = measured ? canvas.getBoundingClientRect() : null;
    const previousPosition = { left: canvas.scrollLeft, top: canvas.scrollTop };
    host.setAttribute('aria-label', t('思维导图'));
    toolbar.setAttribute('aria-label', t('思维导图工具'));
    label.firstChild.nodeValue = t('节点'); input.setAttribute('aria-label', t('节点文字'));
    paletteLabel.textContent = t('配色'); paletteControls.setAttribute('aria-label', t('节点配色'));
    for (const palette of nodePalettes) {
      const button = paletteButtons.get(palette.id), name = t('配色：{name}', { name: t(palette.label) });
      button.title = name; button.setAttribute('aria-label', name);
    }
    themeLabel.firstChild.nodeValue = t('整图风格'); themeInput.setAttribute('aria-label', t('整图风格'));
    connectionLabel.firstChild.nodeValue = t('连接说明'); connectionInput.setAttribute('aria-label', t('连接说明')); connectionInput.placeholder = t('为这条连接添加说明…');
    confirmation.setAttribute('aria-label', t('删除主题确认'));
    canvas.setAttribute('aria-label', t('思维导图画布'));
    for (const button of host.querySelectorAll('[data-mindmap-label]')) {
      const text = t(button.dataset.mindmapLabel); button.textContent = text; button.setAttribute('aria-label', text);
    }
    const collapseText = t(node(selected).collapsed ? '展开' : '折叠');
    collapseButton.textContent = collapseText; collapseButton.setAttribute('aria-label', collapseText);
    for (const [id, elements] of nodeElements) {
      const current = node(id);
      if (!current.text) { elements.title.textContent = t('未命名主题'); elements.button.setAttribute('aria-label', t('未命名主题')); }
      if (elements.attachment) elements.attachment.setAttribute('aria-label', t('打开关联文件：{name}', { name: fileName(current.file) }));
      if (elements.fold) elements.fold.setAttribute('aria-label', t(current.collapsed ? '展开子主题' : '折叠子主题'));
    }
    resetHint(); refreshDeleteMessage();
    for (const label of connectionLabels.children) label.setAttribute('aria-label', t('连接说明：{text}', { text: connection(label.dataset.connectionLabel)?.label || '' }));
    if (contextMenu) {
      contextMenu.setAttribute('aria-label', t('思维导图菜单'));
      contextMenu.querySelector('.mindmap-menu-header').textContent = menuHeading(contextMenu.dataset.connectionMenu);
      const rect = contextMenu.getBoundingClientRect(), win = document.defaultView;
      contextMenu.style.left = `${Math.max(8, Math.min(rect.left, win.innerWidth - rect.width - 8))}px`;
      contextMenu.style.top = `${Math.max(8, Math.min(rect.top, win.innerHeight - rect.height - 8))}px`;
    }
    // Localized controls can wrap to another row. Keep nodes at the same screen
    // position without rebuilding the tree or interrupting the current gesture.
    if (measured) {
      const nextRect = canvas.getBoundingClientRect();
      const dx = nextRect.left - previousRect.left, dy = nextRect.top - previousRect.top;
      if (dx || dy) {
        canvas.scrollLeft = Math.max(0, previousPosition.left + dx); canvas.scrollTop = Math.max(0, previousPosition.top + dy);
        if (drag?.kind === 'pan') { drag.left += canvas.scrollLeft - previousPosition.left; drag.top += canvas.scrollTop - previousPosition.top; }
        capturePosition();
      }
    }
  }
  const unsubscribeLocale = onLocaleChange(refreshLabels);
  const ResizeObserverClass = document.defaultView.ResizeObserver;
  const observer = ResizeObserverClass ? new ResizeObserverClass(() => {
    if (!destroyed && !initialized && canvas.clientWidth && canvas.clientHeight) { render(); }
  }) : null;
  observer?.observe(canvas); render();
  return {
    host, getData: () => clone(data), getText: () => serializeMindmap(data),
    setSaved(nextData) {
      const next = validateMindmap(nextData); dismissTransient(); finishText();
      for (const nextNode of next.nodes) {
        const previous = node(nextNode.id);
        if (previous?.file && previous.file !== nextNode.file && nextNode.file) {
          for (const item of [...undoStack, ...redoStack]) rewriteLinks(item.data, previous.file, nextNode.file);
        }
      }
      data = next; if (!node(selected)) selected = data.root;
      render();
    },
    setEditable(value) {
      if (!value && composing) return false;
      dismissTransient();
      if (!value) { finishText(); dismissDelete(); }
      const previousRect = canvas.getBoundingClientRect(), previousPosition = { left: canvas.scrollLeft, top: canvas.scrollTop };
      const modeChanged = editable !== Boolean(value);
      editable = Boolean(value); renderSelection(); resetHint();
      if (modeChanged && host.isConnected && !pendingSessionPosition) {
        const nextRect = canvas.getBoundingClientRect();
        canvas.scrollLeft = Math.max(0, previousPosition.left + nextRect.left - previousRect.left);
        canvas.scrollTop = Math.max(0, previousPosition.top + nextRect.top - previousRect.top);
        capturePosition();
      }
      return true;
    },
    setLocked(value) {
      if (value && composing) return false;
      dismissTransient();
      if (value) { finishText(); dismissDelete(); }
      locked = Boolean(value); renderSelection(); return true;
    },
    isComposing: () => composing,
    refreshTheme: () => { if (!destroyed) { for (const [id, elements] of nodeElements) applyNodeAppearance(elements.card, node(id)); renderSelection(); } },
    setZoom, getZoom: () => zoom, capturePosition, restorePosition, captureSessionState, restoreSessionState,
    focus: () => canvas.focus({ preventScroll: true }),
    undo: () => travel(undoStack, redoStack), redo: () => travel(redoStack, undoStack), replaceFile, attachFile,
    destroy() {
      destroyed = true; unsubscribeLocale(); observer?.disconnect(); releaseDrag(); closeMenu();
      document.removeEventListener('pointerdown', outsidePointer, true);
      document.removeEventListener('keydown', globalKey, true);
      document.removeEventListener('keyup', globalKeyUp, true);
      document.removeEventListener('scroll', outsideScroll, true);
      document.defaultView.removeEventListener('resize', dismissTransient);
      document.defaultView.removeEventListener('blur', dismissTransient);
      undoStack.length = 0; redoStack.length = 0; textBefore = null; host.remove();
    },
  };
}
