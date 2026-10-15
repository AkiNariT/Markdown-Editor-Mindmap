const { _electron: electron } = require('playwright');
const { writeFile, readFile, mkdir, mkdtemp, stat } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const parent = path.resolve(__dirname, '../.desktop-test');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(path.join(parent, 'recovery-'));
  const profile = path.join(dir, 'profile'), sessionFile = path.join(profile, 'session.json');
  const note = path.join(dir, '恢复正文.md'), skill = path.join(dir, 'SKILL.md');
  const paragraphs = label => Array.from({ length: 90 }, (_, index) => `## 第 ${index + 1} 节\n\n${label} ${index + 1}。\n\n`).join('');
  const original = '# 恢复正文\n\n' + paragraphs('磁盘原文');
  const originalSkill = '---\nname: recovery-test\ndescription: 恢复中文源码草稿。\n---\n\n# 技能正文\n\n' + paragraphs('原始技能');
  await writeFile(note, original); await writeFile(skill, originalSkill);
  const noteDraft = original.replace('# 恢复正文', '# 未保存的恢复正文') + '\n<!-- NOTE_LATEST_恢复 -->\n';
  const invalidDraft = '---\nname: [尚未结束\ndescription: "尚未闭合\n---\n\n# 尚未完成的技能\n\n' + paragraphs('无效 YAML 也要恢复') + '\nSKILL_LATEST_恢复\n';
  const namedDraft = '# 已命名草稿\n\nNAMED_LATEST_恢复\n';
  const unnamedDraft = '# 仍未命名\n\nUNNAMED_LATEST_恢复\n';
  const pageErrors = [];
  let app, page;
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const button = name => page.getByRole('button', { name, exact: true });
  const idle = () => page.waitForFunction(() => !document.querySelector('#save').disabled);
  const active = name => page.waitForFunction(value => document.querySelector('#document-name').textContent === value, name);
  async function launch(files = []) {
    app = await electron.launch({ executablePath: process.env.MOYE_EXE || require('electron'), args: [...(process.env.MOYE_EXE ? [] : [path.resolve(__dirname, '..')]), ...files, '--user-data-dir=' + profile], timeout: 30000 });
    page = await app.firstWindow(); page.setDefaultTimeout(10000);
    page.on('pageerror', error => pageErrors.push(error.message));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820));
    await page.waitForFunction(() => innerWidth === 1280 && Boolean(window.moye));
    await idle();
  }
  async function selectTab(name) {
    await page.getByRole('tab', { name, exact: true }).click(); await active(name); await idle(); await settle();
  }
  async function nameDraft(name) {
    await page.locator('#rename').click(); await page.locator('#filename').fill(name); await page.locator('#name-confirm').click();
    await active(name + '.md'); await idle();
  }
  async function newDraft() {
    const count = await page.getByRole('tab').count();
    await page.locator('#new').click(); await idle();
    await page.waitForFunction(count => document.querySelector('#document-name').textContent === '未命名'
      && document.querySelectorAll('[role="tab"]').length === count + 1, count);
  }
  async function waitSession(predicate, description) {
    const deadline = Date.now() + 15000; let latest;
    while (Date.now() < deadline) {
      try { latest = JSON.parse(await readFile(sessionFile, 'utf8')); if (predicate(latest)) return latest; }
      catch (error) { if (!['ENOENT', 'EACCES', 'EPERM'].includes(error.code) && !(error instanceof SyntaxError)) throw error; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`等待恢复记录超时：${description}\n${JSON.stringify(latest?.documents?.map(value => ({ path: value.path, name: value.suggestedName, dirty: value.dirty, view: value.viewState })))}`);
  }
  async function crash() {
    const exiting = app.waitForEvent('close');
    await app.evaluate(() => { setTimeout(() => process.exit(0), 20); });
    await exiting; app = null;
  }
  try {
    await launch([note, skill]);
    await page.waitForFunction(() => document.querySelectorAll('[role="tab"]').length === 2);
    await selectTab('恢复正文.md');
    await button('对照').click(); await button('编辑').click(); await idle();
    const source = () => page.getByRole('textbox', { name: 'Markdown 源码', exact: true });
    await source().fill(noteDraft);
    await page.locator('#sync-scroll').uncheck();
    await page.locator('#zoom-in').click(); await page.locator('#zoom-in').click();
    if (await page.locator('#outline-toggle').getAttribute('aria-expanded') !== 'true') await page.locator('#outline-toggle').click();
    await page.waitForFunction(() => document.querySelector('.tiptap h1')?.textContent === '未保存的恢复正文');
    await source().evaluate(element => { element.scrollTop = 740; });
    await page.locator('.canvas').evaluate(element => element.scrollTo({ top: 1160, behavior: 'instant' })); await settle();
    const noteView = await page.evaluate(() => ({ source: document.querySelector('.source-input').scrollTop, render: document.querySelector('.canvas').scrollTop }));
    assert.ok(noteView.source > 700 && noteView.render > 1100, '夹具必须有足够内容实际滚动：' + JSON.stringify(noteView));

    await selectTab('SKILL.md'); await button('源码').click(); await button('编辑').click(); await idle();
    await source().fill(invalidDraft); await page.locator('#zoom-in').click();
    await source().evaluate(element => { element.scrollTop = 520; }); await settle();
    const skillTop = await source().evaluate(element => element.scrollTop);
    await newDraft(); await nameDraft('重启后的命名草稿');
    await button('源码').click(); await source().fill(namedDraft);
    await newDraft(); await button('源码').click(); await source().fill(unnamedDraft);
    await selectTab('SKILL.md');
    const checkpoint = await waitSession(value => {
      const a = value.documents?.find(item => item.path === note), b = value.documents?.find(item => item.path === skill);
      return value.documents?.length === 4 && a?.draft === noteDraft && b?.draft === invalidDraft
        && a.viewState?.view === 'compare' && a.viewState.zoom === 120 && a.viewState.outline === true
        && Math.abs(a.viewState.sourceScroll - noteView.source) < 2 && Math.abs(a.viewState.viewScroll?.compare - noteView.render) < 2
        && b.viewState?.view === 'source' && b.viewState.zoom === 110 && Math.abs(b.viewState.sourceScroll - skillTop) < 2
        && value.documents.some(item => item.namedDraft && item.suggestedName === '重启后的命名草稿.md' && item.draft === namedDraft)
        && value.documents.some(item => !item.path && !item.namedDraft && item.draft === unnamedDraft)
        && value.activeId === b.id;
    }, '最新源码、无效 YAML、两个新标签及显示状态都已落盘');
    assert.equal(checkpoint.documents.find(item => item.path === note).content, original, '恢复记录保留磁盘基线');
    assert.equal(checkpoint.documents.find(item => item.path === skill).content, originalSkill);
    await crash();
    assert.equal(await readFile(note, 'utf8'), original, '崩溃前自动备份不得写回原文件');
    assert.equal(await readFile(skill, 'utf8'), originalSkill);

    await launch(); await active('SKILL.md'); await settle();
    assert.equal(await page.getByRole('tab').count(), 4, '恢复所有旧文件与未保存新标签');
    assert.equal(await source().inputValue(), invalidDraft, '无效 YAML 的未完成输入逐字恢复');
    assert.equal(await source().evaluate(element => element.readOnly), false);
    assert.equal(await button('源码').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#zoom-reset').textContent(), '110%');
    assert.ok(Math.abs(await source().evaluate(element => element.scrollTop) - skillTop) < 2);
    assert.ok(await page.locator('#dirty-dot').isVisible());
    await selectTab('恢复正文.md');
    assert.equal(await source().inputValue(), noteDraft);
    assert.equal(await button('对照').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#zoom-reset').textContent(), '120%');
    assert.equal(await page.locator('#sync-scroll').isChecked(), false);
    assert.equal(await page.locator('#outline-toggle').getAttribute('aria-expanded'), 'true');
    assert.ok(Math.abs(await source().evaluate(element => element.scrollTop) - noteView.source) < 2);
    assert.ok(Math.abs(await page.locator('.canvas').evaluate(element => element.scrollTop) - noteView.render) < 2);
    await selectTab('重启后的命名草稿.md'); assert.equal(await source().inputValue(), namedDraft);
    await assert.rejects(stat(path.join(dir, '重启后的命名草稿.md')), { code: 'ENOENT' }, '新草稿没有偷偷保存到原目录');
    await selectTab('未命名'); assert.equal(await source().inputValue(), unnamedDraft);

    // Discard a draft explicitly, then prove a second interruption cannot revive it.
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
    await button('关闭 重启后的命名草稿.md').click();
    await page.waitForFunction(() => document.querySelectorAll('[role="tab"]').length === 3);
    await waitSession(value => value.documents?.length === 3 && !value.documents.some(item => item.suggestedName === '重启后的命名草稿.md'), '已丢弃的新草稿已从恢复记录移除');
    await crash();
    const external = original + '\n外部修改必须保留\n'; await writeFile(note, external);
    await launch(); await selectTab('恢复正文.md');
    assert.equal(await page.getByRole('tab', { name: '重启后的命名草稿.md', exact: true }).count(), 0);
    assert.equal(await source().inputValue(), noteDraft, '外部修改不能覆盖已恢复的草稿');
    await page.locator('#save').click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('外部修改'));
    await idle();
    assert.equal(await readFile(note, 'utf8'), external, '恢复后仍保留原校验值，阻止覆盖外部修改');
    assert.equal(await readFile(skill, 'utf8'), originalSkill);

    // A visual edit of unsupported source must retain its copy-only protection
    // after recovery and after subsequent source input emits a new history context.
    const lossyFile = path.join(dir, '特殊格式.md');
    const lossyOriginal = '# 特殊格式\n\n<!-- 必须保留的原始注释 -->\n\n正文可视化修改需要另存副本。\n';
    await writeFile(lossyFile, lossyOriginal);
    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
      dialog.showMessageBox = async () => ({ response: 0 });
    }, lossyFile);
    await button('打开').click(); await active('特殊格式.md'); await idle();
    await button('编辑').click(); await idle();
    await page.locator('.tiptap > p').first().click(); await page.keyboard.press('End'); await page.keyboard.insertText(' 有损正文修改');
    await button('源码').click(); await idle();
    assert.equal(await button('源码').getAttribute('aria-pressed'), 'true');
    const lossyDraft = await source().inputValue(); assert.match(lossyDraft, /有损正文修改/);
    await waitSession(value => value.documents.some(item => item.path === lossyFile && item.visualLossy && item.dirty && item.draft === lossyDraft
      && item.viewState?.view === 'source' && item.viewState.editing === true && value.activeId === item.id), '有损正文草稿、保护状态及源码视图已备份');
    await crash(); await launch(); await active('特殊格式.md'); await settle();
    assert.equal(await source().inputValue(), lossyDraft);
    await source().fill(lossyDraft + '\n恢复后的源码修改\n');
    await app.evaluate(({ dialog }) => {
      globalThis.recoveryCopySaves = [];
      dialog.showSaveDialog = async (_, options) => { globalThis.recoveryCopySaves.push(options); return { canceled: true }; };
    });
    await page.locator('#save').click(); await idle();
    const copySaves = await app.evaluate(() => globalThis.recoveryCopySaves);
    assert.equal(copySaves.length, 1, '有损正文草稿恢复后再修改源码仍必须另存副本');
    assert.match(copySaves[0].title, /副本/);
    assert.equal(await readFile(lossyFile, 'utf8'), lossyOriginal);
    assert.ok(await page.locator('#dirty-dot').isVisible(), '取消另存保留未保存草稿');
    await page.screenshot({ path: path.join(dir, 'recovery-source-restored.png') });
    assert.deepEqual(pageErrors, []);
    console.log('RECOVERY PASS: process interruption, invalid YAML/source drafts, named and unnamed tabs, active tab, compare/source mode, zoom, outline, scroll, original files, explicit discard, external conflict and recovered lossy-source copy protection. Screenshot:', path.join(dir, 'recovery-source-restored.png'));
  } catch (error) {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(dir, 'recovery-failure.png') }).catch(() => {});
      console.error('RECOVERY FAILURE STATE', await page.evaluate(() => ({ active: document.querySelector('#document-name')?.textContent,
        source: { top: document.querySelector('.source-input')?.scrollTop, height: document.querySelector('.source-input')?.scrollHeight, client: document.querySelector('.source-input')?.clientHeight },
        render: { top: document.querySelector('.canvas')?.scrollTop, height: document.querySelector('.canvas')?.scrollHeight, client: document.querySelector('.canvas')?.clientHeight },
        zoom: document.querySelector('#zoom-reset')?.textContent, toast: document.querySelector('#toast')?.textContent,
      })).catch(() => null), 'profile:', profile);
    }
    throw error;
  } finally {
    if (app) { await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
