import SubscriptionManager from "../editor/utils/subscription-manager";
import { ChangeSet, LineChange, MultiLineChange, AnyChange, ChangeBehaviour } from "./data-types/change"
import { BlockType, LineType, VersionType } from "./database/data-types/enums";
import Disposable from "../utils/data-types/server-safe/disposable";

export class VCSSessionId {

    public readonly sessionId: string

    public constructor(sessionId: string) {
        this.sessionId = sessionId
    }
}

export class VCSFileId extends VCSSessionId {

    public readonly filePath: string

    public static createFrom(sessionId: VCSSessionId, filePath: string): VCSFileId {
        return new VCSFileId(sessionId.sessionId, filePath)
    }

    public constructor(sessionId: string, filePath: string) {
        super(sessionId)
        this.filePath = filePath
    }
}

export class VCSBlockId extends VCSFileId {

    public readonly blockId: string

    public static createFrom(fileId: VCSFileId, blockId: string): VCSBlockId {
        return new VCSBlockId(fileId.sessionId, fileId.filePath, blockId)
    }

    public constructor(sessionId: string, filePath: string, blockId: string) {
        super(sessionId, filePath)
        this.blockId = blockId
    }
}

export class VCSTagId extends VCSBlockId {

    public readonly tagId: string

    public static createFrom(blockId: VCSBlockId, tagId: string): VCSTagId {
        return new VCSTagId(blockId.sessionId, blockId.filePath, blockId.blockId, tagId)
    }

    public constructor(sessionId: string, filePath: string, blockId: string, tagId: string) {
        super(sessionId, filePath, blockId)
        this.tagId = tagId
    }
}

export class VCSBlockInfo extends VCSBlockId {

    public readonly type:         BlockType
    public          range:        VCSBlockRange

    public readonly versionCount: number
    public readonly versionIndex: number

    public readonly tags:         VCSTagInfo[]

    public constructor(blockId: VCSBlockId, type: BlockType, range: VCSBlockRange, versionCount: number, versionIndex: number, tags: VCSTagInfo[]) {
        super(blockId.sessionId, blockId.filePath, blockId.blockId)

        this.type         = type
        this.range        = range
        this.versionCount = versionCount
        this.versionIndex = versionIndex
        this.tags         = tags
    }
}

export class VCSRootBlockInfo extends VCSBlockInfo {
    public constructor(blockId: VCSBlockId, range: VCSBlockRange, versionCount: number, versionIndex: number, tags: VCSTagInfo[]) {
        super(blockId, BlockType.ROOT, range, versionCount, versionIndex, tags)
    }
}

export class VCSCopyBlockInfo extends VCSBlockInfo {
    public constructor(blockId: VCSBlockId, range: VCSBlockRange, versionCount: number, versionIndex: number, tags: VCSTagInfo[]) {
        super(blockId, BlockType.CLONE, range, versionCount, versionIndex, tags)
    }
}

export class VCSChildBlockInfo extends VCSBlockInfo {
    public constructor(blockId: VCSBlockId, range: VCSBlockRange, versionCount: number, versionIndex: number, tags: VCSTagInfo[]) {
        super(blockId, BlockType.INLINE, range, versionCount, versionIndex, tags)
    }
}

export class VCSTagInfo extends VCSTagId {

    public readonly tagBlockId:          VCSBlockId  // tag block refers to the block that is reserved to edit this tag specifically
    public readonly name:                string
    public readonly timestamp:           number
    public readonly text:                string
    public readonly description:         string
    public readonly automaticSuggestion: boolean

    public constructor(tagId: VCSTagId, tagBlockId: VCSBlockId, name: string, timestamp: number, text: string, description: string, automaticSuggestion: boolean) {
        super(tagId.sessionId, tagId.filePath, tagId.blockId, tagId.tagId)

        this.tagBlockId          = tagBlockId
        this.name                = name
        this.timestamp           = timestamp
        this.text                = text
        this.description         = description
        this.automaticSuggestion = automaticSuggestion
    }
}

export interface VCSDatabaseData {
    databaseId?: number
}

export class VCSFileData extends VCSFileId implements VCSDatabaseData {

    public readonly databaseId: number
    public readonly eol:         string

    public rootBlock: VCSBlockData

    public lines:  VCSLineData[]  = []
    public blocks: VCSBlockData[] = []

    public constructor(databaseId: number, fileId: VCSFileId, eol: string) {
        super(fileId.sessionId, fileId.filePath)
        this.databaseId = databaseId
        this.eol        = eol
    }
}

export class VCSBlockData extends VCSBlockId implements VCSDatabaseData {

    public readonly databaseId: number

    public readonly file:  VCSFileData
    public readonly type:  BlockType

    public heads:   Map<VCSLineData, VCSVersionData>
    public parent?: VCSBlockData
    public origin?: VCSBlockData

    public tags: VCSTagData[] = []

    public constructor(databaseId: number, blockId: string, file: VCSFileData, type: BlockType) {
        super(file.sessionId, file.filePath, blockId)
        this.databaseId = databaseId
        this.file       = file
        this.type       = type
    }
}

export class VCSLineData extends VCSFileId implements VCSDatabaseData {

    public readonly databaseId: number

    public readonly file:     VCSFileData
    public readonly type:     LineType
    public readonly position: number

