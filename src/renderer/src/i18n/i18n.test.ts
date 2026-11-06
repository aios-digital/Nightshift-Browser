import { describe, expect, it } from 'vitest'
import en from './en.json'
import ar from './ar.json'
import { dirFor, createI18n } from './index'

const flatten = (o: Record<string, unknown>, prefix = ''): Record<string, string> =>
  Object.entries(o).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k
    return typeof v === 'string' ? { ...acc, [key]: v } : { ...acc, ...flatten(v as Record<string, unknown>, key) }
  }, {})

describe('i18n resources', () => {
  const e = flatten(en)
  const a = flatten(ar)
  it('EN and AR have identical key sets', () => {
    expect(Object.keys(a).sort()).toEqual(Object.keys(e).sort())
  })
  it('no value is empty', () => {
    for (const [k, v] of [...Object.entries(e), ...Object.entries(a)]) expect(v.trim(), k).not.toBe('')
  })
  it('AR values contain Arabic text except brand/loanwords', () => {
    const allowedLatin = new Set(['app.name', 'appBar.language'])
    for (const [k, v] of Object.entries(a)) if (!allowedLatin.has(k)) expect(/[؀-ۿ]/.test(v), k).toBe(true)
  })
  it('every error key used by describeLoadError has a string', () => {
    for (const k of ['dns', 'refused', 'timeout', 'offline', 'cert', 'generic']) expect(e[`errors.${k}`]).toBeTruthy()
  })
})

describe('i18n runtime', () => {
  it('dirFor', () => {
    expect(dirFor('en')).toBe('ltr')
    expect(dirFor('ar')).toBe('rtl')
  })
  it('translates and switches language', async () => {
    const i18n = await createI18n('en')
    expect(i18n.t('card.new')).toBe(en.card.new)
    await i18n.changeLanguage('ar')
    expect(i18n.t('card.new')).toBe(ar.card.new)
  })
})
