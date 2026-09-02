/**
 * RE:TR4CKS 技術検証スパイク
 *
 * docs/requirements.md 13.4 の6項目を実機で確認する。
 *
 *  1. 通知・イヤホンからの「次の曲」… 最優先。画面を消して実機で操作して確認する
 *  2. 区間再生の精度            … onSegmentCut の driftMs
 *  3. フェードアウトの品質      … 聴感で確認
 *  4. 曲の切り替わりの間        … 区間終了から次曲開始までの ms
 *  5. バックグラウンド動作      … アプリを閉じて再生が続くか
 *  6. ライブラリ走査の速度      … 走査時間を ms 表示
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as MusicLibrary from 'expo-music-library';

import {
  RetracksPlayer,
  RepeatMode,
  type TrackInput,
} from './modules/retracks-player/src';
import { DEFAULT_SEGMENT, resolveSegment, type SegmentSetting } from './src/rush';

type ScanResult = {
  songs: number;
  artists: number;
  albums: number;
  elapsedMs: number;
};

export default function App() {
  const [log, setLog] = useState<string[]>([]);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [tracks, setTracks] = useState<TrackInput[]>([]);
  const [ready, setReady] = useState(false);
  const [rushOn, setRushOn] = useState(true);
  const [setting, setSetting] = useState<SegmentSetting>(DEFAULT_SEGMENT);
  const [status, setStatus] = useState(() => RetracksPlayer.getStatus?.() ?? null);
  const [busy, setBusy] = useState(false);

  const cutAtRef = useRef(0);

  const addLog = useCallback((line: string) => {
    const stamp = new Date().toISOString().slice(14, 23);
    setLog((prev) => [`${stamp}  ${line}`, ...prev].slice(0, 60));
  }, []);

  // ---- 接続とイベント購読 ----------------------------------------------
  useEffect(() => {
    RetracksPlayer.prepareAsync()
      .then(() => {
        setReady(true);
        addLog('PlaybackService に接続');
      })
      .catch((e) => addLog(`connect ERROR: ${String(e)}`));

    const cut = RetracksPlayer.addListener('onSegmentCut', (e) => {
      cutAtRef.current = Date.now();
      addLog(
        `✂ 区間終了 期待${(e.expectedMs / 1000).toFixed(2)}s ` +
          `実測${(e.elapsedMs / 1000).toFixed(2)}s ズレ${Math.round(e.driftMs)}ms`
      );
    });

    const change = RetracksPlayer.addListener('onTrackChange', (e) => {
      // 検証4: 区間終了から次曲が始まるまでの間
      const gap = cutAtRef.current ? Date.now() - cutAtRef.current : 0;
      cutAtRef.current = 0;
      addLog(`▶ [${e.index}] ${e.id.slice(0, 20)}${gap ? ` (間 ${gap}ms)` : ''}`);
    });

    const playing = RetracksPlayer.addListener('onPlaybackStateChange', (e) => {
      addLog(e.isPlaying ? 'playing' : 'paused');
    });

    const timer = setInterval(() => setStatus(RetracksPlayer.getStatus()), 250);

    return () => {
      cut.remove();
      change.remove();
      playing.remove();
      clearInterval(timer);
    };
  }, [addLog]);

  // ---- 区間設定を native へ反映 ----------------------------------------
  useEffect(() => {
    if (!ready) return;
    if (rushOn) {
      RetracksPlayer.setSegment({
        startMs: setting.startSec * 1000,
        lengthMs: setting.lengthSec * 1000,
        fadeMs: setting.fadeSec * 1000,
        fadeInMs: setting.fadeInSec * 1000,
      });
    } else {
      RetracksPlayer.setSegment(null);
    }
  }, [ready, rushOn, setting]);

  // ---- 検証6: ライブラリ走査 -------------------------------------------
  const scanLibrary = useCallback(async () => {
    setBusy(true);
    try {
      const perm = await MusicLibrary.requestPermissionsAsync();
      addLog(`permission: ${perm.status}`);
      if (perm.status !== 'granted') return;

      const t0 = Date.now();

      // getAssetsAsync の first は 1〜1000 しか受け付けないのでページングする
      const PAGE_SIZE = 1000;
      const loaded: TrackInput[] = [];
      let after: string | undefined;
      let pages = 0;
      for (;;) {
        const page = await MusicLibrary.getAssetsAsync({
          first: PAGE_SIZE,
          after,
          sortBy: 'title',
        });
        for (const a of page.assets) {
          loaded.push({
            id: a.id,
            uri: a.uri,
            title: a.title || a.filename,
            artist: a.artist || 'Unknown',
            album: a.albumTitle ?? null,
            // expo-music-library の duration は秒
            durationMs: Math.round((a.duration || 0) * 1000),
          });
        }
        pages += 1;
        if (!page.hasNextPage || pages > 50) break;
        after = page.endCursor;
      }

      const artists = await MusicLibrary.getArtistsAsync();
      const albums = await MusicLibrary.getAlbumsAsync();
      const elapsedMs = Date.now() - t0;
      addLog(`走査ページ数: ${pages}`);

      setTracks(loaded);
      setScan({
        songs: loaded.length,
        artists: artists.length,
        albums: albums.length,
        elapsedMs,
      });
      addLog(
        `scan: ${loaded.length}曲 / ${artists.length}アーティスト / ` +
          `${albums.length}アルバム を ${elapsedMs}ms`
      );
    } catch (e) {
      addLog(`scan ERROR: ${String(e)}`);
      const stack = (e as Error)?.stack;
      if (stack) addLog(`stack: ${stack.split('\n').slice(0, 3).join(' | ')}`);
    } finally {
      setBusy(false);
    }
  }, [addLog]);

  // ---- キュー投入 ------------------------------------------------------
  const startQueue = useCallback(async () => {
    if (!ready) return addLog('まだ接続できていません');
    if (tracks.length === 0) return addLog('先に SCAN を実行してください');

    // 本実装ではこの順列を永続化する（要件 6.2）
    const shuffled = [...tracks];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const count = await RetracksPlayer.setQueue(shuffled, 0);
    RetracksPlayer.setRepeatMode(RepeatMode.All);
    RetracksPlayer.play();
    addLog(`queue: ${count}曲を投入して再生開始`);
    addLog('▼ ここで画面を消し、通知とイヤホンの「次へ」を試すこと');
  }, [ready, tracks, addLog]);

  const bump = (key: keyof SegmentSetting, delta: number) =>
    setSetting((prev) => ({
      ...prev,
      [key]: Math.max(0, Math.round((prev[key] + delta) * 10) / 10),
    }));

  const preview = status?.durationMs
    ? resolveSegment(status.durationMs / 1000, setting)
    : null;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>RE:TR4CKS spike</Text>
        <Text style={styles.caption}>
          {ready ? 'PlaybackService 接続済み' : '接続中…'}
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>6. ライブラリ走査</Text>
          <TouchableOpacity
            style={[styles.button, busy && styles.dim]}
            onPress={scanLibrary}
            disabled={busy}
          >
            <Text style={styles.buttonText}>{busy ? 'SCANNING…' : 'SCAN'}</Text>
          </TouchableOpacity>
          {scan && (
            <Text style={styles.mono}>
              {scan.songs}曲 / {scan.artists}アーティスト / {scan.albums}アルバム
              {'\n'}
              {scan.elapsedMs}ms
            </Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>区間設定</Text>
          {(['startSec', 'lengthSec', 'fadeInSec', 'fadeSec'] as const).map((key) => (
            <View key={key} style={styles.row}>
              <Text style={styles.rowLabel}>
                {key === 'fadeSec'
                  ? 'fadeOut'
                  : key === 'fadeInSec'
                    ? 'fadeIn'
                    : key.replace('Sec', '')}
              </Text>
              <TouchableOpacity style={styles.step} onPress={() => bump(key, -5)}>
                <Text style={styles.stepText}>−5</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.step} onPress={() => bump(key, -1)}>
                <Text style={styles.stepText}>−1</Text>
              </TouchableOpacity>
              <Text style={styles.rowValue}>{setting[key]}s</Text>
              <TouchableOpacity style={styles.step} onPress={() => bump(key, 1)}>
                <Text style={styles.stepText}>+1</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.step} onPress={() => bump(key, 5)}>
                <Text style={styles.stepText}>+5</Text>
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity
            style={[styles.button, rushOn ? styles.on : styles.off]}
            onPress={() => setRushOn((v) => !v)}
          >
            <Text style={styles.buttonText}>RUSH {rushOn ? 'ON' : 'OFF'}</Text>
          </TouchableOpacity>
          {preview && (
            <Text style={styles.mono}>
              この曲での実効区間 {preview.start.toFixed(1)}→{preview.end.toFixed(1)}s
              {'\n'}fadeIn {preview.fadeIn.toFixed(1)}s / fadeOut {preview.fade.toFixed(1)}s
            </Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>1〜5. 再生</Text>
          <View style={styles.row}>
            <TouchableOpacity style={styles.button} onPress={startQueue}>
              <Text style={styles.buttonText}>START</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.button}
              onPress={() =>
                status?.isPlaying ? RetracksPlayer.pause() : RetracksPlayer.play()
              }
            >
              <Text style={styles.buttonText}>PLAY/PAUSE</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.button}
              onPress={() => RetracksPlayer.previous()}
            >
              <Text style={styles.buttonText}>PREV</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.button}
              onPress={() => RetracksPlayer.next()}
            >
              <Text style={styles.buttonText}>NEXT</Text>
            </TouchableOpacity>
          </View>
          {status && (
            <Text style={styles.mono}>
              [{status.index + 1}/{status.queueSize}]{' '}
              {(status.positionMs / 1000).toFixed(2)}s /{' '}
              {(status.durationMs / 1000).toFixed(1)}s
            </Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>計測ログ</Text>
          {log.map((line, i) => (
            <Text key={i} style={styles.logLine}>
              {line}
            </Text>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#16161a' },
  body: { padding: 16, paddingTop: 56, gap: 12 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', letterSpacing: 1 },
  caption: { color: '#8b8b96', fontSize: 12, marginBottom: 4 },
  card: { backgroundColor: '#21212a', borderRadius: 10, padding: 12, gap: 8 },
  cardTitle: { color: '#f5a623', fontSize: 13, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  rowLabel: { color: '#c9c9d4', width: 62, fontSize: 12 },
  rowValue: { color: '#fff', width: 52, textAlign: 'center', fontSize: 13 },
  step: {
    backgroundColor: '#33333f',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  stepText: { color: '#fff', fontSize: 12 },
  button: {
    backgroundColor: '#3a3a48',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  dim: { opacity: 0.5 },
  on: { backgroundColor: '#c8811a' },
  off: { backgroundColor: '#3a3a48' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  mono: { color: '#c9c9d4', fontSize: 12, lineHeight: 18 },
  logLine: { color: '#9aa0a6', fontSize: 11, lineHeight: 16 },
});
