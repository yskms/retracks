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
- [ ] EASビルド→実機（iPhone 8 または他の確認済み実機）でホーム画面に追加し表示・タップ・idle状態を確認
- [ ] App Store掲載文・スクリーンショットからホーム画面ウィジェット除外の記載を外す（次回アップデート申請時）

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

## ビルド環境

- [x] Expo prebuildでXcodeプロジェクトを生成
- [x] CocoaPodsの依存解決とローカルモジュールの自動リンクを確認
- [x] TypeScript型検査
- [x] i18nキー検査
- [x] EASのXcode 26環境でネイティブビルド
- [x] Apple Developerの署名とProvisioning Profileを設定
- [x] Xcode 27（M4 MacBook Air、ローカル環境）でのSimulatorビルド・起動を確認（2026-09-30）
- [ ] Xcode 27でのEASローカルビルド（`eas build --local`）・実機確認

現在のローカル環境はXcode 27（M4 MacBook Airへ2026-09に移行）。Xcode 27 / iOS 27 SDK
特有の問題として、UISceneライフサイクル未対応による起動直後のクラッシュを実際に確認し、
`plugins/withIosSceneDelegate.js`で対応済み（詳細は`CLAUDE.md`「iOSビルド」参照）。
Simulatorでのdev-client起動・JSバンドル読み込み・アプリ本体表示まで確認済みだが、
署名付きのローカルビルド（`eas build --local`）・実機での確認はまだ行っていない。

（旧Mac・Xcode 26.3時点の記録）当時はXcode 26.3の`expo-modules-jsi`ヘッダー
コンパイル不具合により、ローカルの`npx expo run:ios`が通らず、EAS
（Xcode 26.6環境）でのビルド確認に頼っていた。新Mac（Xcode 27）への移行後は
ローカルビルド自体が通るようになったため、この制約は解消済み。

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