    public versions: VCSVersionData[] = []

    public constructor(databaseId: number, file: VCSFileData, type: LineType, position: number) {
        super(file.sessionId, file.filePath)
        this.databaseId = databaseId
        this.type       = type
        this.file       = file
        this.position   = position
    }
}

export class VCSVersionData extends VCSFileId implements VCSDatabaseData {

    public readonly databaseId: number

    public readonly line:      VCSLineData
    public readonly type:      VersionType
    public readonly timestamp: number
    public readonly isActive:  boolean
    public readonly content:   string

    public sourceBlock?: VCSBlockData
    public origin?:      VCSVersionData

    public constructor(databaseId: number, line: VCSLineData, type: VersionType, timestamp: number, isActive: boolean, content: string, sourceBlock: VCSBlockData | undefined, origin: VCSVersionData | undefined) {
        super(line.sessionId, line.filePath)
        this.databaseId  = databaseId
        this.line        = line
        this.type        = type
        this.isActive    = isActive
        this.timestamp   = timestamp
        this.content     = content
        this.sourceBlock = sourceBlock
        this.origin      = origin
    }
}

export class VCSTagData extends VCSTagId implements VCSDatabaseData {

    public readonly databaseId: number

    public readonly block:     VCSBlockData
    public readonly name:      string
    public readonly timestamp: number
    public readonly code:      string

    public constructor(databaseId: number, tagId: string, block: VCSBlockData, name: string, timestamp: number, code: string) {
        super(block.sessionId, block.filePath, block.blockId, tagId)
        this.databaseId = databaseId
        this.block      = block
        this.name       = name
        this.timestamp  = timestamp
        this.code       = code
    }
}

export interface VCSFileLoadingOptions {
    eol:       string
    filePath?: string
    content?:  string
}

export interface VCSBlockRange {
    startLine: number
    endLine:   number
}

export type VCSBlockUpdate = VCSBlockRange

export enum VCSRequestType {
    SessionManagement,
    Silent,
    ReadOnly,
    ReadWrite
}

export enum VCSOperation {
    CreateSession,
    CloseSession,
    WaitForCurrentRequests,
    LoadFile,
    UpdateFilePath,
    UnloadFile,
    GetText,
    GetRootText,
    LineChanged,
    LinesChanged,
    ApplyChange,
    ApplyChanges,
    CopyBlock,
    CreateChild,
    DeleteBlock,
    GetBlockInfo,
    GetChildrenInfo,
    UpdateBlock,
    SyncBlocks,
    SetBlockVersionIndex,
    SaveCurrentBlockVersion,
    ApplyTag,
    GetErrorHint
}

export const VCSOperationTypes = new Map<VCSOperation, VCSRequestType>([
    [VCSOperation.CreateSession,           VCSRequestType.SessionManagement],
    [VCSOperation.CloseSession,            VCSRequestType.SessionManagement],
    [VCSOperation.WaitForCurrentRequests,  VCSRequestType.Silent],
    [VCSOperation.LoadFile,                VCSRequestType.ReadWrite],
    [VCSOperation.UpdateFilePath,          VCSRequestType.ReadWrite],
    [VCSOperation.UnloadFile,              VCSRequestType.ReadOnly],
    [VCSOperation.GetText,                 VCSRequestType.ReadOnly],
    [VCSOperation.GetRootText,             VCSRequestType.ReadOnly],
    [VCSOperation.LineChanged,             VCSRequestType.ReadWrite],
    [VCSOperation.LinesChanged,            VCSRequestType.ReadWrite],
    [VCSOperation.ApplyChange,             VCSRequestType.ReadWrite],
    [VCSOperation.ApplyChanges,            VCSRequestType.ReadWrite],
    [VCSOperation.CopyBlock,               VCSRequestType.ReadWrite],
    [VCSOperation.CreateChild,             VCSRequestType.ReadWrite],
    [VCSOperation.DeleteBlock,             VCSRequestType.ReadWrite],
    [VCSOperation.GetBlockInfo,            VCSRequestType.ReadOnly],
    [VCSOperation.GetChildrenInfo,         VCSRequestType.ReadOnly],
    [VCSOperation.UpdateBlock,             VCSRequestType.ReadWrite],
    [VCSOperation.SyncBlocks,              VCSRequestType.ReadWrite],
    [VCSOperation.SetBlockVersionIndex,    VCSRequestType.ReadWrite],
    [VCSOperation.SaveCurrentBlockVersion, VCSRequestType.ReadWrite],
    [VCSOperation.ApplyTag,                VCSRequestType.ReadWrite],
    [VCSOperation.GetErrorHint,            VCSRequestType.Silent]
])

export interface IVCSRequest<RequestData> {
    requestId:          string
    data:               RequestData
}

export type VCSSessionCreationRequest = IVCSRequest<void>

export interface VCSSessionRequest<RequestData> extends IVCSRequest<RequestData> {
    sessionId:          VCSSessionId
    previousRequestId?: string
}

interface IVCSResponse {
    requestId: string
}

export interface VCSSuccess<ResponseData> extends IVCSResponse {
    response: ResponseData
}

export interface VCSError extends IVCSResponse {
    error: string
}

export type VCSResponse<ResponseData> = VCSSuccess<ResponseData> | VCSError

