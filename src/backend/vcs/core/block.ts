import { IRange } from "../../../app/components/utils/range"
import { VCSTag, VCSSnapshotData } from "../../../app/components/data/snapshot"

import { LinkedList } from "../utils/linked-list"
import { Resource, ResourceManager } from "../utils/resource-manager"
import { BlockId, TagId } from "./metadata/ids"
import { LineType, LineNode, Line } from "./line"
import { InsertionState, LineContent, LineNodeVersion } from "./version"
import { Tag } from "./tag"
import { Disposable } from "../../../editor/utils/types"
import { Timestamp, TimestampProvider } from "./metadata/timestamps"
import { BlockProxy, FileProxy, LineProxy, VersionProxy } from "../db/types"
import { prismaClient } from "../db/client"
import { PrismaPromise, Version, VersionType } from "@prisma/client"

export type LinePosition = number  // absolute position within the root block, counting for both, visible and hidden lines
export type LineNumber   = number  // line number within the editor, if this line is displayed

type EOLSymbol    = string
type ChildBlock   = InlineBlock
type ClonedBlock  = ForkBlock

interface LineRange {
    startLine: number,
    endLine: number
}


export class DBBlock {

    private readonly data: BlockProxy
    private get id(): number { return this.data.id }
    private get file(): FileProxy { return this.data.file }

    public constructor(block: BlockProxy) {
        this.data = block
    }



    public readonly getFile = () => this.file.getFile()

    public readonly getBlock = () => prismaClient.block.findUniqueOrThrow({ where: { id: this.id } })

    public readonly getLineCount = () => prismaClient.line.count({
        where: {
            fileId: this.file.id,
            blocks: { some: { id: this.id } }
        }
    })

    public readonly getActiveLineCount = () => prismaClient.line.count({
        where: {
            fileId: this.file.id,
            heads: {
                some: {
                    blockId: this.id,
                    version: { isActive: true }
                }
            } 
        }
    })

    public readonly getVersionCount = () => prismaClient.version.count({ where: { line: { blocks: { some: { id: this.id } } } } })

    public readonly getChildrenCount = () => prismaClient.block.count({ where: { parentId: this.id } })

    public readonly getHeadsWithLines = () => prismaClient.head.findMany({ where: { blockId: this.id }, include: { line: true } })

    public readonly getActiveHeads = () => prismaClient.head.findMany({
        where:   { blockId: this.id, version: { isActive: true } },
        orderBy: { line: { order: "asc" } },
    })

    public readonly getActiveLines = () => prismaClient.line.findMany({
        where:   { heads: { some: { blockId: this.id, version: { isActive: true } } } },
        orderBy: { order: "asc" }
    })

    public readonly getActiveVersions = () => prismaClient.version.findMany({
        where: {
            isActive: true,
            heads:    { some: { blockId: this.id } }
        },
        orderBy: {
            line: { order: "asc" }
        }
    })

    public readonly getChildren = () => prismaClient.block.findMany({ where: { parentId: this.id } })

    public readonly getTags = () => prismaClient.tag.findMany({ where: { blockId: this.id }, include: { block: { select: { blockId: true } } } })

    public readonly getTimeline = () => prismaClient.version.findMany({
        where: {
            line:        { blocks: { some: { id: this.id } } },
            versionType: { notIn: [VersionType.IMPORTED, VersionType.INSERTION] }
        },
        orderBy: {
            timestamp: "asc"
        }
    })

    public readonly getCurrentVersion = () => prismaClient.version.findFirstOrThrow({
        where: {
            heads:       { some: { block: { id: this.id } } },
            versionType: { notIn: [VersionType.IMPORTED, VersionType.PRE_INSERTION] }
        },
        orderBy: { timestamp: "desc" }
    })

    public readonly getTimelineIndexFor = (version: Version) => prismaClient.version.count({
        where: {
            line:        { blocks: { some: { id: this.id } } },
            versionType: { notIn: [VersionType.IMPORTED, VersionType.INSERTION] },
            timestamp:   { lte: version.timestamp }
        }
    }).then(position => position - 1)





