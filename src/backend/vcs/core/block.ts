import { IRange } from "../../../app/components/utils/range"
import { VCSTag, VCSSnapshotData } from "../../../app/components/vcs/vcs-provider-old"

import { LinkedList } from "../utils/linked-list"
import { Resource, ResourceManager } from "../utils/resource-manager"
import { BlockId, TagId } from "./metadata/ids"
import { LineType, LineNode, Line } from "./line"
import { InsertionState, LineContent, LineNodeVersion } from "./version"
import { Tag } from "./tag"
import { Disposable } from "../../../editor/utils/types"
import { Timestamp, TimestampProvider } from "./metadata/timestamps"
import { ISessionBlock, ISessionFile } from "../db/utilities"
import { BlockType, VCSBlockId, VCSBlockInfo, VCSBlockRange, VCSFileData, VCSFileId, VCSTagInfo, VCSUnwrappedText } from "../../../app/components/vcs/vcs-rework"
import { MultiLineChange } from "../../../app/components/data/change"

export type LinePosition = number  // absolute position within the root block, counting for both, visible and hidden lines
export type LineNumber   = number  // line number within the editor, if this line is displayed

type EOLSymbol    = string
type ChildBlock   = InlineBlock
type ClonedBlock  = ForkBlock

interface LineRange {
    startLine: number,
    endLine: number
}

export abstract class Block extends LinkedList<Line> implements Resource, ISessionFile, ISessionBlock<Block, LineNode, LineNodeVersion> {

    public get blockId(): string { return this.id }

    public readonly file: Block
    public readonly type: BlockType

    public async getText(): Promise<string> {
        return this.getCurrentText()
    }

    public async getUnwrappedText(): Promise<VCSUnwrappedText> {
        return { blockText: this.getCurrentText(), fullText: this.getFullText() }
    }

    public async applyTimestamp(timestamp: number): Promise<LineNodeVersion[]> {
        return this.map(line => line.loadTimestamp(timestamp))
    }

    public async cloneOutdatedHeads(heads: LineNodeVersion[]): Promise<void> {
        return // in this context, head tracking is already done more elegantly
    }

    public static createFromFileData(file: VCSFileData): Block {

    }






    public     id:         BlockId
    //public get filePath(): string | undefined { return this.manager.getFilePathForBlock(this) }

    public isDeleted: boolean = false

    public eol: EOLSymbol

    public origin?: Block  // block this was cloned from
    public parent?: Block  // block containing this block
    public children = new Map<BlockId, ChildBlock>()
    public tags     = new Map<TagId, Tag>()

    public    enableVersionMerging: boolean     = false
    protected lastModifiedLine:     Line | null = null

    public get firstLine(): Line | undefined { return this.first }
    public get lastLine():  Line | undefined { return this.last }

    public set firstLine(line: Line | undefined) { this.first = line }
    public set lastLine (line: Line | undefined) { this.last  = line }

    public get isRoot():   boolean { return this.parent === undefined }
    public get isCloned(): boolean { return this.origin !== undefined }



    // -------------------------------- Line Data Accessors ---------------------------------------

    public getRootBlock(): Block { return this.parent ? this.parent.getRootBlock() : this }

    public getFirstPosition(): LinePosition { return this.firstLine.getPosition() }
    public getLastPosition():  LinePosition { return this.lastLine.getPosition() }

    public getFirstLineNumber(): LineNumber { return this.getFirstActiveLine().getLineNumber() }
    public getLastLineNumber():  LineNumber { return this.getLastActiveLine().getLineNumber() }

    public getFirstLineNumberInParent(): LineNumber | null {
        if (!this.parent) { throw new Error("This Block does not have a parent! You cannot calculate its first line number in its parent.") }
        const parentLine = this.firstLine.getLineFor(this.parent)
        const activeLine = parentLine.isActive ? parentLine : parentLine.getNextActiveLine()
        const lineNumber = activeLine && this.containsPosition(activeLine.getPosition()) ? activeLine.getLineNumber() : null

        if (!lineNumber) { throw new Error("This indicates that this child is not visible in the parent! Such children are currently not handled well.") }

        return lineNumber
    }