export interface VCSProvider {

    // creating and closing a session
    createSession(request: VCSSessionCreationRequest): Promise<VCSResponse<VCSSessionId>>
    closeSession(request: VCSSessionRequest<void>): Promise<VCSResponse<void>>
    waitForCurrentRequests(request: VCSSessionRequest<void>): Promise<VCSResponse<void>>

    // operation on session: loading and unloading a file, making it available for operations
    loadFile(request: VCSSessionRequest<{ options: VCSFileLoadingOptions }>): Promise<VCSResponse<VCSRootBlockInfo>>  // always returns ID to root block so that editing is immediately possible
    updateFilePath(request: VCSSessionRequest<{ fileId: VCSFileId, filePath: string }>): Promise<VCSResponse<VCSFileId>>
    unloadFile(request: VCSSessionRequest<{ fileId: VCSFileId }>): Promise<VCSResponse<void>>

    // accessors to text of block
    getText(request: VCSSessionRequest<{ blockId: VCSBlockId }>): Promise<VCSResponse<string>>
    getRootText(request: VCSSessionRequest<{ blockId: VCSBlockId }>): Promise<VCSResponse<string>>

    // edit interface on blocks -> each operation returns the ID for all blocks that got affected by an edit
    lineChanged (request: VCSSessionRequest<{ blockId: VCSBlockId, change: LineChange }>): Promise<VCSResponse<VCSBlockId[]>>
    linesChanged(request: VCSSessionRequest<{ blockId: VCSBlockId, change: MultiLineChange }>): Promise<VCSResponse<VCSBlockId[]>>
    applyChange (request: VCSSessionRequest<{ blockId: VCSBlockId, change: AnyChange }>): Promise<VCSResponse<VCSBlockId[]>>
    applyChanges(request: VCSSessionRequest<{ blockId: VCSBlockId, changes: ChangeSet }>): Promise<VCSResponse<VCSBlockId[]>>

    // create and delete blocks
    copyBlock(request: VCSSessionRequest<{ blockId: VCSBlockId }>): Promise<VCSResponse<VCSCopyBlockInfo>>
    createChild(request: VCSSessionRequest<{ parentBlockId: VCSBlockId, range: VCSBlockRange }>): Promise<VCSResponse<VCSChildBlockInfo | null>>
    deleteBlock(request: VCSSessionRequest<{ blockId: VCSBlockId }>): Promise<VCSResponse<void>>

    // read block data
    getBlockInfo(request: VCSSessionRequest<{ blockId: VCSBlockId }>): Promise<VCSResponse<VCSBlockInfo>>
    getChildrenInfo(request: VCSSessionRequest<{ blockId: VCSBlockId }>): Promise<VCSResponse<VCSBlockInfo[]>>

    // update snapshots
    updateBlock(request: VCSSessionRequest<{ blockId: VCSBlockId, update: VCSBlockUpdate }>): Promise<VCSResponse<void>>
    syncBlocks(request: VCSSessionRequest<{ source: VCSBlockId, target: VCSBlockId }>): Promise<VCSResponse<string>>
    setBlockVersionIndex(request: VCSSessionRequest<{ blockId: VCSBlockId, versionIndex: number }>): Promise<VCSResponse<string>>

    // tag interface
    saveCurrentBlockVersion(request: VCSSessionRequest<{ blockId: VCSBlockId, name?: string, description?: string, codeForAi?: string }>): Promise<VCSResponse<VCSTagInfo>>
    applyTag(request: VCSSessionRequest<{ tagId: VCSTagId, blockId: VCSBlockId }>): Promise<VCSResponse<VCSBlockInfo>>

    // ai interface
    getErrorHint(request: VCSSessionRequest<{ code: string, errorMessage: string }>): Promise<VCSResponse<string | null>>
}

export abstract class BasicVCSProvider implements VCSProvider {

    // creating and closing a session
    public abstract createSession(request: VCSSessionCreationRequest): Promise<VCSResponse<VCSSessionId>>
    public abstract closeSession(request: VCSSessionRequest<void>): Promise<VCSResponse<void>>
    public abstract waitForCurrentRequests(request: VCSSessionRequest<void>): Promise<VCSResponse<void>>

    // operation on session: loading and unloading a file, making it available for operations
    public abstract loadFile(request: VCSSessionRequest<{ options: VCSFileLoadingOptions }>): Promise<VCSResponse<VCSRootBlockInfo>>  // always returns ID to root block so that editing is immediately possible
    public abstract updateFilePath(request: VCSSessionRequest<{ fileId: VCSFileId, filePath: string }>): Promise<VCSResponse<VCSFileId>>
    public abstract unloadFile(request: VCSSessionRequest<{ fileId: VCSFileId }>): Promise<VCSResponse<void>>

    // accessors to text of block
    public abstract getText(request: VCSSessionRequest<{ blockId: VCSBlockId }>): Promise<VCSResponse<string>>
    public abstract getRootText(request: VCSSessionRequest<{ blockId: VCSBlockId }>): Promise<VCSResponse<string>>

    // edit interface on blocks -> each operation returns the ID for all blocks that got affected by an edit
    public abstract lineChanged(request: VCSSessionRequest<{ blockId: VCSBlockId, change: LineChange }>): Promise<VCSResponse<VCSBlockId[]>>
    public abstract linesChanged(request: VCSSessionRequest<{ blockId: VCSBlockId, change: MultiLineChange }>): Promise<VCSResponse<VCSBlockId[]>>

