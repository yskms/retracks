package expo.modules.retracksplayer

import android.app.PendingIntent
import android.content.Intent
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/**
 * 再生を担うフォアグラウンドサービス。
 *
 * MediaSessionService を継承することで、通知・ロック画面・イヤホンのメディアキー・
 * Android Auto からの操作を Media3 が面倒を見てくれる。
 *
 * expo-audio を使わない理由がここにある。expo-audio は MediaSession 接続時に
 * COMMAND_SEEK_TO_NEXT_MEDIA_ITEM を明示的に remove しているため、通知のボタンも
 * イヤホンの2タップも「次の曲」が効かない（docs/requirements.md 13.2）。
 * ここでは既定のコマンドをそのまま使うので、キューさえ入っていれば両方とも効く。
 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {

  companion object {
    /** ウィジェットから起こされたときに、復元後すぐ再生するかどうか。 */
    const val EXTRA_PLAY_ON_START = "expo.modules.retracksplayer.PLAY_ON_START"

    /** モジュール側から SegmentController を触るための参照。同一プロセス内でのみ使う。 */
    @Volatile
    var instance: PlaybackService? = null
      private set
  }

  private var mediaSession: MediaSession? = null

  /** ウィジェットに出す最低限の情報。 */
  data class Snapshot(
    val title: String,
    val artist: String,
    val artworkUri: String?,
    val isPlaying: Boolean
  )

  /** ウィジェットの表示を追従させ、あわせて再生位置を控える。 */
  private val widgetListener = object : Player.Listener {
    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
      RetracksWidgetProvider.updateAll(this@PlaybackService)
      saveState()
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
      RetracksWidgetProvider.updateAll(this@PlaybackService)
      if (!isPlaying) saveState()
    }
  }

  /** 次回サービス単体で復元できるよう、いまの位置を控える。 */
  fun saveState() {
    val player = mediaSession?.player ?: return
    QueueStore.saveState(
      this,
      player.currentMediaItemIndex,
      player.currentPosition,
      segmentController?.segment
    )
  }

  /**
   * 保存しておいたキューを復元する。
   *
   * ウィジェットから起こされた場合は JS が動いていないため、ここで組み立てないと
   * 何も再生できない。JS が後から接続してキューを入れ直せば単に上書きされる。
   */
  private fun restoreSavedQueue(player: Player) {
    val tracks = QueueStore.loadTracks(this)
    if (tracks.isEmpty()) return

    val state = QueueStore.loadState(this)
    val segment = state?.segment
    segmentController?.segment = segment

    val items = tracks.map { track ->
      val builder = MediaItem.Builder()
        .setMediaId(track.id)
        .setUri(track.uri)
        .setMediaMetadata(
          MediaMetadata.Builder()
            .setTitle(track.title)
            .setArtist(track.artist)
            .setAlbumTitle(track.album)
            .apply {
              track.artworkUri?.let { setArtworkUri(android.net.Uri.parse(it)) }
            }
            .build()
        )

      if (segment != null && track.durationMs > 0) {
        val resolved = SegmentController.resolve(track.durationMs, segment)
        if (resolved.length > 0) {
          builder.setClippingConfiguration(
            MediaItem.ClippingConfiguration.Builder()
              .setStartPositionMs(resolved.start)
              .setEndPositionMs(resolved.end)
              .build()
          )
        }
      }
      builder.build()
    }

    val index = (state?.index ?: 0).coerceIn(0, items.size - 1)
    player.setMediaItems(items, index, state?.positionMs ?: 0L)
    player.repeatMode = Player.REPEAT_MODE_ALL
    player.prepare()
  }

  fun playerOrNull(): Player? = mediaSession?.player

  fun currentPlayerSnapshot(): Snapshot? {
    val player = mediaSession?.player ?: return null
    val metadata = player.currentMediaItem?.mediaMetadata ?: return null
    return Snapshot(
      title = metadata.title?.toString() ?: "",
      artist = metadata.artist?.toString() ?: "",
      artworkUri = metadata.artworkUri?.toString(),
      isPlaying = player.isPlaying
    )
  }
  var segmentController: SegmentController? = null
    private set

  override fun onCreate() {
    super.onCreate()

    val player = ExoPlayer.Builder(this)
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(C.USAGE_MEDIA)
          .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
          .build(),
        /* handleAudioFocus = */ true
      )
      // イヤホンが抜かれたら一時停止する（一般的なプレイヤーの挙動）
      .setHandleAudioBecomingNoisy(true)
      .build()

    segmentController = SegmentController(player).apply { attach() }
    player.addListener(widgetListener)

    // 通知やロック画面をタップしたときにアプリを開くための遷移先。
    // これを渡さないとタップしても何も起きない。
    val sessionActivity = packageManager
      .getLaunchIntentForPackage(packageName)
      ?.apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
      ?.let { intent ->
        PendingIntent.getActivity(
          this,
          0,
          intent,
          PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
      }

    mediaSession = MediaSession.Builder(this, player)
      .apply { sessionActivity?.let { setSessionActivity(it) } }
      .build()

    instance = this
    restoreSavedQueue(player)
    RetracksWidgetProvider.updateAll(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // ウィジェットから起こされた場合は、復元済みのキューをそのまま再生する
    if (intent?.getBooleanExtra(EXTRA_PLAY_ON_START, false) == true) {
      mediaSession?.player?.play()
    }
    return super.onStartCommand(intent, flags, startId)
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

  override fun onTaskRemoved(rootIntent: Intent?) {
    // タスク一覧からスワイプで消されたとき、再生していなければサービスを畳む
    val player = mediaSession?.player
    if (player == null || !player.playWhenReady || player.mediaItemCount == 0) {
      stopSelf()
    }
  }

  override fun onDestroy() {
    saveState()
    instance = null
    mediaSession?.player?.removeListener(widgetListener)
    segmentController?.detach()
    segmentController = null
    mediaSession?.run {
      player.release()
      release()
    }
    mediaSession = null
    RetracksWidgetProvider.updateAll(this)
    super.onDestroy()
  }
}
