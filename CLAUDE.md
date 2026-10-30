## ドキュメント運用

- `docs/requirements.md`の履歴ログ（`| vX.XX | 日付 | ... |`の表）にリリース関連の
  作業（バージョン更新、ビルド、実機確認、ストア提出等）を追記したら、同じタイミングで
  `docs/development-history.md`の「現在地」表・「マイルストーン」表も更新すること。
  `requirements.md`側だけ更新して`development-history.md`側を忘れる、ということが
  実際に起きた（2026-10-04、Android 1.1.1のリリース作業で発覚。「マイルストーン」が
  数日分古いままになっていた）。両ファイルは役割が違う（`requirements.md`は詳細な
  作業ログ、`development-history.md`は俯瞰用の現在地・マイルストーン）ため、片方の
  更新がもう片方に自動で反映されるわけではない。
- GitHub Pages（`docs/`を公開）では、`docs/_config.yml`で**`.md`をすべて非公開にし、`privacy-policy.md`だけ
  `include`している**。`docs/`に`.md`を足してもサイトには出ない（既定で非公開）。サイトに出したい`.md`だけ
  `include`に足す。`privacy-policy.md`の`include`は外さない（URLがアプリ・両ストアに登録済みで、外すと404）。
  理由と経緯は`docs/requirements.md`のv2.101。

## RevenueCat / AdMob（Android/iOS共通）

- RevenueCat（`react-native-purchases`）とAdMob（`react-native-google-mobile-ads`）は
  Android・iOS両方に導入済み（iOS版は2026-10に追加）。`src/adInit.ts`・
  `src/components/AdBanner.tsx`・`src/purchases.ts`はどちらのプラットフォーム
  固有のネイティブ呼び出しも持たない（JS APIのみ）ため、**実装は1つに統一している。
  プラットフォーム別に分岐が必要なのはAdMobアプリID/広告ユニットID・RevenueCatの
  APIキーだけ**で、それぞれ`app.json`（`androidAppId`/`iosAppId`）、
  `src/adConfig.ts`、`src/purchasesConfig.ts`で`Platform.select`により分岐している。
  - 過去形として、iOS導入前は`package.json`の`expo.autolinking.ios.exclude`で
    この2パッケージをiOSのオートリンクから除外し、`purchases.ios.ts` /
    `adInit.ios.ts` / `AdBanner.ios.tsx`というno-opスタブで置き換えていた時期が
    あった。iOS導入時（2026-10）にこの除外設定とスタブは撤去し、共通実装へ一本化
    済み。**もし将来再びこの3ファイルが復活していたら、それは意図的な設計回帰では
    なく誤った復元なので、復活させずこの節の方針に合わせて削除すること。**
- `app.json`の`react-native-google-mobile-ads`プラグインは`androidAppId`に加え
  `iosAppId`も設定済み（iOS導入前は`iosAppId`未設定だったため、`GADDelayAppMeasurementInit`
  キーだけがInfo.plistに残り実害のない状態だったが、`iosAppId`設定後は
  `GADApplicationIdentifier`と合わせて実際に効くようになった）。`skAdNetworkItems`
  （Google公式のSKAdNetwork ID一覧、2026-10時点で50件）も設定済み。この一覧は
  Google側で更新されることがあるため、大きく変更する際は
  `https://developers.google.com/admob/ios/ios14`等の公式ガイドを都度確認すること
  （記憶や過去の値から書き起こさない）。
- **ATT（App Tracking Transparency）・IDFAは意図的に使っていない。**
  `AdBanner.tsx`は常に`requestNonPersonalizedAdsOnly: true`でリクエストする設計
  （Android/iOS共通）。IDFAへ一切アクセスしないため、`NSUserTrackingUsageDescription`や
  ATT許可ダイアログの実装は不要と判断している。AdMobの「IDFA説明メッセージ」機能も
  意図的に未設定。この方針を変える（パーソナライズ広告を使う）場合のみATT対応が必要になる。