    public async applyChange(request: VCSSessionRequest<{ blockId: VCSBlockId, change: AnyChange }>): Promise<VCSResponse<VCSBlockId[]>> {
        const { change } = request.data
        if (change.changeBehaviour === ChangeBehaviour.Line) {
            return await this.lineChanged(request as VCSSessionRequest<{ blockId: VCSBlockId, change: LineChange }>)
        } else if (change.changeBehaviour === ChangeBehaviour.MultiLine) {
            return await this.linesChanged(request as VCSSessionRequest<{ blockId: VCSBlockId, change: MultiLineChange }>)
        } else {
            throw new Error("Change type unknown.")
        }
    }

    // TODO: this was a great idea in the old, in-memory version of this tool, for databases, this is a bit too inefficient
    public async applyChanges(request: VCSSessionRequest<{ blockId: VCSBlockId, changes: ChangeSet }>): Promise<VCSResponse<VCSBlockId[]>> {
        const { blockId, changes } = request.data

        let subIdCount = 0
        let previousRequestId = request.previousRequestId
        const changeResponses: Promise<VCSResponse<VCSBlockId[]>>[] = []
        for (let i = 0; i < changes.length; i++) {
            const requestId = i + 1 < changes.length ? request.requestId + ":apply-changes-sub-request-" + subIdCount++ : request.requestId
            const changeRequest = { sessionId: request.sessionId, requestId, previousRequestId, data: { blockId, change: changes[i] } }
            changeResponses.push(this.applyChange(changeRequest))
            previousRequestId = requestId
        }

        const responses = await Promise.all(changeResponses)

        if (responses.length > 0) {
            const error = responses.find(response => response as VCSError) as VCSError
            if (error) {
                return error
            } else {
                const successfulResponses = responses as VCSSuccess<VCSBlockId[]>[]
                return { requestId: request.requestId, response: successfulResponses.flatMap(response => response.response) }
            }
        } else {
            return { requestId: request.requestId, response: [] }
        }
    }

    // create and delete blocks
    public abstract copyBlock(request: VCSSessionRequest<{ blockId: VCSBlockId }>): Promise<VCSResponse<VCSCopyBlockInfo>>
    public abstract createChild(request: VCSSessionRequest<{ parentBlockId: VCSBlockId, range: VCSBlockRange }>): Promise<VCSResponse<VCSChildBlockInfo | null>>
    public abstract deleteBlock(request: VCSSessionRequest<{ blockId: VCSBlockId }>): Promise<VCSResponse<void>>

    // read block data
    public abstract getBlockInfo(request: VCSSessionRequest<{ blockId: VCSBlockId }>): Promise<VCSResponse<VCSBlockInfo>>
    public abstract getChildrenInfo(request: VCSSessionRequest<{ blockId: VCSBlockId }>): Promise<VCSResponse<VCSBlockInfo[]>>

    // update snapshots
    public abstract updateBlock(request: VCSSessionRequest<{ blockId: VCSBlockId, update: VCSBlockUpdate }>): Promise<VCSResponse<void>>
    public abstract syncBlocks(request: VCSSessionRequest<{ source: VCSBlockId; target: VCSBlockId; }>): Promise<VCSResponse<string>>
    public abstract setBlockVersionIndex(request: VCSSessionRequest<{ blockId: VCSBlockId, versionIndex: number }>): Promise<VCSResponse<string>>

    // tag interface
    public abstract saveCurrentBlockVersion(request: VCSSessionRequest<{ blockId: VCSBlockId, name?: string, description?: string, codeForAi?: string }>): Promise<VCSResponse<VCSTagInfo>>
    public abstract applyTag(request: VCSSessionRequest<{ tagId: VCSTagId, blockId: VCSBlockId }>): Promise<VCSResponse<VCSBlockInfo>>

    public abstract getErrorHint(request: VCSSessionRequest<{ code: string, errorMessage: string }>): Promise<VCSResponse<string | null>>
}

// server-side interface on which end-points may be mapped
export type VCSServer = VCSProvider
export abstract class BasicVCSServer extends BasicVCSProvider implements VCSServer {}

// client-side interface which may call server end-points
export type VCSClient = VCSProvider
export abstract class BasicVCSClient extends BasicVCSProvider implements VCSClient {}

export class VCSUnwrappedClient extends SubscriptionManager {

    public readonly client: VCSClient

    private currentRequestId?: number = undefined

    private readonly requestCallbacks: { requestTypes?: { include?: VCSRequestType[], exclude?: VCSRequestType[] }, operations?: { include?: VCSOperation[], exclude?: VCSOperation[] }, callback: () => void }[] = []

    public constructor(client: VCSClient) {
        super()
        this.client = client
    }

    private getNextIds(): { requestId: string, previousRequestId?: string } {
        const lastRequestId   = this.currentRequestId
        this.currentRequestId = this.currentRequestId !== undefined ? this.currentRequestId + 1 : 0
        return { requestId: `${this.currentRequestId}`, previousRequestId: lastRequestId !== undefined ? `${lastRequestId}` : undefined }
    }

