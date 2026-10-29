/**
 * Smoke tests for the ARTEX bridge HTTP client, runnable straight from source
 * with the Node.js built-in test runner and type stripping:
 *
 *   node --test --experimental-strip-types tests/artex-client.smoke.ts
 *
 * They cover query rendering, token resolution, success/error mapping and the
 * main endpoints against an in-process mock ARTEX server. The dsh vitest suite
 * does not pick this file up (`.smoke.ts`, not `.test.ts`) because it relies on
 * `node:test`, which vitest does not emulate.
 * @module
 */

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { after, before, describe, it } from 'node:test'
import { ArtexClient, ArtexRequestError } from '../src/client.ts'

describe('queryString (via client paths)', () => {
  it('skips undefined params and encodes values', async () => {
    const seen: string[] = []
    const server = await startMock((req, res) => {
      seen.push(req.url ?? '')
      res.setHeader('Content-Type', 'application/json')
      res.end('{}')
    })
    try {
      const client = new ArtexClient({ baseUrl: server.base, timeoutMs: 2000 })
      await client.listTasks({ status: 'running', limit: 5, cursor: undefined })
      assert.equal(seen.at(-1), '/api/tasks?status=running&limit=5')
    } finally {
      server.close()
    }
  })

  it('omits the query string entirely when no params are given', async () => {
    const seen: string[] = []
    const server = await startMock((req, res) => {
      seen.push(req.url ?? '')
      res.end('{}')
    })
    try {
      const client = new ArtexClient({ baseUrl: server.base, timeoutMs: 2000 })
      await client.listAssets()
      assert.equal(seen.at(-1), '/api/assets')
    } finally {
      server.close()
    }
  })
})

describe('token resolution', () => {
  it('sends the literal token as a Bearer header', async () => {
    let auth = ''
    const server = await startMock((req, res) => {
      auth = req.headers.authorization ?? ''
      res.end('{}')
    })
    try {
      const client = new ArtexClient({ baseUrl: server.base, token: 'tok-1', tokenEnv: 'MISSING_VAR', timeoutMs: 2000 })
      await client.status()
      assert.equal(auth, 'Bearer tok-1')
    } finally {
      server.close()
    }
  })

  it('falls back to the configured environment variable', async () => {
    let auth = ''
    const server = await startMock((req, res) => {
      auth = req.headers.authorization ?? ''
      res.end('{}')
    })
    process.env.ARTEx_SMOKE_TOKEN = 'tok-env'
    try {
      const client = new ArtexClient({ baseUrl: server.base, tokenEnv: 'ARTEx_SMOKE_TOKEN', timeoutMs: 2000 })
      await client.status()
      assert.equal(auth, 'Bearer tok-env')
    } finally {
      delete process.env.ARTEx_SMOKE_TOKEN
      server.close()
    }
  })

  it('stays anonymous without token or env', async () => {
    let auth: string | undefined
    const server = await startMock((req, res) => {
      auth = req.headers.authorization
      res.end('{}')
    })
    try {
      const client = new ArtexClient({ baseUrl: server.base, tokenEnv: 'MISSING_VAR', timeoutMs: 2000 })
      await client.status()
      assert.equal(auth, undefined)
    } finally {
      server.close()
    }
  })
})

describe('endpoint mapping', () => {
  let server: MockServer
  let client: ArtexClient

  before(() => {
    return (async () => {
      const seen: string[] = []
      const bodies: unknown[] = []
      server = await startMock((req, res) => {
        seen.push(`${req.method} ${req.url}`)
        if (req.method === 'POST') {
          let raw = ''
          req.on('data', chunk => { raw += chunk })
          req.on('end', () => {
            bodies.push(JSON.parse(raw || '{}'))
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ id: 7, description: bodies.at(-1) }))
          })
          return
        }
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ items: [], url: req.url }))
      })
      client = new ArtexClient({ baseUrl: server.base, tokenEnv: 'MISSING_VAR', timeoutMs: 2000 })
      ;(client as unknown as { __seen: string[] }).__seen = seen
    })()
  })

  after(() => server.close())

  it('maps task, findings, assets, activity, agents and llm routes', async () => {
    await client.getTask(7)
    await client.listFindings('9')
    await client.listActivity()
    await client.listAgents()
    await client.listLlmProfiles()
    await client.listConversations()
    const seen = (client as unknown as { __seen: string[] }).__seen
    assert.ok(seen.includes('GET /api/tasks/7'))
    assert.ok(seen.includes('GET /api/exploration/findings?taskId=9'))
    assert.ok(seen.includes('GET /api/exploration/activity'))
    assert.ok(seen.includes('GET /api/agents'))
    assert.ok(seen.includes('GET /api/llm/profiles'))
    assert.ok(seen.includes('GET /api/conversations'))
  })

  it('creates tasks with the documented payload', async () => {
    const created = await client.createTask({ description: 'target demo', llmProfileIds: [1], timeoutSeconds: 600 })
    assert.deepEqual(created, { id: 7, description: { description: 'target demo', llmProfileIds: [1], timeoutSeconds: 600 } })
  })

  it('maps API errors to ArtexRequestError with the status', async () => {
    const errorServer = await startMock((_req, res) => {
      res.statusCode = 401
      res.end('unauthorized')
    })
    try {
      const errorClient = new ArtexClient({ baseUrl: errorServer.base, tokenEnv: 'MISSING_VAR', timeoutMs: 2000 })
      await assert.rejects(() => errorClient.status(), (error: unknown) => {
        assert.ok(error instanceof ArtexRequestError)
        assert.equal(error.status, 401)
        assert.match(error.message, /HTTP 401/)
        return true
      })
    } finally {
      errorServer.close()
    }
  })

  it('maps transport failures to ArtexRequestError with status 0', async () => {
    const offline = new ArtexClient({ baseUrl: 'http://127.0.0.1:9', timeoutMs: 1500 })
    await assert.rejects(() => offline.status(), (error: unknown) => {
      assert.ok(error instanceof ArtexRequestError)
      assert.equal(error.status, 0)
      return true
    })
  })
})

interface MockServer {
  base: string
  close: () => void
}

/**
 * Start one in-process HTTP server for the smoke tests.
 * @param handler - request handler writing the response.
 * @returns the bound base URL and a close handle.
 */
function startMock(handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void): Promise<MockServer> {
  const server: Server = createServer(handler)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () => server.close(),
      })
    })
  })
}
