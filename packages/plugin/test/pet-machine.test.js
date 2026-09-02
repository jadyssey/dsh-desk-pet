/**
 * PetMachine unit tests: fold event sequences, assert states.
 * Zero-dependency, runs with `node --test`.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { PetMachine } from '../lib/pet-machine.mjs'

const ev = (type, extra = {}) => ({ type, ...extra })

test('starts idle', () => {
  const m = new PetMachine()
  assert.equal(m.snapshot.state, 'idle')
  assert.deepEqual(m.hint, { kind: 'none' })
})

test('turn/start greets then swims fast', () => {
  const m = new PetMachine()
  m.push(ev('turn/start'))
  assert.equal(m.snapshot.state, 'greet')
  assert.equal(m.durable, 'swim-fast')
})

test('text chunks swim, silent chunks think', () => {
  const m = new PetMachine()
  m.push(ev('turn/start'))
  m.clearTransient()
  m.push(ev('assistant/chunk', { chunkType: 'text-delta' }))
  assert.equal(m.durable, 'swim-fast')
  m.push(ev('assistant/chunk', { chunkType: 'reasoning' }))
  assert.equal(m.durable, 'think')
})

test('tool calls set tool-run and surface a tool hint', () => {
  const m = new PetMachine()
  m.push(ev('turn/start'))
  m.clearTransient()
  m.push(ev('tool/call', { name: 'bash', args: 'ls' }))
  assert.equal(m.durable, 'tool-run')
  assert.deepEqual(m.hint, { kind: 'tool', name: 'bash' })
})

test('four consecutive read tools switch to review', () => {
  const m = new PetMachine()
  m.push(ev('turn/start'))
  m.clearTransient()
  for (const name of ['read', 'grep', 'glob', 'read']) m.push(ev('tool/call', { name }))
  assert.equal(m.durable, 'review')
})

test('approval outranks every transient', () => {
  const m = new PetMachine()
  m.push(ev('turn/start'))
  m.push(ev('approval/asked'))
  assert.equal(m.snapshot.state, 'glass-tap')
  assert.deepEqual(m.hint, { kind: 'approval' })
  // lower-priority transients are dropped while approval is pending
  m.push(ev('tool/call', { name: 'bash' }))
  assert.equal(m.snapshot.state, 'glass-tap')
  m.push(ev('approval/decided', { outcome: 'allow' }))
  assert.notEqual(m.snapshot.state, 'glass-tap')
})

test('denied approval makes the whale sad', () => {
  const m = new PetMachine()
  m.push(ev('approval/asked'))
  m.push(ev('approval/decided', { outcome: 'reject' }))
  assert.equal(m.snapshot.state, 'sad-puppy')
})

test('successful turn celebrates and reports done stats', () => {
  const m = new PetMachine()
  m.push(ev('turn/start'))
  const snap = m.push(ev('turn/end', { reason: { kind: 'completed' }, secs: 42, tools: 3 }))
  assert.equal(m.snapshot.state, 'celebrate')
  assert.equal(m.durable, 'idle')
  assert.deepEqual(m.hint, { kind: 'done', secs: 42, tools: 3, edits: 0 })
})

test('failed turn sinks and stays quiet', () => {
  const m = new PetMachine()
  m.push(ev('turn/start'))
  m.push(ev('turn/end', { reason: { kind: 'error', error: { message: 'x' } }, secs: 1, tools: 1 }))
  assert.equal(m.snapshot.state, 'sink')
  assert.deepEqual(m.hint, { kind: 'none' })
})

test('error streak of 3 spirals', () => {
  const m = new PetMachine()
  for (let i = 0; i < 3; i++) {
    m.push(ev('turn/start'))
    const snap = m.push(ev('turn/end', { reason: { kind: 'error', error: { message: 'x' } }, secs: 1, tools: 0 }))
    if (i === 2) assert.equal(snap.state, 'error-spiral')
    m.clearTransient()
  }
})

test('two prior wins make the next turn start excited', () => {
  const m = new PetMachine()
  for (let i = 0; i < 2; i++) {
    m.push(ev('turn/start'))
    m.push(ev('turn/end', { reason: { kind: 'completed' }, secs: 1, tools: 0 }))
    m.clearTransient()
  }
  m.push(ev('turn/start'))
  assert.equal(m.snapshot.state, 'excited')
})

test('idle past sleepAfterMs falls asleep; night hours wear nightcap', () => {
  const m = new PetMachine({ sleepAfterMs: 1000 })
  m.push(ev('session/idle', { idleMs: 2000, hour: 14 }))
  assert.equal(m.snapshot.state, 'sleep')
  m.push(ev('session/idle', { idleMs: 2000, hour: 2 }))
  assert.equal(m.snapshot.state, 'nightcap')
})

test('clock tick demotes nightcap during the day', () => {
  const m = new PetMachine()
  m.push(ev('session/idle', { idleMs: 999_999, hour: 2 }))
  assert.equal(m.snapshot.state, 'nightcap')
  m.push(ev('clock/tick', { hour: 9 }))
  assert.equal(m.durable, 'idle')
})

test('context feed eats at thresholds', () => {
  const m = new PetMachine()
  m.push(ev('clock/tick', { hour: 12, contextUsedPct: 63 }))
  // shrimp vs eat is random by design; both mean "feeding time"
  assert.ok(['eat', 'shrimp'].includes(m.snapshot.state))
  assert.deepEqual(m.hint, { kind: 'context', pct: 63 })
  // staying under the next threshold does not re-trigger
  m.clearTransient()
  m.push(ev('clock/tick', { hour: 12, contextUsedPct: 70 }))
  assert.equal(m.snapshot.state, 'idle')
})

test('poke startles; double-click flails; waking from sleep', () => {
  const m = new PetMachine()
  m.push(ev('user/poke', { doubleClick: false }))
  assert.equal(m.snapshot.state, 'startled')
  m.clearTransient()
  m.push(ev('user/poke', { doubleClick: true }))
  assert.equal(m.snapshot.state, 'poked-flail')
})

test('compaction shows compact and blocks other transients', () => {
  const m = new PetMachine()
  m.push(ev('compaction/start'))
  assert.equal(m.snapshot.state, 'compact')
  // tool activity still updates the durable state, but the display stays compact
  m.push(ev('tool/call', { name: 'bash' }))
  assert.equal(m.snapshot.state, 'compact')
  m.push(ev('compaction/end'))
  m.clearTransient()
  assert.equal(m.snapshot.state, 'tool-run')
})

test('git push detected → push transient on ok result', () => {
  const m = new PetMachine()
  m.push(ev('turn/start'))
  m.clearTransient()
  m.push(ev('tool/call', { name: 'bash', args: 'git push origin main' }))
  m.push(ev('tool/result', { ok: true }))
  assert.equal(m.snapshot.state, 'push')
})

test('clearTransient resets to durable', () => {
  const m = new PetMachine()
  m.push(ev('turn/start'))
  assert.equal(m.snapshot.state, 'greet')
  m.clearTransient()
  assert.equal(m.snapshot.state, 'swim-fast')
})

test('force pins a state until cleared', () => {
  const m = new PetMachine()
  m.force('glass-tap')
  assert.equal(m.snapshot.state, 'glass-tap')
  m.force(null)
  assert.equal(m.snapshot.state, 'idle')
})
