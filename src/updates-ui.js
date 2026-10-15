export function createUpdatesUI({ api, t, document }) {
  const $ = id => document.getElementById(id);
  const dialog = $('update-dialog');
  let currentVersion = '', status = 'idle', release = null, failure = '', pageFailure = '';
  let checking = false, openingPage = false, loadingInfo = false;
  let languageLabel = t('检查更新');

  function refreshLanguage() {
    const nextLanguageLabel = t('检查更新');
    if (languageLabel !== nextLanguageLabel) {
      // Backend error details arrive localized; discard them after a language change.
      if (status === 'error') { status = 'idle'; failure = ''; }
      pageFailure = ''; languageLabel = nextLanguageLabel;
    }
    $('update-current-version').textContent = currentVersion || t('未知');
    $('update-check').textContent = checking ? t('正在检查…') : t('检查更新');
    $('update-check').disabled = checking;
    $('update-status').textContent = status === 'checking' ? t('正在连接 GitHub 检查更新…')
      : status === 'available' ? t('发现新版本 {version}。', { version: release.version })
      : status === 'current' ? t('当前已是最新版本。')
      : status === 'unpublished' ? t('暂未找到可用的公开版本。')
      : status === 'error' ? t('检查失败：{message}', { message: failure })
      : t('点击「检查更新」获取最新发布信息。');
    $('update-status').classList.toggle('form-error', status === 'error');
    $('update-status').setAttribute('aria-busy', String(checking));
    $('update-release').hidden = !release;
    $('update-release-version').textContent = release?.version || '';
    $('update-prerelease').hidden = !release?.prerelease;
    $('update-prerelease').textContent = t('预发布版本');
    $('update-release-name').textContent = release?.name || '';
    $('update-release-name').hidden = !release?.name;
    // Release names and notes are remote text; never interpret them as markup.
    $('update-release-notes').textContent = release ? release.body?.trim() || t('此版本未提供更新说明。') : '';
    $('update-download').hidden = !['available', 'current', 'unpublished', 'error'].includes(status);
    $('update-download').disabled = openingPage;
    $('update-download').textContent = openingPage ? t('正在打开…') : t('打开官方下载页面');
    $('update-error').textContent = pageFailure ? t('无法打开下载页面：{message}', { message: pageFailure }) : '';
    $('update-error').hidden = !pageFailure;
  }

  async function open() {
    if (dialog.open) return;
    refreshLanguage();
    dialog.showModal();
    if (currentVersion || loadingInfo) return;
    loadingInfo = true;
    try {
      const result = await api.getAppInfo();
      if (result?.version) currentVersion = result.version;
    } catch {
      // A failed local version lookup must not prevent a manual update check.
    } finally { loadingInfo = false; refreshLanguage(); }
  }

  async function check() {
    if (checking) return;
    checking = true; status = 'checking'; release = null; failure = ''; pageFailure = '';
    refreshLanguage();
    try {
      const result = await api.checkUpdate();
      if (result?.error) throw new Error(result.error);
      if (!['available', 'current', 'unpublished'].includes(result?.status) || (result.status === 'available' && !result.release)) {
        throw new Error(t('更新信息无效，请稍后重试。'));
      }
      currentVersion = result.currentVersion || currentVersion;
      release = result.release || null;
      status = result.status;
    } catch (error) {
      status = 'error'; release = null; failure = error?.message || t('请稍后重试。');
    } finally { checking = false; refreshLanguage(); }
  }

  async function openDownload() {
    if (openingPage) return;
    openingPage = true; pageFailure = ''; refreshLanguage();
    try {
      const result = await api.openReleasePage();
      if (result?.error) throw new Error(result.error);
      if (!result?.ok) throw new Error(t('请稍后重试。'));
    } catch (error) { pageFailure = error?.message || t('请稍后重试。'); }
    finally { openingPage = false; refreshLanguage(); }
  }

  $('update-check').addEventListener('click', check);
  $('update-download').addEventListener('click', openDownload);
  $('update-close').addEventListener('click', () => dialog.close());
  return { open, refreshLanguage };
}
