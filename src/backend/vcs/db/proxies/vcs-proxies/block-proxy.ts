import { BlockType, Block, VersionType, Version, Line, PrismaPromise, Prisma } from "@prisma/client"
import { DatabaseProxy } from "../database-proxy"
import { prismaClient } from "../../client"
import { FileProxy, LineProxy, VersionProxy } from "../../types"
import { VCSBlockId, VCSBlockInfo, VCSBlockRange, VCSFileId, VCSTagId, VCSTagInfo } from "../../../../../app/components/vcs/vcs-rework"
import { TimestampProvider } from "../../../core/metadata/timestamps"
import { MultiLineChange } from "../../../../../app/components/data/change"
import { ProxyCache } from "../proxy-cache"
import { ISessionBlock } from "../../utilities"


enum BlockReference {
    Previous,
    Next
}

export class BlockProxy extends DatabaseProxy implements ISessionBlock<FileProxy, LineProxy, VersionProxy> {

    public readonly blockId: string
    public readonly file:    FileProxy
    public readonly type:    BlockType
    public readonly parent:  BlockProxy
    public readonly origin:  BlockProxy

    private _timestamp:  number
    public get timestamp(): number{ return this._timestamp }

    public setTimestampManually(newTimestamp: number) {
        this._timestamp = newTimestamp
    }

    public setTimestamp(newTimestamp: number) {
        const update = prismaClient.block.update({
            where: { id: this.id },
            data:  { timestamp: newTimestamp }
        })

        update.then(updatedBlock => {
            this._timestamp = updatedBlock.timestamp
        })

        return update
    }

    public static async get(id: number): Promise<BlockProxy> {
        return await ProxyCache.getBlockProxy(id)
    }

    public static async getFor(block: Block): Promise<BlockProxy> {
        return await ProxyCache.getBlockProxyFor(block)
    }

    public static async load(id: number): Promise<BlockProxy> {
        const block = await prismaClient.block.findUniqueOrThrow({ where: { id } })
        return await this.loadFrom(block)
    }

    public static async loadFrom(block: Block): Promise<BlockProxy> {
        const file   = await ProxyCache.getFileProxy(block.fileId)
        const parent = block.parentId ? await ProxyCache.getBlockProxy(block.parentId) : undefined
        const origin = block.originId ? await ProxyCache.getBlockProxy(block.originId) : undefined
        return new BlockProxy(block.id, block.blockId, file, block.type, block.timestamp, parent, origin)
    }

    private constructor(id: number, blockId: string, file: FileProxy, type: BlockType, timestamp: number, parent: BlockProxy, origin: BlockProxy) {
        super(id)
        this.blockId = blockId
        this.file    = file
        this.type    = type
        this.parent  = parent
        this.origin  = origin
    }

    //public getBlock()         { return prismaClient.block.findUniqueOrThrow({ where: { id: this.id } }) }
    public getCloneCount()    { return prismaClient.block.count({ where: { originId: this.id } }) }
    public getChildrenCount() { return prismaClient.block.count({ where: { parentId: this.id } }) }
    public getLineCount()     { return prismaClient.line.count({ where: { blocks: { some: { id: this.id } } } }) }
    public getVersionCount()  { return prismaClient.version.count({ where: { line: { blocks: { some: { id: this.id } } }, type: { not: VersionType.CLONE } } }) }
    public getChildren()      { return prismaClient.block.findMany({ where: { parentId: this.id } }) }
    public getLines()         { return prismaClient.line.findMany({ where: { blocks: { some: { id: this.id } } }, orderBy: { order: "asc" } }) }
    //public getHeadList()      { return prismaClient.headList.findFirstOrThrow({ where: { blocks: { some: { id: this.id } } } }) }
    //public getAllVersions() { return prismaClient.version.findMany({ where: { line: { blocks: { some: { id: this.id } } } }, orderBy: { line: { order: "asc" } } }) }
    public getTags()          { return prismaClient.tag.findMany({ where: { blockId: this.id }, include: { block: { select: { blockId: true } } } }) }

    public getOriginalLineCount() {
        return prismaClient.version.count({
            where: {
                line: { blocks: { some: { id: this.id } } },
                type: VersionType.IMPORTED
            }
        })
    }

