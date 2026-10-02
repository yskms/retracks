# App Store 掲載情報

RE:TR4CKS iOS版のApp Store Connect入力用テキスト。

1.1.0でホーム画面ウィジェット（表示専用）を追加。1.1.1でAdMobバナー広告と
RevenueCatによるPro月額購読（広告非表示）を追加。通知操作、指定フォルダ除外は
Android限定の機能のため、引き続き掲載文へ含めない。

## 共通設定

- アプリ名: `RE:TR4CKS Music Player`
- サポートURL: `https://yskms.github.io/retracks/`
- マーケティングURL: `https://yskms.github.io/retracks/`
- プライバシーポリシーURL（英語・日本語共通）: `https://yskms.github.io/retracks/privacy-policy.html`
- バージョン: `1.1.1`
- 著作権: `2026 yskms`
- ビルド: `17`（App Version `1.1.1`、2026-10-02 `eas build --local` → `eas submit`でTestFlightへアップロード）
- サインインが必要: いいえ
- リリース方法: 手動リリース
- 価格: 無料（アプリ内課金あり: Pro月額購読）
- 配信方法: 公開
- 配信地域: 175か国または地域
- Appleシリコン搭載Macでの配信: なし
- Apple Vision Proでの配信: なし
- 年齢制限指定: `4+`（上書きなし、年齢適合性URLなし）
- データ収集: あり（6種類、いずれもユーザに関連付けないデータとして申告済み、
  2026-10-02）。姉妹アプリfiltoの既存申告（同じAdMob＋RevenueCat構成）に倣った内容。

  | カテゴリ | データタイプ | 用途 |
  |---|---|---|
  | ID | デバイスID | サードパーティ広告、アプリの機能 |
  | 購入 | 購入履歴 | アナリティクス、アプリの機能 |
  | 使用状況データ | 製品の操作 | サードパーティ広告、アプリの機能 |
  | 使用状況データ | 広告データ | アプリの機能、サードパーティ広告 |
  | 診断 | クラッシュデータ | アプリの機能 |
  | 診断 | パフォーマンスデータ | アプリの機能 |

  クラッシュデータ・パフォーマンスデータはアプリ自体ではなくGoogle Mobile Ads SDKが
  収集するもの。いずれもトラッキングには使用しない（ATT/IDFA不使用）
- ユーザプライバシー選択URL: なし
- コンテンツ配信権: ユーザーのメディアライブラリにある第三者コンテンツへアクセスするため「はい」。必要な権利・許可があることを確認
- 使用許諾契約: Appleの標準使用許諾契約
- カテゴリ: ミュージック（セカンダリなし）
- ルーティングアプリカバレッジファイル: なし
- App Clip: なし
- iMessageアプリ: なし
- App Storeサーバ通知URL: なし
- Sandboxサーバ通知URL: なし
- 審査状況: 1.1.1（ビルド17）を審査へ提出済み（2026-10-02 10:37、提出ID
  `aaa2fb11-5d65-4b9d-a3f1-a81d8125279d`）。アプリバージョン・サブスクリプション
  `Pro Monthly`・サブスクリプショングループ`RE:TR4CKS Pro`の3項目がまとめて
  審査待ち。実機（iPhone 8、TestFlight経由）でのバナー広告表示・Sandbox購入・
  復元・広告非表示化は確認済み。1.1.0はTestFlightへのアップロードのみ
  （2026-09-30、ビルド16。ビルド15はローカルビルド後のsubmitが完了せず欠番）で、
  広告・Pro購読を同時に含めるため審査提出せず1.1.1へまとめた
- 前回申請（1.0.0・ビルド7）: 申請済み・承認済み（2026-09-15）

## English (U.S.)

### Subtitle

```text
Rediscover Your Music
```

### Promotional text

上限170文字以内。

```text
Rediscover the music you already own. Move through forgotten tracks with adjustable Medley playback and a non-repeating shuffle.
```

### What's New in This Version

正確には1.1.0のウィジェットと1.1.1の広告/Proをまとめて1.1.1として公開する予定
（1.1.0は審査未提出のため、公開版のユーザーから見るとこの2つが同時に「新機能」になる）。

```text
Added a home-screen widget that shows the currently playing track.
Added a banner ad in the free tier. A new Pro monthly subscription removes ads.
```

### Description

```text
Rediscover your music with Medley playback.

RE:TR4CKS is an offline music player that plays selected portions of your tracks one after another, helping you quickly rediscover forgotten music already in your library.

Old favorites. Deep cuts from albums you used to love. Tracks you forgot were even in your library. Even with a large music collection, it's easy to end up listening to the same familiar songs again and again.

With Medley mode, you choose where playback starts and how long each track plays. RE:TR4CKS then moves through your shuffled music automatically, letting you revisit more of your collection in less time.

When something catches your attention, switch to normal playback and enjoy the full song.

RE:TR4CKS isn't about finding new music. It's about rediscovering the music you already have.

Key features

• Offline playback of music available in your device’s media library
• Medley playback with adjustable start position, playback duration, fade-in, and fade-out
• Non-repeating shuffle that plays every track before starting another pass
• Shuffle progress is preserved, so you can listen to something else and return where you left off
• Switch between normal and Medley playback
• Browse and search by song, artist, and album
• Sorting and filters for short tracks and non-music audio
• Background playback and lock-screen controls
• Home-screen widget showing the currently playing track
• Japanese and English interface

Everything stays on your device

Your music and listening activity are never sent off your device. RE:TR4CKS has no account registration, analytics, tracking, or cloud synchronization. Everything runs locally on your device.

The App is free to use, with a banner ad shown in the free tier. Pro (monthly subscription) removes ads.

Music is not included. You need compatible music available in your device’s media library that you have the right to play.
```

