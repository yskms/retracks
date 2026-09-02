/**
 * RE:TR4CKS 技術検証スパイク
 *
 * docs/requirements.md 13.4 の6項目を実機で確認するための使い捨て画面。
 *
 *  1. 区間再生の精度      … 目標の終了位置と実際の切り替わりのズレを ms で表示
 *  2. フェードアウトの品質 … 聴感で確認（音量ステップ数も表示）
 *  3. 曲の切り替わりの間   … フェード終了から次曲の再生開始までの無音を ms で表示
 *  4. バックグラウンド動作 … アプリを閉じて再生が続くか確認
 *  5. 通知の「次の曲」     … ロック画面/通知に何のボタンが出るか目視で確認
 *  6. ライブラリ走査の速度 … 全曲・アーティスト・アルバムの取得時間を表示
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
  AudioPlayer,
  createAudioPlayer,
  setAudioModeAsync,
} from 'expo-audio';

import {
  DEFAULT_SEGMENT,
  fadeVolumeAt,
  resolveSegment,
  type ResolvedSegment,
  type SegmentSetting,
} from './src/rush';

/** 位置監視の間隔。区間の切り出し精度を左右する（検証項目1） */
const TICK_MS = 50;

type Track = {
  id: string;
  uri: string;
  title: string;
  artist: string;
  durationSec: number;
};

type ScanResult = {
  songs: number;
  artists: number;
  albums: number;
  elapsedMs: number;
  firstPageMs: number;
};

