import en from '../i18n/en.json'
import ar from '../i18n/ar.json'
import type { Locale } from './save'

export type Dictionary = Record<string, string>

/**
 * Locale registry. To add a language: create `src/i18n/<code>.json` with every key from en.json,
 * register it here and in `LOCALES` (engine/save.ts), and add its native name as `lang.<code>`.
 */
const DICTIONARIES: Record<Locale, Dictionary> = { en, ar }

/** Map a browser locale list to a supported locale: any ar* → Arabic, else English. */
export function detectLocale(languages: readonly string[] | undefined): Locale {
  const first = (languages ?? []).find(Boolean) ?? ''
  return first.toLowerCase().startsWith('ar') ? 'ar' : 'en'
}

/** A saved player choice always wins over browser detection. */
export function resolveLocale(saved: Locale | '', languages: readonly string[] | undefined): Locale {
  return saved === 'en' || saved === 'ar' ? saved : detectLocale(languages)
}

export class I18n {
  locale: Locale
  private listeners = new Set<(locale: Locale) => void>()

  constructor(locale: Locale) {
    this.locale = locale
    document.documentElement.lang = locale
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'
  }

  /** Look up `key`, replacing `{name}` placeholders. Missing keys render the key so gaps are visible. */
  t(key: string, vars: Record<string, string | number> = {}): string {
    const text = DICTIONARIES[this.locale][key] ?? DICTIONARIES.en[key] ?? key
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
  }

  has(key: string): boolean {
    return key in DICTIONARIES.en
  }

  /** Locale-aware number formatting. */
  n(value: number): string {
    return Math.floor(value).toLocaleString(this.locale)
  }

  set(locale: Locale): void {
    if (locale === this.locale) return
    this.locale = locale
    document.documentElement.lang = locale
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'
    for (const fn of this.listeners) fn(locale)
  }

  onChange(fn: (locale: Locale) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}

export const DICTIONARY_KEYS = { en: Object.keys(en), ar: Object.keys(ar) }
