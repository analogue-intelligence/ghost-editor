import "./index.css"
import "./utils/environment"

import * as monaco from "monaco-editor"
import { MonacoEditor, MonacoModel, MonacoEditorOption, URI, Disposable, MonacoChangeEvent } from "./data-types/convenience/monaco";

import Synchronizer, { Synchronizable } from "./utils/synchronizer";
import SubscriptionManager from "./utils/subscription-manager";

import { ReferenceProvider } from "./utils/line-locator";

import View, { CodeProvider } from "./views/view";
import MetaView, { ViewIdentifier } from "./views/meta-view";

//import { P5JSPreview } from "../previews/p5js-preview";
import P5JSPreview from "./views/previews/p5js/react-p5js-preview";
import VCSPreview from "./views/previews/vcs-preview";

import VCSVersion from "./data-types/version";

import GhostSnapshot from "./views/monaco/snapshot/snapshot";
import VersionManagerView from "./views/versions/single-view-version-manager";
import GhostSnapshotFooter from "./views/monaco/snapshot/footer";

import { VCSRequestType, VCSTagId, VCSBlockSession, VCSBlockInfo, VCSSession, VCSBlockRange, VCSFileLoadingOptions, VCSBlockId, VCSOperation } from "../vcs/provider";
import { ChangeSet } from "../vcs/data-types/change";

import { p5jsDefaultCode } from "./languages/p5js/snippets"
import { extractEOLSymbol } from "./utils/helpers";
import { LoadFileEvent } from "./data-types/events";

import React from "react";

class GhostEditorSnapshotManager {

    public readonly editor: GhostEditor

    private snapshots: GhostSnapshot[] = []

    public get session():            VCSBlockSession               { return this.editor.getSession() }
    public get interactionManager(): GhostEditorInteractionManager { return this.editor.interactionManager }

    public constructor(editor: GhostEditor) {
        this.editor = editor
    }

    public replaceSnapshots(snapshots: VCSBlockInfo[]): void {
        this.removeSnapshots()
        this.snapshots = snapshots.map(snapshot => new GhostSnapshot(this.editor, snapshot))
    }

    public async loadSnapshots(): Promise<void> {
        const snapshots = await this.session.getChildrenInfo()
        this.replaceSnapshots(snapshots)
    }

    public async createSnapshot(range: VCSBlockRange): Promise<GhostSnapshot | null> {
        const overlappingSnapshot = this.snapshots.find(snapshot => snapshot.overlapsWith(range))

        if (!overlappingSnapshot){
            const snapshot = await GhostSnapshot.create(this.editor, range)

            if (snapshot) { 
                this.snapshots.push(snapshot)
            } else {
                console.warn("Failed to create snapshot!")
            }

            return snapshot
        } else {
            console.warn(`You cannot create a snapshot overlapping with ${overlappingSnapshot.snapshot.blockId}}!`)
            return null
        }
    }

    public getSnapshot(blockId: string): GhostSnapshot | undefined {
        return this.snapshots.find(snapshot => { return snapshot.blockId === blockId })
    }

    public getSnapshots(lineNumber: number): GhostSnapshot[] {
        return this.snapshots.filter(snapshot => { return snapshot.containsLine(lineNumber) })
    }

    public getOverlappingSnapshots(range: VCSBlockRange): GhostSnapshot[] {
        return this.snapshots.filter(snapshot => snapshot.overlapsWith(range))
    }

    public forEach(callback: (snaphot: GhostSnapshot, index: number, snapshots: GhostSnapshot[]) => void): void {
        this.snapshots.forEach(callback)
    }

    public find(check: (snaphot: GhostSnapshot, index: number, snapshots: GhostSnapshot[]) => void): GhostSnapshot | undefined {
        return this.snapshots.find(check)
    }

    public async update(): Promise<void> {
        for (const snaphot of this.snapshots) {
            await snaphot.update()
        }
    }

    public async manualUpdate(): Promise<void> {
        for (const snaphot of this.snapshots) {
            await snaphot.manualUpdate()
        }
    }

