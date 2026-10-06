import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';

/**
 * A photo that never appears half drawn: it stays invisible over its box's
 * grey shimmer until the file has fully arrived and been decoded, then fades
 * in (Airbnb's listing photos). Large progressive JPEGs used to paint top to
 * bottom in strips. A photo already in the cache shows at once.
 */
export function FadeImage({ className = '', onLoad, onError, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const ref = useRef<HTMLImageElement>(null);
  const src = props.src ?? '';
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);

  useEffect(() => {
    const img = ref.current;
    if (!img?.complete || img.naturalWidth === 0) return;
    let cancelled = false;
    const done = () => {
      if (!cancelled) setLoadedSrc(src);
    };
    img.decode().then(done, done);
    return () => {
      cancelled = true;
    };
  }, [src]);

  return (
    <img
      ref={ref}
      {...props}
      className={`fade-img${loadedSrc === src ? ' is-loaded' : ''} ${className}`.trim()}
      onLoad={(event) => {
        // decode() resolves once the image can be painted in one go.
        const done = () => setLoadedSrc(src);
        event.currentTarget.decode().then(done, done);
        onLoad?.(event);
      }}
      onError={(event) => {
        onError?.(event);
      }}
    />
  );
}
