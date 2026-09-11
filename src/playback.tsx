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
  type TrackInput,
} from '../modules/retracks-player/src';
import { DEFAULT_SEGMENT, type SegmentSetting } from './rush';
import {
  deriveAlbums,
  deriveArtists,
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
 * 再生位置など高頻度（250ms間隔）で更新される部分だけを別コンテキストに
 * 分けている。usePlayback() の value に含めると、position が動くたびに
 * それを使うすべての画面・コンポーネントが再レンダーされてしまう
 * （2026-09-11、実機で再生中にネイティブヒープが数分でGB単位まで増え続け
 * OSに強制終了される不具合として発覚。usePlayback() の value オブジェクトを
 * 毎レンダー作り直していたため、Context の仕組み上 status の変化のたびに
 * 全画面が再レンダーされていた）。位置を必要とする少数のコンポーネント
 * （MiniPlayer・プレイヤー画面など）だけがこちらを読む。
 */
const PlaybackStatusContext = createContext<PlayerStatus | null>(null);

export function usePlaybackStatus(): PlayerStatus | null {
  return useContext(PlaybackStatusContext);
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

/**
 * RetracksPlayer.getStatus() は中身が同じでも呼ぶたびに新しいオブジェクトを
 * 返す。ポーリングのたびに素直に setStatus すると、一時停止中で値が1つも
 * 変わっていなくても PlaybackStatusContext の購読者（MiniPlayer・プレイヤー
 * 画面・デバッグ画面）が毎秒再レンダーされ続けてしまう（2026-09-11）。
 * フィールドを浅く比較し、同じなら setStatus 側で prev をそのまま返させて
 * Reactに再レンダーを止めさせる。
 */
function statusEquals(a: PlayerStatus | null, b: PlayerStatus | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.connected === b.connected &&
    a.isPlaying === b.isPlaying &&
    a.index === b.index &&
    a.positionMs === b.positionMs &&
    a.durationMs === b.durationMs &&
    a.queueSize === b.queueSize &&
    a.repeatMode === b.repeatMode &&
    a.fullPlayback === b.fullPlayback
  );
}

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const { excludeShortTracks, shortTrackThresholdSec, excludeNonMusic, excludedFolderIds, articleOptions } =
    useSettings();

  const [ready, setReady] = useState(false);
  // 走査そのままの生データ。公開する tracks は、この下で設定（音楽以外・
  // 短い曲・フォルダの除外）を適用した派生値にする。artists/albums は
  // さらにその tracks から導出する（MediaStore への別クエリを使わない。
  // → deriveArtists()/deriveAlbums() のコメント）。
  const [rawTracks, setRawTracks] = useState<Track[]>([]);
  // アルバムのリリース年。expo-music-library が公開していないため
  // 別途取得する（→ RetracksPlayer.getAlbumYears()）。albumId→year。
  const [albumYears, setAlbumYears] = useState<Record<string, number>>({});
  const [queue, setQueue] = useState<Track[]>([]);
  const [status, setStatus] = useState<PlayerStatus | null>(null);
  // toggle() 等、usePlayback() の value（250ms ごとには作り直さない）から
  // isPlaying を読みたい箇所向け。クロージャに status を持たせると、value を
  // メモ化した時点の古い値のまま固まってしまうため、常に最新を指す ref で読む。
  const statusRef = useRef<PlayerStatus | null>(null);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  // repeatMode は status（250ms ごとに新しいオブジェクトになる）由来だが、
  // 値そのものはユーザー操作でしか変わらない。value に status をそのまま
  // 含めると再生中ずっと value が作り直され続けてしまうため、実際に値が
  // 変わったときだけ更新される独立した state にして切り離す。
  const [repeatModeState, setRepeatModeState] = useState<number>(RepeatMode.All);
  useEffect(() => {
    const next = status?.repeatMode ?? RepeatMode.All;
    setRepeatModeState((prev) => (prev === next ? prev : next));
  }, [status]);
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
   * バックグラウンドの間、位置ポーリング（1秒間隔）を止めるためのフラグ。
   * 画面が見えていない間は誰も status を見ていないので、毎秒ネイティブを
   * 呼び続けるのは電池の無駄（2026-09-11、メモリリーク修正の副次的な
   * 改善候補として記録していたもの）。stateにせず ref にしているのは、
   * この値が変わってもコンポーネントを再レンダーする必要が無いため
   * （setInterval のコールバック内で毎回読むだけで足りる）。
   */
  const isBackgroundRef = useRef(AppState.currentState !== 'active');

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

        // アルバムの年は曲一覧の走査結果を待つ必要が無いので、loadLibrary() と
        // 並行に投げる。artists/albums 自体は tracks から導出されるので
        // 別途フェッチする必要がない（→ deriveArtists()/deriveAlbums()）。
        void RetracksPlayer.getAlbumYears()
          .then((years) => {
            if (!cancelled) setAlbumYears(years);
          })
          .catch(() => {
            // 年が引けなくてもアルバム一覧自体は組み立てられる（year: null に倒れる）
          });

        const result = await loadLibrary();
        if (cancelled) return;
        applyTracks(result.tracks);

        // 再生していなくても FAB に「続きから」を出せるよう、保存済みの1巡を読む
        const savedAll = await loadShuffle(ALL_KEY);
        if (!cancelled && savedAll) setAllProgress(progressOf(savedAll));

        // 走査は待たせず裏で行い、差分があったときだけ静かに反映する。
        // 起動のたびに2〜4秒待たされるのを避けつつ、曲の増減には追従する。
        // artists/albums は tracks から導出されるので、applyTracks() だけで
        // 両方とも一緒に最新化される（曲一覧とズレる、という形のバグが
        // 構造的に起きなくなった）。
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
          // 何を鳴らしているかを知っているのはネイティブ側だけ。JS の保存を
          // 当てにすると、別のキュー（例：全曲シャッフル）の順列に番号だけを
          // 当てはめてしまい、画面と音が食い違う。キューはネイティブから貰う。
          const saved = await RetracksPlayer.getSavedQueue();
          // QueueStore.kt が保存するのは id/uri/title/artist/album/durationMs/
          // artworkUri の7つだけ（→ QueueStore.kt の saveTracks）。artistId/
          // albumId/trackNumber/discNumber/isMusic/folderId/folderName は
          // 持っていない。まず走査済みの library（result.tracks、直前の
          // applyTracks() と同じ内容）を id で引き、そこにある曲は完全な
          // Track で差し替える。走査後に削除・除外された曲（library 側から
          // 消えている）だけ、安全側の値を埋めた不完全な Track にフォールバック
          // する。
          //
          // getSavedQueue() は正直に TrackInput（7フィールドだけ）を返す。
          // 以前はここを as Track[] でキャストしていたが、それは型が
          // 「isMusic は boolean」「artistId は string | null」と主張する
          // フィールドの実体を、埋めないまま undefined にできてしまうという
          // ことでもあった。isMusic 等はそれで気づかれにくい形の不具合に
          // なるだけで済んだが、artistId は影響が直接的だった。ウィジェットから
          // 起動してすぐプレイヤー画面へ来た直後（＝この経路で currentTrack が
          // 作られた直後）にアーティスト名を押すと、undefined の artistId から
          // 名前へフォールバックした id で絞り込むことになり、実際は artistId
          // を持つそのアーティストの曲とは一致せず、アーティスト詳細が空に
          // なっていた（2026-09-11、実機で発覚）。
          //
          // fallback() を Track を返す関数として書くことで、Track に
          // フィールドを足したとき（今後もありうる：追加日、アルバムアーティスト
          // 等）ここが型エラーで止まるようにする。「復元経路も直さなきゃ」を
          // 人間が思い出す前提にしない。
          const fallback = (t: TrackInput): Track => ({
            id: t.id,
            uri: t.uri,
            title: t.title,
            artist: t.artist,
            album: t.album ?? null,
            durationMs: t.durationMs,
            artworkUri: t.artworkUri ?? null,
            isMusic: true,
            folderId: null,
            folderName: null,
            albumId: null,
            artistId: null,
            trackNumber: null,
            discNumber: null,
          });
          const tracksById = new Map(result.tracks.map((t) => [t.id, t]));
          const nativeQueue: Track[] = saved.tracks.map(
            (t) => tracksById.get(t.id) ?? fallback(t)
          );

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
      // ポーリング（1秒間隔）だけに任せると、曲送り操作をしてからジャケット・
      // 曲名・ヘッダーのキュー位置が変わるまで最大1秒の遅延に感じられる
      // （2026-09-11）。イベントを受け取った時点で即座に反映させる。
      // shuffle state の有無（playFrom か playTracks か）に関わらず、
      // どの曲送りでも遅延なく反映したいので、下のガードより前で呼ぶ。
      const latestStatus = RetracksPlayer.getStatus();
      setStatus((prev) => (statusEquals(prev, latestStatus) ? prev : latestStatus));

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
          // ここも -1（未再生）にする。0 のままだと、1曲だけのキューでは
          // この直後の setQueue() が出す onTrackChange（index 0）を
          // 「previous(0) === order.length-1(0)」でまた1巡完了と誤検知し、
          // 再構成→setQueue→誤検知……のループに入ってしまう（起点を
          // -1 にした今回の修正は、この再構成パス自身には効いていなかった）。
          lastIndexRef.current = -1;

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

    const timer = setInterval(() => {
      // status を見ているのは画面（MiniPlayer・プレイヤー画面・デバッグ画面）
      // だけで、バックグラウンドでは誰も見ていない。再生自体はサービス側で
      // 続くので、ここを止めても音は途切れない。→ isBackgroundRef のコメント。
      if (isBackgroundRef.current) return;
      const next = RetracksPlayer.getStatus();
      setStatus((prev) => (statusEquals(prev, next) ? prev : next));
    }, 1000);

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

  // ---- バックグラウンドでの振る舞い -------------------------------------
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      // 一覧の画像がメモリの大半を占める。背景では誰も見ていないので手放す。
      // 実測でビットマップが 790枚/79MB から 633枚/59MB へ減った。
      // 再生はサービス側で続くので、捨てても音は途切れない。
      if (state === 'background') Image.clearMemoryCache();
      // 位置ポーリング（下の再生イベント effect）を止める・再開するため
      // のフラグ更新。→ isBackgroundRef の宣言コメント参照。
      isBackgroundRef.current = state !== 'active';
      // 前面に戻った瞬間に一度だけ即時反映する。ポーリングは止めていた間
      // 動いていないので、次の1秒待ちにすると戻った直後だけ古い位置・
      // 再生状態が一瞬見えてしまう。
      if (state === 'active') {
        const latest = RetracksPlayer.getStatus();
        setStatus((prev) => (statusEquals(prev, latest) ? prev : latest));
      }
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
      // -1（未再生）にしておく。state.cursor を入れると、1曲だけの
      // キューでは cursor が「先頭かつ末尾」になり、再生開始直後の
      // 最初の onTrackChange（previous=cursor=0, event.index=0）を
      // 「1巡完了して先頭へ戻った」と誤検知し、キュー再構成が無限に
      // 繰り返される不具合があった（1曲だけのアルバムをシャッフル
      // 再生すると再生が始まらない）。
      lastIndexRef.current = -1;

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
  const cycleRepeat = useCallback(() => {
    const current = RetracksPlayer.getStatus().repeatMode ?? RepeatMode.All;
    const next =
      current === RepeatMode.Off
        ? RepeatMode.All
        : current === RepeatMode.All
          ? RepeatMode.One
          : RepeatMode.Off;
    RetracksPlayer.setRepeatMode(next);
    setStatus(RetracksPlayer.getStatus());
  }, []);

  const rescan = useCallback(async () => {
    // 2本まとめて Promise.all にすると、アルバムの年の取得だけが失敗した
    // ときに曲一覧の再走査結果まで丸ごと捨てられてしまう。allSettled に
    // して、成功した分だけを反映する。artists/albums は tracks から
    // 導出されるので、ここで別途取得する必要はない。
    const [libraryResult, yearsResult] = await Promise.allSettled([
      refreshLibrary(rawTracksRef.current),
      RetracksPlayer.getAlbumYears(),
    ]);

    if (yearsResult.status === 'fulfilled') setAlbumYears(yearsResult.value);

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

  // status が変わるたび（毎秒）再計算されるが、返すのは queue の要素そのもの
  // （コピーではない）なので、index が変わらない限り参照は同じになる。
  // これにより value の useMemo が毎秒作り直されずに済んでいる——ここで
  // 新しいオブジェクト/配列を返す実装に変えると、この下の value が毎秒
  // 新しい参照になり、usePlayback() 全消費者の再レンダー止めが丸ごと
  // 効かなくなる（2026-09-11 のネイティブメモリリーク修正の前提）。
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
    // 他の一覧（tracks/artists/albums）と同じ並べ替え規則に揃える
    // （Collatorを都度作らず使い回す。→ src/sorting.ts）。
    return sortByField([...byId.values()], (f) => f.name, articleOptions);
  }, [rawTracks, articleOptions]);

  // tracks（設定適用後）から導出する。これにより「音楽以外を除外」等の
  // 設定が、曲一覧だけでなくアーティスト/アルバムタブにも一様に効くように
  // なった。以前は getArtists()/getAlbums() で MediaStore に別問い合わせを
  // していたため、この2つのタブだけ設定が効かない、という但し書きが
  // 複数の設定項目に重なっていた（→ docs/requirements.md 10.6）。
  const artists = useMemo(
    () => sortByField(deriveArtists(tracks), (a) => a.name, articleOptions),
    [tracks, articleOptions]
  );

  const albums = useMemo(
    () => sortByField(deriveAlbums(tracks, albumYears), (a) => a.title, articleOptions),
    [tracks, albumYears, articleOptions]
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

  // status は含めない（250msごとに新しいオブジェクトになるため。
  // → usePlaybackStatus()）。toggle は statusRef 経由で最新の isPlaying を
  // 読むので、この value が古いタイミングで作られていても問題ない。
  const value: PlaybackValue = useMemo(
    () => ({
      ready,
      tracks,
      artists,
      albums,
      folders,
      queue,
      currentTrack,
      progress,
      allProgress,
      setting,
      rushOn,
      log,
      setSetting: (update: (prev: SegmentSetting) => SegmentSetting) =>
        setSettingState((prev) => update(prev)),
      setRushOn,
      playTracks,
      playAll,
      playFrom,
      play: () => RetracksPlayer.play(),
      pause: () => RetracksPlayer.pause(),
      toggle: () =>
        statusRef.current?.isPlaying ? RetracksPlayer.pause() : RetracksPlayer.play(),
      next: () => RetracksPlayer.next(),
      previous: () => RetracksPlayer.previous(),
      skipTo: (index: number) => RetracksPlayer.skipTo(index),
      seekTo: (positionMs: number) => void RetracksPlayer.seekTo(positionMs),
      playCurrentFromStart: () => RetracksPlayer.playCurrentFromStart(),
      repeatMode: repeatModeState,
      cycleRepeat,
      rescan,
      clearStorage,
    }),
    [
      ready,
      tracks,
      artists,
      albums,
      folders,
      queue,
      currentTrack,
      progress,
      allProgress,
      setting,
      rushOn,
      log,
      setRushOn,
      playTracks,
      playAll,
      playFrom,
      repeatModeState,
      cycleRepeat,
      rescan,
      clearStorage,
    ]
  );

  return (
    <PlaybackStatusContext.Provider value={status}>
      <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>
    </PlaybackStatusContext.Provider>
  );
}