    public async updateFrom(snapshots: VCSBlockInfo[]): Promise<void> {
        for (const updatedSnapshot of snapshots) {
            const currentSnapshot = this.find(currentSnapshot => currentSnapshot.blockId === updatedSnapshot.blockId)
            if (currentSnapshot !== undefined) { await currentSnapshot.updateFrom({ snapshotData: updatedSnapshot }) }
            else                               { this.snapshots.push(new GhostSnapshot(this.editor, updatedSnapshot)) }
        }

        this.snapshots.reverse().forEach((currentSnapshot, index) => {
            const updatedSnapshot = snapshots.find(updatedSnapshot => currentSnapshot.blockId === updatedSnapshot.blockId)
            if (updatedSnapshot === undefined) {
                currentSnapshot.remove()
                this.snapshots.splice(index, 1)
            }
        })
    }

    public async manualUpdateFrom(snapshots: VCSBlockInfo[]): Promise<void> {
        for (const updatedSnapshot of snapshots) {
            const currentSnapshot = this.find(currentSnapshot => currentSnapshot.blockId === updatedSnapshot.blockId)
            if (currentSnapshot !== undefined) { await currentSnapshot.manualUpdateFrom(updatedSnapshot) }
            else                               { this.snapshots.push(new GhostSnapshot(this.editor, updatedSnapshot)) }
        }

        this.snapshots.reverse().forEach((currentSnapshot, index) => {
            const updatedSnapshot = snapshots.find(updatedSnapshot => currentSnapshot.blockId === updatedSnapshot.blockId)
            if (updatedSnapshot === undefined) {
                currentSnapshot.remove()
                this.snapshots.splice(index, 1)
            }
        })
    }

    public async deleteSnapshot(blockId: string): Promise<GhostSnapshot | undefined> {
        const snapshot = this.getSnapshot(blockId)

        if (snapshot) {
            await snapshot.delete()

            const index = this.snapshots.indexOf(snapshot, 0)
            if (index > -1) { this.snapshots.splice(index, 1) }

            if (this.editor.activeSnapshot === snapshot) { await this.editor.setActiveSnapshot(undefined) }
            else                                         { this.interactionManager.readEditorState() }
        }

        return snapshot
    }

    public removeSnapshots(): void {
        this.snapshots.forEach(snapshot => snapshot.remove())
        this.snapshots = []
    }
}

class GhostEditorInteractionManager extends SubscriptionManager {

    public  readonly editor: GhostEditor
    private get      core(): MonacoEditor { return this.editor.core }

    private readonly keybindings: Disposable[] = []

    private readonly hasActiveSnapshotId       = "hasActiveSnapshot"
    private readonly canShowSelectedSnapshotId = "canShowSelectedSnapshot"
    private readonly canCreateSnapshotId       = "canCreateSnapshot"
    private readonly canDeleteSnapshotId       = "canDeleteSnapshot"

    private readonly hasActiveSnapshotKey: monaco.editor.IContextKey<boolean>
    private readonly canShowSelectedSnapshotKey: monaco.editor.IContextKey<boolean>
    private readonly canCreateSnapshotKey: monaco.editor.IContextKey<boolean>
    private readonly canDeleteSnapshotKey: monaco.editor.IContextKey<boolean>

    private disableVcsSync = false

    private selectedRange:     VCSBlockRange | undefined = undefined
    public  selectedSnapshots: GhostSnapshot[]           = []

    private get activeSnapshot(): GhostSnapshot | undefined { return this.editor.activeSnapshot }
    private async setActiveSnapshot(snapshot: GhostSnapshot | undefined): Promise<void> { await this.editor.setActiveSnapshot(snapshot) }

    private get snapshotManager(): GhostEditorSnapshotManager { return this.editor.snapshotManager }

    public constructor(editor: GhostEditor) {
        super()
        this.editor = editor

        this.hasActiveSnapshotKey       = this.createContextKey(this.hasActiveSnapshotId,       false);
        this.canShowSelectedSnapshotKey = this.createContextKey(this.canShowSelectedSnapshotId, false);
        this.canCreateSnapshotKey       = this.createContextKey(this.canCreateSnapshotId,       false);
        this.canDeleteSnapshotKey       = this.createContextKey(this.canDeleteSnapshotId,       false);

        this.addSubscription(this.core.onDidChangeModelContent(async event => this.readEditorContent(event)))
        this.addSubscription(this.core.onDidChangeCursorPosition(    ()    => this.readEditorState({ updateActiveSnapshot: true })));

        this.readEditorState()
        this.setupKeybindings()
    }

