# ARTEX Extension Module Integration Guide

This repository (ds-art, whose body is DeepSeek Harness) fully integrates [ARTEX](https://github.com/RuoJi6/ARTEX) — an AI autonomous penetration-testing system — as a **feature extension module**. The guiding principle: **the ds-art architecture is the body; ARTEX is a detachable feature module**, fully isolated at the build, dependency, and runtime layers.

## Integration layout

```
extensions/artex/              ← complete ARTEX source (Go backend + Next.js frontend + skills)
  ├─ cmd/artex/                ← Go server entry (REST API + static assets)
  ├─ agent/ server/ db/ llmpool/ mcphttp/ traffic/ intercept/ …
  ├─ web/                      ← Next.js frontend (npm, independent of the pnpm workspace)
  ├─ skills/                   ← api-recon / scopesentry / playwright-cli (SKILL.md format)
  ├─ LICENSE                   ← original AGPL-3.0 license, preserved verbatim
  └─ README.md                 ← ARTEX's own documentation
packages/artex/artex-bridge/   ← dsh bridge plugin (@deepseek-ai/dsh-artex-bridge, MIT)
  ├─ src/client.ts             ← zero-dependency ARTEX REST client
  ├─ src/index.ts              ← Cordis plugin: registers 7 artex_* tools on ctx.tools
  └─ tests/artex-client.smoke.ts ← node:test smoke tests
scripts/artex.mjs              ← cross-platform build/test dispatcher
```

## Isolation design

| Dimension | Approach |
| --- | --- |
| Package management | `extensions/` is not in `pnpm-workspace.yaml`; ARTEX takes no part in dsh install/build/lint/typecheck |
| Language & toolchain | ARTEX needs Go ≥ 1.26 and npm (only for its own builds); the dsh build path never depends on Go |
| Licensing | ARTEX is AGPL-3.0 with its `LICENSE` preserved in `extensions/artex/`; the dsh body remains MIT |
| Runtime | The bridge only speaks HTTP (default `http://127.0.0.1:8787`); both sides start and stop independently |
| Build outputs | `.gitignore` excludes `extensions/artex/bin/`, `web/.next/`, `config.json`, etc. |

## Build and run

```sh
# Verify toolchains
pnpm run artex:check

# Compile the Go backend (outputs to extensions/artex/bin/)
pnpm run artex:build

# Run the ARTEX Go test suite
pnpm run artex:test

# ARTEX web frontend
pnpm run artex:web:install
pnpm run artex:web:build
pnpm run artex:web:dev
```

Equivalent Make targets: `make artex-build` / `artex-test` / `artex-web-install` / `artex-web-build`.

ARTEX's own Docker path also works: `cd extensions/artex && docker compose up -d`.

After the first start, open `http://localhost:8787/setup` to initialize the admin account; exploration tasks require an LLM configured in the ARTEX UI (or `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`).

## Using ARTEX from dsh agents

`@deepseek-ai/dsh-artex-bridge` is a standard Cordis plugin (`inject: ['tools']`); once mounted by the plugin loader like any other tool plugin it registers on `ctx.tools`:

| Tool | Purpose |
| --- | --- |
| `artex_status` | Check ARTEX server reachability and auth state |
| `artex_task_list` / `artex_task_get` | Inspect penetration-testing tasks |
| `artex_task_create` | Start a new autonomous exploration task |
| `artex_findings` | Read security findings |
| `artex_assets` | Read tracked assets (domains, subdomains, IPs, ports, sites) |
| `artex_activity` | Follow the exploration activity stream |

Configuration: `baseURL` (default `http://127.0.0.1:8787`), `token`/`tokenEnv` (Bearer credential, default env `ARTEX_API_TOKEN`), `timeoutMs`.

ARTEX's three bundled agent skills (`extensions/artex/skills/`) use the standard `SKILL.md` format and load directly through the dsh skill system.

## Testing

```sh
# Bridge plugin smoke tests (no dependency install needed)
pnpm run artex:bridge:test

# Full ARTEX Go test suite
pnpm run artex:test
```

## Safety notice

ARTEX is a real penetration-testing tool. Only use it against targets you have explicit written authorization to test, and comply with applicable laws. See the root [SAFETY.md](../SAFETY.md).
