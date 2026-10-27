/**
 * 「最近追加」タブの組み立て（要件 10.4）。
 *
 * 曲の追加日（Track.addedAt）から、「アーティスト × 追加した日」ごとの行を毎回作る。
 * 保存はしない。キュータブ（src/queueStore.ts）のように一覧を持つと、持った時点からしか
 * 追加が分からず、アプリを開いていない間に増えた曲は取りこぼす。追加日は端末が持っているので、
 * 開くたびに新しい順の上位 MAX_RECENT_GROUPS 行を取り直せば、古い行は新しい追加に押し出されて
 * 自然に消え、端末から消した曲も自動で外れる。
 *
 * React にも保存層にも触れない純粋な関数だけを置く（`npm run check:recent-groups` で単体で確かめる）。
 *
 * **グループのキー（RecentGroup.key）を分解して意味を取り出さない**（queueKeys.ts と同じ理由。
 * アーティストが ID を持たない曲は名前がキーの代わりに入り、名前にどんな文字が入るか分からない）。
 * 行から先へ渡すときは artistKey と day をそれぞれ持って渡す。
 */

import { compareByTrackOrder, type Track } from './library';

/**
 * 行の上限。キュータブの保存上限（シャッフル20・順番再生10）に合わせた「何件かで押し出される」
 * 数で、1日に数人のアルバムを足す使い方なら10日分ほどになる。
 */
export const MAX_RECENT_GROUPS = 30;

/** 曲が属するアーティストのキー。deriveArtists() と同じ規則（artistId、無ければ名前）。 */
export function artistKeyOf(track: Track): string {
  return track.artistId || track.artist;
}

/**
 * 端末のタイムゾーンでの暦日（YYYY-MM-DD）。まとめる単位を「日」にしたのは、
 * アルバムや1人の曲は、足す作業が数分〜数時間に収まるうえ、ひと続きの作業の途中で
 * 境目が来にくく、「今日」「昨日」と呼べて行の見出しに出せるため。
 * 数時間ごとの固定の窓にすると、作業の途中で行が割れる。
 */
export function dayKeyOf(ms: number): string {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export type RecentGroup = {
  /** 選択・一覧のキー用。分解しない。 */
  key: string;
  artistKey: string;
  artist: string;
  /** 追加した日（dayKeyOf）。 */
  day: string;
  /** グループ内で最後に追加された時刻。行の並び順に使う。 */
  addedAt: number;
  /** 行のジャケット。グループ内の、最後に追加された曲のもの（無ければ他の曲）。 */
  artworkUri: string | null;
  /** 並びは inGroupOrder()。 */
  tracks: Track[];
};

/** グループの中の並び。アルバム単位にまとめて、ディスク→トラック番号の順。 */
export function inGroupOrder(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) => {
    const albumA = a.album ?? '';
    const albumB = b.album ?? '';
    if (albumA !== albumB) return albumA.localeCompare(albumB);
    const idA = a.albumId ?? '';
    const idB = b.albumId ?? '';
    if (idA !== idB) return idA.localeCompare(idB);
    return compareByTrackOrder(a, b);
  });
}

function groupKeyOf(artistKey: string, day: string): string {
  // 制御文字で連結する（アーティスト名に何が入っていても、別の組と混ざらない）
  return `${day}\u0001${artistKey}`;
}

/**
 * 追加日が分かる曲を「アーティスト × 日」にまとめ、新しい順に limit 行まで返す。
 * 追加日が 0（取れなかった曲）は対象外。
 *
 * 同じ日の中の行は、そのアーティストの曲を最後に追加した順。
 */
export function buildRecentGroups(tracks: Track[], limit = MAX_RECENT_GROUPS): RecentGroup[] {
  const byKey = new Map<string, Track[]>();
  for (const track of tracks) {
    if (!(track.addedAt > 0)) continue;
    const key = groupKeyOf(artistKeyOf(track), dayKeyOf(track.addedAt));
    const list = byKey.get(key);
    if (list) list.push(track);
    else byKey.set(key, [track]);
  }

  // 上限に入る行だけ並び（inGroupOrder）を作る。端末に曲をまとめて入れた日は、
  // アーティストが数千になりうるので、捨てる行の並べ替えまではしない
  const heads: { key: string; list: Track[]; latest: Track }[] = [];
  for (const [key, list] of byKey) {
    heads.push({ key, list, latest: list.reduce((a, b) => (b.addedAt > a.addedAt ? b : a)) });
  }
  heads.sort((a, b) => b.latest.addedAt - a.latest.addedAt);

  return heads.slice(0, limit).map(({ key, list, latest }) => ({
    key,
    artistKey: artistKeyOf(latest),
    artist: latest.artist,
    day: dayKeyOf(latest.addedAt),
    addedAt: latest.addedAt,
    artworkUri: latest.artworkUri ?? list.find((t) => t.artworkUri != null)?.artworkUri ?? null,
    tracks: inGroupOrder(list),
  }));
}

/**
 * 1つのグループの曲を、曲一覧から引き直す（詳細画面用）。
 * buildRecentGroups() の結果から探さないのは、詳細を開いている間に新しい追加で行が
 * 上限から押し出されても、詳細の中身が消えないようにするため。
 */
export function tracksOfGroup(tracks: Track[], artistKey: string, day: string): Track[] {
  return inGroupOrder(
    tracks.filter(
      (t) => t.addedAt > 0 && artistKeyOf(t) === artistKey && dayKeyOf(t.addedAt) === day
    )
  );
}

/** 選んだグループの曲を、行の並びのまま1つの並びにする（アーティスト名の重複は呼び出し側で除く）。 */
export function tracksOfGroups(groups: RecentGroup[]): Track[] {
  return groups.flatMap((g) => g.tracks);
}

/** 選んだグループのアーティスト名。同じアーティストを別の日で2行選んでも1つにする。 */
export function artistNamesOf(groups: RecentGroup[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const g of groups) {
    if (seen.has(g.artistKey)) continue;
    seen.add(g.artistKey);
    names.push(g.artist);
  }
  return names;
}

/** 行の日付の言い方。今日・昨日はラベルで、それより前は日付で返す。 */
export type DayLabel = { kind: 'today' } | { kind: 'yesterday' } | { kind: 'date'; ms: number };

/**
 * day（YYYY-MM-DD）を、now から見た言い方にする。日付で返すとき ms は、その日の正午
 * （夏時間の切り替わりで日がずれないよう、0時を避ける）。
 */
export function labelOfDay(day: string, now: number = Date.now()): DayLabel {
  if (day === dayKeyOf(now)) return { kind: 'today' };
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === dayKeyOf(yesterday.getTime())) return { kind: 'yesterday' };
  const [y, m, d] = day.split('-').map(Number);
  return { kind: 'date', ms: new Date(y, m - 1, d, 12).getTime() };
}
