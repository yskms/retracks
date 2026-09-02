/**
 * RUSH の区間解決ロジック。
 *
 * 要件定義書 4.2（境界処理）と 4.4（フェードのクランプ）をここに集約する。
 * 区間の値は必ずこの関数を経由して取得すること。秒指定 / ％指定の差も、
 * 将来はこの層で吸収する（docs/requirements.md 4.2）。
 */

export type SegmentSetting = {
  /** 再生開始位置（秒） */
  startSec: number;
  /** 再生時間（秒） */
  lengthSec: number;
  /** フェードアウト時間（秒） */
  fadeSec: number;
  /** フェードイン時間（秒） */
  fadeInSec: number;
};

export type ResolvedSegment = {
  /** 実効的な開始位置（秒） */
  start: number;
  /** 実効的な終了位置（秒） */
  end: number;
  /** 実効的な再生時間（秒） */
  length: number;
  /** 実効的なフェードアウト時間（秒） */
  fade: number;
  /** 実効的なフェードイン時間（秒） */
  fadeIn: number;
  /** フェードアウトを開始する位置（秒） */
  fadeStart: number;
  /** 境界処理が働いたか（検証用） */
  clamped: {
    startResetToZero: boolean;
    endTruncated: boolean;
    fadeShortened: boolean;
  };
};

export const DEFAULT_SEGMENT: SegmentSetting = {
  startSec: 20,
  lengthSec: 35,
  fadeSec: 2,
  fadeInSec: 1,
};

/**
 * 曲の長さに対して区間設定を解決する。
 *
 * - 開始位置が曲の長さを超える場合は 0 秒から再生する
 * - 開始位置＋再生時間が曲の長さを超える場合は曲の終端で打ち切る
 * - フェード時間は再生時間の半分を上限にクランプする
 */
export function resolveSegment(
  durationSec: number,
  setting: SegmentSetting
): ResolvedSegment {
  const duration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;

  const startResetToZero = setting.startSec >= duration;
  const start = startResetToZero ? 0 : setting.startSec;

  const wantedEnd = start + setting.lengthSec;
  const endTruncated = wantedEnd > duration;
  const end = endTruncated ? duration : wantedEnd;

  const length = Math.max(0, end - start);

  // イン・アウトそれぞれを再生時間の半分以下にすることで、両者が重ならないことも保証される
  const maxFade = length / 2;
  const fadeShortened =
    setting.fadeSec > maxFade || setting.fadeInSec > maxFade;
  const fade = Math.max(0, Math.min(setting.fadeSec, maxFade));
  const fadeIn = Math.max(0, Math.min(setting.fadeInSec, maxFade));

  return {
    start,
    end,
    length,
    fade,
    fadeIn,
    fadeStart: end - fade,
    clamped: { startResetToZero, endTruncated, fadeShortened },
  };
}

/**
 * 区間内の位置に対する音量（フェードイン／フェードアウトを反映）。
 *
 * 実際の再生時の音量制御は Kotlin 側 SegmentController が行う。こちらは
 * 表示・確認用。規則を変えるときは両方を直すこと。
 */
export function fadeVolumeAt(positionSec: number, segment: ResolvedSegment): number {
  const offset = positionSec - segment.start;
  if (segment.fadeIn > 0 && offset < segment.fadeIn) {
    return Math.max(0, Math.min(1, offset / segment.fadeIn));
  }
  if (segment.fade > 0 && positionSec > segment.fadeStart) {
    if (positionSec >= segment.end) return 0;
    return Math.max(0, Math.min(1, (segment.end - positionSec) / segment.fade));
  }
  return 1;
}
