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
        // @electron-forge/plugin-webpack normally generates this itself as a function that allowlists
        // only '.webpack/**' and prints a warning if it's overridden with anything else. This used to be
        // a RegExp, which electron-packager treats as an *exclude* pattern rather than an allowlist - so
        // it excluded only .db files and shipped the entire project root into every packaged build,
        // including .env and its real secrets, .git-adjacent config, notebooks, etc.
        //
        // Unlike the plugin's own default, this also allows node_modules/** and package.json through:
        // prisma-commands.ts spawns the `prisma` CLI (a runtime dependency, not something webpack can
        // bundle - it's invoked as a child process, not require()'d) from
        // "<app.asar>/node_modules/prisma/build/index.js", which only ever worked because the old,
        // broken ignore pattern happened to let all of node_modules through too. electron-packager's own
        // pruning (packagerConfig.prune, on by default) still strips devDependencies from what's copied,
        // same as it always did.
        ignore: (file) => {
            if (!file) return false;
            if (/\.db(-\w+)?$/.test(file)) return true;
            if (/^[/\\]\.webpack($|[/\\])/.test(file)) return false;
            if (/^[/\\]node_modules($|[/\\])/.test(file)) return false;
            if (/^[/\\]package\.json$/.test(file)) return false;
            return true;
        },
        // Without this, packaging renames/rewrites the prebuilt Electron.app bundle (executable name,
        // Info.plist, injected resources) without ever recomputing its code signature, so macOS refuses
        // to launch the result on Apple Silicon (invalid signature). We don't have a paid Developer ID,
        // so this forces ad-hoc signing (identity "-") instead of the default behavior, which searches
        // the keychain for a real "Developer ID Application" certificate and silently leaves the app
        // unsigned (continueOnError defaults to true) if none is found. Hardened runtime is disabled too:
        // it enforces library validation requiring every loaded binary to share a real Team ID, which two
        // independently ad-hoc-signed binaries (the app and Electron Framework) can never satisfy.
        // The top-level `hardenedRuntime` flag alone doesn't reach @electron/osx-sign's actual per-file
        // codesign invocations - it only reads per-file options through `optionsForFile`, whose absence
        // falls back to its own hardcoded `hardenedRuntime: true` default - so it has to be set here too.
        osxSign: {
            identity: '-',
            identityValidation: false,
            hardenedRuntime: false,
            optionsForFile: () => ({ hardenedRuntime: false }),
        },
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
