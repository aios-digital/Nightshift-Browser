import i18next, { type i18n } from 'i18next'
import type { Locale } from '@shared/model/persisted-schema'
import en from './en.json'
import ar from './ar.json'

export const dirFor = (locale: Locale): 'ltr' | 'rtl' => (locale === 'ar' ? 'rtl' : 'ltr')

export async function createI18n(locale: Locale): Promise<i18n> {
  const instance = i18next.createInstance()
  await instance.init({
    lng: locale,
    fallbackLng: 'en',
    resources: { en: { translation: en }, ar: { translation: ar } },
    interpolation: { escapeValue: false },
    returnNull: false
  })
  return instance
}
