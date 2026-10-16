/**
 * キュータブの1行ぶん（QueueEntry）の組み立て。
 *
 * 保存されているキュー（QueueSnapshot）に、いまのライブラリと「いま鳴っている曲」を
 * 突き合わせて、行に出す材料にする。文言（i18n）はここでは作らず、部品だけを返す。
 * React にも保存層にも触れない純粋な関数なので、そのまま単体で検証できる。
 */

import { legacySrcIds, type QueueKind } from './queueKeys';
import type { QueueSnapshot } from './queueStore';
import type { Album, Artist, Track } from './library';

export type QueueEntry = {
  key: string;
  kind: Exclude<QueueKind, 'unknown'>;
  /**
   * 表示名（アーティスト名・アルバム名など）。1件目を出し、2件目以降は「ほか」で
   * まとめる。空なら leadTrack の曲名で代える。
   */
  names: string[];
  /** names が空のときの代わり。キューの先頭の曲（ライブラリに無ければ null）。 */
  leadTrack: Track | null;
  /**
   * 見出しの「先頭の曲名 ほか N件」の元になる数（曲数）。名前が無いとき（旧データなど）だけ使う。
   * 名前があれば、見出しは名前を全部連ねる（→ LibraryPages.queueTitle）。
   */
  count: number;
  /** 何曲目か（1始まり）と、全部で何曲か。 */
  played: number;
  total: number;
  /** 途中だった曲。ライブラリに無ければ null。 */
  currentTrack: Track | null;
  /** 続きから再生できるか。曲が1つもライブラリに見つからなければ false。 */
  available: boolean;
  /** いま鳴っているキューか。 */
  active: boolean;
};

export type QueueEntryContext = {
  tracks: Track[];
  artists: Artist[];
  albums: Album[];
  /** いま鳴っているキューのキー。無ければ null。 */
  activeKey: string | null;
  /** いま鳴っている曲のキュー内の位置と、キューの長さ、その曲。 */
  activeIndex: number;
  activeQueueLength: number;
  activeTrack: Track | null;
};

export function buildQueueEntries(
  snapshots: QueueSnapshot[],
  context: QueueEntryContext
): QueueEntry[] {
  const { tracks, artists, albums } = context;
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const artistById = new Map(artists.map((a) => [a.id, a.name]));
  const albumById = new Map(albums.map((a) => [a.id, a.title]));

  // メタデータの無い旧データの救済に使う（実在するIDだけで組み立て直せたときだけ拾う）
  const knownArtists = new Set(artistById.keys());
  const knownAlbums = new Set(albumById.keys());

  const entries = snapshots.map((snapshot): QueueEntry => {
    const { key, kind, ids, cursor, meta } = snapshot;
    const active = key === context.activeKey;

    let names: string[] = meta?.names ?? [];
    let available: boolean;

    if (kind === 'artist' || kind === 'album') {
      const byId = kind === 'artist' ? artistById : albumById;
      const srcIds =
        meta?.srcIds.length ? meta.srcIds : legacySrcIds(key, kind === 'artist' ? knownArtists : knownAlbums);
      // いまのライブラリでの名前を優先する（タグを直した後も追従する）。
      // 引けないIDがあれば、保存しておいた名前に戻す。
      const live = (srcIds ?? []).map((id) => byId.get(id)).filter((n): n is string => !!n);
      if (live.length > 0 && live.length === srcIds?.length) names = live;
      available = live.length > 0;
    } else if (kind === 'all') {
      available = tracks.length > 0;
    } else {
      available = ids.some((id) => trackById.has(id));
    }

    const leadTrack = names.length === 0 ? (trackById.get(ids[0]) ?? null) : null;
    const total = active && context.activeQueueLength > 0 ? context.activeQueueLength : ids.length;
    const played = active && context.activeIndex >= 0 ? context.activeIndex + 1 : cursor + 1;
    const currentTrack = active
      ? (context.activeTrack ?? trackById.get(ids[cursor]) ?? null)
      : (trackById.get(ids[cursor]) ?? null);

    return {
      key,
      kind,
      names,
      leadTrack,
      count: total,
      played: Math.min(played, total),
      total,
      currentTrack,
      available,
      active,
    };
  });

  // 全曲は、いつ使ったかに関わらず1番上に固定する（保存上限で押し出されないことが、
  // 並びからも分かる）。残りは、渡された順（新しい順）のまま。
  return [...entries.filter((e) => e.kind === 'all'), ...entries.filter((e) => e.kind !== 'all')];
}