    private getSelection():      monaco.Selection | null { return this.core.getSelection() }
    private getCursorPosition(): monaco.Position  | null { return this.core.getPosition() }

    private createContextKey<Type extends monaco.editor.ContextKeyValue>(id: string, defaultValue: Type): monaco.editor.IContextKey<Type> {
        return this.core.createContextKey<Type>(id, defaultValue);
    }

    private setupKeybindings(): void {

        const editor          = this.editor
        const core            = this.core
        const snapshotManager = this.snapshotManager

        // https://microsoft.github.io/monaco-editor/playground.html?source=v0.37.1#example-interacting-with-the-editor-adding-an-action-to-an-editor-instance
        // add snapshot to selection
        this.keybindings.push(core.addAction({
            id: "ghost-create-snapshot",
            label: "Create Snapshot",
            keybindings: [
                monaco.KeyMod.Alt | monaco.KeyCode.KeyY,
                monaco.KeyMod.Alt | monaco.KeyCode.KeyZ
            ],
            precondition: this.canCreateSnapshotId, // maybe add condition for selection
            keybindingContext: "editorTextFocus",
            contextMenuGroupId: "z_ghost", // z for last spot in order
            contextMenuOrder: 1,
        
            run: async () => {
                this.canCreateSnapshotKey.set(false)
                await snapshotManager.createSnapshot(this.selectedRange)
                    .then(() => this.readEditorState())
            },
        }));

        // delete selected snapshot
        this.keybindings.push(core.addAction({
            id: "ghost-remove-snapshot",
            label: "Remove Snapshot",
            keybindings: [
                monaco.KeyMod.Alt | monaco.KeyCode.KeyY,
            ],
            precondition: this.canDeleteSnapshotId, // maybe add condition for selection
            keybindingContext: "editorTextFocus",
            contextMenuGroupId: "z_ghost", // z for last spot in order
            contextMenuOrder: 1,
        
            run: async () => {
                await snapshotManager.deleteSnapshot(this.selectedSnapshots[0].blockId)
                this.readEditorState()
            },
        }));

        // side view keybindings
        if (editor.sideViewEnabled) {

            /*
            // update P5JS Preview
            this.keybindings.push(core.addAction({
                id: "p5-preview",
                label: "P5 Preview",
                keybindings: [
                    monaco.KeyMod.Alt | monaco.KeyCode.KeyP,
                ],
                precondition: undefined, // maybe add condition for selection
                keybindingContext: undefined,
                contextMenuGroupId: "y_p5_preview", // z for last spot in order
                contextMenuOrder: 1,
            
                run: function (core) {
                    //parent.preview.update(parent.value)
                    editor.sideView!.update(editor.sideViewIdentifiers!.p5js, editor!.text)
                },
            }))
            */

            // show versions in side view
            this.keybindings.push(core.addAction({
                id: "ghost-show-versions",
                label: "Show Versions",
                keybindings: [
                    monaco.KeyMod.Alt | monaco.KeyCode.KeyX,
                ],
                precondition: this.canShowSelectedSnapshotId,
                keybindingContext: "editorTextFocus",
                contextMenuGroupId: "z_ghost", // z for last spot in order
                contextMenuOrder: 2,
            
                run: async (core) => {
                    const lineNumber = core.getPosition().lineNumber
                    await editor.setActiveSnapshot(snapshotManager.getSnapshots(lineNumber)[0]) // TODO: How to handle overlap? Even relevant?
                },
            }));
    
            // hide versions in side view
            this.keybindings.push(core.addAction({
                id: "ghost-hide-versions",
                label: "Hide Versions",
                keybindings: [
                    monaco.KeyMod.Alt | monaco.KeyCode.KeyX,
                ],
                precondition: this.hasActiveSnapshotId + " && !" + this.canShowSelectedSnapshotId,
                keybindingContext: "editorTextFocus",
                contextMenuGroupId: "z_ghost", // z for last spot in order
                contextMenuOrder: 2,
            
                run: async () => {
                    await editor.setActiveSnapshot(undefined)
                },
            }));
        }
    }

