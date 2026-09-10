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
import { TAB_IDS, type TabId } from './tabs';

/** タブ1枚ぶんの並び順・表示状態。配列の順序がそのまま表示順になる。 */
export type TabEntry = { id: TabId; visible: boolean };

/** 'auto' は端末の言語（対応外なら英語）に従う。→ src/i18n/index.ts の detectLanguage */
export type LanguagePreference = 'auto' | SupportedLanguage;

export type Settings = {
  language: LanguagePreference;
  /**
   * 短い曲を曲一覧・再生対象から除外するか。既定OFF。
   * 2026-09-03に既定OFFとし、2026-09-10に一度既定ONへ変更したが、同日中に
   * excludeNonMusic を追加したことで既定ONにしていた主因（通知音などの
   * 混入。IS_MUSIC はどの端末でも Ringtones/Notifications/Alarms に0が立つ
   * ため端末依存ではない）が解消されたため、既定OFFへ戻した（決定：2026-09-10）。
   * 既定ONのまま残す副作用は一方向（5秒未満の実在する曲を黙って隠す）だった。
   */
  excludeShortTracks: boolean;
  /** この秒数未満の曲を「短い曲」とみなす。 */
  shortTrackThresholdSec: number;
  /**
   * MediaStore の IS_MUSIC が false の曲（着信音・通知音・アラーム・
   * オーディオブックなど）を曲一覧・再生対象から除外するか。既定ON。
   * → src/library.ts の Track.isMusic
   */
  excludeNonMusic: boolean;
  /**
   * 並べ替え時に先頭の "The " を無視するか。→ src/sorting.ts
   * "The" と "A"/"An" は流儀が割れているため独立したON/OFFにしている。
   */
  ignoreLeadingThe: boolean;
  /** 並べ替え時に先頭の "A "/"An " を無視するか。既定はOFF（自分好みに寄せた既定値）。 */
  ignoreLeadingAAn: boolean;
  /**
   * ライブラリ画面のタブの並び順・表示状態。配列の順序がそのまま表示順。
   * 最低1枚は visible: true が残る（0枚だと画面が組み立てられない）。
   */
  tabs: TabEntry[];
};

const DEFAULT_TABS: TabEntry[] = TAB_IDS.map((id) => ({ id, visible: true }));

const DEFAULT_SETTINGS: Settings = {
  language: 'auto',
  excludeShortTracks: false,
  shortTrackThresholdSec: 5,
  excludeNonMusic: true,
  ignoreLeadingThe: true,
  ignoreLeadingAAn: false,
  tabs: DEFAULT_TABS,
};

const MIN_THRESHOLD_SEC = 5;
const MAX_THRESHOLD_SEC = 120;
const THRESHOLD_STEP_SEC = 5;