### Keywords

86バイト。上限100バイト以内。

```text
offline,medley,shuffle,local library,album,artist,background playback,rediscover,audio
```

### Screenshots

- 6.9インチ: `docs/private/app-store-assets/en-US/`
- 6.5インチ: `docs/private/app-store-assets/en-US-6.5/`

## 日本語

### サブタイトル

```text
手持ちの音楽を再発見
```

### プロモーション用テキスト

上限170文字以内。

```text
手持ちの音楽を、もう一度。曲の一部分を次々と聴くメドレー再生と重複しないシャッフルで、忘れていた曲との再会を楽しめます。
```

### このバージョンの新機能

```text
現在再生中の曲を表示するホーム画面ウィジェットを追加しました。
無料版にバナー広告を追加しました。Pro（月額購読）で広告を非表示にできます。
```

### 概要

```text
手持ちの音楽を、メドレーでもう一度。

RE:TR4CKSは、曲の好きな部分を一定時間ずつ次々と再生する「メドレー」機能で、忘れていた音楽との再会を楽しむオフライン音楽プレイヤーです。

昔よく聴いたアルバムの一曲、好きだったアーティストの隠れた曲、存在すら忘れていた曲。たくさんの音楽を持っていても、いつの間にか聴く曲はいつも同じになりがちです。

メドレーでは、「20秒から60秒間」のように再生する位置と長さを指定し、シャッフルした曲をテンポよく聴いていけます。

主な機能

・端末のメディアライブラリで利用できる音楽をオフライン再生
・曲の開始位置、再生時間、フェードイン／フェードアウトを指定できるメドレー再生
・全曲を聴き終えるまで同じ曲を繰り返さないシャッフル
・シャッフルの進行状況を保持し、途中で別の曲を聴いても続きから再開
・通常再生とメドレー再生の切り替え
・楽曲、アーティスト、アルバムから検索・再生
・短い曲や音楽以外の音声を対象にした並べ替えとフィルター
・バックグラウンド再生とロック画面操作
・現在再生中の曲を表示するホーム画面ウィジェット
・日本語／英語表示

すべて端末内で完結

音楽や再生状況を端末の外部へ送信することはありません。アカウント登録、アクセス解析、トラッキング、クラウド同期はなく、すべて端末内で動作します。

本アプリは無料でご利用いただけます（バナー広告表示）。Pro（月額購読）で広告を非表示にできます。

本アプリに音楽は含まれません。ユーザー自身が再生する権利を持ち、端末のメディアライブラリで利用できる対応楽曲が必要です。
```

### キーワード

UTF-8で78バイト。上限100バイト以内。

```text
音楽,オフライン,メドレー,シャッフル,楽曲,アルバム,再生
```

### スクリーンショット

- 6.9インチ: `docs/private/app-store-assets/ja-JP/`
- 6.5インチ: `docs/private/app-store-assets/ja-JP-6.5/`

## App Reviewに関する情報

### 連絡先

- 名: `masashi`
- 姓: `yasaka`
- 電話番号: App Store Connectに登録した国際形式の番号
- メール: `masashi.yasaka@gmail.com`

### メモ

```text
RE:TR4CKS is an offline music player designed around a specific listening experience: rediscovering music already available in the user’s media library.

Users with large personal music libraries often return to the same familiar tracks while older album tracks and forgotten music remain untouched. RE:TR4CKS is designed to bring those tracks back into rotation.

Its primary differentiating feature is Medley mode. The user can choose a start position and playback duration—for example, starting 20 seconds into each track and playing for 60 seconds—together with fade-in and fade-out settings. The app plays the configured portion and then automatically advances to the next track, allowing more of a personal library to be revisited in a shorter time.

The shuffle system supports this experience by avoiding repeats until the current pass is complete. Shuffle progress is preserved, so the user can temporarily play a specific song and later return to the previous shuffle session. Normal full-track playback remains available at any time.

No account or sign-in is required. The app contains no music and provides no streaming service. It plays compatible music already available in the device’s media library.

To test the primary experience:
1. Launch RE:TR4CKS and allow access to the media library.
2. Select a track from Songs, Artists, or Albums.
3. Start shuffle playback.
4. Open the player and enable Medley mode.
5. Adjust the start position, playback duration, fade-in, and fade-out.
6. Verify that playback automatically advances after the configured duration.
7. Select another song manually, then return to the shuffle session to verify that its progress is preserved.
8. Lock the device to verify background playback and lock-screen controls.
9. Open Settings > Pro to view the subscription offer and (optionally, using a Sandbox Apple ID) complete a purchase to verify that the banner ad disappears.

IMPORTANT FOR REVIEW:
Because RE:TR4CKS plays music from the device media library and does not include or download music, a review device with no compatible music may show an empty library.

A screen recording demonstrating the primary experience is attached.

The app does not include streaming, analytics, tracking, cloud synchronization, or accounts. The free tier shows a non-personalized banner ad (Google AdMob); a Pro monthly auto-renewable subscription (RevenueCat) removes it. The Pro screen is reachable from Settings. To test the subscription without a real charge, please use a Sandbox Apple ID (Settings > App Store > Sandbox Account on the review device, or App Store Connect > Users and Access > Sandbox Testers).

Photo Library APIs are referenced by an included image-processing library. RE:TR4CKS does not provide a photo picker and does not upload photos or music.
```

実機操作の画面収録 `RPReplay_Final1789391595.mp4` を審査用添付ファイルとして使用する。
