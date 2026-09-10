/**
 * アプリ全体の設定（要件 10.6）。
 *
 * ライブラリの絞り込み・並べ替え・言語など、複数の画面から参照する値を
 * 1箇所にまとめる。src/playback.tsx はここから読んで曲一覧に適用する側、
 * app/settings.tsx は書き込む側になる。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import i18next, { detectLanguage, SUPPORTED_LANGUAGES, type SupportedLanguage } from './i18n';
import { readJson, StorageKeys, writeJson } from './storage';

/** 'auto' は端末の言語（対応外なら英語）に従う。→ src/i18n/index.ts の detectLanguage */
export type LanguagePreference = 'auto' | SupportedLanguage;

export type Settings = {
  language: LanguagePreference;
  /**
   * 短い曲を曲一覧・再生対象から除外するか。
   * 要件 10.6 では既定OFF（決定：2026-09-03）としたが、2026-09-10 に既定ONへ変更。
   */
  excludeShortTracks: boolean;
  /** この秒数未満の曲を「短い曲」とみなす。 */
  shortTrackThresholdSec: number;
  /**
   * 並べ替え時に先頭の "The " を無視するか。→ src/sorting.ts
   * "The" と "A"/"An" は流儀が割れているため独立したON/OFFにしている。
   */
  ignoreLeadingThe: boolean;
  /** 並べ替え時に先頭の "A "/"An " を無視するか。既定はOFF（自分好みに寄せた既定値）。 */
  ignoreLeadingAAn: boolean;
};

const DEFAULT_SETTINGS: Settings = {
  language: 'auto',
  excludeShortTracks: true,
  shortTrackThresholdSec: 5,
  ignoreLeadingThe: true,
  ignoreLeadingAAn: false,
};

const MIN_THRESHOLD_SEC = 5;
const MAX_THRESHOLD_SEC = 120;
const THRESHOLD_STEP_SEC = 5;

type SettingsValue = Settings & {
  ready: boolean;
  setLanguage: (language: LanguagePreference) => void;
  setExcludeShortTracks: (value: boolean) => void;
  setShortTrackThresholdSec: (value: number) => void;
  setIgnoreLeadingThe: (value: boolean) => void;
  setIgnoreLeadingAAn: (value: boolean) => void;
};

const SettingsContext = createContext<SettingsValue | null>(null);

export function useSettings(): SettingsValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings must be used within SettingsProvider');
  return value;
}

function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value as string);
}

function normalize(value: unknown): Settings {
  const saved = (value ?? {}) as Partial<Settings>;
  return {
    language:
      saved.language === 'auto' || isSupportedLanguage(saved.language)
        ? saved.language
        : DEFAULT_SETTINGS.language,
    excludeShortTracks:
      typeof saved.excludeShortTracks === 'boolean'
        ? saved.excludeShortTracks
        : DEFAULT_SETTINGS.excludeShortTracks,
    shortTrackThresholdSec:
      typeof saved.shortTrackThresholdSec === 'number' && saved.shortTrackThresholdSec > 0
        ? Math.min(MAX_THRESHOLD_SEC, Math.max(MIN_THRESHOLD_SEC, saved.shortTrackThresholdSec))
        : DEFAULT_SETTINGS.shortTrackThresholdSec,
    ignoreLeadingThe:
      typeof saved.ignoreLeadingThe === 'boolean'
        ? saved.ignoreLeadingThe
        : DEFAULT_SETTINGS.ignoreLeadingThe,
    ignoreLeadingAAn:
      typeof saved.ignoreLeadingAAn === 'boolean'
        ? saved.ignoreLeadingAAn
        : DEFAULT_SETTINGS.ignoreLeadingAAn,
  };
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  // patch() から見るための ref。読み込み前に書き込みが走ると、prev が
  // まだ DEFAULT_SETTINGS のままなので、保存済みの値を既定値で丸ごと
  // 上書きしてしまう（実際の書き込み起点は設定画面のユーザー操作だけなので
  // 通常は起きないが、保険として弾く）。
  const readyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = normalize(await readJson<Settings>(StorageKeys.appSettings));
      if (cancelled) return;
      setSettings(saved);
      // 'auto' は i18next 初期化時の detectLanguage() ですでに正しい。
      // 明示的に選んでいた場合だけ上書きする。
      if (saved.language !== 'auto') void i18next.changeLanguage(saved.language);
      readyRef.current = true;
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 1フィールドだけ更新して保存する。個別の setXxx はこれの薄いラッパ。
   * 読み込み前で弾いた場合は false を返す。呼び出し側が「保存はできなかったが
   * 見た目だけ変える」ような副作用（setLanguage の i18next.changeLanguage
   * など）を連動させないための戻り値。
   */
  const patch = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]): boolean => {
    if (!readyRef.current) return false;
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      void writeJson(StorageKeys.appSettings, next);
      return next;
    });
    return true;
  }, []);

  const setLanguage = useCallback(
    (language: LanguagePreference) => {
      if (!patch('language', language)) return;
      void i18next.changeLanguage(language === 'auto' ? detectLanguage() : language);
    },
    [patch]
  );

  const setExcludeShortTracks = useCallback(
    (value: boolean) => patch('excludeShortTracks', value),
    [patch]
  );

  const setShortTrackThresholdSec = useCallback(
    (value: number) => {
      patch('shortTrackThresholdSec', Math.min(MAX_THRESHOLD_SEC, Math.max(MIN_THRESHOLD_SEC, value)));
    },
    [patch]
  );

  const setIgnoreLeadingThe = useCallback(
    (value: boolean) => patch('ignoreLeadingThe', value),
    [patch]
  );

  const setIgnoreLeadingAAn = useCallback(
    (value: boolean) => patch('ignoreLeadingAAn', value),
    [patch]
  );

  const value: SettingsValue = {
    ...settings,
    ready,
    setLanguage,
    setExcludeShortTracks,
    setShortTrackThresholdSec,
    setIgnoreLeadingThe,
    setIgnoreLeadingAAn,
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export const THRESHOLD_BOUNDS = {
  min: MIN_THRESHOLD_SEC,
  max: MAX_THRESHOLD_SEC,
  step: THRESHOLD_STEP_SEC,
};
