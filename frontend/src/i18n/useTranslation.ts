import { useState, useEffect } from 'react';
import { getLanguage, setLanguage as setLang, t as translate, initLanguage, type Language } from './index';

export const useTranslation = () => {
  const [, forceUpdate] = useState({});

  useEffect(() => {
    initLanguage();
    forceUpdate({});
  }, []);

  const setLanguage = (lang: Language) => {
    setLang(lang);
    forceUpdate({});
  };

  return {
    t: translate,
    language: getLanguage(),
    setLanguage
  };
};