    public async getText(): Promise<string> {
        const [file, versions] = await prismaClient.$transaction([
            this.getFile(),
            this.getActiveVersions()
        ])

        const content = versions.map(version => version.content)
        return content.join(file.eol)
    }

    public async getFullText(selectedLines?: Map<LineNode, Line>): Promise<{ blockText: string, fullText: string }> {
        if (this.isRoot && !selectedLines) { return this.getCurrentText() }

        selectedLines = selectedLines ? selectedLines : new Map()
        this.forEach(line => { if (!selectedLines.has(line.node)) { selectedLines.set(line.node, line) } })

        if (this.parent) {
            return this.parent.getFullText(selectedLines)
        } else {
            return this.map(line => selectedLines.get(line.node)!.currentContent).join(this.eol)
        }
    }

    public async insertLine(lineNumber: LineNumber, content: LineContent): Promise<LineProxy> {
        //this.resetVersionMerging()

        const activeLines = await this.getActiveLines()

        const lastLineNumber     = activeLines.length
        const newLastLine        = lastLineNumber + 1
        const adjustedLineNumber = Math.min(Math.max(lineNumber, 1), newLastLine)

        /*
        const expandedLine     = activeLines[Math.min(adjustedLineNumber - 1, lastLineNumber) - 1]
        const expandedChildren = expandedLine.blocks
        */

        let createdLine: LineProxy

        if (adjustedLineNumber === 1) {
            const { line, v0, v1 } = await this.data.prependLine(content) // TODO: could be optimized by getting previous line from file lines

            const firstLine = new LineProxy(activeLines[0].id, this.file)
            const blocks = await firstLine.getBlocks()
            const headMap = new Map(blocks.map(block => [new BlockProxy(block.id, this.file), block.id === this.id ? v1 : v0]))
            await line.addBlocks(headMap)

            createdLine = line
        } else if (adjustedLineNumber === newLastLine) {
            const { line, v0, v1 } = await this.data.appendLine(content) // TODO: could be optimized by getting previous line from file lines

            const lastLine = new LineProxy(activeLines[lastLineNumber - 1].id, this.file)
            const blocks   = await lastLine.getBlocks()
            const headMap  = new Map(blocks.map(block => [new BlockProxy(block.id, this.file), block.id === this.id ? v1 : v0]))
            await line.addBlocks(headMap)

            createdLine = line
        } else {
            const previousLine = activeLines[adjustedLineNumber - 2]
            const currentLine  = activeLines[adjustedLineNumber - 1]

            const previousLineProxy = new LineProxy(previousLine.id, this.file)
            const currentLineProxy  = new LineProxy(currentLine.id, this.file)

            const { line, v0, v1 } = await this.data.insertLine(content, { previous: previousLineProxy, next: currentLineProxy })

            const blocks  = await currentLineProxy.getBlocks()
            const headMap = new Map(blocks.map(block => [new BlockProxy(block.id, this.file), block.id === this.id ? v1 : v0]))
            await line.addBlocks(headMap)

            createdLine = line
        }

        /*
        expandedChildren.forEach(child => {
            const snapshotData = child.compressForParent()
            const lineNumber   = createdLine.getLineNumber()
            if (snapshotData._endLine < lineNumber) {
                snapshotData._endLine = lineNumber
                child.updateInParent(snapshotData)
            }
        })
        */

        return createdLine
    }
    
    public async createChild(range: IRange): Promise<BlockProxy | null> {

        const [block, childrenCount, activeHeads] = await prismaClient.$transaction([
            this.getBlock(),
            this.getChildrenCount(),
            this.getActiveHeads()
        ])

        const lineIdsInRange = activeHeads
                                    .filter((_, index) => range.startLineNumber <= index + 1 && index + 1 <= range.endLineNumber)
                                    .map(head => head.lineId)
        const overlappingChild = await prismaClient.block.findFirst({
            where: {
                parentId: this.id,
                lines: { some: { id: { in: lineIdsInRange } } }
            }
        })

        if (overlappingChild) {
            console.warn("Could not create snapshot due to overlap!")
            return null
        }

        const headInfo = new Map(activeHeads.map(head => [new LineProxy(head.lineId, this.file), new VersionProxy(head.versionId)]))
        const child    = await BlockProxy.create(block.blockId + ":child" + childrenCount, this.file, { parent: this.data, headInfo: headInfo })

        return child
    }