export default function App() {
  const [log, setLog] = useState<string[]>([]);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [current, setCurrent] = useState<Track | null>(null);
  const [rushOn, setRushOn] = useState(true);
  const [setting, setSetting] = useState<SegmentSetting>(DEFAULT_SEGMENT);
  const [position, setPosition] = useState(0);
  const [busy, setBusy] = useState(false);

  const playerRef = useRef<AudioPlayer | null>(null);
  const segmentRef = useRef<ResolvedSegment | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queueRef = useRef<Track[]>([]);
  const cursorRef = useRef(0);
  const advancingRef = useRef(false);
  const fadeStepsRef = useRef(0);
  const advanceStartedAtRef = useRef(0);
  const settingRef = useRef(setting);
  const rushRef = useRef(rushOn);

  settingRef.current = setting;
  rushRef.current = rushOn;

  const addLog = useCallback((line: string) => {
    const stamp = new Date().toISOString().slice(14, 23);
    setLog((prev) => [`${stamp}  ${line}`, ...prev].slice(0, 60));
  }, []);

  // ---- 初期化 ----------------------------------------------------------
  useEffect(() => {
    const player = createAudioPlayer(null, { updateInterval: TICK_MS });
    playerRef.current = player;

    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      shouldRouteThroughEarpiece: false,
      allowsRecording: false,
      interruptionMode: 'duckOthers',
    })
      .then(() => addLog('audio mode set (background playback ON)'))
      .catch((e) => addLog(`audio mode ERROR: ${String(e)}`));

    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      player.remove();
    };
  }, [addLog]);

  // ---- 検証6: ライブラリ走査 -------------------------------------------
  const scanLibrary = useCallback(async () => {
    setBusy(true);
    try {
      const perm = await MusicLibrary.requestPermissionsAsync();
      addLog(`permission: ${perm.status}`);
      if (perm.status !== 'granted') {
        addLog('権限が拒否されたため走査を中止');
        return;
      }

      const t0 = Date.now();
      const firstPage = await MusicLibrary.getAssetsAsync({ first: 1 });
      const firstPageMs = Date.now() - t0;

      const total = firstPage.totalCount || 0;
      const all = await MusicLibrary.getAssetsAsync({
        first: total || 5000,
        sortBy: 'title',
      });
      const artists = await MusicLibrary.getArtistsAsync();
      const albums = await MusicLibrary.getAlbumsAsync();
      const elapsedMs = Date.now() - t0;

      const loaded: Track[] = all.assets.map((a) => ({
        id: a.id,
        uri: a.uri,
        title: a.title || a.filename,
        artist: a.artist || 'Unknown',
        // expo-music-library の duration は秒
        durationSec: a.duration,
      }));

      setTracks(loaded);
      setScan({
        songs: loaded.length,
        artists: artists.length,
        albums: albums.length,
        elapsedMs,
        firstPageMs,
      });
      addLog(
        `scan: ${loaded.length}曲 / ${artists.length}アーティスト / ${albums.length}アルバム を ${elapsedMs}ms`
      );
    } catch (e) {
      addLog(`scan ERROR: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [addLog]);

  // ---- 再生 ------------------------------------------------------------
  const stopTick = () => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  };

  const playTrack = useCallback(
    async (track: Track, gapFromMs?: number) => {
      const player = playerRef.current;
      if (!player) return;

      stopTick();
      advancingRef.current = false;
      fadeStepsRef.current = 0;

      player.replace({ uri: track.uri });
      player.volume = 1;

      const duration = track.durationSec || player.duration || 0;
      const segment = resolveSegment(duration, settingRef.current);
      segmentRef.current = segment;
      setCurrent(track);

      if (rushRef.current && segment.start > 0) {
        await player.seekTo(segment.start);
      }
      player.play();

      if (gapFromMs) {
        // 検証3: フェード終了から次曲が鳴り出すまでの間
        addLog(`gap: 次曲の再生開始まで ${Date.now() - gapFromMs}ms`);
      }

      const flags: string[] = [];
      if (segment.clamped.startResetToZero) flags.push('start→0');
      if (segment.clamped.endTruncated) flags.push('end切詰め');
      if (segment.clamped.fadeShortened) flags.push('fade短縮');
      addLog(
        `▶ ${track.title.slice(0, 28)} / ${duration.toFixed(1)}s ` +
          (rushRef.current
            ? `[RUSH ${segment.start.toFixed(1)}→${segment.end.toFixed(1)}s fade${segment.fade.toFixed(1)}s]`
            : '[FULL]') +
          (flags.length ? ` (${flags.join(',')})` : '')
      );

      tickRef.current = setInterval(() => {
        const p = playerRef.current;
        const seg = segmentRef.current;
        if (!p || !seg) return;

        const pos = p.currentTime;
        setPosition(pos);

        if (!rushRef.current) return; // RUSH OFF はフル再生（要件4.3）
        if (advancingRef.current) return;

        // 検証2: フェード
        if (pos >= seg.fadeStart && seg.fade > 0) {
          const v = fadeVolumeAt(pos, seg);
          p.volume = v;
          fadeStepsRef.current += 1;
        }

        // 検証1: 区間終了の検出精度
        if (pos >= seg.end) {
          advancingRef.current = true;
          const driftMs = Math.round((pos - seg.end) * 1000);
          addLog(
            `✂ 区間終了 目標${seg.end.toFixed(2)}s 実際${pos.toFixed(2)}s ` +
              `ズレ${driftMs}ms / フェード${fadeStepsRef.current}ステップ`
          );
          stopTick();
          advanceStartedAtRef.current = Date.now();
          void next();
        }
      }, TICK_MS);
    },
    [addLog]
  );

  const next = useCallback(async () => {
    const queue = queueRef.current;
    if (queue.length === 0) return;
    cursorRef.current = (cursorRef.current + 1) % queue.length;
    await playTrack(queue[cursorRef.current], advanceStartedAtRef.current || undefined);
    advanceStartedAtRef.current = 0;
  }, [playTrack]);

  const startQueue = useCallback(async () => {
    if (tracks.length === 0) {
      addLog('先に SCAN を実行してください');
      return;
    }
    // 検証用にシャッフルした順列を作る（本実装では永続化する → 要件6.2）
    const shuffled = [...tracks];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    queueRef.current = shuffled;
    cursorRef.current = 0;
    addLog(`queue: ${shuffled.length}曲の順列を生成`);
    await playTrack(shuffled[0]);

    // 検証5: ロック画面/通知に何が出るか
    const player = playerRef.current;
    if (player) {
      player.setActiveForLockScreen(
        true,
        {
          title: shuffled[0].title,
          artist: shuffled[0].artist,
        },
        { showSeekForward: true, showSeekBackward: true }
      );
      addLog('lock screen controls 有効化（次/前ボタンの有無を目視確認）');
    }
  }, [tracks, playTrack, addLog]);

  const togglePlay = () => {
    const p = playerRef.current;
    if (!p) return;
    if (p.playing) {
      p.pause();
      addLog('pause');
    } else {
      p.play();
      addLog('play');
    }
  };

  const bump = (key: keyof SegmentSetting, delta: number) => {
    setSetting((prev) => ({
      ...prev,
      [key]: Math.max(0, Math.round((prev[key] + delta) * 10) / 10),
    }));
  };

  const seg = segmentRef.current;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>RE:TR4CKS spike</Text>
        <Text style={styles.caption}>docs/requirements.md 13.4 の検証用</Text>

        {/* 検証6 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>6. ライブラリ走査</Text>
          <TouchableOpacity
            style={[styles.button, busy && styles.buttonDisabled]}
            onPress={scanLibrary}
            disabled={busy}
          >
            <Text style={styles.buttonText}>{busy ? 'SCANNING…' : 'SCAN'}</Text>
          </TouchableOpacity>
          {scan && (
            <Text style={styles.mono}>
              {scan.songs}曲 / {scan.artists}アーティスト / {scan.albums}アルバム{'\n'}
              全体 {scan.elapsedMs}ms（1件目まで {scan.firstPageMs}ms）
            </Text>
          )}
        </View>

        {/* 区間設定 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>区間設定</Text>
          {(['startSec', 'lengthSec', 'fadeSec'] as const).map((key) => (
            <View key={key} style={styles.row}>
              <Text style={styles.rowLabel}>{key.replace('Sec', '')}</Text>
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
        </View>

        {/* 再生 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>1〜5. 再生</Text>
          <View style={styles.row}>
            <TouchableOpacity style={styles.button} onPress={startQueue}>
              <Text style={styles.buttonText}>START</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={togglePlay}>
              <Text style={styles.buttonText}>PLAY/PAUSE</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={() => void next()}>
              <Text style={styles.buttonText}>NEXT</Text>
            </TouchableOpacity>
          </View>
          {current && (
            <Text style={styles.mono}>
              {current.title}
              {'\n'}
              {current.artist}
              {'\n'}
              {position.toFixed(2)}s
              {seg ? ` / 区間 ${seg.start.toFixed(1)}→${seg.end.toFixed(1)}s` : ''}
            </Text>
          )}
        </View>

        {/* ログ */}
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
  rowLabel: { color: '#c9c9d4', width: 56, fontSize: 12 },
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
  buttonDisabled: { opacity: 0.5 },
  on: { backgroundColor: '#c8811a' },
  off: { backgroundColor: '#3a3a48' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  mono: { color: '#c9c9d4', fontSize: 12, lineHeight: 18 },
  logLine: { color: '#9aa0a6', fontSize: 11, lineHeight: 16 },
});
