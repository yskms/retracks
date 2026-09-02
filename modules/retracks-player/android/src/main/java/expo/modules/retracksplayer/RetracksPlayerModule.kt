package expo.modules.retracksplayer

import android.content.ComponentName
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.MoreExecutors
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class TrackInput : Record {
  @Field var id: String = ""
  @Field var uri: String = ""
  @Field var title: String = ""
  @Field var artist: String = ""
  @Field var album: String? = null
  @Field var durationMs: Double = 0.0
}

class SegmentInput : Record {
  @Field var startMs: Double = 0.0
  @Field var lengthMs: Double = 0.0
  @Field var fadeMs: Double = 0.0
}

/**
 * MediaController はそれを生成したスレッド（メインスレッド）からしか操作できない。
 * Expo の Function / AsyncFunction は JS スレッドで動くため、コントローラに触る処理は
 * すべて mainHandler 経由でメインスレッドへ回している。
 *
 * getStatus は JS 側から高頻度で呼ばれるので、毎回スレッドを跨がずに済むよう
 * メインスレッドで更新したスナップショットを返す。
 */
@OptIn(UnstableApi::class)
class RetracksPlayerModule : Module() {

  companion object {
    private const val SNAPSHOT_INTERVAL_MS = 200L
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private var controller: MediaController? = null
  private var polling = false

  @Volatile
  private var snapshot: Map<String, Any?> = emptySnapshot()

  private fun emptySnapshot(): Map<String, Any?> = mapOf(
    "connected" to false,
    "isPlaying" to false,
    "index" to -1,
    "positionMs" to 0.0,
    "durationMs" to 0.0,
    "queueSize" to 0
  )

  /** メインスレッドで実行する。既にメインスレッドならそのまま走らせる。 */
  private fun onMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block() else mainHandler.post(block)
  }

  private val snapshotRunnable = object : Runnable {
    override fun run() {
      val c = controller
      snapshot = if (c == null) {
        emptySnapshot()
      } else {
        mapOf(
          "connected" to true,
          "isPlaying" to c.isPlaying,
          "index" to c.currentMediaItemIndex,
          "positionMs" to c.currentPosition.toDouble(),
          "durationMs" to (c.duration.takeIf { it > 0 }?.toDouble() ?: 0.0),
          "queueSize" to c.mediaItemCount
        )
      }
      if (polling) mainHandler.postDelayed(this, SNAPSHOT_INTERVAL_MS)
    }
  }

  private val playerListener = object : Player.Listener {
    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
      sendEvent(
        "onTrackChange",
        mapOf(
          "index" to (controller?.currentMediaItemIndex ?: -1),
          "id" to (mediaItem?.mediaId ?: "")
        )
      )
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
      sendEvent("onPlaybackStateChange", mapOf("isPlaying" to isPlaying))
    }
  }

  override fun definition() = ModuleDefinition {
    Name("RetracksPlayer")

    Events("onTrackChange", "onPlaybackStateChange", "onSegmentCut")

    /** サービスに接続する。他の API を呼ぶ前に一度だけ実行すること。 */
    AsyncFunction("prepareAsync") { promise: Promise ->
      if (controller != null) {
        promise.resolve(true)
        return@AsyncFunction
      }
      val context = appContext.reactContext
        ?: throw CodedException("React context is not available")

      onMain {
        try {
          val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
          val future = MediaController.Builder(context, token).buildAsync()
          future.addListener({
            try {
              val c = future.get()
              c.addListener(playerListener)
              controller = c

              // 区間の切り出しを JS 側へ通知する（計測用）
              PlaybackService.instance?.segmentController?.onCut = { targetMs, actualMs ->
                sendEvent(
                  "onSegmentCut",
                  mapOf(
                    "targetMs" to targetMs.toDouble(),
                    "actualMs" to actualMs.toDouble(),
                    "driftMs" to (actualMs - targetMs).toDouble()
                  )
                )
              }

              if (!polling) {
                polling = true
                mainHandler.post(snapshotRunnable)
              }
              promise.resolve(true)
            } catch (e: Exception) {
              promise.reject(CodedException("Failed to connect to PlaybackService", e))
            }
          }, MoreExecutors.directExecutor())
        } catch (e: Exception) {
          promise.reject(CodedException("Failed to build MediaController", e))
        }
      }
    }

    /** キューを差し替える。tracks は JS 側で並べ替え済み（シャッフル順列）であること。 */
    AsyncFunction("setQueue") { tracks: List<TrackInput>, startIndex: Int, promise: Promise ->
      onMain {
        val c = controller
        if (c == null) {
          promise.reject(CodedException("Player is not prepared"))
          return@onMain
        }
        val items = tracks.map { t ->
          MediaItem.Builder()
            .setMediaId(t.id)
            .setUri(t.uri)
            .setMediaMetadata(
              MediaMetadata.Builder()
                .setTitle(t.title)
                .setArtist(t.artist)
                .setAlbumTitle(t.album)
                .build()
            )
            .build()
        }
        PlaybackService.instance?.segmentController
          ?.setDurations(tracks.associate { it.id to it.durationMs.toLong() })

        c.setMediaItems(items, startIndex.coerceIn(0, maxOf(0, items.size - 1)), 0L)
        c.prepare()
        promise.resolve(items.size)
      }
    }

    /** RUSH の区間設定。null を渡すと RUSH OFF（フル再生）。 */
    Function("setSegment") { segment: SegmentInput? ->
      onMain {
        PlaybackService.instance?.segmentController?.segment = segment?.let {
          Segment(
            startMs = it.startMs.toLong(),
            lengthMs = it.lengthMs.toLong(),
            fadeMs = it.fadeMs.toLong()
          )
        }
      }
    }

    /** リピート。0=OFF, 1=1曲, 2=全曲（Player.REPEAT_MODE_* と同じ） */
    Function("setRepeatMode") { mode: Int ->
      onMain { controller?.repeatMode = mode.coerceIn(0, 2) }
    }

    Function("play") { onMain { controller?.play() } }
    Function("pause") { onMain { controller?.pause() } }
    Function("next") { onMain { controller?.seekToNextMediaItem() } }
    Function("previous") { onMain { controller?.seekToPreviousMediaItem() } }
    Function("skipTo") { index: Int -> onMain { controller?.seekTo(index, 0L) } }

    AsyncFunction("seekTo") { positionMs: Double, promise: Promise ->
      onMain {
        controller?.seekTo(positionMs.toLong())
        promise.resolve(null)
      }
    }

    /** メインスレッドで更新済みのスナップショットを返す（コントローラには触らない）。 */
    Function("getStatus") { snapshot }

    OnDestroy {
      polling = false
      onMain {
        mainHandler.removeCallbacks(snapshotRunnable)
        controller?.removeListener(playerListener)
        controller?.release()
        controller = null
      }
    }
  }
}
