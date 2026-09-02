package expo.modules.retracksplayer

import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi

/**
 * RUSH（区間再生）の制御。
 *
 * 要件定義書 4.2 / 4.3 / 4.4 に対応する。
 *  - 開始位置へのシーク
 *  - 区間終了の検出と次曲への遷移
 *  - 終了直前のフェードアウト
 *
 * 区間の解決規則は JS 側の src/rush.ts と同一。両方を変更すること。
 */
data class Segment(
  val startMs: Long,
  val lengthMs: Long,
  val fadeMs: Long
)

@OptIn(UnstableApi::class)
class SegmentController(private val player: Player) : Player.Listener {

  companion object {
    /** 位置監視の間隔。区間の切り出し精度を決める。 */
    const val TICK_MS = 50L
  }

  /** null のときは RUSH OFF（通常のフル再生）。 */
  var segment: Segment? = null
    set(value) {
      field = value
      resolved = null
      if (value == null) {
        player.volume = 1f
      }
    }

  /** 曲ごとの長さ（ミリ秒）。mediaId をキーにする。 */
  private val durations = mutableMapOf<String, Long>()

  /** 区間を切って次曲へ送ったときの通知（計測用）。target と actual の差がズレ。 */
  var onCut: ((targetMs: Long, actualMs: Long) -> Unit)? = null

  private val handler = Handler(Looper.getMainLooper())
  private var resolved: Resolved? = null
  private var seekedForItem = false
  private var advancing = false
  private var ticking = false

  private data class Resolved(
    val start: Long,
    val end: Long,
    val fade: Long,
    val fadeStart: Long
  )

  private val tickRunnable = object : Runnable {
    override fun run() {
      tick()
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

  fun setDurations(map: Map<String, Long>) {
    durations.clear()
    durations.putAll(map)
    resolved = null
  }

  override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
    // 新しい曲に移ったので、区間の解決とシークをやり直す
    resolved = null
    seekedForItem = false
    advancing = false
    player.volume = 1f
  }

  private fun currentDurationMs(): Long? {
    val id = player.currentMediaItem?.mediaId
    val known = id?.let { durations[it] }
    if (known != null && known > 0) return known
    val fromPlayer = player.duration
    return if (fromPlayer > 0) fromPlayer else null
  }

  /**
   * 区間の解決。src/rush.ts の resolveSegment と同じ規則。
   *  - 開始位置が曲の長さを超える場合は 0 から
   *  - 終端は曲の長さで切り詰め
   *  - フェードは再生時間の半分を上限にクランプ
   */
  private fun resolve(durationMs: Long, seg: Segment): Resolved {
    val start = if (seg.startMs >= durationMs) 0L else seg.startMs
    val end = minOf(start + seg.lengthMs, durationMs)
    val length = maxOf(0L, end - start)
    val fade = maxOf(0L, minOf(seg.fadeMs, length / 2))
    return Resolved(start = start, end = end, fade = fade, fadeStart = end - fade)
  }

  private fun tick() {
    val seg = segment
    if (seg == null) {
      // RUSH OFF。フェード途中で切り替えられた場合に備えて音量だけ戻す。
      if (player.volume != 1f) player.volume = 1f
      return
    }
    if (player.playbackState != Player.STATE_READY) return
    if (advancing) return

    val durationMs = currentDurationMs() ?: return
    val r = resolved ?: resolve(durationMs, seg).also { resolved = it }

    // 開始位置へのシークは READY になってから一度だけ行う
    if (!seekedForItem) {
      seekedForItem = true
      if (r.start > 0 && player.currentPosition < r.start) {
        player.seekTo(r.start)
        return
      }
    }

    if (!player.isPlaying) return

    val pos = player.currentPosition

    // フェードアウト（要件 4.4）
    if (r.fade > 0 && pos >= r.fadeStart) {
      val progressed = (pos - r.fadeStart).toFloat() / r.fade.toFloat()
      player.volume = (1f - progressed).coerceIn(0f, 1f)
    }

    // 区間終了の検出（要件 4.3）
    if (pos >= r.end) {
      advancing = true
      onCut?.invoke(r.end, pos)
      advance()
    }
  }

  private fun advance() {
    if (player.hasNextMediaItem()) {
      player.seekToNextMediaItem()
      player.volume = 1f
    } else {
      // リピートOFFでキュー末尾に到達（要件 5.3）
      player.pause()
      player.volume = 1f
      advancing = false
    }
  }
}
