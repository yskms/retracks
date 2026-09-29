import type { Track } from './library';

/**
 * Android向けフォールバック。ホーム画面ウィジェットは
 * `RetracksWidgetProvider.kt`（ネイティブ側、PlaybackServiceのイベントで
 * 直接更新）が担うため、JS側からの同期は不要。
 * 呼び出し側（src/playback.tsx）がOSを問わず同じ関数を呼べるようにするための
 * 空実装（iOS版は widgetSync.ios.ts が使われる）。
 */
export async function syncNowPlayingWidget(_track: Track | null): Promise<void> {
  // no-op
}