    public async getHeads(includeLine?: boolean): Promise<{ prismaPromise: PrismaPromise<Version[]> }> {
        const potentiallyActiveHeads = await prismaClient.version.groupBy({
            by: ["lineId"],
            where: {
                line: {
                    fileId: this.file.id,
                    blocks: { some: { id: this.id } }
                },
                timestamp: { lte: this.timestamp }
            },
            _max: { timestamp: true }
        })

        const preInsertionHeads = await prismaClient.version.groupBy({
            by: ["lineId"],
            where: {
                line: {
                    fileId: this.file.id,
                    blocks: { some: { id: this.id } },
                    id:     { notIn: potentiallyActiveHeads.map(aggregation => aggregation.lineId) }
                }
            },
            _min: { timestamp: true }
        })

        const heads: { lineId: number, timestamp: number }[] = []
        potentiallyActiveHeads.forEach(({ lineId, _max: maxAggregations }) => heads.push({ lineId, timestamp: maxAggregations.timestamp }))
        preInsertionHeads.forEach(     ({ lineId, _min: minAggregations }) => heads.push({ lineId, timestamp: minAggregations.timestamp }))

        const versionSearch: Prisma.VersionFindManyArgs<any> = {
            where: {
                OR: heads
            },
            orderBy: {
                line: { order: "asc" }
            }
        }

        if (includeLine) { versionSearch.include = { line: true } }

        return { prismaPromise: prismaClient.version.findMany(versionSearch) }
    }

    // NOTE: Assumes first version of an inserted line is always inactive
    public async getActiveHeads(includeLine?: boolean): Promise<{ prismaPromise: PrismaPromise<Version[]> }> {

        const potentiallyActiveHeads = await prismaClient.version.groupBy({
            by: ["lineId"],
            where: {
                line: {
                    fileId: this.file.id,
                    blocks: { some: { id: this.id } }
                },
                timestamp: { lte: this.timestamp }
            },
            _max: { timestamp: true }
        })

        const versionSearch: Prisma.VersionFindManyArgs<any> = {
            where: {
                OR: potentiallyActiveHeads.map(({ lineId, _max: maxAggregations }) => {
                    return {
                        lineId,
                        timestamp: maxAggregations.timestamp
                    }
                }),
                isActive: true
            },
            orderBy: {
                line: { order: "asc" }
            }
        }

        if (includeLine) { versionSearch.include = { line: true } }

        return { prismaPromise: prismaClient.version.findMany(versionSearch) }
    }

    public async getActiveLineCount(): Promise<{ prismaPromise: PrismaPromise<number> }> {

        const potentiallyActiveHeads = await prismaClient.version.groupBy({
            by: ["lineId"],
            where: {
                line: {
                    fileId: this.file.id,
                    blocks: { some: { id: this.id } }
                },
                timestamp: { lte: this.timestamp }
            },
            _max: { timestamp: true }
        })

        return { prismaPromise: prismaClient.version.count({
            where: {
                OR: potentiallyActiveHeads.map(({ lineId, _max: maxAggregations }) => {
                    return {
                        lineId,
                        timestamp: maxAggregations.timestamp
                    }
                }),
                isActive: true
            }
        })}
    }

    public async getActiveLines(): Promise<{ prismaPromise: PrismaPromise<Line[]> }> {

        const potentiallyActiveHeads = await prismaClient.version.groupBy({
            by: ["lineId"],
            where: {
                line: {
                    fileId: this.file.id,
                    blocks: { some: { id: this.id } }
                },
                timestamp: { lte: this.timestamp }
            },
            _max: { timestamp: true }
        })

        return { prismaPromise: prismaClient.line.findMany({
            where: {
                OR: potentiallyActiveHeads.map(({ lineId, _max: maxAggregations }) => {
                    return {
                        id: lineId,
                        versions: {
                            some: {
                                timestamp: maxAggregations.timestamp,
                                isActive:  true
                            }
                        }
                    }
                })
            },
            orderBy: {
                order: "asc"
            }
        })}
    }