    public getLastLineNumberInParent(): LineNumber | null {
        if (!this.parent) { throw new Error("This Block does not have a parent! You cannot calculate its last line number in its parent.") }
        const parentLine = this.lastLine.getLineFor(this.parent)
        const activeLine = parentLine.isActive ? parentLine : parentLine.getPreviousActiveLine()
        const lineNumber = activeLine && this.containsPosition(activeLine.getPosition()) ? activeLine.getLineNumber() : null

        if (!lineNumber) { throw new Error("This indicates that this child is not visible in the parent! Such children are currently not handled well.") }

        return lineNumber
    }

    public getFirstActiveLine(): Line | null { return this.firstLine.isActive ? this.firstLine : this.firstLine.getNextActiveLine() }
    public getLastActiveLine():  Line | null { return this.lastLine.isActive  ? this.lastLine  : this.lastLine.getPreviousActiveLine() }

    public getLineCount():       number        { return this.getLength() }
    public getActiveLineCount(): number | null { return this.getLastLineNumber() }

    public getLines():       Line[] { return this.toArray() }
    public getActiveLines(): Line[] { return this.filter(line => line.isActive) }

    public getLineContent(): LineContent[] { return this.getActiveLines().map(line => line.currentContent) }
    public getCurrentText(): string        { return this.getLineContent().join(this.eol) }

    public getFullText(selectedLines?: Map<LineNode, Line>): string {
        if (this.isRoot && !selectedLines) { return this.getCurrentText() }

        selectedLines = selectedLines ? selectedLines : new Map()
        this.forEach(line => { if (!selectedLines.has(line.node)) { selectedLines.set(line.node, line) } })

        if (this.parent) {
            return this.parent.getFullText(selectedLines)
        } else {
            return this.map(line => selectedLines.get(line.node)!.currentContent).join(this.eol)
        }
    }
    
    public getVersions():     LineNodeVersion[] { return this.flatMap(line => line.history.getVersions()) }
    public getVersionCount(): number            { return this.getVersions().length }


    public getTags():                     Tag[]        { return Array.from(this.tags.values()) }
    public getTagInfo(fileId: VCSFileId): VCSTagInfo[] { return this.getTags().map(tag => tag.asTagInfo(VCSBlockId.createFrom(fileId, this.blockId))) }


    public addToLines():                        Line[]  { return this.map(line => line.addBlock(this)) }
    public removeFromLines(deleting?: boolean): Block[] { return this.flatMap(line => line.removeBlock(this, deleting)) }



    // TODO: make sure this is actually working correctly
    public getLastModifiedLine(): Line | null { return this.lastModifiedLine }
    public setupVersionMerging(line: Line): void { if (this.enableVersionMerging) { this.lastModifiedLine = line } }
    public resetVersionMerging(): void { this.lastModifiedLine = null }



    public lineNumberToPosition(lineNumber: LineNumber): LinePosition {
        if (!this.containsLineNumber(lineNumber)) { throw new Error("Cannot convert invalid line number to position!") }
        return this.getLineByLineNumber(lineNumber).getPosition()
    }

    public positionToLineNumber(position: LinePosition): LineNumber {
        if (!this.containsPosition(position)) { throw new Error("Cannot convert invalid position to line number!") }
        return this.getLineByPosition(position).getLineNumber()
    }



    public containsPosition(position: LinePosition):   boolean { return this.getFirstPosition()   <= position   && position   <= this.getLastPosition() }
    public containsLineNumber(lineNumber: LineNumber): boolean { return this.getFirstLineNumber() <= lineNumber && lineNumber <= this.getLastLineNumber() }

    public containsRange(range: LineRange): boolean {
        const containsStart = this.containsLineNumber(range.startLine)
        const containsEnd   = this.containsLineNumber(range.endLine)
        return range.startLine <= range.endLine && containsStart && containsEnd
    }

    public overlapsWith(range: LineRange): boolean {
        return this.getFirstLineNumber() <= range.endLine && this.getLastLineNumber() >= range.startLine
    }



