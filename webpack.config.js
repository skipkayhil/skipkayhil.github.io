const path = require("path");

const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const HTMLWebpackPlugin = require("html-webpack-plugin");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");

const PnpWebpackPlugin = require(`pnp-webpack-plugin`);

module.exports = {
  mode: process.env.NODE_ENV || "production",
  devtool: "source-map",
  entry: "./src/index.js",
  output: {
    filename: "app.[chunkhash:8].js",
    path: path.resolve(__dirname, "build"),
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        include: path.resolve(__dirname, "src"),
        loader: require.resolve("babel-loader"),
      },
      {
        test: /\.css$/,
        use: [
          {
            loader: MiniCssExtractPlugin.loader,
            options: {
              hmr: process.env.NODE_ENV === "development",
            },
          },
          {
            loader: require.resolve("css-loader"),
            options: {
              importLoaders: 1,
            },
          },
          {
            loader: require.resolve("postcss-loader"),
            options: {
              postcssOptions: {
                plugins: [require.resolve("cssnano")],
              },
            },
          },
        ],
      },
    ],
  },
  plugins: [
    new HTMLWebpackPlugin({ template: "src/index.html" }),
    new MiniCssExtractPlugin({ filename: "[name].[hash:8].css" }),
    new CleanWebpackPlugin({
      // ignore .git in build folder to keep the git worktree
      cleanOnceBeforeBuildPatterns: ["**/*", "!.git"],
    }),
  ],
  resolve: {
    plugins: [PnpWebpackPlugin],
  },
  resolveLoader: {
    plugins: [PnpWebpackPlugin.moduleLoader(module)],
  },
  // These settings will always be false in Webpack 5
  node: {
    Buffer: false,
    process: false,
  },
};
