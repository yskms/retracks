/**
 * シャッフルの順列と1巡状態の管理（要件 6.2）。
 *
 * このアプリの肝。「シャッフルにしても同じ曲ばかり流れ、大半の曲が一生再生されない」
 * 問題の原因は、1巡し終わる前にアプリを閉じ、次回また先頭から引き直すことにある。
 * 3000曲入っていても1回のセッションで聴くのは数十曲なので、毎回引き直すと
 * 「新しい順列の先頭数十曲」しか聴かないまま終わる。
 *
 * そこで順列と現在位置を永続化し、1巡し切るまで既再生曲を出さない。
 */

import { readJson, StorageKeys, writeJson } from './storage';

export type ShuffleState = {
  /** 曲IDの並び。1巡ぶんの順列。 */
  order: string[];
  /** いま再生している曲の order 内での位置。これより前は再生済み。 */
  cursor: number;
};

export type QueueMode = 'all' | 'artist' | 'album' | 'selection';

/**
 * 順列の保存単位となるキー。生成条件ごとに順列を持つため、
 * 別のキューを再生してから戻っても元のキューの順列と位置は失われない。
 */
export function buildQueueKey(mode: QueueMode, ids: string[] = []): string {
  if (mode === 'all') return 'all';
  // 選択順に依存しないよう並べ替えてから連結する。
  // 'selection'（曲を直接選んだ場合）も専用のキーになるため、
  // 全曲シャッフルの1巡状態を上書きしてしまうことはない。
  return `${mode}:${[...ids].sort().join(',')}`;
}

/**
 * 順列を作る。
 *
 * @param avoidFirstId 直前に再生した曲。2巡目の先頭が1巡目の末尾と同じになると
 *                     同じ曲が2回続くので、その場合だけ引き直す（要件 6.2）。
 */
export function createOrder(ids: string[], avoidFirstId?: string | null): string[] {
  const order = [...ids];

  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  if (avoidFirstId && order.length > 1 && order[0] === avoidFirstId) {
    const swapWith = 1 + Math.floor(Math.random() * (order.length - 1));
    [order[0], order[swapWith]] = [order[swapWith], order[0]];
  }

  return order;
}

export type ReconcileResult = {
  state: ShuffleState;
  /** 順列に差し込んだ曲 */
  added: string[];
  /** 順列から取り除いた曲 */
  removed: string[];
};

/**
 * ライブラリの増減を順列に反映する（要件 6.2）。
 *
 * - 削除された曲は順列から取り除く。カーソルより前が消えた分だけカーソルを詰める
 * - 追加された曲は未消化部分（現在の曲より後ろ）にランダムに差し込む。
 *   こうすると新しく入れた曲が1巡を待たずに出てくる
 */
export function reconcile(state: ShuffleState, currentIds: string[]): ReconcileResult {
  const present = new Set(currentIds);
  const known = new Set(state.order);

  const kept: string[] = [];
  let removedBeforeCursor = 0;
  const removed: string[] = [];

  state.order.forEach((id, index) => {
    if (present.has(id)) {
      kept.push(id);
      return;
    }
    removed.push(id);
    if (index < state.cursor) removedBeforeCursor += 1;
  });

  const cursor = Math.max(0, state.cursor - removedBeforeCursor);
  const added = currentIds.filter((id) => !known.has(id));

  for (const id of added) {
    // 現在の曲は動かしたくないので cursor + 1 以降に入れる
    const min = Math.min(cursor + 1, kept.length);
    const position = min + Math.floor(Math.random() * (kept.length - min + 1));
    kept.splice(position, 0, id);
  }

  return {
    state: { order: kept, cursor: Math.min(cursor, Math.max(0, kept.length - 1)) },
    added,
    removed,
  };
}

/** 1巡し終わったか。 */
export function isCycleComplete(state: ShuffleState): boolean {
  return state.order.length > 0 && state.cursor >= state.order.length - 1;
}

/** 進捗（例：109 / 982）。要件 6.3 の表示に使う。 */
export function progressOf(state: ShuffleState): { played: number; total: number } {
  return {
    played: Math.min(state.cursor + 1, state.order.length),
    total: state.order.length,
  };
}

// ---- 永続化 -----------------------------------------------------------

export async function loadShuffle(queueKey: string): Promise<ShuffleState | null> {
  const order = await readJson<string[]>(StorageKeys.shuffle(queueKey));
  if (!Array.isArray(order) || order.length === 0) return null;

  const stored = await readJson<number>(StorageKeys.shuffleCursor(queueKey));
  const cursor = typeof stored === 'number' ? stored : 0;

  return {
    order,
    cursor: Math.min(Math.max(0, cursor), order.length - 1),
  };
}

export async function saveShuffle(queueKey: string, state: ShuffleState): Promise<void> {
  await writeJson(StorageKeys.shuffle(queueKey), state.order);
  await writeJson(StorageKeys.shuffleCursor(queueKey), state.cursor);
}

/**
 * カーソルだけ保存する。曲が変わるたびに呼ばれるので、
 * 順列本体（1025曲なら数十KB）を書き直さずに済むようキーを分けている。
 */
export async function saveCursor(queueKey: string, cursor: number): Promise<void> {
  await writeJson(StorageKeys.shuffleCursor(queueKey), cursor);
}

/**
 * キューを開始するための順列を用意する。
 *
 * 保存済みの順列があればライブラリの増減を反映して再開し、無ければ新しく作る。
 * これが「アプリを閉じても1巡の続きから再生される」の入り口。
 */
export async function prepareShuffle(
  queueKey: string,
  ids: string[]
): Promise<{ state: ShuffleState; resumed: boolean; added: string[]; removed: string[] }> {
  const saved = await loadShuffle(queueKey);

  if (saved) {
    const { state, added, removed } = reconcile(saved, ids);
    if (state.order.length > 0) {
      await saveShuffle(queueKey, state);
      return { state, resumed: true, added, removed };
    }
  }

  const state: ShuffleState = { order: createOrder(ids), cursor: 0 };
  await saveShuffle(queueKey, state);
  return { state, resumed: false, added: [], removed: [] };
}

/**
 * 1巡し終わったので次の巡を用意する（リピートON時）。
 * 2巡目の先頭が1巡目の末尾と同じにならないようにする。
 */
export async function startNextCycle(
  queueKey: string,
  ids: string[],
  lastPlayedId: string | null
): Promise<ShuffleState> {
  const state: ShuffleState = { order: createOrder(ids, lastPlayedId), cursor: 0 };
  await saveShuffle(queueKey, state);
  return state;
}
