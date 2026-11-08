// Mounts next-intl with the piwork web catalogs (single source, copied under
// src/web/i18n) so copied web components can call useTranslations unchanged.
// Language follows desktop preferences (system → navigator.language), mirroring
// the resolution the App shell uses for its own overlay strings. The App shell
// dispatches 'piwork:prefs-changed' after loading/saving preferences so this
// provider re-resolves immediately (no restart needed).
import { useEffect, useState, type ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { normalizeLanguage } from '@/lib/i18n';
import type { Preferences } from '../shared/types';
import zhMessages from '@/i18n/messages/zh.json';
import enMessages from '@/i18n/messages/en.json';

function resolveLanguage(prefs: Preferences | null): 'zh' | 'en' {
  const pref = prefs?.language;
  if (pref === 'zh-CN' || pref === 'en') return pref === 'en' ? 'en' : 'zh';
  return normalizeLanguage(navigator.language) ?? 'zh';
}

export function WebIntlProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<'zh' | 'en'>(() =>
    resolveLanguage(null),
  );

  useEffect(() => {
    let cancelled = false;
    const resolve = () =>
      window.desktop
        .getPreferences()
        .then((prefs) => {
          if (!cancelled) setLocale(resolveLanguage(prefs));
        })
        .catch(() => {});
    void resolve();
    const onPrefsChange = () => void resolve();
    const onLanguageChange = () => {
      if (!cancelled) setLocale(resolveLanguage(null));
    };
    window.addEventListener('piwork:prefs-changed', onPrefsChange);
    window.addEventListener('languagechange', onLanguageChange);
    return () => {
      cancelled = true;
      window.removeEventListener('piwork:prefs-changed', onPrefsChange);
      window.removeEventListener('languagechange', onLanguageChange);
    };
  }, []);

  return (
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'en' ? enMessages : zhMessages}
    >
      {children}
    </NextIntlClientProvider>
  );
}
