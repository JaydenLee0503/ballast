/**
 * Bo, the plumb bob.
 *
 * Drawn rather than fetched. Every other asset in this app is inline for the
 * same reason (`World.tsx` says it plainly: a demo that needs a CDN is a demo
 * that fails on conference wifi), and a mascot is not the place to break that.
 * It also means he inherits the theme's ink outline and sticker shadow instead
 * of being a picture pasted on top of them.
 *
 * The shape is the real instrument: a weight, hung from a string, tapering to a
 * point. He hangs and swings because that is what a plumb bob does, and the
 * swing stops for anyone who has asked their system not to animate things.
 *
 * Moods are deliberately cheap — a mouth, an arm, a few degrees of tilt. A
 * mascot with a dozen poses is a mascot somebody has to maintain.
 */

import type { BoMood } from '@/lib/tutorial.ts'

/** Body colour. Lilac, not one of the utilisation colours: Bo is not a reading. */
const BODY = 'var(--color-lilac)'
const HAT = 'var(--color-coral)'
const INK = 'var(--color-ink)'

/** How far he hangs off vertical, per mood. Degrees. */
const TILT: Readonly<Record<BoMood, number>> = {
  wave: -7,
  point: 5,
  think: -4,
  cheer: 0,
}

const MOUTH: Readonly<Record<BoMood, string>> = {
  // A plain smile.
  wave: 'M25 57 Q32 63 39 57',
  point: 'M26 57 Q32 62 38 57',
  // Thinking: small and off to one side.
  think: 'M27 58 Q31 60 36 57',
  // Open, pleased.
  cheer: 'M24 55 Q32 66 40 55 Q32 60 24 55',
}

export interface BoProps {
  mood?: BoMood
  /** Rendered width in pixels. The drawing scales from this. */
  size?: number
  className?: string
}

export function Bo({ mood = 'wave', size = 96, className = '' }: BoProps) {
  const tilt = TILT[mood]

  return (
    <svg
      width={size}
      height={size * 1.5}
      viewBox="0 0 64 96"
      className={`bo-hang ${className}`}
      role="img"
      aria-label={`Bo the plumb bob, ${mood}`}
    >
      {/* The string he hangs from. Anchored at the top of the box so he reads
          as suspended rather than floating. */}
      <line x1="32" y1="0" x2="32" y2="17" stroke={INK} strokeWidth="2" />

      {/* Everything below the string swings together. */}
      <g style={{ transformOrigin: '32px 4px', transform: `rotate(${tilt}deg)` }}>
        {/* Cap, which doubles as a hard hat. */}
        <rect
          x="23"
          y="14"
          width="18"
          height="9"
          rx="4"
          fill={HAT}
          stroke={INK}
          strokeWidth="2.5"
        />

        {/* The bob: a shoulder that tapers to a point. */}
        <path
          d="M32 22 C19 22 9 33 9 46 C9 63 21 73 32 88 C43 73 55 63 55 46 C55 33 45 22 32 22 Z"
          fill={BODY}
          stroke={INK}
          strokeWidth="2.5"
          strokeLinejoin="round"
        />

        {/* A highlight, so the body reads as rounded rather than as a sticker
            of a triangle. */}
        <path
          d="M18 38 C20 31 25 27 30 26"
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.55"
          strokeWidth="3"
          strokeLinecap="round"
        />

        <circle cx="16" cy="55" r="3.5" fill={HAT} fillOpacity="0.55" />
        <circle cx="48" cy="55" r="3.5" fill={HAT} fillOpacity="0.55" />

        {/* Eyes. `think` narrows one, which is the whole of the expression. */}
        <ellipse cx="24" cy="46" rx="3.2" ry="3.8" fill={INK} />
        {mood === 'think' ? (
          <rect x="36.5" y="45" width="7" height="2.6" rx="1.3" fill={INK} />
        ) : (
          <ellipse cx="40" cy="46" rx="3.2" ry="3.8" fill={INK} />
        )}

        <path
          d={MOUTH[mood]}
          fill={mood === 'cheer' ? INK : 'none'}
          stroke={INK}
          strokeWidth="2.2"
          strokeLinecap="round"
        />

        {/* Arms. One shape, moved, rather than four drawings. */}
        {mood === 'wave' && (
          <g stroke={INK} strokeWidth="2.5" strokeLinecap="round">
            <path d="M53 40 Q61 34 60 26" fill="none" />
            <circle cx="60" cy="23" r="4" fill={BODY} />
          </g>
        )}
        {mood === 'point' && (
          <g stroke={INK} strokeWidth="2.5" strokeLinecap="round">
            <path d="M53 47 L63 47" fill="none" />
            <circle cx="66" cy="47" r="4" fill={BODY} />
          </g>
        )}
        {mood === 'think' && (
          <g stroke={INK} strokeWidth="2.5" strokeLinecap="round">
            <path d="M50 52 Q46 60 40 60" fill="none" />
            <circle cx="38" cy="60" r="4" fill={BODY} />
          </g>
        )}
        {mood === 'cheer' && (
          <g stroke={INK} strokeWidth="2.5" strokeLinecap="round">
            <path d="M52 40 Q60 33 59 25" fill="none" />
            <circle cx="59" cy="22" r="4" fill={BODY} />
            <path d="M12 40 Q4 33 5 25" fill="none" />
            <circle cx="5" cy="22" r="4" fill={BODY} />
          </g>
        )}
      </g>
    </svg>
  )
}
