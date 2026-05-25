import { en } from './locales/en';
import { zh } from './locales/zh';

export type Language = 'en' | 'zh';
export type TranslationKeys = typeof en;

const translations: Record<Language, TranslationKeys> = { en, zh };

const LANGUAGE_STORAGE_KEY = 'datation_language';

let currentLanguage: Language = 'en';

export const setLanguage = (lang: Language) => {
  currentLanguage = lang;
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch (e) {
    // ignore
  }
};

export const getLanguage = (): Language => {
  return currentLanguage;
};

export const t = (key: string): string => {
  const keys = key.split('.');
  let value: any = translations[currentLanguage];

  for (const k of keys) {
    value = value?.[k];
    if (value === undefined) return key;
  }

  return value || key;
};

export const initLanguage = () => {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === 'en' || saved === 'zh') {
      currentLanguage = saved;
      return;
    }
  } catch (e) {
    // ignore
  }
  currentLanguage = 'en';
};
