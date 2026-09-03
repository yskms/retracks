# RE:TR4CKS

Offline music player for rediscovering your local music.

> Remember. Replay. Rediscover. Revisit.

[English version](README_EN.md)

## これは何

端末内のローカル音楽ファイルを対象にした Android 向け音楽プレイヤー。
「大量に持っているのに、いつも同じ曲しか聴いていない」を解きほぐすことを狙っている。

軸になる体験は2つ。

### RUSH

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

**開発中。まだリリースしていない。**

再生エンジンとデータ層は動作する状態にあり、これから画面を作り込む段階。
設計の経緯と決定事項は [要件定義書](docs/requirements.md) に集約している。

## 技術的なところ

- **Expo SDK 57 / React Native 0.86**（New Architecture）
- **再生層は自作の Expo モジュール**（Kotlin + Media3）。既存ライブラリでは
  通知・イヤホンからの「次の曲」を満たせなかったため（詳細は要件定義書 13.2）
- 区間の切り出しは `MediaItem.ClippingConfiguration` に委ね、ExoPlayer 自身に
  サンプル単位で切らせている
- Android 専用。ローカルファイルのみで、ネットワークを必要としない

## 開発

ネイティブモジュールを含むため **Expo Go では動かない**。ローカルビルドが必要。

```bash
npm install

# Android SDK が必要（ANDROID_HOME を通しておく）
npx expo run:android
```

### 構成

| | |
|---|---|
| `modules/retracks-player/` | 再生層。ExoPlayer + MediaSessionService |
| `src/rush.ts` | 区間設定の解決（境界処理とフェードのクランプ） |
| `src/shuffle.ts` | シャッフルの順列と1巡状態の永続化 |
| `src/library.ts` | 曲一覧の走査とキャッシュ |
| `docs/requirements.md` | 要件定義書 |

## 名前について

| 用途 | 名前 |
|---|---|
| ブランド | RE:TR4CKS |
| ストア名候補 | RE:TR4CKS Music Player |
| 体験コンセプト | RUSH |
| リポジトリ / 内部識別子 | retracks |

## ライセンス

Copyright (c) 2026 yskms. All rights reserved.

ソースコードは閲覧できる状態にしているが、利用許諾はしていない。
複製・改変・再配布・再公開は許可していない。
