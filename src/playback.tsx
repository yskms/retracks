/**
 * 再生まわりの状態をアプリ全体で共有する。
 *
 * ライブラリの読み込み、シャッフルの1巡管理、区間設定、再生操作をここに集約し、
 * 画面側は表示と操作に専念できるようにする。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  RetracksPlayer,
  RepeatMode,
  type PlayerStatus,
} from '../modules/retracks-player/src';
import { DEFAULT_SEGMENT, type SegmentSetting } from './rush';
import { loadLibrary, refreshLibrary, requestPermission, type Track } from './library';
import {
  buildQueueKey,
  loadShuffle,
  prepareShuffle,
  progressOf,
  saveCursor,
  startNextCycle,
  type QueueMode,
  type ShuffleState,
} from './shuffle';
import { clearAll, readJson, StorageKeys, writeJson } from './storage';

type PlaybackValue = {
  ready: boolean;
  tracks: Track[];
  queue: Track[];
  status: PlayerStatus | null;
  currentTrack: Track | null;
  progress: { played: number; total: number } | null;
  /**
   * 全曲キューの1巡の進捗。いま別のキューを再生していても、また何も再生していなくても
   * 「続きから N/M」を出せるように、再生中のキューとは別に保持する。
   */
  allProgress: { played: number; total: number } | null;
  setting: SegmentSetting;
  rushOn: boolean;
  log: string[];

  setSetting: (update: (prev: SegmentSetting) => SegmentSetting) => void;
  setRushOn: (on: boolean) => void;

  /** 指定した曲でキューを作って再生する。順列は生成条件ごとに永続化される。 */
  playTracks: (mode: QueueMode, ids: string[], source: Track[]) => Promise<void>;
  /** ライブラリ全曲を再生する（続きがあれば続きから）。 */
  playAll: () => Promise<void>;
  /**
   * 一覧の並び順のまま、指定した位置から再生する（要件 10.4）。
   * 曲をタップしたときの挙動。シャッフルの1巡管理は使わない。
   */
  playFrom: (source: Track[], index: number) => Promise<void>;

  play: () => void;
  pause: () => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  skipTo: (index: number) => void;
  seekTo: (positionMs: number) => void;
  /** いまの曲を最初から通しで再生する。次の曲からは元に戻る。 */
  playCurrentFromStart: () => void;

  rescan: () => Promise<void>;
  clearStorage: () => Promise<void>;
};

/**
 * 裏での再走査を行う間隔。
 * アプリを開くたびに走らせると無駄なので、前回からこれだけ経っていたら行う。
 */
const RESCAN_AFTER_MS = 5 * 60 * 1000;

const PlaybackContext = createContext<PlaybackValue | null>(null);

export function usePlayback(): PlaybackValue {
  const value = useContext(PlaybackContext);
  if (!value) throw new Error('usePlayback must be used within PlaybackProvider');
  return value;
}

