/**
 * 再生キューの識別子（キュー・キー）と、キューに付ける表示用メタデータ。
 *
 * ストレージにも React Native にも触れない純粋な関数だけを置く。保存・復元は
 * src/queueStore.ts と src/shuffle.ts、キー形式を使う側は src/playback.tsx。
 *
 * キーの形式（保存済みのデータを読み続けるため、`all` / `artist:` / `album:` は
 * 以前から変えていない）：
 *
 *   all                     全曲シャッフル
 *   artist:<ID,ID,...>      アーティスト（複数選択可）のシャッフル。IDは並べ替えて連結
 *   album:<ID,ID,...>       アルバム（複数選択可）のシャッフル。同上
 *   songs:<hash>-<件数>     曲を選んでのシャッフル（以前は保存しない selection:）
 *   seq:<hash>-<件数>       シャッフルしない再生。並びのハッシュなので、同じ並びなら
 *                           同じキーになる（複数選択の「順番に」など、一度きりの用途）
 *   seq:artist:<hash>       アーティスト／アルバムの詳細（と、1件だけ選んだ「順番に」）
 *   seq:album:<hash>        からの順番再生。「どこから再生したか」で決めるので、並べ替えや
 *                           曲の増減で並びが変わっても、1つの出所は1つのキューのまま
 *
 * **キーを分解して意味を取り出してはいけない。** MediaStore がIDを持たない曲は
 * アーティスト名・アルバム名がIDの代わりに入るため（→ library.ts の deriveArtists）、
 * 名前にカンマがあると `artist:` 以降をカンマで割れない。何のキューかは、再生を
 * 始めるときに QueueMeta として別に保存する（→ queueStore.ts）。分解してよいのは
 * 「メタデータの無い旧データを読むときの救済」だけ（legacySrcIds）。
 */

import type { Track } from './library';

export type QueueMode = 'all' | 'artist' | 'album' | 'songs';

/** キーから判るキューの種類。unknown は未知の形式（読まずに無視する）。 */
export type QueueKind = QueueMode | 'seq' | 'unknown';

/**
 * 文字列の 53bit ハッシュ（cyrb53）。キーを短くするためだけに使う。
 * 暗号用途ではない。衝突しても「別のキューを同じものとして扱う」だけで、
 * 順列は reconcile() が現在の曲集合に合わせ直す。
 */
