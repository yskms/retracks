/**
 * 再生まわりの状態をアプリ全体で共有する。
 *
 * ライブラリの読み込み、シャッフルの1巡管理、区間設定、再生操作をここに集約し、
 * 画面側は表示と操作に専念できるようにする。
 */

import { AppState } from 'react-native';
import { Image } from 'expo-image';
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
import {
  getAlbums,
  getArtists,
  loadLibrary,
  refreshLibrary,
  requestPermission,
  type Album,
  type Artist,
  type Track,
} from './library';
import { useSettings } from './settings';
import { sortByField } from './sorting';
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
  /**
   * アーティスト/アルバム一覧。ライブラリ画面のタブと検索画面の両方から
   * 同じ配列を参照する（要件 10.4）。別々に読み込むと、画面ごとに複製が
   * 残ったり、再走査した内容が一方にしか反映されなかったりする。
   */
  artists: Artist[];
  albums: Album[];
  /**
   * フォルダ除外設定画面向け。曲が属するフォルダの一覧（名前・曲数）。
   * rawTracks から作るため、除外設定の影響を受けない（隠したフォルダも
   * 一覧には出続ける。でないと一度隠すと元に戻せなくなる）。
   */
  folders: { id: string; name: string; trackCount: number }[];
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

  /** いまのリピート設定（RepeatMode）。ネイティブ側のプレイヤーが持つ値。 */
  repeatMode: number;
  /** リピートを OFF → 全曲 → 1曲 → OFF の順に切り替える。 */
  cycleRepeat: () => void;

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

/**
 * アーティスト/アルバム一覧を取得する。MediaStore への問い合わせが一時的に
 * 失敗することがあるため、1回だけ間を置いて再試行する。それでも失敗したら
 * 呼び出し側で諦める（曲一覧の更新は巻き込まない）。
 */