    private createSessionRequest<RequestType>(sessionId: VCSSessionId, args: RequestType): VCSSessionRequest<RequestType> {
        const { requestId, previousRequestId } = this.getNextIds()
        return { sessionId, requestId, previousRequestId, data: args }
    }

    private requestSent(operationType: VCSOperation): void {
        const requestType = VCSOperationTypes.get(operationType)
        this.requestCallbacks.forEach(({ requestTypes, operations, callback }) => {

            const includeRequestTypes = requestTypes?.include ? new Set(requestTypes.include) : new Set(Object.values(VCSRequestType).filter(v => typeof v === "number") as VCSRequestType[])
            const excludeRequestTypes = requestTypes?.exclude ? new Set(requestTypes.exclude) : new Set<VCSRequestType>()

            const includeOperations   = operations?.include   ? new Set(operations.include)   : new Set(Object.values(VCSOperation).filter(v => typeof v === "number") as VCSOperation[])
            const excludeOperations   = operations?.exclude   ? new Set(operations.exclude)   : new Set<VCSOperation>()

            excludeRequestTypes.forEach(requestType => includeRequestTypes.delete(requestType))
            excludeOperations.forEach(operation => includeOperations.delete(operation))

            if (includeRequestTypes.has(requestType) && includeOperations.has(operationType)) {
                callback()
            }
        })
    }

    private async unwrapResponse<ResponseType>(request: Promise<VCSResponse<ResponseType>>, type: VCSOperation): Promise<ResponseType> {
        if (type !== undefined) { this.requestSent(type) }

        const response = await request

        const result = response as VCSSuccess<ResponseType>
        const error  = response as VCSError

        // NOTE: seemingly I can always cast to an interface, so this seems to be safer than just checking if the cast worked
        if (error.error) { throw new Error(error.error) }
        else             { return result.response }
    }

    public createSession(): Promise<VCSSessionId> {
        const request: VCSSessionCreationRequest = { requestId: "session-creation", data: null }
        return this.unwrapResponse(this.client.createSession(request), VCSOperation.CreateSession)
    }

    public closeSession(sessionId: VCSSessionId): Promise<void> {
        const request = this.createSessionRequest(sessionId, null)
        return this.unwrapResponse(this.client.closeSession(request), VCSOperation.CloseSession)
    }

    public waitForCurrentRequests(sessionId: VCSSessionId): Promise<void> {
        const request = this.createSessionRequest(sessionId, null)
        return this.unwrapResponse(this.client.waitForCurrentRequests(request), VCSOperation.WaitForCurrentRequests)
    }

    public loadFile(sessionId: VCSSessionId, options: VCSFileLoadingOptions): Promise<VCSRootBlockInfo> {
        const request = this.createSessionRequest(sessionId, { options })
        return this.unwrapResponse(this.client.loadFile(request), VCSOperation.LoadFile)
    }

    public updateFilePath(fileId: VCSFileId, filePath: string): Promise<VCSFileId> {
        const request = this.createSessionRequest(fileId, { fileId, filePath })
        return this.unwrapResponse(this.client.updateFilePath(request), VCSOperation.UpdateFilePath)
    }

    public unloadFile(fileId: VCSFileId): Promise<void> {
        const request = this.createSessionRequest(fileId, { fileId })
        return this.unwrapResponse(this.client.unloadFile(request), VCSOperation.UnloadFile)
    }

    public getText(blockId: VCSBlockId): Promise<string> {
        const request = this.createSessionRequest(blockId, { blockId })
        return this.unwrapResponse(this.client.getText(request), VCSOperation.GetText)
    }

    public getRootText(blockId: VCSBlockId): Promise<string> {
        const request = this.createSessionRequest(blockId, { blockId })
        return this.unwrapResponse(this.client.getRootText(request), VCSOperation.GetRootText)
    }

    public lineChanged(blockId: VCSBlockId, change: LineChange): Promise<VCSBlockId[]> {
        const request = this.createSessionRequest(blockId, { blockId, change })
        return this.unwrapResponse(this.client.lineChanged(request), VCSOperation.LineChanged)
    }

    public linesChanged(blockId: VCSBlockId, change: MultiLineChange): Promise<VCSBlockId[]> {
        const request = this.createSessionRequest(blockId, { blockId, change })
        return this.unwrapResponse(this.client.linesChanged(request), VCSOperation.LinesChanged)
    }

    public applyChange(blockId: VCSBlockId, change: AnyChange): Promise<VCSBlockId[]> {
        const request = this.createSessionRequest(blockId, { blockId, change })
        return this.unwrapResponse(this.client.applyChange(request), VCSOperation.ApplyChange)
    }

    public applyChanges(blockId: VCSBlockId, changes: ChangeSet): Promise<VCSBlockId[]> {
        const request = this.createSessionRequest(blockId, { blockId, changes })
        return this.unwrapResponse(this.client.applyChanges(request), VCSOperation.ApplyChanges)
    }

    public copyBlock(blockId: VCSBlockId): Promise<VCSCopyBlockInfo> {
        const request = this.createSessionRequest(blockId, { blockId })
        return this.unwrapResponse(this.client.copyBlock(request), VCSOperation.CopyBlock)
    }

