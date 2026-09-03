/** 配色。Pulsar のような暗い画面を基調にする。 */
export const colors = {
  background: '#121216',
  surface: '#1c1c22',
  surfaceHigh: '#26262e',
  border: '#2e2e38',
  text: '#f2f2f5',
  textDim: '#9a9aa8',
  accent: '#e8912a',
  accentDim: '#7a4d16',
} as const;

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
