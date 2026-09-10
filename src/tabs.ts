/**
 * ライブラリ画面のタブの正本（要件 10.6：タブ項目の変更）。
 *
 * TAB_IDS の並びが「将来タブが増えたときの既定の並び」にもなる。
 * src/settings.tsx の normalize() はここと保存値を突き合わせて、
 * 未知のタブは捨て、正本にあって保存値に無いタブは末尾に足す。
 */

import type { LayoutKey } from './layout';

export type TabId = 'songs' | 'artists' | 'albums';

export const TAB_IDS: TabId[] = ['songs', 'artists', 'albums'];

export const TAB_LABEL_KEY = {
  songs: 'library.tabSongs',
  artists: 'library.tabArtists',
  albums: 'library.tabAlbums',
} as const satisfies Record<TabId, string>;

/**
 * レイアウト切替アイコン（⊞▦☰）を持つタブだけをここに載せる。
 * 曲タブのように一覧固定のタブは載せない。表示条件はこの有無で判定する
 * （「曲タブでは出さない」という決め打ちにしないため）。
 */
export const TAB_LAYOUT_KEY: Partial<Record<TabId, LayoutKey>> = {
  artists: 'artists',
  albums: 'albums',
};
