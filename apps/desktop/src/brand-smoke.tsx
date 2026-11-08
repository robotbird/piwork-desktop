// P1 smoke view: proves the copied web stack renders inside the desktop
// renderer — pi logo, shadcn button (via @/ alias) and tailwind utilities, in
// both light and dark themes. Open with `#smoke-brand` in the dev URL.
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PiLogo } from './brand/pi-logo';
import { Button } from '@/components/ui/button';

export function BrandSmoke() {
  const [dark, setDark] = useState(document.documentElement.classList.contains('dark'));
  const t = useTranslations('common');

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
  }

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col items-center gap-6 p-10">
      <div className="flex items-center gap-3">
        <PiLogo className="size-10" aria-hidden="true" />
        <PiLogo className="size-7" aria-hidden="true" />
        <PiLogo className="size-4" aria-hidden="true" />
      </div>
      <h1 className="text-heading-md text-foreground">PiWork desktop · web 复用冒烟</h1>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button>default</Button>
        <Button variant="outline">outline</Button>
        <Button variant="secondary">secondary</Button>
        <Button variant="ghost">ghost</Button>
        <Button variant="destructive">destructive</Button>
        <Button variant="pill" size="sm" onClick={toggle}>
          {dark ? '切换亮色' : '切换暗色'}
        </Button>
      </div>
      <p className="text-muted-foreground text-body-md">
        tokens: bg-background / text-foreground / text-muted-foreground · utility: flex/gap/p-10
      </p>
      <p className="text-body-md">
        i18n: {t('dismiss')} / {t('positionOfTotal', { current: 1, total: 3 })}
      </p>
    </div>
  );
}
