# RE:TR4CKS 1.0.0 リリース候補

- 作成日: 2026-09-12
- package: `com.yskms.retracks`
- versionName: `1.0.0`
- versionCode: `1`
- targetSdkVersion: `36`
- 署名証明書: `CN=RE:TR4CKS, OU=Development, O=RE:TR4CKS, L=Unknown, ST=Unknown, C=JP`
- 証明書SHA-256: `52f31b98bd4aede0673a9dcd950609e5cb9234731dc5bd261648057c0b3bd63a`

## 成果物

| 用途 | ローカルパス | サイズ | SHA-256 |
|---|---|---:|---|
| Google Play | `android/app/build/outputs/bundle/release/app-release.aab` | 77,352,197 bytes | `d2e65c6a4cac3f8bd45d2582bd5349bcd5279f9a292705b0441e4d3a1d0dca60` |
| 直接配布／実機確認 | `android/app/build/outputs/apk/release/app-release.apk` | 110,268,332 bytes | `a494f38a9649d449996dade70d92a7d6b3ce767aaf53960c98538a89fcc20da7` |

ビルド成果物と署名鍵はGit管理外。成果物を作り直すとハッシュは変わり得るため、その場合は本書も更新する。

## 検証

- `./gradlew assembleRelease bundleRelease`: 成功
- APK Signature Scheme v2: 検証成功
- AAB JAR署名: 検証成功
- `SYSTEM_ALERT_WINDOW`: release統合Manifestに存在しない
- 必要権限: `READ_MEDIA_AUDIO`、`POST_NOTIFICATIONS`、`FOREGROUND_SERVICE`、`FOREGROUND_SERVICE_MEDIA_PLAYBACK`
- Pixel 11 / Android 17: 署名済みrelease APKのインストール、Metroなしの起動、ライブラリ走査、再生、設定画面のプライバシーポリシー導線を確認
- TypeScript・i18nキー整合・Gradle lintVital: 合格
