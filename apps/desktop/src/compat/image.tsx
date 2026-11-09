// Stand-in for next/image: renders a plain <img>. Local files and data/blob
// URLs need no optimization pipeline; width/height keep layout stable.
import type { CSSProperties, ComponentProps } from 'react';

type ImageProps = Omit<ComponentProps<'img'>, 'fill' | 'loader'> & {
  fill?: boolean;
  priority?: boolean;
  unoptimized?: boolean;
  quality?: number;
  loader?: (args: { src: string; width: number; quality?: number }) => string;
  placeholder?: string;
};

export function Image({
  src,
  alt,
  width,
  height,
  fill,
  priority,
  unoptimized,
  quality,
  loader,
  placeholder,
  style,
  ...props
}: ImageProps) {
  const fillStyle: CSSProperties | undefined = fill
    ? { position: 'absolute', height: '100%', width: '100%', inset: 0, objectFit: 'cover', colorScheme: 'inherit', ...style }
    : style;
  return (
    <img
      src={typeof src==='string'&&src.startsWith('/images/')?`.${src}`:src}
      alt={alt}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      style={fillStyle}
      {...props}
    />
  );
}