    public async getHeadFor(line: Line | LineProxy): Promise<Version> {

        const head = await prismaClient.version.findFirst({
            where: {
                lineId:    line.id,
                timestamp: { lte: this.timestamp }
            },
            orderBy: {
                timestamp: "desc"
            }
        })

        if (head) {
            return head
        } else {
            return await prismaClient.version.findFirstOrThrow({
                where: {
                    line: {
                        fileId: this.file.id,
                        blocks: { some: { id: this.id } }
                    }
                },
                orderBy: {
                    timestamp: "asc"
                }
            })
        }
    }

    public getHeadsWithLines(): Promise<{ prismaPromise: PrismaPromise<(Version & { line: Line })[]> }> {
        return this.getHeads(true) as Promise<{ prismaPromise: PrismaPromise<(Version & { line: Line })[]> }>
    }

    public getLastImportedVersion() {
        return prismaClient.version.findFirst({
            where: {
                line: {
                    fileId: this.file.id,
                    blocks: { some: { id: this.id } }
                },
                type: VersionType.IMPORTED
            },
            orderBy: {
                timestamp: "desc"
            }
        })
    }

    public async getCurrentVersion(): Promise<{ prismaPromise: PrismaPromise<Version> }> {

        const potentiallyActiveHeads = await prismaClient.version.groupBy({
            by: ["lineId"],
            where: {
                line: {
                    fileId: this.file.id,
                    blocks: { some: { id: this.id } }
                },
                timestamp: { lte: this.timestamp }
            },
            _max: { timestamp: true }
        })

        return { prismaPromise: prismaClient.version.findFirstOrThrow({
            where: {
                OR: potentiallyActiveHeads.map(({ lineId, _max: maxAggregations }) => {
                    return {
                        lineId,
                        timestamp: maxAggregations.timestamp
                    }
                })
            },
            orderBy: {
                line: { order: "desc" }
            }
        })}
    }

    public getTimelineIndexFor(version: Version) {
        return prismaClient.version.count({
            where: {
                line: {
                    fileId: this.file.id,
                    blocks: { some: { id: this.id } }
                },
                type:      { notIn: [VersionType.IMPORTED, VersionType.CLONE] },
                timestamp: { lt: version.timestamp }
            }
        })
    }

    public async getTimeline(): Promise<Version[]> {
        const lastImportedLine = await this.getLastImportedVersion()

        return await prismaClient.version.findMany({
            where: {
                line: {
                    fileId: this.file.id,
                    blocks: { some: { id: this.id } }
                },
                type:      { not: VersionType.CLONE },
                timestamp: lastImportedLine ? { gte: lastImportedLine.timestamp } : undefined
            },
            orderBy: {
                timestamp: "asc"
            }
        })
    }

    // MAGIC: Cache lines + version, all done.
    // !!!!!! TODO: !!!!!!
    // THIS SHOULD BE USED TO CALCULATE HEADS?
    // root block is edited, but versions are only represented through considering children -> heads for this block should always consider children
    // should get a mapping from line to timestamp applicable through the corresponding children -> then map to versions in one opperation
    private async getLineTimestamps(accumulation?: { clonesToConsider?: BlockProxy[], collectedTimestamps?: Map<number, number> }): Promise<Map<number, number>> {
        const clonesToConsider     = accumulation?.clonesToConsider
        const collectedTimestamps = accumulation?.collectedTimestamps

        if (clonesToConsider) {
            const clone = clonesToConsider.find(clone => clone.origin.id === this.id)
            if (clone) { return clone.getLineTimestamps(accumulation) }
        }

        let   timestamps = collectedTimestamps !== undefined ? collectedTimestamps : new Map<number, number>()
        const lines      = await this.getLines()

        lines.forEach(line => timestamps.set(line.id, this.timestamp))

        const children = await this.getChildren()
        for (const child of children) {
            const proxy = await BlockProxy.getFor(child)
            timestamps  = await proxy.getLineTimestamps({ clonesToConsider, collectedTimestamps: timestamps })
        }

        return timestamps
    }
    
    
    private async getVersionsForText(accumulation?: { clonesToConsider?: BlockProxy[], collectedVersions?: Map<number, Version> }): Promise<Map<number, Version>> {
        const clonesToConsider  = accumulation?.clonesToConsider
        const collectedVersions = accumulation?.collectedVersions

        if (clonesToConsider) {
            const clone = clonesToConsider.find(clone => clone.origin.id === this.id)
            if (clone) { return await clone.getVersionsForText(accumulation) }
        }

        let   versions      = collectedVersions !== undefined ? collectedVersions : new Map<number, Version>()
        const blockVersions = await (await this.getHeads()).prismaPromise

        blockVersions.forEach(version => versions.set(version.lineId, version))

        const children = await this.getChildren()
        for (const child of children) {
            const proxy = await BlockProxy.getFor(child)
            versions    = await proxy.getVersionsForText({ clonesToConsider, collectedVersions: versions })
        }

        return versions
    }

