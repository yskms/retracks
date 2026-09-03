import { useCallback, useEffect, useState } from 'react';
import { BackHandler } from 'react-native';

export type Selection<K extends string> = { kind: K; ids: string[] } | null;

/**
 * 一覧の複数選択モード。
 *
 * 種類（曲・アルバム・アーティスト）をまたいだ選択はできない。別の種類を選ぶと
 * そちらへ切り替わる。まとめて再生するときの扱いが単純になるため。
 *
 * 選択中は戻る操作を選択解除に割り当てる。これをしないと画面を戻ろうとして
 * しまい、戻り先の無い画面ではアプリが落ちる。
 */
export function useSelection<K extends string>() {
  const [selection, setSelection] = useState<Selection<K>>(null);

  const clear = useCallback(() => setSelection(null), []);

  const toggle = useCallback((kind: K, id: string) => {
    setSelection((prev) => {
      if (!prev || prev.kind !== kind) return { kind, ids: [id] };
      const ids = prev.ids.includes(id)
        ? prev.ids.filter((x) => x !== id)
        : [...prev.ids, id];
      return ids.length === 0 ? null : { kind, ids };
    });
  }, []);

  const isSelected = useCallback(
    (kind: K, id: string) => selection?.kind === kind && selection.ids.includes(id),
    [selection]
  );

  useEffect(() => {
    if (!selection) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      clear();
      return true;
    });
    return () => subscription.remove();
  }, [selection, clear]);

  return {
    selection,
    active: selection != null,
    toggle,
    clear,
    isSelected,
  };
}
