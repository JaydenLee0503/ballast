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