    public async getText(clonesToConsider?: BlockProxy[]): Promise<string> {
        // filtering for active lines here is important!!!
        const lines       = await this.getLines()
        const eol         = await this.file.getEol()

        const versions    = await this.getVersionsForText({ clonesToConsider })
        const content     = lines.map(line => {
            const version = versions.get(line.id)!
            return version.isActive ? version.content : undefined
        }).filter(content => content !== undefined)

        return content.join(eol)
    }

    public async getLinesInRange(range: VCSBlockRange): Promise<LineProxy[]> {
        const versions = await (await this.getHeadsWithLines()).prismaPromise

        const activeVersions = versions.filter(version => version.isActive)

        const firstVersion = activeVersions[range.startLine - 1] 
        const lastVersion  = activeVersions[range.endLine - 1] 

        const versionsInRange = versions.filter(version => firstVersion.line.order <= version.line.order && version.line.order <= lastVersion.line.order)

        return await Promise.all(versionsInRange.map(async version => await LineProxy.getFor(version.line)))
    }

    public async getActiveLinesInRange(range: VCSBlockRange): Promise<LineProxy[]> {
        const lines        = await (await this.getActiveLines()).prismaPromise
        const linesInRange = lines.filter((line, index) => range.startLine <= index + 1 && index + 1 <= range.endLine)
        return await Promise.all(linesInRange.map(async line => await LineProxy.getFor(line)))
    }

    public static async createRootBlock(file: FileProxy, filePath: string): Promise<{ blockId: string, block: BlockProxy }> {
        const lines = await prismaClient.line.findMany({
            where:   { fileId: file.id },
            include: { versions: true },
            orderBy: { order: "asc" }
        })

        const versions        = lines.flatMap(line => line.versions).sort((versionA, versionB) => versionA.timestamp - versionB.timestamp)
        const latestTimestamp = versions.length > 0 ? versions[versions.length - 1].timestamp : 0

        const blockId = filePath + ":root"
        const block   = await prismaClient.block.create({
            data: {
                blockId:   blockId,
                fileId:    file.id,
                type:      BlockType.ROOT,
                timestamp: latestTimestamp,
                lines:     { connect: lines.map(line => { return { id: line.id } }) }
            }
        })

        await prismaClient.version.updateMany({
            where: { id: { in: versions.map(version => version.id) } },
            data:  { sourceBlockId: block.id }
        })

        return { blockId: blockId, block: await BlockProxy.getFor(block) }
    }

    // WARNING: Should technically also copy children, but in this usecase unnecessary
    public async copy(): Promise<BlockProxy> {
        const [cloneCount, versions] = await prismaClient.$transaction([
            this.getCloneCount(),
            (await this.getHeads()).prismaPromise
        ])

        const latestTimestamp = versions.length > 0 ? versions.sort((versionA, versionB) => versionA.timestamp - versionB.timestamp)[versions.length - 1].timestamp : 0

        const block = await prismaClient.block.create({
            data: {
                blockId:   `${this.blockId}:inline${cloneCount}`,
                fileId:    this.file.id,
                type:      BlockType.CLONE,
                timestamp: latestTimestamp,
                originId:  this.id,
                lines:     { connect: versions.map(version => { return { id: version.lineId } }) }
            }
        })

        return await BlockProxy.getFor(block)
    }

