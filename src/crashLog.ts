/**
 * ErrorBoundary が捕まえた未捕捉例外の履歴（要件 13章「安定性向上」）。
 *
 * ネイティブ側の ApplicationExitInfo 履歴（→ RetracksPlayer.getExitReasons()）と
 * 対になる、JS側レンダー中の例外の記録。リリースビルドでは componentDidCatch が
 * 拾わない限りその場で無言で終了するだけで、どこにも原因が残らない。ここに
 * 書いておけば、次に起動したときデバッグ画面から追える。
 */

import { readJson, StorageKeys, writeJson } from './storage';

export type CrashEntry = {
  timestamp: number;
  message: string;
  stack?: string;
  componentStack?: string;
};

/** 際限なく増えないよう、直近のものだけ残す。 */
const MAX_ENTRIES = 10;

export async function recordCrash(entry: CrashEntry): Promise<void> {
  const existing = (await readJson<CrashEntry[]>(StorageKeys.crashLog)) ?? [];
  await writeJson(StorageKeys.crashLog, [entry, ...existing].slice(0, MAX_ENTRIES));
}

export async function loadCrashLog(): Promise<CrashEntry[]> {
  return (await readJson<CrashEntry[]>(StorageKeys.crashLog)) ?? [];
}