    public createChild(parentBlockId: VCSBlockId, range: VCSBlockRange): Promise<VCSChildBlockInfo | null> {
        const request = this.createSessionRequest(parentBlockId, { parentBlockId, range })
        return this.unwrapResponse(this.client.createChild(request), VCSOperation.CreateChild)
    }

    public deleteBlock(blockId: VCSBlockId): Promise<void> {
        const request = this.createSessionRequest(blockId, { blockId })
        return this.unwrapResponse(this.client.deleteBlock(request), VCSOperation.DeleteBlock)
    }

    public getBlockInfo(blockId: VCSBlockId): Promise<VCSBlockInfo> {
        const request = this.createSessionRequest(blockId, { blockId })
        return this.unwrapResponse(this.client.getBlockInfo(request), VCSOperation.GetBlockInfo)
    }

    public getChildrenInfo(blockId: VCSBlockId): Promise<VCSBlockInfo[]> {
        const request = this.createSessionRequest(blockId, { blockId })
        return this.unwrapResponse(this.client.getChildrenInfo(request), VCSOperation.GetChildrenInfo)
    }

    public updateBlock(blockId: VCSBlockId, update: VCSBlockUpdate): Promise<void> {
        const request = this.createSessionRequest(blockId, { blockId, update })
        return this.unwrapResponse(this.client.updateBlock(request), VCSOperation.UpdateBlock)
    }

    public syncBlocks(source: VCSBlockId, target: VCSBlockId): Promise<string> {
        const request = this.createSessionRequest(target, { source, target })
        return this.unwrapResponse(this.client.syncBlocks(request), VCSOperation.SyncBlocks)
    }

    public setBlockVersionIndex(blockId: VCSBlockId, versionIndex: number): Promise<string> {
        const request = this.createSessionRequest(blockId, { blockId, versionIndex })
        return this.unwrapResponse(this.client.setBlockVersionIndex(request), VCSOperation.SetBlockVersionIndex)
    }

    public saveCurrentBlockVersion(blockId: VCSBlockId, options?: { name?: string, description?: string, codeForAi?: string }): Promise<VCSTagInfo> {
        const request = this.createSessionRequest(blockId, { blockId, name: options?.name, description: options?.name, codeForAi: options?.codeForAi })
        return this.unwrapResponse(this.client.saveCurrentBlockVersion(request), VCSOperation.SaveCurrentBlockVersion)
    }

    public applyTag(tagId: VCSTagId, blockId: VCSBlockId): Promise<VCSBlockInfo> {
        const request = this.createSessionRequest(blockId, { tagId, blockId })
        return this.unwrapResponse(this.client.applyTag(request), VCSOperation.ApplyTag)
    }

    public getErrorHint(sessionId: VCSSessionId, code: string, errorMessage: string): Promise<string | null> {
        const request = this.createSessionRequest(sessionId, { code, errorMessage })
        return this.unwrapResponse(this.client.getErrorHint(request), VCSOperation.GetErrorHint)
    }


    public onRequestSend(callback: () => void, filter?: { requestTypes?: { include?: VCSRequestType[], exclude?: VCSRequestType[] }, operations?: { include?: VCSOperation[], exclude?: VCSOperation[] } }): Disposable {

        const requestCallback = { requestTypes: filter.requestTypes, operations: filter.operations, callback }
        this.requestCallbacks.push(requestCallback)

        return this.addSubscription({
            dispose: () => {
                const index = this.requestCallbacks.indexOf(requestCallback, 0);
                if (index > -1) { this.requestCallbacks.splice(index, 1); }
            }
        });
    }
}

export class VCSSession {

    public readonly client:  VCSUnwrappedClient
    public readonly session: VCSSessionId

    public static async create(client: VCSClient): Promise<VCSSession> {
        const unwrappedClient = new VCSUnwrappedClient(client)
        const session = await unwrappedClient.createSession()
        return new VCSSession(unwrappedClient, session)
    }

    public constructor(client: VCSUnwrappedClient, session: VCSSessionId) {
        this.client  = client
        this.session = session
    }

    public createFileIdFrom(filePath: string): VCSFileId {
        return VCSFileId.createFrom(this.session, filePath)
    }

    public async loadFile(options: VCSFileLoadingOptions): Promise<VCSBlockSession> {
        const blockInfo = await this.client.loadFile(this.session, options)
        return VCSBlockSession.createFileSession(this, blockInfo)
    }

    public waitForCurrentRequests(): Promise<void> {
        return this.client.waitForCurrentRequests(this.session)
    }

    public syncBlocks(source: VCSBlockId, target: VCSBlockId): Promise<string> {
        return this.client.syncBlocks(source, target)
    }

    public getErrorHint(code: string, errorMessage: string): Promise<string | null> {
        return this.client.getErrorHint(this.session, code, errorMessage)
    }

    public onRequestSend(callback: () => void, filter?: { requestTypes?: { include?: VCSRequestType[], exclude?: VCSRequestType[] }, operations?: { include?: VCSOperation[], exclude?: VCSOperation[] } }): Disposable {
        return this.client.onRequestSend(callback, filter)
    }

    // WARNING: This will also close all active block sessions belonging to this session! Any further operation on them will fail!
    public close(): Promise<void> {
        return this.client.closeSession(this.session)
    }
}

export class VCSBlockSession {

