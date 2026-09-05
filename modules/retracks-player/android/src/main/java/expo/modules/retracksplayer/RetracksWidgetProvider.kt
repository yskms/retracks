package expo.modules.retracksplayer

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
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
 * アプリが完全に終了していてもサービスを起こして再生できる。キューはネイティブ側にも
 * 控えてあり（QueueStore）、サービスが単独で復元するため JS の起動を待たなくてよい。
 */
@OptIn(UnstableApi::class)
class RetracksWidgetProvider : AppWidgetProvider() {

  companion object {
    private const val ACTION_PREV = "expo.modules.retracksplayer.WIDGET_PREV"
    private const val ACTION_TOGGLE = "expo.modules.retracksplayer.WIDGET_TOGGLE"
    private const val ACTION_NEXT = "expo.modules.retracksplayer.WIDGET_NEXT"
    private const val ACTION_REPLAY = "expo.modules.retracksplayer.WIDGET_REPLAY"

    /** ウィジェットへ渡すジャケットの目標サイズ。大きすぎると転送に失敗する。 */
    private const val ARTWORK_TARGET_PX = 256

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
        // ランチャーは別アプリなので MediaStore の URI を読む権限がない。
        // こちらで画像を読み込んでビットマップとして渡す。
        val artwork = loadArtwork(context, player.artworkUri)
        if (artwork != null) {
          views.setImageViewBitmap(R.id.retracks_widget_artwork, artwork)
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
      views.setOnClickPendingIntent(
        R.id.retracks_widget_replay,
        command(context, ACTION_REPLAY)
      )

      // ジャケットや曲名をタップしたらアプリを開く
      openAppIntent(context)?.let { intent ->
        views.setOnClickPendingIntent(R.id.retracks_widget_artwork, intent)
        views.setOnClickPendingIntent(R.id.retracks_widget_title, intent)
        views.setOnClickPendingIntent(R.id.retracks_widget_artist, intent)
      }

      return views
    }

    /** ジャケットを縮小して読み込む。読めなければ null。 */
    private fun loadArtwork(context: Context, uriString: String?): Bitmap? {
      if (uriString.isNullOrEmpty()) return null

      return runCatching {
        val uri = Uri.parse(uriString)

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use {
          BitmapFactory.decodeStream(it, null, bounds)
        }

        var sample = 1
        while (bounds.outWidth / sample > ARTWORK_TARGET_PX * 2) sample *= 2

        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        val decoded = context.contentResolver.openInputStream(uri)?.use {
          BitmapFactory.decodeStream(it, null, options)
        }
        decoded?.let(::cropToSquare)
      }.getOrNull()
    }

    /**
     * 中央を正方形に切り出す。
     * ジャケットが正方形でない場合に、枠へ収めたとき余白が出るのを避ける。
     */
    private fun cropToSquare(source: Bitmap): Bitmap {
      val side = minOf(source.width, source.height)
      if (source.width == source.height) return source
      val x = (source.width - side) / 2
      val y = (source.height - side) / 2
      return Bitmap.createBitmap(source, x, y, side, side)
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

    // サービスが寝ている（アプリが終了している）場合は起こす。
    // サービス側が保存済みのキューを復元し、そのまま再生する。
    if (player == null || player.mediaItemCount == 0) {
      if (intent.action == ACTION_TOGGLE) {
        val start = Intent(context, PlaybackService::class.java)
          .putExtra(PlaybackService.EXTRA_PLAY_ON_START, true)
        context.startForegroundService(start)
      }
      return
    }

    when (intent.action) {
      ACTION_PREV -> player.seekToPreviousMediaItem()
      ACTION_TOGGLE -> if (player.isPlaying) player.pause() else player.play()
      ACTION_NEXT -> player.seekToNextMediaItem()
      ACTION_REPLAY -> PlaybackService.instance?.playCurrentFromStart()
      else -> return
    }

    updateAll(context)
  }
}
