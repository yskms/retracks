package expo.modules.retracksplayer

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * 再生キューをネイティブ側に保存する。
 *
 * JS 側にも順列やカーソルの保存があるが、そちらはアプリのプロセスが動いていないと
 * 読めない。ウィジェットから再生を再開するときはサービスだけが起きている状態なので、
 * サービス単体で復元できる控えをここに持つ。
 *
 * 曲一覧は大きい（1000曲で数百KB）ので、頻繁に書き換わる再生位置とはファイルを分ける。
 */
object QueueStore {

  private const val TAG = "RetracksQueueStore"
  private const val TRACKS_FILE = "retracks-queue-tracks.json"
  private const val STATE_FILE = "retracks-queue-state.json"

  /**
   * どのキュー（全曲／アーティスト／選択）を鳴らしているかの識別子。
   *
   * JS 側は1巡の順列をこの識別子ごとに保存している。サービスだけが生きている
   * 状態から JS が起動したとき、これが無いと「何のキューを鳴らしているか」が
   * 分からず、別のキューの順列に番号だけを当てはめてしまう。
   */
  private const val KEY_FILE = "retracks-queue-key.txt"

  data class StoredTrack(
    val id: String,
    val uri: String,
    val title: String,
    val artist: String,
    val album: String?,
    val durationMs: Long,
    val artworkUri: String?
  )

  data class StoredState(
    val index: Int,
    val positionMs: Long,
    val segment: Segment?
  )

  fun saveTracks(context: Context, tracks: List<TrackInput>, queueKey: String) {
    runCatching {
      File(context.filesDir, KEY_FILE).writeText(queueKey)
      val array = JSONArray()
      for (track in tracks) {
        array.put(
          JSONObject().apply {
            put("id", track.id)
            put("uri", track.uri)
            put("title", track.title)
            put("artist", track.artist)
            put("album", track.album ?: JSONObject.NULL)
            put("durationMs", track.durationMs.toLong())
            put("artworkUri", track.artworkUri ?: JSONObject.NULL)
          }
        )
      }
      File(context.filesDir, TRACKS_FILE).writeText(array.toString())
    }.onFailure { Log.e(TAG, "キューの保存に失敗: $it") }
  }

  fun loadTracks(context: Context): List<StoredTrack> {
    return runCatching {
      val file = File(context.filesDir, TRACKS_FILE)
      if (!file.exists()) return emptyList()

      val array = JSONArray(file.readText())
      buildList {
        for (i in 0 until array.length()) {
          val item = array.getJSONObject(i)
          add(
            StoredTrack(
              id = item.optString("id"),
              uri = item.optString("uri"),
              title = item.optString("title"),
              artist = item.optString("artist"),
              album = item.optString("album").takeIf { it.isNotEmpty() && it != "null" },
              durationMs = item.optLong("durationMs"),
              artworkUri = item.optString("artworkUri")
                .takeIf { it.isNotEmpty() && it != "null" }
            )
          )
        }
      }
    }.getOrElse {
      Log.e(TAG, "キューの読み込みに失敗: $it")
      emptyList()
    }
  }

  /** 保存してあるキューの識別子。無ければ空文字。 */
  fun loadKey(context: Context): String {
    return runCatching {
      val file = File(context.filesDir, KEY_FILE)
      if (file.exists()) file.readText() else ""
    }.getOrDefault("")
  }

  fun saveState(context: Context, index: Int, positionMs: Long, segment: Segment?) {
    runCatching {
      val json = JSONObject().apply {
        put("index", index)
        put("positionMs", positionMs)
        if (segment != null) {
          put(
            "segment",
            JSONObject().apply {
              put("startMs", segment.startMs)
              put("lengthMs", segment.lengthMs)
              put("fadeMs", segment.fadeMs)
              put("fadeInMs", segment.fadeInMs)
            }
          )
        }
      }
      File(context.filesDir, STATE_FILE).writeText(json.toString())
    }.onFailure { Log.e(TAG, "再生位置の保存に失敗: $it") }
  }

  fun loadState(context: Context): StoredState? {
    return runCatching {
      val file = File(context.filesDir, STATE_FILE)
      if (!file.exists()) return null

      val json = JSONObject(file.readText())
      val segmentJson = json.optJSONObject("segment")
      StoredState(
        index = json.optInt("index", 0),
        positionMs = json.optLong("positionMs", 0L),
        segment = segmentJson?.let {
          Segment(
            startMs = it.optLong("startMs"),
            lengthMs = it.optLong("lengthMs"),
            fadeMs = it.optLong("fadeMs"),
            fadeInMs = it.optLong("fadeInMs")
          )
        }
      )
    }.getOrElse {
      Log.e(TAG, "再生位置の読み込みに失敗: $it")
      null
    }
  }
}
