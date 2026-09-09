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
if (placeholderMismatches > 0) {
  failed = true;
}

if (failed) {
  console.error(`\nFAILED (ja: ${jaKeys.length} keys, en: ${enKeys.length} keys)`);
  process.exit(1);
}

console.log(`OK (ja: ${jaKeys.length} keys, en: ${enKeys.length} keys, no missing keys or placeholder mismatches)`);
