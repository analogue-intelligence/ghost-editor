import type { Configuration } from 'webpack';
import path from 'path';

import { rules } from './webpack.rules.ts';
import { plugins } from './webpack.plugins.ts';

import CopyPlugin from 'copy-webpack-plugin';
import MonacoWebpackPlugin from 'monaco-editor-webpack-plugin';

rules.push({
    test: /\.css$/,
    use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
});

// required by MonacoWebpackPlugin
// Uses webpack 5's built-in Asset Modules rather than file-loader: css-loader 6+ resolves
// url() references against the module graph and double-emits/mis-hashes assets that go
// through a loader instead of a native asset module.
rules.push({
    test: /\.ttf$/,
    type: 'asset/resource',
})

export const rendererConfig: Configuration = {
    module: {
        rules,
    },
    plugins: [
        ...plugins,
        // For plugin details, see: https://webpack.js.org/plugins/copy-webpack-plugin/
        new CopyPlugin({
            patterns: [
                { from: 'src/libs/p5js/p5.min.js', to: 'libs/p5js' },
                { from: 'node_modules/@iframe-resizer/child/index.umd.js', to: 'libs/iframe-resizer/iframeResizer.child.js' }
            ],
        }),
        // This sets up the workers needed for the monaco-editor automatically. Currently, this seems to interfer with the native_modules loader in webpack.rules.ts, so the loader was disabled.
        // For more plugin details, see: https://www.npmjs.com/package/monaco-editor-webpack-plugin
        new MonacoWebpackPlugin(),
    ],
    resolve: {
        extensions: ['.js', '.ts', '.jsx', '.tsx', '.css'],
        // Our own code compiles to CommonJS, which would otherwise resolve the bare "monaco-editor"
        // specifier to its pre-bundled "min" (CJS) build via package.json's "exports" map. That build
        // isn't meant to be run through another bundler and breaks resolving its internal nls loader.
        // Force resolution to the ESM tree that MonacoWebpackPlugin is actually designed to instrument.
        alias: {
            'monaco-editor$': path.resolve(process.cwd(), 'node_modules/monaco-editor/esm/vs/editor/editor.main.js'),
        },
    }
};
