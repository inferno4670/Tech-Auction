import { useState } from 'react';
import defaultLogoUrl from '../../assets/logo-default.svg';
import { cn } from '../../lib/utils';

/**
 * Brand logo used on every screen (landing, login, admin sidebar, team
 * header, projector).
 *
 * To rebrand, drop ONE file into `src/assets/` — no code changes needed:
 *
 *   logo.svg · logo.png · logo.webp · logo.jpg · logo.jpeg · logo.gif · logo.avif
 *
 * Priority order: svg → png → webp → jpg → jpeg → gif · avif.
 * Delete the file and the default bolt returns.
 *
 * Fallback chain — a broken image can never appear on any machine:
 *   1. the drop-in logo file
 *   2. logo-default.svg (the bundled bolt)
 *   3. an inline <svg> bolt (zero network requests — survives offline/flaky
 *      venue networks where the asset request itself failed)
 */
const USER_LOGOS = import.meta.glob('../../assets/logo.{svg,png,webp,jpg,jpeg,gif,avif}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const PRIORITY = [
  'logo.svg',
  'logo.png',
  'logo.webp',
  'logo.jpg',
  'logo.jpeg',
  'logo.gif',
  'logo.avif',
] as const;

function resolveLogoUrl(): string {
  const entries = Object.entries(USER_LOGOS);
  for (const fileName of PRIORITY) {
    const match = entries.find(([path]) => path.endsWith(`/${fileName}`));
    if (match) return match[1];
  }
  return entries[0]?.[1] ?? defaultLogoUrl;
}

const LOGO_URL = resolveLogoUrl();

export function Logo({
  size = 32,
  className,
  alt = 'TECH AUCTION logo',
}: {
  size?: number;
  className?: string;
  alt?: string;
}) {
  // null = every network source failed → render the inline bolt below.
  const [src, setSrc] = useState<string | null>(LOGO_URL);

  const handleError = () => {
    setSrc(prev => (prev === defaultLogoUrl ? null : defaultLogoUrl));
  };

  if (src === null) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        role="img"
        aria-label={alt}
        className={cn('shrink-0 select-none', className)}
      >
        <polygon
          points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"
          fill="#22d3ee"
          stroke="#22d3ee"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <img
      src={src}
      onError={handleError}
      alt={alt}
      width={size}
      height={size}
      draggable={false}
      className={cn('object-contain shrink-0 select-none', className)}
    />
  );
}
