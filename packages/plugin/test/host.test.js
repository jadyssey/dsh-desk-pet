/**
 * Host-half unit tests: route registration, state snapshot, assets path
 * traversal protection, launch-route behavior. Runs with `node --test`.
 * The plugin module is imported once; apply() is invoked with a mocked ctx
 * and HOME pointed at an empty temp dir so no real binary/pid file leaks in.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../lib/index.js'

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pet-home-'))
process.env.HOME = HOME

/** Minimal http res double; supports being a stream pipe destination. */
const mockRes = () => {
  const res = {
    code: 0,
    headers: {},
    body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers },
    end(body) { this.body = body ?? this.body ?? '' },
    write(chunk) { this.body += chunk.toString(); return true },
    on() { return this },
    once() { return this },
    emit() { return true },
  }
  return res
}

/** Mock DSH plugin context: records registered routes and effects. */
function mockCtx() {
  const routes = new Map() // path -> handler
  return {
    routes,
    webServer: {
      register({ path: p, handler }) {
        routes.set(p, handler)
        return () => routes.delete(p)
      },
    },
    on() {},
    effect(fn) { this._dispose = fn() },
    logger: { warns: [], warn(msg) { this.warns.push(msg) } },
  }
}

const ctx = mockCtx()
apply(ctx, { autostart: false })

// The plugin registers a 15s clock interval; dispose it so the test run exits.
test.after(() => { ctx._dispose?.() })

test('registers the three pet routes', () => {
  assert.ok(ctx.routes.has('/dsh-desk-pet/state'))
  assert.ok(ctx.routes.has('/dsh-desk-pet/launch'))
  assert.ok(ctx.routes.has('/dsh-desk-pet/assets'))
})

test('state route returns a snapshot', async () => {
  const handler = ctx.routes.get('/dsh-desk-pet/state')
  const res = mockRes()
  handler({}, res)
  assert.equal(res.code, 200)
  assert.match(res.headers['content-type'], /application\/json/)
  const body = JSON.parse(res.body)
  assert.equal(body.state, 'idle')
  assert.deepEqual(body.hint, { kind: 'none' })
  assert.equal(typeof body.t, 'number')
})

test('assets route serves the manifest', async () => {
  const handler = ctx.routes.get('/dsh-desk-pet/assets')
  const res = mockRes()
  await new Promise((resolve) => {
    res.end = function (body) { if (body) this.body += body; resolve() }
    handler({ url: '/dsh-desk-pet/assets/manifest.json' }, res)
  })
  assert.equal(res.code, 200)
  assert.equal(res.headers['content-type'], 'application/json')
  const manifest = JSON.parse(res.body)
  assert.equal(manifest.idle, 'idle.gif')
})

test('assets route rejects path traversal', async () => {
  const handler = ctx.routes.get('/dsh-desk-pet/assets')
  for (const url of [
    '/dsh-desk-pet/assets/../../../etc/passwd',
    '/dsh-desk-pet/assets/%2e%2e%2f%2e%2e/etc/passwd',
    '/dsh-desk-pet/assets/..%2f..%2fpackage.json',
  ]) {
    const res = mockRes()
    await new Promise((resolve) => {
      res.end = function (body) { this.body = body ?? ''; resolve() }
      handler({ url }, res)
    })
    assert.ok([403, 404].includes(res.code), `expected 403/404 for ${url}, got ${res.code}`)
  }
})

test('assets route rejects non-prefixed paths', async () => {
  const handler = ctx.routes.get('/dsh-desk-pet/assets')
  const res = mockRes()
  handler({ url: '/other/path' }, res)
  assert.equal(res.code, 400)
})

test('launch route rejects GET', async () => {
  const handler = ctx.routes.get('/dsh-desk-pet/launch')
  const res = mockRes()
  await handler({ method: 'GET' }, res)
  assert.equal(res.code, 405)
})

test('launch route reports a missing binary with an install hint', async () => {
  const handler = ctx.routes.get('/dsh-desk-pet/launch')
  const res = mockRes()
  await handler({ method: 'POST' }, res)
  const body = JSON.parse(res.body)
  // HOME is an empty temp dir: no platform package, no package-local or
  // manual binary — resolution must fail with an actionable message.
  assert.equal(res.code, 404)
  assert.match(body.error, /desktop binary not found/)
  assert.match(body.error, /@dsh-desk-pet\//)
})