function cyrb53(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** IDの並びのハッシュと件数。IDに何が入っていても曖昧にならないよう、制御文字で連結する。 */
function hashIds(ids: string[]): string {
  return `${cyrb53(ids.join('\u0001')).toString(36)}-${ids.length}`;
}

/**
 * シャッフル用のキュー・キー。
 *
 * 生成条件ごとに順列を持つため、別のキューを再生してから戻っても元のキューの
 * 順列と位置は失われない。選択順に依存しないよう並べ替えてから連結する。
 */
export function buildQueueKey(mode: QueueMode, ids: string[] = []): string {
  if (mode === 'all') return 'all';
  const sorted = [...ids].sort();
  if (mode === 'songs') return `songs:${hashIds(sorted)}`;
  return `${mode}:${sorted.join(',')}`;
}

/** シャッフルしない再生のキー。選択順・一覧の並び順が違えば別のキューになる。 */
export function buildOrderedKey(orderedIds: string[]): string {
  return `seq:${hashIds(orderedIds)}`;
}

/**
 * アーティスト／アルバムの詳細からの順番再生のキー。並びのハッシュ（buildOrderedKey）に
 * すると、詳細画面の並べ替えを変えただけ、曲を1つ足した・消しただけで別のキューになり、
 * 同じアーティストの項目が増えていく（順番再生の保存は10件までなので、残したい別の
 * アーティストの途中経過が押し出される）。出所のIDで決めれば、1つの出所は1項目のままで、
 * 別の曲をタップするとその項目の並びと位置を上書きする。
 * 並び自体は、キーに関係なく ordered: に保存する。
 */
export function buildOriginKey(kind: 'artist' | 'album', id: string): string {
  return `seq:${kind}:${cyrb53(id).toString(36)}`;
}

/**
 * アルバム詳細の「出所のID」。アルバム詳細は、開いた経路によって別の値を `id` に受け取る
 * （アルバムタブ・アーティスト詳細・検索は deriveAlbums() のID = albumId || アルバム名、
 * プレイヤー画面はアルバム名）。そのまま出所にすると、同じアルバムでも経路で
 * キュータブの項目が分かれるので、曲から deriveAlbums() と同じ規則（albumId || album）で
 * 求めたIDにそろえる。
 *
 * 曲が1種類のアルバムに揃わないとき（同じ名前の別のアルバムが、名前で引いて混ざった
 * 場合）や、曲がまだ読み込まれていないときは、勝手に決めず渡されたIDのまま使う。
 */
export function albumOriginId(tracks: Track[], routeId: string): string {
  const ids = new Set(tracks.map((t) => t.albumId || t.album || ''));
  if (ids.size !== 1) return routeId;
  const [only] = ids;
  return only || routeId;
}

export function kindOfKey(key: string): QueueKind {
  if (key === 'all') return 'all';
  if (key.startsWith('artist:')) return 'artist';
  if (key.startsWith('album:')) return 'album';
  if (key.startsWith('songs:')) return 'songs';
  if (key.startsWith('seq:')) return 'seq';
  return 'unknown';
}

export function isOrderedKey(key: string): boolean {
  return kindOfKey(key) === 'seq';
}

/**
 * キューに付ける表示用の情報。再生を始めるときに保存する。
 *
 * - srcIds: アーティスト／アルバムのIDの並び（artist / album のとき）。再開時に
 *   曲を絞り込み直すのに使う
 * - names: 表示名のスナップショット。IDが引けなくなった（ライブラリから消えた）
 *   あとも名前だけは出せるように持つ
 */
export type QueueMeta = {
  srcIds: string[];
  names: string[];
};

/** 選んだアーティスト／アルバムの表示名を、選んだ順で返す。 */
export function namesForSources(
  kind: 'artist' | 'album',
  ids: string[],
  source: Track[]
): string[] {
  const byId = new Map<string, string>();
  for (const t of source) {
    const id = kind === 'artist' ? t.artistId || t.artist : t.albumId || t.album || '';
    const name = kind === 'artist' ? t.artist : (t.album ?? '');
    if (id && name && !byId.has(id)) byId.set(id, name);
  }
  return ids.map((id) => byId.get(id)).filter((name): name is string => !!name);
}

/**
 * 曲の並びが「1枚のアルバム」または「1人のアーティスト」ぶんなら、その名前を返す。
 * そうでなければ空（表示側が先頭の曲名で代える）。曲を選んだキューと順番再生の
 * キューは、元がアルバム詳細なのか曲一覧なのかを再生の入口で区別していないので、
 * 中身から推測する。
 */
export function summarizeTracks(tracks: Track[]): string[] {
  if (tracks.length === 0) return [];
  const albumKeys = new Set(tracks.map((t) => t.albumId || t.album || ''));
  if (albumKeys.size === 1 && tracks[0].album) return [tracks[0].album];
  const artistKeys = new Set(tracks.map((t) => t.artistId || t.artist));
  if (artistKeys.size === 1 && tracks[0].artist) return [tracks[0].artist];
  return [];
}

/** 再生を始めるときに保存する QueueMeta。'all' は固定の名前で足りるので持たない。 */
export function buildMeta(
  kind: 'artist' | 'album' | 'songs' | 'seq',
  ids: string[],
  source: Track[]
): QueueMeta {
  if (kind === 'artist' || kind === 'album') {
    return { srcIds: [...ids], names: namesForSources(kind, ids, source) };
  }
  return { srcIds: [], names: summarizeTracks(source) };
}

/**
 * メタデータが無い旧データ（この機能の前に保存された artist: / album:）から、
 * 選択したIDを推測する。いまのライブラリに実在するIDだけで組み立てられたときに
 * 限って返し、割り切れなければ null。
 *
 * 単純に `split(',')` しないのは、IDの代わりに入った名前にカンマがあり得るため
 * （例: アーティスト名 "Earth, Wind & Fire"）。
 */
export function legacySrcIds(key: string, knownIds: ReadonlySet<string>): string[] | null {
  const rest = key.slice(key.indexOf(':') + 1);
  if (!rest) return null;
  if (knownIds.has(rest)) return [rest];
  const pieces = rest.split(',');
  return pieces.every((piece) => knownIds.has(piece)) ? pieces : null;
}

/** アーティスト／アルバムとして実在するIDの集合（legacySrcIds 用）。 */
export function knownSourceIds(kind: 'artist' | 'album', tracks: Track[]): Set<string> {
  const ids = new Set<string>();
  for (const t of tracks) {
    const id = kind === 'artist' ? t.artistId || t.artist : t.albumId || t.album || '';
    if (id) ids.add(id);
  }
  return ids;
}
