/**
 * 「最近追加」タブの組み立て（src/recentGroups.ts）を確かめる。
 *
 * 日付は端末のタイムゾーンで暦日に分けるので、ここでも new Date(y, m, d, h) のローカル時刻で
 * 作る（どのタイムゾーンで走らせても同じ結果になる）。
 * 表示（RecentPage・詳細画面）と、再生の流れ（src/playback.tsx）はここでは確かめない。
 * そちらは実機・エミュレータで見る。
 *
 * 実行: npm run check:recent-groups
 */
// このプロジェクトは @types/node を入れていないので、型なしで読む
const assert = require('assert');
const Module = require('module');

// src/library.ts は React Native と自前ネイティブモジュールを読み込む。比較関数だけ使うので、
// 読み込みだけ通るスタブに差し替える（import は先頭に巻き上げられるので、require の前に入れる）
const stub = { __esModule: true, default: {}, Platform: { OS: 'android' }, RetracksPlayer: {} };
const origLoad = Module._load;
Module._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (
    request === 'react-native' ||
    request === 'expo-music-library' ||
    request === '@react-native-async-storage/async-storage' ||
    request.includes('retracks-player')
  ) {
    return stub;
  }
  return origLoad.call(this, request, ...rest);
};

const rg = require('../src/recentGroups') as typeof import('../src/recentGroups');
type Track = import('../src/library').Track;

let n = 0;
const ok = (name: string) => console.log(`ok ${++n} - ${name}`);

let nextId = 0;
function track(over: Partial<Track> & { addedAt: number }): Track {
  const id = String(++nextId);
  return {
    id,
    uri: `content://${id}`,
    title: `t${id}`,
    artist: 'A',
    album: 'Alb',
    durationMs: 1000,
    artworkUri: null,
    isMusic: true,
    folderId: null,
    folderName: null,
    albumId: null,
    artistId: null,
    trackNumber: null,
    discNumber: null,
    ...over,
  };
}
const at = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime();
const ids = (tracks: Track[]) => tracks.map((t) => t.id);

// 1. 同じアーティスト・同じ日は1行、別の日・別のアーティストは別の行
{
  const a1 = track({ artist: 'A', addedAt: at(2026, 10, 27, 9) });
  const a2 = track({ artist: 'A', addedAt: at(2026, 10, 27, 23, 59) });
  const a3 = track({ artist: 'A', addedAt: at(2026, 10, 26, 23, 59) });
  const b1 = track({ artist: 'B', addedAt: at(2026, 10, 27, 10) });
  const groups = rg.buildRecentGroups([a1, a2, a3, b1]);
  assert.strictEqual(groups.length, 3);
  assert.deepStrictEqual(
    groups.map((g) => [g.artist, g.day, g.tracks.length]),
    [
      ['A', '2026-10-27', 2],
      ['B', '2026-10-27', 1],
      ['A', '2026-10-26', 1],
    ]
  );
  ok('アーティスト × 暦日でまとまる。深夜0時をまたぐと別の行');
}

// 2. 日の境目: 23:59 と 翌日 0:00 は別の行
{
  const late = track({ addedAt: at(2026, 10, 27, 23, 59) });
  const early = track({ addedAt: at(2026, 10, 28, 0, 0) });
  const groups = rg.buildRecentGroups([late, early]);
  assert.strictEqual(groups.length, 2);
  assert.deepStrictEqual(groups.map((g) => g.day), ['2026-10-28', '2026-10-27']);
  ok('23:59 と翌 0:00 は別の日');
}

// 3. 追加日が取れない曲（0）は対象外
{
  const none = track({ addedAt: 0 });
  const some = track({ addedAt: at(2026, 10, 27) });
  const groups = rg.buildRecentGroups([none, some]);
  assert.deepStrictEqual(groups.map((g) => ids(g.tracks)), [[some.id]]);
  ok('addedAt が 0 の曲は含めない');
}

// 4. 行の並びは「そのアーティストの曲を最後に追加した順」。上限を超えた古い行は落ちる
{
  const tracks: Track[] = [];
  for (let day = 1; day <= 40; day++) {
    tracks.push(track({ artist: `X${day}`, addedAt: at(2026, 9, 1) + day * 86400000 }));
  }
  const groups = rg.buildRecentGroups(tracks);
  assert.strictEqual(groups.length, rg.MAX_RECENT_GROUPS);
  assert.strictEqual(groups[0].artist, 'X40');
  assert.strictEqual(groups[groups.length - 1].artist, `X${40 - rg.MAX_RECENT_GROUPS + 1}`);
  assert.ok(groups.every((g, i) => i === 0 || groups[i - 1].addedAt >= g.addedAt));
  assert.strictEqual(rg.buildRecentGroups(tracks, 5).length, 5);
  ok('新しい順に上限まで。古い行は押し出される');
}

// 5. 同じ日の中では、最後に追加した順
{
  const a = track({ artist: 'A', addedAt: at(2026, 10, 27, 9) });
  const b = track({ artist: 'B', addedAt: at(2026, 10, 27, 11) });
  const a2 = track({ artist: 'A', addedAt: at(2026, 10, 27, 12) });
  const groups = rg.buildRecentGroups([a, b, a2]);
  assert.deepStrictEqual(groups.map((g) => g.artist), ['A', 'B']);
  ok('同じ日の行は、グループ内の最後の追加が新しい順');
}

