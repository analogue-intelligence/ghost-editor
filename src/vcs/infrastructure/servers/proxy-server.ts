import { BrowserWindow } from "electron"

import { VCSResponse, BasicVCSServer, VCSBlockId, VCSBlockInfo, VCSBlockRange, VCSBlockUpdate, VCSCopyBlockInfo, VCSFileId, VCSFileLoadingOptions, VCSChildBlockInfo, VCSRootBlockInfo, VCSSessionId, VCSTagInfo, VCSTagId, VCSSessionCreationRequest, VCSSessionRequest, VCSFileData, VCSOperation } from "../../provider"
import { ChangeSet, LineChange, MultiLineChange } from "../../data-types/change"

import Session, { ISessionFile, ISessionBlock, ISessionTag, ISessionLine, ISessionVersion } from "../../database/session"
import ResourceManager from "../../database/resource-manager"
import CodeAI from "../../utils/ai/openai-client"

/*
USAGE:
    - DB: const server = new VCSServer<FileProxy, LineProxy, VersionProxy, BlockProxy, TagProxy, DBSession>(DBSession)
*/

export default abstract class VCSServer<SessionFile extends ISessionFile, SessionLine extends ISessionLine, SessionVersion extends ISessionVersion<SessionLine>, SessionBlock extends ISessionBlock<SessionFile, SessionBlock, SessionLine, SessionTag>, SessionTag extends ISessionTag, QuerySession extends Session<SessionFile, SessionLine, SessionVersion, SessionBlock, SessionTag>> extends BasicVCSServer {

    private readonly resources: ResourceManager<SessionFile, SessionLine, SessionVersion, SessionBlock, SessionTag, QuerySession>

    public constructor(sessionConstructor: new (manager: ResourceManager<SessionFile, SessionLine, SessionVersion, SessionBlock, SessionTag, QuerySession>) => QuerySession, browserWindow?: BrowserWindow) {
        super()
        this.resources     = new ResourceManager<SessionFile, SessionLine, SessionVersion, SessionBlock, SessionTag, QuerySession>(sessionConstructor)
        this.browserWindow = browserWindow
    }

    // helper for preview update
    protected readonly browserWindow: BrowserWindow | undefined
    protected abstract updatePreview(session: QuerySession, blockId: VCSBlockId): Promise<void>

    private async updateLine(session: QuerySession, blockId: VCSBlockId, change: LineChange): Promise<VCSBlockId[]> {
        const block = await session.getBlock(blockId)
        await block.cloneOutdatedHeads()
        const line  = await block.updateLine(change.lineNumber, change.lineText)
        
        await this.updatePreview(session, blockId)

        const ids = await line.getBlockIds()
        return ids.map(id => VCSBlockId.createFrom(blockId, id))
    }

    private async updateLines(session: QuerySession, blockId: VCSBlockId, change: MultiLineChange): Promise<VCSBlockId[]> {
        const block          = await session.getBlock(blockId)
        await block.cloneOutdatedHeads()
        const affectedBlocks = await block.updateLines(blockId, change)

        this.updatePreview(session, blockId)

        return affectedBlocks
    }



    public async createSession(request: VCSSessionCreationRequest): Promise<VCSResponse<VCSSessionId>> {
        const sessionId = this.resources.createSession()
        return { requestId: request.requestId, response: sessionId }
    }

    public closeSession(request: VCSSessionRequest<void>): Promise<VCSResponse<void>> {
        return this.resources.createQuery(request, VCSOperation.CloseSession, (session) => {
            session.close()
        })
    }

    public waitForCurrentRequests(request: VCSSessionRequest<void>): Promise<VCSResponse<void>> {
        return this.resources.createQuery(request, VCSOperation.WaitForCurrentRequests, () => {})
    }

    public loadFile(request: VCSSessionRequest<{ options: VCSFileLoadingOptions }>): Promise<VCSResponse<VCSRootBlockInfo>> {
        return this.resources.createQuery(request, VCSOperation.LoadFile, (session, { options }) => {
            return session.loadFile(options)
        })
    }

