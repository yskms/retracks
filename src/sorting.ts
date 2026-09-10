/**
 * 一覧の並べ替え（要件 10.6）。
 *
 * 先頭の冠詞を無視するかどうかは、英語圏の音楽ライブラリでも流儀が割れている。
 * "The Beatles" を B として並べるのはほぼ共通認識だが、"A"/"An" まで無視するかは
 * アプリによって違う（Pulsar はまとめて無視する）。どちらも独立したON/OFFにして、
 * 利用者が好きな方に寄せられるようにする。
 *
 * 日本語のタイトルは読み仮名ではなくコードポイント順になる（「東京」が「と」では
 * なく「東」の位置に並ぶ）。以前の実装（ネイティブの sortBy: 'title'、SQLiteの
 * BINARY照合）も同じ挙動だったため後退ではないが、海外展開を前提にする以上は
 * 将来の課題として残しておく。MediaStore は読み仮名ベースの TITLE_KEY を持って
 * いるので、対応するならそこが手がかりになる。
 */
const LEADING_THE = /^the\s+/i;
const LEADING_A_AN = /^an?\s+/i;

export type ArticleOptions = {
  ignoreLeadingThe: boolean;
  ignoreLeadingAAn: boolean;
};

/** 並べ替え用のキーを作る。設定がOFFの語は元のまま残す。 */
export function sortKeyOf(value: string, options: ArticleOptions): string {
  let key = value;
  if (options.ignoreLeadingThe) key = key.replace(LEADING_THE, '');
  // "The" を落とした後の語が "A"/"An" から始まることは実質無いが、
  // 順序に関わらず両方が有効なときは両方効くようにしておく。
  if (options.ignoreLeadingAAn) key = key.replace(LEADING_A_AN, '');
  return key;
}

/**
 * 配列を並べ替えて新しい配列を返す。
 *
 * 比較のたびに sortKeyOf や Intl.Collator を作り直すと、1000曲規模では
 * 比較回数（O(n log n)）ぶんそのまま効いて実測70ms超かかる（Node/V8計測）。
 * ここでは「キーを1回だけ計算してから並べ替える」デコレート・ソート・
 * アンデコレートの形にし、Collatorも1つだけ作って使い回す。
 */
export function sortByField<T>(
  items: T[],
  getField: (item: T) => string,
  options: ArticleOptions
): T[] {
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  return items
    .map((item) => ({ item, key: sortKeyOf(getField(item), options) }))
    .sort((a, b) => collator.compare(a.key, b.key))
    .map((entry) => entry.item);
}
