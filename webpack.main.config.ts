import type { Configuration } from 'webpack';

import { rules } from './webpack.rules.ts';

import CopyPlugin from 'copy-webpack-plugin';
import path from 'path';

rules.push({
    test: /\.d\.ts$/,
    use: 'raw-loader',
})

export const mainConfig: Configuration = {
    /**
     * This is the main entry point for your application, it's the first file
     * that runs in the main process.
     */
    entry: './src/index.ts',
    // Put your normal webpack config below here
    module: {
        rules,
    },
    resolve: {
        extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.json'],
    },
    plugins: [
        new CopyPlugin({
            patterns: [
                // .env is gitignored (it holds real secrets like OPENAI_API_KEY) and thus doesn't
                // exist on a fresh CI checkout. noErrorOnMissing keeps that from failing the build;
                // src/index.ts's dotenv config() call is likewise a no-op when the file isn't there.
                { from: './.env', to: './', noErrorOnMissing: true },
                // Copy over prisma scheme and engine to account for the incompatibility of electron forge and prisma's generated client.
                { from: './node_modules/.prisma/client/schema.prisma', to: './schema.prisma' },
                { from: './node_modules/.prisma/client/*.node', to: ({ absoluteFilename }) => `./${path.basename(absoluteFilename!)}` },
            ],
        }),
    ]
};