    public async readEditorContent(event: MonacoChangeEvent): Promise<void> {
        if (!this.disableVcsSync) {
            await this.editor.setActiveSnapshot(undefined)
            const changeSet = this.editor.createChangeSet(event)
            this.editor.applyChangeSet(changeSet)
        }
    }

    public readEditorState(options?: { skipSelectionUpdate?: boolean, updateActiveSnapshot?: boolean }): void {

        this.hasActiveSnapshotKey.set(this.activeSnapshot !== undefined)

        const position   = this.getCursorPosition()
        const lineNumber = position?.lineNumber
        const snapshots  = lineNumber ? this.snapshotManager.getSnapshots(lineNumber) : []
        const snapshot   = snapshots.length > 0 ? snapshots[0] : undefined
        const canShowSelectedSnapshot = snapshot && snapshot !== this.activeSnapshot
        this.canShowSelectedSnapshotKey.set(canShowSelectedSnapshot ? canShowSelectedSnapshot : false);

        if (!options?.skipSelectionUpdate) {
            const selection = this.getSelection()

            if (selection) {
                this.selectedRange     = { startLine: selection.startLineNumber, endLine: selection.endLineNumber }
                this.selectedSnapshots = this.snapshotManager.getOverlappingSnapshots(this.selectedRange)
            } else if (position) {
                const lineNumber       = position.lineNumber
                this.selectedRange     = { startLine: lineNumber, endLine: lineNumber }
                this.selectedSnapshots = this.snapshotManager.getSnapshots(lineNumber)
            } else {
                this.selectedRange     = undefined
                this.selectedSnapshots = []
            }

            this.canCreateSnapshotKey.set(this.selectedSnapshots.length === 0 && this.selectedRange !== undefined)
            this.canDeleteSnapshotKey.set(this.selectedSnapshots.length > 0)
        }

        if (options?.updateActiveSnapshot) {
            this.editor.snapshotManager.forEach(snapshot => {
                // TODO:    The line number and column check work for now, but are a dirty workaround to avoid mistakes when timetraveling from a lower snapshot when there is a snapshot in line 1
                // PROBLEM: Clicking on a ViewZone will set position to 1:1
                if (lineNumber !== undefined && (lineNumber !== 1 || position?.column !== 1) && snapshot.containsLine(lineNumber)) {
                    snapshot.showMenu()
                } else if (!snapshot.menuActive) {
                    snapshot.hideMenu()
                }
            })
        }
    }

    public withDisabledVcsSync(callback: () => void): void {
        this.disableVcsSync = true
        callback()
        this.disableVcsSync = false
    }

    public async unloadFile(): Promise<void> {
        await this.setActiveSnapshot(undefined)
        this.selectedRange     = undefined
        this.selectedSnapshots = []
    }
}

export class GhostEditorModel {

    public readonly textModel: MonacoModel
    public readonly session:   VCSBlockSession

    public get uri(): URI { return this.textModel.uri }

    public constructor(textModel: MonacoModel, session: VCSBlockSession) {
        this.textModel = textModel
        this.session   = session
    }

    public close(): void {
        this.session.close()
    }
}


export class GhostFileLoadingOptions {
    public readonly uri:      URI
    public readonly content?: string

    public constructor(uri: URI, content?: string) {
        this.uri     = uri
        this.content = content
    }
}

export class GhostFilePathLoadingOptions {
    public readonly filePath: string
    public readonly content?: string

    public constructor(filePath: string, content?: string) {
        this.filePath = filePath
        this.content  = content
    }
}

export class GhostBlockLoadingOptions {
    public readonly filePath: string
    public readonly blockId:  VCSBlockId
    public readonly content?: string

    public constructor(filePath: string, blockId: VCSBlockId, content?: string) {
        this.filePath = filePath
        this.blockId  = blockId
        this.content  = content
    }
}

