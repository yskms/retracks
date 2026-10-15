/**
 * 再生を始めたキューの一覧（レジストリ）と、キューごとの保存内容。
 *
 * シャッフルの順列とカーソルは src/shuffle.ts、順番再生の並びとカーソルはここ。
 * どちらも「再生位置」は playbackPosition(key) に、一覧と最終利用時刻は
 * shuffleIndex に入る。キュータブ（app/index.tsx）はこの一覧を読んで並べる。
 *
 * 捨てる規則：
 * - 全曲（all）は捨てない。1巡の進捗がこのアプリの肝なので、他のキューを
 *   たくさん再生したことで押し出されてはいけない
 * - シャッフル系は最後に再生を始めた順に20件、順番再生は10件まで残す。
 *   曲タップの再生は気軽に増えるので、数を分けて、シャッフルの進捗を
 *   押し出さないようにしている
 */

import {
  isOrderedKey,
  kindOfKey,
  type QueueKind,
  type QueueMeta,
} from './queueKeys';
import { readJson, remove, removeByPrefix, StorageKeys, writeJson } from './storage';

const ALL_KEY = 'all';
const MAX_KEPT_SHUFFLE = 20;
const MAX_KEPT_ORDERED = 10;

type Index = Record<string, number>;
type MetaMap = Record<string, QueueMeta>;

/**
 * 保存の処理を1本ずつ順に実行する。
 *
 * 一覧（shuffleIndex）とメタデータは「読んで、書き換えて、書き戻す」ので、2つの
 * 処理が重なると、後から書いた方が先の更新を消す。再生の開始は保存の完了を待たない
 * （曲タップで再生を遅らせないため）ので、別の再生をすぐ始めると実際に重なる
 * （同時に12件保存して一覧に1件しか残らないことを確認した）。一覧から消えた
 * キューのメタデータは touchQueue() が捨てるので、名前の情報まで一緒に失われる。
 * カーソルの書き込みも同じ列に並べ、保存（saveOrdered）より前の古い位置が
 * 後から書き戻されないようにする。
 *
 * 列の中で、別の列入りの関数を待たないこと（自分で自分を待って止まる）。
 * 内側で使うのは下の *Unlocked だけ。
 */
let chain: Promise<unknown> = Promise.resolve();

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  // 1つ失敗しても、後続の保存は続ける
  chain = run.catch(() => undefined);
  return run;
}

async function readIndex(): Promise<Index> {
  const index = await readJson<Index>(StorageKeys.shuffleIndex);
  return index && typeof index === 'object' && !Array.isArray(index) ? index : {};
}

async function readMeta(): Promise<MetaMap> {
  const meta = await readJson<MetaMap>(StorageKeys.queueMeta);
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
}

/** あるキューが持つ保存内容（順列・カーソル・位置・順番再生の並び）を全部消す。 */
async function removeQueueFiles(queueKey: string): Promise<void> {
  await remove(StorageKeys.shuffle(queueKey));
  await remove(StorageKeys.shuffleCursor(queueKey));
  await remove(StorageKeys.playbackPosition(queueKey));
  await remove(StorageKeys.ordered(queueKey));
  await remove(StorageKeys.orderedCursor(queueKey));
}

/** キューを使い始めたことを記録し、あふれた古いものを捨てる。 */
export function touchQueue(queueKey: string): Promise<void> {
  return serialized(() => touchQueueUnlocked(queueKey));
}

async function touchQueueUnlocked(queueKey: string): Promise<void> {
  const index = await readIndex();
  index[queueKey] = Date.now();

  const keep: Index = {};
  const drop: string[] = [];
  let shuffleCount = 0;
  let orderedCount = 0;

  for (const [key, usedAt] of Object.entries(index).sort((a, b) => b[1] - a[1])) {
    if (key === ALL_KEY) {
      keep[key] = usedAt;
    } else if (isOrderedKey(key)) {
      if (orderedCount++ < MAX_KEPT_ORDERED) keep[key] = usedAt;
      else drop.push(key);
    } else if (shuffleCount++ < MAX_KEPT_SHUFFLE) {
      keep[key] = usedAt;
    } else {
      drop.push(key);
    }
  }

  for (const key of drop) await removeQueueFiles(key);
  await writeJson(StorageKeys.shuffleIndex, keep);

  // 捨てたキューのメタデータも落とす
  const meta = await readMeta();
  const stale = Object.keys(meta).filter((key) => !(key in keep));
  if (stale.length > 0) {
    for (const key of stale) delete meta[key];
    await writeJson(StorageKeys.queueMeta, meta);
  }
}

/** キュータブの「削除」。全曲は消せない（呼び出し側でも弾く）。 */
export function removeQueue(queueKey: string): Promise<void> {
  if (queueKey === ALL_KEY) return Promise.resolve();
  return serialized(async () => {
    await removeQueueFiles(queueKey);

    const index = await readIndex();
    delete index[queueKey];
    await writeJson(StorageKeys.shuffleIndex, index);

    const meta = await readMeta();
    if (queueKey in meta) {
      delete meta[queueKey];
      await writeJson(StorageKeys.queueMeta, meta);
    }
  });
}

