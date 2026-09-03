package expo.modules.retracksplayer

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
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
    private const val TAG = "RetracksService"

    /** Media3 の DefaultMediaNotificationProvider が使う既定の通知ID。 */
    private const val MEDIA_NOTIFICATION_ID = 1001

    /** モジュール側から SegmentController を触るための参照。同一プロセス内でのみ使う。 */
    @Volatile
    var instance: PlaybackService? = null
      private set
  }

  private var mediaSession: MediaSession? = null
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
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

  /**
   * 通知が消えていたら出し直す。
   *
   * 通知をスワイプで消すと、Media3 はプレイヤーの状態が変わるまで出し直さないため、
   * 再生は続いているのに通知だけ無い状態になる。
   *
   * 実際に消えているかを NotificationManager で確認してから出し直す。
   * 毎回無条件に呼ぶと通知がちらつくため。
   */
  fun refreshNotification() {
    val session = mediaSession ?: return
    if (!session.player.playWhenReady) return

    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
    val present = manager
      ?.activeNotifications
      ?.any { it.id == MEDIA_NOTIFICATION_ID } ?: false

    if (present) return

    Log.d(TAG, "通知が消えていたので出し直す")
    onUpdateNotification(session, /* startInForegroundRequired = */ true)
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // タスク一覧からスワイプで消されたとき、再生していなければサービスを畳む
    val player = mediaSession?.player
    if (player == null || !player.playWhenReady || player.mediaItemCount == 0) {
      stopSelf()
    }
  }

  override fun onDestroy() {
    instance = null
    segmentController?.detach()
    segmentController = null
    mediaSession?.run {
      player.release()
      release()
    }
    mediaSession = null
    super.onDestroy()
  }
}