    public getLineByPosition(position: LinePosition): Line {
        if (!this.containsPosition(position)) { throw new Error(`Cannot read line for invalid position ${position}!`) }

        const line = this.find(line => line.getPosition() === position)
        if (!line) { throw new Error(`Could not find line for valid position ${position}!`) }

        return line
    }

    public getLineByLineNumber(lineNumber: LineNumber): Line {
        if (!this.containsLineNumber(lineNumber)) { throw new Error(`Cannot read line for invalid line number ${lineNumber}!`) }

        const line = this.find(line => line.getLineNumber() === lineNumber)
        if (!line) { throw new Error(`Could not find line for valid line number ${lineNumber}!`) }

        return line
    }

    public getLineRange(range: LineRange): Line[] {
        if (!this.containsRange(range)) { throw new Error(`Cannot read lines for invalid range ${range}`) }
        
        const lines = []

        let   current = this.getLineByLineNumber(range.startLine)
        const end     = this.getLineByLineNumber(range.endLine)

        while (current !== end) {
            lines.push(current)
            current = current.getNextActiveLine()
        }
        lines.push(end)

        return lines
    }

    protected setLineList(firstLine: Line, lastLine: Line): void {
        this.firstLine = firstLine
        this.lastLine  = lastLine
    }

    public updateHeadTracking(): void {
        this.forEach(line => line.updateHeadTracking())
    }


    // --------------------------------- Edit Mechanics ----------------------------------------

    public async insertLine(fileId: VCSFileId, lineNumber: LineNumber, content: LineContent): Promise<Line> {
        this.resetVersionMerging()

        const lastLineNumber     = this.getLastLineNumber()
        const newLastLine        = lastLineNumber + 1
        const adjustedLineNumber = Math.min(Math.max(lineNumber, 1), newLastLine)

        //const includedChildren = this.getChildrenByLineNumber(Math.min(adjustedLineNumber,     lastLineNumber))
        const expandedChildren = this.getChildrenByLineNumber(Math.min(adjustedLineNumber - 1, lastLineNumber))
        //const affectedChildren = Array.from(new Set(includedChildren.concat(expandedChildren)))

        let createdLine: Line

        if (adjustedLineNumber === 1) {
            const firstActive = this.getFirstActiveLine()
            createdLine = Line.create(this, LineType.Inserted, content, { 
                previous:    firstActive.previous,
                next:        firstActive,
                knownBlocks: firstActive.node.getBlocks()
            })

            if (!createdLine.previous) { 
                this.firstLine = createdLine
            }
        } else if (adjustedLineNumber === newLastLine) {
            const lastActive  = this.getLastActiveLine()
            createdLine = Line.create(this, LineType.Inserted, content, { 
                previous:    lastActive,
                next:        lastActive.next,
                knownBlocks: lastActive.node.getBlocks()
            })

            if (!createdLine.next) { 
                this.lastLine = createdLine
            }
        } else {
            const currentLine = this.getLineByLineNumber(adjustedLineNumber)
            createdLine = Line.create(this, LineType.Inserted, content, { 
                previous:    currentLine.previous, 
                next:        currentLine,
                knownBlocks: currentLine.node.getBlocks()
            })
        }

        await Promise.all(expandedChildren.map(async child => {
            const snapshotData = await child.asBlockInfo(fileId)
            const lineNumber   = createdLine.getLineNumber()
            if (snapshotData.range.endLine < lineNumber) {
                snapshotData.range.endLine = lineNumber
                child.updateInParent(fileId, snapshotData)
            }
        }))

        return createdLine
    }

    public async insertLines(fileId: VCSFileId, lineNumber: LineNumber, content: LineContent[]): Promise<Line[]> {
        return await Promise.all(content.map(async (content, index) => {
            return await this.insertLine(fileId, lineNumber + index, content)
        }))
    }

    public async updateLine(lineNumber: LineNumber, content: LineContent): Promise<LineNode> {
        const line = this.getLineByLineNumber(lineNumber)
        line.update(content)

        this.setupVersionMerging(line)

        return line.node
    }

