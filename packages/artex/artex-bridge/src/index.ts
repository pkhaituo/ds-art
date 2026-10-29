/**
 * ARTEX bridge plugin: exposes the AI autonomous penetration-testing capabilities of
 * `extensions/artex` (vendored from RuoJi6/ARTEX, AGPL-3.0) as model-facing tools on
 * `ctx.tools`. The bridge talks to the ARTEX Go server over its REST API, so the
 * vendored module stays fully isolated from the Harness build: no Go toolchain, no
 * pnpm workspace entry, no runtime coupling — only an HTTP base URL.
 * @module @deepseek-ai/dsh-artex-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  ARTEX_DEFAULT_BASE_URL, ARTEX_DEFAULT_TOKEN_ENV, ArtexClient, ArtexRequestError,
} from './client.ts'

export { ARTEX_DEFAULT_BASE_URL, ARTEX_DEFAULT_TOKEN_ENV, ArtexClient, ArtexRequestError } from './client.ts'
export type {
  ArtexAsset, ArtexClientOptions, ArtexCreateTaskInput, ArtexFinding, ArtexTask,
} from './client.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'artex-bridge'

/** The tool registry seam every bridge tool registers into. */
export const inject = ['tools']

/** Bridge configuration read live on each tool call. */
export interface Config {
  /** ARTEX server base URL; defaults to the local `artex` server address. */
  baseURL: Volatile<string>
  /** Literal bearer token; prefer {@link tokenEnv} so no secret enters configuration files. */
  token: Volatile<string | undefined>
  /** Credential reference resolved per call; defaults to `ARTEX_API_TOKEN`. */
  tokenEnv: Volatile<string>
  /** Per-request timeout in milliseconds. Defaults to 30000. */
  timeoutMs: Volatile<number>
}

export const Config: z<Config> = z.object({
  baseURL: z.string().default(ARTEX_DEFAULT_BASE_URL).volatile(),
  token: z.string().role('secret').volatile(),
  tokenEnv: z.string().role('credential-ref').default(ARTEX_DEFAULT_TOKEN_ENV).volatile(),
  timeoutMs: z.number().step(1).min(1000).default(30_000).volatile(),
})

/**
 * Normalize any thrown error into a concise model-facing message: ARTEX errors keep
 * their HTTP context, unknown errors collapse to their message.
 * @param error - the caught value.
 * @returns one-line error text.
 */
function errorText(error: unknown): string {
  if (error instanceof ArtexRequestError) return error.message
  return error instanceof Error ? error.message : String(error)
}

/**
 * Wrap one client call into the canonical bridge tool result.
 * @param run - the client call to perform.
 * @returns `{ ok: true, result: <json text> }` or `{ ok: false, result: <error> }`.
 */
async function runTool(run: () => Promise<unknown>): Promise<{ ok: boolean; result: string }> {
  try {
    const value = await run()
    return { ok: true, result: JSON.stringify(value, null, 2) }
  } catch (error) {
    return { ok: false, result: errorText(error) }
  }
}

/** Shared output schema: every bridge tool answers one JSON text payload plus ok flag. */
const bridgeOutput = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true, description: 'Whether the ARTEX API call succeeded.' },
    result: { type: 'string', required: true, description: 'JSON response body, or the error message when ok is false.' },
  },
} as const

/**
 * Register the ARTEX bridge tools on `ctx.tools`.
 *
 * Tools: `artex_status`, `artex_task_list`, `artex_task_get`, `artex_task_create`,
 * `artex_findings`, `artex_assets`, `artex_activity`. All are read-only except
 * `artex_task_create`, which starts a new exploration mission on the ARTEX side.
 * @param ctx - plugin context owning the tool registrations.
 * @param config - live settings read once per tool call.
 */
