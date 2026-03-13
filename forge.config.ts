import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';

import { mainConfig } from './webpack.main.config.ts';
import { rendererConfig } from './webpack.renderer.config.ts';

const config: ForgeConfig = {
    packagerConfig: {
        asar: true,
        // Currently, the native_modules loader (defined in webpack.rules.ts) has to be excluded for various reasons (see comments in that file). To make prisma work, we thus need to copy the required files manually.
        // For more info on this fix, see: https://github.com/prisma/prisma/issues/12627
        extraResource: [
            './prisma/',
            './node_modules/@prisma/engines/',
        ],
        ignore: new RegExp("\\./.*\\.db.*")
    },
    rebuildConfig: {},
    makers: [new MakerSquirrel({}), new MakerZIP({}, ['darwin']), new MakerRpm({}), new MakerDeb({})],
    plugins: [
        new AutoUnpackNativesPlugin({}),
        new WebpackPlugin({
            mainConfig,
            renderer: {
                config: rendererConfig,
                entryPoints: [
                    {
                        html: './src/index.html',
                        js: './src/renderer.ts',
                        name: 'main_window',
                        preload: {
                            js: './src/preload.ts',
                        },
                    },
                ],
            },
            // WARNING: This is a security risk! But I am lazy, so I just choose to allow everything for development. But someone should figure out what a proper policy would be!
            // More info: https://www.electronforge.io/config/plugins/webpack
            devContentSecurityPolicy: "default-src * self blob: data: gap:; style-src * self 'unsafe-inline' blob: data: gap:; script-src * 'self' 'unsafe-eval' 'unsafe-inline' blob: data: gap:; object-src * 'self' blob: data: gap:; img-src * self 'unsafe-inline' blob: data: gap:; connect-src self * 'unsafe-inline' blob: data: gap:; frame-src * self blob: data: gap:;"
        }),
    ],
};

export default config;
