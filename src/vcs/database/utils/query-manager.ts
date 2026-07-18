import { VCSRequestType, VCSSessionRequest, VCSResponse } from "../../provider"
import Session, { ISessionFile, ISessionLine, ISessionVersion, ISessionBlock, ISessionTag } from "../session"
import log from "electron-log"

class Query<QueryData, QueryResult, SessionFile extends ISessionFile, SessionLine extends ISessionLine, SessionVersion extends ISessionVersion<SessionLine>, SessionBlock extends ISessionBlock<SessionFile, SessionBlock, SessionLine, SessionTag>, SessionTag extends ISessionTag, QuerySession extends Session<SessionFile, SessionLine, SessionVersion, SessionBlock, SessionTag>, Manager extends QueryManager<SessionFile, SessionLine, SessionVersion, SessionBlock, SessionTag, QuerySession>> {

    public readonly request:   VCSSessionRequest<QueryData>
    public readonly type:      VCSRequestType

    private readonly manager: Manager
    private readonly query:   (session: QuerySession, data: QueryData) => QueryResult | Promise<QueryResult>

    private readonly promise: Promise<VCSResponse<QueryResult>>
    private          resolve: (value: VCSResponse<QueryResult> | PromiseLike<VCSResponse<QueryResult>>) => void
    private          reject:  (reason?: any) => void

    public get session():     QuerySession { return this.manager.session }
    public get requestId():   string       { return this.request.requestId }
    public get data():        QueryData    { return this.request.data }

    public constructor(manager: Manager, request: VCSSessionRequest<QueryData>, type: VCSRequestType, query: (session: QuerySession, data: QueryData) => QueryResult | Promise<QueryResult>) {
        this.manager = manager
        this.request = request
        this.type    = type
        this.query   = query

        this.promise = new Promise((resolve, reject) => {
            this.resolve = resolve
            this.reject  = reject
        })
    }

    public getPromise(): Promise<VCSResponse<QueryResult>> {
        return this.promise
    }

    public async execute(): Promise<void> {
        this.manager.queryRunning(this)
        const requestId = this.requestId

        try {
            const response = await this.query(this.session, this.data)
            this.manager.queryFinished(this)
            this.resolve({ requestId, response })
        } catch (error) {
            log.error(error)
            throw error // handle errors in the backend for debugging -> if handling in front end is desired, comment this line out
            this.manager.queryFinished(this)
            this.resolve({ requestId, error: error.message })
        }
    }
}

type AnyQuery<SessionFile extends ISessionFile, SessionLine extends ISessionLine, SessionVersion extends ISessionVersion<SessionLine>, SessionBlock extends ISessionBlock<SessionFile, SessionBlock, SessionLine, SessionTag>, SessionTag extends ISessionTag, QuerySession extends Session<SessionFile, SessionLine, SessionVersion, SessionBlock, SessionTag>, Manager extends QueryManager<SessionFile, SessionLine, SessionVersion, SessionBlock, SessionTag, QuerySession>>        = Query<any, any, SessionFile, SessionLine, SessionVersion, SessionBlock, SessionTag, QuerySession, Manager>
type AnyWaitingQuery<SessionFile extends ISessionFile, SessionLine extends ISessionLine, SessionVersion extends ISessionVersion<SessionLine>, SessionBlock extends ISessionBlock<SessionFile, SessionBlock, SessionLine, SessionTag>, SessionTag extends ISessionTag, QuerySession extends Session<SessionFile, SessionLine, SessionVersion, SessionBlock, SessionTag>, Manager extends QueryManager<SessionFile, SessionLine, SessionVersion, SessionBlock, SessionTag, QuerySession>> = { requiredRequestId: string, query: AnyQuery<SessionFile, SessionLine, SessionVersion, SessionBlock, SessionTag, QuerySession, Manager> }

export default class QueryManager<SessionFile extends ISessionFile, SessionLine extends ISessionLine, SessionVersion extends ISessionVersion<SessionLine>, SessionBlock extends ISessionBlock<SessionFile, SessionBlock, SessionLine, SessionTag>, SessionTag extends ISessionTag, QuerySession extends Session<SessionFile, SessionLine, SessionVersion, SessionBlock, SessionTag>> {

    public readonly session: QuerySession

    private readonly waiting                                                                                                   = new Map<string, AnyWaitingQuery<SessionFile, SessionLine, SessionVersion, SessionBlock, SessionTag, QuerySession, this>>()
    private readonly ready: AnyQuery<SessionFile, SessionLine, SessionVersion, SessionBlock, SessionTag, QuerySession, this>[] = []
    private readonly running                                                                                                   = new Map<string, AnyQuery<SessionFile, SessionLine, SessionVersion, SessionBlock, SessionTag, QuerySession, this>>()

