/**
 * t() のキーを ja のリソース形に対して型検査する。
 * en 側はキー集合が一致している前提（ズレたらどちらかの画面が壊れるので
 * 目視で気づける規模に保つ）。
 */
import 'i18next';
import type ja from './locales/ja';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: typeof ja;
    };
  }
}
