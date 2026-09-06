package expo.modules.retracksplayer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
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

    /** Media3 の既定の通知ID。仮の通知もこれに合わせ、後から差し替わるようにする。 */
    private const val MEDIA_NOTIFICATION_ID = 1001

    private const val CHANNEL_ID = "retracks_playback"

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
      restoreClippedItem()
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

  /** 「この曲を最初から」で区間を外した曲の位置と、戻すための元の項目。 */
  private var fullPlaybackIndex: Int? = null
  private var clippedItemBeforeFullPlayback: MediaItem? = null

  fun isFullPlayback(): Boolean {
    val player = mediaSession?.player ?: return false
    return fullPlaybackIndex != null && fullPlaybackIndex == player.currentMediaItemIndex
  }

  /**
   * いま鳴っている曲を、区間を外して最初から通しで再生する。
   *
   * 区間は MediaItem に焼き込まれているので、その項目から区間指定だけを外した
   * ものへ差し替える。元の項目は控えておき、次の曲へ移ったら戻す。
   *
   * ウィジェットからも呼べるよう、曲の一覧を必要としない作りにしてある
   * （いまの MediaItem を組み替えるだけで済ませる）。
   */
  fun playCurrentFromStart() {
    val player = mediaSession?.player ?: return
    val item = player.currentMediaItem ?: return
    val index = player.currentMediaItemIndex
    if (index < 0) return

    clippedItemBeforeFullPlayback = item
    fullPlaybackIndex = index

    player.replaceMediaItem(
      index,
      item.buildUpon()
        .setClippingConfiguration(MediaItem.ClippingConfiguration.UNSET)
        .build()
    )
    player.seekTo(index, 0L)
    player.play()
  }

  /** 区間を外した曲から離れたら元に戻す。 */
  private fun restoreClippedItem() {
    val index = fullPlaybackIndex ?: return
    val player = mediaSession?.player ?: return
    if (player.currentMediaItemIndex == index) return

    val original = clippedItemBeforeFullPlayback
    fullPlaybackIndex = null
    clippedItemBeforeFullPlayback = null

    if (original != null && index < player.mediaItemCount) {
      player.replaceMediaItem(index, original)
    }
  }

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
    if (intent?.getBooleanExtra(EXTRA_PLAY_ON_START, false) == true) {
      // startForegroundService で起こされた場合、数秒以内に startForeground を
      // 呼ばないとシステムがアプリを落とす。Media3 が通知を出すのを待っていると
      // 間に合わず、復元する曲が無い場合は必ず落ちていた。
      // まず仮の通知で前面に入り、Media3 の通知が出たら差し替わる。
      startForegroundPlaceholder()

      val player = mediaSession?.player
      if (player != null && player.mediaItemCount > 0) {
        player.play()
      } else {
        // 復元できるものが無いので前面から降りて終わる
        stopSelf()
      }
    }
    return super.onStartCommand(intent, flags, startId)
  }

  /** 期限内に前面へ入るための最小限の通知。 */
  private fun startForegroundPlaceholder() {
    val manager = getSystemService(NotificationManager::class.java) ?: return

    if (manager.getNotificationChannel(CHANNEL_ID) == null) {
      manager.createNotificationChannel(
        NotificationChannel(
          CHANNEL_ID,
          getString(R.string.retracks_widget_label),
          NotificationManager.IMPORTANCE_LOW
        )
      )
    }

    val notification = Notification.Builder(this, CHANNEL_ID)
      .setContentTitle(getString(R.string.retracks_widget_label))
      .setSmallIcon(R.drawable.retracks_ic_play)
      .setOngoing(true)
      .build()

    startForeground(
      MEDIA_NOTIFICATION_ID,
      notification,
      ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
    )
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