async function waitForConnection(timeoutMs = 1500) {
  const started = Date.now();
  for (;;) {
    const status = RetracksPlayer.getStatus();
    if (status?.connected) return status;
    if (Date.now() - started > timeoutMs) return status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [queue, setQueue] = useState<Track[]>([]);
  const [status, setStatus] = useState<PlayerStatus | null>(null);
  const [shuffle, setShuffle] = useState<ShuffleState | null>(null);
  const [setting, setSettingState] = useState<SegmentSetting>(DEFAULT_SEGMENT);
  const [rushOn, setRushOn] = useState(true);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [allProgress, setAllProgress] = useState<{
    played: number;
    total: number;
  } | null>(null);

  const ALL_KEY = buildQueueKey('all');

  const queueKeyRef = useRef<string>(buildQueueKey('all'));
  const queueRef = useRef<Track[]>([]);
  const tracksRef = useRef<Track[]>([]);
  const shuffleRef = useRef<ShuffleState | null>(null);
  const lastIndexRef = useRef(-1);

  /**
   * state と ref を同時に更新する。
   *
   * レンダリング時に ref へ代入する方式だと、再生中の曲が変わるイベントが
   * 再レンダリングより先に届いたときに古い値を参照してしまう。実際、全曲シャッフル中に
   * 別のキューを再生すると、進捗の分母が前のキューのまま（例: 2/1025）になっていた。
   */
  const applyShuffle = useCallback((next: ShuffleState | null) => {
    shuffleRef.current = next;
    setShuffle(next);
  }, []);

  const applyQueue = useCallback((next: Track[]) => {
    queueRef.current = next;
    setQueue(next);
  }, []);

  const applyTracks = useCallback((next: Track[]) => {
    tracksRef.current = next;
    setTracks(next);
  }, []);

  const addLog = useCallback((line: string) => {
    const stamp = new Date().toISOString().slice(14, 23);
    setLog((prev) => [`${stamp}  ${line}`, ...prev].slice(0, 80));
  }, []);

  // ---- 起動 ------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // 区間設定は接続前に読む。既定値のまま送ると native 側が「設定が変わった」と
        // 判定し、再生中のキューを組み直してしまう。
        const savedSetting = await readJson<SegmentSetting>(StorageKeys.settings);
        if (savedSetting && !cancelled) {
          setSettingState({ ...DEFAULT_SEGMENT, ...savedSetting });
        }
        if (!cancelled) setSettingsLoaded(true);

        await RetracksPlayer.prepareAsync();
        if (cancelled) return;
        setReady(true);

        if (!(await requestPermission())) {
          addLog('メディアの権限が許可されていません');
          return;
        }

        const result = await loadLibrary();
        if (cancelled) return;
        applyTracks(result.tracks);

        // 再生していなくても FAB に「続きから」を出せるよう、保存済みの1巡を読む
        const savedAll = await loadShuffle(ALL_KEY);
        if (!cancelled && savedAll) setAllProgress(progressOf(savedAll));

        // 走査は待たせず裏で行い、差分があったときだけ静かに反映する。
        // 起動のたびに2〜4秒待たされるのを避けつつ、曲の増減には追従する。
        if (Date.now() - result.scannedAt > RESCAN_AFTER_MS) {
          void (async () => {
            try {
              const refreshed = await refreshLibrary(result.tracks);
              if (cancelled) return;
              if (refreshed.added.length === 0 && refreshed.removed.length === 0) return;
              applyTracks(refreshed.tracks);
              addLog(
                `裏で再走査（追加${refreshed.added.length} 削除${refreshed.removed.length}）`
              );
            } catch {
              // 走査に失敗してもキャッシュで動くので黙って諦める
            }
          })();
        }
        addLog(
          `ライブラリ ${result.tracks.length}曲 / ${result.elapsedMs}ms` +
            `（${result.source === 'cache' ? 'キャッシュ' : '走査'}）`
        );

        // サービスが生きていればそのセッションを引き継ぐ。ここで組み直すと
        // 再生中の曲が区間の先頭へ戻ってしまう。
        const current = await waitForConnection();
        if (!cancelled && current && current.queueSize > 0) {
          const restored = await loadShuffle(queueKeyRef.current);
          if (restored) {
            const adopted = { ...restored, cursor: Math.max(0, current.index) };
            applyShuffle(adopted);
            lastIndexRef.current = adopted.cursor;

            const byId = new Map(result.tracks.map((t) => [t.id, t]));
            applyQueue(
              adopted.order.map((id) => byId.get(id)).filter((t): t is Track => t != null)
            );
          }
          addLog(`再生中のセッションに接続（${current.index + 1}/${current.queueSize}）`);
        }
      } catch (e) {
        addLog(`起動 ERROR: ${String(e)}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [addLog, applyShuffle, applyQueue, applyTracks]);

  // ---- 再生イベント ----------------------------------------------------
  useEffect(() => {
    const onTrack = RetracksPlayer.addListener('onTrackChange', (event) => {
      const state = shuffleRef.current;
      if (!state || event.index < 0) return;

      const previous = lastIndexRef.current;
      lastIndexRef.current = event.index;

      // 1巡し終えて先頭へ戻った（要件 6.2）
      if (previous === state.order.length - 1 && event.index === 0) {
        const lastPlayed = state.order[previous] ?? null;
        void (async () => {
          // 全曲キューの2巡目は、その時点のライブラリを元に作り直す。
          // 1巡の途中で増えた曲も次の巡から出てくるようにするため。
          // アーティストやアルバムのキューは対象が決まっているのでそのまま使う。
          const source =
            queueKeyRef.current === ALL_KEY ? tracksRef.current : queueRef.current;
          const ids = source.map((t) => t.id);
          const nextState = await startNextCycle(queueKeyRef.current, ids, lastPlayed);
          applyShuffle(nextState);
          lastIndexRef.current = 0;

          const byId = new Map(source.map((t) => [t.id, t]));
          const ordered = nextState.order
            .map((id) => byId.get(id))
            .filter((t): t is Track => t != null);
          applyQueue(ordered);

          await RetracksPlayer.setQueue(ordered, 0);
          RetracksPlayer.play();
          addLog('1巡完了。順列を作り直して2巡目へ');
        })();
        return;
      }

      const updated = { ...state, cursor: event.index };
      applyShuffle(updated);
      if (queueKeyRef.current === ALL_KEY) setAllProgress(progressOf(updated));
      void saveCursor(queueKeyRef.current, event.index);
      void writeJson(StorageKeys.playbackPosition(queueKeyRef.current), 0);
    });

    const timer = setInterval(() => setStatus(RetracksPlayer.getStatus()), 250);

    // 再生位置を定期保存。サービスごと終了した場合に途中から再開できる。
    const saver = setInterval(() => {
      const current = RetracksPlayer.getStatus();
      if (current?.isPlaying && current.positionMs > 0) {
        void writeJson(
          StorageKeys.playbackPosition(queueKeyRef.current),
          Math.round(current.positionMs)
        );
      }
    }, 5000);

    return () => {
      onTrack.remove();
      clearInterval(timer);
      clearInterval(saver);
    };
  }, [addLog, applyShuffle, applyQueue]);

  // ---- 区間設定 --------------------------------------------------------
  useEffect(() => {
    if (!ready || !settingsLoaded) return;

    // 連打のたびに 1000件超のキューを差し替えないよう、操作が落ち着いてから送る
    const timer = setTimeout(() => {
      void writeJson(StorageKeys.settings, setting);
      RetracksPlayer.setSegment(
        rushOn
          ? {
              startMs: Math.round(setting.startSec * 1000),
              lengthMs: Math.round(setting.lengthSec * 1000),
              fadeMs: Math.round(setting.fadeSec * 1000),
              fadeInMs: Math.round(setting.fadeInSec * 1000),
            }
          : null
      );
    }, 350);

    return () => clearTimeout(timer);
  }, [ready, settingsLoaded, rushOn, setting]);

  // ---- 操作 ------------------------------------------------------------
  const playTracks = useCallback(
    async (mode: QueueMode, ids: string[], source: Track[]) => {
      if (!ready) return addLog('プレイヤーの準備ができていません');
      if (source.length === 0) return addLog('対象の曲がありません');

      const key = buildQueueKey(mode, mode === 'all' ? [] : ids);
      queueKeyRef.current = key;

      const { state, resumed } = await prepareShuffle(
        key,
        source.map((t) => t.id)
      );
      applyShuffle(state);
      lastIndexRef.current = state.cursor;

      const byId = new Map(source.map((t) => [t.id, t]));
      const ordered = state.order
        .map((id) => byId.get(id))
        .filter((t): t is Track => t != null);
      applyQueue(ordered);

      await RetracksPlayer.setQueue(ordered, state.cursor);
      RetracksPlayer.setRepeatMode(RepeatMode.All);

      if (resumed) {
        const savedPosition = await readJson<number>(StorageKeys.playbackPosition(key));
        if (typeof savedPosition === 'number' && savedPosition > 1000) {
          await RetracksPlayer.seekTo(savedPosition);
        }
      }

      RetracksPlayer.play();
      const { played, total } = progressOf(state);
      if (key === ALL_KEY) setAllProgress({ played, total });
      addLog(resumed ? `続きから再開 ${played}/${total}` : `新しい順列 ${total}曲`);
    },
    [ready, addLog, applyShuffle, applyQueue]
  );

  const playAll = useCallback(async () => {
    await playTracks('all', [], tracksRef.current);
  }, [playTracks]);

  const playFrom = useCallback(
    async (source: Track[], index: number) => {
      if (!ready || source.length === 0) return;

      // 一覧をそのままキューにする。順列の1巡管理からは外れるので、
      // シャッフル状態は持たない（曲の切り替わりでカーソルも保存しない）。
      applyShuffle(null);
      lastIndexRef.current = -1;
      applyQueue(source);

      await RetracksPlayer.setQueue(source, Math.max(0, index));
      RetracksPlayer.setRepeatMode(RepeatMode.All);
      RetracksPlayer.play();
      addLog(`一覧から再生 ${index + 1}/${source.length}`);
    },
    [ready, addLog, applyShuffle, applyQueue]
  );

  const rescan = useCallback(async () => {
    const result = await refreshLibrary(tracksRef.current);
    applyTracks(result.tracks);
    addLog(
      `再走査 ${result.tracks.length}曲 / ${result.elapsedMs}ms ` +
        `(追加${result.added.length} 削除${result.removed.length})`
    );
  }, [addLog, applyTracks]);

  const clearStorage = useCallback(async () => {
    await clearAll();
    applyShuffle(null);
    applyQueue([]);
    setAllProgress(null);
    lastIndexRef.current = -1;
    addLog('保存内容を消去しました');
  }, [addLog, applyShuffle, applyQueue]);

  const currentTrack = useMemo(() => {
    if (!status || status.index < 0) return null;
    return queue[status.index] ?? null;
  }, [queue, status]);

  const progress = useMemo(() => (shuffle ? progressOf(shuffle) : null), [shuffle]);

  const value: PlaybackValue = {
    ready,
    tracks,
    queue,
    status,
    currentTrack,
    progress,
    allProgress,
    setting,
    rushOn,
    log,
    setSetting: (update) => setSettingState((prev) => update(prev)),
    setRushOn,
    playTracks,
    playAll,
    playFrom,
    play: () => RetracksPlayer.play(),
    pause: () => RetracksPlayer.pause(),
    toggle: () =>
      status?.isPlaying ? RetracksPlayer.pause() : RetracksPlayer.play(),
    next: () => RetracksPlayer.next(),
    previous: () => RetracksPlayer.previous(),
    skipTo: (index: number) => RetracksPlayer.skipTo(index),
    seekTo: (positionMs: number) => void RetracksPlayer.seekTo(positionMs),
    playCurrentFromStart: () => RetracksPlayer.playCurrentFromStart(),
    rescan,
    clearStorage,
  };

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}
