import { File } from 'expo-file-system';
import { widgetsDirectory } from 'expo-widgets';
import i18next from 'i18next';

import type { Track } from './library';
import { RetracksPlayer } from '../modules/retracks-player/src';
import NowPlayingWidget from '../widgets/NowPlayingWidget';

/**
 * iOSホーム画面ウィジェットへのデータ書き込み。
 *
 * ウィジェット（widgets/NowPlayingWidget.tsx）は独立したランタイムで動く
 * 表示専用コンポーネントで、propsでしか状態を受け取れない。曲が変わる
 * たびにここでアートワークをファイルへ書き出し、updateSnapshot()で
 * 曲名・アーティスト名・アートワークのパスを渡す。
 *
 * Android版ウィジェット（RetracksWidgetProvider.kt）で「切り替わるたびに
 * デコードし直すとネイティブメモリを消費する」と分かった教訓（→
 * docs/requirements.md 13.5）を踏まえ、同じ曲では書き込みをスキップする。
 */

const ARTWORK_SIZE = 192;
const ARTWORK_FILE_NAME = 'now-playing-artwork.jpg';

let lastArtworkTrackId: string | null = null;

async function writeArtwork(track: Track): Promise<string | undefined> {
  if (track.id === lastArtworkTrackId) {
    // 曲が変わっていなければ書き込み済みのファイルをそのまま使う
    return new File(widgetsDirectory, ARTWORK_FILE_NAME).uri;
  }

  try {
    const dataUri = await RetracksPlayer.getArtworkDataUri(track.id, ARTWORK_SIZE);
    if (!dataUri) {
      lastArtworkTrackId = null;
      return undefined;
    }
    const base64 = dataUri.slice(dataUri.indexOf(',') + 1);
    const file = new File(widgetsDirectory, ARTWORK_FILE_NAME);
    file.create({ overwrite: true });
    file.write(base64, { encoding: 'base64' });
    lastArtworkTrackId = track.id;
    return file.uri;
  } catch {
    // アートワーク取得に失敗しても曲名・アーティスト名だけは表示する
    lastArtworkTrackId = null;
    return undefined;
  }
}

/** 再生中の曲が変わったとき（`onTrackChange`）に呼ぶ。 */
export async function syncNowPlayingWidget(track: Track | null): Promise<void> {
  if (!track) {
    lastArtworkTrackId = null;
    NowPlayingWidget.updateSnapshot({
      title: i18next.t('player.noTrack'),
      artist: i18next.t('widget.idleArtist'),
      artworkPath: undefined,
    });
    return;
  }

  const artworkPath = await writeArtwork(track);
  NowPlayingWidget.updateSnapshot({
    title: track.title || i18next.t('player.noTrack'),
    artist: track.artist,
    artworkPath,
  });
}