export class GhostTagLoadingOptions {
    public readonly filePath: string
    public readonly blockId?: VCSBlockId
    public readonly tagId:    VCSTagId
    public readonly content?: string

    public constructor(filePath: string, tagId: VCSTagId, options?: { blockId?: VCSBlockId, content?: string }) {
        this.filePath = filePath
        this.blockId  = options?.blockId
        this.tagId    = tagId
        this.content  = options?.content
    }
}

export class GhostBlockSessionLoadingOptions {
    public readonly session: VCSBlockSession

    public constructor(session: VCSBlockSession) {
        this.session = session
    }
}

export type GhostLoadingOptions = undefined | GhostFileLoadingOptions | GhostFilePathLoadingOptions | GhostBlockLoadingOptions | GhostTagLoadingOptions | GhostBlockSessionLoadingOptions

export default class GhostEditor extends View implements ReferenceProvider, CodeProvider {

    public static readonly defaultLanguageId = "javascript"
    public static readonly defaultCode       = p5jsDefaultCode

    private static _session?: VCSSession
    public static async getSession(): Promise<VCSSession> {
        if (!this._session) {
            this._session = await VCSSession.create(window.vcs)
            this._session.onRequestSend(() => GhostSnapshotFooter.loadingEventEmitter.reload(), { requestTypes: { include: [VCSRequestType.ReadWrite] }, operations: { exclude: [VCSOperation.LoadFile, VCSOperation.SetBlockVersionIndex] } })
        } 
        return this._session
    }

    public readonly enableFileManagement: boolean
    public readonly sideViewEnabled:      boolean
    public readonly hideErrorMessage:     boolean
    public readonly mainViewFlex:         number
    public          languageId?:          string

    // view containers to seperate main editor and side view
    public  readonly editorContainer:    HTMLDivElement
    public  readonly sideViewContainer?: HTMLDivElement
    private readonly containers:         HTMLDivElement[] = []

    // main editor
    public readonly core:               MonacoEditor
    public readonly snapshotManager:    GhostEditorSnapshotManager
    public readonly interactionManager: GhostEditorInteractionManager

    // side view containing previews, versioning views, etc.
    public sideView?:            MetaView
    public sideViewIdentifiers?: Record<string, ViewIdentifier>
    public defaultSideView?:     ViewIdentifier

    // data model
    public     editorModel?: GhostEditorModel
    public get hasModel():   boolean { return this.editorModel !== undefined }

    // accessors for editor meta info and content
    public get uri():  URI           { return this.getTextModel().uri }
    public get path(): string | null { return this.uri.scheme === 'file' ? this.uri.fsPath : null }
    public get code(): string        { return this.core.getValue() }

    // accessors for useful config info of the editor
    public get firstVisibleLine(): number { return this.core.getVisibleRanges()[0].startLineNumber }
    public get lineHeight():       number { return this.core.getOption(MonacoEditorOption.lineHeight) } // https://github.com/microsoft/monaco-editor/issues/794
    public get characterWidth():   number { return this.getFontInfo().typicalHalfwidthCharacterWidth }
    public get spaceWidth():       number { return this.getFontInfo().spaceWidth }
    public get tabSize():          number { return this.getModelOptions().tabSize }

    // snapshot management
    private _activeSnapshot:      GhostSnapshot | undefined = undefined
    public  get activeSnapshot(): GhostSnapshot | undefined { return this._activeSnapshot }

    public async setActiveSnapshot(snapshot: GhostSnapshot | undefined): Promise<void> {
        if (snapshot === this.activeSnapshot) {
            await this.activeSnapshot?.updateVersionManager()
        } else {
            await this._activeSnapshot?.hideVersionManager()
            this._activeSnapshot = snapshot
            await this._activeSnapshot?.showVersionManager()
        }

        this.interactionManager.readEditorState({ skipSelectionUpdate: true })
    }

    public get selectedSnapshots(): GhostSnapshot[] { return this.interactionManager.selectedSnapshots }

