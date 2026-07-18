import { prismaClient } from "../client";
import { DatabaseProxy } from "../proxy";
import { FileProxy, VersionProxy, BlockProxy} from "../proxy-types";
import { Line } from "@prisma/client"
import { LineType, VersionType } from "../data-types/enums";
import TimestampProvider from "../utils/timestamp-provider";
import { ProxyCache } from "../utils/cache";
import { ISessionLine } from "../session";

export default class LineProxy extends DatabaseProxy implements ISessionLine {

    public readonly file:     FileProxy
    public readonly type:     LineType
    public          order:    number

    public versions: VersionProxy[] = []
    public blocks:   BlockProxy[]   = []

    public static async get(id: number): Promise<LineProxy> {
        return await ProxyCache.getLineProxy(id)
    }

    public static async getFor(line: Line): Promise<LineProxy> {
        return await ProxyCache.getLineProxyFor(line)
    }

    public static async load(id: number): Promise<LineProxy> {
        const line = await prismaClient.line.findUniqueOrThrow({ where: { id } })
        return await this.loadFrom(line)
    }

    public static async loadFrom(line: Line): Promise<LineProxy> {
        const file  = await ProxyCache.getFileProxy(line.fileId)
        const proxy = new LineProxy(line.id, file, line.type as LineType, line.order)

        ProxyCache.registerLineProxy(proxy)
        
        const versionData = await prismaClient.version.findMany({ where: { lineId: line.id }, orderBy: { timestamp: "asc" } })
        for (const version of versionData) { proxy.versions.push(await VersionProxy.getFor(version)) }

        if (proxy.versions.length === 0) { throw new Error("LINE SHOULD NEVER HAVE 0 VERSIONS WHEN CREATING A PROXY FOR THE FIRST TIME!") }

        const blockData = await prismaClient.block.findMany({ where: { fileId: file.id, lines: { some: { id: line.id } } } })
        for (const block of blockData) { proxy.blocks.push(await BlockProxy.getFor(block)) }

        return proxy
    }

    private constructor(id: number, file: FileProxy, type: LineType, order: number) {
        super(id)
        this.file     = file
        this.type     = type
        this.order    = order
    }

    public getLatestVersion(): VersionProxy {
        return this.versions[this.versions.length - 1]
    }

    public getHeadFor(block: BlockProxy): VersionProxy {
        for (let i = this.versions.length - 1; i >= 0; i--) {
            const version = this.versions[i]
            if (version.timestamp <= block.timestamp) { return version }
        }

        return this.versions[0]
    }

    public async getBlockIds(): Promise<string[]> {
        return this.blocks.map(block => block.blockId)
    }

    public async addBlocks(sourceBlock: BlockProxy, blockVersions: Map<BlockProxy, VersionProxy>): Promise<void> {
        const blocks = Array.from(blockVersions.keys())

        const updates = blocks.map(block => {
            const responsibleBlock = sourceBlock.getChildResponsibleFor(this)
            return prismaClient.block.update({
                where: { id: block.id },
                data:  {
                    lines:     { connect: { id: this.id } },
                    timestamp: responsibleBlock.id === block.id ? blockVersions.get(block).timestamp : undefined
                }
            })
        })

        const blockData = await prismaClient.$transaction(updates)

        await Promise.all(blockData.map(async (blockData, index) => {
            const block = blocks[index]
            if (blockData.timestamp !== block.timestamp) {
                await block.setTimestampManually(blockData.timestamp)
            }
        }))

        const newBlocks = blocks.filter(block => this.blocks.every(currentBlock => block.id !== currentBlock.id))
        this.blocks = this.blocks.concat(newBlocks)
    }

    public async createVersion(sourceBlock: BlockProxy, timestamp: number, versionType: VersionType, isActive: boolean, content: string, origin?: VersionProxy): Promise<VersionProxy> {
        const versionData = await prismaClient.version.create({
            data: {
                lineId:        this.id,
                timestamp:     timestamp,
                type:          versionType,
                isActive:      isActive,
                sourceBlockId: sourceBlock.id,
                originId:      origin ? origin.id : undefined,
                content
            }
        })

        const version = await VersionProxy.getFor(versionData)

        this.versions.push(version)
        await sourceBlock.setTimestamp(timestamp)

        return version
    }

    public async createNextVersion(sourceBlock: BlockProxy, isActive: boolean, content: string, timestamp?: number): Promise<VersionProxy> {
        return await this.createVersion(sourceBlock, timestamp ? timestamp : TimestampProvider.getTimestamp(), isActive ? VersionType.CHANGE : VersionType.DELETION, isActive, content)
    }

    public async updateContent(sourceBlock: BlockProxy, content: string): Promise<VersionProxy> {
        const currentHead = this.getHeadFor(sourceBlock)
        if (TimestampProvider.getLastTimestamp() === currentHead.timestamp && currentHead.content.trimEnd() === content.trimEnd()) {
            return currentHead
        } else {
            //await this.validateHead(sourceBlock)
            return await this.createNextVersion(sourceBlock, true, content)
        }      
    }

    public async delete(sourceBlock: BlockProxy): Promise<VersionProxy> {
        //await this.validateHead(sourceBlock)
        return await this.createNextVersion(sourceBlock, false, "")
    }
}