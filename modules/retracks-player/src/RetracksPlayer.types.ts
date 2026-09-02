/** キューに積む1曲。JS 側で並べ替え済みの順序で渡すこと。 */
export type TrackInput = {
  id: string;
  uri: string;
  title: string;
  artist: string;
  album?: string | null;
  /** 曲の長さ（ミリ秒）。区間解決に使うので、判っているなら必ず渡す。 */
  durationMs: number;
};

/** RUSH の区間設定。null を渡すと RUSH OFF（フル再生）。 */
export type SegmentInput = {
  startMs: number;
  lengthMs: number;
  /** フェードアウトの長さ */
  fadeMs: number;
  /** フェードインの長さ */
  fadeInMs: number;
};

export type PlayerStatus = {
  connected: boolean;
  isPlaying: boolean;
  index: number;
  positionMs: number;
  durationMs: number;
  queueSize: number;
};

/** Player.REPEAT_MODE_* と同じ値 */
export enum RepeatMode {
  Off = 0,
  One = 1,
  All = 2,
}

export type RetracksPlayerEvents = {
  onTrackChange: (event: { index: number; id: string }) => void;
  onPlaybackStateChange: (event: { isPlaying: boolean }) => void;
  /**
   * 区間が切り替わったときの通知。
   * 切り出し自体は ExoPlayer が行うため、実経過時間と期待値の差で精度を測る。
   */
  onSegmentCut: (event: {
    expectedMs: number;
    elapsedMs: number;
    driftMs: number;
  }) => void;
};
