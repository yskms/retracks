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
};

export type LibrarySnapshot = {
  version: 1;
  scannedAt: number;
  tracks: Track[];
};

/** getAssetsAsync の first は 1〜1000 しか受け付けない。 */
const PAGE_SIZE = 1000;

/** 異常なライブラリで無限に回らないための保険。 */
const MAX_PAGES = 50;

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
    });

    for (const asset of page.assets) {
      tracks.push({
        id: asset.id,
        uri: asset.uri,
        title: asset.title || asset.filename,
        artist: asset.artist || 'Unknown',
        album: asset.albumTitle ?? null,
        // expo-music-library の duration は秒
        durationMs: Math.round((asset.duration || 0) * 1000),
      });
    }

    pages += 1;
    if (!page.hasNextPage || pages >= MAX_PAGES) break;
    after = page.endCursor;
  }

  return tracks;
}

export async function readCache(): Promise<LibrarySnapshot | null> {
  const cached = await readJson<LibrarySnapshot>(StorageKeys.library);
  if (!cached || cached.version !== 1 || !Array.isArray(cached.tracks)) return null;
  return cached;
}

export async function writeCache(tracks: Track[]): Promise<LibrarySnapshot> {
  const snapshot: LibrarySnapshot = {
    version: 1,
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
  albumCount: number;
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
  return list.map((a) => ({
    id: a.id,
    name: a.title || 'Unknown',
    albumCount: a.albumSongs ?? 0,
    trackCount: a.assetCount ?? 0,
  }));
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

function toTrack(asset: MusicLibrary.Asset): Track {
  return {
    id: asset.id,
    uri: asset.uri,
    title: asset.title || asset.filename,
    artist: asset.artist || 'Unknown',
    album: asset.albumTitle ?? null,
    durationMs: Math.round((asset.duration || 0) * 1000),
  };
}

/** 指定したアーティスト群に属する曲を集める（重複は排除。要件 5.2）。 */
export async function getTracksForArtists(ids: string[]): Promise<Track[]> {
  const seen = new Set<string>();
  const tracks: Track[] = [];
  for (const id of ids) {
    const page = await MusicLibrary.getArtistAssetsAsync(id, { first: PAGE_SIZE });
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
    const page = await MusicLibrary.getAlbumAssetsAsync(id, { first: PAGE_SIZE });
    for (const asset of page.assets) {
      if (seen.has(asset.id)) continue;
      seen.add(asset.id);
      tracks.push(toTrack(asset));
    }
  }
  return tracks;
}
