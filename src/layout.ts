/**
 * 一覧の表示形式（3列 / 4列 / 一覧）。
 * 画面ごと・タブごとに別々の形式を持ち、選んだ状態を保存する。
 */

import { useCallback, useEffect, useState } from 'react';

import { readJson, StorageKeys, writeJson } from './storage';

export type Layout = 'grid3' | 'grid4' | 'list';

/** 切り替えの順番。タップするたびにこの順で巡る。 */
export const LAYOUT_ORDER: Layout[] = ['grid3', 'grid4', 'list'];

/**
 * 現在の形式を表すアイコン。
 * ⊞ は粗い格子で3列、▦ は細かい格子で4列、☰ は一覧を表す。
 */
export const LAYOUT_ICON: Record<Layout, string> = {
  grid3: '⊞',
  grid4: '▦',
  list: '☰',
};

/** 表示形式を持つ場所。 */
export type LayoutKey = 'artists' | 'albums' | 'artistAlbums';

export type Layouts = Record<LayoutKey, Layout>;

const DEFAULTS: Layouts = {
  artists: 'grid3',
  albums: 'grid3',
  artistAlbums: 'grid3',
};

export function columnsOf(layout: Layout): number {
  return layout === 'grid3' ? 3 : layout === 'grid4' ? 4 : 1;
}

/** 画面幅から1枠の大きさを求める。 */
export function tileSizeOf(
  width: number,
  layout: Layout,
  padding: number,
  gap: number
): number {
  const columns = columnsOf(layout);
  return (width - padding * 2 - gap * (columns - 1)) / columns;
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

  useEffect(() => {
    void (async () => {
      setLayouts(normalize(await readJson(StorageKeys.layout)));
    })();
  }, []);

  const cycle = useCallback((key: LayoutKey) => {
    setLayouts((prev) => {
      const index = LAYOUT_ORDER.indexOf(prev[key]);
      const next = LAYOUT_ORDER[(index + 1) % LAYOUT_ORDER.length];
      const updated = { ...prev, [key]: next };
      void writeJson(StorageKeys.layout, updated);
      return updated;
    });
  }, []);

  return { layouts, cycle };
}