- `src/purchasesConfig.ts`の`ENTITLEMENT_ID`（`pro`）は、Android（Play Console商品
  `pro`/`monthly` → RevenueCat `pro:monthly`）・iOS（App Store Connect製品
  `pro_monthly` → RevenueCat `pro_monthly`）の両方で同じEntitlementに紐付け済み
  （iOS側は2026-10設定）。両プラットフォームの商品は同じOffering `current`の
  同じPackage `$rc_monthly`に入っている。
  - **RevenueCatのOffering内Packageの識別子は、独自の`monthly`ではなく予約識別子
    `$rc_monthly`にすること。** `src/purchases.ts`が使う`offerings.current?.monthly`
    はSDK側で`$rc_monthly`識別子のPackageだけを拾う仕様で、`monthly`という
    見た目が紛らわしい独自識別子を付けるとCUSTOM種別扱いになり`.monthly`に
    載らない（RevenueCatダッシュボードでPackage作成時のデフォルト値が
    `$rc_monthly`なので、それを変更しなければ問題ない）。
- iOSの新規サブスクリプションは、実際にアプリのビルドへ組み込んで審査提出するまで
  RevenueCat側のProductsで「Missing Metadata」のままになることがある（Apple側の
  仕様で、未提出のサブスクリプションは価格等のメタデータが完全に同期されないため）。
  1.1.1ビルドの審査提出後に解消される想定。
- ダッシュボード側（AdMob/App Store Connect/RevenueCat）の作業記録は
  `docs/private/revenuecat-admob-setup.md`参照。
- iOSビルド時、`[CP-User] [RNGoogleMobileAds] Configuration`スクリプトが
  `ios_app_id key not found in react-native-google-mobile-ads key in app.json`
  という警告を出すが、これは無害（ビルド成功・実機/Simulatorでの広告表示も確認済み）。
  このスクリプトはExpoのconfig plugin経由の設定を見ておらず、`app.json`直下に
  旧来の`react-native-google-mobile-ads`トップレベルキーがあるかどうかだけを
  チェックしている（警告文自体も「Expo config pluginを使っているなら無視してよい」
  と明記している）。このリポジトリはconfig plugin経由（`expo.plugins`内）でのみ
  設定しているため、追加対応は不要。

## Android R8（コード縮小・難読化・最適化。詳細は`docs/requirements.md` 13.8）

- リリースビルドのR8は`plugins/withAndroidR8.js`（`app.json`のplugins）が有効にしている。2027年2月から、
  Google PlayはDEX 10MB超のアプリに難読化・最適化・縮小の各25%以上を求める。**このpluginは外さない・簡略化しない**。
- **`proguard-android-optimize.txt`への置き換えと、`plugins/android-r8-rules.pro`（Expoの注釈インターフェース
  `@interface expo.modules.**`のkeep。`Field`・`Required`・`ServiceInterface`など）はセット**。テンプレートの
  `proguard-android.txt`は`-dontoptimize`を含み、最適化率が上がらない。一方、最適化を有効にしてkeepを外すと、
  ExpoのRecord変換がR8に壊され（注釈インターフェースの呼び出しが`throw null`になる）、Recordを引数に取る
  ネイティブ関数が`NullPointerException`になって、**リリースビルドだけ**で起動直後に落ちる。
  `tsc`・debugビルドでは検出できない。`-dontoptimize`へ戻して済ませない（要件の最適化率が不明になる）。
  keepを`Field`・`Required`の2つに絞らないこと（`ServiceInterface`など同種の注釈を、壊れない理由が不明なまま
  運に任せることになる）
- **AGPは`plugins/withAndroidR8.js`が8.12.3（8.12系の最新パッチ）に指定している。外さない**。Playが`r8.json`から率を読むのは
  「AGP 8.10以降の最新パッチ」のときだけで、React Nativeが固定する8.12.0のままだと、Play Consoleの率が
  難読化92%（算出方法は不明）・最適化率`-`・縮小率`-`になり、`-`が2027年2月の要件でどう扱われるかは不明（8.12.3では3つとも84%と表示された）。
  React Native・Expoの更新でAGPが変わったときや、8.12.4以降が出たときは、`AGP_VERSION`を見直してConsoleで率を確認する