    public updateFilePath(request: VCSSessionRequest<{ fileId: VCSFileId; filePath: string; }>): Promise<VCSResponse<VCSFileId>> {
        return this.resources.createQuery(request, VCSOperation.UpdateFilePath, (session, { fileId, filePath }) => {
            return session.updateFilePath(fileId, filePath)
        })
    }

    public getFileData(request: VCSSessionRequest<{ fileId: VCSFileId }>): Promise<VCSResponse<VCSFileData>> {
        // TODO: fix VCSOperation eventually
        return this.resources.createQuery(request, VCSOperation.GetBlockInfo, (session, { fileId }) => {
            return session.getFileData(fileId)
        })
    }

    public unloadFile(request: VCSSessionRequest<{ fileId: VCSFileId }>): Promise<VCSResponse<void>> {
        return this.resources.createQuery(request, VCSOperation.UnloadFile, (session, { fileId }) => {
            return session.unloadFile(fileId)
        })
    }

    public getText(request: VCSSessionRequest<{ blockId: VCSBlockId }>): Promise<VCSResponse<string>> {
        return this.resources.createQuery(request, VCSOperation.GetText, async (session, { blockId }) => {
            const block = await session.getBlock(blockId)
            return block.getText()
        })
    }

    public getRootText(request: VCSSessionRequest<{ blockId: VCSBlockId }>): Promise<VCSResponse<string>> {
        return this.resources.createQuery(request, VCSOperation.GetRootText, async (session, { blockId }) => {
            const root  = session.getFileRootBlockFor(blockId)
            const block = await session.getBlock(blockId)
            return root.getText([block])
        })
    }

    public lineChanged(request: VCSSessionRequest<{ blockId: VCSBlockId, change: LineChange }>): Promise<VCSResponse<VCSBlockId[]>> {
        return this.resources.createQuery(request, VCSOperation.LineChanged, (session, { blockId, change }) => {
            return this.updateLine(session, blockId, change)
        })
    }

    public linesChanged(request: VCSSessionRequest<{ blockId: VCSBlockId, change: MultiLineChange }>): Promise<VCSResponse<VCSBlockId[]>> {
        return this.resources.createQuery(request, VCSOperation.LinesChanged, (session, { blockId, change }) => {
            return this.updateLines(session, blockId, change)
        })
    }

    public applyChanges(request: VCSSessionRequest<{ blockId: VCSBlockId; changes: ChangeSet; }>): Promise<VCSResponse<VCSBlockId[]>> {
        return this.resources.createQuery(request, VCSOperation.ApplyChanges, async (session, { blockId, changes }) => {
            const blockIds = []
            for (const change of changes) {
                if      (change instanceof LineChange)      { blockIds.push(await this.updateLine(session, blockId, change)) }
                else if (change instanceof MultiLineChange) { blockIds.push(await this.updateLines(session, blockId, change)) }
                else                                        { throw new Error("Provided change is not in known format!") }
            }
            return blockIds.flat()
        })
    }

    public copyBlock(request: VCSSessionRequest<{ blockId: VCSBlockId }>): Promise<VCSResponse<VCSCopyBlockInfo>> {
        return this.resources.createQuery(request, VCSOperation.CopyBlock, async (session, { blockId }) => {
            const block = await session.getBlock(blockId)
            const copy  = await block.copy()
            return copy.asBlockInfo(blockId)
        })
    }

    public createChild(request: VCSSessionRequest<{ parentBlockId: VCSBlockId, range: VCSBlockRange }>): Promise<VCSResponse<VCSChildBlockInfo | null>> {
        return this.resources.createQuery(request, VCSOperation.CreateChild, async (session, { parentBlockId, range }) => {
            const block = await session.getBlock(parentBlockId)
            const child = await block.createChild(range)
            return child ? child.asBlockInfo(parentBlockId) : null
        })
    }

    public deleteBlock(request: VCSSessionRequest<{ blockId: VCSBlockId }>): Promise<VCSResponse<void>> {
        return this.resources.createQuery(request, VCSOperation.DeleteBlock, (session, { blockId }) => {
            return session.delete(blockId)
        })
    }

