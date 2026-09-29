## RevenueCat / AdMob（Android専用）

- RevenueCat（`react-native-purchases`）とAdMob（`react-native-google-mobile-ads`）は
  現時点でAndroidにのみ導入している。iOS版はまだ課金・広告を提供しない。
- そのため `package.json` の `expo.autolinking.ios.exclude` で、この2パッケージを
  **iOSのオートリンクから明示的に除外している**。これを外すと、iOSのXcodeビルドに
  GoogleMobileAds/PurchasesのPodが混ざり、ビルド時間や依存関係に悪影響が出るおそれがある。
  iOS対応を追加する際は、この除外設定を消すのではなく、
  `purchases.ios.ts` / `adInit.ios.ts` / `AdBanner.ios.tsx` の中身を実装に差し替えること。
- `app.json` の `react-native-google-mobile-ads` プラグインには `androidAppId` のみを
  設定し、`iosAppId` は意図的に渡していない（プラグイン側は未指定なら黙ってiOSの
  `GADApplicationIdentifier`設定をスキップするだけで、ビルド自体は落ちない）。
  ただし`delayAppMeasurementInit`はプラットフォームを問わず常に適用されるため、
  `expo prebuild`後のiOSの`Info.plist`に`GADDelayAppMeasurementInit`キーが残る
  （`node_modules/react-native-google-mobile-ads/plugin/build/index.js`の
  `withIosAppMeasurementInitDelayed`が`iosAppId`の有無を見ずに実行されるため）。
  ネイティブモジュール自体が存在しないため実害はないが、「iOSに一切影響しない」
  わけではなく、未使用のキーが1つ残る点は把握しておくこと。
- `src/purchasesConfig.ts` の `REVENUECAT_API_KEY_ANDROID`、`src/adConfig.ts` の
  本番用`AD_UNIT_ID`、`app.json` の `androidAppId` は2026-09-27〜29にかけて
  実際の値へ差し替え済み（RevenueCat/AdMobダッシュボードでの手順は
  `docs/revenuecat-admob-setup.md` 参照）。
  - `src/purchasesConfig.ts`の`ENTITLEMENT_ID`（`pro`）、Play Console側の定期購入
    商品（アイテムID`pro`・基本プランID`monthly`）、RevenueCat側の紐付け
    （Products `pro:monthly` → Entitlement `pro` → Offering `current`）は
    2026-09-28に設定済み。
  - **RevenueCatのOffering内Packageの識別子は、独自の`monthly`ではなく予約識別子
    `$rc_monthly`にすること。** `src/purchases.ts`が使う`offerings.current?.monthly`
    はSDK側で`$rc_monthly`識別子のPackageだけを拾う仕様で、`monthly`という
    見た目が紛らわしい独自識別子を付けるとCUSTOM種別扱いになり`.monthly`に
    載らない（RevenueCatダッシュボードでPackage作成時のデフォルト値が
    `$rc_monthly`なので、それを変更しなければ問題ない）。
- `purchases.ios.ts` / `adInit.ios.ts` / `AdBanner.ios.tsx` によるプラットフォーム別
  ファイル解決（Metroの標準機能）は、このリポジトリでは今回が初出。2026-09-30、
  Xcode 27のiOS Simulatorでdev-client起動・JSバンドル読み込みまで確認し、
  Android専用パッケージ（`react-native-purchases`・`react-native-google-mobile-ads`）
  をトップレベルimportしてクラッシュすることなく `.ios.ts` 側が解決されることを確認済み。

## iOSビルド

- 現在のローカル環境はXcode 27（M4 MacBook Air、2026-09下旬に移行）。
- **Xcode 27 / iOS 27 SDKでビルドしたアプリは、UISceneライフサイクルに対応していないと
  起動直後にクラッシュする**（`___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`）。
  Appleが2025年のWWDC25で予告済みの正式な仕様変更で、環境不備ではない。Expo 57 /
  React Native 0.86.3時点ではExpo・RN本体ともに公式のシーン対応が未実装のため、
  `plugins/withIosSceneDelegate.js`がconfig pluginとしてAppDelegate/SceneDelegateへ
  恒久的にシーン対応を注入している（`ios/`はprebuild生成物なので直接編集しても消える）。
  Expoが公式にUIScene対応した場合は、このプラグインと生成される`SceneDelegate.swift`を
  撤去し、公式の仕組みに乗り換えること。
  - このプラグインが生成する`SceneDelegate.swift`は`internal import Expo`・
    `internal import ExpoModulesCore`が必須（`AppDelegate.swift`が`internal import Expo`
    で生成されるため、暗黙アクセスレベルの`import Expo`と混在させると
    "ambiguous implicit access level"でビルドエラーになる）。
  - 姉妹プロジェクトfilto-appでは、上記に加えてXcode 27が`IPHONEOS_DEPLOYMENT_TARGET`
    15.0未満のPodのビルドを拒否する問題（`withIosPodsDeploymentTargetFix.js`で対応）も
    踏んでいるが、retracksはRevenueCat/AdMobをiOS autolinkingから除外済みのため
    2026-09-30時点のローカルビルドでは再現しなかった。Pod追加時に再発する可能性はある。
  - 2026-09-30、`expo prebuild` → `expo run:ios`（Xcode 27、iOS Simulator）で
    ビルド成功・crash無し・dev-clientからのJSバンドル読み込みとアプリ本体の表示まで確認済み。
    署名付きローカルビルド（`eas build --local`）・実機確認はまだ（ウィジェットの実機確認と
    まとめて行う予定）。
