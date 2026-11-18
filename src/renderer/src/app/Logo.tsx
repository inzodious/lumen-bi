/** Lumen logo mark (same artwork as resources/icon.svg), usable at any size. */
export function LumenLogo({ size = 20, title }: { size?: number; title?: string }) {
  const id = 'lm'
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" role="img" aria-label={title ?? 'Lumen'}>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#34323D" />
          <stop offset="1" stopColor="#16151B" />
        </linearGradient>
        <linearGradient id={`${id}-bar`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFE07A" />
          <stop offset="1" stopColor="#E9A40C" />
        </linearGradient>
        <linearGradient id={`${id}-bar-dim`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F7C948" />
          <stop offset="1" stopColor="#C7820A" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFF7D6" stopOpacity="1" />
          <stop offset="0.3" stopColor="#FFDC5C" stopOpacity="0.75" />
          <stop offset="1" stopColor="#F2C811" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-beam`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#FFE8A3" stopOpacity="0.5" />
          <stop offset="1" stopColor="#FFE8A3" stopOpacity="0.04" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill={`url(#${id}-bg)`} />
      <path d="M150 150 L96 420 L432 420 L196 128 Z" fill={`url(#${id}-beam)`} />
      <circle cx="160" cy="138" r="104" fill={`url(#${id}-glow)`} />
      <circle cx="160" cy="138" r="36" fill="#FFF9E3" />
      <rect x="110" y="318" width="76" height="104" rx="18" fill={`url(#${id}-bar-dim)`} />
      <rect x="218" y="250" width="76" height="172" rx="18" fill={`url(#${id}-bar)`} />
      <rect x="326" y="172" width="76" height="250" rx="18" fill={`url(#${id}-bar)`} />
    </svg>
  )
}
