import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { resolveInput } from '@shared/url/omnibox'
import styles from './Omnibox.module.css'

type Props = {
  url: string
  searchTemplate: string
  label: string
  placeholder: string
  autoFocus?: boolean
  onSubmit: (url: string) => void
}

const shown = (url: string) => (url === 'about:blank' ? '' : url)

export function Omnibox({ url, searchTemplate, label, placeholder, autoFocus = false, onSubmit }: Props) {
  const [draft, setDraft] = useState<string | null>(null) // null = not editing, show the live URL
  const ref = useRef<HTMLInputElement>(null)
  const value = draft ?? shown(url)

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  const submit = () => {
    const result = resolveInput(value, searchTemplate)
    if (!result) return
    setDraft(null)
    onSubmit(result.url)
    ref.current?.blur()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') submit()
    else if (e.key === 'Escape') {
      setDraft(null)
      ref.current?.blur()
    }
  }

  return (
    <input
      ref={ref}
      className={styles.input}
      type="text"
      aria-label={label}
      placeholder={placeholder}
      // URLs are always left-to-right, even in an RTL layout.
      dir={value.trim() === '' ? undefined : 'ltr'}
      spellCheck={false}
      autoComplete="off"
      value={value}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => setDraft(null)}
      onKeyDown={onKeyDown}
    />
  )
}
