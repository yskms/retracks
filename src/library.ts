/**
 * 端末内の曲一覧の取得とキャッシュ。
 *
 * 実測で 1025曲の走査に 2.5〜4秒かかる（要件 13.4）。毎回の起動でこれを待たせたくないので、
 * 結果をキャッシュし、起動時はキャッシュを返してから裏で更新する。
 */

import * as MusicLibrary from 'expo-music-library';

import { RetracksPlayer, type TrackFolders } from '../modules/retracks-player/src';

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
  /**
   * MediaStore の IS_MUSIC。false なら着信音・通知音・アラーム・
   * オーディオブックなどの可能性が高い（expo-music-library はこの列を見ておらず、
   * 素通しになっていた。→ RetracksPlayer.getTrackFolders()）。
   * scanLibrary() 以外（アーティスト/アルバム詳細など）から作った Track は
   * 判定していないため既定で true（除外しない側）。
   */
  isMusic: boolean;
  /** 所属フォルダのID。scanLibrary() 以外から作った Track では null。 */
  folderId: string | null;
  /** 所属フォルダの表示名。folderId が null なら null。 */
  folderName: string | null;
  /**
   * アルバムID。無い曲もある（asset.albumId は string | undefined）ため、
   * アーティスト/アルバム一覧はこれが無ければ album（名前）でまとめる。
   * → deriveAlbums()
   */
  albumId: string | null;
  /** アーティストID。albumId と同じ理由で無い曲があり得る。→ deriveArtists() */
  artistId: string | null;
  /** アルバム内のトラック番号。無いこともある。アルバム詳細の並べ替えに使う。 */
  trackNumber: number | null;
  /** ディスク番号。無ければ1枚組として扱う。→ compareByTrackOrder() */
  discNumber: number | null;
};

