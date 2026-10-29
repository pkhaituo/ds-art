/**
 * Minimal HTTP client for the ARTEX server REST API (extensions/artex).
 *
 * Zero-dependency by design: uses the global `fetch` available in every
 * Node.js runtime supported by DeepSeek Harness. Kept free of
 * type-stripping-incompatible syntax (no enums, no namespaces, no
 * parameter properties) so `node --test --experimental-strip-types`
 * can execute the smoke tests directly from source.
 * @module
 */

/** Where the ARTEX server listens; matches extensions/artex default. */
export const ARTEX_DEFAULT_BASE_URL = 'http://127.0.0.1:8787'

/** Credential reference environment variable read when no literal token is set. */
export const ARTEX_DEFAULT_TOKEN_ENV = 'ARTEX_API_TOKEN'

/** Connection and request timeout applied to every ARTEX call. */
export const ARTEX_DEFAULT_TIMEOUT_MS = 30_000

/** Options for constructing an {@link ArtexClient}. */
export interface ArtexClientOptions {
  /** API base including any path prefix; defaults to {@link ARTEX_DEFAULT_BASE_URL}. */
  baseUrl?: string
  /** Literal bearer token; when absent the client falls back to `tokenEnv`. */
  token?: string
  /** Environment variable holding the bearer token; defaults to {@link ARTEX_DEFAULT_TOKEN_ENV}. */
  tokenEnv?: string
  /** Per-request timeout in milliseconds; defaults to {@link ARTEX_DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number
}

/** One ARTEX task summary row as returned by `GET /api/tasks`. */
export interface ArtexTask {
  id: number | string
  description?: string
  status?: string
  [key: string]: unknown
}

/** One ARTEX finding as returned by `GET /api/exploration/findings`. */
export interface ArtexFinding {
  id: number | string
  [key: string]: unknown
}

/** One ARTEX asset as returned by `GET /api/assets`. */
export interface ArtexAsset {
  id: number | string
  [key: string]: unknown
}

/** Payload accepted by `POST /api/tasks`. */
export interface ArtexCreateTaskInput {
  /** Free-text mission description; the exploration agent plans from it. */
  description: string
  /** Optional LLM profile ids configured in the ARTEX UI. */
  llmProfileIds?: number[]
  /** Optional per-task timeout in seconds; 0 means use the server default. */
  timeoutSeconds?: number
}

/** Normalized client error carrying the HTTP status when the server answered. */
export class ArtexRequestError extends Error {
  /** HTTP status code, or 0 for transport-level failures (ECONNREFUSED, abort). */
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ArtexRequestError'
    this.status = status
  }
}

/**
 * Resolve the bearer token for one request: explicit token wins, then the
 * configured environment variable. Empty string means anonymous (the local
 * ARTEX server may run without auth before `/setup` initialization).
 * @param options - client options snapshot.
 * @returns the token to send, or '' for anonymous.
 */
function resolveToken(options: ArtexClientOptions): string {
  if (options.token !== undefined && options.token !== '') return options.token
  const envName = options.tokenEnv ?? ARTEX_DEFAULT_TOKEN_ENV
  const fromEnv = typeof process !== 'undefined' ? process.env?.[envName] : undefined
  return fromEnv ?? ''
}

/**
 * Thin REST client over the ARTEX HTTP API. Every method returns the parsed
 * JSON body; list endpoints also accept narrow typed wrappers below.
 */
export class ArtexClient {
  private readonly options: Required<Pick<ArtexClientOptions, 'baseUrl' | 'timeoutMs'>>
    & Pick<ArtexClientOptions, 'token' | 'tokenEnv'>

  constructor(options: ArtexClientOptions = {}) {
    this.options = {
      baseUrl: (options.baseUrl ?? ARTEX_DEFAULT_BASE_URL).replace(/\/+$/, ''),
      timeoutMs: options.timeoutMs ?? ARTEX_DEFAULT_TIMEOUT_MS,
      token: options.token,
      tokenEnv: options.tokenEnv,
    }
  }

