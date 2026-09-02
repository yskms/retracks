package expo.modules.retracksplayer

import android.content.ComponentName
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

@OptIn(UnstableApi::class)
class RetracksPlayerModule : Module() {

  private var controller: MediaController? = null

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
          promise.resolve(true)
        } catch (e: Exception) {
          promise.reject(CodedException("Failed to connect to PlaybackService", e))
        }
      }, MoreExecutors.directExecutor())
    }

    /** キューを差し替える。tracks は JS 側で並べ替え済み（シャッフル順列）であること。 */
    AsyncFunction("setQueue") { tracks: List<TrackInput>, startIndex: Int, promise: Promise ->
      val c = controller ?: run {
        promise.reject(CodedException("Player is not prepared"))
        return@AsyncFunction
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

    /** RUSH の区間設定。null を渡すと RUSH OFF（フル再生）。 */
    Function("setSegment") { segment: SegmentInput? ->
      PlaybackService.instance?.segmentController?.segment = segment?.let {
        Segment(
          startMs = it.startMs.toLong(),
          lengthMs = it.lengthMs.toLong(),
          fadeMs = it.fadeMs.toLong()
        )
      }
    }

    /** リピート。0=OFF, 1=1曲, 2=全曲（Player.REPEAT_MODE_* と同じ） */
    Function("setRepeatMode") { mode: Int ->
      controller?.repeatMode = mode.coerceIn(0, 2)
    }

    Function("play") { controller?.play() }
    Function("pause") { controller?.pause() }
    Function("next") { controller?.seekToNextMediaItem() }
    Function("previous") { controller?.seekToPreviousMediaItem() }
    Function("skipTo") { index: Int -> controller?.seekTo(index, 0L) }

    AsyncFunction("seekTo") { positionMs: Double, promise: Promise ->
      controller?.seekTo(positionMs.toLong())
      promise.resolve(null)
    }

    Function("getStatus") {
      val c = controller
      mapOf(
        "connected" to (c != null),
        "isPlaying" to (c?.isPlaying ?: false),
        "index" to (c?.currentMediaItemIndex ?: -1),
        "positionMs" to (c?.currentPosition?.toDouble() ?: 0.0),
        "durationMs" to (c?.duration?.takeIf { it > 0 }?.toDouble() ?: 0.0),
        "queueSize" to (c?.mediaItemCount ?: 0)
      )
    }

    OnDestroy {
      controller?.removeListener(playerListener)
      controller?.release()
      controller = null
    }
  }
}
