import { VCSClient } from "../../vcs/provider"

//global.__dirname = process.cwd()

// see preload
// TypeScript:    https://github.com/electron/electron/issues/9920#issuecomment-468323625
interface IPCRenderer {
    invoke(channel: string, ...args: any): Promise<any>
    on(channel: string, func: (...args: any) => void): void
}

declare global {
    interface Window {
        ipcRenderer: IPCRenderer
		vcs: VCSClient
    }
}

// required for electron + webpack + monaco
// Relative to main_window/index.html's own directory, since the worker bundles are its siblings
// under .webpack/renderer/ in both dev and packaged builds. A root-relative (leading slash) path
// resolves against the dev server's origin correctly, but resolves to the filesystem root (and
// 404s) once the page is loaded via file:// in a packaged app.
const workerBaseUrl = new URL("../", document.baseURI);

// `new Worker(url)` requires same-origin, and file:// URLs get an opaque origin per resource -
// Electron's default webSecurity therefore blocks packaged builds from instantiating a worker
// directly from its file:// URL, even though the URL itself resolves to the right file. Wrapping
// it in a blob: URL sidesteps this, since blob: URLs inherit the creating page's security context.
// monaco-editor 0.55 creates its workers as module workers, which can't use importScripts() (that's
// classic-worker-only) - re-exporting via a static `import` works for both.
function workerUrl(fileName: string): string {
	const targetUrl = new URL(fileName, workerBaseUrl).href;
	const blob = new Blob([`import ${JSON.stringify(targetUrl)};`], { type: 'application/javascript' });
	return URL.createObjectURL(blob);
}

self.MonacoEnvironment = {
	getWorkerUrl: function (moduleId, label) {
		if (label === 'json') {
			return workerUrl('json.worker.js');
		}
		if (label === 'css' || label === 'scss' || label === 'less') {
			return workerUrl('css.worker.js');
		}
		if (label === 'html' || label === 'handlebars' || label === 'razor') {
			return workerUrl('html.worker.js');
		}
		if (label === 'typescript' || label === 'javascript') {
			return workerUrl('ts.worker.js');
		}
		return workerUrl('editor.worker.js');
	}
};