- **`shrinkResources`は意図的に無効**。JSから`require()`している画像は`res/drawable-*`に入り、名前で探して読み込まれるので、
  リソース縮小に消される恐れがある。Playの要件はDEXの率だけで、リソース縮小は不要
- Expo・React Native・各ライブラリを更新したら、R8入りのリリースビルドを実機かエミュレータで動かして確認する
  （起動、再生、メドレー、ウィジェット。購入はエミュレータではできないので内部テストトラックで）
- `mapping.txt`はリリースごとに`docs/private/mapping/<version>-vc<code>/`へ圧縮して保管する（AABにも入っているが、
  手元でlogcatを読むのに要る）

## メドレー（区間再生）のON/OFF切り替え（Android、詳細は`docs/requirements.md` 7.4.2）

- **OFFも「次の曲から」適用。鳴っている曲の区間は外さない**（利用者の判断。外すには曲の差し替えが要り、約0.1秒の音切れが出る。
  音切れは許容しない）。実装は`SegmentController`の`segment`（設定）と`currentItemSegment`（鳴っている曲に効く区間）の分離で、
  OFFにしても区間付きの曲はフェードを残す。**`segment = null`でフェードを止める形に戻さない**（区間が残るので、0 dBのまま切れる。
  1.3.1で実際に報告された）。OFF後の最初の曲の音量の戻しも、`MIN_RISE_MS`の制限を外さない
- 「この曲を最初から」で退避した元の項目は、設定が変わったら`applySegmentToQueue()`が作り直す（`replaceFullPlaybackStash()`）。
  外すと、OFFにしたのに古いONの区間の曲が戻ってきて、フェードなしで切れる
- **「この曲を最初から」ボタンは、メドレーOFFでも出す**（アプリ画面もウィジェットも。OFFは次の曲から効くので、OFFにした直後の曲には区間が残る。
  利用者の判断）。`rushOn &&`や、ウィジェットの「OFFでは意味が無い」という前提に戻さない。OFFで押すときは、戻す控えを区間なしにし、
  `followSetting()`でOFF後に残ったフェードも外す（`playCurrentFromStart()`）
- **「通しで再生」の控え（`PlaybackService`の`fullPlaybackIndex`と退避項目）は、キューの差し替え（`setQueue`）で捨てる**（`clearFullPlayback()`）。
  控えを使うのは、曲（`mediaId`）が一致するときだけ。捨てないと、別のキューを始めたとき、前のキューの曲が新しいキューへ書き戻される
  （画面のキューと鳴る曲がずれる）。`main`にも元からあった不具合で、「最初から」をOFFでも出して当たりやすくなった
- 音量・フェード・切断の確認は、聴かずに、`dumpsys media.audio_flinger`の自分のトラックの`L dB`列を端末上で約100Hz採取して行う
  （手順は7.4.2の「測定」）。**release**ビルドで測る

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
- **`eas`コマンドはPATHに無い**（グローバルにもプロジェクトにも`eas-cli`は入っていない）。`npx --no-install eas-cli@25.3.0`
  （`npx`のキャッシュにある版）で呼ぶ。`npx eas-cli`だと最新（2026-10-28時点で26.0.0）を取りに行く。`eas submit`は
  EAS側のキューで20分以上「in queue」のままになることがあるが、止めずに待てば進む（`eas status`で状態が見える。
  詳細は`docs/requirements.md` v2.89）。

## 再生キューの保存とキュータブ（詳細は`docs/requirements.md` 6.2・10.4）

- **キュー・キー（`all` / `artist:` / `album:` / `songs:` / `seq:`）を分解して意味を取り出さない。**
  MediaStore がIDを持たない曲は、名前がIDの代わりに入り、名前のカンマで壊れる。何のキューかは
  `QueueMeta`（`src/queueKeys.ts`）を別に保存する。分解してよいのは旧データを救う`legacySrcIds()`だけ。
