import { Component, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import i18next from '../i18n';
import { colors } from '../theme';
import { recordCrash } from '../crashLog';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * JSのレンダー中に出た例外を最後に受け止める砦（要件 13章「安定性向上」）。
 *
 * これがこれまで1つも無かった。つまりどこか1画面のレンダーで例外が出た瞬間、
 * アプリ全体が落ちていた。開発中は赤画面が出るので気づけるが、リリース
 * ビルドでは何も表示されずに終了し、原因もどこにも残らない。
 *
 * app/_layout.tsx の一番外側（GestureHandlerRootView より外）に置くこと。
 * SettingsProvider/PlaybackProvider 自体が投げた場合も拾う必要があるため、
 * それらの内側からは効かない。そのため i18n も useTranslation() ではなく
 * i18next.t() を直接使っている（i18next 自体は React の外で初期化される
 * ので、Provider が壊れていてもフォールバック表示は出せる → src/i18n/index.ts）。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    recordCrash({
      timestamp: Date.now(),
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
    }).catch(() => {
      // ログの保存に失敗しても、フォールバックUIの表示自体は続ける
    });
  }

  private retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <View style={styles.root}>
        <Text style={styles.title}>{i18next.t('errorBoundary.title')}</Text>
        <Text style={styles.message}>{i18next.t('errorBoundary.message')}</Text>
        <Pressable style={styles.button} onPress={this.retry}>
          <Text style={styles.buttonText}>{i18next.t('errorBoundary.retry')}</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  message: { color: colors.textDim, fontSize: 14, textAlign: 'center' },
  button: {
    backgroundColor: colors.accent,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  buttonText: { color: '#1a1206', fontSize: 14, fontWeight: '700' },
});
