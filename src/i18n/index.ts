/**
 * 多言語化の初期化。
 *
 * 端末の言語が対応言語（SUPPORTED_LANGUAGES）に含まれていればそれを使い、
 * 含まれていなければ英語にする（国際的に無難なフォールバックとして英語を
 * 採用）。リソースを直接渡しているため init は同期的に終わり、Suspense や
 * ローディング状態は不要。
 *
 * fallbackLng は ['en', 'ja'] のチェーンにしてある。ja が全キーの
 * 正本（i18next.d.ts の型はここから作る）なので、en 側にキーの抜けが
 * あっても生キーがそのまま画面に出ることはなく、必ず ja に着地する。
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

export function detectLanguage(): SupportedLanguage {
  const deviceLanguage = Localization.getLocales()[0]?.languageCode;
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(deviceLanguage ?? '')
    ? (deviceLanguage as SupportedLanguage)
    : 'en';
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
      fallbackLng: ['en', 'ja'],
      interpolation: { escapeValue: false },
    })
    .catch((error) => {
      if (__DEV__) console.warn('[i18n] init failed', error);
    });
}

export default i18next;
