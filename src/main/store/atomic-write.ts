import * as nodeFs from 'node:fs/promises'
import { randomBytes } from 'node:crypto'

type FsLike = Pick<typeof nodeFs, 'writeFile' | 'rename' | 'copyFile' | 'rm'>

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES'])
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Write to a temp file, then rename over the target. The previous good file is kept as `<path>.bak`.
 * On Windows another process (antivirus, indexer) can briefly lock the target, so rename is retried.
 */
export async function atomicWriteFile(
  path: string,
  data: string,
  opts: { retries?: number; delayMs?: number; fs?: FsLike } = {}
): Promise<void> {
  const { retries = 6, delayMs = 25, fs = nodeFs } = opts
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`
  await fs.writeFile(tmp, data, 'utf8')
  try {
    await fs.copyFile(path, `${path}.bak`).catch(() => undefined)
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(tmp, path)
        return
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? ''
        if (!RETRYABLE.has(code) || attempt >= retries) throw error
        await sleep(delayMs * 2 ** attempt)
      }
    }
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    throw error
  }
}
