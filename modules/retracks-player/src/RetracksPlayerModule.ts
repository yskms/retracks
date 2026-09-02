import { NativeModule, requireNativeModule } from 'expo';

import type {
  PlayerStatus,
  RetracksPlayerEvents,
  SegmentInput,
  TrackInput,
} from './RetracksPlayer.types';

declare class RetracksPlayerModule extends NativeModule<RetracksPlayerEvents> {
  /** サービスに接続する。他の API を呼ぶ前に一度だけ実行する。 */
  prepareAsync(): Promise<boolean>;
  /** キューを差し替える。戻り値は積まれた曲数。 */
  setQueue(tracks: TrackInput[], startIndex: number): Promise<number>;
  /** null で RUSH OFF。 */
  setSegment(segment: SegmentInput | null): void;
  setRepeatMode(mode: number): void;
  play(): void;
  pause(): void;
  next(): void;
  previous(): void;
  skipTo(index: number): void;
  seekTo(positionMs: number): Promise<void>;
  getStatus(): PlayerStatus;
}

export default requireNativeModule<RetracksPlayerModule>('RetracksPlayer');