    public static createEditorFromSession(root: HTMLElement, loadingOptions: GhostBlockSessionLoadingOptions, options?: { enableSideView?: boolean, hideErrorMessage: boolean, mainViewFlex?: number, languageId?: string, synchronizer?: Synchronizer }): GhostEditor {
        return new GhostEditor(root, loadingOptions, options)
    }

    public constructor(root: HTMLElement, loadOptions: GhostLoadingOptions, options?: { enableFileManagement?: boolean, enableSideView?: boolean, hideErrorMessage?: boolean, mainViewFlex?: number, languageId?: string, synchronizer?: Synchronizer }) {
        super(root, options?.synchronizer)

        this.enableFileManagement = options?.enableFileManagement ? options.enableFileManagement : false
        this.sideViewEnabled      = options?.enableSideView       ? options.enableSideView       : false
        this.hideErrorMessage     = options?.hideErrorMessage     ? options.hideErrorMessage     : false
        this.mainViewFlex         = options?.mainViewFlex         ? options.mainViewFlex         : 1
        this.languageId           = options?.languageId

        // setup root for flex layout
        this.root.style.display       = "flex"
        this.root.style.flexDirection = "row"
        this.root.style.height        = "100%"
        this.root.style.padding       = "0 0"
        this.root.style.margin        = "0 0"

        this.editorContainer = this.addContainer(this.mainViewFlex)
        if (this.sideViewEnabled) {
            this.sideViewContainer = this.addContainer()
            this.sideViewContainer.style.borderLeft = "1px solid gray"
        }
        
        this.core               = monaco.editor.create(this.editorContainer, { value: '', automaticLayout: true, colorDecorators: true  });
        this.snapshotManager    = new GhostEditorSnapshotManager(this)
        this.interactionManager = new GhostEditorInteractionManager(this)

        this.setup()
        this.load(loadOptions)
    }

    private createEditorModel(textModel: MonacoModel, session: VCSBlockSession, vcsContent: string): void {
        textModel.setValue(vcsContent)
        this.editorModel = new GhostEditorModel(textModel, session)
        this.core.setModel(textModel)

        if (this.sideViewEnabled) {
            this.sideView.update(this.sideViewIdentifiers.vcs, { editorModel: this.editorModel, vcsContent })
            //this.sideView!.update(this.sideViewIdentifiers!.p5js, session)
            this.sideView.update(this.sideViewIdentifiers.versionManager, { languageId: textModel.getLanguageId() })
        }

        this.triggerSync()
    }

    public getTextModel(): MonacoModel {
        if (this.hasModel) { return this.editorModel.textModel }
        else               { throw new Error("The editor currently has no model. Please load a session in order to re-establish functionality before using this function.") }
    }

    public getSession(): VCSBlockSession {
        if (this.hasModel) { return this.editorModel.session }
        else               { throw new Error("The editor currently has no session. Please load a session in order to re-establish functionality before using this function.") } 
    }

    // TODO: this could be optimized, kinda slow as this is used for every preview render!
    public async getCode(): Promise<string> {
        try {
            return await this.getSession().getRootText()
        } catch {
            return ""
        }
    }

    public async getErrorHint(code: string, errorMessage: string): Promise<string> {
        return await this.getSession().getErrorHint(code, errorMessage)
    }

    // edior and model options to extract config
    public getFontInfo():     monaco.editor.FontInfo                 { return this.core.getOption(MonacoEditorOption.fontInfo) }
    public getModelOptions(): monaco.editor.TextModelResolvedOptions { return this.getTextModel().getOptions() }
    public getEOLSymbol():    string                                 { return extractEOLSymbol(this.getTextModel()) }

    private addContainer(flex?: number): HTMLDivElement {

        flex = flex ? flex : 1

        const container = document.createElement("div")
        container.style.boxSizing = "border-box"
        container.style.flex      = `${flex}`
        container.style.minWidth  = "0" // flex items default to min-width: auto, which blocks shrinking below content's intrinsic width
        container.style.height    = "100%"
        container.style.padding   = "0 0"
        container.style.margin    = "0 0"
        this.root.appendChild(container)

        this.containers.push(container)

        let flexSum = 0
        this.containers.forEach(container => flexSum += parseFloat(container.style.flexGrow))
        this.containers.forEach(container => { container.style.maxWidth = `${100 * parseFloat(container.style.flexGrow) / flexSum}%`})

        return container
    }