    public async inlineCopy(lines: LineProxy[]): Promise<BlockProxy> {
        const childrenCount = await this.getChildrenCount()

        const block = await prismaClient.block.create({
            data: {
                blockId:    `${this.blockId}:inline${childrenCount}`,
                fileId:     this.file.id,
                type:       BlockType.INLINE,
                timestamp:  this.timestamp,
                parentId:   this.id,
                lines:      { connect: lines.map(line => { return { id: line.id } }) }
            }
        })

        return await BlockProxy.getFor(block)
    }

    private async insertLines(lineContents: string[], options?: { previous?: LineProxy, next?: LineProxy, blockReference?: BlockReference }): Promise<{ line: LineProxy, v0: VersionProxy, v1: VersionProxy }[]> {
        const lines = await this.file.insertLines(lineContents, { previous: options?.previous, next: options?.next, sourceBlock: this })

        const blockReference = options?.blockReference
        if (blockReference !== undefined) {
            let blockReferenceLine: LineProxy | undefined = undefined

            if      (blockReference === BlockReference.Previous) { blockReferenceLine = options?.previous ? options.previous : options.next }
            else if (blockReference === BlockReference.Next)     { blockReferenceLine = options?.next     ? options.next     : options.previous }

            if (blockReferenceLine) {
                const blocks       = await blockReferenceLine.getBlocks()
                const blockProxies = await Promise.all(blocks.map(async block => await BlockProxy.getFor(block)))

                for (const lineInfo of lines) {
                    const { line, v0, v1 } = lineInfo
                    const blockVersions = new Map(blockProxies.map(block => [block, block.id === this.id ? v1 : v0]))
                    await line.addBlocks(blockVersions)
                }
            }
        }

        return lines
    }

    // TODO: TEST!!!
    private async prependLines(lineContents: string[]): Promise<{ line: LineProxy, v0: VersionProxy, v1: VersionProxy }[]> {
        const nextLine     = await prismaClient.line.findFirstOrThrow({ where: { fileId: this.file.id, blocks: { some: { id: this.id } }                                }, orderBy: { order: "asc"  } })
        const previousLine = await prismaClient.line.findFirst(       { where: { fileId: this.file.id, blocks: { none: { id: this.id } }, order: { lt: nextLine.order } }, orderBy: { order: "desc" } })
        
        return await this.insertLines(lineContents, { previous:       previousLine ? await LineProxy.getFor(previousLine) : undefined,
                                                      next:           nextLine     ? await LineProxy.getFor(nextLine)     : undefined,
                                                      blockReference: BlockReference.Next })
    }

    // TODO: TEST!!!
    private async appendLines(lineContents: string[]): Promise<{ line:LineProxy, v0: VersionProxy, v1: VersionProxy }[]> {
        const previousLine = await prismaClient.line.findFirstOrThrow({ where: { fileId: this.file.id, blocks: { some: { id: this.id } }                                    }, orderBy: { order: "desc" } })
        const nextLine     = await prismaClient.line.findFirst(       { where: { fileId: this.file.id, blocks: { none: { id: this.id } }, order: { gt: previousLine.order } }, orderBy: { order: "asc"  } })
        
        return await this.insertLines(lineContents, { previous:       previousLine ? await LineProxy.getFor(previousLine) : undefined,
                                                      next:           nextLine     ? await LineProxy.getFor(nextLine)     : undefined,
                                                      blockReference: BlockReference.Previous })
    }

