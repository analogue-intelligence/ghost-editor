import "../../../utils/environment"

import * as monaco from "monaco-editor"

import { View } from "../view";
import { MonacoEditor, MonacoModel, MonacoEditorOption, URI, Disposable, IRange, MonacoChangeEvent } from "../../../utils/types";
import { Synchronizable, Synchronizer } from "../../../utils/synchronizer";
import { SnapshotUUID, VCSClient } from "../../../../app/components/vcs/vcs-provider";
import { MetaView, ViewIdentifier } from "../meta-view";
import { GhostSnapshot } from "../../snapshot/snapshot";
import { SubscriptionManager } from "../../widgets/mouse-tracker";
import { ChangeSet } from "../../../../app/components/data/change";
import { VCSPreview } from "../previews/vcs-preview";
import { P5JSPreview } from "../previews/p5js-preview";
import { VersionManagerView } from "../version/version-manager";
import { VCSVersion } from "../../../../app/components/data/snapshot";
import { LoadFileEvent } from "../../../utils/events";
import { ReferenceProvider } from "../../../utils/line-locator";

class GhostEditorSnapshotManager {

    public readonly editor: GhostEditor

    private snapshots: GhostSnapshot[] = []

    public get vcs():               VCSClient                      { return this.editor.vcs }
    public get interactionManager(): GhostEditorInteractionManager { return this.editor.interactionManager }

    public constructor(editor: GhostEditor) {
        this.editor = editor
    }

    public async loadSnapshots(): Promise<void> {
        const snapshots = await this.vcs.getSnapshots()
        this.snapshots = snapshots.map(snapshot => new GhostSnapshot(this.editor, snapshot))
    }

