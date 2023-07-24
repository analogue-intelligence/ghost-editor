import { VCSVersion } from "../../../../app/components/data/version";
import { VCSBlockSession } from "../../../../app/components/vcs/vcs-rework";
import { Synchronizer } from "../../../utils/synchronizer";
import { Button, IconButton } from "../../components/button";
import { GhostBlockSessionLoadingOptions, GhostEditor } from "../editor/editor";
import { P5JSPreview } from "../previews/p5js-preview";
import { VersionViewContainer, VersionViewElement } from "./version-view";

export class VersionCodeView<Container extends VersionViewContainer<VCSVersion, VersionCodeView<Container>>> extends VersionViewElement<VCSVersion, VersionCodeView<Container>, Container> {

    public readonly languageId?: string

    private readonly listElement:      HTMLLIElement
    private readonly menuContainer:    HTMLDivElement
    private readonly editorContainer:  HTMLDivElement
    private readonly editor:           GhostEditor

    private readonly editorHeight = 350
    private readonly menuSpacing  = 40

    public get style(): CSSStyleDeclaration { return this.listElement.style }

    public constructor(root: Container, version: VCSVersion, session: VCSBlockSession, languageId?: string, synchronizer?: Synchronizer) {
        super(root, version)
        this.languageId = languageId

        this.listElement = document.createElement("li")
        this.style.boxSizing = "border-box"
        this.style.width     = "100%"
        this.style.height    = `${this.editorHeight}px`
        this.style.padding   = "5px 5px"
        this.style.margin    = "0 0"
        this.root.appendChild(this.listElement)
        
        this.menuContainer   = document.createElement("div")
        this.editorContainer = document.createElement("div")

        this.setupMenu()
        this.setupEditor()

        this.editor = GhostEditor.createEditorFromSession(this.editorContainer, new GhostBlockSessionLoadingOptions(session), { enableSideView: true, mainViewFlex: 3, languageId: this.languageId, synchronizer })
    }

    private setupMenu(): void {
        
        const parent = this
        function createSeperator(): HTMLDivElement {
            const seperator = document.createElement("div")
            seperator.style.display        = "flex"
            seperator.style.justifyContent = "center"
            seperator.style.width          = "100%"
            seperator.style.padding        = "0"
            seperator.style.margin         = "0"
            seperator.style.borderBottom   = "1px solid black"
            parent.menuContainer.appendChild(seperator)

            return seperator
        }

        this.menuContainer.style.boxSizing   = "border-box"
        this.menuContainer.style.float       = "left"
        this.menuContainer.style.width       = `${this.menuSpacing}px`
        this.menuContainer.style.height      = "100%"
        this.menuContainer.style.padding     = "0"
        this.menuContainer.style.margin      = "0"
        this.menuContainer.style.border      = "1px solid black"
        this.menuContainer.style.borderRight = "none"
        this.listElement.appendChild(this.menuContainer)

        const copyButton = IconButton.copyButton(createSeperator(), async () => { 
            console.log("COPY")
        })

        const addButton = Button.addButton(createSeperator(), async () => { 
            console.log("ADDING")
        })
    }

    private setupEditor(): void {
        this.editorContainer.style.boxSizing = "border-box"
        this.editorContainer.style.float     = "left"
        this.editorContainer.style.width     = `calc(100% - ${this.menuSpacing}px)`
        this.editorContainer.style.height    = "100%"
        this.editorContainer.style.padding   = "0"
        this.editorContainer.style.margin    = "0"
        this.editorContainer.style.border    = "1px solid black"
        this.listElement.appendChild(this.editorContainer)
    }

    public override remove(): void {
        this.editor.remove()
        this.listElement.remove()
        super.remove()
    }
}

export class VersionCodeViewList extends VersionViewContainer<VCSVersion, VersionCodeView<VersionCodeViewList>> {

    private          languageId?:         string
    private readonly editorSynchronizer?: Synchronizer

    public constructor(root: HTMLElement, languageId?: string, synchronizer?: Synchronizer) {

        root.style.overflow = "auto"

        const list = document.createElement("ul")
        list.style.listStyleType = "none"
        list.style.width         = "100%"
        list.style.padding       = "0 0"
        list.style.margin        = "0 0"
        root.appendChild(list)

        super(list)

        this.languageId         = languageId
        this.editorSynchronizer = synchronizer
    }

    public setLanguageId(languageId: string): void { this.languageId = languageId }

    protected override async createCustomView(version: VCSVersion): Promise<VersionCodeView<VersionCodeViewList>> {
        const session = await version.getSession()
        return new VersionCodeView(this as VersionCodeViewList, version, session, this.languageId, this.editorSynchronizer)
    }
}