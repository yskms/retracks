import { NativeModule, requireNativeModule } from 'expo';

import type {
  PlayerStatus,
  RetracksPlayerEvents,
  SegmentInput,
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
  next(): void;
  previous(): void;
  skipTo(index: number): void;
  seekTo(positionMs: number): Promise<void>;
  getStatus(): PlayerStatus;
}

export default requireNativeModule<RetracksPlayerModule>('RetracksPlayer');