    public readonly session:     VCSSession
    public          block:       VCSBlockId
    public readonly isRootBlock: boolean

    public get client():  VCSUnwrappedClient { return this.session.client }
    public get blockId(): string             { return this.block.blockId }

    public static createFileSession(session: VCSSession, rootBlock: VCSBlockId): VCSBlockSession {
        return new VCSBlockSession(session, rootBlock, true)
    }

    private constructor(hostSession: VCSSession, block: VCSBlockId, isRootBlock: boolean) {
        this.session     = hostSession
        this.block       = block
        this.isRootBlock = isRootBlock
    }

    public createChildIdFrom(blockId: string): VCSBlockId {
        return VCSBlockId.createFrom(this.block, blockId)
    }

    public async waitForCurrentRequests(): Promise<void> {
        await this.session.waitForCurrentRequests()
    }

    public async updateFilePath(filePath: string): Promise<VCSFileId> {
        const fileId = await this.client.updateFilePath(this.block, filePath)
        this.block   = VCSBlockId.createFrom(fileId, this.blockId)
        return fileId
    }

    public getText(): Promise<string> {
        return this.client.getText(this.block)
    }

    public getRootText(): Promise<string> {
        return this.client.getRootText(this.block)
    }

    public lineChanged(change: LineChange): Promise<VCSBlockId[]> {
        return this.client.lineChanged(this.block, change)
    }

    public linesChanged(change: MultiLineChange): Promise<VCSBlockId[]> {
        return this.client.linesChanged(this.block, change)
    }

    public applyChange(change: AnyChange): Promise<VCSBlockId[]> {
        return this.client.applyChange(this.block, change)
    }

    public applyChanges(changes: ChangeSet): Promise<VCSBlockId[]> {
        return this.client.applyChanges(this.block, changes)
    }

    public async copyBlock(blockId: VCSBlockId): Promise<VCSBlockSession> {
        const copyBlock = await this.client.copyBlock(blockId)
        return new VCSBlockSession(this.session, copyBlock, false)
    }

    public copy(): Promise<VCSBlockSession> {
        return this.copyBlock(this.block)
    }

    public createChild(range: VCSBlockRange): Promise<VCSChildBlockInfo | null> {
        return this.client.createChild(this.block, range)
    }

    public async getChild(childBlockId: VCSBlockId): Promise<VCSBlockSession> {
        const child = await this.client.getBlockInfo(childBlockId)
        return new VCSBlockSession(this.session, child, false)
    }

    public deleteChild(childBlockId: VCSBlockId): Promise<void> {
        return this.client.deleteBlock(childBlockId)
    }

    public getBlockInfo(): Promise<VCSBlockInfo> {
        return this.client.getBlockInfo(this.block)
    }

    public getChildInfo(childBlockId: VCSBlockId): Promise<VCSBlockInfo> {
        return this.client.getBlockInfo(childBlockId)
    }

    public getChildrenInfo(): Promise<VCSBlockInfo[]> {
        return this.client.getChildrenInfo(this.block)
    }

    public updateBlock(update: VCSBlockUpdate): Promise<void> {
        return this.client.updateBlock(this.block, update)
    }

    public updateChildBlock(childBlockId: VCSBlockId, update: VCSBlockUpdate): Promise<void> {
        return this.client.updateBlock(childBlockId, update)
    }

    public syncBlocks(source: VCSBlockId, target: VCSBlockId): Promise<string> {
        return this.session.syncBlocks(source, target)
    }

    public syncWithBlock(source: VCSBlockId): Promise<string> {
        return this.syncBlocks(source, this.block)
    }

    public syncFromBlock(target: VCSBlockId): Promise<string> {
        return this.syncBlocks(this.block, target)
    }

    public setVersionIndex(versionIndex: number): Promise<string> {
        return this.client.setBlockVersionIndex(this.block, versionIndex)
    }

    public setChildBlockVersionIndex(childBlockId: VCSBlockId, versionIndex: number): Promise<string> {
        return this.client.setBlockVersionIndex(childBlockId, versionIndex)
    }

    public saveBlockVersion(options?: { name?: string, description?: string, codeForAi?: string }): Promise<VCSTagInfo> {
        return this.client.saveCurrentBlockVersion(this.block, options)
    }

    public saveChildBlockVersion(childBlockId: VCSBlockId, options?: { name?: string, description?: string, codeForAi?: string }): Promise<VCSTagInfo> {
        return this.client.saveCurrentBlockVersion(childBlockId, options)
    }

    public applyTag(tagId: VCSTagId): Promise<VCSBlockInfo> {
        return this.client.applyTag(tagId, this.block)
    }

    public applyTagToChild(tagId: VCSTagId, childBlockId: VCSBlockId): Promise<VCSBlockInfo> {
        return this.client.applyTag(tagId, childBlockId)
    }

    public getErrorHint(code: string, errorMessage: string): Promise<string | null> {
        return this.session.getErrorHint(code, errorMessage)
    }

    public onRequestSend(callback: () => void, filter?: { requestTypes?: { include?: VCSRequestType[], exclude?: VCSRequestType[] }, operations?: { include?: VCSOperation[], exclude?: VCSOperation[] } }): Disposable {
        return this.client.onRequestSend(callback, filter)
    }

