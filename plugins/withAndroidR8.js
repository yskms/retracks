const {
  withGradleProperties,
  withAppBuildGradle,
  withProjectBuildGradle,
  withDangerousMod,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

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
// 【重要】次の3つは、一見やめてよさそうだが、やめないこと。
// 1. `proguard-android.txt`を`proguard-android-optimize.txt`へ置き換える処理。
//    テンプレートの`proguard-android.txt`は`-dontoptimize`を含むので、そのままでは
//    R8が最適化をせず、3つの率のうち「最適化率」が上がらない。
//    なお、AGP 9.0でこのファイルのサポート自体が終わる（公式ドキュメント）。
// 2. `plugins/android-r8-rules.pro`を足す処理（optimize版に切り替えるのと必ずセット）。
//    最適化を有効にすると、ExpoのRecord変換がR8に壊され、Recordを引数に取る
//    ネイティブ関数がNullPointerExceptionで落ちる。Expoの注釈インターフェース
//    （`Field`・`Required`・`ServiceInterface`など）を残すkeepルールが入っている。
//    optimize版へ切り替えて、このルールを外すと、起動直後にクラッシュする。
// 3. `shrinkResources`を無効のままにしておくこと（下の定数で明示している）。
//    Playの要件はDEXの率だけで、リソース縮小は関係しない。一方、JSから`require()`
//    している画像（`src/components/SplashFade.tsx`・`app/player.tsx`）は、
//    リリースビルドで`res/drawable-*`へ入り、名前で探して読み込まれる。これはJSの側
//    だけが知っている名前なので、リソース縮小が「使われていない」と判断して
//    消す恐れがある。消えると、リリースだけで画像が出なくなる。
// 4. AGPを`AGP_VERSION`（8.12系の最新パッチ）に指定する処理。
//    Playが`r8.json`から最適化率・縮小率・難読化率を読むのは、公式ドキュメントでは「AGP 8.10以降の
//    最新パッチ」のときだけ。React Nativeが固定するAGP 8.12.0のままだと、Play Consoleの率が
//    難読化92%（`r8.json`を使わないフォールバックによる値とみられる）・最適化率`-`・縮小率`-`になり、2027年2月の要件（3つとも25%以上）で
//    `-`がどう扱われるかは不明（未確認）。8.12.3（R8 8.12.22）に上げると、3つとも84%と表示された
//    （2026-10-20、versionCode 7の内部テストで確認。docs/requirements.md 13.8）。
//    今回の構成では、このclasspathの指定で、RNが固定する8.12.0より新しい8.12.3が採用された。Gradleは通常、
//    競合する版のうち新しい方を選ぶが、AABの`androidGradlePluginVersion`で確認すること。
//    React Native・Expoを更新してAGPが変わったとき、また8.12.4以降が出たときは、この値を見直して、
//    Consoleで率が出ることを確認すること（`AGP_VERSION`を最新パッチに保つ）。
//
// いずれも、置換対象・参照先が見つからないときはビルドを失敗させる。Expoの
// テンプレートが変わったときに、何も言わず設定が効かなくなるのを避けるため。

const MINIFY_KEY = 'android.enableMinifyInReleaseBuilds';
const SHRINK_RESOURCES_KEY = 'android.enableShrinkResourcesInReleaseBuilds';
const JVM_ARGS_KEY = 'org.gradle.jvmargs';
// minifyを有効にすると、AABに難読化の対応表（proguard.map、約170MB）が入る。
// テンプレートの-Xmx2048mでは、AABのバンドル時にbundletoolが
// `Java heap space`で落ちることがあった（2026-10-18）。
const JVM_ARGS_VALUE = '-Xmx4096m -XX:MaxMetaspaceSize=1g';

// Googleのmaven（dl.google.com/dl/android/maven2/com/android/tools/build/gradle/）で、8.12系の最新パッチ（2026-10-20時点）。
const AGP_VERSION = '8.12.3';
const OLD_AGP_CLASSPATH = "classpath('com.android.tools.build:gradle')";
const NEW_AGP_CLASSPATH = `classpath('com.android.tools.build:gradle:${AGP_VERSION}')`;

const RULES_SOURCE = path.join(__dirname, 'android-r8-rules.pro');
const RULES_DEST_NAME = 'retracks-r8-rules.pro';

const OLD_PROGUARD_FILES = 'proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"';
const NEW_PROGUARD_FILES =
  `proguardFiles getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro", "${RULES_DEST_NAME}"`;

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
    setProperty(mod.modResults, JVM_ARGS_KEY, JVM_ARGS_VALUE);
    return mod;
  });
}

function withR8ProguardFiles(config) {
  return withAppBuildGradle(config, (mod) => {
    const before = mod.modResults.contents;

    // 上のプロパティを`build.gradle`が読んでいなければ、設定しても効かない。
    for (const key of [MINIFY_KEY, SHRINK_RESOURCES_KEY]) {
      if (!before.includes(key)) {
        throw new Error(
          `withAndroidR8: android/app/build.gradle が ${key} を参照していません。` +
            'Expoのテンプレートが変わった可能性があります。plugins/withAndroidR8.js を見直してください。'
        );
      }
    }

    if (before.includes(OLD_PROGUARD_FILES)) {
      mod.modResults.contents = before.split(OLD_PROGUARD_FILES).join(NEW_PROGUARD_FILES);
    } else if (!before.includes(NEW_PROGUARD_FILES)) {
      throw new Error(
        `withAndroidR8: android/app/build.gradle に「${OLD_PROGUARD_FILES}」が見つかりません。` +
          'Expoのテンプレートが変わった可能性があります。plugins/withAndroidR8.js を見直してください。'
      );
    }
    return mod;
  });
}

function withAgpPatchVersion(config) {
  return withProjectBuildGradle(config, (mod) => {
    const before = mod.modResults.contents;
    if (before.includes(OLD_AGP_CLASSPATH)) {
      mod.modResults.contents = before.split(OLD_AGP_CLASSPATH).join(NEW_AGP_CLASSPATH);
    } else if (!before.includes(NEW_AGP_CLASSPATH)) {
      throw new Error(
        `withAndroidR8: android/build.gradle に「${OLD_AGP_CLASSPATH}」が見つかりません。` +
          'Expoのテンプレートが変わった可能性があります。plugins/withAndroidR8.js を見直してください。'
      );
    }
    return mod;
  });
}

function withR8RulesFile(config) {
  return withDangerousMod(config, [
    'android',
    (mod) => {
      const dest = path.join(mod.modRequest.platformProjectRoot, 'app', RULES_DEST_NAME);
      fs.copyFileSync(RULES_SOURCE, dest);
      return mod;
    },
  ]);
}

module.exports = function withAndroidR8(config) {
  config = withR8GradleProperties(config);
  config = withR8ProguardFiles(config);
  config = withR8RulesFile(config);
  config = withAgpPatchVersion(config);
  return config;
};
