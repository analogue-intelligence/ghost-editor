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
// Root-relative (leading slash) so these resolve against the origin regardless of the current
// page's own path -- Electron Forge's dev server entry URL shape isn't something to rely on.
self.MonacoEnvironment = {
	getWorkerUrl: function (moduleId, label) {
		if (label === 'json') {
			return '/json.worker.js';
		}
		if (label === 'css' || label === 'scss' || label === 'less') {
			return '/css.worker.js';
		}
		if (label === 'html' || label === 'handlebars' || label === 'razor') {
			return '/html.worker.js';
		}
		if (label === 'typescript' || label === 'javascript') {
			return '/ts.worker.js';
		}
		return '/editor.worker.js';
	}
};