async function fetchArtistsAlbums(): Promise<{ artists: Artist[]; albums: Album[] } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const [artists, albums] = await Promise.all([getArtists(), getAlbums()]);
      return { artists, albums };
    } catch {
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  return null;
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
  const {
    excludeShortTracks,
    shortTrackThresholdSec,
    excludeNonMusic,
    excludedFolderIds,
    ignoreLeadingThe,
    ignoreLeadingAAn,
  } = useSettings();
  const articleOptions = useMemo(
    () => ({ ignoreLeadingThe, ignoreLeadingAAn }),
    [ignoreLeadingThe, ignoreLeadingAAn]
  );

  const [ready, setReady] = useState(false);
  // 走査そのままの生データ。公開する tracks/artists/albums は、この下で
  // 設定（短い曲の除外・並べ替え）を適用した派生値にする。
  const [rawTracks, setRawTracks] = useState<Track[]>([]);
  const [rawArtists, setRawArtists] = useState<Artist[]>([]);
  const [rawAlbums, setRawAlbums] = useState<Album[]>([]);
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
  /** 走査そのままの生データ。再走査時の追加/削除の差分計算に使う。 */
  const rawTracksRef = useRef<Track[]>([]);
  /** 設定適用後（短い曲の除外・並べ替え）。再生系の処理はこちらを見る。 */
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
    rawTracksRef.current = next;
    setRawTracks(next);
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

        // 通知が無いと、ウィジェットから起こしたときに再生中でも通知にも
        // ロック画面にも何も出ない（フォアグラウンドサービス自体は動く）。
        // ライブラリ読み込みを止める理由ではないので、結果は問わず進める。
        try {
          const notif = await RetracksPlayer.requestNotificationPermissionAsync();
          if (!notif.granted) addLog('通知の権限が許可されていません');
        } catch {
          // 権限まわりで失敗しても再生自体は続けられる
        }

        if (!(await requestPermission())) {
          addLog('メディアの権限が許可されていません');
          return;
        }

        // getArtistsAsync/getAlbumsAsync は曲一覧の走査結果を待つ必要が無いので、
        // loadLibrary() と並行に投げる。曲一覧の後ろに置くと、キャッシュが無い
        // 初回起動では走査の2〜4秒ぶんアーティスト/アルバムの表示が余計に遅れる。
        void (async () => {
          const fetched = await fetchArtistsAlbums();
          if (!cancelled && fetched) {
            setRawArtists(fetched.artists);
            setRawAlbums(fetched.albums);
          }
        })();

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
              // 曲の増減があったなら、アーティスト/アルバムのタブと検索結果も
              // 同時に古くなる。ここで拾わないと、次にプル更新するまで
              // 両方とも曲一覧だけとズレたままになる。
              const fetched = await fetchArtistsAlbums();
              if (!cancelled && fetched) {
                setRawArtists(fetched.artists);
                setRawAlbums(fetched.albums);
              }
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
          // 何を鳴らしているかを知っているのはネイティブ側だけ。JS の保存を
          // 当てにすると、別のキュー（例：全曲シャッフル）の順列に番号だけを
          // 当てはめてしまい、画面と音が食い違う。キューはネイティブから貰う。
          const saved = await RetracksPlayer.getSavedQueue();
          // QueueStore.kt が保存するのは id/uri/title/artist/album/durationMs/
          // artworkUri の7つだけ（→ QueueStore.kt の saveTracks）。isMusic/
          // folderId/folderName は持っていないので、ここで安全側の値を埋める。
          // 埋めずに as Track[] するだけだと、型は boolean/string|null を
          // 主張するのに実体は undefined のままになり、将来 isMusic で
          // キューを絞る処理を足した瞬間、復元したキューの曲が軒並み
          // 「非音楽」判定になって消える（起動直後の引き継ぎ時にしか
          // 起きないため、原因にたどり着きにくい）。
          const nativeQueue: Track[] = (saved.tracks as Track[]).map((t) => ({
            ...t,
            isMusic: t.isMusic ?? true,
            folderId: t.folderId ?? null,
            folderName: t.folderName ?? null,
          }));

          if (nativeQueue.length === current.queueSize) {
            applyQueue(nativeQueue);
            if (saved.key) queueKeyRef.current = saved.key;

            // 1巡の進捗は、保存してある順列がいま鳴っているキューと
            // 完全に同じ並びのときだけ引き継ぐ。長さだけを見ると、曲数が
            // たまたま同じ別の順列を掴んでしまう。
            // 識別子が無い場合（一覧からの再生、または識別子を保存する前の
            // 古いデータ）は全曲の順列を当ててみて、一致すれば拾う。
            const nativeIds = nativeQueue.map((t) => t.id);
            const restored = await loadShuffle(saved.key || ALL_KEY);
            const matches =
              restored != null &&
              restored.order.length === nativeIds.length &&
              restored.order.every((id, i) => id === nativeIds[i]);

            applyShuffle(matches ? { ...restored!, cursor: Math.max(0, current.index) } : null);
            lastIndexRef.current = matches ? Math.max(0, current.index) : -1;
            if (matches && !saved.key) queueKeyRef.current = ALL_KEY;
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

          await RetracksPlayer.setQueue(ordered, 0, queueKeyRef.current);
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

  // ---- 背景では画像のキャッシュを捨てる ---------------------------------
  useEffect(() => {
    // 一覧の画像がメモリの大半を占める。背景では誰も見ていないので手放す。
    // 実測でビットマップが 790枚/79MB から 633枚/59MB へ減った。
    // 再生はサービス側で続くので、捨てても音は途切れない。
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') Image.clearMemoryCache();
    });
    return () => subscription.remove();
  }, []);

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

      await RetracksPlayer.setQueue(ordered, state.cursor, key);

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

      // 順列を持たないので識別子も空にする。これを残すと、次回の起動で
      // 別のキューの順列を拾ってしまう。
      queueKeyRef.current = buildQueueKey('all');
      await RetracksPlayer.setQueue(source, Math.max(0, index), '');
      RetracksPlayer.play();
      addLog(`一覧から再生 ${index + 1}/${source.length}`);
    },
    [ready, addLog, applyShuffle, applyQueue]
  );

  /**
   * リピートの切り替え。OFF → 全曲 → 1曲 → OFF の順に巡る。
   *
   * 設定そのものはネイティブ側のプレイヤーが持っていて、次回の起動でも
   * 復元される。ここでは巡回の順番だけを決める。
   */
  const cycleRepeat = () => {
    const current = RetracksPlayer.getStatus().repeatMode ?? RepeatMode.All;
    const next =
      current === RepeatMode.Off
        ? RepeatMode.All
        : current === RepeatMode.All
          ? RepeatMode.One
          : RepeatMode.Off;
    RetracksPlayer.setRepeatMode(next);
    setStatus(RetracksPlayer.getStatus());
  };

  const rescan = useCallback(async () => {
    // 3本まとめて Promise.all にすると、アーティスト/アルバムの取得だけが
    // 失敗したときに曲一覧の再走査結果まで丸ごと捨てられてしまう。
    // allSettled にして、成功した分だけを反映する。
    const [libraryResult, artistsResult, albumsResult] = await Promise.allSettled([
      refreshLibrary(rawTracksRef.current),
      getArtists(),
      getAlbums(),
    ]);

    if (artistsResult.status === 'fulfilled') setRawArtists(artistsResult.value);
    if (albumsResult.status === 'fulfilled') setRawAlbums(albumsResult.value);

    if (libraryResult.status === 'fulfilled') {
      const result = libraryResult.value;
      applyTracks(result.tracks);
      addLog(
        `再走査 ${result.tracks.length}曲 / ${result.elapsedMs}ms ` +
          `(追加${result.added.length} 削除${result.removed.length})`
      );
    } else {
      addLog(`再走査 ERROR: ${String(libraryResult.reason)}`);
    }
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

  // 設定（音楽以外の除外・短い曲の除外・除外フォルダ・並べ替え）を適用した
  // 公開用の一覧。走査結果そのものは rawTracks 側に残し、設定が変わっても
  // ネイティブへ問い合わせ直さずに即座に反映できるようにする。
  const excludedFolderSet = useMemo(() => new Set(excludedFolderIds), [excludedFolderIds]);

  const tracks = useMemo(() => {
    let filtered = rawTracks;
    if (excludeNonMusic) filtered = filtered.filter((t) => t.isMusic);
    if (excludeShortTracks) {
      filtered = filtered.filter((t) => t.durationMs >= shortTrackThresholdSec * 1000);
    }
    if (excludedFolderSet.size > 0) {
      // folderId が無い曲（scanLibrary() 以外の由来、または走査と
      // getTrackFolders() の間に増えた曲）は除外しない側に倒す。
      filtered = filtered.filter((t) => !t.folderId || !excludedFolderSet.has(t.folderId));
    }
    return sortByField(filtered, (t) => t.title, articleOptions);
  }, [
    rawTracks,
    excludeNonMusic,
    excludeShortTracks,
    shortTrackThresholdSec,
    excludedFolderSet,
    articleOptions,
  ]);

  // 除外フォルダ設定画面向け。非表示のフォルダも含めて全件出す必要があるため
  // rawTracks（設定適用前）から作る。folderId が無い曲は集計しない。
  const folders = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; trackCount: number }>();
    for (const t of rawTracks) {
      if (!t.folderId) continue;
      const existing = byId.get(t.folderId);
      if (existing) {
        existing.trackCount += 1;
        continue;
      }
      byId.set(t.folderId, { id: t.folderId, name: t.folderName || t.folderId, trackCount: 1 });
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rawTracks]);

  const artists = useMemo(
    () => sortByField(rawArtists, (a) => a.name, articleOptions),
    [rawArtists, articleOptions]
  );

  const albums = useMemo(
    () => sortByField(rawAlbums, (a) => a.title, articleOptions),
    [rawAlbums, articleOptions]
  );

  // playAll・シャッフルの2巡目再構成など、再生系の処理は tracksRef を直接読む。
  // 除外された短い曲が紛れ込まないよう、公開用（設定適用後）の一覧と同期させる。
  //
  // 注意: この同期はコミット後の effect で行われるため、applyTracks() を
  // 呼んだ直後の“同じ関数の中で”tracksRef.current を読んでも、まだ古い値の
  // ままになる。現状それをやっている箇所は無い（playAll と1巡完了時の
  // 再構成は、どちらもユーザー操作／ネイティブの再生イベントが起点で、
  // 必ずこの effect が一度走った後に実行される）。新しく
  // 「applyTracks() の直後に tracksRef を読む」コードを足すときは、
  // この非同期性を踏まえること。
  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  const value: PlaybackValue = {
    ready,
    tracks,
    artists,
    albums,
    folders,
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
    repeatMode: status?.repeatMode ?? RepeatMode.All,
    cycleRepeat,
    rescan,
    clearStorage,
  };

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}
