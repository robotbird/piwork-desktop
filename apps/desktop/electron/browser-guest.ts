import { app, session, shell, type BrowserWindow } from 'electron';

/* 内部浏览器标签的 guest 加固(参考 deepseek-harness browser-guests.ts):
   渲染层只能创建 partition=persist:piwork-browser 的 webview;will-attach-webview 清空页面
   传入的全部偏好后覆写安全集;新窗口一律拒绝并回传主窗口开新浏览器标签;权限/下载全拒。 */
const BROWSER_PARTITION = 'persist:piwork-browser';
const SECURE_GUEST_PREFERENCES = {
  partition: BROWSER_PARTITION,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  plugins: false,
  navigateOnDragDrop: false,
  disableDialogs: true,
  devTools: !app.isPackaged,
} as const;

function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** 给浏览器 guest 的会话上最紧的权限策略(幂等,多个窗口共用同一 partition)。 */
function hardenSession() {
  const browserSession = session.fromPartition(BROWSER_PARTITION);
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  browserSession.setPermissionCheckHandler(() => false);
  browserSession.setDevicePermissionHandler(() => false);
  browserSession.on('will-download', event => event.preventDefault());
}

/** 主窗口创建后调用:接管 webview 附加校验与 guest 事件。 */
export function bindBrowserGuests(window: BrowserWindow) {
  hardenSession();
  window.webContents.on('will-attach-webview', (event, preferences, params) => {
    // 只放行我们代码创建的浏览器 webview;清空页面可传入的偏好后写入安全集
    if (params.partition !== BROWSER_PARTITION) {
      event.preventDefault();
      return;
    }
    for (const key of Object.keys(preferences)) Reflect.deleteProperty(preferences, key);
    Object.assign(preferences, SECURE_GUEST_PREFERENCES);
    params.httpreferrer = '';
  });
  window.webContents.on('did-attach-webview', (_event, guest) => {
    guest.setWindowOpenHandler(({ url }) => {
      // 弹窗一律不开系统窗口;http(s) 链接回传渲染端,在面板内开新浏览器标签
      if (isWebUrl(url)) window.webContents.send('browser:open-requested', url);
      else if (url) void shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    });
    guest.on('will-navigate', (event, url) => {
      // guest 内仅允许 http(s) 导航(file:// 等一律拦截)
      if (!isWebUrl(url) && url !== 'about:blank') event.preventDefault();
    });
  });
}