    public getBlockInfo(request: VCSSessionRequest<{ blockId: VCSBlockId }>): Promise<VCSResponse<VCSBlockInfo>> {
        return this.resources.createQuery(request, VCSOperation.GetBlockInfo, async (session, { blockId }) => {
            const block = await session.getBlock(blockId)
            return block.asBlockInfo(blockId)
        })
    }

    public getChildrenInfo(request: VCSSessionRequest<{ blockId: VCSBlockId }>): Promise<VCSResponse<VCSBlockInfo[]>> {
        return this.resources.createQuery(request, VCSOperation.GetChildrenInfo, async (session, { blockId }) => {
            const block = await session.getBlock(blockId)
            return block.getChildrenInfo(blockId)
        })
    }

    public updateBlock(request: VCSSessionRequest<{ blockId: VCSBlockId, update: VCSBlockUpdate }>): Promise<VCSResponse<void>> {
        throw new Error("Currently, blocks cannot be updated because its unused and I cannot be bothered to actually implement that nightmare." + request)
    }

    public async syncBlocks(request: VCSSessionRequest<{ source: VCSBlockId; target: VCSBlockId; }>): Promise<VCSResponse<string>> {
        return this.resources.createQuery(request, VCSOperation.SyncBlocks, async (session, { source, target }) => {
            if (session.id !== source.sessionId || session.id !== target.sessionId) { throw new Error("Requested source and target do not match requested session id!") }

            const sourceBlock = await session.getBlock(source)
            const targetBlock = await session.getBlock(target)

            const timestamp = await sourceBlock.cloneOutdatedHeads()
            
            await targetBlock.applyTimestamp(timestamp)
            return targetBlock.getText()
        })
    }

    public setBlockVersionIndex(request: VCSSessionRequest<{ blockId: VCSBlockId, versionIndex: number }>): Promise<VCSResponse<string>> {
        return this.resources.createQuery(request, VCSOperation.SetBlockVersionIndex, async (session, { blockId, versionIndex }) => {
            const { root, block } = await session.getRootBlockFor(blockId)
            await block.applyIndex(versionIndex)
            await this.updatePreview(session, blockId)
            return root.getText()
        })

        /*
        const blockId = request.data.blockId
        return this.resources.createQueryChain(`set-block-version-index-${blockId.sessionId}-${blockId.filePath}-${blockId.blockId}`, request, VCSOperation.SetBlockVersionIndex, async (session, { blockId, versionIndex }) => {
            const { root, block } = await session.getRootBlockFor(blockId)
            await block.applyIndex(versionIndex)
            await this.updatePreview(session, blockId)
            return root.getText()
        }, async (session) => {
            // console.log("Chain Broke")
            const block = await session.getBlock(blockId)
            return block.cloneOutdatedHeads()
        })
        */
    }

    public saveCurrentBlockVersion(request: VCSSessionRequest<{ blockId: VCSBlockId, name?: string, description?: string, codeForAi?: string }>): Promise<VCSResponse<VCSTagInfo>> {
        return this.resources.createQuery(request, VCSOperation.SaveCurrentBlockVersion, async (session, { blockId, name, description, codeForAi }) => {
            const block = await session.getBlock(blockId)
            const tag   = await block.createTag({ name, description, codeForAi })
            return tag.asTagInfo(blockId)
        })
    }

    public applyTag(request: VCSSessionRequest<{ tagId: VCSTagId, blockId: VCSBlockId }>): Promise<VCSResponse<VCSBlockInfo>> {
        // TODO: Should the frontend or backend evaluate that blocks and tags fit together? Or do we assume I can apply any tag to any block?
        return this.resources.createQuery(request, VCSOperation.ApplyTag, async (session, { tagId, blockId }) => {
            const tag   = await session.getTag(tagId)
            const block = await session.getBlock(blockId)
            await block.applyTimestamp(tag.timestamp)
            return block.asBlockInfo(blockId)
        })
    }

    public getErrorHint(request: VCSSessionRequest<{ code: string, errorMessage: string }>): Promise<VCSResponse<string | null>> {
        return this.resources.createQuery(request, VCSOperation.GetErrorHint, (session, { code, errorMessage }) => {
            return CodeAI.errorSuggestion(code, errorMessage)
        })
    }
}