    public async insertLinesAt(lineNumber: number, lineContents: string[]): Promise<LineProxy[]> {
        //this.resetVersionMerging()

        const lastLineNumber      = await (await this.getActiveLineCount()).prismaPromise
        const newLastLine         = lastLineNumber + 1
        const insertionLineNumber = Math.min(Math.max(lineNumber, 1), newLastLine)

        /*
        const expandedLine     = activeLines[Math.min(adjustedLineNumber - 1, lastLineNumber) - 1]
        const expandedChildren = expandedLine.blocks
        */

        let createdLines: LineProxy[]

        if (insertionLineNumber === 1) {
            const lines = await this.prependLines(lineContents) // TODO: could be optimized by getting previous line from file lines
            createdLines = lines.map(line => line.line)
        } else if (insertionLineNumber === newLastLine) {
            const lines = await this.appendLines(lineContents) // TODO: could be optimized by getting previous line from file lines
            createdLines = lines.map(line => line.line)
        } else {
            const activeLines = await (await this.getActiveLines()).prismaPromise

            const previousLine = activeLines[insertionLineNumber - 2]
            const currentLine  = activeLines[insertionLineNumber - 1]

            const previousLineProxy = await LineProxy.getFor(previousLine)
            const currentLineProxy  = await LineProxy.getFor(currentLine)

            const lines = await this.insertLines(lineContents, { previous: previousLineProxy, next: currentLineProxy, blockReference: BlockReference.Previous })
            createdLines = lines.map(line => line.line)
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

        return createdLines
    }

    public async insertLineAt(lineNumber: number, content: string): Promise<LineProxy> {
        const lines = await this.insertLinesAt(lineNumber, [content])
        return lines[0]
    }

    public async createChild(range: VCSBlockRange): Promise<BlockProxy | null> {
        const linesInRange = await this.getLinesInRange(range)

        const overlappingChild = await prismaClient.block.findFirst({
            where: {
                parentId: this.id,
                lines:    { some: { id: { in: linesInRange.map(line => line.id) } } }
            }
        })

        if (overlappingChild) {
            console.warn("Could not create snapshot due to overlap!")
            return null
        }

        return await this.inlineCopy(linesInRange)
    }

    public async asBlockInfo(fileId: VCSFileId): Promise<VCSBlockInfo> {
        const [originalLineCount, activeLineCount, versionCount, lastImportedVersion, firstLine, currentVersion, tags] = await prismaClient.$transaction([
            this.getOriginalLineCount(),
            (await this.getActiveLineCount()).prismaPromise,
            this.getVersionCount(),
            this.getLastImportedVersion(),

            prismaClient.line.findFirstOrThrow({
                where: {
                    fileId: this.file.id,
                    blocks: { some: { id: this.id } } 
                },
                orderBy: { order: "asc"  },
                select: { id: true, order: true }
            }),

            (await this.getCurrentVersion()).prismaPromise,
            this.getTags()
        ])

        if (activeLineCount === 0) { throw new Error("Block has no active lines, and can thus not be positioned in parent!") }

        let   firstLineNumberInParent = 1
        let   lastLineNumberInParent  = activeLineCount
        const userVersionCount        = versionCount - originalLineCount + (lastImportedVersion ? 1 : 0)  // one selectable version per version minus pre-insertion versions (one per inserted line) and imported lines (which, together, is the same as all lines) plus one version for the original state of the file

        if (this.parent) {
            const parentTimestamp = this.parent.timestamp
            const potentiallyActiveHeadsBeforeBlock = await prismaClient.version.groupBy({
                by: ["lineId"],
                where: {
                    line:   {
                        fileId: this.file.id,
                        blocks: { none: { id: this.id } },
                        order:  { lt: firstLine.order }
                    },
                    timestamp: { lte: parentTimestamp }
                },
                _max: {
                    timestamp: true
                }
            })

            const activeLinesBeforeBlock = await prismaClient.version.count({
                where: {
                    OR: potentiallyActiveHeadsBeforeBlock.map(({ lineId, _max: maxAggregations }) => {
                        return {
                            lineId,
                            timestamp: maxAggregations.timestamp
                        }
                    }),
                    isActive: true
                }
            })

            firstLineNumberInParent = activeLinesBeforeBlock + 1
            lastLineNumberInParent  = activeLinesBeforeBlock + activeLineCount
        }

        const currentVersionIndex = await this.getTimelineIndexFor(currentVersion)

        const blockId = VCSBlockId.createFrom(fileId, this.blockId)
        return new VCSBlockInfo(blockId,
                                this.type,
                                {
                                    startLine: firstLineNumberInParent,
                                    endLine:   lastLineNumberInParent
                                },
                                userVersionCount,
                                currentVersionIndex,
                                tags.map(tag => new VCSTagInfo(VCSTagId.createFrom(blockId, tag.tagId), tag.name, tag.code, false)))
    }

    public async getChildrenInfo(fileId: VCSFileId): Promise<VCSBlockInfo[]> {
        const children = await this.getChildren()
        const blocks = await Promise.all(children.map(async child => await BlockProxy.getFor(child)))
        return await Promise.all(blocks.map(block => block.asBlockInfo(fileId)))
    }

    public async updateLine(lineNumber: number, content: string): Promise<LineProxy> {
        const lines = await (await this.getActiveLines()).prismaPromise

        const line = await LineProxy.getFor(lines[lineNumber - 1])
        await line.updateContent(this, content)

        //this.setupVersionMerging(line)

        return line
    }

    public async applyIndex(targetIndex: number): Promise<void> {
        //this.resetVersionMerging()

        const timeline = await this.getTimeline()

        if (targetIndex < 0 || targetIndex >= timeline.length) { throw new Error(`Target index ${targetIndex} out of bounds for timeline of length ${timeline.length}!`) }

        let selectedVersion = timeline[targetIndex] // actually targeted version

        await this.applyTimestamp(selectedVersion.timestamp)
    }

    public async applyTimestamp(timestamp: number): Promise<void> {
        await this.setTimestamp(timestamp)
    }

    public async cloneOutdatedHeads(): Promise<void> {
        const heads = await (await this.getHeads()).prismaPromise
        const linesToUpdate = await prismaClient.line.findMany({
            where: {
                fileId:   this.file.id,
                blocks:   { some: { id: this.id } },
                versions: {
                    some: {
                        timestamp: { gt: this.timestamp }
                    }
                }
            }
        })

        const headsToClone = heads.filter(head => linesToUpdate.some(line => line.id === head.lineId))

        if (headsToClone.length > 0) {

            const cloneTimestamp = TimestampProvider.getTimestamp()

            const versionCreation = prismaClient.version.createMany({
                data: headsToClone.map(head => {
                    return {
                        lineId:        head.lineId,
                        timestamp:     cloneTimestamp,
                        type:          VersionType.CLONE,
                        isActive:      head.isActive,
                        originId:      head.id,
                        sourceBlockId: this.id,
                        content:       head.content
                    }
                })
            })

            const headUpdate = this.setTimestamp(cloneTimestamp)

            await prismaClient.$transaction([versionCreation, headUpdate])
        }
    }

    public async changeLines(fileId: VCSFileId, change: MultiLineChange): Promise<VCSBlockId[]> {
        const eol   = await this.file.getEol()
        const heads = await (await this.getHeadsWithLines()).prismaPromise

        const activeHeads = heads.filter(head => head.isActive)

        //block.resetVersionMerging()

        const splitChangeString = change.insertedText.split(eol)

        const startLineContent = activeHeads[change.modifiedRange.startLineNumber - 1].content
        //const endLineContent   = activeHeads[change.modifiedRange.endLineNumber   - 1].content

        const insertedBeforeCode = startLineContent.length - startLineContent.trimStart().length + 1 >= change.modifiedRange.startColumn
        //const insertedAfterCode  = change.modifiedRange.endColumn > endLineContent.length

        //const hasEol        = change.insertedText.includes(eol)
        const startsWithEol = change.insertedText.startsWith(eol)
        const endsWithEol   = change.insertedText.endsWith(eol) || (splitChangeString.pop().trim().length === 0/* && insertedAfterCode*/) // cannot enable this (technically correct) check because of monaco's annoying tab insertion on newline... -> not a problem until endsWithEol is used under new conditions...

        const insertedAtStartOfStartLine = insertedBeforeCode
        const insertedAtEndOfStartLine   = change.modifiedRange.startColumn > startLineContent.length

        const oneLineModification = change.modifiedRange.startLineNumber === change.modifiedRange.endLineNumber
        const oneLineInsertOnly   = oneLineModification && change.modifiedRange.startColumn === change.modifiedRange.endColumn

        const pushStartLineDown = insertedAtStartOfStartLine && endsWithEol  // start line is not modified and will be below the inserted lines
        const pushStartLineUp   = insertedAtEndOfStartLine && startsWithEol  // start line is not modified and will be above the inserted lines

        const noModifications = oneLineInsertOnly && (pushStartLineUp || pushStartLineDown)
        //const modifyStartLine = !oneLineInsertOnly || (!pushStartLineDown && !pushStartLineUp)

        console.log("\nPush Down")
        console.log(`Inserted Text: "${change.insertedText.trimEnd()}"`)
        console.log(startsWithEol)
        console.log(endsWithEol)
        console.log(startLineContent.length - startLineContent.trimStart().length + 1)
        console.log(change.modifiedRange.startColumn)
        console.log(pushStartLineDown)

        const modifiedRange = {
            startLine: change.modifiedRange.startLineNumber,
            endLine:   change.modifiedRange.endLineNumber
        }

        const modifiedLines = change.lineText.split(eol)
        if (pushStartLineUp) {
            console.log(modifiedLines.splice(0, 1))
            modifiedRange.startLine++
        } else if (pushStartLineDown) {
            console.log(modifiedLines.pop())
            modifiedRange.endLine--
        }
        
        let vcsLines: LineProxy[] = []
        if (!noModifications) {
            const activeLines = await Promise.all(activeHeads.map(async head => await LineProxy.getFor(head.line)))
            vcsLines = activeLines.filter((_, index) => modifiedRange.startLine <= index + 1 && index + 1 <= modifiedRange.endLine)
        }

        /*
        if (modifyStartLine) {
            const activeLines = await Promise.all(activeHeads.map(async head => await LineProxy.getFor(head.line)))
            vcsLines = activeLines.filter((_, index) => modifiedRange.startLine <= index + 1 && index + 1 <= modifiedRange.endLine)
        } else {
            // TODO: pushStartDown case not handled well yet, line tracking is off
            if (pushStartLineUp) { 
                modifiedRange.startLine--
                modifiedRange.endLine--
            }
        }
        */

        const block = this
        const affectedLines:    LineProxy[]        = []
        const prismaOperations: PrismaPromise<any>[] = []
        let   latestTimestamp:  number = block.timestamp

        function deleteLine(line: LineProxy): void {
            affectedLines.push(line)
            latestTimestamp = TimestampProvider.getTimestamp()
            prismaOperations.push(prismaClient.version.create({
                data: {
                    lineId:        line.id,
                    timestamp:     latestTimestamp,
                    type:          VersionType.DELETION,
                    isActive:      false,
                    sourceBlockId: block.id,
                    content:       ""
                }
            }))
        }

        function updateLine(line: LineProxy, content: string): void {
            affectedLines.push(line)
            latestTimestamp = TimestampProvider.getTimestamp()
            prismaOperations.push(prismaClient.version.create({
                data: {
                    lineId:        line.id,
                    timestamp:     latestTimestamp,
                    type:          VersionType.CHANGE,
                    isActive:      true,
                    sourceBlockId: block.id,
                    content
                }
            }))
        }
        
        for (let i = vcsLines.length - 1; i >= modifiedLines.length; i--) {
            const line = vcsLines.at(i)
            deleteLine(line)
        }

        //if (modifyStartLine) { updateLine(vcsLines.at(0), modifiedLines[0]) }

        for (let i = 0; i < Math.min(vcsLines.length, modifiedLines.length); i++) {
            const line = vcsLines.at(i)
            updateLine(line, modifiedLines[i])
        }

        prismaOperations.push(block.setTimestamp(latestTimestamp))

        await prismaClient.$transaction(prismaOperations)

        const linesToInsert = modifiedLines.filter((_, index) => index + 1 > vcsLines.length)
        await this.insertLinesAt(modifiedRange.startLine + vcsLines.length, linesToInsert)

        const affectedBlocks = new Set<string>()
        for (const line of affectedLines) {
            const blockIds = await line.getBlockIds()
            blockIds.forEach(id => affectedBlocks.add(id))
        }

        return Array.from(affectedBlocks).map(id => VCSBlockId.createFrom(fileId, id))
    }
}

function customTrimEnd(input: string, eol: string) {
    // This regular expression matches trailing spaces and tabs
    const regex = /[ \t]+$/;

    // Split input by eol into lines
    const lines = input.split(eol);

    // For each line trim end spaces and tabs
    for (let i = 0; i < lines.length; i++) {
        lines[i] = lines[i].replace(regex, "");
    }

    // Join lines back using eol
    const output = lines.join(eol);

    return output;
}