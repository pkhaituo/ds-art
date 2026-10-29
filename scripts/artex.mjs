#!/usr/bin/env node
/**
 * ARTEX extension module build/run dispatcher.
 *
 * The ARTEX module (extensions/artex, vendored from RuoJi6/ARTEX) is a Go
 * backend + Next.js frontend that stays fully isolated from the pnpm
 * workspace. This dispatcher gives the repository root convenient,
 * cross-platform entry points without adding Go toolchain dependencies to
 * any Harness build path.
 *
 * Usage: node scripts/artex.mjs <command>
 * Commands:
 *   build        Compile the Go backend into extensions/artex/bin/ (needs Go >= 1.26)
 *   test         Run the Go test suite of the ARTEX module
 *   web-install  Install the ARTEX web frontend dependencies (npm)
 *   web-build    Build the ARTEX web frontend (npm run build)
 *   web-dev      Start the ARTEX web frontend dev server
 *   check        Verify the required toolchains (go, npm) are available
 */

import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const artexDir = path.join(root, 'extensions', 'artex')
const binDir = path.join(artexDir, 'bin')

const usage = (code) => {
  console.error('Usage: node scripts/artex.mjs <build|test|web-install|web-build|web-dev|check>')
  process.exit(code)
}

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: options.cwd ?? artexDir,
    shell: process.platform === 'win32',
  })
  return result.status ?? 1
}

const TOOL_PROBE_ARGS = { go: ['version'], npm: ['--version'] }

const ensureTool = (command, hint) => {
  const probe = spawnSync(command, TOOL_PROBE_ARGS[command] ?? ['--version'], {
    shell: process.platform === 'win32',
    encoding: 'utf8',
  })
  if (probe.error || probe.status !== 0) {
    console.error(`[artex] missing toolchain: '${command}' not available. ${hint}`)
    process.exit(1)
  }
}

const command = process.argv[2]
switch (command) {
  case 'build': {
    ensureTool('go', 'Install Go >= 1.26 from https://go.dev/dl/')
    const output = path.join(binDir, process.platform === 'win32' ? 'artex.exe' : 'artex')
    process.exit(run('go', ['build', '-o', output, './cmd/artex']))
  }
  case 'test':
    ensureTool('go', 'Install Go >= 1.26 from https://go.dev/dl/')
    process.exit(run('go', ['test', './...']))
    break
  case 'web-install':
    ensureTool('npm', 'Node.js/npm is required for the ARTEX web frontend')
    process.exit(run('npm', ['install'], { cwd: path.join(artexDir, 'web') }))
    break
  case 'web-build':
    ensureTool('npm', 'Node.js/npm is required for the ARTEX web frontend')
    process.exit(run('npm', ['run', 'build'], { cwd: path.join(artexDir, 'web') }))
    break
  case 'web-dev':
    ensureTool('npm', 'Node.js/npm is required for the ARTEX web frontend')
    process.exit(run('npm', ['run', 'dev'], { cwd: path.join(artexDir, 'web') }))
    break
  case 'check':
    ensureTool('go', 'Install Go >= 1.26 from https://go.dev/dl/')
    ensureTool('npm', 'Node.js/npm is required for the ARTEX web frontend')
    console.log('[artex] toolchains OK: go + npm available')
    process.exit(0)
    break
  default:
    usage(command === undefined ? 0 : 1)
}
