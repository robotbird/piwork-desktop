// Debug: print computed token values inside the running app.
import { _electron as electron } from '@playwright/test';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const app = await electron.launch({
  executablePath: resolve(root, 'apps/desktop/node_modules/.bin/electron'),
  args: [resolve(root, 'apps/desktop'), `--user-data-dir=${root}/.visual-tmp`],
  env: { ...process.env, VITE_DEV_SERVER_URL: '' },
});
try {
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.evaluate(async (appearance) => {
    const prefs = await window.desktop.getPreferences();
    await window.desktop.setPreferences({ ...prefs, appearance });
  }, process.argv[2] ?? 'light');
  await window.waitForTimeout(300);
  const report = await window.evaluate(() => {
    const nav = document.querySelector('.nav');
    const aside = document.querySelector('aside');
    const bodyStyle = getComputedStyle(document.body);
    const navStyle = nav ? getComputedStyle(nav) : null;
    return {
      htmlClass: document.documentElement.className,
      bodyHasOpenAI: Boolean(document.querySelector('.openai-chat')),
      tokens: {
        body: bodyStyle.getPropertyValue('--body').trim(),
        muted: bodyStyle.getPropertyValue('--muted').trim(),
        mutedForeground: bodyStyle.getPropertyValue('--muted-foreground').trim(),
        hairlineSoft: bodyStyle.getPropertyValue('--hairline-soft').trim(),
        sidebar: bodyStyle.getPropertyValue('--sidebar').trim(),
        primary: bodyStyle.getPropertyValue('--primary').trim(),
      },
      navColor: navStyle ? navStyle.color : null,
      navThirdColor: getComputedStyle(document.querySelectorAll('.nav')[2] ?? document.body).color,
      labelColor: getComputedStyle(document.querySelector('.label') ?? document.body).color,
      mutedVarOnBody: getComputedStyle(document.body).getPropertyValue('--muted').trim(),
      asideBg: aside ? getComputedStyle(aside).backgroundColor : null,
      navCount: document.querySelectorAll('.nav').length,
    };
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app.close();
}
