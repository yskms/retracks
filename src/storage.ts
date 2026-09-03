/**
 * 永続化の薄いラッパ。
 *
 * 保存先に AsyncStorage を選んだ理由：
 * 保存するのは「曲一覧のキャッシュ」と「シャッフルの順列＋カーソル」だけで、
 * 検索・絞り込みは expo-music-library がネイティブ側で提供する（getArtistsAsync /
 * searchAssetsAsync 等）。関係データベースを持つ動機が薄い。
 * 1025曲で約200KB、読み込みは起動時の一度きり。
 *
 * SQLite へ移すべきタイミング：再生回数や再生履歴を曲ごとに持ち始めたとき
 * （要件 Phase 2 の「最も再生された」「最近再生された」）。書き込みが高頻度になり、
 * JSON 全体の読み書きでは割に合わなくなる。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'retracks';

export const StorageKeys = {
  library: `${PREFIX}:library:v1`,
  shuffle: (queueKey: string) => `${PREFIX}:shuffle:v1:${queueKey}`,
  /** 順列とは別に保存する。曲が変わるたびに書くため、順列本体を書き直さずに済む。 */
  shuffleCursor: (queueKey: string) => `${PREFIX}:shuffle-cursor:v1:${queueKey}`,
  /**
   * 曲の途中まで再生した位置。アプリを終了して再開したときに続きから鳴らすため。
   * 区間再生時は区間の先頭を 0 とした値。
   */
  playbackPosition: (queueKey: string) => `${PREFIX}:position:v1:${queueKey}`,
  /**
   * 区間設定。永続化しないとアプリ再起動のたびに既定値へ戻り、
   * ネイティブ側が「設定が変わった」と判定してキューを組み直してしまう。
   */
  settings: `${PREFIX}:settings:v1`,
} as const;

export async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw == null) return null;
    return JSON.parse(raw) as T;
  } catch {
    // 壊れた値は無いものとして扱う（次の書き込みで上書きされる）
    return null;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function remove(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}

/** デバッグ・動作確認用。retracks の保存内容だけを消す。 */
export async function clearAll(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const mine = keys.filter((k) => k.startsWith(`${PREFIX}:`));
  if (mine.length > 0) await AsyncStorage.multiRemove(mine);
}
