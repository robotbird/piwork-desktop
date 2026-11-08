// Stand-in for next/link: renders a plain anchor and routes through the
// in-memory navigation store. Modifier-clicks keep native browser behavior.
import type { ComponentProps } from 'react';
import { useRouter } from './navigation';

type LinkProps = Omit<ComponentProps<'a'>, 'href'> & {
  href: string;
  replace?: boolean;
  prefetch?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  passHref?: boolean;
  legacyBehavior?: boolean;
};

export function Link({
  href,
  replace,
  prefetch,
  scroll,
  shallow,
  passHref,
  legacyBehavior,
  onClick,
  ...props
}: LinkProps) {
  const router = useRouter();
  return (
    <a
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        if (replace) router.replace(href);
        else router.push(href);
      }}
      {...props}
    />
  );
}
