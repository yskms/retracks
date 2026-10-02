# iOS リリースチェックリスト

## 実装

- [x] iOS用 `RetracksPlayer` をExpoローカルモジュールとして登録
- [x] 端末内の再生可能な曲だけを読み込む
- [x] キュー、曲送り、シーク、リピートを実装
- [x] RUSH区間再生、境界処理、フェードのクランプを実装
- [x] バックグラウンド音声を設定
- [x] ロック画面の曲情報と再生操作を実装
- [x] iOS用アートワークURIを維持
- [x] アートワークをネイティブ側で遅延取得し、一覧・プレイヤーに表示
- [x] 製品ビルドで開発者向け画面の導線と直接ルートを遮断
- [x] iPhone 8実機で音楽ライブラリ権限を確認
- [x] iPhone 8実機で通常再生・RUSH再生を確認
- [x] 画面ロック、バックグラウンド再生、ロック画面操作を確認
- [x] キュー・再生位置・リピートの再起動後の復元を確認
- [x] リピート、次曲切り替え、シャッフルを確認
- [ ] フェード精度とイヤホン操作を確認
- [ ] 電話・Siri・他アプリ音声による中断と復帰を確認
- [ ] BluetoothとAirPlayを確認

## ホーム画面ウィジェット（表示専用・v1、`feat/ios-widget`）

- [x] `expo-widgets`（公式SDKモジュール）＋`@expo/ui`を導入し、Configプラグインを設定
- [x] `widgets/NowPlayingWidget.tsx`を実装（アートワーク・曲名・アーティスト名、systemSmall/systemMedium対応、タップでアプリを開く）
- [x] `src/widgetSync.ios.ts`で曲の切り替わりごとにアートワークをApp Group共有ディレクトリへ書き出し`updateSnapshot()`
- [x] Android向け空実装（`src/widgetSync.ts`）を用意し、`playback.tsx`からOSを問わず同じ関数を呼べるようにした
- [x] `npx tsc --noEmit`・i18nキー検査
- [x] EASビルド→実機（iPhone 8）でホーム画面に追加し表示・タップ・idle状態を確認（2026-09-30）
- [x] App Store掲載文・スクリーンショットからホーム画面ウィジェット除外の記載を外す（次回アップデート申請時）
  - 掲載文（`docs/ios-app-store-listing.md`）は1.1.0向けに更新済み
  - スクリーンショット（`06-widget.png`、en-US/en-US-6.5/ja-JP/ja-JP-6.5）はSimulator
    （iPhone 18 Pro Max、iOS 27）で撮影して追加済み（2026-09-30）。Simulatorには
    音楽ライブラリが無いため、App Group共有ディレクトリへダミーアートワークを直接配置し、
    `app/debug.tsx`に一時的な`NowPlayingWidget.updateSnapshot()`呼び出しボタンを
    追加してNow Playing表示を再現した（スクリーンショット撮影後にコードは削除済み、
    差分なし）

**実機確認の経緯（2026-09-23〜24、両ストア審査完了後に再開）**：ホーム画面に追加した
ウィジェットが常に真っ黒になる不具合の調査でビルドを複数回消費した。

- ビルド11：`version`を上げずに提出し`ITMS-90186`/`ITMS-90062`でリジェクト
  （CLAUDE.mdに再発防止を記録）。1.1.0に上げてビルド12で再提出、TestFlight配信は成功
- ビルド12時点：ウィジェットは真っ黒。`containerBackground`が`@expo/ui`の現行実装では
  iOS 17未満で何もしない（`background()`を併用する形で修正）ことを確認したが、
  これを直しても真っ黒のまま変化なし（ビルド12→修正して次のビルドでも再現）
  → node_modulesの`expo-widgets`パッケージ自体のビルドスクリプトを疑い調査したが、
  実際にビルド済み`.ipa`を展開して確認したところJSバンドルはappex内の正しい位置に
  存在しており、この仮説は誤りと判明（対応した変更はrevert済み）
- 原因特定のため、`expo-widgets`の`WidgetsDynamicView.render()`
  （props/modifierのデコード失敗時に例外を握りつぶしてEmptyView()を返す。
  RELEASEビルドではこの失敗が一切ログに残らない）を一時的にパッチし、
  実際のエラー内容をウィジェット上に表示する診断ビルドを作成（`eas.json`の
  `productionWidgetDiag`プロファイル、診断後は削除済み）
- 診断ビルドで`ReferenceError: Can't find variable: colors`と判明。
  `'widget'`ディレクティブ付き関数は関数本体だけがソース文字列化されクロージャを
  捕捉しないため、`widgets/NowPlayingWidget.tsx`のモジュールスコープに置いていた
  `colors`定数が実行時に解決できていなかった。制約の一般形はCLAUDE.mdに記録
- 対処：`colors`を`NowPlayingWidget`関数の中（`'widget';`の直後）へ移動。
  babel-preset-expoのwidgets-pluginで実際に変換し、生成される関数文字列に
  `colors`の定義が含まれることを確認済み。`containerBackground`＋`background()`の
  修正（iOS 17未満対応）は、このReferenceErrorとは独立した別の不具合として
  そのまま維持
- 次のビルド（本番プロファイル）で、このReferenceError修正後に実機で正しく
  表示されるかが最終確認事項

**実機確認完了（2026-09-30）**：`eas build --local --profile production`でローカル署名
ビルドを作成し、`eas submit -p ios --path <ipa> --profile production`でTestFlightへ
アップロード。iPhone 8はこのMac（M4 MacBook Air）とXcode経由で直接ペアリングできない
ため、ad-hoc配布やローカルインストールは行わず、TestFlightアプリ経由での
インストールに最初から切り替えた。
iPhone 8で表示・タップ（アプリが開く）・idle状態（時間経過後もアートワーク・曲名が
正しいまま）をすべて確認済み。

