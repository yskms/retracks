## RevenueCat / AdMob（Android専用）

- RevenueCat（`react-native-purchases`）とAdMob（`react-native-google-mobile-ads`）は
  現時点でAndroidにのみ導入している。iOS版はまだ課金・広告を提供しない。
- そのため `package.json` の `expo.autolinking.ios.exclude` で、この2パッケージを
  **iOSのオートリンクから明示的に除外している**。これを外すと、iOSのXcodeビルドに
  GoogleMobileAds/PurchasesのPodが混ざり、`Xcode 26.3`の既知の問題やビルド時間に
  悪影響が出るおそれがある。iOS対応を追加する際は、この除外設定を消すのではなく、
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
  ファイル解決（Metroの標準機能）は、このリポジトリでは今回が初出。iOSビルドで
  実際に`.ios.ts`側が解決され、Android専用パッケージ（`react-native-purchases`・
  `react-native-google-mobile-ads`）をトップレベルimportしてクラッシュしないことは
  まだ実機/シミュレータで確認していない。iOS対応に着手する前に一度確認すること。
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
