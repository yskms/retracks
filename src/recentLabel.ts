/**
 * 「最近追加」の行・詳細に出す日付の文言。純粋な計算は src/recentGroups.ts の labelOfDay()、
 * ここは端末の言語での整形だけ（i18n に触れるので、単体の検証（check:recent-groups）の対象外）。
 */

import type { TFunction } from 'i18next';

import i18next from './i18n';
import { labelOfDay } from './recentGroups';

function formatDate(ms: number, withYear: boolean): string {
  try {
    return new Date(ms).toLocaleDateString(i18next.language, {
      ...(withYear ? { year: 'numeric' as const } : {}),
      month: 'short',
      day: 'numeric',
    });
  } catch {
    // Intl が使えない環境では M/D（年があれば Y/M/D）に倒す
    const d = new Date(ms);
    const md = `${d.getMonth() + 1}/${d.getDate()}`;
    return withYear ? `${d.getFullYear()}/${md}` : md;
  }
}

/**
 * day（YYYY-MM-DD）を「今日」「昨日」、それより前は日付で返す
 * （今年は 10月25日 / Oct 25、今年でなければ 2025年10月25日 / Oct 25, 2025）。
 */
export function dayText(t: TFunction, day: string, now: number = Date.now()): string {
  const label = labelOfDay(day, now);
  if (label.kind === 'today') return t('recent.today');
  if (label.kind === 'yesterday') return t('recent.yesterday');
  return formatDate(label.ms, label.withYear);
}
