/**
 * RE:TR4CKS 技術検証スパイク
 *
 * 技術検証（要件 13.4）は完了。いまはデータ層の確認に使っている。
 *  - 曲一覧のキャッシュ（毎回の走査を避ける）
 *  - シャッフルの1巡永続化（要件 6.2。アプリを閉じても続きから再生される）
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

import { RetracksPlayer, RepeatMode } from './modules/retracks-player/src';
import { DEFAULT_SEGMENT, resolveSegment, type SegmentSetting } from './src/rush';
import {
  loadLibrary,
  refreshLibrary,
  requestPermission,
  type Track,
} from './src/library';
import {
  buildQueueKey,
  isCycleComplete,
  prepareShuffle,
  progressOf,
  saveCursor,
  startNextCycle,
  type ShuffleState,
} from './src/shuffle';
import { clearAll } from './src/storage';

const QUEUE_KEY = buildQueueKey('all');

export default function App() {
  const [log, setLog] = useState<string[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [ready, setReady] = useState(false);
  const [rushOn, setRushOn] = useState(true);
  const [setting, setSetting] = useState<SegmentSetting>(DEFAULT_SEGMENT);
  const [status, setStatus] = useState(() => RetracksPlayer.getStatus?.() ?? null);
  const [shuffle, setShuffle] = useState<ShuffleState | null>(null);
  const [busy, setBusy] = useState(false);

  const tracksRef = useRef<Track[]>([]);
  const shuffleRef = useRef<ShuffleState | null>(null);
  const lastIndexRef = useRef(-1);

  tracksRef.current = tracks;
  shuffleRef.current = shuffle;

  const addLog = useCallback((line: string) => {
    const stamp = new Date().toISOString().slice(14, 23);
    setLog((prev) => [`${stamp}  ${line}`, ...prev].slice(0, 60));
  }, []);

  // ---- 起動時：接続とライブラリ読み込み --------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await RetracksPlayer.prepareAsync();
        if (!cancelled) setReady(true);
        addLog('PlaybackService に接続');

        if (!(await requestPermission())) {
          addLog('メディアの権限が許可されていません');
          return;
        }

        const result = await loadLibrary();
        if (cancelled) return;
        setTracks(result.tracks);
        addLog(
          `ライブラリ ${result.tracks.length}曲 を ${result.elapsedMs}ms で読み込み` +
            `（${result.source === 'cache' ? 'キャッシュ' : '走査'}）`
        );
      } catch (e) {
        addLog(`起動 ERROR: ${String(e)}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [addLog]);

  // ---- 再生イベント ----------------------------------------------------
  useEffect(() => {
    const cut = RetracksPlayer.addListener('onSegmentCut', (e) => {
      addLog(`✂ 区間終了 ズレ${Math.round(e.driftMs)}ms`);
    });

    const change = RetracksPlayer.addListener('onTrackChange', (e) => {
      const state = shuffleRef.current;
      if (!state || e.index < 0) return;

      const previous = lastIndexRef.current;
      lastIndexRef.current = e.index;

      // 1巡し終えて先頭へ戻った：次の巡の順列を作る（要件 6.2）
      if (previous === state.order.length - 1 && e.index === 0) {
        const lastPlayed = state.order[previous] ?? null;
        void (async () => {
          const next = await startNextCycle(
            QUEUE_KEY,
            tracksRef.current.map((t) => t.id),
            lastPlayed
          );
          setShuffle(next);
          addLog('1巡完了。順列を作り直して2巡目へ');
        })();
        return;
      }

      const updated = { ...state, cursor: e.index };
      setShuffle(updated);
      void saveCursor(QUEUE_KEY, e.index);
    });

    const timer = setInterval(() => setStatus(RetracksPlayer.getStatus()), 250);

    return () => {
      cut.remove();
      change.remove();
      clearInterval(timer);
    };
  }, [addLog]);

  // ---- 区間設定を native へ ---------------------------------------------
  useEffect(() => {
    if (!ready) return;
    RetracksPlayer.setSegment(
      rushOn
        ? {
            startMs: setting.startSec * 1000,
            lengthMs: setting.lengthSec * 1000,
            fadeMs: setting.fadeSec * 1000,
            fadeInMs: setting.fadeInSec * 1000,
          }
        : null
    );
  }, [ready, rushOn, setting]);

  // ---- 再生開始 --------------------------------------------------------
  const start = useCallback(async () => {
    if (!ready) return addLog('まだ接続できていません');
    if (tracks.length === 0) return addLog('ライブラリが空です');

    setBusy(true);
    try {
      const { state, resumed, added, removed } = await prepareShuffle(
        QUEUE_KEY,
        tracks.map((t) => t.id)
      );
      setShuffle(state);
      lastIndexRef.current = state.cursor;

      const byId = new Map(tracks.map((t) => [t.id, t]));
      const ordered = state.order
        .map((id) => byId.get(id))
        .filter((t): t is Track => t != null);

      await RetracksPlayer.setQueue(
        ordered.map((t) => ({
          id: t.id,
          uri: t.uri,
          title: t.title,
          artist: t.artist,
          album: t.album,
          durationMs: t.durationMs,
        })),
        state.cursor
      );
      RetracksPlayer.setRepeatMode(RepeatMode.All);
      RetracksPlayer.play();

      const { played, total } = progressOf(state);
      addLog(
        resumed
          ? `前回の続きから再開 ${played}/${total}` +
              (added.length || removed.length
                ? `（追加${added.length} / 削除${removed.length}）`
                : '')
          : `新しい順列を作成 ${total}曲`
      );
    } catch (e) {
      addLog(`start ERROR: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [ready, tracks, addLog]);

  // ---- ライブラリ再走査 -------------------------------------------------
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const result = await refreshLibrary(tracksRef.current);
      setTracks(result.tracks);
      addLog(
        `再走査 ${result.tracks.length}曲 ${result.elapsedMs}ms ` +
          `(追加${result.added.length} / 削除${result.removed.length})`
      );
    } catch (e) {
      addLog(`refresh ERROR: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [addLog]);

  const reset = useCallback(async () => {
    await clearAll();
    setShuffle(null);
    lastIndexRef.current = -1;
    addLog('保存内容を消去しました（次回は走査＋新しい順列）');
  }, [addLog]);

  const bump = (key: keyof SegmentSetting, delta: number) =>
    setSetting((prev) => ({
      ...prev,
      [key]: Math.max(0, Math.round((prev[key] + delta) * 10) / 10),
    }));

  const preview = status?.durationMs
    ? resolveSegment(status.durationMs / 1000, setting)
    : null;
  const progress = shuffle ? progressOf(shuffle) : null;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>RE:TR4CKS spike</Text>
        <Text style={styles.caption}>
          {ready ? 'PlaybackService 接続済み' : '接続中…'}
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>ライブラリとシャッフル</Text>
          <Text style={styles.mono}>
            {tracks.length}曲
            {progress ? `　1巡の進捗 ${progress.played} / ${progress.total}` : ''}
            {shuffle && isCycleComplete(shuffle) ? '（1巡の最後）' : ''}
          </Text>
          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.button, busy && styles.dim]}
              onPress={refresh}
              disabled={busy}
            >
              <Text style={styles.buttonText}>再走査</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={reset}>
              <Text style={styles.buttonText}>保存を消去</Text>
            </TouchableOpacity>
          </View>
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
              実効区間 {preview.start.toFixed(1)}→{preview.end.toFixed(1)}s /
              fadeIn {preview.fadeIn.toFixed(1)}s / fadeOut {preview.fade.toFixed(1)}s
            </Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>再生</Text>
          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.button, busy && styles.dim]}
              onPress={start}
              disabled={busy}
            >
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
            <TouchableOpacity style={styles.button} onPress={() => RetracksPlayer.next()}>
              <Text style={styles.buttonText}>NEXT</Text>
            </TouchableOpacity>
          </View>
          {status && (
            <Text style={styles.mono}>
              [{status.index + 1}/{status.queueSize}]{' '}
              {(status.positionMs / 1000).toFixed(1)}s /{' '}
              {(status.durationMs / 1000).toFixed(1)}s
            </Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>ログ</Text>
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
