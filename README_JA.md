# RE:TR4CKS

![RE:TR4CKS](docs/google-play-assets/feature-graphic-1024x500.png)

手持ちの音楽を、もう一度見つけるためのオフライン音楽プレイヤー。

> Remember. Replay. Rediscover. Revisit.

[English version](README.md)

## アプリ

<p>
  <a href="https://apps.apple.com/jp/app/re-tr4cks-music-player/id6811712770"><img src="https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg" height="40" alt="Download on the App Store" align="middle" /></a>
  &nbsp;
  <a href="https://play.google.com/store/apps/details?id=com.yskms.retracks"><img src="https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png" height="60" alt="Get it on Google Play" align="middle" /></a>
</p>

## RE:TR4CKSとは

端末内のローカル音楽を対象にした Android / iOS 向け音楽プレイヤー。
「大量に持っているのに、いつも同じ曲しか聴いていない」を解きほぐすことを狙っている。

軸になる体験は2つ。

### メドレー

曲の一部だけを次々に再生して、忘れていた曲に出会い直すモード。
再生開始位置・再生時間・フェードを指定でき、区間が終わると自動で次の曲へ送る。
OFF にすれば普通の音楽プレイヤーとして使える。

### 一巡するシャッフル

シャッフルの順列と再生位置を永続化する。

普通のプレイヤーでシャッフルすると、アプリを閉じるたびに順列が引き直される。
1000曲入っていても1回のセッションで聴くのは数十曲なので、毎回「新しい順列の先頭数十曲」
しか聴かないまま終わり、大半の曲が一生再生されない。

順列と現在位置を保存し、1巡し切るまで既再生曲を出さないことでこれを解消する。
ライブラリに曲を足したときは、未消化の部分にランダムに差し込む。

## 状態

**Android / iOSともに公開中。**

設計の経緯と決定事項は [要件定義書](docs/requirements.md) に集約している。
開発の流れと現在地は [開発履歴](docs/development-history.md) に短くまとめている。
プライバシーに関する説明は[プライバシーポリシー](docs/privacy-policy.md)を参照。

## 技術的なところ

- **Expo SDK 57 / React Native 0.86**（New Architecture）
- **再生層は自作の Expo モジュール** — Android: Kotlin + Media3、iOS: Swift +
  `AVPlayer`/`MPMediaQuery`。区間再生（メドレー）や一巡するシャッフルを前提にした
  既製プレイヤーはそもそも無く、Androidに限っても既存のクロスプラットフォーム
  ライブラリでは通知・イヤホンからの「次の曲」を満たせなかった：`expo-audio`
  はこれらのMediaSessionコマンドを明示的に無効化しており、
  `react-native-track-player` v4はRN 0.85でのブリッジ互換レイヤー削除以降
  動作せず、v5は商用ライセンス（詳細は要件定義書 13.2）
- （Android）区間の切り出しは `MediaItem.ClippingConfiguration` に委ね、ExoPlayer
  自身にサンプル単位で切らせている。フェードは音声の書き込み先行分を補正する
  必要があり、`player.volume` は今まさに聴こえている位置ではなくこれから
  書き込まれるサンプルに効くため、少し先読みした位置からゲインを計算している
- （iOS）`AVPlayer.addPeriodicTimeObserver`（50ms間隔）で再生位置を監視し、
  区間の終了とフェードを制御している
- 再生対象は端末内のローカル音楽のみ

## 開発

ネイティブモジュールを含むため **Expo Go では動かない**。ローカルビルドが必要。

```bash
npm install

# Android: Android SDK が必要（ANDROID_HOME を通しておく）
npx expo run:android

# iOS: Xcode が必要
npx expo run:ios
```

### 構成

| | |
|---|---|
| `modules/retracks-player/` | 再生層。Android: ExoPlayer + MediaSessionService。iOS: AVPlayer + MPNowPlayingInfoCenter/MPRemoteCommandCenter |
| `src/rush.ts` | メドレーの区間設定の解決（境界処理とフェードのクランプ） |
| `src/shuffle.ts` | シャッフルの順列と1巡状態の永続化 |
| `src/library.ts` | 曲一覧の走査とキャッシュ |
| `docs/requirements.md` | 要件定義書 |
| `docs/development-history.md` | マイルストーンとリリース履歴 |
| `docs/README.md` | 公開ドキュメントの案内 |

## 名前について

| 用途 | 名前 |
|---|---|
| ブランド | RE:TR4CKS |
| ストア名 | RE:TR4CKS Music Player |
| 体験コンセプト | メドレー |
| リポジトリ / 内部識別子 | retracks |

## ライセンス

Copyright (c) 2026 yskms. All rights reserved.

ソースコードは閲覧できる状態にしているが、利用許諾はしていない。
複製・改変・再配布・再公開は許可していない。
