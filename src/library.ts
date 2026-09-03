/**
 * 端末内の曲一覧の取得とキャッシュ。
 *
 * 実測で 1025曲の走査に 2.5〜4秒かかる（要件 13.4）。毎回の起動でこれを待たせたくないので、
 * 結果をキャッシュし、起動時はキャッシュを返してから裏で更新する。
 */

import * as MusicLibrary from 'expo-music-library';

import { readJson, StorageKeys, writeJson } from './storage';

export type Track = {
  id: string;
  uri: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  /**
   * 音楽ファイルに埋め込まれているアートワークの URI。
   * ネットワークからの取得は一切しない。無ければ null。
   */
  artworkUri: string | null;
};

export type LibrarySnapshot = {
  version: 2;
  scannedAt: number;
  tracks: Track[];
};

/** getAssetsAsync の first は 1〜1000 しか受け付けない。 */
const PAGE_SIZE = 1000;

/** 異常なライブラリで無限に回らないための保険。 */
const MAX_PAGES = 50;

/**
 * アートワークの取得方法。'uri' は遅延URIを返すだけなので走査は軽い。
 * 取得そのものを止めたい場合は 'none' にする。
 * 設定でON/OFFできるようにするときは、ここを差し替える。
 */
const ARTWORK_MODE = 'uri' as const;

function toTrack(asset: MusicLibrary.Asset): Track {
  return {
    id: asset.id,
    uri: asset.uri,
    title: asset.title || asset.filename,
    artist: asset.artist || 'Unknown',
    album: asset.albumTitle ?? null,
    // expo-music-library の duration は秒
    durationMs: Math.round((asset.duration || 0) * 1000),
    artworkUri: asset.artworkUri ?? null,
  };
}

export async function requestPermission(): Promise<boolean> {
  const res = await MusicLibrary.requestPermissionsAsync();
  return res.status === 'granted';
}

/** 端末を実際に走査する。 */
export async function scanLibrary(): Promise<Track[]> {
  const tracks: Track[] = [];
  let after: string | undefined;
  let pages = 0;

  for (;;) {
    const page = await MusicLibrary.getAssetsAsync({
      first: PAGE_SIZE,
      after,
      sortBy: 'title',
      artwork: ARTWORK_MODE,
    });

    for (const asset of page.assets) {
      tracks.push(toTrack(asset));
    }

    pages += 1;
    if (!page.hasNextPage || pages >= MAX_PAGES) break;
    after = page.endCursor;
  }

  return tracks;
}

export async function readCache(): Promise<LibrarySnapshot | null> {
  const cached = await readJson<LibrarySnapshot>(StorageKeys.library);
  // 版が上がったらキャッシュを捨てて走査し直す（アートワーク追加など）
  if (!cached || cached.version !== 2 || !Array.isArray(cached.tracks)) return null;
  return cached;
}

export async function writeCache(tracks: Track[]): Promise<LibrarySnapshot> {
  const snapshot: LibrarySnapshot = {
    version: 2,
    scannedAt: Date.now(),
    tracks,
  };
  await writeJson(StorageKeys.library, snapshot);
  return snapshot;
}

export type LoadResult = {
  tracks: Track[];
  /** キャッシュから読んだか、走査したか */
  source: 'cache' | 'scan';
  elapsedMs: number;
};

/**
 * 曲一覧を読み込む。キャッシュがあればそれを返す。
 * 走査による更新は refreshLibrary() を別途呼ぶこと（起動を待たせないため）。
 */
export async function loadLibrary(): Promise<LoadResult> {
  const started = Date.now();

  const cached = await readCache();
  if (cached && cached.tracks.length > 0) {
    return { tracks: cached.tracks, source: 'cache', elapsedMs: Date.now() - started };
  }

  const tracks = await scanLibrary();
  await writeCache(tracks);
  return { tracks, source: 'scan', elapsedMs: Date.now() - started };
}

export type RefreshResult = {
  tracks: Track[];
  added: string[];
  removed: string[];
  elapsedMs: number;
};

/** 走査し直してキャッシュを更新し、前回との差分を返す。 */
export async function refreshLibrary(previous: Track[]): Promise<RefreshResult> {
  const started = Date.now();
  const tracks = await scanLibrary();
  await writeCache(tracks);

  const before = new Set(previous.map((t) => t.id));
  const after = new Set(tracks.map((t) => t.id));

  return {
    tracks,
    added: tracks.filter((t) => !before.has(t.id)).map((t) => t.id),
    removed: previous.filter((t) => !after.has(t.id)).map((t) => t.id),
    elapsedMs: Date.now() - started,
  };
}

