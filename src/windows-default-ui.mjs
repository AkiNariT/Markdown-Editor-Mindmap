const buttonIds = ['default-app', 'default-app-settings', 'default-app-copy'];

function plainDetail(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, 1800).trim();
}

function diagnostic(value) {
  const code = typeof value?.code === 'string' && /^[A-Z_]{1,64}$/.test(value.code) ? `[${value.code}]` : '';
  return [code, plainDetail(value?.detail)].filter(Boolean).join(' ');
}

export function createWindowsDefaultUI({ api, t, document, canAct = () => true }) {
  const $ = id => document.getElementById(id);
  let result = null, failure = null, busy = '', locked = false, copyStatus = '', copyDetail = '';

  function registrationCause(code) {
    switch (code) {
      case 'HELPER_MISSING': return t('缺少设置组件。请完整解压下载包后重试，也可手动选择 MD.exe。');
      case 'POWERSHELL_MISSING': return t('未找到系统 PowerShell。请在 Windows 设置中手动选择 MD.exe。');
      case 'TIMEOUT': return t('自动注册超时。可重试，或在 Windows 设置中手动选择 MD.exe。');
      case 'ACCESS_DENIED': return t('系统拒绝了注册操作。请在 Windows 设置中手动选择 MD.exe。');
      case 'CONFLICT': return t('检测到现有的应用记录，未自动覆盖。请在 Windows 设置中手动选择 MD.exe。');
      default: return t('自动注册未完成。请在 Windows 设置中手动选择 MD.exe，或展开详情查看原因。');
    }
  }

  function failureMessage(code) {
    switch (code) {
      case 'WINDOWS_DEFAULT_UNSUPPORTED': return t('默认打开方式设置目前仅支持 Windows。');
      case 'WINDOWS_DEFAULT_DEVELOPMENT': return t('请在打包后的 MD.exe 中设置默认打开方式。');
      case 'WINDOWS_DEFAULT_REGISTRATION': return t('无法识别当前程序位置。请完整解压下载包并运行 MD.exe。');
      default: return t('操作未完成。请重试，或手动打开 Windows 设置 → 应用 → 默认应用。');
    }
  }

  function refreshLanguage() {
    $('default-app').textContent = busy === 'register' ? t('正在准备…') : t('设置默认打开方式');
    $('default-app-settings').textContent = busy === 'settings' ? t('正在打开…') : t('打开系统设置');
    $('default-app-copy').textContent = busy === 'copy' ? t('正在复制…') : t('复制程序路径');
    $('default-app-details-label').textContent = t('查看错误详情');
    for (const id of buttonIds) $(id).disabled = locked || Boolean(busy);
    const registration = result?.registration, settings = result?.settings;
    let message = '', cause = '';
    if (busy && busy !== 'copy') message = t('正在打开 Windows 设置…');
    else if (failure) message = failureMessage(failure.code);
    else if (result) {
      if (settings.status === 'opened') message = registration.status === 'failed'
        ? t('已打开 Windows 设置。自动注册未完成，可手动选择 MD。')
        : t('已打开 Windows 设置。请选择 MD 作为 .md 和 .markdown 的默认应用。');
      else message = registration.status === 'registered'
        ? t('MD 已注册，但无法打开系统设置。请手动进入 Windows 设置 → 应用 → 默认应用。')
        : t('无法打开 Windows 设置。请手动进入 Windows 设置 → 应用 → 默认应用。');
      if (registration.status === 'failed') cause = registrationCause(registration.code);
    }
    $('default-app-status').textContent = message;
    $('default-app-status').classList.toggle('form-error', Boolean(failure || registration?.status === 'failed' || settings?.status === 'failed'));
    $('default-app-status').setAttribute('aria-busy', String(Boolean(busy)));
    $('default-app-cause').textContent = cause;
    $('default-app-cause').hidden = !cause;
    const details = [];
    if (diagnostic(failure)) details.push(diagnostic(failure));
    if (diagnostic(registration)) details.push(t('自动注册：{detail}', { detail: diagnostic(registration) }));
    if (diagnostic(settings)) details.push(t('打开设置：{detail}', { detail: diagnostic(settings) }));
    if (copyDetail) details.push(t('复制路径：{detail}', { detail: copyDetail }));
    // Diagnostics are local process output, always bounded text rather than HTML.
    $('default-app-diagnostic').textContent = details.join('\n\n');
    $('default-app-details').hidden = details.length === 0;
    $('default-app-copy-status').textContent = copyStatus === 'copied'
      ? t('程序路径已复制。在“在电脑上选择应用”的文件名栏粘贴即可。')
      : copyStatus === 'failed' ? t('未能复制程序路径，请重试。') : '';
    $('default-app-copy-status').classList.toggle('form-error', copyStatus === 'failed');
  }

  async function run(action) {
    if (busy || locked || !canAct()) return;
    busy = action; copyStatus = ''; copyDetail = '';
    if (action !== 'copy') { result = null; failure = null; }
    refreshLanguage();
    try {
      const value = await (action === 'register' ? api.setWindowsDefaultApp()
        : action === 'settings' ? api.openWindowsDefaultSettings() : api.copyApplicationPath());
      if (value?.error) throw Object.assign(new Error(value.error), { code: value.code });
      if (action === 'copy') {
        if (value?.status !== 'copied') throw new Error(t('未能确认程序路径已复制。'));
        copyStatus = 'copied';
      } else {
        if (!['opened', 'failed'].includes(value?.status) || !['registered', 'skipped', 'failed'].includes(value.registration?.status)
          || !['opened', 'failed'].includes(value.settings?.status)) throw new Error(t('默认应用设置返回的信息无效，请重试。'));
        result = value;
      }
    } catch (error) {
      const detail = plainDetail(error?.message);
      if (action === 'copy') { copyStatus = 'failed'; copyDetail = detail; }
      else failure = { code: error?.code, detail };
    } finally { busy = ''; refreshLanguage(); }
  }

  $('default-app').addEventListener('click', () => run('register'));
  $('default-app-settings').addEventListener('click', () => run('settings'));
  $('default-app-copy').addEventListener('click', () => run('copy'));
  refreshLanguage();
  return { refreshLanguage, setLocked(value) { locked = Boolean(value); refreshLanguage(); } };
}
