module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated plugin moved; keep it LAST
    plugins: ['react-native-worklets/plugin'],
  };
};
