import { NativeModule, requireNativeModule } from 'expo';

import type {
  PlayerStatus,
  RetracksPlayerEvents,
  SegmentInput,
  TrackFolders,
  TrackInput,
} from './RetracksPlayer.types';

declare class RetracksPlayerModule extends NativeModule<RetracksPlayerEvents> {
  /**
   * 通知の権限をリクエストする（Android 13 未満では常に granted）。
   * これが無いと再生中の通知もロック画面のメディア操作も出せない。
   */
  requestNotificationPermissionAsync(): Promise<{ status: string; granted: boolean }>;
  /** サービスに接続する。他の API を呼ぶ前に一度だけ実行する。 */
  prepareAsync(): Promise<boolean>;
  /** キューを差し替える。戻り値は積まれた曲数。 */
  setQueue(tracks: TrackInput[], startIndex: number, queueKey: string): Promise<number>;
  /**
   * ネイティブ側に控えてあるキュー。サービスだけが生きている状態から
   * 起動したときに、鳴っているキューをそのまま画面へ戻すために使う。
   */
  getSavedQueue(): Promise<{ key: string; tracks: TrackInput[] }>;
  /** null で RUSH OFF。 */
  setSegment(segment: SegmentInput | null): void;
  setRepeatMode(mode: number): void;
  /**
   * アルバムIDごとのリリース年。expo-music-library が MediaStore の YEAR を
   * 公開していないため、こちらで直接読む。
   */
  getAlbumYears(): Promise<Record<string, number>>;
  /** iOS Musicライブラリのジャケットを、表示に必要な大きさで遅延取得する。 */
  getArtworkDataUri(trackId: string, size: number): Promise<string | null>;
  /**
   * 曲ごとの「音楽かどうか」とフォルダ。expo-music-library がどちらも
   * 公開していないため、こちらで直接読む（→ RetracksPlayerModule.kt）。
   */
  getTrackFolders(): Promise<TrackFolders>;
  /**
   * 端末から曲を削除する（Android 10 以降のみ）。ids は削除したい曲の Track.id
   * （URI はネイティブ側で id から組み立てる。→ RetracksPlayerModule.kt の
   * contentUriFor()）。
   *
   * 戻り値は実際に削除できた件数。ユーザーが OS の確認ダイアログを拒否した
   * 場合はエラーではなく、その時点までに削除できた件数（0 を含む）が返る
   * （Android 11+ は全件か0件、Android 10 は1件拒否した時点で打ち切り）。
   *
   * 次の場合は reject する。削除フロー自体が成立しなかった（Activity が
   * 取得できない・確認ダイアログを表示できない・id が不正）、Android 10 で
   * 全件が delete() の例外で失敗した、Android 9 以前（非対応）。
   *
   * iOS はミュージックライブラリから曲を削除する公開 API が無いため、
   * reject せず常に 0 を返す。呼ぶ前に useDeleteTracks の CAN_DELETE_TRACKS
   * で対応環境か確認すること。
   */
  deleteTracksAsync(ids: string[]): Promise<number>;
  /**
   * プロセスが前回どう終わったかの履歴。新しい順に最大10件。
   * 再生が勝手に止まる症状の原因調査に使う。
   */
  getExitReasons(): Promise<
    { timestamp: number; reason: string; description: string; importance: number }[]
  >;
  /** いまの曲を区間を外して最初から通しで再生する。次の曲からは元に戻る。 */
  playCurrentFromStart(): void;
  play(): void;
  pause(): void;
  /**
   * 再生/一時停止の切り替え。JS 側で status.isPlaying を見て play()/pause()
   * を出し分けるのではなく、こちらを使うこと。ネイティブ側で現在の Player
   * 状態を見て原子的に決めるため、バッファリング中の一瞬の isPlaying=false
   * に引きずられた誤判定や、イベントがJSへ届く前の連打での重複送信が
   * 起きない（2026-10 → RetracksPlayerModule.kt の toggle() のコメント）。
   */
  toggle(): void;
  next(): void;
  previous(): void;
  skipTo(index: number): void;
  seekTo(positionMs: number): Promise<void>;
  /**
   * 現在の再生状態。ネイティブ側が保持しているスナップショットを返すだけで、
   * 呼んだ時点でプレイヤーを読みに行かない（200ms間隔の更新＋状態が変わる
   * イベント直後の同期更新で鮮度を保っている。→ RetracksPlayerModule.kt
   * の refreshSnapshot()）。同期更新が無い箇所で「操作した直後に呼んで
   * 最新値を得る」ような使い方をすると、最大200ms古い値を拾うことがある
   * （2026-09-11、曲送り操作の反応が鈍く見えた不具合の原因 → 要件定義書13章）。
   */
  getStatus(): PlayerStatus;
}

export default requireNativeModule<RetracksPlayerModule>('RetracksPlayer');
