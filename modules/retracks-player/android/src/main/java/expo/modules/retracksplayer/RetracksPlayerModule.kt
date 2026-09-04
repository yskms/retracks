package expo.modules.retracksplayer

import android.content.ComponentName
import android.net.Uri
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
  /** 音楽ファイルに埋め込まれたジャケットの URI。通知とロック画面に出す。 */
  @Field var artworkUri: String? = null
}

class SegmentInput : Record {
  @Field var startMs: Double = 0.0
  @Field var lengthMs: Double = 0.0
  /** フェードアウトの長さ */
  @Field var fadeMs: Double = 0.0
  /** フェードインの長さ */
  @Field var fadeInMs: Double = 0.0
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

  /** 区間設定を変えたときに MediaItem を組み直せるよう、投入した曲を保持しておく。 */
  private var tracks: List<TrackInput> = emptyList()
  private var currentSegment: Segment? = null

  /**
   * 「この曲だけ最後まで」で区間を外した曲の位置。
   * その曲を離れたら元の区間に戻す。
   */
  private var fullPlaybackIndex: Int? = null

  @Volatile
  private var snapshot: Map<String, Any?> = emptySnapshot()

  private fun emptySnapshot(): Map<String, Any?> = mapOf(
    "connected" to false,
    "isPlaying" to false,
    "index" to -1,
    "positionMs" to 0.0,
    "durationMs" to 0.0,
    "queueSize" to 0,
    "fullPlayback" to false
  )

  /**
   * 区間の切り出しは ClippingConfiguration で ExoPlayer 自身に行わせる。
   * ポーリングで終了を検出するより精度が高く、開始位置へのシークも不要になる。
   */
  private fun buildItems(list: List<TrackInput>, seg: Segment?): List<MediaItem> =
    list.map { t ->
      val builder = MediaItem.Builder()
        .setMediaId(t.id)
        .setUri(t.uri)
        .setMediaMetadata(
          MediaMetadata.Builder()
            .setTitle(t.title)
            .setArtist(t.artist)
            .setAlbumTitle(t.album)
            .build()
        )
      val durationMs = t.durationMs.toLong()
      if (seg != null && durationMs > 0) {
        val r = SegmentController.resolve(durationMs, seg)
        if (r.length > 0) {
          builder.setClippingConfiguration(
            MediaItem.ClippingConfiguration.Builder()
              .setStartPositionMs(r.start)
              .setEndPositionMs(r.end)
              .build()
          )
        }
      }
      builder.build()
    }

