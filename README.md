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

Expo SDK 57 / React Native 0.86。ネイティブモジュールを含むため **Expo Go では動かない**（development build が必要）。

```bash
npm install

# development build を作る（クラウド。初回は eas init が必要）
eas build --profile development --platform android

# 開発サーバー
npx expo start --dev-client
```

### 現在の状態

技術検証スパイクの段階。`App.tsx` は docs/requirements.md 13.4 の6項目
（区間再生の精度 / フェード品質 / 曲間の無音 / バックグラウンド動作 /
通知の次の曲 / ライブラリ走査速度）を実機で計測するための画面。

## 名前について

| 用途 | 名前 |
|---|---|
| ブランド | RE:TR4CKS |
| ストア名候補 | RE:TR4CKS Music Player |
| 体験コンセプト | RUSH |
| リポジトリ / 内部識別子 | retracks |
| Android application ID | com.yskms.retracks |
