module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 4 系はワークレット変換にこのプラグインが必要
    plugins: ['react-native-worklets/plugin'],
  };
};