async function saveQueueMetaUnlocked(queueKey: string, meta: QueueMeta): Promise<void> {
  const all = await readMeta();
  all[queueKey] = meta;
  await writeJson(StorageKeys.queueMeta, all);
}

export function saveQueueMeta(queueKey: string, meta: QueueMeta): Promise<void> {
  return serialized(() => saveQueueMetaUnlocked(queueKey, meta));
}

export async function loadQueueMeta(queueKey: string): Promise<QueueMeta | null> {
  return (await readMeta())[queueKey] ?? null;
}

// ---- 順番再生（seq:）------------------------------------------------------

/**
 * 順番再生のキューを保存する。並びは作った時点のスナップショットで、
 * ライブラリに曲が増えても足さない（シャッフルの reconcile() とは違う）。
 * 利用者が「この並びで流した」ものを残すため。消えた曲は再開時に詰める。
 */
export function saveOrdered(
  queueKey: string,
  orderedIds: string[],
  cursor: number,
  /** 省略すると、保存済みのメタデータには触れない（続きからの再生で並びを詰め直すとき）。 */
  meta?: QueueMeta
): Promise<void> {
  return serialized(async () => {
    await writeJson(StorageKeys.ordered(queueKey), orderedIds);
    await writeJson(StorageKeys.orderedCursor(queueKey), cursor);
    await touchQueueUnlocked(queueKey);
    if (meta) await saveQueueMetaUnlocked(queueKey, meta);
  });
}

export async function loadOrdered(
  queueKey: string
): Promise<{ ids: string[]; cursor: number } | null> {
  const ids = await readJson<string[]>(StorageKeys.ordered(queueKey));
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const stored = await readJson<number>(StorageKeys.orderedCursor(queueKey));
  const cursor = typeof stored === 'number' ? stored : 0;
  return { ids, cursor: Math.min(Math.max(0, cursor), ids.length - 1) };
}

/** 曲が変わるたびに呼ぶ。並び本体は書き直さない（→ shuffle.ts の saveCursor）。 */
export function saveOrderedCursor(queueKey: string, cursor: number): Promise<void> {
  return serialized(() => writeJson(StorageKeys.orderedCursor(queueKey), cursor));
}

// ---- キュータブ向けの一覧 ------------------------------------------------

/** 保存されているキュー1件ぶん。表示用の組み立ては src/queueEntries.ts。 */
export type QueueSnapshot = {
  key: string;
  kind: Exclude<QueueKind, 'unknown'>;
  /** 曲IDの並び（シャッフルなら順列、順番再生なら再生順）。 */
  ids: string[];
  cursor: number;
  lastUsedAt: number;
  /** 旧データ（この機能の前に保存されたキュー）には無い。 */
  meta: QueueMeta | null;
};

export async function loadQueueSnapshots(): Promise<QueueSnapshot[]> {
  const [index, metaMap] = await Promise.all([readIndex(), readMeta()]);

  const snapshots = await Promise.all(
    Object.entries(index).map(async ([key, lastUsedAt]): Promise<QueueSnapshot | null> => {
      const kind = kindOfKey(key);
      if (kind === 'unknown') return null;

      const [ids, cursorRaw] =
        kind === 'seq'
          ? await Promise.all([
              readJson<string[]>(StorageKeys.ordered(key)),
              readJson<number>(StorageKeys.orderedCursor(key)),
            ])
          : await Promise.all([
              readJson<string[]>(StorageKeys.shuffle(key)),
              readJson<number>(StorageKeys.shuffleCursor(key)),
            ]);
      if (!Array.isArray(ids) || ids.length === 0) return null;

      const cursor = typeof cursorRaw === 'number' ? cursorRaw : 0;
      return {
        key,
        kind,
        ids,
        cursor: Math.min(Math.max(0, cursor), ids.length - 1),
        lastUsedAt: typeof lastUsedAt === 'number' ? lastUsedAt : 0,
        meta: metaMap[key] ?? null,
      };
    })
  );

  return snapshots
    .filter((snapshot): snapshot is QueueSnapshot => snapshot != null)
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

/**
 * 旧版が保存しないキュー（selection:）の再生位置を書き続けていた分を掃除する
 * （→ docs/requirements.md v2.48）。選んだ全曲のIDを連結した巨大な名前のキーで、
 * 一覧（shuffleIndex）に載らないため、他の方法では消えない。
 * 新しい曲選択のキーは songs: なので、ここで消す対象とは重ならない。
 */
export async function purgeLegacySelectionPositions(): Promise<void> {
  await removeByPrefix(StorageKeys.playbackPosition('selection:'));
}