    public async updateLines(lineNumber: LineNumber, content: LineContent[]): Promise<Line[]> {
        this.resetVersionMerging()

        const lines = this.getLineRange({ startLine: lineNumber, endLine: lineNumber + content.length - 1 })
        lines.forEach((line, index) => line.update(content[index]))
        return lines
    }

    public deleteLine(lineNumber: LineNumber): Line {
        this.resetVersionMerging()

        const line = this.getLineByLineNumber(lineNumber)
        line.delete()
        return line
    }

    public deleteLines(range: LineRange): Line[] {
        const lines = this.getLineRange(range)
        lines.forEach(line => line.delete())
        return lines
    }

    // -------------------------- Children Mechanics ---------------------------

    public async createChild(range: VCSBlockRange): Promise<ChildBlock | null> {

        const lineRange = { startLine: range.startLine, endLine: range.endLine }
        const overlappingSnapshot = this.getChildren().find(snapshot => snapshot.overlapsWith(lineRange))

        if (overlappingSnapshot) { 
            console.warn("Could not create snapshot due to overlap!")
            return null
        }

        const firstLine = this.getLineByLineNumber(range.startLine)
        const lastLine  = this.getLineByLineNumber(range.endLine)
        const child     = new InlineBlock(this, firstLine, lastLine)

        this.addChild(child)

        return child
    }

    public addChild(block: ChildBlock): void {
        this.children.set(block.id, block)
    }

    public getChild(blockId: BlockId): ChildBlock {
        if (!this.children.has(blockId)) { throw new Error(`Child Block with ID ${blockId} does not exist!`) }
        return this.children.get(blockId)
    }

    public getChildren(): ChildBlock[] { 
        return Array.from(this.children.values())
    }

    public getChildrenByPosition(position: LinePosition): ChildBlock[] {
        return this.getChildren().filter(child => child.containsPosition(position))
    }

    public getChildrenByLineNumber(lineNumber: LineNumber): ChildBlock[] {
        const position = this.lineNumberToPosition(lineNumber)
        return this.getChildrenByPosition(position)
    }

    public updateChild(fileId: VCSFileId, update: VCSBlockInfo): ChildBlock {
        const child = this.getChild(update.blockId)
        child.updateInParent(fileId, update)
        return child
    }

    public deleteChild(blockId: BlockId): void {
        this.getChild(blockId).delete()
        this.children.delete(blockId)
    }

    public delete(): Block[] {

        this.removeFromLines(true)
        this.parent?.children.delete(this.id)

        this.firstLine = undefined
        this.lastLine  = undefined

        const deletedBlocks = this.getChildren().flatMap(child => child.delete())
        deletedBlocks.push(this)

        this.isDeleted = true

        return deletedBlocks
    }



    // ---------------------- SNAPSHOT FUNCTIONALITY ------------------------

    public getHeads(): LineNodeVersion[] { return this.map(line => line.currentVersion) }

    public getOriginalLineCount(): number { return this.filter(line => !line.isInserted).length }
    public getUserVersionCount():  number { return this.getVersionCount() - this.getLineCount() + 1 }

    private getTimeline(): LineNodeVersion[] {
        const timeline = this.getVersions()
            .filter(version => { return !version.previous?.isPreInsertion })
            .sort((versionA, versionB) => versionA.timestamp - versionB.timestamp)
        timeline.splice(0, this.getOriginalLineCount() - 1) // remove the first unused original versions
        return timeline
    }

    // WARNING: This function is a bit wild. It assumes we cannot have any pre-insertion versions as current version, as those are invisible, and thus "not yet existing" (the lines, that is).
    // As a result it filters those. This function should ONLY BE USED WHEN YOU KNOW WHAT YOU DO. One example of that is the getCurrentVersionIndex, where the understanding of this
    // function is used to extract the timeline index that should be visualized by the UI.
    private getCurrentVersion(): LineNodeVersion {
        return this.getHeads().filter(head          => !head.isPreInsertion)
                              .sort( (headA, headB) => headB.timestamp - headA.timestamp)[0]
    }

