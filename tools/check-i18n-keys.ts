/**
 * ja / en の翻訳キーが一致しているかを確認する。
 *
 * ja が正本（i18next.d.ts の型もここから作る）。en 側のキー抜けは
 * fallbackLng: ['en', 'ja'] で ja に着地するので実害はないが、
 * 抜けたまま気づかず放置されるのを防ぐためにここでチェックする。
 *
 * 実行: npx tsx tools/check-i18n-keys.ts
 */
import ja from '../src/i18n/locales/ja';
import en from '../src/i18n/locales/en';

type Flat = Record<string, string>;

function flatten(obj: object, prefix = ''): Flat {
  const out: Flat = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') {
      Object.assign(out, flatten(value, path));
    } else {
      out[path] = String(value);
    }
  }
  return out;
}

function placeholders(s: string): string[] {
  return [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();
}

/** en だけが持つキーは、i18next の複数形サフィックス（_one など）の
 * うち ja では単一の _other に畳まれているものだけを許す。
 * ja 側にその _other が実在するかを見る（en 自身を見ても en の内部整合性
 * しか確認できず、ja が丸ごと欠けているケースを見逃す）。 */
function isPluralOnlyKey(key: string): boolean {
  return /_(zero|one|two|few|many)$/.test(key) && `${key.replace(/_(zero|one|two|few|many)$/, '_other')}` in jaFlat;
}

const jaFlat = flatten(ja);
const enFlat = flatten(en);
const jaKeys = Object.keys(jaFlat);
const enKeys = Object.keys(enFlat);

const missingInEn = jaKeys.filter((k) => !(k in enFlat));
const missingInJa = enKeys.filter((k) => !(k in jaFlat) && !isPluralOnlyKey(k));

/**
 * ja が _other だけ持ち、en が同じキーの _one も持っている場合、ja にも
 * _one を足す必要がある。無いと、fallbackLng（['en', 'ja']）が
 * count===1 のときだけ en の _one を拾ってしまい、日本語画面に
 * "1 song" のような英語が混ざる（2026-09-11 に実際に発生）。
 * 日本語は単数/複数で言い方が変わらないので、_one は _other と
 * 同じ文言でよい。
 */
const missingJaOneVariant = enKeys
  .filter((k) => k.endsWith('_one'))
  .map((k) => k.replace(/_one$/, ''))
  .filter((base) => `${base}_other` in jaFlat && !(`${base}_one` in jaFlat));

let placeholderMismatches = 0;
for (const key of jaKeys) {
  if (!(key in enFlat)) continue;
  const jp = placeholders(jaFlat[key]);
  const ep = placeholders(enFlat[key]);
  if (JSON.stringify(jp) !== JSON.stringify(ep)) {
    console.error(`placeholder mismatch: ${key} ja=${jp} en=${ep}`);
    placeholderMismatches++;
  }
}

let failed = false;
if (missingInEn.length > 0) {
  console.error('missing in en:', missingInEn);
  failed = true;
}
if (missingInJa.length > 0) {
  console.error('unexpected extra keys in en (not a plural variant of a ja key):', missingInJa);
  failed = true;
}
if (missingJaOneVariant.length > 0) {
  console.error(
    'ja has _other but no _one for keys where en has both (count===1 would leak English):',
    missingJaOneVariant.map((base) => `${base}_one`)
  );
  failed = true;
}
if (placeholderMismatches > 0) {
  failed = true;
}

if (failed) {
  console.error(`\nFAILED (ja: ${jaKeys.length} keys, en: ${enKeys.length} keys)`);
  process.exit(1);
}

console.log(`OK (ja: ${jaKeys.length} keys, en: ${enKeys.length} keys, no missing keys or placeholder mismatches)`);
