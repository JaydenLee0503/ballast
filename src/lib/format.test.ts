import { expect, it } from 'vitest'
import { formatSignedPercent } from '@/lib/format.ts'
it('signs', () => {
  expect(formatSignedPercent(0.18)).toBe('+18%')
  expect(formatSignedPercent(-0.04)).toBe('−4%')
  expect(formatSignedPercent(0)).toBe('0%')
  expect(formatSignedPercent(null)).toBe('—')
  expect(formatSignedPercent(Number.POSITIVE_INFINITY)).toBe('—')
})