// 6. アーティストのキーは artistId、無ければ名前（deriveArtists と同じ）。名前が同じでも ID が違えば別
{
  const withId1 = track({ artist: 'Same', artistId: '1', addedAt: at(2026, 10, 27) });
  const withId2 = track({ artist: 'Same', artistId: '2', addedAt: at(2026, 10, 27) });
  const noId1 = track({ artist: 'Same', artistId: null, addedAt: at(2026, 10, 27) });
  const noId2 = track({ artist: 'Same', artistId: null, addedAt: at(2026, 10, 27) });
  const groups = rg.buildRecentGroups([withId1, withId2, noId1, noId2]);
  assert.strictEqual(groups.length, 3);
  assert.strictEqual(groups.find((g) => g.artistKey === 'Same')?.tracks.length, 2);
  ok('artistId で分け、無い曲は名前でまとめる');
}

// 7. キーに制御文字・カンマ・日付に似た名前が入っても、別の組と混ざらない
{
  const odd1 = track({ artist: '2026-10-27\u0001A', addedAt: at(2026, 10, 27) });
  const plain = track({ artist: 'A', addedAt: at(2026, 10, 27) });
  const odd2 = track({ artist: 'Earth, Wind & Fire', addedAt: at(2026, 10, 27) });
  const groups = rg.buildRecentGroups([odd1, plain, odd2]);
  assert.strictEqual(groups.length, 3);
  assert.strictEqual(new Set(groups.map((g) => g.key)).size, 3);
  ok('アーティスト名に何が入っても、行が混ざらない');
}

// 8. グループ内の並びはアルバム単位で、ディスク→トラック番号
{
  const b2 = track({ album: 'B', albumId: 'b', trackNumber: 2, addedAt: at(2026, 10, 27) });
  const a2 = track({ album: 'A', albumId: 'a', trackNumber: 2, addedAt: at(2026, 10, 27) });
  const a1 = track({ album: 'A', albumId: 'a', trackNumber: 1, addedAt: at(2026, 10, 27) });
  const b1d2 = track({
    album: 'B',
    albumId: 'b',
    discNumber: 2,
    trackNumber: 1,
    addedAt: at(2026, 10, 27),
  });
  const b1 = track({ album: 'B', albumId: 'b', trackNumber: 1, addedAt: at(2026, 10, 27) });
  const [g] = rg.buildRecentGroups([b2, a2, a1, b1d2, b1]);
  assert.deepStrictEqual(ids(g.tracks), [a1.id, a2.id, b1.id, b2.id, b1d2.id]);
  ok('グループ内はアルバム単位、ディスク→トラック番号の順');
}

// 9. 詳細の引き直しは、行の上限と無関係。buildRecentGroups の行と同じ曲になる
{
  const target = track({ artist: 'Old', addedAt: at(2026, 1, 5) });
  const newer: Track[] = [];
  for (let i = 0; i < 40; i++) {
    newer.push(track({ artist: `N${i}`, addedAt: at(2026, 10, 1) + i * 3600000 }));
  }
  const all = [target, ...newer];
  assert.ok(!rg.buildRecentGroups(all).some((g) => g.artistKey === 'Old'));
  assert.deepStrictEqual(ids(rg.tracksOfGroup(all, 'Old', '2026-01-05')), [target.id]);

  const two = [
    track({ artist: 'A', trackNumber: 2, addedAt: at(2026, 10, 27) }),
    track({ artist: 'A', trackNumber: 1, addedAt: at(2026, 10, 27, 13) }),
    track({ artist: 'A', addedAt: at(2026, 10, 26) }),
  ];
  const [g] = rg.buildRecentGroups(two);
  assert.deepStrictEqual(ids(rg.tracksOfGroup(two, g.artistKey, g.day)), ids(g.tracks));
  ok('詳細は行の上限に関係なく引け、行の曲と同じ並びになる');
}

// 10. 選んだ行の曲・アーティスト名
{
  const a1 = track({ artist: 'A', addedAt: at(2026, 10, 27) });
  const a2 = track({ artist: 'A', addedAt: at(2026, 10, 26) });
  const b1 = track({ artist: 'B', addedAt: at(2026, 10, 25) });
  const groups = rg.buildRecentGroups([a1, a2, b1]);
  assert.deepStrictEqual(ids(rg.tracksOfGroups(groups)), [a1.id, a2.id, b1.id]);
  assert.deepStrictEqual(rg.artistNamesOf(groups), ['A', 'B']);
  ok('選んだ行は行の並びのまま1つの並びにし、同じアーティストの名前は1つにする');
}

// 11. 行のジャケットは、最後に追加した曲のもの。無ければ他の曲
{
  const old = track({ artworkUri: 'old.jpg', addedAt: at(2026, 10, 27, 9) });
  const latest = track({ artworkUri: 'latest.jpg', addedAt: at(2026, 10, 27, 10) });
  assert.strictEqual(rg.buildRecentGroups([old, latest])[0].artworkUri, 'latest.jpg');
  const noArt = track({ artworkUri: null, addedAt: at(2026, 10, 27, 11) });
  assert.strictEqual(rg.buildRecentGroups([old, noArt])[0].artworkUri, 'old.jpg');
  ok('ジャケットは最後に追加した曲のもの（無ければ他の曲）');
}

// 12. 日付の言い方: 今日・昨日・それ以前（月またぎ・年またぎ）
{
  const now = at(2026, 11, 1, 8);
  assert.deepStrictEqual(rg.labelOfDay('2026-11-01', now), { kind: 'today' });
  assert.deepStrictEqual(rg.labelOfDay('2026-10-31', now), { kind: 'yesterday' });
  const older = rg.labelOfDay('2026-10-30', now);
  assert.strictEqual(older.kind, 'date');
  assert.strictEqual(rg.dayKeyOf((older as { ms: number }).ms), '2026-10-30');

  const newYear = at(2027, 1, 1, 0, 5);
  assert.deepStrictEqual(rg.labelOfDay('2026-12-31', newYear), { kind: 'yesterday' });
  ok('今日・昨日・それ以前（月またぎ・年またぎ）');
}

console.log(`\n${n} checks passed`);