- **順番再生（`seq:`）の並びを`shuffle:v1:`に入れない**（`ordered:v1:`が別の名前空間）。起動時の復元は
  並びが一致すれば「シャッフル中」とみなすので、同じ場所に入れるとリピートの1巡ごとに順列を作り直す。
- **再生位置・カーソルは、シャッフル状態があるか`orderedLiveRef`が立っているときだけ書く。**
  どちらでもないキューは`queueKeyRef`が`'all'`のままで、書くと`position:all`を上書きする。
- **続きから再生は、保存位置を`setQueue()`の前に読み、シークは`seekWhenLoaded()`で読み込み後に送る。**
  余計な待ちに見えるが、戻さないこと（理由は`src/playback.tsx`のコメントと`docs/requirements.md` v2.48）。
- `playFrom()`は既定で並びを保存する。**保存しないのは、曲タブを複数選択なしでタップした再生と、
  検索結果のタップだけ**（`remember: false`。タップや検索語のたびに項目が増え、保存の10件枠から
  アーティスト／アルバムの途中経過を押し出す）。アーティスト／アルバム詳細の曲タップなど、ほかの
  再生は保存する（利用者の指示）。
- 詳細画面からの順番再生は`origin`を渡し、キーを並びのハッシュでなく出所のID（`seq:artist:`/
  `seq:album:`）にする。並びのハッシュだと、並べ替えや曲の増減のたびに同じアーティストの項目が増える。
  アルバム詳細の`id`は開いた経路で別の値になる（プレイヤー画面はアルバム名、ほかはalbumId）ので、
  出所には`albumOriginId()`でそろえた値を使う（そのまま使うと、同じアルバムの項目が2つ並ぶ）。
- `TabId`の`queues`は変えない（`normalizeTabs()`が未知のIDを捨て、利用者のタブ設定が初期化される）。
  要件 10.4 の未実装の「プレイリスト」とは別物で、`playlists`という名前も使わない。
- 再生位置の保存・復元を実機で確かめる手順は`docs/requirements.md` 13.6（**一時停止して保存位置を固定してから**
  記録する）。
- **鳴っているシャッフルと同じキューを始め直す操作（全曲のFAB、詳細画面のシャッフル等）は、`playTracks()`の入口で`canKeepActiveShuffle()`
  （`src/shuffleRestart.ts`）が真なら何もしない。積み直すと、最大5秒前に保存した位置まで巻き戻る。**条件の「曲の集合が同じ」を外さない**：
  積み直し（`prepareShuffle()` → `reconcile()`）は、再生中に増減した曲を順列へ反映する役割も持つ（キーは出所で決まり、再スキャンでも変わらない）。
  `shuffleRef`も見る（曲タブのタップで始めた再生は、キーが全曲のまま`shuffleRef`がnull）。検査は`npm run check:keep-playing`（詳細は`docs/requirements.md` 13.9）
- **`playback.tsx`の1巡完了の処理（`onTrackChange`）は、`await startNextCycle()`の直後で、キーと`queueRef`の配列の
  両方を控えと比べ、違えば戻る。キーだけの比較に「簡略化」しない。** 保存しない再生（`playFrom`の`remember: false`）は
  キーが`all`のまま同期的にキューを入れ替えるので、全曲シャッフルの1巡完了と重なるとキーだけでは素通りして、
  古いシャッフルのキューが新しいキューを上書きする（実測。詳細は`docs/requirements.md` 13.9）。
  戻る分岐の`writeJson(position, 0)`と全曲の`setAllProgress()`も外さない（続きの`setQueue()`が出す`onTrackChange(0)`が
  やっていた片付けで、戻ると走らない。外すと、あとで「続きから」を押したとき新しい巡の1曲目が前の巡の位置までシークされ、
  FABが前の巡のN/Nのままになる）。`applyQueue`は、キューを替えるときにしか呼ばない（このガードの前提）。
