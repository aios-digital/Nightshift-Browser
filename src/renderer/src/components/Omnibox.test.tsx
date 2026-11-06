// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Omnibox } from './Omnibox'

const T = 'https://search.example/?q=%s'
afterEach(cleanup)

const setup = (url = '', onSubmit = vi.fn()) => {
  render(<Omnibox url={url} searchTemplate={T} label="Address" placeholder="Search" onSubmit={onSubmit} />)
  return { onSubmit, input: screen.getByLabelText('Address') as HTMLInputElement }
}

describe('Omnibox', () => {
  it('shows the current URL, left-to-right', () => {
    const { input } = setup('https://example.com/')
    expect(input.value).toBe('https://example.com/')
    expect(input.getAttribute('dir')).toBe('ltr')
  })

  it('shows nothing for about:blank', () => {
    expect(setup('about:blank').input.value).toBe('')
  })

  it('submits a URL typed without a scheme', async () => {
    const { input, onSubmit } = setup()
    await userEvent.type(input, 'example.com{Enter}')
    expect(onSubmit).toHaveBeenCalledWith('https://example.com/')
  })

  it('submits a search for plain text', async () => {
    const { input, onSubmit } = setup()
    await userEvent.type(input, 'night owl{Enter}')
    expect(onSubmit).toHaveBeenCalledWith('https://search.example/?q=night%20owl')
  })

  it('never submits javascript: as a URL', async () => {
    const { input, onSubmit } = setup()
    await userEvent.type(input, 'javascript:alert(1){Enter}')
    expect(onSubmit.mock.calls[0]![0]).toMatch(/^https:\/\/search\.example\//)
  })

  it('ignores empty input', async () => {
    const { input, onSubmit } = setup()
    await userEvent.type(input, '   {Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('Escape restores the current URL', async () => {
    const { input } = setup('https://example.com/')
    await userEvent.clear(input)
    await userEvent.type(input, 'abc')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('https://example.com/')
  })
})
