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
 * Priority order: svg → png → webp → jpg → jpeg → gif → avif.
 * Delete the file and the default bolt returns.
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
  return (
    <img
      src={LOGO_URL}
      alt={alt}
      width={size}
      height={size}
      draggable={false}
      className={cn('object-contain shrink-0 select-none', className)}
    />
  );
}
