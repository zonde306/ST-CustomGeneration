import { resolve as _resolve, relative as _relative, dirname as _dirname, isAbsolute as _isAbsolute } from 'path';
import TerserPlugin from 'terser-webpack-plugin';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = _dirname(__filename);
const ST_PUBLIC_ROOT = _resolve(__dirname, '../../../../');
const EXTENSION_ROOT = _resolve(__dirname); 

const serverConfig = {
    devtool: 'source-map',
    target: 'browserslist',
    entry: './src/index.ts',
    output: {
        path: _resolve('.', 'dist'),
        filename: 'index.js',
        libraryTarget: 'module',
        libraryExport: 'default',
        // 标准化 sourcemap 中的路径，确保不同环境构建产生相同的 sourcemap
        devtoolModuleFilenameTemplate: info => {
            // 使用相对路径，避免不同操作系统的绝对路径差异
            const relativePath = _relative(__dirname, info.absoluteResourcePath);
            // 统一使用正斜杠，避免 Windows 和 Unix 的路径分隔符差异
            return 'webpack:///' + relativePath.replace(/\\/g, '/');
        },
    },
    resolve: {
        extensions: ['.ts', '.js'],
        alias: {
            '@': _resolve(__dirname, 'src'),
        }
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
        // 1. 处理显式的 @st/ 别名
        if (request.startsWith('@st/')) {
            let webPath = request.replace('@st/', '/');
            // 修复文件后缀
            if(!webPath.endsWith('.js'))
                webPath += '.js';
            return callback(null, `module ${webPath}`);
        }

        // 2. 如果是普通的第三方库导入（不以 . 开头），比如 import 'yaml'
        // 或者路径就在本插件目录之内（包括 node_modules 和 src）
        // 这些都需要打包
        if (!request.startsWith('.') && !_isAbsolute(request)) {
            // 这是 node_modules 里的库，交给 webpack 打包
            return callback();
        }

        // 3. 处理相对路径导入
        const absPath = _resolve(context, request);
        
        // 检查这个文件是否在我们的插件目录内
        if (absPath.startsWith(EXTENSION_ROOT)) {
            // 在插件目录内（src 或本插件的 node_modules），打包进去
            return callback();
        }

        // 4. 如果文件在插件目录之外，但在 ST public 目录之内
        if (absPath.startsWith(ST_PUBLIC_ROOT)) {
            // 计算相对于 ST public 的路径，转为 web 绝对路径
            let relativeWebPath = _relative(ST_PUBLIC_ROOT, absPath).replace(/\\/g, '/');
            if (!relativeWebPath.startsWith('/')) {
                relativeWebPath = '/' + relativeWebPath;
            }
            return callback(null, `module ${relativeWebPath}`);
        }

        // 其他情况
        callback();
    },
};

export default [serverConfig];
