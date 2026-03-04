import { resolve as _resolve } from 'path';
import TerserPlugin from 'terser-webpack-plugin';
import { VueLoaderPlugin } from 'vue-loader';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import HtmlInlineScriptPlugin from 'html-inline-script-webpack-plugin';

const serverConfig = {
    devtool: 'source-map',
    target: 'browserslist',
    entry: './src/native.ts',
    output: {
        path: _resolve('.', 'dist'),
        filename: 'index.js',
        chunkFilename: '[name].worker.js',
        libraryTarget: 'module',
        libraryExport: 'default',
        publicPath: '/scripts/extensions/third-party/ST-AdditionalGeneration/dist/',
    },
    resolve: {
        extensions: ['.ts', '.js'],
        alias: {
            '/settings': _resolve('.', 'src/settings.ts'),
        },
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: [
                    {
                        loader: 'babel-loader',
                        options: {
                            sourceMaps: true,
                        },
                    }
                ],
                exclude: /node_modules/,
            },
            {
                test: /\.js/,
                exclude: /node_modules/,
                options: {
                    cacheDirectory: true,
                    presets: [
                        ['@babel/preset-env', { "modules": false }],
                    ],
                    sourceMaps: true,
                },
                loader: 'babel-loader',
            },
        ],
    },
    experiments: {
        outputModule: true,
    },
    optimization: {
        minimizer: [
            new TerserPlugin({
                extractComments: false,
                terserOptions: {
                    format: {
                        comments: false,
                    },
                },
            }),
        ],
    },
    plugins: [],
    externals: function({ context, request }, callback) {
        if (request.startsWith('../../') || request.includes('libs/')) {
            if(context.search(/(\/|\\)src\1/) > 0)
                return callback(null, request.substring(3));
            return callback(null, request);
        } else if(request.startsWith('https://') || request.startsWith('http://')) {
            return callback(null, request);
        }
        callback();
    },
};

// Vue UI 构建配置 - 输出单个 HTML 文件
const uiConfig = {
    devtool: false,
    target: 'web',
    entry: './src/ui/index.ts',
    output: {
        path: _resolve('.', 'dist'),
        filename: 'ui-settings.js',
    },
    resolve: {
        extensions: ['.ts', '.js', '.vue'],
        alias: {
            '@': _resolve('.', 'src/ui'),
            '/settings': _resolve('.', 'src/settings.ts'),
        },
    },
    module: {
        rules: [
            {
                test: /\.vue$/,
                loader: 'vue-loader',
            },
            {
                test: /\.ts$/,
                loader: 'ts-loader',
                exclude: /node_modules/,
                options: {
                    appendTsSuffixTo: [/\.vue$/],
                },
            },
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader'],
            },
        ],
    },
    optimization: {
        minimizer: [
            new TerserPlugin({
                extractComments: false,
                terserOptions: {
                    format: {
                        comments: false,
                    },
                },
            }),
        ],
    },
    plugins: [
        new VueLoaderPlugin(),
        new HtmlWebpackPlugin({
            template: './src/ui/template.html',
            filename: 'settings-ui.html',
            inject: 'body',
            minify: {
                collapseWhitespace: true,
                removeComments: true,
            },
        }),
        new HtmlInlineScriptPlugin(),
    ],
};

export default [serverConfig, uiConfig];