  /**
   * 区間設定の変更を「次の曲から」反映する。
   *
   * 区間は MediaItem に焼き込まれているため作り直しが必要だが、再生中の曲を
   * 差し替えるとその曲が区間の先頭から鳴り直してしまう。設定を1つ変えるたびに
   * 曲が鳴り直すのは体験として悪いので、現在の曲は触らず以降だけ差し替える。
   */
  private fun applySegmentFromNextItem() {
    val c = controller ?: return
    if (tracks.isEmpty()) return

    val count = minOf(tracks.size, c.mediaItemCount)
    val from = c.currentMediaItemIndex + 1
    if (from >= count) return

    c.replaceMediaItems(from, count, buildItems(tracks.subList(from, count), currentSegment))
  }

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
          "queueSize" to c.mediaItemCount,
          "fullPlayback" to (fullPlaybackIndex != null &&
            fullPlaybackIndex == c.currentMediaItemIndex)
        )
      }
      if (polling) mainHandler.postDelayed(this, SNAPSHOT_INTERVAL_MS)
    }
  }

  /** 区間を外した曲から離れたら、元の区間に戻す。 */
  private fun restoreFullPlaybackItem() {
    val index = fullPlaybackIndex ?: return
    val c = controller ?: return
    if (c.currentMediaItemIndex == index) return

    fullPlaybackIndex = null
    if (index < 0 || index >= tracks.size || index >= c.mediaItemCount) return
    c.replaceMediaItem(index, buildItems(listOf(tracks[index]), currentSegment).first())
  }

  private val playerListener = object : Player.Listener {
    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
      restoreFullPlaybackItem()
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

              // アプリのプロセスだけ作り直された場合、サービスは生きたままで
              // 区間設定を保持している。それを引き継がないと「設定が変わった」と
              // 誤判定してキューを組み直し、再生中の曲が先頭に戻ってしまう。
              currentSegment = PlaybackService.instance?.segmentController?.segment

              // 区間の切り出しを JS 側へ通知する（計測用）
              PlaybackService.instance?.segmentController?.onCut = { expectedMs, elapsedMs ->
                sendEvent(
                  "onSegmentCut",
                  mapOf(
                    "expectedMs" to expectedMs.toDouble(),
                    "elapsedMs" to elapsedMs.toDouble(),
                    "driftMs" to (elapsedMs - expectedMs).toDouble()
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
    AsyncFunction("setQueue") { list: List<TrackInput>, startIndex: Int, promise: Promise ->
      onMain {
        val c = controller
        if (c == null) {
          promise.reject(CodedException("Player is not prepared"))
          return@onMain
        }
        tracks = list
        // ウィジェットから復元できるよう、ネイティブ側にも控えておく
        appContext.reactContext?.let { QueueStore.saveTracks(it, list) }
        val items = buildItems(list, currentSegment)
        c.setMediaItems(items, startIndex.coerceIn(0, maxOf(0, items.size - 1)), 0L)
        c.prepare()
        promise.resolve(items.size)
      }
    }

    /** RUSH の区間設定。null を渡すと RUSH OFF（フル再生）。 */
    Function("setSegment") { segment: SegmentInput? ->
      onMain {
        val next = segment?.let {
          Segment(
            startMs = it.startMs.toLong(),
            lengthMs = it.lengthMs.toLong(),
            fadeMs = it.fadeMs.toLong(),
            fadeInMs = it.fadeInMs.toLong()
          )
        }

        // 値が同じなら何もしない。組み直しは再生中の曲を先頭から鳴らし直すため、
        // 設定が実際に変わったときだけ行う。
        if (next == currentSegment) return@onMain

        currentSegment = next
        // フェードの長さは今の曲にも即座に効かせてよい（区間の境界は変わらない）
        PlaybackService.instance?.segmentController?.segment = next
        applySegmentFromNextItem()
        PlaybackService.instance?.saveState()
      }
    }

    /** リピート。0=OFF, 1=1曲, 2=全曲（Player.REPEAT_MODE_* と同じ） */
    Function("setRepeatMode") { mode: Int ->
      onMain { controller?.repeatMode = mode.coerceIn(0, 2) }
    }

    /**
     * アルバムごとのリリース年。
     *
     * expo-music-library は MediaStore の YEAR 系カラムを一切公開していないため、
     * ここで直接問い合わせる。音楽ファイルに埋め込まれた年をAndroidが取り込んだもの。
     */
    AsyncFunction("getAlbumYears") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject(CodedException("React context is not available"))
        return@AsyncFunction
      }
      try {
        val result = mutableMapOf<String, Int>()
        val projection = arrayOf(
          android.provider.MediaStore.Audio.Albums._ID,
          android.provider.MediaStore.Audio.Albums.FIRST_YEAR,
          android.provider.MediaStore.Audio.Albums.LAST_YEAR
        )
        context.contentResolver.query(
          android.provider.MediaStore.Audio.Albums.EXTERNAL_CONTENT_URI,
          projection,
          null,
          null,
          null
        )?.use { cursor ->
          val idIndex = cursor.getColumnIndexOrThrow(android.provider.MediaStore.Audio.Albums._ID)
          val firstIndex = cursor.getColumnIndex(android.provider.MediaStore.Audio.Albums.FIRST_YEAR)
          val lastIndex = cursor.getColumnIndex(android.provider.MediaStore.Audio.Albums.LAST_YEAR)
          while (cursor.moveToNext()) {
            val id = cursor.getLong(idIndex).toString()
            val first = if (firstIndex >= 0) cursor.getInt(firstIndex) else 0
            val last = if (lastIndex >= 0) cursor.getInt(lastIndex) else 0
            // 収録年が幅を持つ場合は新しい方を採る
            val year = maxOf(first, last)
            if (year > 0) result[id] = year
          }
        }
        promise.resolve(result)
      } catch (e: Exception) {
        promise.reject(CodedException("Failed to read album years", e))
      }
    }

    /**
     * いま鳴っている曲だけ、区間を外して最後まで再生する。
     *
     * 区間は MediaItem に焼き込まれているため、その曲だけ区間なしの項目へ差し替え、
     * 同じ音の位置へシークし直す。次の曲へ移ったら元に戻す。
     */
    Function("playCurrentToEnd") {
      onMain {
        val c = controller ?: return@onMain
        val segment = currentSegment ?: return@onMain
        val index = c.currentMediaItemIndex
        if (index < 0 || index >= tracks.size) return@onMain

        val track = tracks[index]
        val resolved = SegmentController.resolve(track.durationMs.toLong(), segment)
        // 区間内の位置を、曲全体での位置に読み替える
        val positionInTrack = resolved.start + c.currentPosition

        c.replaceMediaItem(index, buildItems(listOf(track), null).first())
        c.seekTo(index, positionInTrack)
        fullPlaybackIndex = index
      }
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