    private setup(): void {
        this.setupElectronCommunication()
        this.setupSideView()
    }

    private setupElectronCommunication(): void {
        if (this.enableFileManagement) {
            window.ipcRenderer.on('menu-load-file',        (response: LoadFileEvent) => this.loadFile(response.path, response.content))
            window.ipcRenderer.on('menu-save' ,            ()                        => this.save())
            window.ipcRenderer.on('menu-update-file-path', (filePath: string)        => this.getSession().updateFilePath(filePath))
        }
    }

    private async setupSideView(): Promise<void> {
        if (this.sideViewEnabled) {
            this.sideView = new MetaView(this.sideViewContainer)

            await this.sideView.addView("vcs", root => {
                return new VCSPreview(root, this.editorModel)
            }, {
                updateCallback: (view: VCSPreview, args: { editorModel: GhostEditorModel, vcsContent?: string }) => {
                    view.updateEditor(args.editorModel, args.vcsContent)
                }
            })

            await this.sideView.addReactView("p5js", <P5JSPreview synchronizer={this.synchronizer} codeProvider={this} hideErrorMessage={this.hideErrorMessage}/>)

            await this.sideView.addView("versionManager", root => {
                return new VersionManagerView(root, { synchronizer: this.synchronizer })
            }, {
                updateCallback: async (view: VersionManagerView, args: { languageId?: string, versions?: VCSVersion[] }) => {
                    if (args.languageId) { view.setLanguageId(args.languageId) }
                    if (args.versions)   { await view.applyDiff(args.versions) }
                },
                hideCallback: async (view: VersionManagerView) => {
                    await view.removeVersions()
                }
            })

            this.sideViewIdentifiers = this.sideView.identifiers
            this.defaultSideView     = this.sideViewIdentifiers.p5js
            await this.showDefaultSideView()
        }
    }

    public async showDefaultSideView(): Promise<void> {
        const sideView = this.sideView
        if (this.sideViewEnabled && sideView && sideView.currentViewIdentifier !== this.defaultSideView) { await sideView.showView(this.defaultSideView) }
    }

    public createChangeSet(event: MonacoChangeEvent): ChangeSet {
        return new ChangeSet(Date.now(), this.getTextModel(), this.getEOLSymbol(), event)
    }

    public async applyChangeSet(changeSet: ChangeSet): Promise<void> {
        // forEach is a bitch for anything but synchronous arrays...
        const changedSnapshots = await this.getSession().applyChanges(changeSet)
        await Promise.all(changedSnapshots.map(id => this.snapshotManager.getSnapshot(id.blockId)?.update()))
        if (changedSnapshots.length > 0) { this.triggerSync() }
    }

    public override async sync(trigger: Synchronizable): Promise<void> {
        const session   = this.getSession()

        const content   = await session.getText()
        const snapshots = await session.getChildrenInfo()

        this.update(content)
        await this.snapshotManager.updateFrom(snapshots)
    }

    // dangerous method, disconnects the editor from VCS, make sure this never is called indepenedently of a load
    private async unload(): Promise<void> {
        const sideView = this.sideView
        if (this.sideViewEnabled && sideView && this.sideViewIdentifiers) {
            await sideView.update(this.sideViewIdentifiers.versionManager, { versions: [] })
        }

        this.snapshotManager.removeSnapshots()
        await this.interactionManager.unloadFile()
        this.core.setModel(null)
        this.editorModel?.close()
        this.editorModel = undefined
    }

    public async createSession(options: VCSFileLoadingOptions): Promise<VCSBlockSession> {
        const vcsSession = await GhostEditor.getSession()
        return await vcsSession.loadFile(options)
    }

