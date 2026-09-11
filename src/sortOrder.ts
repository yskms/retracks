/**
 * ライブラリ画面（曲・アルバムタブ）の並べ替え軸（要件 10.4）。
 *
 * useLayouts()（→ layout.ts）と同じ考え方：タブごとの表示状態をヘッダーの
 * ボタンから変え、SettingsProvider とは別のキーで永続化する。
 *
 * SettingsProvider に持たせない理由：その値が変わると PlaybackProvider の
 * tracks が再計算され、artists/albums の導出やライブラリ全体の絞り込みまで
 * 連鎖して走り直す。曲タブの並び順を変えただけでそこまで波及させたくない
 * ので、各タブが自分の表示用に並べ替えた配列を持つ（プロバイダの tracks/
 * albums はタイトル順の正本のまま触らない）。
 *
 * v1 はライブラリ画面の曲・アルバムタブのみが対象。アーティストタブは
 * 軸が「名前」の1つしか無いため対象外、アルバム詳細・アーティスト詳細の
 * 一覧（ディスク/トラック番号順が前提）も対象外（→ 要件定義書 10.4）。
 */

import { useCallback, useEffect, useState } from 'react';

import { compareByTrackOrder, type Album, type Track } from './library';
import { sortKeyOf, type ArticleOptions } from './sorting';
import { readJson, StorageKeys, writeJson } from './storage';

export type SongSortField = 'title' | 'album' | 'artist' | 'duration';
export type AlbumSortField = 'title' | 'artist' | 'year';
export type SortDirection = 'asc' | 'desc';

export type SortOrders = {
  songs: { field: SongSortField; direction: SortDirection };
  albums: { field: AlbumSortField; direction: SortDirection };
};

const SONG_FIELDS: SongSortField[] = ['title', 'album', 'artist', 'duration'];
const ALBUM_FIELDS: AlbumSortField[] = ['title', 'artist', 'year'];

const DEFAULTS: SortOrders = {
  songs: { field: 'title', direction: 'asc' },
  albums: { field: 'title', direction: 'asc' },
};

function normalize(value: unknown): SortOrders {
  const saved = (value ?? {}) as Partial<{
    songs: Partial<SortOrders['songs']>;
    albums: Partial<SortOrders['albums']>;
  }>;
  const direction = (d: unknown): SortDirection => (d === 'desc' ? 'desc' : 'asc');
  return {
    songs: {
      field: SONG_FIELDS.includes(saved.songs?.field as SongSortField)
        ? (saved.songs!.field as SongSortField)
        : DEFAULTS.songs.field,
      direction: direction(saved.songs?.direction),
    },
    albums: {
      field: ALBUM_FIELDS.includes(saved.albums?.field as AlbumSortField)
        ? (saved.albums!.field as AlbumSortField)
        : DEFAULTS.albums.field,
      direction: direction(saved.albums?.direction),
    },
  };
}

export function useSortOrders() {
  const [sortOrders, setSortOrders] = useState<SortOrders>(DEFAULTS);

  useEffect(() => {
    void (async () => {
      setSortOrders(normalize(await readJson(StorageKeys.sortOrder)));
    })();
  }, []);

  const setSongSort = useCallback((field: SongSortField, direction: SortDirection) => {
    setSortOrders((prev) => {
      const updated: SortOrders = { ...prev, songs: { field, direction } };
      void writeJson(StorageKeys.sortOrder, updated);
      return updated;
    });
  }, []);

  const setAlbumSort = useCallback((field: AlbumSortField, direction: SortDirection) => {
    setSortOrders((prev) => {
      const updated: SortOrders = { ...prev, albums: { field, direction } };
      void writeJson(StorageKeys.sortOrder, updated);
      return updated;
    });
  }, []);

  return { sortOrders, setSongSort, setAlbumSort };
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/**
 * 曲一覧を軸・方向で並べ替える。
 *
 * 方向（昇順/降順）は主軸にだけ効かせる。第2キー（アルバム順のときは
 * アルバム名、それ以外は compareByTrackOrder＝ディスク・トラック番号）は
 * 常に自然な順のままにする。降順にしたときアルバム内の曲順まで逆転すると
 * 使い物にならない（Pulsar 等の一般的な音楽アプリの挙動に合わせる）。
 */
export function sortTracks(
  tracks: Track[],
  field: SongSortField,
  direction: SortDirection,
  articleOptions: ArticleOptions
): Track[] {
  const sign = direction === 'asc' ? 1 : -1;
  const titleKey = (t: Track) => sortKeyOf(t.title, articleOptions);
  const artistKey = (t: Track) => sortKeyOf(t.artist, articleOptions);
  const albumKey = (t: Track) => sortKeyOf(t.album ?? '', articleOptions);

  const comparePrimary = (a: Track, b: Track): number => {
    switch (field) {
      case 'duration':
        return a.durationMs - b.durationMs;
      case 'artist':
        return collator.compare(artistKey(a), artistKey(b));
      case 'album':
        return collator.compare(albumKey(a), albumKey(b));
      case 'title':
      default:
        return collator.compare(titleKey(a), titleKey(b));
    }
  };

  const compareSecondary = (a: Track, b: Track): number => {
    if (field === 'artist') {
      const albumDiff = collator.compare(albumKey(a), albumKey(b));
      if (albumDiff !== 0) return albumDiff;
    }
    return compareByTrackOrder(a, b);
  };

  return [...tracks].sort((a, b) => {
    const primary = comparePrimary(a, b) * sign;
    return primary !== 0 ? primary : compareSecondary(a, b);
  });
}

/**
 * アルバム一覧を軸・方向で並べ替える。年が無いアルバムは方向に関わらず
 * 常に末尾に寄せる（不明な値を「小さい/大きい」のどちらかに倒すと、
 * 降順にした瞬間に先頭へ来てしまい紛らわしいため）。
 */
export function sortAlbums(
  albums: Album[],
  field: AlbumSortField,
  direction: SortDirection,
  articleOptions: ArticleOptions
): Album[] {
  const sign = direction === 'asc' ? 1 : -1;
  const titleKey = (a: Album) => sortKeyOf(a.title, articleOptions);
  const artistKey = (a: Album) => sortKeyOf(a.artist, articleOptions);

  return [...albums].sort((a, b) => {
    if (field === 'year') {
      if (a.year == null && b.year != null) return 1;
      if (a.year != null && b.year == null) return -1;
      if (a.year != null && b.year != null && a.year !== b.year) {
        return (a.year - b.year) * sign;
      }
      return collator.compare(titleKey(a), titleKey(b));
    }

    const primary =
      field === 'artist'
        ? collator.compare(artistKey(a), artistKey(b))
        : collator.compare(titleKey(a), titleKey(b));
    const signed = primary * sign;
    return signed !== 0 ? signed : collator.compare(titleKey(a), titleKey(b));
  });
}
