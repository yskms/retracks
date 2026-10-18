const { withGradleProperties, withAppBuildGradle } = require('expo/config-plugins');

// Androidのリリースビルドで、R8（コードの縮小・難読化・最適化）を有効にする。
//
// 2027年2月から、Google Playは「DEXが10MBを超えるアプリ」に、アップロードごとに
// 難読化・最適化・縮小の3つの率をそれぞれ25%以上にすることを求める
// （Play Console ヘルプ「technical quality requirements」）。このアプリのDEXは66MBで
// 該当し、R8を使っていなかった1.2.0は難読化率が2%だった。
// 経緯と実測値は docs/requirements.md 13.8。
//
// `android/`は`expo prebuild`の生成物で、`build.gradle`・`gradle.properties`を
// 手で直しても次のprebuildで消える。そのため、設定はこのpluginで入れる。
//
// 【重要】次の2つは、一見やめてよさそうだが、やめないこと。
// 1. `proguard-android.txt`を`proguard-android-optimize.txt`へ置き換える処理。
//    テンプレートの`proguard-android.txt`は`-dontoptimize`を含むので、そのままでは
//    R8が最適化をせず、3つの率のうち「最適化率」が上がらない。
//    なお、AGP 9.0でこのファイルのサポート自体が終わる（公式ドキュメント）。
// 2. `shrinkResources`を無効のままにしておくこと（下の定数で明示している）。
//    Playの要件はDEXの率だけで、リソース縮小は関係しない。一方、JSから`require()`
//    している画像（`src/components/SplashFade.tsx`・`app/player.tsx`）は、
//    リリースビルドで`res/drawable-*`へ入り、名前で探して読み込まれる。これはJSの側
//    だけが知っている名前なので、リソース縮小が「使われていない」と判断して
//    消す恐れがある。消えると、リリースだけで画像が出なくなる。
//
// どちらも、置換対象・参照先が見つからないときはビルドを失敗させる。Expoの
// テンプレートが変わったときに、何も言わず設定が効かなくなるのを避けるため。

const MINIFY_KEY = 'android.enableMinifyInReleaseBuilds';
const SHRINK_RESOURCES_KEY = 'android.enableShrinkResourcesInReleaseBuilds';
const DEFAULT_PROGUARD_FILE = 'proguard-android.txt';
const OPTIMIZE_PROGUARD_FILE = 'proguard-android-optimize.txt';

function setProperty(items, key, value) {
  const existing = items.find((item) => item.type === 'property' && item.key === key);
  if (existing) {
    existing.value = value;
  } else {
    items.push({ type: 'property', key, value });
  }
}

function withR8GradleProperties(config) {
  return withGradleProperties(config, (mod) => {
    setProperty(mod.modResults, MINIFY_KEY, 'true');
    setProperty(mod.modResults, SHRINK_RESOURCES_KEY, 'false');
    return mod;
  });
}

function withR8ProguardFile(config) {
  return withAppBuildGradle(config, (mod) => {
    const before = mod.modResults.contents;

    // 上の2つのプロパティを`build.gradle`が読んでいなければ、設定しても効かない。
    for (const key of [MINIFY_KEY, SHRINK_RESOURCES_KEY]) {
      if (!before.includes(key)) {
        throw new Error(
          `withAndroidR8: android/app/build.gradle が ${key} を参照していません。` +
            'Expoのテンプレートが変わった可能性があります。plugins/withAndroidR8.js を見直してください。'
        );
      }
    }

    const oldCall = `getDefaultProguardFile("${DEFAULT_PROGUARD_FILE}")`;
    const newCall = `getDefaultProguardFile("${OPTIMIZE_PROGUARD_FILE}")`;
    if (before.includes(oldCall)) {
      mod.modResults.contents = before.split(oldCall).join(newCall);
    } else if (!before.includes(newCall)) {
      throw new Error(
        `withAndroidR8: android/app/build.gradle に ${oldCall} が見つかりません。` +
          'Expoのテンプレートが変わった可能性があります。plugins/withAndroidR8.js を見直してください。'
      );
    }
    return mod;
  });
}

module.exports = function withAndroidR8(config) {
  config = withR8GradleProperties(config);
  config = withR8ProguardFile(config);
  return config;
};
