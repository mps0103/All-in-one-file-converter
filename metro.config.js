const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

const config = {
  resolver: {
    extraNodeModules: {
      stream: require.resolve('readable-stream'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
