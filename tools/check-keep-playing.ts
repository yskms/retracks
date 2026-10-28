/**
 * 鳴っているシャッフルのキューを、もう一度始める操作を、積み直さずに済ませてよいかの判定
 * （src/shuffleRestart.ts）を確かめる。
 * 判定を呼ぶ側（src/playback.tsx の playTracks）と、実際に巻き戻らないことは、ここでは確かめない。
 * そちらはエミュレータで、修正の前後を同じ操作で比べる（docs/requirements.md 13.9）。
 *
 * 実行: npm run check:keep-playing
 */
// このプロジェクトは @types/node を入れていないので、型なしで読む
const assert = require('assert');

import { canKeepActiveShuffle, sameIdSet, type KeepActiveShuffleInput } from '../src/shuffleRestart';

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    console.error(`NG: ${name}`);
    throw error;
  }
}

// ---- sameIdSet ---------------------------------------------------------

check('sameIdSet: 順序が違っても集合が同じなら true', () => {
  assert.strictEqual(sameIdSet(['a', 'b', 'c'], ['c', 'a', 'b']), true);
});
check('sameIdSet: 空と空は true', () => {
  assert.strictEqual(sameIdSet([], []), true);
});
check('sameIdSet: 件数が違えば false（増えた）', () => {
  assert.strictEqual(sameIdSet(['a', 'b'], ['a', 'b', 'c']), false);
});
check('sameIdSet: 件数が違えば false（減った）', () => {
  assert.strictEqual(sameIdSet(['a', 'b', 'c'], ['a', 'b']), false);
});
check('sameIdSet: 件数が同じでも、中身が違えば false（入れ替わった）', () => {
  assert.strictEqual(sameIdSet(['a', 'b', 'c'], ['a', 'b', 'd']), false);
});

// ---- canKeepActiveShuffle ---------------------------------------------

const base: KeepActiveShuffleInput = {
  activeKey: 'artist:1',
  key: 'artist:1',
  activeOrder: ['a', 'b', 'c'],
  sourceIds: ['a', 'b', 'c'],
  isPlaying: true,
};

check('同じキューが再生中で、曲の集合も同じなら true（積み直さない）', () => {
  assert.strictEqual(canKeepActiveShuffle(base), true);
});
check('鳴っている順列の並びが、渡された曲の並びと違っても true（1巡完了の await 中は前の巡の順列）', () => {
  assert.strictEqual(canKeepActiveShuffle({ ...base, activeOrder: ['c', 'a', 'b'], sourceIds: ['a', 'b', 'c'] }), true);
});
check('一時停止中・再生を終えた後・読み込み中（isPlaying が false）は false（積み直して再生を始める）', () => {
  assert.strictEqual(canKeepActiveShuffle({ ...base, isPlaying: false }), false);
});
check('別のキューを始めるなら false', () => {
  assert.strictEqual(canKeepActiveShuffle({ ...base, key: 'artist:2' }), false);
});
check('シャッフル状態が無い（曲タブのタップなど。キーが全曲のまま）なら false', () => {
  assert.strictEqual(canKeepActiveShuffle({ ...base, activeKey: 'all', key: 'all', activeOrder: null }), false);
});
check('再生中に曲が増えたなら false（積み直して、増えた曲を順列へ反映する）', () => {
  assert.strictEqual(canKeepActiveShuffle({ ...base, sourceIds: ['a', 'b', 'c', 'd'] }), false);
});
check('再生中に曲が減ったなら false（積み直して、消えた曲を外す）', () => {
  assert.strictEqual(canKeepActiveShuffle({ ...base, sourceIds: ['a', 'b'] }), false);
});
check('全曲（キー all）でも同じ判定', () => {
  const all = { ...base, activeKey: 'all', key: 'all' };
  assert.strictEqual(canKeepActiveShuffle(all), true);
  assert.strictEqual(canKeepActiveShuffle({ ...all, sourceIds: ['a', 'b', 'c', 'd'] }), false);
});

console.log(`${passed} checks passed`);