    public getCurrentVersionIndex(): number {
        // establish correct latest hand in the timeline: as we do not include insertion version, but only pre-insertion, those are set to their related pre-insertion versions
        let currentVersion = this.getCurrentVersion()
        if (currentVersion.previous?.isPreInsertion) { currentVersion = currentVersion.previous }   // I know, this is wild. The idea is that we cannot have invisible lines as the current
                                                                                                          // version. At the same time the pre-insertion versions are the only ones present in
                                                                                                          // the timeline by default, because I can easily distinguished for further manipulation.
        //if (currentVersion.origin)                   { currentVersion = currentVersion.next }

        const timeline = this.getTimeline()
        const index    = timeline.indexOf(currentVersion, 0)

        if (index < 0) { throw new Error("Latest head not in timeline!") }

        return index
    }

    // THIS is the actual latest version in the timeline that is currently active. Unfortunately, there is no other easy way to calculate that...
    // WARNING: This may be the latest Version, but not the latest active version!!! This can only be calculated through head tracking!
    public getLatestVersion(): LineNodeVersion {
        return this.getTimeline()[this.getCurrentVersionIndex()]
    }

    public async applyIndex(targetIndex: number): Promise<LineNodeVersion[]> {
        // The concept works as follow: I create a timeline from all versions, sorted by timestamp. Then I limit the selecteable versions to all versions past the original file creation
        // (meaning versions that were in the file when loading it into the versioning are ignored), except for the last one (to recover the original state of a snapshot). This means the
        // index provided by the interface will be increased by the amount of such native lines - 1. This index will then select the version, which will be applied on all lines directly.
        // There are no clones anymore for deleted or modified lines (besides when editing past versions, cloning edited versions to the end). The trick to handle inserted lines works as
        // follows: I still require a deactiveated and an activated version with the actual contet. However, the timeline will only contain the deactivated one, the pre-insertion line.
        // When this line gets chosen by the user, I can decide how to process it: If it is already the head, the user likely meant to actually see the content of this line and I just apply
        // the next line with content. If it is currently not the head, the user likely meant to disable it, so it will be applied directly.
        // the only larger difficulty arises when the user decides to select this line, and then moves the selected index one to the left. This operation will trigger the version prior to
        // the actual insertion and can be completely unrelated. However, when leaving the insertion version, what the user really wants to do is hide it again. This can be checked by checking
        // the next version for each index, and it if is a pre-insertion version, then check wether the next version of it (the enabled one with actual content) is currently head. If that's the
        // case, then just apply the next version, aka the pre-insertion version, to hide it again.
        // The great thing about this method is, that, if the user jumps to the insertion version, it will be handled logically, even if the jump came from non-adjacent versions.

        this.resetVersionMerging()
        const timeline = this.getTimeline()

        if (targetIndex < 0 || targetIndex >= timeline.length) { throw new Error(`Target index ${targetIndex} out of bounds for timeline of length ${timeline.length}!`) }

        let   selectedVersion = timeline[targetIndex] // actually targeted version
        let   previousVersion = targetIndex - 1 >= 0              ? timeline[targetIndex - 1] : undefined
        let   nextVersion     = targetIndex + 1 < timeline.length ? timeline[targetIndex + 1] : undefined
        const latestVersion   = timeline[this.getCurrentVersionIndex()]

        // TO CONSIDER:
        // If I edit a bunch of lines not all in a snapshot, and then rewind the changes, only changing the previously untouched lines, then the order will remain intakt (thanks to head tracking)
        // but it can happen that the order of edits is weird (e.g., when one of these still original lines gets deleted, it immediately disappears instead of first being displayed).
        // This is because I do not clone these lines that were never edited. Thus, all changes are instant. This can be good, but it feels different from the average editing experience
        // that involves clones. I should think what the best course of action would be here...

        // Default case
        let version: LineNodeVersion = selectedVersion

        // If the previous version is selected and still on pre-insertion, disable pre-insertion
        // I am not sure if this case will ever occur, or is just transitively solved by the others... maybe I can figure that out at some point...
        if (previousVersion === latestVersion && previousVersion.insertionState(this) === InsertionState.PreInsertionEngaged) { version = previousVersion.next }
        // If the next version is selected and still on post-insertion, then set it to pre-insertion
        else if (nextVersion === latestVersion && nextVersion.insertionState(this) === InsertionState.PreInsertionReleased)   { version = nextVersion }
        // If the current version is pre-insertion, skip the pre-insertion phase if necessary
        else if (selectedVersion.isPreInsertion && (selectedVersion.isHeadOf(this) || nextVersion?.isHeadOf(this)))     { version = selectedVersion.next }

        //version.applyTo(this)
        return this.applyTimestamp(version.timestamp)
    }

