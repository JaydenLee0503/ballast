/**
 * What a serverless function is allowed to drag in.
 *
 * The two AI routes have two transports: a Vite middleware for dev and preview,
 * and a Vercel function for production. The production one must not reach a
 * single npm package — above all not Vite, whose types the middleware does
 * legitimately import.
 *
 * A type-only import ought to be erased before any bundler tries to resolve it,
 * so in principle `import type { Connect } from 'vite'` inside a shared module
 * is harmless. In practice that is a bet on another tool's compiler, the bet is
 * invisible when it loses, and losing it means a dev server being pulled into a
 * 60-second function — which surfaces as an HTTP 500 with no JSON body and no
 * obvious cause. So the property is asserted here rather than trusted.
 *
 * Walked from the filesystem rather than by importing anything, because the
 * question is what the *module graph* says, not what happens to be loadable in
 * a test runner.
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

const ENTRY_POINTS = ['functions/critique.ts', 'functions/blueprint.ts']

const IMPORT_PATTERN = /^\s*(?:import|export)\s[^'"]*from\s+['"]([^'"]+)['"]/gm

function reachable(entry: string): { modules: string[]; bare: string[] } {
  const seen = new Set<string>()
  const bare: string[] = []
  const stack = [entry]

  while (stack.length > 0) {
    const file = stack.pop()
    if (file === undefined || seen.has(file) || !existsSync(file)) continue
    seen.add(file)
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const spec = match[1]
      if (spec === undefined) continue
      if (spec.startsWith('.')) {
        stack.push(normalize(join(dirname(file), spec)))
      } else if (!spec.startsWith('node:')) {
        bare.push(`${file} -> ${spec}`)
      }
    }
  }
  return { modules: [...seen], bare }
}

describe('what the production API routes depend on', () => {
  it.each(ENTRY_POINTS)('%s reaches no npm package at all', (entry) => {
    const { bare } = reachable(entry)
    expect(bare, `remove these imports from the production route graph`).toEqual([])
  })

  it.each(ENTRY_POINTS)('%s never reaches Vite, even as a type', (entry) => {
    const { modules } = reachable(entry)
    const offenders = modules.filter(
      (file) => existsSync(file) && /from ['"]vite['"]/.test(readFileSync(file, 'utf8')),
    )
    expect(offenders).toEqual([])
  })

  it('still shares the message builders, rather than copying them', () => {
    // The point is decoupling from the *transport*, not from the pure code.
    // If these stop being reachable, a second copy of the prompt has appeared.
    const { modules } = reachable('functions/critique.ts')
    expect(modules).toContain(normalize('src/ai/prompt.ts'))
    expect(reachable('functions/blueprint.ts').modules).toContain(
      normalize('src/ai/blueprint/prompt.ts'),
    )
  })
})
