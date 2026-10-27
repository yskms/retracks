/**
 * ライブラリ画面のタブの正本（要件 10.6：タブ項目の変更）。
 *
 * TAB_IDS の並びが「将来タブが増えたときの既定の並び」にもなる。
 * src/settings.tsx の normalize() はここと保存値を突き合わせて、
 * 未知のタブは捨て、正本にあって保存値に無いタブは末尾に足す。
 */

import type { LayoutKey } from './layout';

export type TabId = 'songs' | 'artists' | 'albums' | 'queues' | 'recent';

/**
 * 'queues' は、再生を始めたキュー（全曲・アーティスト・アルバム・選んだ曲・
 * 順番再生）を並べて、続きから再生するタブ（ラベルは「続きから」/ "Resume"）。
 * 要件定義書 10.4 の「プレイリスト」（自動プレイリスト／ユーザー作成。未実装）とは
 * 別物なので、TabId に playlists を使わない。
 *
 * 'recent' は、最近端末に追加した曲を「アーティスト × 追加した日」ごとの行に並べるタブ
 * （ラベルは「最近追加」/ "Recent"）。端末の追加日（Track.addedAt）から毎回組み立てる
 * だけで、保存する一覧は持たない（→ src/recentGroups.ts）。こちらも、上の「プレイリスト」
 * （最近の追加曲を含む自動プレイリスト）とは別物。
 *
 * **これらの ID は変えない。** normalizeTabs() は未知の ID を捨てるため、リリース後に
 * 変えると、利用者が設定したこのタブの並び順・表示設定が黙って初期化される。
 * 表示名だけを変えるなら、ラベル（i18n の library.tabQueues / library.tabRecent）を直す。
 */
export const TAB_IDS: readonly TabId[] = [
  'songs',
  'artists',
  'albums',
  'queues',
  'recent',
] as const;

export const TAB_LABEL_KEY = {
  songs: 'library.tabSongs',
  artists: 'library.tabArtists',
  albums: 'library.tabAlbums',
  queues: 'library.tabQueues',
  recent: 'library.tabRecent',
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

/**
 * 並べ替えメニューを持つタブだけをここに載せる（考え方は TAB_LAYOUT_KEY と同じ）。
 * アーティストタブは軸が「名前」の1つしか無いため対象外（v1、→ 要件定義書 10.4）。
 */
export const TAB_SORT_KEY: Partial<Record<TabId, 'songs' | 'albums'>> = {
  songs: 'songs',
  albums: 'albums',
};
