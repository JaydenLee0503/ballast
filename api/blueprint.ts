/**
 * /api/blueprint in production. The twin of `api/critique.ts` — see that file
 * for why the key is read here, why the imports are relative, and why the
 * signature is the Web-standard one.
 */

import { handleBlueprint } from '../plugins/blueprintApi.ts'

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

  return json(await handleBlueprint(options, body))
}
