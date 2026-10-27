/**
 * キューごとの再生設定（リピート・メドレーのON/OFF）の保存層を確かめる。
 *
 * src/queueStore.ts を、AsyncStorage だけメモリのスタブに差し替えて動かす。
 * 保存の読み書きを直列にする serialized() を外すと、3 と 8 が失敗する
 * （読んで書き戻す処理が重なって、項目が落ちる／古い値が後から書かれる）。
 * 再生の流れ（src/playback.tsx）はここでは確かめない。そちらは実機・エミュレータで見る。
 *
 * 実行: npm run check:queue-settings
 */
// このプロジェクトは @types/node を入れていないので、型なしで読む
const assert = require('assert');
const Module = require('module');

const store = new Map<string, string>();
const asyncStorageStub = {
  __esModule: true,
  default: {
    getItem: async (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: async (k: string, v: string) => {
      // 本物は非同期。順序の取り違えが出やすいよう、少し待つ
      await new Promise((r) => setTimeout(r, Math.random() * 3));
      store.set(k, v);
    },
    removeItem: async (k: string) => void store.delete(k),
    multiRemove: async (ks: string[]) => ks.forEach((k) => store.delete(k)),
    getAllKeys: async () => [...store.keys()],
  },
};

// import は先頭に巻き上げられるので、スタブを入れてから require する
const origLoad = Module._load;
Module._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === '@react-native-async-storage/async-storage') return asyncStorageStub;
  return origLoad.call(this, request, ...rest);
};

const qs = require('../src/queueStore') as typeof import('../src/queueStore');
const { StorageKeys } = require('../src/storage') as typeof import('../src/storage');

let n = 0;
const ok = (name: string) => console.log(`ok ${++n} - ${name}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1. 無いキューは null
  assert.strictEqual(await qs.loadPlaybackSettings('artist:x'), null);
  ok('保存が無いキューは null（戻さない）');

  // 2. 項目ごとの書き換えが、ほかの項目を消さない
  await qs.savePlaybackSettings('artist:x', { repeat: 0 });
  await qs.savePlaybackSettings('artist:x', { rushOn: false });
  assert.deepStrictEqual(await qs.loadPlaybackSettings('artist:x'), { repeat: 0, rushOn: false });
  ok('リピートとメドレーの保存が互いを消さない');

  // 3. 同時の書き込みでも項目が落ちない（読んで書き戻す処理が重なる）
  await Promise.all([
    qs.savePlaybackSettings('album:y', { repeat: 1 }),
    qs.savePlaybackSettings('album:y', { rushOn: true }),
    qs.savePlaybackSettings('album:y', { repeat: 2 }),
    qs.savePlaybackSettings('album:y', { rushOn: false }),
  ]);
  assert.deepStrictEqual(await qs.loadPlaybackSettings('album:y'), { repeat: 2, rushOn: false });
  ok('同時に4件書いても、最後の値で両項目が残る（直列化）');

  // 4. 壊れた値は捨てる（型の違う項目、配列、文字列）
  store.set(StorageKeys.playbackSettings('bad1'), JSON.stringify({ repeat: 'x', rushOn: 1 }));
  store.set(StorageKeys.playbackSettings('bad2'), JSON.stringify([1, 2]));
  store.set(StorageKeys.playbackSettings('bad3'), 'not json');
  store.set(StorageKeys.playbackSettings('part'), JSON.stringify({ repeat: 1, rushOn: 'yes' }));
  assert.deepStrictEqual(await qs.loadPlaybackSettings('bad1'), {});
  assert.strictEqual(await qs.loadPlaybackSettings('bad2'), null);
  assert.strictEqual(await qs.loadPlaybackSettings('bad3'), null);
  assert.deepStrictEqual(await qs.loadPlaybackSettings('part'), { repeat: 1 });
  ok('型の違う項目・配列・壊れたJSONは、その項目だけ捨てる');

  // 5. キューを消すと一緒に消える
  await qs.removeQueue('artist:x');
  assert.strictEqual(store.has(StorageKeys.playbackSettings('artist:x')), false);
  ok('removeQueue で再生設定の控えも消える');

  // 6. 上限であふれて捨てられたキューの控えも消える（シャッフル系は20件）
  for (let i = 0; i < 21; i++) {
    await qs.savePlaybackSettings(`artist:k${i}`, { repeat: 1, rushOn: true });
    await qs.touchQueue(`artist:k${i}`);
    await sleep(2); // lastUsedAt を確実にずらす
  }
  assert.strictEqual(store.has(StorageKeys.playbackSettings('artist:k0')), false, 'k0 は捨てられる');
  assert.strictEqual(store.has(StorageKeys.playbackSettings('artist:k20')), true, 'k20 は残る');
  ok('保存上限であふれたキューの控えも消え、新しい方は残る');

  // 7. 全曲は上限で捨てられない
  await qs.savePlaybackSettings('all', { repeat: 0, rushOn: false });
  await qs.touchQueue('all');
  for (let i = 0; i < 25; i++) {
    await qs.touchQueue(`album:z${i}`);
    await sleep(2);
  }
  assert.deepStrictEqual(await qs.loadPlaybackSettings('all'), { repeat: 0, rushOn: false });
  ok('全曲の控えは、他のキューの再生で押し出されない');

  // 8. 並びの保存を待つ間に届いたリピートの変更が、開始時点の値で潰されない。
  //    playFrom / resumeOrdered は、開始時点の控えを saveOrdered より先に列へ入れる前提
  const early = qs.savePlaybackSettings('seq:p', { repeat: 2, rushOn: true });
  const ordered = qs.saveOrdered('seq:p', ['a', 'b'], 0);
  const event = qs.savePlaybackSettings('seq:p', { repeat: 1 }); // onRepeatModeChange の保存
  await Promise.all([early, ordered, event]);
  assert.deepStrictEqual(await qs.loadPlaybackSettings('seq:p'), { repeat: 1, rushOn: true });
  ok('先に入れた控えは、後から届いたリピートの変更を潰さない');

  console.log(`\nall ${n} passed`);
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
