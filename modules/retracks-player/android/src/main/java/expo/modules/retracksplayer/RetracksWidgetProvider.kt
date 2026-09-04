package expo.modules.retracksplayer

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi

/**
 * ホーム画面のウィジェット。
 *
 * 表示の更新は PlaybackService から呼ばれる（再生状態や曲が変わったとき）。
 * 操作ボタンはブロードキャストで自分自身に戻し、サービスのプレイヤーを直接動かす。
 *
 * サービスが動いていない（アプリが完全に終了している）場合は操作できないので、
 * その状態ではタップでアプリを開く。ウィジェットから再生を復元するには
 * キューの読み込みが要るため、JS 側の起動が必要になる。
 */
@OptIn(UnstableApi::class)
class RetracksWidgetProvider : AppWidgetProvider() {

  companion object {
    private const val ACTION_PREV = "expo.modules.retracksplayer.WIDGET_PREV"
    private const val ACTION_TOGGLE = "expo.modules.retracksplayer.WIDGET_TOGGLE"
    private const val ACTION_NEXT = "expo.modules.retracksplayer.WIDGET_NEXT"

    /** 表示中のウィジェットをすべて更新する。 */
    fun updateAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(
        ComponentName(context, RetracksWidgetProvider::class.java)
      )
      if (ids.isEmpty()) return
      for (id in ids) {
        manager.updateAppWidget(id, buildViews(context))
      }
    }

    private fun buildViews(context: Context): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.retracks_widget)
      val player = PlaybackService.instance?.currentPlayerSnapshot()

      if (player == null) {
        views.setTextViewText(
          R.id.retracks_widget_title,
          context.getString(R.string.retracks_widget_idle_title)
        )
        views.setTextViewText(
          R.id.retracks_widget_artist,
          context.getString(R.string.retracks_widget_idle_artist)
        )
        views.setImageViewResource(
          R.id.retracks_widget_artwork,
          R.drawable.retracks_artwork_placeholder
        )
        views.setImageViewResource(R.id.retracks_widget_toggle, R.drawable.retracks_ic_play)
      } else {
        views.setTextViewText(R.id.retracks_widget_title, player.title)
        views.setTextViewText(R.id.retracks_widget_artist, player.artist)
        views.setImageViewResource(
          R.id.retracks_widget_toggle,
          if (player.isPlaying) R.drawable.retracks_ic_pause else R.drawable.retracks_ic_play
        )
        if (player.artworkUri != null) {
          views.setImageViewUri(R.id.retracks_widget_artwork, Uri.parse(player.artworkUri))
        } else {
          views.setImageViewResource(
            R.id.retracks_widget_artwork,
            R.drawable.retracks_artwork_placeholder
          )
        }
      }

      views.setOnClickPendingIntent(R.id.retracks_widget_prev, command(context, ACTION_PREV))
      views.setOnClickPendingIntent(R.id.retracks_widget_toggle, command(context, ACTION_TOGGLE))
      views.setOnClickPendingIntent(R.id.retracks_widget_next, command(context, ACTION_NEXT))

      // ジャケットや曲名をタップしたらアプリを開く
      openAppIntent(context)?.let { intent ->
        views.setOnClickPendingIntent(R.id.retracks_widget_artwork, intent)
        views.setOnClickPendingIntent(R.id.retracks_widget_title, intent)
        views.setOnClickPendingIntent(R.id.retracks_widget_artist, intent)
      }

      return views
    }

    private fun command(context: Context, action: String): PendingIntent {
      val intent = Intent(context, RetracksWidgetProvider::class.java).setAction(action)
      return PendingIntent.getBroadcast(
        context,
        action.hashCode(),
        intent,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
      )
    }

    private fun openAppIntent(context: Context): PendingIntent? {
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        ?.apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
        ?: return null
      return PendingIntent.getActivity(
        context,
        0,
        launch,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
      )
    }
  }

  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray
  ) {
    for (id in appWidgetIds) {
      appWidgetManager.updateAppWidget(id, buildViews(context))
    }
  }

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)

    val player = PlaybackService.instance?.playerOrNull()
    when (intent.action) {
      ACTION_PREV -> player?.seekToPreviousMediaItem()
      ACTION_TOGGLE -> if (player?.isPlaying == true) player.pause() else player?.play()
      ACTION_NEXT -> player?.seekToNextMediaItem()
      else -> return
    }

    updateAll(context)
  }
}
