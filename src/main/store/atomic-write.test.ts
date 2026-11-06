import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PathLike } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { atomicWriteFile } from './atomic-write'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ns-atomic-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('atomicWriteFile', () => {
  it('writes the file and leaves no temp files', async () => {
    const f = join(dir, 'state.json')
    await atomicWriteFile(f, '{"a":1}')
    expect(await readFile(f, 'utf8')).toBe('{"a":1}')
    expect(await readdir(dir)).toEqual(['state.json'])
  })

  it('leaves an existing .bak untouched when the target is missing (after a bad file was moved aside)', async () => {
    const f = join(dir, 'state.json')
    await writeFile(`${f}.bak`, 'GOOD BACKUP')
    await atomicWriteFile(f, '{"new":1}')
    expect(await readFile(`${f}.bak`, 'utf8')).toBe('GOOD BACKUP')
    expect(await readFile(f, 'utf8')).toBe('{"new":1}')
  })

  it('keeps the previous good file as .bak', async () => {
    const f = join(dir, 'state.json')
    await writeFile(f, 'old')
    await atomicWriteFile(f, 'new')
    expect(await readFile(f, 'utf8')).toBe('new')
    expect(await readFile(f + '.bak', 'utf8')).toBe('old')
  })

  it('retries rename on EPERM then succeeds', async () => {
    const f = join(dir, 'state.json')
    const real = await import('node:fs/promises')
    let calls = 0
    const rename = vi.fn(async (a: PathLike, b: PathLike) => {
      if (++calls < 3) throw Object.assign(new Error('locked'), { code: 'EPERM' })
      return real.rename(a, b)
    })
    await atomicWriteFile(f, 'x', { retries: 5, delayMs: 1, fs: { ...real, rename } })
    expect(rename).toHaveBeenCalledTimes(3)
    expect(await readFile(f, 'utf8')).toBe('x')
  })

  it('gives up after the retry budget and removes the temp file', async () => {
    const f = join(dir, 'state.json')
    const real = await import('node:fs/promises')
    const rename = vi.fn(async () => {
      throw Object.assign(new Error('locked'), { code: 'EBUSY' })
    })
    await expect(atomicWriteFile(f, 'x', { retries: 2, delayMs: 1, fs: { ...real, rename } })).rejects.toThrow('locked')
    expect(rename).toHaveBeenCalledTimes(3)
    expect(await readdir(dir)).toEqual([])
  })

  it('does not retry non-lock errors', async () => {
    const f = join(dir, 'state.json')
    const real = await import('node:fs/promises')
    const rename = vi.fn(async () => {
      throw Object.assign(new Error('nope'), { code: 'ENOENT' })
    })
    await expect(atomicWriteFile(f, 'x', { retries: 5, delayMs: 1, fs: { ...real, rename } })).rejects.toThrow('nope')
    expect(rename).toHaveBeenCalledTimes(1)
  })
})
