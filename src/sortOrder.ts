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
 * v1 はライブラリ画面の曲・アルバムタブとアーティスト詳細の曲一覧が対象。
 * ライブラリ画面のアーティストタブは軸が「名前」の1つしか無いため対象外、
 * アルバム詳細・アーティスト詳細のアルバム一覧（ディスク/トラック番号順・
 * 発売年降順が前提）も対象外（→ 要件定義書 10.4）。「追加日」軸は
 * Track が持っていない（Asset.creationTime を保存しておらず、足すなら
 * キャッシュ版を5→6に上げる走査が要る）ため、曲タブの分もまとめて
 * 見送っている。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { compareByTrackOrder, type Album, type Track } from './library';
import { sortKeyOf, type ArticleOptions } from './sorting';
import { readJson, StorageKeys, writeJson } from './storage';

export type SongSortField = 'title' | 'album' | 'artist' | 'duration';
export type AlbumSortField = 'title' | 'artist' | 'year';
/** アーティスト詳細の曲一覧用。同一アーティストの曲なので 'artist' 軸は無い。 */
export type ArtistTrackSortField = 'title' | 'album' | 'duration' | 'year';
export type SortDirection = 'asc' | 'desc';

/** SortMenu の項目ラベルに使う i18n キー。並べ替え軸を足すときはここにも足す。 */
export type SortFieldLabelKey =
  | 'library.sortFieldTitle'
  | 'library.sortFieldAlbum'
  | 'library.sortFieldArtist'
  | 'library.sortFieldDuration'
  | 'library.sortFieldYear';

export type SortOrders = {
  songs: { field: SongSortField; direction: SortDirection };
  albums: { field: AlbumSortField; direction: SortDirection };
  /**
   * アーティスト詳細の曲一覧。既定は発売年降順（同一年内はアルバム名→
   * ディスク→トラック番号順）。曲タブとは既定が異なるため別のキーで持つ。
   */
  artistTracks: { field: ArtistTrackSortField; direction: SortDirection };
};

const SONG_FIELDS: SongSortField[] = ['title', 'album', 'artist', 'duration'];
const ALBUM_FIELDS: AlbumSortField[] = ['title', 'artist', 'year'];
const ARTIST_TRACK_FIELDS: ArtistTrackSortField[] = ['title', 'album', 'duration', 'year'];

const DEFAULTS: SortOrders = {
  songs: { field: 'title', direction: 'asc' },
  albums: { field: 'title', direction: 'asc' },
  artistTracks: { field: 'year', direction: 'desc' },
};

function normalize(value: unknown): SortOrders {
  const saved = (value ?? {}) as Partial<{
    songs: Partial<SortOrders['songs']>;
    albums: Partial<SortOrders['albums']>;
    artistTracks: Partial<SortOrders['artistTracks']>;
  }>;
  const direction = (d: unknown, fallback: SortDirection): SortDirection =>
    d === 'asc' || d === 'desc' ? d : fallback;
  return {
    songs: {
      field: SONG_FIELDS.includes(saved.songs?.field as SongSortField)
        ? (saved.songs!.field as SongSortField)
        : DEFAULTS.songs.field,
      direction: direction(saved.songs?.direction, DEFAULTS.songs.direction),
    },
    albums: {
      field: ALBUM_FIELDS.includes(saved.albums?.field as AlbumSortField)
        ? (saved.albums!.field as AlbumSortField)
        : DEFAULTS.albums.field,
      direction: direction(saved.albums?.direction, DEFAULTS.albums.direction),
    },
    artistTracks: {
      field: ARTIST_TRACK_FIELDS.includes(saved.artistTracks?.field as ArtistTrackSortField)
        ? (saved.artistTracks!.field as ArtistTrackSortField)
        : DEFAULTS.artistTracks.field,
      direction: direction(saved.artistTracks?.direction, DEFAULTS.artistTracks.direction),
    },
  };
}

