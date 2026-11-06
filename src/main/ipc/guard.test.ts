import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { guardHandler, isShellEvent } from './guard'

const APP = 'file:///C:/app/out/renderer/index.html'
const shell = { id: 1, mainFrame: { id: 'main', url: APP } }
const other = { id: 2, mainFrame: { id: 'm2', url: APP } }

describe('isShellEvent', () => {
  it('accepts the shell main frame', () => {
    expect(isShellEvent({ sender: shell, senderFrame: shell.mainFrame }, shell, APP)).toBe(true)
  })
  it('rejects another webContents', () => {
    expect(isShellEvent({ sender: other, senderFrame: other.mainFrame }, shell, APP)).toBe(false)
  })
  it('rejects a sub-frame of the shell', () => {
    expect(isShellEvent({ sender: shell, senderFrame: { id: 'iframe', url: APP } }, shell, APP)).toBe(false)
  })
  it('rejects the shell main frame once it has been navigated to another site', () => {
    const hijacked = { id: 1, mainFrame: { id: 'main', url: 'https://evil.example/' } }
    expect(isShellEvent({ sender: hijacked, senderFrame: hijacked.mainFrame }, hijacked, APP)).toBe(false)
  })
  it('ignores the hash and query when matching the app URL', () => {
    const s2 = { id: 1, mainFrame: { id: 'main', url: APP + '?a=1#x' } }
    expect(isShellEvent({ sender: s2, senderFrame: s2.mainFrame }, s2, APP)).toBe(true)
  })
  it('trusts http://localhost:5173/ when appUrl is http://localhost:5173 (dev server)', () => {
    const dev = { mainFrame: { url: 'http://localhost:5173/' } }
    expect(isShellEvent({ sender: dev, senderFrame: dev.mainFrame }, dev, 'http://localhost:5173')).toBe(true)
  })
  it('still rejects a different path, origin or port', () => {
    for (const url of ['http://localhost:5173/evil', 'http://localhost:5174/', 'http://127.0.0.1:5173/', 'https://localhost:5173/']) {
      const s = { mainFrame: { url } }
      expect(isShellEvent({ sender: s, senderFrame: s.mainFrame }, s, 'http://localhost:5173')).toBe(false)
    }
  })
  it('rejects an unparseable frame URL', () => {
    const s = { mainFrame: { url: 'not a url' } }
    expect(isShellEvent({ sender: s, senderFrame: s.mainFrame }, s, APP)).toBe(false)
  })
  it('rejects a missing frame', () => {
    expect(isShellEvent({ sender: shell, senderFrame: null }, shell, APP)).toBe(false)
  })
})

describe('guardHandler', () => {
  const schema = z.strictObject({ n: z.number().int() })
  const trusted = () => true

  it('passes valid payloads from trusted senders', () => {
    const fn = vi.fn().mockReturnValue('ok')
    const h = guardHandler({ schema, isTrusted: trusted, fn, onReject: vi.fn() })
    expect(h({}, { n: 1 })).toBe('ok')
    expect(fn).toHaveBeenCalledWith({ n: 1 })
  })

  it('rejects untrusted senders without calling fn', () => {
    const fn = vi.fn()
    const onReject = vi.fn()
    const h = guardHandler({ schema, isTrusted: () => false, fn, onReject })
    expect(h({}, { n: 1 })).toBeUndefined()
    expect(fn).not.toHaveBeenCalled()
    expect(onReject).toHaveBeenCalledWith('untrusted sender')
  })

  it('rejects invalid payloads and does not throw', () => {
    const fn = vi.fn()
    const onReject = vi.fn()
    const h = guardHandler({ schema, isTrusted: trusted, fn, onReject })
    expect(() => h({}, { n: 'x' })).not.toThrow()
    expect(h({}, { n: 1, extra: 1 })).toBeUndefined()
    expect(fn).not.toHaveBeenCalled()
    expect(onReject).toHaveBeenCalledTimes(2)
  })

  it('contains errors thrown by fn', () => {
    const onReject = vi.fn()
    const h = guardHandler({
      schema, isTrusted: trusted, onReject,
      fn: () => {
        throw new Error('boom')
      }
    })
    expect(h({}, { n: 1 })).toBeUndefined()
    expect(onReject).toHaveBeenCalledWith('handler failed: boom')
  })
})
