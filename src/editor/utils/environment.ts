// see preload
// TypeScript:    https://github.com/electron/electron/issues/9920#issuecomment-468323625
interface CustomIPCRenderer {
    invoke(channel: string, ...args: any): void
    on(channel: string, func: (...args: any) => void): void
}

//declare global {
    interface Window {
        ipcRenderer: CustomIPCRenderer
    }
//}

// required for electron + webpack + monaco
self.MonacoEnvironment = {
	getWorkerUrl: function (moduleId, label) {
		if (label === 'json') {
			return './json.worker.bundle.js';
		}
		if (label === 'css' || label === 'scss' || label === 'less') {
			return './css.worker.bundle.js';
		}
		if (label === 'html' || label === 'handlebars' || label === 'razor') {
			return './html.worker.bundle.js';
		}
		if (label === 'typescript' || label === 'javascript') {
			return './ts.worker.bundle.js';
		}
		return './editor.worker.bundle.js';
	}
};