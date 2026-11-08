import { useEffect, useState, type ReactNode } from 'react';

// Data-URL thumbnails for library images, cached per path for the app session.
const thumbCache = new Map<string, string>();

export function isImageName(name: string) {
  return /\.(png|jpe?g|gif|webp)$/i.test(name);
}

/** Renders children until the image thumbnail loads (or fails); then the image. */
export function LibraryThumb({ path, name, className, children }: {
  path: string;
  name: string;
  className?: string;
  children?: ReactNode;
}) {
  const [src, setSrc] = useState<string | null>(thumbCache.get(path) ?? null);
  useEffect(() => {
    if (src) return;
    let active = true;
    window.desktop.libraryReadImage(path)
      .then(({ mime, base64 }) => {
        const url = `data:${mime};base64,${base64}`;
        thumbCache.set(path, url);
        if (active) setSrc(url);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [path, src]);
  if (!src) return <>{children}</>;
  return <img alt={name} className={className} loading="lazy" src={src} />;
}
