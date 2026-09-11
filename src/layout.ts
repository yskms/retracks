/**
 * 一覧の表示形式（3列 / 4列 / 一覧）。
 * 画面ごと・タブごとに別々の形式を持ち、選んだ状態を保存する。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

import { readJson, StorageKeys, writeJson } from './storage';

export type Layout = 'grid3' | 'grid4' | 'list';

/** 切り替えの順番。タップするたびにこの順で巡る。 */
export const LAYOUT_ORDER: Layout[] = ['grid3', 'grid4', 'list'];

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/** 現在の形式を表すアイコン（Ionicons）。3列・4列・一覧を表す。 */
export const LAYOUT_ICON: Record<Layout, IoniconName> = {
  grid3: 'grid-outline',
  grid4: 'apps-outline',
  list: 'list-outline',
};

/** 表示形式を持つ場所。 */
export type LayoutKey = 'artists' | 'albums' | 'artistAlbums';

export type Layouts = Record<LayoutKey, Layout>;

const DEFAULTS: Layouts = {
  artists: 'grid3',
  albums: 'grid4',
  artistAlbums: 'grid4',
};

export function columnsOf(layout: Layout): number {
  return layout === 'grid3' ? 3 : layout === 'grid4' ? 4 : 1;
}

/**
 * 画面幅から1枠の大きさを求める。
 *
 * 割り切れない場合に端数を切り上げると、列の合計が使える幅をわずかに超えて
 * 折り返してしまう（3列のはずが2列になる）。必ず切り捨てて余裕を持たせる。
 */
export function tileSizeOf(
  width: number,
  layout: Layout,
  padding: number,
  gap: number
): number {
  const columns = columnsOf(layout);
  return Math.floor((width - padding * 2 - gap * (columns - 1)) / columns);
}

function normalize(value: unknown): Layouts {
  const saved = (value ?? {}) as Partial<Layouts>;
  const pick = (key: LayoutKey): Layout =>
    LAYOUT_ORDER.includes(saved[key] as Layout) ? (saved[key] as Layout) : DEFAULTS[key];
  return {
    artists: pick('artists'),
    albums: pick('albums'),
    artistAlbums: pick('artistAlbums'),
  };
}

export function useLayouts() {
  const [layouts, setLayouts] = useState<Layouts>(DEFAULTS);
  const [ready, setReady] = useState(false);
  // cycle() から見るための ref。読み込み前に書き込みが走ると、prev が
  // まだ DEFAULTS のままなので、保存済みの値を既定値で丸ごと上書きして
  // しまう（→ SettingsProvider の readyRef と同じ理由）。
  const readyRef = useRef(false);
  // 読み込みが届いた最初のコミットだけ、保存 effect をスキップするための
  // ref。→ 下の保存 effect のコメント参照。
  const hasHydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = normalize(await readJson(StorageKeys.layout));
      if (cancelled) return;
      setLayouts(saved);
      readyRef.current = true;
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 保存は setState の更新関数の外、コミット後の副作用としてだけ行う
  // （SettingsProvider と同じ理由・同じ形。→ src/settings.tsx のコメント）。
  // 以前は cycle() の中の setLayouts((prev) => { ...; writeJson(...); return next })
  // という形で、更新関数（React が「純粋」を前提にする関数）の内側に
  // 書き込みを置いていた。
  useEffect(() => {
    if (!ready) return;
    if (!hasHydratedRef.current) {
      hasHydratedRef.current = true;
      return;
    }
    writeJson(StorageKeys.layout, layouts).catch((e) => {
      console.warn('Failed to persist layouts', e);
    });
  }, [layouts, ready]);

  const cycle = useCallback((key: LayoutKey) => {
    if (!readyRef.current) return;
    setLayouts((prev) => {
      const index = LAYOUT_ORDER.indexOf(prev[key]);
      const next = LAYOUT_ORDER[(index + 1) % LAYOUT_ORDER.length];
      return { ...prev, [key]: next };
    });
  }, []);

  return { layouts, cycle };
}
