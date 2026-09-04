package expo.modules.retracksplayer

import android.app.PendingIntent
import android.content.Intent
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.MediaItem
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

  /** ウィジェットの表示を再生状態に追従させる。 */
  private val widgetListener = object : Player.Listener {
    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
      RetracksWidgetProvider.updateAll(this@PlaybackService)
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
      RetracksWidgetProvider.updateAll(this@PlaybackService)
    }
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
    RetracksWidgetProvider.updateAll(this)
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
