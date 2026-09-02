package expo.modules.retracksplayer

import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi

/**
 * RUSH（区間再生）の設定。
 *
 * 区間の「切り出し」自体は MediaItem.ClippingConfiguration で ExoPlayer に任せる。
 * このクラスが受け持つのはフェードイン／フェードアウトの音量ランプだけ。
 *
 * 役割分担の理由：位置監視を Handler で回して終了を検出する方式では、メインスレッドが
 * UI 描画で混むと 200ms 前後の遅れが出た（実測 173〜265ms）。切る処理を ExoPlayer 側へ
 * 移すことでサンプル単位の精度になり、フェードのタイミングだけがこのループに残る。
 * フェードは数百ms ずれても聴感に出ない。
 */
data class Segment(
  val startMs: Long,
  val lengthMs: Long,
  /** フェードアウトの長さ */
  val fadeMs: Long,
  /** フェードインの長さ */
  val fadeInMs: Long
)

/** 曲の長さに対して解決済みの区間。 */
data class ResolvedSegment(
  val start: Long,
  val end: Long,
  val length: Long,
  val fadeOut: Long,
  val fadeIn: Long
)

@OptIn(UnstableApi::class)
class SegmentController(private val player: Player) : Player.Listener {

  companion object {
    /** フェードの音量更新間隔。 */
    const val TICK_MS = 50L

    /**
     * 区間の解決。JS 側の src/rush.ts と同じ規則。両方を変更すること。
     *
     *  - 開始位置が曲の長さを超える場合は 0 から（要件 4.2）
     *  - 終端は曲の長さで切り詰め（要件 4.2）
     *  - フェードは再生時間の半分を上限にクランプ（要件 4.4）。
     *    イン・アウトそれぞれを半分以下にすることで、両者が重ならないことも保証される。
     */
    fun resolve(durationMs: Long, seg: Segment): ResolvedSegment {
      val duration = if (durationMs > 0) durationMs else 0L
      val start = if (seg.startMs >= duration) 0L else seg.startMs
      val end = minOf(start + seg.lengthMs, duration)
      val length = maxOf(0L, end - start)
      val half = length / 2
      return ResolvedSegment(
        start = start,
        end = end,
        length = length,
        fadeOut = maxOf(0L, minOf(seg.fadeMs, half)),
        fadeIn = maxOf(0L, minOf(seg.fadeInMs, half))
      )
    }
  }

  /** null のときは RUSH OFF（通常のフル再生）。 */
  @Volatile
  var segment: Segment? = null

  /**
   * 区間の切り替わりを通知する（計測用）。
   * ExoPlayer が切るようになったため、tick の遅れとは無関係な
   * 「実経過時間 vs 期待値」で精度を測る。
   */
  var onCut: ((expectedMs: Long, elapsedMs: Long) -> Unit)? = null

  private val handler = Handler(Looper.getMainLooper())
  private var ticking = false

  private var itemStartedAtMs = 0L
  private var itemExpectedMs = 0L
  private var pausedDuringItem = false

  private val tickRunnable = object : Runnable {
    override fun run() {
      applyFade()
      if (ticking) handler.postDelayed(this, TICK_MS)
    }
  }

  fun attach() {
    player.addListener(this)
    if (!ticking) {
      ticking = true
      handler.post(tickRunnable)
    }
  }

  fun detach() {
    ticking = false
    handler.removeCallbacks(tickRunnable)
    player.removeListener(this)
  }

  override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
    val now = System.currentTimeMillis()

    // ひとつ前の曲について、期待した長さどおりに切れたかを報告する。
    // 途中で一時停止されていた場合は計測が濁るので送らない。
    if (itemStartedAtMs > 0 && itemExpectedMs > 0 && !pausedDuringItem &&
      reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO
    ) {
      onCut?.invoke(itemExpectedMs, now - itemStartedAtMs)
    }

    itemStartedAtMs = now
    itemExpectedMs = 0L
    pausedDuringItem = false
    player.volume = if (segment?.fadeInMs?.let { it > 0 } == true) 0f else 1f
  }

  override fun onIsPlayingChanged(isPlaying: Boolean) {
    if (!isPlaying) pausedDuringItem = true
  }

  private fun applyFade() {
    val seg = segment
    if (seg == null) {
      if (player.volume != 1f) player.volume = 1f
      return
    }
    if (player.playbackState != Player.STATE_READY) return

    // ClippingConfiguration 適用時、duration も currentPosition も
    // 切り出した区間を基準にした値になる。
    val duration = player.duration
    if (duration <= 0) return
    if (itemExpectedMs == 0L) itemExpectedMs = duration

    val pos = player.currentPosition.coerceIn(0L, duration)
    val half = duration / 2
    val fadeIn = maxOf(0L, minOf(seg.fadeInMs, half))
    val fadeOut = maxOf(0L, minOf(seg.fadeMs, half))

    val volume = when {
      fadeIn > 0 && pos < fadeIn -> pos.toFloat() / fadeIn.toFloat()
      fadeOut > 0 && pos > duration - fadeOut ->
        (duration - pos).toFloat() / fadeOut.toFloat()
      else -> 1f
    }
    player.volume = volume.coerceIn(0f, 1f)
  }
}