// ---- アーティスト / アルバム -------------------------------------------

export type Artist = {
  id: string;
  name: string;
  trackCount: number;
};

export type Album = {
  id: string;
  title: string;
  artist: string;
  trackCount: number;
  artworkUri: string | null;
};

export async function getArtists(): Promise<Artist[]> {
  const list = await MusicLibrary.getArtistsAsync();
  // 注意: Artist の albumSongs は MediaStore の NUMBER_OF_TRACKS（曲数）であって
  // アルバム数ではない。アルバム数は公開されていないため、アルバム一覧から数える
  // （→ countAlbumsByArtist）。
  return list.map((a) => ({
    id: a.id,
    name: a.title || 'Unknown',
    trackCount: a.assetCount ?? 0,
  }));
}

/**
 * アーティスト名ごとのアルバム数を数える。
 * MediaStore がアーティストのアルバム数を返さないため、アルバム一覧から求める。
 * コンピレーションなどアルバム側のアーティスト名が異なる場合は数えられない。
 */
export function countAlbumsByArtist(albums: Album[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const album of albums) {
    counts.set(album.artist, (counts.get(album.artist) ?? 0) + 1);
  }
  return counts;
}

export async function getAlbums(): Promise<Album[]> {
  const list = await MusicLibrary.getAlbumsAsync();
  return list.map((a) => ({
    id: a.id,
    title: a.title || 'Unknown',
    artist: a.artist || 'Unknown',
    trackCount: a.assetCount ?? 0,
    artworkUri: a.artworkUri ?? a.artwork ?? null,
  }));
}

/** 指定したアーティスト群に属する曲を集める（重複は排除。要件 5.2）。 */
export async function getTracksForArtists(ids: string[]): Promise<Track[]> {
  const seen = new Set<string>();
  const tracks: Track[] = [];
  for (const id of ids) {
    const page = await MusicLibrary.getArtistAssetsAsync(id, {
      first: PAGE_SIZE,
      artwork: ARTWORK_MODE,
    });
    for (const asset of page.assets) {
      if (seen.has(asset.id)) continue;
      seen.add(asset.id);
      tracks.push(toTrack(asset));
    }
  }
  return tracks;
}

/** 指定したアルバム群に属する曲を集める（重複は排除）。 */
export async function getTracksForAlbums(ids: string[]): Promise<Track[]> {
  const seen = new Set<string>();
  const tracks: Track[] = [];
  for (const id of ids) {
    const page = await MusicLibrary.getAlbumAssetsAsync(id, {
      first: PAGE_SIZE,
      artwork: ARTWORK_MODE,
    });
    for (const asset of page.assets) {
      if (seen.has(asset.id)) continue;
      seen.add(asset.id);
      tracks.push(toTrack(asset));
    }
  }
  return tracks;
}

/** アーティスト1人ぶんの内訳。アルバム単位でまとめつつ、全曲も返す。 */
export type ArtistDetail = {
  albums: Album[];
  tracks: Track[];
};

export async function getArtistDetail(artistId: string): Promise<ArtistDetail> {
  const page = await MusicLibrary.getArtistAssetsAsync(artistId, {
    first: PAGE_SIZE,
    artwork: ARTWORK_MODE,
  });

  const tracks: Track[] = [];
  const albums = new Map<string, Album>();

  for (const asset of page.assets) {
    tracks.push(toTrack(asset));

    // アルバムIDが取れない曲もあるので、その場合はアルバム名で束ねる
    const key = asset.albumId || asset.albumTitle || '';
    if (!key) continue;

    const existing = albums.get(key);
    if (existing) {
      existing.trackCount += 1;
      continue;
    }
    albums.set(key, {
      id: asset.albumId || key,
      title: asset.albumTitle || 'Unknown',
      artist: asset.artist || 'Unknown',
      trackCount: 1,
      artworkUri: asset.artworkUri ?? asset.artwork ?? null,
    });
  }

  return {
    albums: [...albums.values()].sort((a, b) => a.title.localeCompare(b.title)),
    tracks,
  };
}

/** アルバム1枚ぶんの曲。 */
export async function getAlbumTracks(albumId: string): Promise<Track[]> {
  const page = await MusicLibrary.getAlbumAssetsAsync(albumId, {
    first: PAGE_SIZE,
    artwork: ARTWORK_MODE,
  });
  return page.assets.map(toTrack);
}
