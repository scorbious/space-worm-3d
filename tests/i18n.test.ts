import { describe, expect, it } from 'vitest'
import en from '../src/i18n/en.json'
import ar from '../src/i18n/ar.json'
import { detectLocale, resolveLocale } from '../src/engine/i18n'

describe('i18n', () => {
  it('detects Arabic browsers and defaults to English', () => {
    expect(detectLocale(['ar-SA', 'en'])).toBe('ar')
    expect(detectLocale(['ar'])).toBe('ar')
    expect(detectLocale(['AR'])).toBe('ar')
    expect(detectLocale(['en-US', 'ar-SA'])).toBe('en')
    expect(detectLocale([])).toBe('en')
    expect(detectLocale(undefined)).toBe('en')
  })

  it('lets a saved choice win over detection', () => {
    expect(resolveLocale('en', ['ar-SA'])).toBe('en')
    expect(resolveLocale('ar', ['en-US'])).toBe('ar')
    expect(resolveLocale('', ['ar-SA'])).toBe('ar')
  })

  it('has the same keys and placeholders in every language', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort())
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort()
    for (const [key, value] of Object.entries(en)) expect(vars((ar as Record<string, string>)[key]), key).toEqual(vars(value))
  })
})
