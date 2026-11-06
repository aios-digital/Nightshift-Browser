import { CH } from '@shared/ipc/channels'

/**
 * The quit handshake with the renderer: ask it to send any pending save, then wait for `done()`.
 * Never hangs: resolves after `timeoutMs` if the renderer is gone or does not answer.
 */
export function createRendererFlush(send: (channel: string, payload: unknown) => void, timeoutMs: number) {
  let pending: (() => void) | null = null
  return {
    request(): Promise<void> {
      return new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer)
          pending = null
          resolve()
        }
        const timer = setTimeout(finish, timeoutMs)
        pending = finish
        send(CH.flushRequest, null)
      })
    },
    done(): void {
      pending?.()
    }
  }
}

export type RendererFlush = ReturnType<typeof createRendererFlush>
