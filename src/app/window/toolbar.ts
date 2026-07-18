import { BrowserWindow, Menu, MenuItem, ipcMain } from "electron"
import * as file from "../utils/fileUtils"
import { p5jsDefaultCode } from "../../editor/languages/p5js/snippets"

const toolbarTemplate = [
    new MenuItem({
        label: 'File',
        submenu: [
            {
                label: 'Create New File...',
                accelerator: process.platform === 'darwin' ? 'Cmd+N' : 'Ctrl+N',
                click: (menuItem, browserWindow) => {
                    // TODO: Not sure if this is the desired default, but it works for this prototype
                    const window = browserWindow as BrowserWindow
                    file.createFile(window, p5jsDefaultCode)
                        .then(response => {
                            if (response) {
                                window.webContents.send('menu-load-file', response)
                            }
                        })
                }
            },
            { 
                label: 'Open File...',
                accelerator: process.platform === 'darwin' ? 'Cmd+O' : 'Ctrl+O',
                click: (menuItem, browserWindow) => {
                    const window = browserWindow as BrowserWindow
                    file.openFile(window)
                        .then(response => {
                            if (response) {
                                window.webContents.send('menu-load-file', response)
                            }
                        })
                }
            },
            {
                label: 'Save',
                accelerator: process.platform === 'darwin' ? 'Cmd+S' : 'Ctrl+S',
                click: (menuItem, browserWindow) => {
                    (browserWindow as BrowserWindow).webContents.send('menu-save')
                }
            },
            {
                role: 'quit'
            }
        ]
    }),
    new MenuItem({
        label: 'Edit',
        submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' }
        ]
    }),
    new MenuItem({
        label: 'Versioning',
        submenu: [
            {
                label: 'Show Versions',
                click: (menuItem, browserWindow) => {
                    (browserWindow as BrowserWindow).webContents.send('menu-show-versions')
                }
            }
        ]
    }),
    new MenuItem({
        label: 'View',
        submenu: [
            {
                id: 'toggle-rulers',
                label: 'Show Rulers',
                type: 'checkbox',
                checked: true,
                accelerator: process.platform === 'darwin' ? 'Cmd+R' : 'Ctrl+R',
                click: (menuItem, browserWindow) => {
                    (browserWindow as BrowserWindow).webContents.send('menu-toggle-rulers', menuItem.checked)
                }
            }
        ]
    }),
]

function setupToolbarEvents(browserWindow: BrowserWindow, menu: Menu): void {
    ipcMain.handle('save-file', async (event, response) => {
        const filePath = await file.saveFile(browserWindow, response.path, response.content)
        if (response.path !== filePath) {
            browserWindow.webContents.send("menu-update-file-path", filePath)
        }
    })

    ipcMain.handle('get-rulers-visible', () => {
        const item = menu.getMenuItemById('toggle-rulers')
        return item ? item.checked : true
    })
}

export default function setupToolbar(browserWindow: BrowserWindow): Menu {
    const menu = Menu.buildFromTemplate(toolbarTemplate)
    Menu.setApplicationMenu(menu)
    setupToolbarEvents(browserWindow, menu)
    return menu
}