  /**
   * Perform one JSON request against the ARTEX server.
   * @param method - HTTP method.
   * @param path - absolute API path starting with `/`.
   * @param body - optional JSON body.
   * @returns the parsed JSON response (any shape).
   */
  async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    const token = resolveToken(this.options)
    if (token !== '') headers.Authorization = `Bearer ${token}`
    const init: RequestInit = { method, headers, signal: AbortSignal.timeout(this.options.timeoutMs) }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    let response: Response
    try {
      response = await fetch(`${this.options.baseUrl}${path}`, init)
    } catch (cause) {
      throw new ArtexRequestError(
        `cannot reach ARTEX server at ${this.options.baseUrl}: ${(cause as Error).message}`,
        0,
      )
    }
    if (!response.ok) {
      let detail = ''
      try {
        const text = await response.text()
        detail = text.slice(0, 500)
      } catch {
        // body unreadable; keep detail empty
      }
      throw new ArtexRequestError(`ARTEX API ${method} ${path} failed: HTTP ${response.status} ${detail}`.trim(), response.status)
    }
    const text = await response.text()
    if (text === '') return {}
    try {
      return JSON.parse(text)
    } catch {
      return { raw: text }
    }
  }

  /** Server health and setup state via `GET /api/auth/status`. */
  async status(): Promise<unknown> {
    return this.request('GET', '/api/auth/status')
  }

  /** List tasks via `GET /api/tasks`; pass a filter object as query params. */
  async listTasks(query?: Record<string, string | number | undefined>): Promise<unknown> {
    return this.request('GET', `/api/tasks${queryString(query)}`)
  }

  /** Fetch one task by id via `GET /api/tasks/{id}`. */
  async getTask(id: string | number): Promise<unknown> {
    return this.request('GET', `/api/tasks/${encodeURIComponent(String(id))}`)
  }

  /**
   * Create an exploration task via `POST /api/tasks`.
   * @param input - mission description and optional profile/timeout overrides.
   * @returns the created task payload from the server.
   */
  async createTask(input: ArtexCreateTaskInput): Promise<unknown> {
    const body: Record<string, unknown> = { description: input.description }
    if (input.llmProfileIds !== undefined && input.llmProfileIds.length > 0) body.llmProfileIds = input.llmProfileIds
    if (input.timeoutSeconds !== undefined) body.timeoutSeconds = input.timeoutSeconds
    return this.request('POST', '/api/tasks', body)
  }

  /** List findings via `GET /api/exploration/findings`, optionally scoped to a task. */
  async listFindings(taskId?: string | number, query?: Record<string, string | number | undefined>): Promise<unknown> {
    const merged = taskId === undefined ? query : { taskId, ...query }
    return this.request('GET', `/api/exploration/findings${queryString(merged)}`)
  }

  /** List assets via `GET /api/assets`, optionally scoped by query params. */
  async listAssets(query?: Record<string, string | number | undefined>): Promise<unknown> {
    return this.request('GET', `/api/assets${queryString(query)}`)
  }

  /** Recent exploration activity via `GET /api/exploration/activity`. */
  async listActivity(query?: Record<string, string | number | undefined>): Promise<unknown> {
    return this.request('GET', `/api/exploration/activity${queryString(query)}`)
  }

  /** List configured exploration agents via `GET /api/agents`. */
  async listAgents(): Promise<unknown> {
    return this.request('GET', '/api/agents')
  }

  /** List configured LLM profiles via `GET /api/llm/profiles`. */
  async listLlmProfiles(): Promise<unknown> {
    return this.request('GET', '/api/llm/profiles')
  }

  /** List conversations via `GET /api/conversations`. */
  async listConversations(query?: Record<string, string | number | undefined>): Promise<unknown> {
    return this.request('GET', `/api/conversations${queryString(query)}`)
  }

  /** Human-in-the-loop chat send via `POST /api/chat`. */
  async sendChat(body: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', '/api/chat', body)
  }
}

/**
 * Render query params, skipping undefined values.
 * @param query - optional scalar param map.
 * @returns `?a=1&b=x` or '' when no params survive.
 */
function queryString(query: Record<string, string | number | undefined> | undefined): string {
  if (query === undefined) return ''
  const pairs: string[] = []
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  }
  return pairs.length === 0 ? '' : `?${pairs.join('&')}`
}