    public async updateInParent(fileId: VCSFileId, range: VCSBlockInfo): Promise<Block[]> {
        if (!this.parent) { throw new Error("This Block does not have a parent! You cannot update its range within its parent.") }
        if (!this.parent.containsLineNumber(range.range.startLine)) { throw new Error("Start line is not in range of parent!") }
        if (!this.parent.containsLineNumber(range.range.endLine))   { throw new Error("End line is not in range of parent!") }

        const oldFirstLineNumber = this.getFirstLineNumber()
        const oldLastLineNumber  = this.getLastLineNumber()

        this.removeFromLines()
        const newFirstLine = this.parent.getLineByLineNumber(range.range.startLine)
        const newLastLine  = this.parent.getLineByLineNumber(range.range.endLine)
        this.setLineList(newFirstLine, newLastLine)

        const newFirstLineNumber = this.getFirstLineNumber()
        const newLastLineNumber  = this.getLastLineNumber()

        const results = await Promise.all(this.getChildren().map(async child => {

            const firstLineNumber = child.getFirstLineNumberInParent()
            const lastLineNumber  = child.getLastLineNumberInParent()

            if (firstLineNumber === oldFirstLineNumber || lastLineNumber === oldLastLineNumber) {
                const childRange = await child.asBlockInfo(VCSBlockId.createFrom(fileId, this.blockId))

                childRange.range.startLine = firstLineNumber === oldFirstLineNumber ? newFirstLineNumber : childRange.range.startLine
                childRange.range.endLine   = lastLineNumber  === oldLastLineNumber  ? newLastLineNumber  : childRange.range.endLine

                if (childRange.range.startLine > childRange.range.endLine) {  
                    return child.delete()
                } else {
                    return child.updateInParent(fileId, childRange)
                }
            } else {
                return []
            }
        }))

        const updatedBlocks = results.flat()
        updatedBlocks.push(this)
        return updatedBlocks
    }

    public async asBlockInfo(fileId: VCSFileId): Promise<VCSBlockInfo> {
        const parent = this
        return new VCSBlockInfo(VCSBlockId.createFrom(fileId, this.blockId),
                                this.type,
                                {
                                    startLine: this.getFirstLineNumberInParent(),
                                    endLine: this.getLastLineNumberInParent()
                                },
                                this.getUserVersionCount(),
                                this.getCurrentVersionIndex(),
                                this.getTagInfo(fileId))
    }

    public async getChildrenInfo(fileId: VCSFileId): Promise<VCSBlockInfo[]> {
        return await Promise.all(this.getChildren().map(async child => await child.asBlockInfo(VCSBlockId.createFrom(fileId, this.blockId))))
    }



    // ---------------------- TAG FUNCTIONALITY ------------------------

    protected createCurrentTag(): Tag {
        return new Tag(this, TimestampProvider.getLastTimestamp())
    }

    public createTag(fileId: VCSFileId): VCSTagInfo {

        const tag = this.createCurrentTag()
        this.tags.set(tag.id, tag)

        return tag.asTagInfo(VCSBlockId.createFrom(fileId, this.id))
    }

    public loadTag(id: TagId): string {
        const tag = this.tags.get(id)
        tag.applyTo(this)
        return this.getFullText()
    }

