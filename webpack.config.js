import { resolve as _resolve } from 'path';
import TerserPlugin from 'terser-webpack-plugin';

const sourceRoot = _resolve('.', 'src').replace(/\\/g, '/');

const serverConfig = {
    devtool: 'source-map',
    target: 'browserslist',
    entry: './src/index.ts',
    output: {
        path: _resolve('.', 'dist'),
        filename: 'index.js',
        libraryTarget: 'module',
        libraryExport: 'default',
    },
    resolve: {
        extensions: ['.ts', '.js'],
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
        const normalizedContext = String(context ?? '').replace(/\\/g, '/');
        const isFromSource = normalizedContext === sourceRoot || normalizedContext.startsWith(`${sourceRoot}/`);

        if (request.startsWith('../../')) {
            if (isFromSource) {
                return callback(null, request);
            }
            return callback();
        }

        if (request.includes('libs/')) {
            return callback(null, request);
        }

        if (request.startsWith('https://') || request.startsWith('http://')) {
            return callback(null, request);
        }

        callback();
    },
};

export default [serverConfig];
