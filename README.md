# RE:TR4CKS

Offline music player for rediscovering your local music.

> Remember. Replay. Rediscover. Revisit.

## これは何

端末内のローカル音楽ファイルを対象にした Android 向け音楽プレイヤー。
2つの体験を軸にしている。

- **RUSH** — 曲の一部だけを次々に再生して、忘れていた曲に出会い直す
- **一巡するシャッフル** — シャッフルの順序を永続化し、「同じ曲ばかり流れて大半が一生再生されない」状態を解消する

普通の音楽プレイヤーとしても使えることを前提とする。

## ドキュメント

- [要件定義書](docs/requirements.md)

## 開発

Expo SDK 57 / React Native 0.86。再生層は `modules/retracks-player`（Kotlin + Media3）に
自前実装しているため、**Expo Go では動かない**。ローカルビルドが必要。

```bash
npm install

# Android SDK が必要（Android Studio を入れて ANDROID_HOME を通す）
npx expo run:android
```

### 構成

| | |
|---|---|
| `modules/retracks-player/` | 再生層。ExoPlayer + MediaSessionService。区間再生・フェード・通知/イヤホン操作 |
| `src/rush.ts` | 区間設定の解決（境界処理とフェードのクランプ）。Kotlin 側 `SegmentController` と同じ規則 |
| `App.tsx` | 技術検証スパイクの画面 |
| `docs/requirements.md` | 要件定義書 |

### 現在の状態

技術検証スパイクの段階。docs/requirements.md 13.4 の6項目を実機で確認するところ。
**Kotlin はまだ一度もコンパイルしていない**（Android SDK 未導入のため）。

## 名前について

| 用途 | 名前 |
|---|---|
| ブランド | RE:TR4CKS |
| ストア名候補 | RE:TR4CKS Music Player |
| 体験コンセプト | RUSH |
| リポジトリ / 内部識別子 | retracks |
| Android application ID | com.yskms.retracks |