    public getTextForVersion(id: TagId): string {
        const recoveryPoint = this.createCurrentTag()
        const text          = this.loadTag(id)

        recoveryPoint.applyTo(this)

        return text
    }



    public async copy(): Promise<ClonedBlock> {
        const clone = new ForkBlock(this)
        //this.addChild(clone)
        return clone
    }

    // ------------------------- SUBSCRIPTION HANDLER ------------------------------------
    private readonly latestHeadSubscriptions: { (timestamp: Timestamp): void }[] = []

    public headChanged(): void {
        const lastTimestamp = TimestampProvider.getLastTimestamp()
        this.latestHeadSubscriptions.forEach(callback => callback(lastTimestamp))
    }

    public onHeadChanged(onChange: (timestamp: Timestamp) => void): Disposable {
        this.latestHeadSubscriptions.push(onChange)

        const parent = this
        return this.addSubscription({
            dispose() {
                const index = parent.latestHeadSubscriptions.indexOf(onChange, 0)
                if (index >= 0) { parent.latestHeadSubscriptions.splice(index, 1) }
            }
        })
    }

    // MAGIC INTERFACE SHIT

    public async changeLines(fileId: VCSFileId, change: MultiLineChange): Promise<VCSBlockId[]> {
        this.resetVersionMerging()


        const startsWithEol = change.insertedText[0] === this.eol
        const endsWithEol   = change.insertedText[change.insertedText.length - 1] === this.eol

        const insertedAtStartOfStartLine = change.modifiedRange.startColumn === 1
        const insertedAtEndOfStartLine = change.modifiedRange.startColumn > this.getLineByLineNumber(change.modifiedRange.startLineNumber).currentContent.length

        const insertedAtEnd   = change.modifiedRange.endColumn > this.getLineByLineNumber(change.modifiedRange.endLineNumber).currentContent.length

        const oneLineModification = change.modifiedRange.startLineNumber === change.modifiedRange.endLineNumber
        const insertOnly = oneLineModification && change.modifiedRange.startColumn == change.modifiedRange.endColumn

        const pushStartLineDown = insertedAtStartOfStartLine && endsWithEol  // start line is not modified and will be below the inserted lines
        const pushStartLineUp   = insertedAtEndOfStartLine && startsWithEol  // start line is not modified and will be above the inserted lines

        const modifyStartLine = !insertOnly || (!pushStartLineDown && !pushStartLineUp)


        const modifiedRange = {
            startLine: change.modifiedRange.startLineNumber,
            endLine:   change.modifiedRange.endLineNumber
        }

        let vcsLines: Line[] = []
        const modifiedLines = change.lineText.split(this.eol)

        if (modifyStartLine) {
            vcsLines = this.getLineRange(modifiedRange)
        } else {
            // TODO: pushStartDown case not handled well yet, line tracking is off
            if (pushStartLineUp) { 
                modifiedRange.startLine--
                modifiedRange.endLine--
            }
        }
        


        const parent = this
        let affectedLines: Line[] = []
        function deleteLine(line: Line): void {
            line.delete()
            affectedLines.push(line)
        }

        function updateLine(line: Line, newContent: string): void {
            line.update(newContent)
            affectedLines.push(line)
        }

        async function insertLine(lineNumber: number, content: string): Promise<void> {
            const line = await parent.insertLine(fileId, lineNumber, content)
            affectedLines.push(line)
        }



        for (let i = vcsLines.length - 1; i >= modifiedLines.length; i--) {
            const line = vcsLines.at(i)
            deleteLine(line)
        }

        /*
        // inverse deletion order
        for (let i = modifiedLines.length; i < vcsLines.length; i++) {
            const line = vcsLines.at(i)
            deleteLine(line)
        }
        */

        if (modifyStartLine) { updateLine(vcsLines.at(0), modifiedLines[0]) }

        for (let i = 1; i < modifiedLines.length; i++) {
            if (i < vcsLines.length) {
                const line = vcsLines.at(i)
                updateLine(line, modifiedLines[i])
            } else {
                await insertLine(modifiedRange.startLine + i, modifiedLines[i])
            }
        }

        // TODO: simplify
        return affectedLines.map(line => line.getAffectedBlockIds()).flat().map(id => VCSBlockId.createFrom(fileId, id))
    }
}

