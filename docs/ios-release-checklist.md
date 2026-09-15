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

## ビルド環境

- [x] Expo prebuildでXcodeプロジェクトを生成
- [x] CocoaPodsの依存解決とローカルモジュールの自動リンクを確認
- [x] TypeScript型検査
- [x] i18nキー検査
- [x] EASのXcode 26環境でネイティブビルド
- [x] Apple Developerの署名とProvisioning Profileを設定

現在のローカル環境はXcode 16.2（Swift 6.0）。依存するExpoModulesJSIが
Swift tools 6.2を要求するため、アプリのコンパイル前にツールチェーン更新が必要。

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
