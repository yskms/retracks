/**
 * 多言語化の初期化。
 *
 * 端末の言語が日本語ならそれを使い、それ以外はすべて英語にする
 * （国際的に無難なフォールバックとして英語を採用。日本語だけの特別扱い）。
 * リソースを直接渡しているため init は同期的に終わり、Suspense や
 * ローディング状態は不要。
 *
 * Fast Refresh でこのモジュールが再評価されても二重初期化しないよう
 * isInitialized を見る。
 */
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';

import ja from './locales/ja';
import en from './locales/en';

export const SUPPORTED_LANGUAGES = ['ja', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

function detectLanguage(): SupportedLanguage {
  const deviceLanguage = Localization.getLocales()[0]?.languageCode;
  return deviceLanguage === 'ja' ? 'ja' : 'en';
}

if (!i18next.isInitialized) {
  void i18next
    .use(initReactI18next)
    .init({
      resources: {
        ja: { translation: ja },
        en: { translation: en },
      },
      lng: detectLanguage(),
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
    })
    .catch((error) => {
      if (__DEV__) console.warn('[i18n] init failed', error);
    });
}

export default i18next;