export class InlineBlock extends Block {

    public constructor(parent: Block, firstLine: Line, lastLine: Line, enableVersionMerging?: boolean) {
        super()

        this.eol                  = parent.eol
        this.parent               = parent
        this.firstLine            = firstLine
        this.lastLine             = lastLine
        this.enableVersionMerging = enableVersionMerging ? enableVersionMerging : parent.enableVersionMerging

        this.addToLines()
    }
}

export interface ForkBlockOptions {
    id:                    BlockId
    eol:                   EOLSymbol
    filePath?:             string
    parent?:               Block
    firstLine?:            LineNode
    lastLine?:             LineNode
    content?:              string
    enableVersionMerging?: boolean
}

export class ForkBlock extends Block {

    public constructor(options: ForkBlockOptions | Block) {
        super()

        const blockOptions = options as ForkBlockOptions
        const clonedBlock  = options as Block

        let firstLineNode: LineNode | undefined = undefined
        let lastLineNode:  LineNode | undefined = undefined

        if (blockOptions) {
            this.id                   =
            this.eol                  = blockOptions.eol
            this.parent               = blockOptions.parent
            this.enableVersionMerging = blockOptions.enableVersionMerging ? blockOptions.enableVersionMerging : false

            firstLineNode = blockOptions.firstLine
            lastLineNode  = blockOptions.lastLine

            const content = blockOptions.content
            if      (!firstLineNode && !lastLineNode) { this.setContent(content ? content : "") }
            else if (content)                         { throw new Error("You cannot set a first or last line and define content at the same time, as this will lead to conflicts in constructing a block.") }
        } else if (clonedBlock) {
            throw new Error("WHYYY")
            this.id                   = ""
            this.isDeleted            = clonedBlock.isDeleted
            this.eol                  = clonedBlock.eol
            this.origin               = clonedBlock
            this.parent               = clonedBlock.parent
            this.children             = clonedBlock.children
            this.tags                 = clonedBlock.tags
            this.enableVersionMerging = clonedBlock.enableVersionMerging

            firstLineNode            = clonedBlock.firstLine?.node
            lastLineNode             = clonedBlock.lastLine?.node
        } else {
            throw new Error("The options provided for this ForkBlock are in an incompatiple format!")
        }

        if      ( firstLineNode && !lastLineNode) { lastLineNode  = firstLineNode }
        else if (!firstLineNode &&  lastLineNode) { firstLineNode = lastLineNode }

        if (firstLineNode && lastLineNode) { this.setLineNodes(firstLineNode, lastLineNode) }
    }

    protected override setLineList(firstLine: Line, lastLine: Line): void {
        this.setLineNodes(firstLine.node, lastLine.node)
    }

    private setLineNodes(firstLineNode: LineNode, lastLineNode: LineNode) {
        const lines: Line[]  = []

        let current = firstLineNode
        while (current && current !== lastLineNode) {
            lines.push(current.addBlock(this))
            current = current.next
        }

        if (current && current === lastLineNode) { lines.push(current.addBlock(this)) }

        if (lines.length > 0) {
            this.firstLine = lines[0]
            this.lastLine  = lines[lines.length - 1]
        }
    }

    public setContent(content: string): void {
        const lineStrings = content.split(this.eol)
        const lines = lineStrings.map(content => Line.create(this, LineType.Original, content))
        this.setLines(lines)
    }

    public setLines(lines: Line[]): void {
        this.removeFromLines(true)

        const lineCount = lines.length
        let  previous: Line | undefined = undefined
        lines.forEach((current: Line, index: number) => {
            current.previous = previous
            if (index + 1 < lineCount) { current.next = lines[index + 1] }
            previous = current
            current.addBlock(this)
        })

        this.firstLine = lineCount > 0 ? lines[0]             : undefined
        this.lastLine  = lineCount > 0 ? lines[lineCount - 1] : undefined
    }
}