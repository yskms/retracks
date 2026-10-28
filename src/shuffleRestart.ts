/**
 * 鳴っているシャッフルのキューを、もう一度始める操作（全曲のFAB、アーティスト／アルバム詳細の
 * 「シャッフル」、曲タブの複数選択のシャッフル）を、積み直さずに済ませてよいかの判定。
 * 依存を持たない純粋な関数にしてある（tools/check-keep-playing.ts で確かめる）。
 *
 * 積み直すと、最大5秒前に保存した位置まで巻き戻る（resumeQueue() の呼び出し側が、鳴っている
 * キューを弾くのと同じ理由。app/index.tsx の openQueue）。1巡完了の await と重なると、前の巡の
 * 位置が新しい巡の先頭に使われる窓もある（docs/requirements.md 13.9）。
 *
 * 一方、積み直し（prepareShuffle → reconcile）は、再生中に増減した曲を順列へ反映する役割も持つ。
 * キーは出所（`artist:<id>`、`all` など）で決まり、再スキャンで中身が変わってもキーは同じなので、
 * 曲の集合が違うときは積み直す（並びが同じかは問わない。1巡完了の await 中は、鳴っている
 * 順列がまだ前の巡のものだが、集合は同じ）。
 */

/** 2つの曲IDの集合が同じか（順序は問わない）。 */
export function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const id of right) {
    if (!left.has(id)) return false;
  }
  return true;
}

export type KeepActiveShuffleInput = {
  /** いま鳴っているキューのキー（playback.tsx の queueKeyRef）。 */
  activeKey: string;
  /** これから始めようとしているキューのキー。 */
  key: string;
  /**
   * いま鳴っている順列（playback.tsx の shuffleRef.current?.order）。シャッフルしていない
   * 再生（曲タブのタップなど。キーが全曲のまま、シャッフル状態が無い）は null。
   */
  activeOrder: readonly string[] | null;
  /** これから始めようとしているキューの曲ID。 */
  sourceIds: readonly string[];
  isPlaying: boolean;
};

/**
 * 同じシャッフルのキューが再生中で、曲の集合も変わっていないなら true（何もしなくてよい）。
 * 一時停止中、再生を終えた後、読み込み中は false（従来どおり積み直して再生を始める）。
 */
export function canKeepActiveShuffle(input: KeepActiveShuffleInput): boolean {
  return (
    input.isPlaying &&
    input.activeKey === input.key &&
    input.activeOrder !== null &&
    sameIdSet(input.activeOrder, input.sourceIds)
  );
}