    public async load(options: GhostLoadingOptions): Promise<void> {
        await this.unload()

        const hostSession = await GhostEditor.getSession()

        let textModel: MonacoModel | undefined
        let session:   VCSBlockSession

        const setTextModel = (uri: URI | undefined, content?: string) => {
            const model        = uri     ? monaco.editor.getModel(uri) : null
            const modelContent = content ? content                     : ""
            
            if (model) {
                textModel = model
                textModel.setValue(modelContent)
            } else { 
                textModel = monaco.editor.createModel(modelContent, this.languageId, uri)
            }

            return extractEOLSymbol(textModel)
        }

        if (options === undefined) {
            this.languageId = GhostEditor.defaultLanguageId
            const eol       = setTextModel(undefined, GhostEditor.defaultLanguageId)

            session = await hostSession.loadFile({ eol, content: GhostEditor.defaultCode.replace(new RegExp("\\n", "g"), eol) })

        } else if (options instanceof GhostFileLoadingOptions) {
            const uri     = options.uri
            const content = options.content ? options.content : ""
            const eol     = setTextModel(uri, content)

            session = await hostSession.loadFile({ filePath: uri.fsPath, eol, content })

        } else if (options instanceof GhostFilePathLoadingOptions) {
            const filePath = options.filePath
            const content  = options.content ? options.content : ""

            const uri = monaco.Uri.file(filePath)
            const eol = setTextModel(uri, content)

            session = await hostSession.loadFile({ filePath: filePath, eol, content })

        } else if (options instanceof GhostBlockLoadingOptions) {
            const filePath = options.filePath
            const blockId  = options.blockId
            const content  = options.content ? options.content : ""
            const eol      = setTextModel(undefined, content)

            const fileSession = await hostSession.loadFile({ filePath: filePath, eol, content })
            
            session = await fileSession.getChild(blockId)

        } else if (options instanceof GhostTagLoadingOptions) {
            const filePath = options.filePath
            const tagId    = options.tagId
            const blockId  = options.blockId
            const content  = options.content ? options.content : ""
            const eol      = setTextModel(undefined, content)

            const fileSession  = await hostSession.loadFile({ filePath: filePath, eol, content })
            const blockSession = await fileSession.getChild(blockId ? blockId : tagId) // TODO: is this the most sensible way to select the right block? why not the root block?
            
            await blockSession.applyTag(tagId)

            session = blockSession

        } else if (options instanceof GhostBlockSessionLoadingOptions) {

            setTextModel(undefined, undefined)
            session = options.session

        } else {
            throw new Error("The provided set of options does not match any of the allowed types!")
        }

        const content   = await session.getText()
        const snapshots = await session.getChildrenInfo()

        this.createEditorModel(textModel, session, content)
        await this.showDefaultSideView()

        // NOTE: Creating snapshots will create view zones. This cannot happen immediately, and should only be done after the editor finished rendering the first frame. Waiting for this event will allow me to do so.
        const setupDisposable = this.core.onDidContentSizeChange(() => {
            setupDisposable.dispose()
            this.snapshotManager.replaceSnapshots(snapshots)
        })
    }

    public async loadFile(filePath: string, content: string): Promise<void> {
        if (this.enableFileManagement) {
            const uri = monaco.Uri.file(filePath)
            this.load(new GhostFileLoadingOptions(uri, content))
        } else {
            throw new Error("This GhostEditor is not configured to support file management! You cannot load a file.")
        }
    }

    public save(): void {
        if (this.enableFileManagement) {
            window.ipcRenderer.invoke('save-file', { path: this.path, content: this.code })
        } else {
            throw new Error("This GhostEditor is not configured to support file management! You cannot save a file.")
        }
    }

    private update(code: string): void {
        this.interactionManager.withDisabledVcsSync(() => this.core.setValue(code) )
    }

    public async reload(code: string): Promise<void> {
        this.update(code)
        await this.snapshotManager.manualUpdate()
        this.triggerSync()
    }

    public async syncWithVCS(): Promise<void> {
        const newCode = await this.getSession().getText()
        await this.reload(newCode)
    }

    // TODO: The sub editors do not get cleaned up properly and are stuck somewhere in memory
    // Manual cleaning is requires
    public async remove(): Promise<void> {
        await this.unload()
        await this.sideView?.hideViews()
        this.synchronizer?.deregister(this)
        super.remove()
    }
}