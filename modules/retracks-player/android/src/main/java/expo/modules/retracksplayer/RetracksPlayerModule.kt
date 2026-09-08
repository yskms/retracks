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
/** 終了理由の数値を読める文字列にする。 */
private fun describeExitReason(reason: Int): String = when (reason) {
  android.app.ApplicationExitInfo.REASON_ANR -> "応答なし(ANR)"
  android.app.ApplicationExitInfo.REASON_CRASH -> "クラッシュ"
  android.app.ApplicationExitInfo.REASON_CRASH_NATIVE -> "ネイティブのクラッシュ"
  android.app.ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "依存プロセスの終了"
  android.app.ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "資源の使いすぎ"
  android.app.ApplicationExitInfo.REASON_EXIT_SELF -> "自分で終了"
  android.app.ApplicationExitInfo.REASON_FREEZER -> "凍結(freezer)"
  android.app.ApplicationExitInfo.REASON_LOW_MEMORY -> "メモリ不足"
  android.app.ApplicationExitInfo.REASON_OTHER -> "その他(システム判断)"
  android.app.ApplicationExitInfo.REASON_PACKAGE_STATE_CHANGE -> "アプリの状態変更"
  android.app.ApplicationExitInfo.REASON_PACKAGE_UPDATED -> "アプリの更新"
  android.app.ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "権限の変更"
  android.app.ApplicationExitInfo.REASON_SIGNALED -> "シグナルで終了"
  android.app.ApplicationExitInfo.REASON_USER_REQUESTED -> "ユーザー操作"
  android.app.ApplicationExitInfo.REASON_USER_STOPPED -> "ユーザーが停止"
  else -> "不明($reason)"
}

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


  @Volatile
  private var snapshot: Map<String, Any?> = emptySnapshot()

  private fun emptySnapshot(): Map<String, Any?> = mapOf(
    "connected" to false,
    "isPlaying" to false,
    "index" to -1,
    "positionMs" to 0.0,
    "durationMs" to 0.0,
    "queueSize" to 0,
    "repeatMode" to 2,
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
            // 通知・ロック画面・ウィジェットのジャケットはこれを見る。
            // 入れ忘れると、JS がキューを積み直した時点で絵が消える
            .apply { t.artworkUri?.let { setArtworkUri(Uri.parse(it)) } }
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
      val service = PlaybackService.instance

      // 接続が終わるまで controller は既定値を返す（リピートは OFF 扱いになり、
      // 起動直後の数秒だけ設定が消えたように見える）。サービスは同じプロセスに
      // いるので、その間はプレイヤーを直接読む。どちらも Player なので扱いは同じ。
      val p: Player? = if (c != null && c.isConnected) c else service?.playerOrNull()

      snapshot = if (p == null) {
        emptySnapshot()
      } else {
        mapOf(
          "connected" to true,
          "isPlaying" to p.isPlaying,
          "index" to p.currentMediaItemIndex,
          "positionMs" to p.currentPosition.toDouble(),
          "durationMs" to (p.duration.takeIf { it > 0 }?.toDouble() ?: 0.0),
          "queueSize" to p.mediaItemCount,
          "repeatMode" to p.repeatMode,
          // これはコントローラではなくサービスしか知らない
          "fullPlayback" to (service?.isFullPlayback() ?: false)
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
    AsyncFunction("setQueue") { list: List<TrackInput>, startIndex: Int, queueKey: String, promise: Promise ->
      onMain {
        val c = controller
        if (c == null) {
          promise.reject(CodedException("Player is not prepared"))
          return@onMain
        }
        tracks = list
        // ウィジェットから復元できるよう、ネイティブ側にも控えておく
        appContext.reactContext?.let { QueueStore.saveTracks(it, list, queueKey) }
        val items = buildItems(list, currentSegment)
        c.setMediaItems(items, startIndex.coerceIn(0, maxOf(0, items.size - 1)), 0L)
        c.prepare()
        promise.resolve(items.size)
      }
    }

    /**
     * ネイティブ側に控えてあるキュー。
     *
     * サービスだけが生きている状態から JS が起動したときに、いま鳴っている
     * キューそのものを画面へ復元するために使う。曲の情報も一緒に返すので、
     * ライブラリの走査結果と突き合わせなくても表示できる。
     */
    AsyncFunction("getSavedQueue") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(mapOf("key" to "", "tracks" to emptyList<Any>()))
        return@AsyncFunction
      }
      promise.resolve(
        mapOf(
          "key" to QueueStore.loadKey(context),
          "tracks" to QueueStore.loadTracks(context).map {
            mapOf(
              "id" to it.id,
              "uri" to it.uri,
              "title" to it.title,
              "artist" to it.artist,
              "album" to it.album,
              "durationMs" to it.durationMs.toDouble(),
              "artworkUri" to it.artworkUri
            )
          }
        )
      )
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
      onMain {
        controller?.repeatMode = mode.coerceIn(0, 2)
        // ウィジェットから起こしたときに同じ設定で始まるよう控える
        PlaybackService.instance?.saveState()
      }
    }

    /**
     * アプリのプロセスが前回どう終わったかの履歴。
     *
     * 再生が勝手に止まる、ウィジェットの表示が消える、といった症状は
     * プロセスが落ちていることが多い。Android が理由を記録しているので、
     * 端末を繋がなくても確認できるようにしておく。
     */
    AsyncFunction("getExitReasons") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject(CodedException("React context is not available"))
        return@AsyncFunction
      }
      if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.R) {
        promise.resolve(emptyList<Map<String, Any?>>())
        return@AsyncFunction
      }
      try {
        val manager = context.getSystemService(android.app.ActivityManager::class.java)
        val records = manager.getHistoricalProcessExitReasons(context.packageName, 0, 10)
        promise.resolve(
          records.map { record ->
            mapOf(
              "timestamp" to record.timestamp.toDouble(),
              "reason" to describeExitReason(record.reason),
              "description" to (record.description ?: ""),
              "importance" to record.importance
            )
          }
        )
      } catch (e: Exception) {
        promise.reject(CodedException("Failed to read exit reasons", e))
      }
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

    /** いまの曲を最初から通しで再生する。実処理はサービス側にある。 */
    Function("playCurrentFromStart") {
      onMain { PlaybackService.instance?.playCurrentFromStart() }
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