## ビルド環境

- [x] Expo prebuildでXcodeプロジェクトを生成
- [x] CocoaPodsの依存解決とローカルモジュールの自動リンクを確認
- [x] TypeScript型検査
- [x] i18nキー検査
- [x] EASのXcode 26環境でネイティブビルド
- [x] Apple Developerの署名とProvisioning Profileを設定
- [x] Xcode 27（M4 MacBook Air、ローカル環境）でのSimulatorビルド・起動を確認（2026-09-30）
- [x] Xcode 27でのEASローカルビルド（`eas build --local --profile production`）・実機確認（2026-09-30、TestFlight経由でiPhone 8にて確認）

現在のローカル環境はXcode 27（M4 MacBook Airへ2026-09に移行）。Xcode 27 / iOS 27 SDK
特有の問題として、UISceneライフサイクル未対応による起動直後のクラッシュを実際に確認し、
`plugins/withIosSceneDelegate.js`で対応済み（詳細は`CLAUDE.md`「iOSビルド」参照）。
Simulatorでのdev-client起動・JSバンドル読み込み・アプリ本体表示、および署名付き
ローカルビルド（`eas build --local`）でのビルド・署名・エクスポートまで確認済み。

（旧Mac・Xcode 26.3時点の記録）当時はXcode 26.3の`expo-modules-jsi`ヘッダー
コンパイル不具合により、ローカルの`npx expo run:ios`が通らず、EAS
（Xcode 26.6環境）でのビルド確認に頼っていた。新Mac（Xcode 27）への移行後は
ローカルビルド自体が通るようになったため、この制約は解消済み。

## 広告・課金導入（`feat/revenuecat-admob-ios`）

AdMobバナー広告とRevenueCatによるPro月額購読をAndroidに続いてiOSにも導入
（Android/iOS共通の設計判断は`CLAUDE.md`の「RevenueCat / AdMob（Android/iOS共通）」、
ダッシュボード作業の記録は`docs/private/revenuecat-admob-setup.md`参照）。

- [x] AdMobコンソールでiOSアプリを登録・確認完了
- [x] AdMob iOS用バナー広告ユニットを作成
- [x] 既存のGDPR同意メッセージの対象アプリにiOS版を追加
- [x] App Store Connectでサブスクリプショングループ・月額商品（`pro_monthly`）を作成
- [x] RevenueCatにApp Store Appを追加し、商品をEntitlement `pro`・
      Offering `current`のPackage `$rc_monthly`へ紐付け
- [x] `package.json`のiOSオートリンク除外を解除し、`.ios.ts`no-opスタブを削除して
      共通実装（`src/adInit.ts`・`src/components/AdBanner.tsx`・`src/purchases.ts`）
      に一本化
- [x] `app.json`に`iosAppId`・`skAdNetworkItems`を追加
- [x] `app/settings.tsx`のPro導線をAndroid限定から両OS表示に変更
- [x] `app/pro.tsx`の解約案内文言をストア名で出し分けるよう修正（iOSでGoogle Playを
      案内しないように）
- [x] `npx expo prebuild --clean`でPodの解決を確認（Xcode 27でのdeployment target
      問題は再発せず）
- [x] Simulatorでのdev-client起動確認（テスト広告表示、Pro画面のクラッシュ無し。
      2026-10-02、iPhone 18 Pro Max Simulator。RevenueCat経由の価格取得・
      ストア名の出し分け（「App Storeの『定期購入』から」）も確認済み）
- [x] `eas build --local --profile production`でビルド17（App Version 1.1.1）を
      作成し、`eas submit`でTestFlightへアップロード完了（2026-10-02）。
      ビルドログ上は拡張機能（ExpoWidgetsTarget）とアプリ本体のCFBundleVersionが
      一致しないという警告が出たが、書き出し済みIPAの実際のInfo.plistでは両方
      `17`で一致していることを確認済み（Xcodeのビルド中間段階の一時的な警告で、
      最終成果物には影響なし）
- [x] 実機（TestFlight経由iPhone 8）でのバナー広告表示・Sandbox購入・復元・
      広告非表示化の確認（2026-10-02、ビルド17で確認済み）
- [x] App Store ConnectのApp Privacy（データ収集の申告）を更新（2026-10-02。
      内容は`docs/ios-app-store-listing.md`参照）
- [ ] サブスクリプションの審査用スクリーンショットを追加（Pro画面の実装後）

## App Store Connect

- [x] App Store ConnectでBundle ID `com.yskms.retracks` のアプリを作成
- [x] App Store Connect Apple ID `6811712770` をEAS提出設定へ登録
- [x] Appleの静的解析で要求された写真ライブラリ利用目的文を追加
- [x] プライバシーポリシーとサポートURLを準備
- [x] App Privacy（収集データなし）を回答
- [x] iPhone用スクリーンショットと説明文を準備（初回リリースでは未実装のiOSウィジェットを記載しない。`docs/ios-app-store-listing.md`）
- [x] App Store掲載文ではAndroid限定の「通知」「指定フォルダ除外」「ホーム画面ウィジェット」を記載しない（`docs/ios-app-store-listing.md`で確認済み）
- [x] ビルド7をTestFlightで実機確認（ビルド4はITMS-90683、ビルド5・6は実機修正確認用）
- [x] 一覧・プレイヤー・ロック画面のアートワーク表示を確認
- [x] 実機テスト完了後に審査へ提出（2026-09-15、ビルド7・App Version 1.0.0。詳細は`docs/ios-app-store-listing.md`）