type SettingsValue = Settings & {
  ready: boolean;
  setLanguage: (language: LanguagePreference) => void;
  setExcludeShortTracks: (value: boolean) => void;
  setShortTrackThresholdSec: (value: number) => void;
  setExcludeNonMusic: (value: boolean) => void;
  setIgnoreLeadingThe: (value: boolean) => void;
  setIgnoreLeadingAAn: (value: boolean) => void;
  setTabs: (next: TabEntry[] | ((prev: TabEntry[]) => TabEntry[])) => void;
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

function isTabId(value: unknown): value is TabId {
  return (TAB_IDS as readonly string[]).includes(value as string);
}

/**
 * 保存されたタブ設定を正本（TAB_IDS）と突き合わせる。
 * - 正本に無いid（将来タブを廃止したとき）は捨てる
 * - 重複は落とす（最初に出てきたものを採用）
 * - 正本にあって保存値に無いid（将来タブを増やしたとき）は末尾に足す
 * - 表示が0件になるなら既定値に戻す（画面が組み立てられなくなるため）
 */
function normalizeTabs(value: unknown): TabEntry[] {
  const saved = Array.isArray(value) ? value : [];
  const seen = new Set<TabId>();
  const result: TabEntry[] = [];

  for (const entry of saved as Partial<TabEntry>[]) {
    if (!isTabId(entry?.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    result.push({ id: entry.id, visible: typeof entry.visible === 'boolean' ? entry.visible : true });
  }
  for (const id of TAB_IDS) {
    if (!seen.has(id)) result.push({ id, visible: true });
  }

  return result.some((tab) => tab.visible) ? result : DEFAULT_TABS;
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
    excludeNonMusic:
      typeof saved.excludeNonMusic === 'boolean'
        ? saved.excludeNonMusic
        : DEFAULT_SETTINGS.excludeNonMusic,
    ignoreLeadingThe:
      typeof saved.ignoreLeadingThe === 'boolean'
        ? saved.ignoreLeadingThe
        : DEFAULT_SETTINGS.ignoreLeadingThe,
    ignoreLeadingAAn:
      typeof saved.ignoreLeadingAAn === 'boolean'
        ? saved.ignoreLeadingAAn
        : DEFAULT_SETTINGS.ignoreLeadingAAn,
    tabs: normalizeTabs(saved.tabs),
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
  // 読み込みが届いた最初のコミットだけ、保存 effect をスキップするための ref。
  // → 下の保存 effect のコメント参照。
  const hasHydratedRef = useRef(false);

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

  // 保存は setState の更新関数の外、コミット後の副作用としてだけ行う。
  // 以前は patch() の中の setSettings((prev) => { ...; writeJson(...); return next })
  // という形で、更新関数の内側に書き込みを置いていた。だが更新関数は
  // Reactが「純粋」を前提にしている関数で、Strict Mode の二重呼び出しなど、
  // 実際にコミットされる保証のない呼ばれ方をする。ここに移すことで、
  // 「実際に画面に反映された設定だけが、コミットされた順に、1回ずつ」
  // 保存される。
  //
  // ただし、読み込みが届いた最初のコミットだけは書かない。readJson は
  // 読み取り失敗と「保存されていない」を区別せず null を返す
  // （→ src/storage.ts）ため、読み込みが失敗すると saved は
  // normalize(null) で DEFAULT_SETTINGS になる。ここで無条件に書けば、
  // 一時的な読み取り失敗が「保存済みの設定を既定値で上書きして消す」
  // という恒久的な事故になってしまう。以前（書き込みがユーザー操作
  // 起点だけだった頃）は読み取り失敗してもディスクは無傷で、次回起動で
  // 復旧できていた。その性質を保つため、読み込み由来のコミットは
  // スキップし、実際に patch() でユーザーが変更したときだけ書く。
  useEffect(() => {
    if (!ready) return;
    if (!hasHydratedRef.current) {
      hasHydratedRef.current = true;
      return;
    }
    writeJson(StorageKeys.appSettings, settings).catch((e) => {
      console.warn('Failed to persist settings', e);
    });
  }, [settings, ready]);

  /**
   * 1フィールドだけ更新する。個別の setXxx はこれの薄いラッパ。
   * 読み込み前で弾いた場合は false を返す。呼び出し側が「保存はできなかったが
   * 見た目だけ変える」ような副作用（setLanguage の i18next.changeLanguage
   * など）を連動させないための戻り値。
   *
   * value は値そのものでも、(prev) => next という更新関数でもよい。配列など
   * 「今の値をもとに次の値を作る」更新（タブの並べ替えなど）を素の値で
   * 渡すと、連打でレンダーが追いつかない間に呼ばれた2回目が、1回目の
   * 結果を知らないまま古い prev から next を作ってしまい、1回目の変更を
   * 踏みつぶす（lost update）。更新関数として渡せば、Reactがキューに
   * 積んだ順で確実に前の結果の上に適用してくれる。
   */
  const patch = useCallback(
    <K extends keyof Settings>(
      key: K,
      value: Settings[K] | ((prev: Settings[K]) => Settings[K])
    ): boolean => {
      if (!readyRef.current) return false;
      setSettings((prev) => {
        const resolved = typeof value === 'function' ? (value as (p: Settings[K]) => Settings[K])(prev[key]) : value;
        return { ...prev, [key]: resolved };
      });
      return true;
    },
    []
  );

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

  const setExcludeNonMusic = useCallback(
    (value: boolean) => patch('excludeNonMusic', value),
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

  const setTabs = useCallback(
    (update: TabEntry[] | ((prev: TabEntry[]) => TabEntry[])) => {
      patch('tabs', (prev) => {
        const next = typeof update === 'function' ? update(prev) : update;
        // 呼び出し側（設定画面）が「最後の1枚は隠せない」を守っている前提だが、
        // 保存内容が壊れて0件になる事故だけは最後の砦として弾いておく。
        return next.some((tab) => tab.visible) ? next : prev;
      });
    },
    [patch]
  );

  const value: SettingsValue = {
    ...settings,
    ready,
    setLanguage,
    setExcludeShortTracks,
    setShortTrackThresholdSec,
    setExcludeNonMusic,
    setIgnoreLeadingThe,
    setIgnoreLeadingAAn,
    setTabs,
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export const THRESHOLD_BOUNDS = {
  min: MIN_THRESHOLD_SEC,
  max: MAX_THRESHOLD_SEC,
  step: THRESHOLD_STEP_SEC,
};