    public async asSnapshotData(): Promise<VCSSnapshotData> {

        const [block, lineCount, activeLineCount, versionCount, firstLine, currentVersion, tags] = await prismaClient.$transaction([
            this.getBlock(),
            this.getLineCount(),
            this.getActiveLineCount(),
            this.getVersionCount(),

            prismaClient.line.findFirstOrThrow({
                where: {
                    fileId: this.file.id,
                    blocks: { some: { id: this.id } } 
                },
                orderBy: { order: "asc"  },
                select: { id: true, order: true }
            }),

            this.getCurrentVersion(),
            this.getTags()
        ])

        if (activeLineCount === 0) { throw new Error("Block has no active lines, and can thus not be positioned in parent!") }

        let   firstLineNumberInParent = 1
        let   lastLineNumberInParent  = activeLineCount
        const userVersionCount        = versionCount - lineCount + 1  // one selectable version per version minus pre-insertion versions (one per inserted line) and imported lines (which, together, is the same as all lines) plus one version for the original state of the file

        if (block.parentId) {
            const activeLinesBeforeBlock = await prismaClient.line.count({
                where: {
                    fileId: this.file.id,
                    blocks: { none: { id: this.id } },     // line is not part of this block,
                    heads: {                               // but has a head (aka is part of) the parent block
                        some: {
                            blockId: block.parentId,
                            version: { isActive: true }
                        }
                    },
                    order: { lt: firstLine.order },        // only lines before the block
                }
            })
    
            firstLineNumberInParent = activeLinesBeforeBlock + 1
            lastLineNumberInParent  = activeLinesBeforeBlock + activeLineCount
        }

        const currentVersionIndex = await this.getTimelineIndexFor(currentVersion)

        return {
            uuid:         block.blockId,
            _startLine:   firstLineNumberInParent,
            _endLine:     lastLineNumberInParent,
            versionCount: userVersionCount,
            versionIndex: currentVersionIndex,
            tags:         tags.map(tag => {
                return {
                    id:                  tag.tagId,
                    blockId:             tag.block.blockId,
                    name:                tag.name,
                    text:                tag.code,
                    automaticSuggestion: false
                }
            })
        }
    }

    public async getSnapshotData(): Promise<VCSSnapshotData[]> {
        const children = await this.getChildren()
        const blocks = children.map(child => new DBBlock(new BlockProxy(child.id, this.file)))
        return await Promise.all(blocks.map(block => block.asSnapshotData()))
    }

    public async updateLine(lineNumber: LineNumber, content: LineContent): Promise<LineProxy> {
        const lines = await this.getActiveLines()

        const line = new LineProxy(lines[lineNumber - 1].id, this.file)
        await line.updateContent(content, this.data)

        //this.setupVersionMerging(line)

        return line
    }

    public async applyIndex(targetIndex: number): Promise<void> {

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

        //this.resetVersionMerging()

        const [timeline, currentVersion] = await prismaClient.$transaction([
            this.getTimeline(),
            this.getCurrentVersion()
        ])

        const latestVersionIndex = await this.getTimelineIndexFor(currentVersion)

        if (targetIndex < 0 || targetIndex >= timeline.length) { throw new Error(`Target index ${targetIndex} out of bounds for timeline of length ${timeline.length}!`) }

        let   selectedVersion = timeline[targetIndex] // actually targeted version
        let   previousVersion = targetIndex - 1 >= 0              ? timeline[targetIndex - 1] : undefined
        let   nextVersion     = targetIndex + 1 < timeline.length ? timeline[targetIndex + 1] : undefined
        const latestVersion   = timeline[latestVersionIndex]

        // TO CONSIDER:
        // If I edit a bunch of lines not all in a snapshot, and then rewind the changes, only changing the previously untouched lines, then the order will remain intakt (thanks to head tracking)
        // but it can happen that the order of edits is weird (e.g., when one of these still original lines gets deleted, it immediately disappears instead of first being displayed).
        // This is because I do not clone these lines that were never edited. Thus, all changes are instant. This can be good, but it feels different from the average editing experience
        // that involves clones. I should think what the best course of action would be here...

        // Default case
        let version: Version = selectedVersion

        // If the previous version is selected and still on pre-insertion, disable pre-insertion
        // NOTE: I am not sure if this case will ever occur, or is just transitively solved by the others... maybe I can figure that out at some point...
        if (previousVersion?.id === latestVersion.id && previousVersion.insertionState(this) === InsertionState.PreInsertionEngaged) { version = previousVersion.next }
        // If the next version is selected and still on post-insertion, then set it to pre-insertion
        else if (nextVersion?.id === latestVersion.id && nextVersion.insertionState(this) === InsertionState.PreInsertionReleased)   { version = nextVersion }
        // If the current version is pre-insertion, skip the pre-insertion phase if necessary
        else if (selectedVersion.versionType === VersionType.PRE_INSERTION && (selectedVersion.isHeadOf(this) || nextVersion?.isHeadOf(this)))           { version = selectedVersion.next }

        await this.applyTimestamp(version.timestamp)
    }

