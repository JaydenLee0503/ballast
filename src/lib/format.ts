/**
 * Display formatting. No arithmetic that changes a value's meaning — only
 * rounding and unit presentation. Anything that computes belongs in the
 * engine.
 */

/**
 * Drift is quoted as a fraction of storey height, the way the codes and the
 * profession quote it: h/500 rather than 0.002.
 */
export function formatDriftRatio(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return 'h/∞'
  return `h/${Math.round(1 / ratio).toLocaleString('en-US')}`
}

export function formatSafetyFactor(value: number): string {
  if (!Number.isFinite(value)) return '∞'
  return value.toFixed(2)
}

/** Tonnes for anything above a tonne; kilograms below, where t reads as 0.0. */
export function formatCarbon(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} t`
  return `${Math.round(kg).toLocaleString('en-US')} kg`
}

export function formatUsd(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`
  if (usd >= 1000) return `$${Math.round(usd / 1000).toLocaleString('en-US')}k`
  return `$${Math.round(usd).toLocaleString('en-US')}`
}

export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return '—'
  return `${Math.round(fraction * 100)}%`
}

/**
 * A change, with its sign kept: "+18%", "-4%", "0%".
 *
 * The sign is the information — a delta rendered as a bare "18%" reads as an
 * absolute value and is the wrong number entirely. Null (an undefined ratio,
 * such as a change from zero) renders as an em dash rather than as 0%, which
 * would claim nothing happened.
 */
export function formatSignedPercent(fraction: number | null): string {
  if (fraction === null || !Number.isFinite(fraction)) return '—'
  const percent = Math.round(fraction * 100)
  if (percent === 0) return '0%'
  return `${percent > 0 ? '+' : '\u2212'}${Math.abs(percent)}%`
}
