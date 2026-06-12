import { createI18n } from 'vue-i18n'
import en from './locales/en'
import zhCN from './locales/zh-CN'

export const LOCALES = ['en', 'zh-CN'] as const
export type Locale = (typeof LOCALES)[number]

// what the user picks in Settings — a concrete locale, or 'auto' to follow the OS
export const LANG_PREFS = ['auto', 'en', 'zh-CN'] as const
export type LangPref = (typeof LANG_PREFS)[number]

const STORAGE_KEY = 'tapeflow.lang'

function systemLocale(): Locale {
  return (navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

function storedPref(): LangPref {
  const s = localStorage.getItem(STORAGE_KEY)
  return s === 'en' || s === 'zh-CN' || s === 'auto' ? (s as LangPref) : 'auto'
}

function resolve(pref: LangPref): Locale {
  return pref === 'auto' ? systemLocale() : pref
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true, // expose $t in templates without useI18n()
  locale: resolve(storedPref()),
  fallbackLocale: 'en',
  messages: { en, 'zh-CN': zhCN }
})

export function langPref(): LangPref {
  return storedPref()
}

export function setLangPref(pref: LangPref): void {
  localStorage.setItem(STORAGE_KEY, pref)
  const loc = resolve(pref)
  i18n.global.locale.value = loc
  document.documentElement.lang = loc
}

export function currentLocale(): Locale {
  return i18n.global.locale.value as Locale
}

// the global translator, for use OUTSIDE components (the Pinia store, util fns). In components use
// the template `$t` / the `useI18n()` `t` so they re-render reactively on a locale switch.
export const t = i18n.global.t
