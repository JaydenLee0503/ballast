/**
 * /api/critique in production.
 *
 * The Vite middleware in `plugins/critiqueApi.ts` serves this route during
 * `npm run dev` and `npm run preview`; Vercel serves a static `dist` and has no
 * Vite server, so the same route has to exist here as a function. Both are
 * transports over one `handleCritique`, which is where every decision lives —
 * so the token budget, the validation messages and the provider error
 * passthrough cannot drift between dev and production.
 *
 * WHY THE KEY IS READ HERE. `vite.config.ts` reads the provider variables with
 * `loadEnv(mode, cwd, '')` and hands them to the plugin; on Vercel they arrive
 * as ordinary environment variables on the function. Neither path is
 * `VITE_`-prefixed, because that prefix is exactly what would inline the key
 * into the browser bundle. This module runs on the server and is the only place
 * in production that ever sees it.
 *
 * THIS FILE IS NOT WHAT SHIPS. `scripts/bundleFunctions.mjs` bundles it into
 * `api/critique.js`, which is what Vercel actually runs, and the reason is
 * worth knowing before editing: Vercel transpiles each file under `api/` on its
 * own and does not rewrite import specifiers, so an `import ... from
 * '../plugins/routes.ts'` survived into the emitted JavaScript and Node threw
 * ERR_MODULE_NOT_FOUND on a `.ts` path at runtime. Bundling leaves nothing to
 * resolve. Edit here; never edit `api/*.js`.
 *
 * THREE CONSTRAINTS worth knowing:
 *
 *  - **Relative imports only.** Vercel's function compiler ignores tsconfig
 *    "Path Mappings", so the `@/` alias the rest of the app uses would not
 *    resolve here even before bundling. `../src/...` is not a style choice.
 *  - **No npm package may be reachable.** `plugins/routeDeps.test.ts` asserts
 *    it. Above all not Vite, whose types the dev-server transport legitimately
 *    imports.
 *  - **Web-standard signature.** A named method export taking a `Request` and
 *    returning a `Response`, which needs no `@vercel/node` dependency and
 *    leaves no ambiguity about whether the body was already parsed.
 */

import { handleCritique } from '../plugins/routes.ts'

function json(reply: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(reply.body), {
    status: reply.status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function POST(request: Request): Promise<Response> {
  const options = {
    apiKey: process.env['FEATHERLESS_API_KEY'],
    model: process.env['FEATHERLESS_MODEL'],
    baseUrl: process.env['FEATHERLESS_BASE_URL'],
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ status: 400, body: { error: 'Request body was not valid JSON.' } })
  }

  return json(await handleCritique(options, body))
}