    public async createSnapshot(range: IRange): Promise<GhostSnapshot | null> {
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
            console.warn(`You cannot create a snapshot overlapping with ${overlappingSnapshot.snapshot.uuid}}!`)
            return null
        }
    }

    public getSnapshot(uuid: string): GhostSnapshot | undefined {
        return this.snapshots.find(snapshot => { return snapshot.uuid === uuid })
    }

    public getSnapshots(lineNumber: number): GhostSnapshot[] {
        return this.snapshots.filter(snapshot => { return snapshot.containsLine(lineNumber) })
    }

    public getOverlappingSnapshots(range: IRange): GhostSnapshot[] {
        return this.snapshots.filter(snapshot => snapshot.overlapsWith(range))
    }

    public forEach(callback: (snaphot: GhostSnapshot, index: number, snapshots: GhostSnapshot[]) => void): void {
        this.snapshots.forEach(callback)
    }

    public deleteSnapshot(uuid: SnapshotUUID): GhostSnapshot | undefined {
        const snapshot = this.getSnapshot(uuid)

        if (snapshot) {
            snapshot.delete()

            const index = this.snapshots.indexOf(snapshot, 0)
            if (index > -1) { this.snapshots.splice(index, 1) }

            if (this.editor.activeSnapshot === snapshot) { this.editor.activeSnapshot = undefined }
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

    private disableVcsSync: boolean = false

    private selectedRange:     IRange | undefined = undefined
    public  selectedSnapshots: GhostSnapshot[]    = []

    private get activeSnapshot(): GhostSnapshot | undefined         { return this.editor.activeSnapshot }
    private set activeSnapshot(snapshot: GhostSnapshot | undefined) { this.editor.activeSnapshot = snapshot }

    private get snapshotManager(): GhostEditorSnapshotManager { return this.editor.snapshotManager }

    public constructor(editor: GhostEditor) {
        super()
        this.editor = editor

        this.hasActiveSnapshotKey       = this.createContextKey(this.hasActiveSnapshotId,       false);
        this.canShowSelectedSnapshotKey = this.createContextKey(this.canShowSelectedSnapshotId, false);
        this.canCreateSnapshotKey       = this.createContextKey(this.canCreateSnapshotId,       false);
        this.canDeleteSnapshotKey       = this.createContextKey(this.canDeleteSnapshotId,       false);

        this.addSubscription(this.core.onDidChangeModelContent(async event => this.readEditorContent(event)))
        this.addSubscription(this.core.onDidChangeCursorPosition(    event => this.readEditorState({ updateActiveSnapshot: true })));

        this.readEditorState()
        this.setupKeybindings()
    }

    private getSelection():      monaco.Selection | null { return this.core.getSelection() }
    private getCursorPosition(): monaco.Position  | null { return this.core.getPosition() }

    private createContextKey<Type extends monaco.editor.ContextKeyValue>(id: string, defaultValue: Type): monaco.editor.IContextKey<Type> {
        return this.core.createContextKey<Type>(id, defaultValue);
    }

    private setupKeybindings(): void {

        const parent          = this
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
            ],
            precondition: this.canCreateSnapshotId, // maybe add condition for selection
            keybindingContext: "editorTextFocus",
            contextMenuGroupId: "z_ghost", // z for last spot in order
            contextMenuOrder: 1,
        
            run: function (core) {
                parent.canCreateSnapshotKey.set(false)
                snapshotManager.createSnapshot(parent.selectedRange!)
                    .then(() => parent.readEditorState())
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
        
            run: function (core) {
                snapshotManager.deleteSnapshot(parent.selectedSnapshots[0].uuid)
                parent.readEditorState()
            },
        }));

        // side view keybindings
        if (editor.sideViewEnabled) {

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
            
                run: function (core) {
                    const lineNumber = core.getPosition()!.lineNumber
                    editor.activeSnapshot = snapshotManager.getSnapshots(lineNumber)[0] // TODO: How to handle overlap? Even relevant?
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
            
                run: function (core) {
                    editor.activeSnapshot = undefined
                },
            }));
        }
    }

    public readEditorContent(event: MonacoChangeEvent):void {
        if (!this.disableVcsSync) {
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
                this.selectedRange     = selection
                this.selectedSnapshots = this.snapshotManager.getOverlappingSnapshots(selection)
            } else if (position) {
                const lineNumber       = position.lineNumber
                this.selectedRange     = new monaco.Range(lineNumber, 1, lineNumber, Number.MAX_SAFE_INTEGER)
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
                if (lineNumber && snapshot.containsLine(lineNumber)) {
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

    public unloadFile(): void {
        this.activeSnapshot    = undefined
        this.selectedRange     = undefined
        this.selectedSnapshots = []
    }
}

export class GhostEditor extends View implements ReferenceProvider {

    // view containers to seperate main editor and side view
    public readonly editorContainer:    HTMLDivElement
    public readonly sideViewContainer?: HTMLDivElement

    // main editor
    public readonly core:               MonacoEditor
    public readonly snapshotManager:    GhostEditorSnapshotManager
    public readonly interactionManager: GhostEditorInteractionManager

    // side view containing previews, versioning views, etc.
    public readonly sideViewEnabled:      boolean
    public          sideView?:            MetaView
    public          sideViewIdentifiers?: Record<string, ViewIdentifier>
    private         defaultSideView?:     ViewIdentifier

    // accessors for editor meta info and content
    public get uri():  URI           { return this.getModel().uri }
    public get path(): string | null { return this.uri.scheme === 'file' ? this.uri.fsPath : null }
    public get text(): string        { return this.core.getValue() }

    // accessors for useful config info of the editor
    public get firstVisibleLine() : number { return this.core.getVisibleRanges()[0].startLineNumber }
    public get lineHeight():         number { return this.core.getOption(MonacoEditorOption.lineHeight) } // https://github.com/microsoft/monaco-editor/issues/794
    public get characterWidth():     number { return this.getFontInfo().typicalHalfwidthCharacterWidth }
    public get spaceWidth():         number { return this.getFontInfo().spaceWidth }
    public get tabSize():            number { return this.getModelOptions().tabSize }

    // vcs system allowing for version management
    public get vcs(): VCSClient { return window.vcs }

    // snapshot management
    private _activeSnapshot:      GhostSnapshot | undefined = undefined
    public  get activeSnapshot(): GhostSnapshot | undefined { return this._activeSnapshot }
    public  set activeSnapshot(snapshot: GhostSnapshot | undefined) {
        if (snapshot === this.activeSnapshot) { 
            this.activeSnapshot?.updateVersionManager()
        } else {
            this._activeSnapshot?.hideVersionManager()
            this._activeSnapshot = snapshot
            this._activeSnapshot?.showVersionManager()
        }

        this.interactionManager.readEditorState({ skipSelectionUpdate: true })
    }

    public get selectedSnapshots(): GhostSnapshot[] { return this.interactionManager.selectedSnapshots }

    constructor(root: HTMLElement, options?: { enableSideView?: boolean, synchronizer?: Synchronizer }) {
        super(root)

        this.sideViewEnabled = options?.enableSideView ? options.enableSideView : false

        // setup root for flex layout
        this.root.style.display       = "flex"
        this.root.style.flexDirection = "row"
        this.root.style.height        = "100%"
        this.root.style.padding       = "0 0"
        this.root.style.margin        = "0 0"

        this.editorContainer = this.addContainer()
        if (this.sideViewEnabled) { this.sideViewContainer = this.addContainer() }
        
        this.core               = monaco.editor.create(this.editorContainer, { value: '', automaticLayout: true  });
        this.snapshotManager    = new GhostEditorSnapshotManager(this)
        this.interactionManager = new GhostEditorInteractionManager(this)

        this.setup()

        options?.synchronizer?.register(this)
    }

    // (create and) get the model of the editor
    public getModel(): MonacoModel {
        let model = this.core.getModel()
        if (!model) {
            model = monaco.editor.createModel("")
            this.setModel(model)
        }
        return model
    }

    private setModel(model: MonacoModel): void {
        this.core.setModel(model)
        if (this.sideViewEnabled) { this.sideView!.update(this.sideViewIdentifiers!.vcs, model) }
    }

    // edior and model options to extract config
    public getFontInfo():     monaco.editor.FontInfo                 { return this.core.getOption(MonacoEditorOption.fontInfo) }
    public getModelOptions(): monaco.editor.TextModelResolvedOptions { return this.getModel().getOptions() }

    public getEolSymbol(): string {
        const EOL = this.getModel().getEndOfLineSequence()
        switch(EOL) {
            case 0:  return "\n"
            case 1:  return "\r\n"
            default: throw new Error(`Unknown end of line sequence! Got ${EOL}`)
        }
    }

    private addContainer(): HTMLDivElement {
        const container = document.createElement("div")
        container.style.flex    = "1"
        container.style.height  = "100%"
        container.style.padding = "0 0"
        container.style.margin  = "0 0"
        this.root.appendChild(container)
        return container
    }

    private setup(): void {
        this.setupElectronCommunication()
        this.setupSideView()
    }

    private setupElectronCommunication(): void {
        window.ipcRenderer.on('load-file' , (response: LoadFileEvent) => this.loadFile(response.path, response.content))
        window.ipcRenderer.on('save' ,      ()                        => this.save())
    }

    private setupSideView(): void {
        if (this.sideViewEnabled) {
            this.sideView = new MetaView(this.sideViewContainer!)

            const vcsPreview = this.sideView.addView("vcs", root => {
                return new VCSPreview(root, this.getModel())
            }, (view: VCSPreview, model: MonacoModel) => {
                view.updateEditor(model)
            })

            const p5jsPreview = this.sideView.addView("p5js", root => {
                return new P5JSPreview(root)
            }, (view: P5JSPreview, code: string) => {
                view.update(code)
            })

            const versionManager = this.sideView.addView("versionManager", root => {
                return new VersionManagerView(root)
            }, (view: VersionManagerView, versions: VCSVersion[]) => {
                view.applyDiff(versions)
            })

            this.sideViewIdentifiers = this.sideView.identifiers
            this.defaultSideView     = this.sideViewIdentifiers.vcs
            this.showDefaultSideView()
        }
    }

    public showDefaultSideView(): void {
        if (this.sideViewEnabled) { this.sideView!.showView(this.defaultSideView!) }
    }

    public createChangeSet(event: MonacoChangeEvent): ChangeSet {
        return new ChangeSet(Date.now(), this.getModel(), this.getEolSymbol(), event)
    }

    public async applyChangeSet(changeSet: ChangeSet): Promise<void> {
        // forEach is a bitch for anything but synchronous arrays...
        const changedSnapshots = new Set(await this.vcs.applyChanges(changeSet))
        changedSnapshots.forEach(uuid => this.snapshotManager.getSnapshot(uuid)?.update())
    }

    public override sync(trigger: Synchronizable): void {
        throw new Error("Method not implemented.")
    }

    public async loadFile(filePath: string, content: string): Promise<void> {

        this.unloadFile()

        const uri = monaco.Uri.file(filePath)

        let model = monaco.editor.getModel(uri)
        if (model) {
            model.setValue(content)
        } else {
            model = monaco.editor.createModel(content, undefined, uri)
            this.setModel(model)
        }

        this.vcs.loadFile(filePath, this.getEolSymbol(), content)
        this.snapshotManager.loadSnapshots()
    }

    public update(text: string): void {
        this.interactionManager.withDisabledVcsSync(() => this.core.setValue(text) )
        this.snapshotManager.forEach(snapshot => snapshot.manualUpdate())
    }

    public save(): void {
        // TODO: make sure files without a path can be saved at new path!
        window.ipcRenderer.invoke('save-file', { path: this.path, content: this.text })
        if (this.path) this.vcs.updatePath(this.path)
    }

    public unloadFile(): void {
        this.snapshotManager.removeSnapshots()
        this.interactionManager.unloadFile()
        this.vcs.unloadFile()
    }
}