export type LibrarySnapshot = {
  version: 5;
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

const ALBUM_ART_URI = 'content://media/external/audio/albumart';

/**
 * ジャケットの場所。アルバムIDから組み立てるだけで、存在の確認はしない。
 *
 * expo-music-library は openAssetFileDescriptor で開けるか確かめてから URI を
 * 返す。そのため、端末に曲を入れた直後など MediaStore がまだジャケットを
 * 用意していない時点で走査すると null になる。その null はキャッシュと
 * 再生キューに焼き付き、後からジャケットが生成されても出てこなくなる
 * （2026-09-08 に実際に発生。PC から曲を追加した直後にウィジェットのジャケットが
 * 消え、同じアルバムのジャケットはその後 98KB で存在していた）。
 *
 * URI はアルバムIDだけで決まるので、読めるかどうかは表示するときに判断すれば
 * よい。こうしておけば、あとからジャケットが用意された時点で自然に出る。
 */
function artworkUriOf(asset: {
  albumId?: string | null;
  artworkUri?: string | null;
  artwork?: string | null;
}): string | null {
  if (asset.albumId) return `${ALBUM_ART_URI}/${asset.albumId}`;
  return asset.artworkUri || asset.artwork || null;
}

const EMPTY_FOLDERS: TrackFolders = {
  nonMusicTrackIds: [],
  folderIdByTrackId: {},
  folderNames: {},
};

/**
 * folders/nonMusicSet は scanLibrary() だけが渡す。アーティスト/アルバムの詳細
 * など、そちらを経由しない Track は isMusic: true・folderId: null のまま
 * （これらの設定はアプリ全体の絞り込み用で、その場面ではまだ対象外なため。
 * → excludeShortTracks の既存の制約と同じ整理）。
 */
function toTrack(
  asset: MusicLibrary.Asset,
  folders: TrackFolders = EMPTY_FOLDERS,
  nonMusicSet?: Set<string>
): Track {
  const isNonMusic = (nonMusicSet ?? new Set(folders.nonMusicTrackIds)).has(asset.id);
  const folderId = folders.folderIdByTrackId[asset.id] ?? null;
  return {
    id: asset.id,
    uri: asset.uri,
    title: asset.title || asset.filename,
    artist: asset.artist || 'Unknown',
    album: asset.albumTitle ?? null,
    // expo-music-library の duration は秒
    durationMs: Math.round((asset.duration || 0) * 1000),
    artworkUri: artworkUriOf(asset),
    isMusic: !isNonMusic,
    folderId,
    folderName: folderId ? (folders.folderNames[folderId] ?? null) : null,
    albumId: asset.albumId ?? null,
    artistId: asset.artistId ?? null,
    trackNumber: asset.trackNumber ?? null,
    discNumber: asset.discNumber ?? null,
  };
}

export async function requestPermission(): Promise<boolean> {
  const res = await MusicLibrary.requestPermissionsAsync();
  return res.status === 'granted';
}

/** 端末を実際に走査する。 */
export async function scanLibrary(): Promise<Track[]> {
  // ページングと並行して投げる。曲の追加削除がその間に起きても、
  // 対応表に無い曲は isMusic: true・folderId: null に倒れるだけで安全
  // （→ RetracksPlayerModule.kt のコメント）。
  const foldersPromise = RetracksPlayer.getTrackFolders().catch(() => EMPTY_FOLDERS);

  const assets: MusicLibrary.Asset[] = [];
  let after: string | undefined;
  let pages = 0;

  for (;;) {
    // 並べ替えは playback.tsx が設定（冠詞無視など）を見て行うので、ここでは
    // 順序を指定しない（ページングが安定していれば十分）。
    const page = await MusicLibrary.getAssetsAsync({
      first: PAGE_SIZE,
      after,
      artwork: ARTWORK_MODE,
    });

    assets.push(...page.assets);

    pages += 1;
    if (!page.hasNextPage || pages >= MAX_PAGES) break;
    after = page.endCursor;
  }

  const folders = await foldersPromise;
  const nonMusicSet = new Set(folders.nonMusicTrackIds);
  return assets.map((asset) => toTrack(asset, folders, nonMusicSet));
}

export async function readCache(): Promise<LibrarySnapshot | null> {
  const cached = await readJson<LibrarySnapshot>(StorageKeys.library);
  // 版が上がったらキャッシュを捨てて走査し直す（アートワーク追加など）
  if (!cached || cached.version !== 5 || !Array.isArray(cached.tracks)) return null;
  return cached;
}

export async function writeCache(tracks: Track[]): Promise<LibrarySnapshot> {
  const snapshot: LibrarySnapshot = {
    version: 5,
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
  /** キャッシュを作った時刻。裏で走査し直すかの判断に使う。 */
  scannedAt: number;
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
    return {
      tracks: cached.tracks,
      source: 'cache',
      scannedAt: cached.scannedAt,
      elapsedMs: Date.now() - started,
    };
  }

  const tracks = await scanLibrary();
  const snapshot = await writeCache(tracks);
  return {
    tracks,
    source: 'scan',
    scannedAt: snapshot.scannedAt,
    elapsedMs: Date.now() - started,
  };
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
  /**
   * リリース年。音楽ファイルに埋め込まれた年を Android が取り込んだもの。
   * expo-music-library が公開していないため、自前モジュールで MediaStore から読む。
   * 年が入っていないファイルもあるため null になりうる。
   */
  year: number | null;
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
 * アーティスト名ごとの代表ジャケットを選ぶ。
 *
 * MediaStore はアーティストの写真を持っていないため、そのアーティストのアルバムの
 * ジャケットを流用する。リリース年が分かるものは最も新しいアルバムを使い、
 * 年が入っていない場合は最初に見つかったものを使う。
 */
export function artworkByArtist(albums: Album[]): Map<string, string> {
  const best = new Map<string, { uri: string; year: number }>();

  for (const album of albums) {
    if (!album.artworkUri) continue;
    const year = album.year ?? 0;
    const current = best.get(album.artist);
    if (!current || year > current.year) {
      best.set(album.artist, { uri: album.artworkUri, year });
    }
  }

  return new Map([...best].map(([artist, v]) => [artist, v.uri]));
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
  const [list, years] = await Promise.all([
    MusicLibrary.getAlbumsAsync(),
    RetracksPlayer.getAlbumYears().catch(() => ({}) as Record<string, number>),
  ]);

  return list.map((a) => ({
    id: a.id,
    title: a.title || 'Unknown',
    artist: a.artist || 'Unknown',
    trackCount: a.assetCount ?? 0,
    artworkUri: artworkUriOf({ albumId: a.id, artworkUri: a.artworkUri, artwork: a.artwork }),
    year: years[a.id] ?? null,
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
  const years = await RetracksPlayer.getAlbumYears().catch(
    () => ({}) as Record<string, number>
  );
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
      artworkUri: artworkUriOf(asset),
      year: null,
    });
  }

  // 年が分かるものは新しい順、分からないものは後ろへ
  const sorted = [...albums.values()]
    .map((album) => ({ ...album, year: years[album.id] ?? null }))
    .sort((a, b) => {
      if (a.year && b.year && a.year !== b.year) return b.year - a.year;
      if (a.year && !b.year) return -1;
      if (!a.year && b.year) return 1;
      return a.title.localeCompare(b.title);
    });

  return { albums: sorted, tracks };
}

/** アルバム1枚ぶんの曲。 */
export async function getAlbumTracks(albumId: string): Promise<Track[]> {
  const page = await MusicLibrary.getAlbumAssetsAsync(albumId, {
    first: PAGE_SIZE,
    artwork: ARTWORK_MODE,
  });
  return page.assets.map((asset) => toTrack(asset));
}
