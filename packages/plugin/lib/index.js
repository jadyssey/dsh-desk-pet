/**
 * dsh-desk-pet host half.
 *
 * Owns the pet state machine, folds every durable DSH session event (turns,
 * chunks, tool calls, approvals) into it, and exposes a small HTTP surface on
 * the DSH web server for the native desktop pet (and optionally the web UI):
 *
 *   GET  /dsh-desk-pet/state   -> { state, hint } snapshot
 *   POST /dsh-desk-pet/launch  -> spawn the bundled native desktop pet binary
 *   GET  /dsh-desk-pet/assets/ -> sprite files from the package assets dir
 *
 * The native pet (a Tauri app, see ../../desktop in the monorepo) polls
 * /dsh-desk-pet/state and renders the matching sprite as a transparent,
 * always-on-top desktop window on Windows / macOS / Linux. It is spawned
 * automatically on plugin load (config: autostart, enabled, sleepAfterMinutes).
 * Zero intrusion: read-only on sessions.
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { PetMachine } from './pet-machine.mjs'

const require = createRequire(import.meta.url)

export const name = 'dsh-desk-pet'
export const inject = ['webServer']

const MIME = {
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json',
}

export function apply(ctx, config = {}) {
  // Kill switch for admins: nothing is served, and clients unmount on 404.
  if (config.enabled === false) return

  const machine = new PetMachine({ sleepAfterMs: (config.sleepAfterMinutes ?? 10) * 60_000 })
  let lastEventAt = Date.now()
  let turnStartedAt = 0
  let turnTools = 0
  let contextWindow = 0
  let lastUsageTotal = 0

  /** Map one durable session event onto the machine's input vocabulary. */
  const fold = (event) => {
    const data = event.data ?? {}
    switch (event.type) {
      case 'turn/start':
        turnStartedAt = Date.now()
        turnTools = 0
        return machine.push({ type: 'turn/start', turn: data.turn })
      case 'turn/end': {
        const secs = turnStartedAt ? Math.max(1, Math.round((Date.now() - turnStartedAt) / 1000)) : 0
        const done = { type: 'turn/end', turn: data.turn, reason: data.reason, secs, tools: turnTools }
        turnStartedAt = 0
        return machine.push(done)
      }
      case 'step/start':
        return machine.push({ type: 'step/start', turn: data.turn, step: data.step })
      case 'request/context':
        if (typeof data.contextWindow === 'number' && data.contextWindow > 0) contextWindow = data.contextWindow
        return undefined
      case 'assistant/message':
        if (data.usage && typeof data.usage.total_tokens === 'number') lastUsageTotal = data.usage.total_tokens
        return undefined
      case 'assistant/chunk':
        return machine.push({ type: 'assistant/chunk', turn: data.turn, step: data.step, chunkType: data.chunk?.type })
      case 'tool/call': {
        turnTools++
        return machine.push({
          type: 'tool/call', turn: data.turn, step: data.step, name: data.name,
          args: typeof data.args === 'string' ? data.args : JSON.stringify(data.args ?? ''),
        })
      }
      case 'tool/result':
        return machine.push({ type: 'tool/result', turn: data.turn, step: data.step, ok: data.ok !== false })
      case 'approval/asked':
        return machine.push({ type: 'approval/asked' })
      case 'approval/decided':
        return machine.push({ type: 'approval/decided', outcome: data.outcome })
      case 'compaction/start':
        return machine.push({ type: 'compaction/start' })
      case 'compaction/end':
        return machine.push({ type: 'compaction/end' })
      default:
        return undefined
    }
  }

  // Transient animations return to the durable state after their stage time.
  let stageTimer = null
  const STAGED_STATES = new Set(['celebrate', 'sink', 'poked-flail', 'startled', 'eat', 'greet'])
  const restage = () => {
    if (stageTimer !== null) clearTimeout(stageTimer)
    stageTimer = null
    if (STAGED_STATES.has(machine.snapshot.state)) {
      stageTimer = setTimeout(() => {
        stageTimer = null
        machine.clearTransient()
      }, 3000)
    }
  }

  ctx.on('session/event', (_session, event) => {
    lastEventAt = Date.now()
    fold(event)
    restage()
  })

  const timer = setInterval(() => {
    const now = new Date()
    const contextUsedPct = contextWindow > 0 && lastUsageTotal > 0
      ? Math.min(100, Math.round((100 * lastUsageTotal) / contextWindow))
      : undefined
    machine.push({
      type: 'clock/tick', hour: now.getHours(), contextUsedPct,
      today: String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0'),
    })
    machine.push({ type: 'session/idle', idleMs: Date.now() - lastEventAt, hour: now.getHours() })
    restage()
  }, 15_000)

  // Tauri webview (tauri://localhost) polls us from a different origin than
  // the DSH web server (http://127.0.0.1:3080). The host webserver does not
  // inject CORS for plugin routes, so without these headers webkit2gtk rejects
  // every response and the pet never leaves the idle sprite it loaded on boot.
  const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'Content-Type',
  }
  const sendJson = (res, code, body) => {
    res.writeHead(code, { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }

  const BODY_LIMIT = 16 * 1024

  const readBody = (req, res) =>
    new Promise((resolve) => {
      if (Number(req.headers['content-length'] ?? 0) > BODY_LIMIT) {
        sendJson(res, 413, { error: 'body too large' })
        resolve(null)
        return
      }
      let raw = ''
      let overflow = false
      req.on('data', (chunk) => {
        raw += chunk
        if (raw.length > BODY_LIMIT) {
          overflow = true
          raw = ''
        }
      })
      req.on('end', () => {
        if (overflow) {
          sendJson(res, 413, { error: 'body too large' })
          return resolve(null)
        }
        try { resolve(JSON.parse(raw || '{}')) } catch { resolve({}) }
      })
    })

  const assetsDir = fileURLToPath(new URL('../assets/', import.meta.url))
  const packageDir = fileURLToPath(new URL('../', import.meta.url))
  const manualDir = path.join(os.homedir(), '.dsh', 'desk-pet', 'desktop')
  const pidFile = path.join(manualDir, 'desktop.pid')

  const streamAsset = (resolved, stat, res) => {
    res.writeHead(200, {
      ...CORS,
      'content-type': MIME[path.extname(resolved).toLowerCase()] ?? 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': 'public, max-age=3600',
    })
    fs.createReadStream(resolved).pipe(res)
  }

  const serveAsset = (req, res) => {
    const prefix = '/dsh-desk-pet/assets/'
    if (!req.url || !req.url.startsWith(prefix)) return sendJson(res, 400, { error: 'bad path' })
    let rel
    try {
      rel = decodeURIComponent(req.url.slice(prefix.length).split('?')[0])
    } catch {
      return sendJson(res, 400, { error: 'bad path encoding' })
    }
    const base = assetsDir.endsWith(path.sep) ? assetsDir : assetsDir + path.sep
    const resolved = path.normalize(path.join(assetsDir, rel))
    if (!resolved.startsWith(base)) return sendJson(res, 403, { error: 'forbidden' })
    fs.stat(resolved, (err, stat) => {
      if (err || !stat.isFile()) return sendJson(res, 404, { error: 'not found' })
      streamAsset(resolved, stat, res)
    })
  }

  /**
   * Resolve the native desktop pet binary for the current platform.
   * Priority: npm platform package → package-local desktop/ → ~/.dsh manual dir.
   * Spawn form is always a raw binary (AppImage needs libfuse2 and fails silently
   * when detached-spawned; installers/zips are distribution artifacts only).
   */
  const resolveDesktopBinary = () => {
    const platform = process.platform
    const rawNames = platform === 'win32' ? ['desk-whale.exe'] : ['desk-whale']
    const platformPkg = `@jadyssey/${platform}-${process.arch}`
    const searchDirs = []
    // 1) npm platform package (esbuild-style optionalDependencies layout)
    try {
      const pkgJson = require.resolve(platformPkg + '/package.json')
      searchDirs.push(path.join(path.dirname(pkgJson), 'bin'))
    } catch { /* platform package not installed */ }
    // 2) package-local desktop/ (manual drop-in inside the installed plugin)
    searchDirs.push(path.join(packageDir, 'desktop'))
    // 3) user-wide manual location
    searchDirs.push(manualDir)
    for (const dir of searchDirs) {
      for (const name of rawNames) {
        const p = path.join(dir, name)
        try { if (fs.statSync(p).isFile()) return p } catch { /* keep looking */ }
      }
    }
    // macOS fallback: an .app bundle dropped into a search dir
    if (platform === 'darwin') {
      for (const dir of searchDirs) {
        const p = path.join(dir, 'Desk Whale.app', 'Contents', 'MacOS', 'desk-whale')
        try { if (fs.statSync(p).isFile()) return p } catch { /* keep looking */ }
      }
    }
    return null
  }

  /** True when a previously spawned pet process is still alive. */
  const petAlive = () => {
    try {
      const { pid } = JSON.parse(fs.readFileSync(pidFile, 'utf8'))
      if (typeof pid !== 'number') return false
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  const recordPid = (pid) => {
    try {
      fs.mkdirSync(manualDir, { recursive: true })
      fs.writeFileSync(pidFile, JSON.stringify({ pid, at: Date.now() }))
    } catch { /* best-effort */ }
  }

  /**
   * Spawn the native desktop pet. Shared by POST /dsh-desk-pet/launch and the
   * autostart hook. Detached: the pet outlives DSH. Returns an error string
   * on failure, null on success.
   */
  const launchPet = () => {
    if (petAlive()) return null // already running — single instance
    const exePath = resolveDesktopBinary()
    if (!exePath) {
      return 'desktop binary not found for ' + process.platform + '-' + process.arch +
        ' (install the @jadyssey/' + process.platform + '-' + process.arch +
        ' package, or place a binary in ' + manualDir + '/)'
    }
    try {
      // Linux: force XWayland. The webkit2gtk webview renders nothing under
      // native Wayland on some compositors (observed on KDE), while XWayland
      // works reliably.
      const linuxEnv = process.platform === 'linux' ? { GDK_BACKEND: 'x11' } : {}
      const env = { ...process.env, ...linuxEnv, WHALE_DSH_URL: `http://127.0.0.1:${process.env.PORT || 3080}` }
      const child = spawn(exePath, [], { detached: true, stdio: 'ignore', env })
      child.unref()
      recordPid(child.pid)
      return null
    } catch (error) {
      return 'failed to launch: ' + String(error?.message ?? error)
    }
  }

  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-desk-pet/state',
        handler: (_req, res) => {
          const stats = turnStartedAt
            ? { secs: Math.round((Date.now() - turnStartedAt) / 1000), tools: turnTools }
            : undefined
          const contextPct = contextWindow > 0 && lastUsageTotal > 0
            ? Math.min(100, Math.round((100 * lastUsageTotal) / contextWindow))
            : undefined
          sendJson(res, 200, { ...machine.snapshot, stats, contextPct, t: Date.now() })
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-desk-pet/launch',
        handler: async (req, res) => {
          if (req.method === 'OPTIONS') {
            res.writeHead(204, CORS)
            res.end()
            return
          }
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
          const error = launchPet()
          if (error) return sendJson(res, 404, { error })
          sendJson(res, 200, { launched: true })
        },
      }),
      ctx.webServer.register({ kind: 'prefix', path: '/dsh-desk-pet/assets', handler: serveAsset }),
    ]
    // Autostart: bring the pet up as soon as DSH starts, unless disabled.
    if (config.autostart !== false) {
      setImmediate(() => {
        if (petAlive()) return
        if (!resolveDesktopBinary()) {
          ctx.logger?.warn?.('[dsh-desk-pet] no native pet binary for this platform; skipping autostart. ' +
            'Install @jadyssey/' + process.platform + '-' + process.arch + ' or see the plugin README.')
          return
        }
        const error = launchPet()
        if (error) ctx.logger?.warn?.('[dsh-desk-pet] autostart failed: ' + error)
      })
    }
    return () => disposers.forEach((dispose) => dispose())
  })

  ctx.effect(() => () => {
    clearInterval(timer)
    if (stageTimer !== null) clearTimeout(stageTimer)
  })
}