- **キューごとのリピート・メドレーの控え**（`playback-settings:v1:<キー>`、詳細は`docs/requirements.md` 10.4）。
  - **戻すのは続きから再開の入口（キュータブの行・全曲のFAB。`restoreSettings`）だけ**。それ以外の開始は
    いまの設定のまま始め、控えを上書きする。要件5.3の「JSはリピートを上書きしない」の唯一の例外で、
    ほかの開始にも広げない（再生のたびに利用者の設定が戻る）
  - **戻す順序は、`queueKeyRef`の切り替え後・`setQueue()`の前**。区間はMediaItemに焼き込まれ、`setSegment()`は
    鳴っている曲を組み直さないので、`setQueue()`の後やstateだけの変更（350ms後のeffect）に任せると1曲目だけ
    前の区間で鳴る。控えは切り替える**前**に読む。書くのは、位置・カーソルと同じ条件（シャッフル状態があるか
    `orderedLiveRef`）のときだけ
  - **`restorePlaybackSettings()`は、メドレーのON/OFFが変わらなくても`setSegment()`を必ず送る**。比較相手の
    `rushOnRef`はJSの値で、トグルの350ms以内はネイティブがまだ前の区間なので、比べて省くと1曲目だけ前の
    区間で鳴る（同じ値ならネイティブは何もしないので、送って害はない）。「無駄な呼び出し」に見えるが戻さない
  - **開始時点の控えは、`saveOrdered`より先に保存の列へ入れる**（`playFrom`・`resumeOrdered`）。後ろに置くと、
    並びの保存を待つ間に届いたリピートの変更を古い値で上書きする。保存層は`npm run check:queue-settings`
  - **`rushOn`は`StorageKeys.settings`に保存する**（区間設定のeffectで書く）。`useState(true)`だけに戻さない。
    ネイティブは区間を引き継ぐので、JSが毎回ONで始まると、OFFの区間を起動の350ms後にONで組み直す

## 最近追加タブ（詳細は`docs/requirements.md` 10.4・13.9）

- **一覧を保存しない。** `src/recentGroups.ts`が`Track.addedAt`から開くたびに組み立てる（アーティスト × 端末の暦日、
  新しい順に30行）。キュータブのように登録簿（`queueStore.ts`）へ持たせない：持った時点からしか追加が分からず、
  アプリを開いていない間に足した曲を取りこぼす。上限での押し出しも、端末から消した曲が外れるのも、組み立て直しだけで成り立つ。
- **`Track`にフィールドを足したら、`library.ts`のキャッシュ版（`LibrarySnapshot.version`と`readCache()`の比較）を上げる**
  （上げないと、旧キャッシュの曲が新フィールドを持たないまま使われる。`addedAt`で5→6にした）。`playback.tsx`の
  `fallback()`は`Track`を返す関数なので、足し忘れは型エラーで止まる。
- **詳細画面（`app/recent/[day].tsx`）の曲は、行から持たず`tracksOfGroup()`で曲一覧から引き直す**（開いている間に行が
  上限から押し出されても中身が消えないように）。`RecentGroup.key`は分解しない（キュー・キーと同じ理由）。
- **シャッフルは`playTracks('songs', …, { names })`。`'artist'`にしない。** `artist:`のキューは「そのアーティストの全曲」の
  続きとして復元されるので、一部の曲だけで始めると、アーティスト詳細のシャッフルを上書きする。
- **詳細画面からの再生（「順番に」・曲タップ）に`origin`を渡さないのは、利用者の判断**（同じ日に曲が増えると「続きから」に
  同じ見出しの項目が増えるが、削除できるので許容）。`origin`を足して「直さない」。見出しに日付を添える案も採っていない。
- 選択の種類は`app/index.tsx`の`LibrarySelectionKind`。`library.ts`の`SelectionKind`に`'recent'`を足さない
  （`tracksForSelection()`は行を引けない）。端末からの削除は最近追加の選択では出さない（意図的）。
- タブバーのラベルは`numberOfLines={1}`・`adjustsFontSizeToFit`。外すと、5タブの360dp幅で「アーティスト」が折り返す。
- 動作確認で日をまたいだ追加日が要るときは、`content update`が`date_added`を無視するので、端末の時計を動かしてスキャンする（13.9）。

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