- （旧Mac・Xcode 26.3時点の既知問題）Xcode 26.3には`expo-modules-jsi`のヘッダーで
  コンパイルが失敗する既知のビルド問題があった（2026-09-14のEAS Build、Xcode 26.6
  ＋パッチなしのオリジナルヘッダーでビルド成功を確認済み）。新Mac（Xcode 27）への
  移行によりこの具体的な問題自体の再現環境は無くなったが、「Apple SDKのヘッダーへ
  パッチを当てて回避しない」という方針は今後も維持すること。
- 既にストア審査を通過したバージョン（例: 1.0.0）に対して新しいビルドをTestFlight/審査へ
  提出する場合は、`app.json`の`version`（マーケティングバージョン）を必ず引き上げること。
  `eas.json`が`appVersionSource: "remote"`でbuildNumberを自動採番していても、
  versionが同じままだとApple側で`ITMS-90186`/`ITMS-90062`によりリジェクトされる
  （2026-09-24、1回分のビルド・提出を無駄にして判明）。
- `react-native-google-mobile-ads`をv17系で使う場合、config pluginに
  `"androidSdk": "classic"`を明示指定すること。指定しないと、ライブラリ側の
  `android/app-json.gradle`がExpoの`app.json`（`{"expo": {...}}`構造）を、この
  ライブラリ独自の`app.json`設定（トップレベルに`react-native-google-mobile-ads`
  キーを持つ形式）と誤認識し、かつフォールバック処理のバグ（設定すべき
  プロパティ名が`googleAdsJson`になっていて、参照される`googleMobileAdsJson`と
  食い違う）により
  `Cannot get property 'googleMobileAdsJson' on extra properties extension`で
  ビルドが落ちる（2026-09-29、retracksでの初回リリースビルド時に発覚）。
- **`expo prebuild`（`--clean`を付けなくても）は`android/`ディレクトリの中身を
  丸ごと削除してから再生成する。** `android/app/release.jks`・
  `android/keystore.properties`はこの`android/`の中にしか存在しない
  （リポジトリ管理外）ため、**prebuildのたびに物理的に消える**。
  `android/app/build.gradle`への署名設定の手書き配線も同時に失われる
  （config plugin化されていないため）。RevenueCat/AdMobの値を追加した
  2026-09-29の作業で実際にこれを踏み、鍵ファイル自体が消えるのを確認した。
  `prebuild`を実行する前に必ず`release.jks`と`keystore.properties`を
  リポジトリ外へバックアップしておき、実行後は両ファイルを元の場所へ戻し、
  `android/app/build.gradle`の署名設定（`keystorePropertiesFile`の読み込みと
  `signingConfigs.release`/`buildTypes.release.signingConfig`）を手動で
  再配線すること（詳細は`docs/requirements.md` 13.5節）。

## iOSウィジェット（`'widget'`ディレクティブの制約）

- `expo-widgets`の`createWidget()`に渡す、関数本体先頭に`'widget';`と書く関数は、
  `babel-preset-expo`のwidgets-pluginによって**関数本体だけがソース文字列化**される
  （クロージャ捕捉もスコープ巻き上げも無い）。この文字列がネイティブ側で
  `JSContext`に単独evaluateされて実行される（`WidgetsJSRuntime.swift`）。
- そのため、**関数の外にあるものは一切参照できない**。import・モジュールスコープの
  定数やヘルパー関数を参照すると、実機で`ReferenceError`になる。使えるのは
  `props`/`environment`と、ウィジェットランタイムが`globalThis`へ載せる
  `@expo/ui/swift-ui`のコンポーネント・modifiers・React・react-nativeスタブだけ。
  色などの定数は関数の中で完結させて定義すること（例: `widgets/NowPlayingWidget.tsx`）。
- この失敗はRELEASEビルドでは無言で`EmptyView()`になり（`expo-widgets`の
  `DynamicView.swift`）、ホーム画面のウィジェットが真っ黒になる以外の手がかりが
  一切出ない。`tsc`はこの種の失敗を検出できない（型としては正しいimportのため）。
- 事前チェック方法：変換後の関数文字列に、使っている変数の定義が実際に含まれているかを
  babelで直接確認できる（正規表現でその場所だけ抜き出そうとすると、コメントや文字列に
  バッククォートが含まれた時に途中で切れて誤判定するので、変換結果全体をそのまま出力する）。
  ```
  node -e "
  const babel = require('@babel/core');
  const { widgetsPlugin } = require('babel-preset-expo/build/plugins/widgets-plugin');
  const src = require('fs').readFileSync('widgets/NowPlayingWidget.tsx', 'utf8');
  const out = babel.transformSync(src, {
    filename: 'w.tsx',
    presets: [['@babel/preset-typescript', { isTSX: true, allExtensions: true }]],
    plugins: [widgetsPlugin], babelrc: false, configFile: false,
  }).code;
  console.log(out);
  "
  ```
  出力全体を目視し、参照している変数がすべて`props`/`environment`／この中で定義した
  もの／ランタイム提供のAPIであることを確認する。
- 2026-09-24、この制約に気づかずEASビルドを3回消費して原因特定した
  （`containerBackground`のiOS 17未満での挙動という別の実在する問題と重なっていたため
  特定が長引いた。詳細はdocs/ios-release-checklist.md「実機確認の経緯」参照）。
