export { Connection, ConnectionDisposition, ConnectionOperation, ConnectionImpl };
/** How to interpret the set of sources in a connection. */
declare enum ConnectionOperation {
    /** List of sources is absolute. Default. Set on tally for all responses from a provider. */
    Absolute = "ABSOLUTE",
    /** Consumer request that the sources should be connected to the target. */
    Connect = "CONNECT",
    /** Consumer requests that the sources should be disconnected from the target. */
    Disconnect = "DISCONNECT"
}
/** Execution state of a connection operation. */
declare enum ConnectionDisposition {
    /** Sources is the absolute set of current connections. */
    Tally = "TALLY",
    /** Connection has changed. Sources property contains absolute set of current connections. */
    Modified = "MODIFIED",
    /** Connect operation queued and connection is not yet current. */
    Pending = "PENDING",
    /** Connect operation not executed as the target is locked.
     *  Sources property contains absolute set of current connections. */
    Locked = "LOCKED"
}
/**
 *  Description of, or details of request and response to connect or disconnect
 *  a target to some sources.
 */
interface Connection {
    /** Number of the element targeted by the connection. */
    target: number;
    /** Numbers of all sources connected to the target. If omitted, there are no active connections. */
    sources?: Array<number>;
    /** How to interpret the set of sources. */
    operation?: ConnectionOperation;
    /** Indicates the execution state of an connection operation. Response from providers only. */
    disposition?: ConnectionDisposition;
}
declare class ConnectionImpl implements Connection {
    target: number;
    sources?: number[] | undefined;
    operation?: ConnectionOperation | undefined;
    disposition?: ConnectionDisposition | undefined;
    constructor(target: number, sources?: number[] | undefined, operation?: ConnectionOperation | undefined, disposition?: ConnectionDisposition | undefined);
}
//# sourceMappingURL=Connection.d.ts.map