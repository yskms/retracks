import { useCallback, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';

import { RetracksPlayer } from '../modules/retracks-player/src';
import type { Track } from './library';

/**
 * 端末からの削除に対応している環境か。削除ボタンを出すかどうかの判定に使う。
 *
 * Android 10 (API 29) 以降のみ。iOS はミュージックライブラリから曲を削除する
 * 公開 API が無く、Android 9 以前は WRITE_EXTERNAL_STORAGE の実行時許可が
 * 取れず削除できない可能性が高いため非対応（→ RetracksPlayerModule.kt の
 * deleteTracksAsync）。3画面で同じ判定を共有する。
 */
export const CAN_DELETE_TRACKS =
  Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version >= 29;

/**
 * 選択した曲を端末から削除する確認フロー（Android 10 以降でのみ呼ばれる想定。
 * → app/index.tsx・app/artist/[id].tsx・app/album/[id].tsx で共通利用）。
 *
 * 確認ダイアログ・ネイティブ呼び出し・再走査の要否をここへ集約する。
 * 3画面にそれぞれ書いていたときは、挙動を直すたびに3か所を同期する必要が
 * あり危険だった（2026-10、レビュー指摘）。
 */
export function useDeleteTracks(rescan: () => Promise<void>) {
  const { t } = useTranslation();
  const [deleting, setDeleting] = useState(false);

  /**
   * onDeleted は1件でも削除できたときだけ呼ばれる（例: 選択解除）。
   * ネイティブ側は「何件消せたか」を返す。OS の確認ダイアログをユーザーが
   * 一部・全部拒否しても、消せた分だけで反映する（全部拒否＝0件なら選択を
   * そのまま残し、やり直せるようにする）。
   */
  const confirmAndDelete = useCallback(
    (picked: Track[], onDeleted: () => void) => {
      if (picked.length === 0 || deleting) return;

      Alert.alert(
        t('library.deleteConfirmTitle'),
        t('library.deleteConfirmMessage', { count: picked.length }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: async () => {
              setDeleting(true);
              try {
                const deletedCount = await RetracksPlayer.deleteTracksAsync(
                  picked.map((track) => track.id)
                );
                if (deletedCount > 0) {
                  onDeleted();
                  await rescan();
                }
              } catch {
                Alert.alert(t('library.deleteFailedTitle'), t('library.deleteFailedMessage'));
              } finally {
                setDeleting(false);
              }
            },
          },
        ]
      );
    },
    [deleting, rescan, t]
  );

  return { deleting, confirmAndDelete };
}