    public async close(): Promise<void> {
        if (this.isRootBlock) {
            this.client.unloadFile(this.block)
        } else {
            // QUESTION: Should copy blocks be deleted?
            // await this.client.deleteBlock(this.block)
        }
    }
}

// adapter that allows to build an adaptable server with varying backend
export type VCSAdapter = VCSProvider
export abstract class BasicVCSAdapter extends BasicVCSProvider implements VCSAdapter {}

// support interface to allow for constructor typing of adapters
export interface VCSAdapterClass<Adapter extends VCSAdapter> {
    new(): Adapter
}

// adaptable server with varying backend implemented as an adapter
export class AdaptableVCSServer<Adapter extends VCSAdapter> extends BasicVCSServer implements VCSServer {
    
    public readonly adapter: Adapter

    public static create<Adapter extends VCSAdapter>(adapterClass: VCSAdapterClass<Adapter>): AdaptableVCSServer<Adapter> {
        const adapter = new adapterClass()
        return new this(adapter)
    }

    public constructor(adapter: Adapter) {
        super()
        this.adapter = adapter
    }

    public createSession(request: VCSSessionCreationRequest): Promise<VCSResponse<VCSSessionId>> {
        return this.adapter.createSession(request)
    }

    public closeSession(request: VCSSessionRequest<void>): Promise<VCSResponse<void>> {
        return this.adapter.closeSession(request)
    }

    public waitForCurrentRequests(request: VCSSessionRequest<void>): Promise<VCSResponse<void>> {
        return this.adapter.waitForCurrentRequests(request)
    }

    public loadFile(request: VCSSessionRequest<{ options: VCSFileLoadingOptions }>): Promise<VCSResponse<VCSRootBlockInfo>> {
        return this.adapter.loadFile(request)
    }

    public updateFilePath(request: VCSSessionRequest<{ fileId: VCSFileId; filePath: string; }>): Promise<VCSResponse<VCSFileId>> {
        return this.adapter.updateFilePath(request)
    }

    public unloadFile(request: VCSSessionRequest<{ fileId: VCSFileId }>): Promise<VCSResponse<void>> {
        return this.adapter.unloadFile(request)
    }

    public getText(request: VCSSessionRequest<{ blockId: VCSBlockId }>): Promise<VCSResponse<string>> {
        return this.adapter.getText(request)
    }

    public getRootText(request: VCSSessionRequest<{ blockId: VCSBlockId }>): Promise<VCSResponse<string>> {
        return this.adapter.getRootText(request)
    }

    public lineChanged(request: VCSSessionRequest<{ blockId: VCSBlockId, change: LineChange }>): Promise<VCSResponse<VCSBlockId[]>> {
        return this.adapter.lineChanged(request)
    }

    public linesChanged(request: VCSSessionRequest<{ blockId: VCSBlockId, change: MultiLineChange }>): Promise<VCSResponse<VCSBlockId[]>> {
        return this.adapter.linesChanged(request)
    }

    public copyBlock(request: VCSSessionRequest<{ blockId: VCSBlockId }>): Promise<VCSResponse<VCSCopyBlockInfo>> {
        return this.adapter.copyBlock(request)
    }

    public createChild(request: VCSSessionRequest<{ parentBlockId: VCSBlockId, range: VCSBlockRange }>): Promise<VCSResponse<VCSChildBlockInfo | null>> {
        return this.adapter.createChild(request)
    }

    public deleteBlock(request: VCSSessionRequest<{ blockId: VCSBlockId }>): Promise<VCSResponse<void>> {
        return this.adapter.deleteBlock(request)
    }

    public getBlockInfo(request: VCSSessionRequest<{ blockId: VCSBlockId }>): Promise<VCSResponse<VCSBlockInfo>> {
        return this.adapter.getBlockInfo(request)
    }

    public getChildrenInfo(request: VCSSessionRequest<{ blockId: VCSBlockId }>): Promise<VCSResponse<VCSBlockInfo[]>> {
        return this.adapter.getChildrenInfo(request)
    }

    public updateBlock(request: VCSSessionRequest<{ blockId: VCSBlockId, update: VCSBlockUpdate }>): Promise<VCSResponse<void>> {
        return this.adapter.updateBlock(request)
    }

    public syncBlocks(request: VCSSessionRequest<{ source: VCSBlockId; target: VCSBlockId; }>): Promise<VCSResponse<string>> {
        return this.adapter.syncBlocks(request)
    }

    public setBlockVersionIndex(request: VCSSessionRequest<{ blockId: VCSBlockId, versionIndex: number }>): Promise<VCSResponse<string>> {
        return this.adapter.setBlockVersionIndex(request)
    }

    public saveCurrentBlockVersion(request: VCSSessionRequest<{ blockId: VCSBlockId, name?: string, description?: string, codeForAi?: string }>): Promise<VCSResponse<VCSTagInfo>> {
        return this.adapter.saveCurrentBlockVersion(request)
    }

    public applyTag(request: VCSSessionRequest<{ tagId: VCSTagId, blockId: VCSBlockId }>): Promise<VCSResponse<VCSBlockInfo>> {
        return this.adapter.applyTag(request)
    }

    public getErrorHint(request: VCSSessionRequest<{ code: string, errorMessage: string }>): Promise<VCSResponse<string | null>> {
        return this.adapter.getErrorHint(request)
    }
}