    public async applyTimestamp(timestamp: number): Promise<void> {
        const heads = await this.getHeadsWithLines()
        const lines = heads.map(head => head.line)
        
        // latest version for lines before or equal to timestamp
        const versions = await prismaClient.$transaction(lines.map(line => {
            return prismaClient.version.findFirst({
                where: {
                    lineId: line.id,
                    timestamp: { lte: timestamp }
                },
                orderBy: {
                    timestamp: "desc"
                }
            })
        }))

        // latest tracked version for lines before or equal to timestamp
        const trackedVersions = await prismaClient.$transaction(lines.map(line => {
            return prismaClient.trackedVersion.findFirst({
                where: {
                    lineId: line.id,
                    timestamp: { lte: timestamp }
                },
                orderBy: { timestamp: "desc" },
                include: { version: true }
            })
        }))

        // update head for each line with whatever has the latest timestamp, the latest version or the latest tracked version
        await prismaClient.$transaction(heads.map((head, index) => {
            const version  = versions[index]
            const tracked  = trackedVersions[index]
            const selected = version.timestamp >= tracked.timestamp ? version : tracked

            return prismaClient.head.update({
                where: { id: head.id },
                data:  { versionId: selected.id }
            })
        }))
    }


    // TODO: used for updateChild, which is probably not actually used (lol)
    public async updateInParent(range: VCSSnapshotData): Promise<Block[]> {
        throw new Error("This method is currently not finished because it is probably not even used lol.")

        const block  = await prismaClient.block.findUniqueOrThrow({
            where:   { id: this.id }, 
            include: { 
                parent: { 
                    include: { lines: true } 
                } 
            } 
        })

        const parent = block.parent
        if (!parent) { throw new Error("Cannot update a block without parent relative to its parent.") }

        const [parentLineCount, oldFirstLine, oldLastLine] = await prismaClient.$transaction([

            prismaClient.line.count({ where: { blocks: { some: { id: parent.id } } } }),

            prismaClient.line.findFirstOrThrow({
                where: {
                    fileId: this.file.id,
                    blocks: { some: { id: this.id } } 
                },
                orderBy: { order: "asc"  },
                select: { id: true, order: true }
            }),

            prismaClient.line.findFirstOrThrow({
                where: {
                    fileId: this.file.id,
                    blocks: { some: { id: this.id } } 
                },
                orderBy: { order: "desc"  },
                select: { id: true, order: true }
            }),
        ])


        if (parentLineCount < range._startLine) { throw new Error("Start line is not in range of parent!") }
        if (parentLineCount < range._endLine)   { throw new Error("End line is not in range of parent!") }

        const newFirstLine = parent.lines[range._startLine - 1]
        const newLastLine  = parent.lines[range._endLine   - 1]

        if (oldFirstLine.order < newFirstLine.order) {
            const childrenToModify = await prismaClient.block.findMany({
                where: {
                    fileId:   this.file.id,
                    parentId: this.id,
                    lines:    { some: { order: { lte: newFirstLine.order } } }
                }
            })

            const affectedLines  = parent.lines.filter(line => line.order >= oldFirstLine.order && line.order < newFirstLine.order)
            const affectedBlocks = childrenToModify.concat(block)

            if (affectedLines.length < affectedBlocks.length) {
                const updates = affectedLines.map(line => {
                    return prismaClient.line.update({
                        where: { id: line.id },
                        data:  {
                            blocks: { disconnect: affectedBlocks.map(block => { return { id: block.id } }) },
                            heads:  { deleteMany: { id: { in: affectedBlocks.map(block => block.id) } } }
                        }
                    })
                })

                await prismaClient.$transaction(updates)
            } else {
                const updates = affectedBlocks.map(block => {
                    return prismaClient.block.update({
                        where: { id: block.id },
                        data:  {
                            lines: { disconnect: affectedLines.map(line => { return { id: line.id } }) },
                            heads: { deleteMany: { id: { in: affectedLines.map(line => line.id) } } }
                        }
                    })
                })

                await prismaClient.$transaction(updates)
            }
        } else if (oldFirstLine.order > newFirstLine.order) {
            const childrenToModify = await prismaClient.block.findMany({
                where: {
                    fileId:   this.file.id,
                    parentId: this.id,
                    lines:    { some: { order: { lte: newFirstLine.order } } }
                }
            })


            // TODO: add new lines to block
            // DESIGN: SHOULD THIS EVEN EXPAND?
        }

        if (oldLastLine.order > newLastLine.order) {
            // TODO: remove lines from block
            // NODE: BASICALLY COPY IMPLEMENTATON FROM ABOVE
        } else if (oldFirstLine.order < newLastLine.order) {
            // TODO: add new lines to block
            // DESIGN: SHOULD THIS EVEN EXPAND?
        }

        // TODO: return updatedBlocks
    }
}






