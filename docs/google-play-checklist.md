# Google Play 公開チェックリスト（1.0.0）

## 使用するURL

- Webサイト: `https://yskms.github.io/retracks/`（2026-09-27、Play Console側で
  変更済み。旧: `https://github.com/yskms/retracks`。AdMobのapp-ads.txt確認で
  判明: `app-ads.txt`はドメインの**真のルート**（`https://yskms.github.io/app-ads.txt`。
  `yskms.github.io`というユーザーページ用の別リポジトリで公開・Google側で
  検証済み）しか見られない。旧URLの`github.com`は自分でファイルを置けないため
  一致しなかった。`yskms.github.io`配下のURLに変更したことで、既存の検証済み
  app-ads.txtがそのまま使える）
- プライバシーポリシー: `https://yskms.github.io/retracks/privacy-policy.html`
- サポート: `https://github.com/yskms/retracks/issues`

GitHub Pagesを`main`ブランチの`/docs`から公開し、プライバシーポリシーURLがログインなし・地域制限なしで表示できることを確認してからPlay Consoleへ入力する。

2026-09-13にGitHub Pagesでの公開とHTTP 200応答を確認済み。

## ストアの設定

- アプリ名: `RE:TR4CKS Music Player`
- 既定の言語: 英語（アメリカ合衆国、`en-US`）
- アプリ／ゲーム: アプリ
- カテゴリ: 音楽＆オーディオ
- 価格: 無料（Android版はアプリ内課金あり。Pro月額購読で広告を非表示化）
- 連絡先メール: `yskms.studio@gmail.com`
- Webサイト、プライバシーポリシー、サポートURL: 上記URLを使用
- ストア掲載文とリリースノート: `docs/google-play-listing.md`から転記
- 512pxアイコン: `docs/google-play-assets/app-icon-512.png`
- 1024×500pxフィーチャーグラフィック: `docs/google-play-assets/feature-graphic-1024x500.png`
- スクリーンショット: `docs/google-play-assets/screenshots/`（楽曲名やアートワークを含むためGit管理外）

## App content 回答案

実際のPlay Consoleの質問文が変わった場合は、アプリの実装を正として回答する。

- プライバシーポリシー: 上記URL
- 広告: **はい**（AdMobによるバナー広告。RevenueCatのPro購読で非表示にできる）
- アプリ内購入: **あり**（Pro月額購読。`docs/revenuecat-admob-setup.md`参照）
- アプリへのアクセス: **すべての機能を特別なアクセスなしで利用可能**（ログインなし）
- 対象年齢: **13～15歳、16～17歳、18歳以上**。子ども向けとして設計・訴求していない
- ニュースアプリ: **いいえ**
- COVID-19接触確認／ステータスアプリ: **いいえ**
- 政府関連アプリ: **いいえ**
- 金融機能: **なし**
- 健康関連機能: **なし**
- 広告ID: **使用する**（AD_IDパーミッション自体は`blockedPermissions`で除去し取得しないが、AdMob SDKが別途広告配信・不正防止目的の識別子相当の情報を扱うため、Play Consoleの「広告ID」設問には実装に即して回答すること）
- フォアグラウンドサービス: **メディアの再生**。バックグラウンド再生と通知・ロック画面・イヤホン操作のため
- コンテンツレーティング: アプリ（ゲームではない）。暴力、性的表現、恐怖、ギャンブル、薬物、差別的表現、ユーザー間交流、オンラインコンテンツ購入はアプリ自体に含まれない。端末内の音楽はユーザーが用意し、他ユーザーへ共有されない

## Data safety 回答案

> 2026-09-26追記: `feat/revenuecat-admob-android`でAdMob・RevenueCatを導入したため、
> 以下の1.0.0時点の回答はそのままでは使えない。実際にPlay Consoleへ入力する前に、
> AdMob・RevenueCat双方の最新のデータ収集開示（各社のヘルプセンター記載内容）を
> 確認し、下記を実装に合わせて書き直すこと。

- アプリは必須のユーザーデータ種類を収集または共有しますか: **はい**
- 端末外へ送信するデータ:
  - 広告識別子相当の情報、大まかな位置情報、端末情報 → Google（AdMob）。広告配信・不正防止目的
  - 購入履歴、匿名のアプリ内識別子 → RevenueCat。購読の判定・復元目的
- 第三者と共有するデータ: 上記2社（Google、RevenueCat）。ユーザーデータの販売は行わない
- ローカルでのみ処理するデータ: 端末内音楽ファイルとメタデータ、設定、ライブラリキャッシュ、再生キュー、シャッフル進捗、再生位置、アプリ内エラー履歴
- アカウント作成: なし（RevenueCatの識別子はアプリ内で自動生成される匿名IDで、氏名・メールアドレス等は含まない）
- データ削除: アプリ内の「保存を消去」、Androidのストレージ消去、またはアンインストール

## AABとリリース

- パッケージ名: `com.yskms.retracks`
- バージョン: `1.0.0`
- versionCode: `2`（開発者向け画面を製品ビルドから遮断した差し替え版）
- AAB: `android/app/build/outputs/bundle/release/app-release.aab`
- 署名: 自前アップロード鍵 `CN=RE:TR4CKS`（鍵とパスワードはリポジトリ外で保管）
- まず内部テストへAABを登録し、Play配信版を実機インストールして起動・権限・走査・再生・通知を確認
- 問題がなければ必要な公開要件を満たしたトラックへ昇格
- 公開前にGitのコミット、push、`v1.0.0`タグ、GitHub Releaseを作成

## 公開直前の手動確認

- GitHub PagesのプライバシーポリシーURLが公開されている
- Play Consoleの開発者名と、プライバシーポリシー記載の提供者名`yskms`が一致する。異なる場合はポリシー側を正式名へ修正
- 連絡先メールを入力し、公開して問題ないアドレスであることを確認
- スクリーンショット内に個人情報、通知、実在する私的な音楽ライブラリ情報が写っていない
- Data safetyと実装が一致している
- App contentの必須項目がすべて完了している
- Play App Signingを有効化し、`release.jks`を別媒体にもバックアップしている
- AABのversionCodeが過去に未使用である
- 審査提出前にリリース概要と対象国・地域を最終確認する
- **`app.json`の`androidAppId`がGoogle公式のテストアプリID
  （`ca-app-pub-3940256099942544~3347511713`）のままになっていない**（実際のAdMob
  アプリIDに差し替え済み）。テストIDのままでも本番ビルドは正常に動作してテスト広告を
  配信し続けてしまうため、エラーで気づけない。`src/adConfig.ts`の本番用`AD_UNIT_ID`・
  `src/purchasesConfig.ts`のRevenueCat APIキーも同様に実際の値へ差し替え済みか確認する
  （`docs/revenuecat-admob-setup.md`参照）

## Google Play提出状況

- 内部テスト: Playストアからのダウンロードを確認済み
- 製品版: `2 (1.0.0)` を審査提出済み（versionCode `1`から差し替え）
- 配信地域: 176か国・地域およびその他の国
- 管理対象の公開: オフ（審査承認後に自動公開）
- 審査提出日: 2026-09-13
- R8 / ProGuard: 未使用。難読化解除ファイルなしの警告は対応不要