export function apply(ctx: Context, config: Config): void {
  const client = () => new ArtexClient({
    baseUrl: config.baseURL.get(),
    token: config.token.get(),
    tokenEnv: config.tokenEnv.get(),
    timeoutMs: config.timeoutMs.get(),
  })

  ctx.tools.register(defineTool({
    name: 'artex_status',
    description: 'Check the ARTEX autonomous penetration-testing server: reachability, setup state and authentication. Call before using other artex_* tools.',
    parameters: {},
    output: { schema: bridgeOutput, render: (_args, value) => [{ type: 'text', text: value.result }] },
    isConcurrencySafe: () => true,
    execute: async () => runTool(() => client().status()),
  }))

  ctx.tools.register(defineTool({
    name: 'artex_task_list',
    description: 'List penetration-testing tasks known to the ARTEX server, with id, description and status for each.',
    parameters: {
      status: { type: 'string', description: 'Optional status filter, e.g. running or completed.' },
    },
    output: { schema: bridgeOutput, render: (_args, value) => [{ type: 'text', text: value.result }] },
    isConcurrencySafe: () => true,
    execute: async (args) => runTool(() => client().listTasks({ status: args.status })),
  }))

  ctx.tools.register(defineTool({
    name: 'artex_task_get',
    description: 'Fetch the full detail of one ARTEX task by id, including scope, goals and run state.',
    parameters: {
      id: { type: 'string', required: true, description: 'Task id as shown by artex_task_list.' },
    },
    output: { schema: bridgeOutput, render: (_args, value) => [{ type: 'text', text: value.result }] },
    isConcurrencySafe: () => true,
    execute: async (args) => runTool(() => client().getTask(args.id)),
  }))

  ctx.tools.register(defineTool({
    name: 'artex_task_create',
    description: 'Create a new ARTEX exploration task. The ARTEX agent plans and runs the mission autonomously; monitor progress with artex_activity, artex_findings and artex_assets.',
    parameters: {
      description: { type: 'string', required: true, description: 'Mission description: target scope, objectives and constraints in natural language.' },
      llmProfileIds: {
        type: 'array',
        description: 'Optional ARTEX LLM profile ids to use; omit to let the server default apply.',
        items: { type: 'integer' },
      },
      timeoutSeconds: { type: 'integer', description: 'Optional task timeout in seconds; 0 or omitted uses the server default.' },
    },
    output: { schema: bridgeOutput, render: (_args, value) => [{ type: 'text', text: value.result }] },
    isConcurrencySafe: () => false,
    execute: async (args) => runTool(() => client().createTask({
      description: args.description,
      llmProfileIds: args.llmProfileIds,
      timeoutSeconds: args.timeoutSeconds,
    })),
  }))

  ctx.tools.register(defineTool({
    name: 'artex_findings',
    description: 'List security findings discovered by ARTEX explorations, optionally scoped to one task.',
    parameters: {
      taskId: { type: 'string', description: 'Optional task id to scope the findings list.' },
    },
    output: { schema: bridgeOutput, render: (_args, value) => [{ type: 'text', text: value.result }] },
    isConcurrencySafe: () => true,
    execute: async (args) => runTool(() => client().listFindings(args.taskId)),
  }))

  ctx.tools.register(defineTool({
    name: 'artex_assets',
    description: 'List assets (domains, subdomains, IPs, ports, sites) tracked by ARTEX, optionally filtered by query.',
    parameters: {
      taskId: { type: 'string', description: 'Optional task id to scope the asset list.' },
    },
    output: { schema: bridgeOutput, render: (_args, value) => [{ type: 'text', text: value.result }] },
    isConcurrencySafe: () => true,
    execute: async (args) => runTool(() => client().listAssets(args.taskId === undefined ? undefined : { taskId: args.taskId })),
  }))

  ctx.tools.register(defineTool({
    name: 'artex_activity',
    description: 'Show the recent exploration activity stream (agent steps, tool calls) from ARTEX, optionally scoped to one task.',
    parameters: {
      taskId: { type: 'string', description: 'Optional task id to scope the activity feed.' },
    },
    output: { schema: bridgeOutput, render: (_args, value) => [{ type: 'text', text: value.result }] },
    isConcurrencySafe: () => true,
    execute: async (args) => runTool(() => client().listActivity(args.taskId === undefined ? undefined : { taskId: args.taskId })),
  }))
}