export abstract class Block extends LinkedList<Line> implements Resource {

    public     manager:    ResourceManager
    public     id:         BlockId
    public get filePath(): string | undefined { return this.manager.getFilePathForBlock(this) }

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


    public getTags():    Tag[]    { return Array.from(this.tags.values()) }
    public getTagData(): VCSTag[] { return this.getTags().map(tag => tag.asTagData()) }


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

    public insertLine(lineNumber: LineNumber, content: LineContent): Line {
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

        expandedChildren.forEach(child => {
            const snapshotData = child.compressForParent()
            const lineNumber   = createdLine.getLineNumber()
            if (snapshotData._endLine < lineNumber) {
                snapshotData._endLine = lineNumber
                child.updateInParent(snapshotData)
            }
        })

        return createdLine
    }

    public insertLines(lineNumber: LineNumber, content: LineContent[]): Line[] {
        return content.map((content, index) => {
            return this.insertLine(lineNumber + index, content)
        })
    }

    public updateLine(lineNumber: LineNumber, content: LineContent): Line {
        const line = this.getLineByLineNumber(lineNumber)
        line.update(content)

        this.setupVersionMerging(line)

        return line
    }

    public updateLines(lineNumber: LineNumber, content: LineContent[]): Line[] {
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

    public createChild(range: IRange): ChildBlock | null {

        const lineRange = { startLine: range.startLineNumber, endLine: range.endLineNumber }
        const overlappingSnapshot = this.getChildren().find(snapshot => snapshot.overlapsWith(lineRange))

        if (overlappingSnapshot) { 
            console.warn("Could not create snapshot due to overlap!")
            return null
        }

        const firstLine = this.getLineByLineNumber(range.startLineNumber)
        const lastLine  = this.getLineByLineNumber(range.endLineNumber)
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

    public updateChild(update: VCSSnapshotData): ChildBlock {
        const child = this.getChild(update.uuid)
        child.updateInParent(update)
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

    public applyIndex(targetIndex: number): void {
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

        version.applyTo(this)
    }

    public updateInParent(range: VCSSnapshotData): Block[] {
        if (!this.parent) { throw new Error("This Block does not have a parent! You cannot update its range within its parent.") }
        if (!this.parent.containsLineNumber(range._startLine)) { throw new Error("Start line is not in range of parent!") }
        if (!this.parent.containsLineNumber(range._endLine))   { throw new Error("End line is not in range of parent!") }

        const oldFirstLineNumber = this.getFirstLineNumber()
        const oldLastLineNumber  = this.getLastLineNumber()

        this.removeFromLines()
        const newFirstLine = this.parent.getLineByLineNumber(range._startLine)
        const newLastLine  = this.parent.getLineByLineNumber(range._endLine)
        this.setLineList(newFirstLine, newLastLine)

        const newFirstLineNumber = this.getFirstLineNumber()
        const newLastLineNumber  = this.getLastLineNumber()

        const updatedBlocks = this.getChildren().flatMap(child => {

            const firstLineNumber = child.getFirstLineNumberInParent()
            const lastLineNumber  = child.getLastLineNumberInParent()

            if (firstLineNumber === oldFirstLineNumber || lastLineNumber === oldLastLineNumber) {
                const childRange = child.compressForParent()

                childRange._startLine = firstLineNumber === oldFirstLineNumber ? newFirstLineNumber : childRange._startLine
                childRange._endLine   = lastLineNumber  === oldLastLineNumber  ? newLastLineNumber  : childRange._endLine

                if (childRange._startLine > childRange._endLine) {  
                    return child.delete()
                } else {
                    return child.updateInParent(childRange)
                }
            } else {
                return []
            }
        })

        updatedBlocks.push(this)
        return updatedBlocks
    }

    public compressForParent(): VCSSnapshotData {
        const parent = this
        return {
            uuid:         parent.id,
            _startLine:   parent.getFirstLineNumberInParent(),
            _endLine:     parent.getLastLineNumberInParent(),
            versionCount: parent.getUserVersionCount(),
            versionIndex: parent.getCurrentVersionIndex(),
            tags:         parent.getTagData()
        }
    }

    public getCompressedChildren(): VCSSnapshotData[] {
        return this.getChildren().map(child => child.compressForParent())
    }



    // ---------------------- TAG FUNCTIONALITY ------------------------

    protected createCurrentTag(): Tag {
        return new Tag(this, TimestampProvider.getLastTimestamp())
    }

    public createTag(): VCSTag {

        const tag = this.createCurrentTag()
        this.tags.set(tag.id, tag)

        return tag.asTagData()
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



    public clone(): ClonedBlock {
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
}

export class InlineBlock extends Block {

    public constructor(parent: Block, firstLine: Line, lastLine: Line, enableVersionMerging?: boolean) {
        super()

        this.manager              = parent.manager
        this.eol                  = parent.eol
        this.parent               = parent
        this.firstLine            = firstLine
        this.lastLine             = lastLine
        this.enableVersionMerging = enableVersionMerging ? enableVersionMerging : parent.enableVersionMerging

        this.addToLines()

        this.id = this.manager.registerBlock(this)
    }
}

export interface ForkBlockOptions {
    manager:               ResourceManager 
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
            this.manager              = blockOptions.manager
            this.eol                  = blockOptions.eol
            this.parent               = blockOptions.parent
            this.enableVersionMerging = blockOptions.enableVersionMerging ? blockOptions.enableVersionMerging : false

            firstLineNode = blockOptions.firstLine
            lastLineNode  = blockOptions.lastLine

            const content = blockOptions.content
            if      (!firstLineNode && !lastLineNode) { this.setContent(content ? content : "") }
            else if (content)                           { throw new Error("You cannot set a first or last line and define content at the same time, as this will lead to conflicts in constructing a block.") }
            
            this.id = this.manager.registerBlock(this, blockOptions.filePath)
        } else if (clonedBlock) {
            this.manager              = clonedBlock.manager
            this.isDeleted            = clonedBlock.isDeleted
            this.eol                  = clonedBlock.eol
            this.origin               = clonedBlock
            this.parent               = clonedBlock.parent
            this.children             = clonedBlock.children
            this.tags                 = clonedBlock.tags
            this.enableVersionMerging = clonedBlock.enableVersionMerging

            firstLineNode            = clonedBlock.firstLine?.node
            lastLineNode             = clonedBlock.lastLine?.node

            this.id = this.manager.registerClonedBlock(this)
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