    private readonly finishedRequestIds: string[] = []

    private currentQueryChain?:     string                                          = undefined
    private breakingChainCallback?: (session: QuerySession) => void | Promise<void> = undefined

    public constructor(session: QuerySession) {
        this.session = session
    }

    private setWaiting(query: AnyQuery<SessionFile, SessionLine, SessionVersion, SessionBlock, SessionTag, QuerySession, this>, requiredRequestId?: string): void {
        if (requiredRequestId) { this.waiting.set(query.requestId, { requiredRequestId, query }) }
        else                   { this.setReady(query) }
    }

    private setReady(query: AnyQuery<SessionFile, SessionLine, SessionVersion, SessionBlock, SessionTag, QuerySession, this>): void {
        this.waiting.delete(query.requestId)
        this.ready.push(query)
    }

    private tryQueries(): void {
        const waitingQueries = Array.from(this.waiting.values())
        waitingQueries.forEach(({ requiredRequestId, query }) => {
            if (this.finishedRequestIds.includes(requiredRequestId)) {
                const index = this.finishedRequestIds.indexOf(requiredRequestId, 0)
                if (index >= 0) { this.finishedRequestIds.splice(index, 1) }
                this.setReady(query)
            }
        })

        const runningQueries        = Array.from(this.running.values())
        const hasRunningQueries     = runningQueries.length > 0
        const noWriteQueriesRunning = runningQueries.every(query => query.type !== VCSRequestType.ReadWrite)

        if (this.ready.length > 0) {
            const firstType = this.ready[0].type 
            if (firstType === VCSRequestType.ReadWrite && !hasRunningQueries) {
                this.ready[0].execute()
                this.ready.splice(0, 1)
            } else if(noWriteQueriesRunning) {
                while(this.ready.length > 0 && this.ready[0].type !== VCSRequestType.ReadWrite) {
                    this.ready[0].execute()
                    this.ready.splice(0, 1)
                }
            }
        }
    }

    private createNewQuery<RequestData, QueryResult>(request: VCSSessionRequest<RequestData>, queryType: VCSRequestType, query: (session: QuerySession, data: RequestData) => QueryResult | Promise<QueryResult>): Promise<VCSResponse<QueryResult>> {
        const newQuery = new Query(this, request, queryType, query)

        this.setWaiting(newQuery, request.previousRequestId)
        this.tryQueries()

        return newQuery.getPromise()
    }

    private startQueryChain(chainId: string, onChainInterrupt: (session: QuerySession) => void | Promise<void>): void {
        this.currentQueryChain     = chainId
        this.breakingChainCallback = onChainInterrupt
    }

    private async breakQueryChain(): Promise<void> {
        if (this.currentQueryChain !== undefined) {
            await this.breakingChainCallback(this.session)
            this.currentQueryChain     = undefined
            this.breakingChainCallback = undefined   
        }
    }

    public async createQuery<RequestData, QueryResult>(request: VCSSessionRequest<RequestData>, queryType: VCSRequestType, query: (session: QuerySession, data: RequestData) => QueryResult | Promise<QueryResult>): Promise<VCSResponse<QueryResult>> {
        if (queryType === VCSRequestType.ReadWrite) { await this.breakQueryChain() }
        return this.createNewQuery(request, queryType, query)
    }

    // WARNING: Right now, query chains are only interrupted by new chains of unchained readwrite queries, assuming that we can always read inbetween a chain!!!
    public async createQueryChain<RequestData, QueryResult>(chainId: string, request: VCSSessionRequest<RequestData>, queryType: VCSRequestType, query: (session: QuerySession, data: RequestData) => QueryResult | Promise<QueryResult>, onChainInterrupt: (session: QuerySession) => void | Promise<void>): Promise<VCSResponse<QueryResult>> {
        if (this.currentQueryChain !== chainId) {
            // console.log("Start Chain: " + chainId)
            await this.breakQueryChain()
            this.startQueryChain(chainId, onChainInterrupt)
        }
        
        return this.createNewQuery(request, queryType, query)
    }

    public queryRunning(query: AnyQuery<SessionFile, SessionLine, SessionVersion, SessionBlock, SessionTag, QuerySession, this>): void {
        this.waiting.delete(query.requestId)
        const index = this.ready.indexOf(query, 0)
        if (index >= 0) { this.ready.splice(index, 1) }
        this.running.set(query.requestId, query)
    }

    public queryFinished(query: AnyQuery<SessionFile, SessionLine, SessionVersion, SessionBlock, SessionTag, QuerySession, this>): void {
        this.running.delete(query.requestId)
        this.finishedRequestIds.push(query.requestId)
        this.tryQueries()
    }
}