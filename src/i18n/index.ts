/**
 * 多言語化の初期化。
 *
 * 端末の優先言語リストを上から順に見て、対応言語（SUPPORTED_LANGUAGES）に
 * 最初に一致したものを使う。1件も一致しなければ英語にする（国際的に無難な
 * フォールバックとして英語を採用）。iOSがInfoPlist.strings（権限ダイアログ等の
 * システムUI）を選ぶ際も優先言語リストを上から探索するため、この並び方に
 * そろえることで両者のズレを減らしている（例: 優先言語が[fr, ja]の端末では
 * UIも権限ダイアログもjaになる）。リソースを直接渡しているため init は
 * 同期的に終わり、Suspense やローディング状態は不要。
 *
 * fallbackLng は ['en', 'ja'] のチェーンにしてある。ja が全キーの
 * 正本（i18next.d.ts の型はここから作る）なので、en 側にキーの抜けが
 * あっても生キーがそのまま画面に出ることはなく、必ず ja に着地する。
 *
 * Fast Refresh でこのモジュールが再評価されても二重初期化しないよう
 * isInitialized を見る。
 *
 * 既知の残課題: 設定画面で言語を手動指定（'ja'/'en'固定）した場合、権限
 * ダイアログは端末の優先言語のまま変わらないため、UIと権限ダイアログの
 * 言語がずれることがある。権限ダイアログはOS側のプロセスが表示するため
 * アプリから言語を制御できない。
 */
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';

import ja from './locales/ja';
import en from './locales/en';

export const SUPPORTED_LANGUAGES = ['ja', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export function detectLanguage(): SupportedLanguage {
  const supported: readonly string[] = SUPPORTED_LANGUAGES;
  const match = Localization.getLocales().find((locale) => supported.includes(locale.languageCode ?? ''));
  return (match?.languageCode as SupportedLanguage | undefined) ?? 'en';
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
