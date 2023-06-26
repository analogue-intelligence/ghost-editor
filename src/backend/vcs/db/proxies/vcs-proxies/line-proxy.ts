import { DatabaseProxy } from "../database-proxy"
import { BlockProxy, VersionProxy } from "../../types"

export class LineProxy extends DatabaseProxy {

    public async addBlock(block: BlockProxy, headVersion: VersionProxy): Promise<void> {
        await this.client.line.update({
            where: { id: this.id },
            data:  { 
                blocks: { connect: { id: block.id } },
                heads: {
                    create: {
                        block:   { connect: { id: block.id } },
                        version: { connect: { id: headVersion.id } }
                    }
                }
            }
        })

        /*
        const head = await prisma.head.findFirstOrThrow({ where: { blockId: block.id, lineId: this.id } })
        return head
        */
    }

    public async addBlocks(headInfo: Map<BlockProxy, VersionProxy>): Promise<void> {
        const blocks = Array.from(headInfo.keys())

        await this.client.line.update({
            where: { id: this.id },
            data:  { blocks: { connect: blocks.map(block => { return { id: block.id } }) } }
        })

        await this.client.head.createMany({
            data: blocks.map(block => {
                return {
                    blockId:   block.id,
                    lineId:    this.id,
                    versionId: headInfo.get(block)!.id
                }
            })
        })

        /*
        const heads = await prisma.head.findMany({ 
            where: { 
                blockId: { in: blocks.map(blocks => blocks.id) },
                lineId:  this.id
            }
        })

        return heads.map(head => new HeadProxy(head.id))
        */
    }
}