export function useSortOrders() {
  const [sortOrders, setSortOrders] = useState<SortOrders>(DEFAULTS);
  const [ready, setReady] = useState(false);
  // setSongSort/setAlbumSort から見るための ref。読み込み前に書き込みが
  // 走ると、prev がまだ DEFAULTS のままなので、保存済みの値を既定値で
  // 丸ごと上書きしてしまう（→ SettingsProvider の readyRef と同じ理由）。
  const readyRef = useRef(false);
  // 読み込みが届いた最初のコミットだけ、保存 effect をスキップするための
  // ref。→ 下の保存 effect のコメント参照。
  const hasHydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = normalize(await readJson(StorageKeys.sortOrder));
      if (cancelled) return;
      setSortOrders(saved);
      readyRef.current = true;
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 保存は setState の更新関数の外、コミット後の副作用としてだけ行う
  // （SettingsProvider と同じ理由・同じ形。→ src/settings.tsx のコメント）。
  // 以前は setSongSort/setAlbumSort の中の
  // setSortOrders((prev) => { ...; writeJson(...); return next }) という形で、
  // 更新関数（React が「純粋」を前提にする関数）の内側に書き込みを置いていた。
  useEffect(() => {
    if (!ready) return;
    if (!hasHydratedRef.current) {
      hasHydratedRef.current = true;
      return;
    }
    writeJson(StorageKeys.sortOrder, sortOrders).catch((e) => {
      console.warn('Failed to persist sort orders', e);
    });
  }, [sortOrders, ready]);

  const setSongSort = useCallback((field: SongSortField, direction: SortDirection) => {
    if (!readyRef.current) return;
    setSortOrders((prev) => ({ ...prev, songs: { field, direction } }));
  }, []);

  const setAlbumSort = useCallback((field: AlbumSortField, direction: SortDirection) => {
    if (!readyRef.current) return;
    setSortOrders((prev) => ({ ...prev, albums: { field, direction } }));
  }, []);

  const setArtistTrackSort = useCallback(
    (field: ArtistTrackSortField, direction: SortDirection) => {
      if (!readyRef.current) return;
      setSortOrders((prev) => ({ ...prev, artistTracks: { field, direction } }));
    },
    []
  );

  return { sortOrders, setSongSort, setAlbumSort, setArtistTrackSort };
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/**
 * 曲一覧を軸・方向で並べ替える。
 *
 * 方向（昇順/降順）は主軸にだけ効かせる。第2キー（アルバム順・発売年順の
 * ときはアルバム名、アーティスト順のときもアルバム名を挟んでから、最後は
 * 必ず compareByTrackOrder＝ディスク・トラック番号）は常に自然な順のままに
 * する。降順にしたときアルバム内の曲順まで逆転すると使い物にならない
 * （Pulsar 等の一般的な音楽アプリの挙動に合わせる）。
 *
 * 'year'（アーティスト詳細用）は曲ではなくアルバムの発売年で比較する。
 * albumYears（albumId→year）を渡さない/引けない曲は常に末尾に寄せる
 * （sortAlbums() の year 扱いと同じ理由・同じ形）。
 */
export function sortTracks(
  tracks: Track[],
  field: SongSortField | ArtistTrackSortField,
  direction: SortDirection,
  articleOptions: ArticleOptions,
  albumYears: Record<string, number> = {}
): Track[] {
  const sign = direction === 'asc' ? 1 : -1;
  const titleKey = (t: Track) => sortKeyOf(t.title, articleOptions);
  const artistKey = (t: Track) => sortKeyOf(t.artist, articleOptions);
  const albumKey = (t: Track) => sortKeyOf(t.album ?? '', articleOptions);
  const yearOf = (t: Track): number | null => (t.albumId ? (albumYears[t.albumId] ?? null) : null);

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
    if (field === 'artist' || field === 'year') {
      const albumDiff = collator.compare(albumKey(a), albumKey(b));
      if (albumDiff !== 0) return albumDiff;
    }
    return compareByTrackOrder(a, b);
  };

  return [...tracks].sort((a, b) => {
    if (field === 'year') {
      const ya = yearOf(a);
      const yb = yearOf(b);
      if (ya == null && yb != null) return 1;
      if (ya != null && yb == null) return -1;
      const primary = ya != null && yb != null && ya !== yb ? (ya - yb) * sign : 0;
      return primary !== 0 ? primary : compareSecondary(a, b);
    }
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
