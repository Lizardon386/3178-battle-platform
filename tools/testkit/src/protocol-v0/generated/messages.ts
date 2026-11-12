// 由 protocol/v0/messages.schema.json + catalog.json 生成；请勿手改。
// To parse this data:
//
//   import { Convert, ProtocolTypes } from "./messages";
//
//   const protocolTypes = Convert.toProtocolTypes(json);
//
// These functions will throw an error if the JSON doesn't
// match the expected interface, even if the JSON is valid.

export interface ProtocolTypes {
    AuthorityDeliver?:     AuthorityDeliver;
    AuthorityError?:       AuthorityError;
    AuthorityPong?:        AuthorityPong;
    AuthorityReady?:       AuthorityReady;
    AuthorityRoundClosed?: AuthorityRoundClosed;
    ClientChat?:           ClientChat;
    ClientCloseSession?:   ClientCloseSession;
    ClientGame?:           ClientGame;
    ClientGameAuth?:       ClientGameAuth;
    ClientGameHandoff?:    ClientGameHandoff;
    ClientHello?:          ClientHello;
    ClientKick?:           ClientKick;
    ClientLeave?:          ClientLeave;
    ClientPing?:           ClientPing;
    ClientResume?:         ClientResume;
    ClientSessionCreate?:  ClientSessionCreate;
    ClientSessionJoin?:    ClientSessionJoin;
    ClientSetConfig?:      ClientSetConfig;
    ClientSetReady?:       ClientSetReady;
    ClientSetSeatOptions?: ClientSetSeatOptions;
    ClientStartGame?:      ClientStartGame;
    ClientTransferHost?:   ClientTransferHost;
    PlatformCloseSession?: PlatformCloseSession;
    PlatformDeliver?:      PlatformDeliver;
    PlatformHostChanged?:  PlatformHostChanged;
    PlatformMemberJoin?:   PlatformMemberJoin;
    PlatformMemberLeave?:  PlatformMemberLeave;
    PlatformMemberResume?: PlatformMemberResume;
    PlatformMemberUpdate?: PlatformMemberUpdate;
    PlatformPing?:         PlatformPing;
    PlatformStart?:        PlatformStart;
    ServerChat?:           ServerChat;
    ServerError?:          ServerError;
    ServerGame?:           ServerGame;
    ServerGameGranted?:    ServerGameGranted;
    ServerGameHandoff?:    ServerGameHandoff;
    ServerNotice?:         ServerNotice;
    ServerPong?:           ServerPong;
    ServerSeatGranted?:    ServerSeatGranted;
    ServerSessionState?:   ServerSessionState;
    ServerWelcome?:        ServerWelcome;
}

export interface AuthorityDeliver {
    items: [ItemElement, ...ItemElement[]];
    type:  AuthorityDeliverType;
}

export interface ItemElement {
    payload: unknown;
    to:      ToEnum | number;
}

export type ToEnum = "all";

export type AuthorityDeliverType = "deliver";

export interface AuthorityError {
    code:  string;
    fatal: boolean;
    text:  string;
    type:  AuthorityErrorType;
}

export type AuthorityErrorType = "authorityError";

export interface AuthorityPong {
    nonce: string;
    type:  AuthorityPongType;
}

export type AuthorityPongType = "pong";

export interface AuthorityReady {
    processStatus: ProcessStatus;
    type:          AuthorityReadyType;
}

export type ProcessStatus = "running";

export type AuthorityReadyType = "authorityReady";

export interface AuthorityRoundClosed {
    payload: unknown;
    type:    AuthorityRoundClosedType;
}

export type AuthorityRoundClosedType = "roundClosed";

export interface ClientChat {
    text: string;
    type: ClientChatType;
}

export type ClientChatType = "chat";

export interface ClientCloseSession {
    type: ClientCloseSessionType;
}

export type ClientCloseSessionType = "closeSession";

export interface ClientGame {
    payload: unknown;
    type:    ClientGameType;
}

export type ClientGameType = "game";

export interface ClientGameAuth {
    gameTicket?:  string;
    handoffCode?: string;
    type:         ClientGameAuthType;
}

export type ClientGameAuthType = "gameAuth";

export interface ClientGameHandoff {
    type: ClientGameHandoffType;
}

export type ClientGameHandoffType = "gameHandoff";

export interface ClientHello {
    capabilities:    string[];
    clientKind:      ClientKind;
    protocolVersion: number;
    type:            ClientHelloType;
}

export type ClientKind = "native" | "web" | "mobile";

export type ClientHelloType = "hello";

export interface ClientKick {
    targetSeat: number;
    type:       ClientKickType;
}

export type ClientKickType = "kick";

export interface ClientLeave {
    type: ClientLeaveType;
}

export type ClientLeaveType = "leave";

export interface ClientPing {
    nonce: string;
    type:  ClientPingType;
}

export type ClientPingType = "ping";

export interface ClientResume {
    code:     string;
    profile?: Profile;
    ticket:   string;
    type:     ClientResumeType;
}

export interface Profile {
    avatar?:       string;
    displayColor?: string;
    nick:          string;
}

export type ClientResumeType = "resume";

export interface ClientSessionCreate {
    config:      { [key: string]: unknown };
    gameId:      string;
    memberSlots: number;
    options:     { [key: string]: unknown };
    password?:   string;
    profile:     Profile;
    roomName:    string;
    type:        ClientSessionCreateType;
    version:     string;
}

export type ClientSessionCreateType = "sessionCreate";

export interface ClientSessionJoin {
    code:        string;
    credentials: { [key: string]: unknown };
    gameId:      string;
    profile:     Profile;
    rulesHash:   string;
    type:        ClientSessionJoinType;
    version:     string;
}

export type ClientSessionJoinType = "sessionJoin";

export interface ClientSetConfig {
    config: { [key: string]: unknown };
    type:   ClientSetConfigType;
}

export type ClientSetConfigType = "setConfig";

export interface ClientSetReady {
    ready: boolean;
    type:  ClientSetReadyType;
}

export type ClientSetReadyType = "setReady";

export interface ClientSetSeatOptions {
    options: { [key: string]: unknown };
    seatId:  number;
    type:    ClientSetSeatOptionsType;
}

export type ClientSetSeatOptionsType = "setSeatOptions";

export interface ClientStartGame {
    type: ClientStartGameType;
}

export type ClientStartGameType = "startGame";

export interface ClientTransferHost {
    targetSeat: number;
    type:       ClientTransferHostType;
}

export type ClientTransferHostType = "transferHost";

export interface PlatformCloseSession {
    reason: string;
    type:   ClientCloseSessionType;
}

export interface PlatformDeliver {
    fromSeat: number;
    payload:  unknown;
    revision: number;
    type:     AuthorityDeliverType;
}

export interface PlatformHostChanged {
    hostSeatId: number;
    revision:   number;
    type:       PlatformHostChangedType;
}

export type PlatformHostChangedType = "hostChanged";

export interface PlatformMemberJoin {
    member:   Member;
    revision: number;
    type:     PlatformMemberJoinType;
}

export interface Member {
    connected: boolean;
    kind:      Kind;
    options:   { [key: string]: unknown };
    profile:   Profile;
    ready:     boolean;
    seatId:    number;
}

export type Kind = "player" | "ai" | "spectator";

export type PlatformMemberJoinType = "memberJoin";

export interface PlatformMemberLeave {
    reason:   Reason;
    revision: number;
    seatId:   number;
    type:     PlatformMemberLeaveType;
}

export type Reason = "disconnected" | "left" | "kicked";

export type PlatformMemberLeaveType = "memberLeave";

export interface PlatformMemberResume {
    profile:  Profile;
    revision: number;
    seatId:   number;
    type:     PlatformMemberResumeType;
}

export type PlatformMemberResumeType = "memberResume";

export interface PlatformMemberUpdate {
    options:  { [key: string]: unknown };
    profile:  Profile;
    ready:    boolean;
    revision: number;
    seatId:   number;
    type:     PlatformMemberUpdateType;
}

export type PlatformMemberUpdateType = "memberUpdate";

export interface PlatformPing {
    nonce: string;
    type:  ClientPingType;
}

export interface PlatformStart {
    gameId:        string;
    hostSeatId:    number;
    members:       Member[];
    revision:      number;
    sessionCode:   string;
    sessionConfig: { [key: string]: unknown };
    type:          PlatformStartType;
    version:       string;
}

export type PlatformStartType = "start";

export interface ServerChat {
    fromSeat: number;
    profile:  Profile;
    sentAt:   number;
    text:     string;
    type:     ClientChatType;
}

export interface ServerError {
    code:     string;
    details?: { [key: string]: unknown };
    text:     string;
    type:     ServerErrorType;
}

export type ServerErrorType = "error";

export interface ServerGame {
    fromSeat?: number;
    payload:   unknown;
    type:      ClientGameType;
}

export interface ServerGameGranted {
    gameTicket: string;
    seatId:     number;
    sessionId:  string;
    type:       ServerGameGrantedType;
}

export type ServerGameGrantedType = "gameGranted";

export interface ServerGameHandoff {
    expiresAt:   number;
    handoffCode: string;
    type:        ClientGameHandoffType;
    url:         string;
}

export interface ServerNotice {
    code: string;
    text: string;
    type: ServerNoticeType;
}

export type ServerNoticeType = "notice";

export interface ServerPong {
    nonce: string;
    type:  AuthorityPongType;
}

export interface ServerSeatGranted {
    profile:     Profile;
    seatId:      number;
    sessionCode: string;
    ticket:      string;
    type:        ServerSeatGrantedType;
}

export type ServerSeatGrantedType = "seatGranted";

export interface ServerSessionState {
    code:        string;
    gameProcess: GameProcess;
    hostSeatId:  number;
    members:     Member[];
    revision:    number;
    sessionId:   string;
    state:       State;
    type:        ServerSessionStateType;
}

export type GameProcess = "stopped" | "starting" | "running" | "failed" | "exited";

export type State = "open" | "closed";

export type ServerSessionStateType = "sessionState";

export interface ServerWelcome {
    protocolVersion: number;
    serverVersion:   string;
    supported:       string[];
    type:            ServerWelcomeType;
}

export type ServerWelcomeType = "welcome";

// Converts JSON strings to/from your types
// and asserts the results of JSON.parse at runtime
export class Convert {
    public static toProtocolTypes(json: string): ProtocolTypes {
        return cast(JSON.parse(json), r("ProtocolTypes"));
    }

    public static protocolTypesToJson(value: ProtocolTypes): string {
        return JSON.stringify(uncast(value, r("ProtocolTypes")), null, 2);
    }
}

function invalidValue(typ: any, val: any, key: any, parent: any = ''): never {
    const prettyTyp = prettyTypeName(typ);
    const parentText = parent ? ` on ${parent}` : '';
    const keyText = key ? ` for key "${key}"` : '';
    throw Error(`Invalid value${keyText}${parentText}. Expected ${prettyTyp} but got ${JSON.stringify(val)}`);
}

function prettyTypeName(typ: any): string {
    if (Array.isArray(typ)) {
        if (typ.length === 2 && typ[0] === undefined) {
            return `an optional ${prettyTypeName(typ[1])}`;
        } else {
            return `one of [${typ.map(a => { return prettyTypeName(a); }).join(", ")}]`;
        }
    } else if (typeof typ === "object" && typ.literal !== undefined) {
        return typ.literal;
    } else {
        return typeof typ;
    }
}

function jsonToJSProps(typ: any): any {
    if (typ.jsonToJS === undefined) {
        const map: any = {};
        typ.props.forEach((p: any) => map[p.json] = { key: p.js, typ: p.typ });
        typ.jsonToJS = map;
    }
    return typ.jsonToJS;
}

function jsToJSONProps(typ: any): any {
    if (typ.jsToJSON === undefined) {
        const map: any = {};
        typ.props.forEach((p: any) => map[p.js] = { key: p.json, typ: p.typ });
        typ.jsToJSON = map;
    }
    return typ.jsToJSON;
}

function transform(val: any, typ: any, getProps: any, key: any = '', parent: any = ''): any {
    function transformPrimitive(typ: string, val: any): any {
        if (typeof typ === typeof val) return val;
        return invalidValue(typ, val, key, parent);
    }

    function transformUnion(typs: any[], val: any): any {
        // val must validate against one typ in typs
        const l = typs.length;
        for (let i = 0; i < l; i++) {
            const typ = typs[i];
            try {
                return transform(val, typ, getProps);
            } catch (_) {}
        }
        return invalidValue(typs, val, key, parent);
    }

    function transformEnum(cases: string[], val: any): any {
        if (cases.indexOf(val) !== -1) return val;
        return invalidValue(cases.map(a => { return l(a); }), val, key, parent);
    }

    function transformArray(typ: any, val: any): any {
        // val must be an array with no invalid elements
        if (!Array.isArray(val)) return invalidValue(l("array"), val, key, parent);
        return val.map(el => transform(el, typ, getProps));
    }

    function transformDate(val: any): any {
        if (val === null) {
            return null;
        }
        const d = new Date(val);
        if (isNaN(d.valueOf())) {
            return invalidValue(l("Date"), val, key, parent);
        }
        return d;
    }

    function transformObject(props: { [k: string]: any }, additional: any, val: any): any {
        if (val === null || typeof val !== "object" || Array.isArray(val)) {
            return invalidValue(l(ref || "object"), val, key, parent);
        }
        const result: any = {};
        Object.getOwnPropertyNames(props).forEach(key => {
            const prop = props[key];
            const v = Object.prototype.hasOwnProperty.call(val, key) ? val[key] : undefined;
            result[prop.key] = transform(v, prop.typ, getProps, key, ref);
        });
        Object.getOwnPropertyNames(val).forEach(key => {
            if (!Object.prototype.hasOwnProperty.call(props, key)) {
                result[key] = transform(val[key], additional, getProps, key, ref);
            }
        });
        return result;
    }

    if (typ === "any") return val;
    if (typ === null) {
        if (val === null) return val;
        return invalidValue(typ, val, key, parent);
    }
    if (typ === false) return invalidValue(typ, val, key, parent);
    let ref: any = undefined;
    while (typeof typ === "object" && typ.ref !== undefined) {
        ref = typ.ref;
        typ = typeMap[typ.ref];
    }
    if (Array.isArray(typ)) return transformEnum(typ, val);
    if (typeof typ === "object") {
        return typ.hasOwnProperty("unionMembers") ? transformUnion(typ.unionMembers, val)
            : typ.hasOwnProperty("arrayItems")    ? transformArray(typ.arrayItems, val)
            : typ.hasOwnProperty("props")         ? transformObject(getProps(typ), typ.additional, val)
            : invalidValue(typ, val, key, parent);
    }
    // Numbers can be parsed by Date but shouldn't be.
    if (typ === Date && typeof val !== "number") return transformDate(val);
    return transformPrimitive(typ, val);
}

function cast<T>(val: any, typ: any): T {
    return transform(val, typ, jsonToJSProps);
}

function uncast<T>(val: T, typ: any): any {
    return transform(val, typ, jsToJSONProps);
}

function l(typ: any) {
    return { literal: typ };
}

function a(typ: any) {
    return { arrayItems: typ };
}

function u(...typs: any[]) {
    return { unionMembers: typs };
}

function o(props: any[], additional: any) {
    return { props, additional };
}

function m(additional: any) {
    return { props: [], additional };
}

function r(name: string) {
    return { ref: name };
}

const typeMap: any = {
    "ProtocolTypes": o([
        { json: "AuthorityDeliver", js: "AuthorityDeliver", typ: u(undefined, r("AuthorityDeliver")) },
        { json: "AuthorityError", js: "AuthorityError", typ: u(undefined, r("AuthorityError")) },
        { json: "AuthorityPong", js: "AuthorityPong", typ: u(undefined, r("AuthorityPong")) },
        { json: "AuthorityReady", js: "AuthorityReady", typ: u(undefined, r("AuthorityReady")) },
        { json: "AuthorityRoundClosed", js: "AuthorityRoundClosed", typ: u(undefined, r("AuthorityRoundClosed")) },
        { json: "ClientChat", js: "ClientChat", typ: u(undefined, r("ClientChat")) },
        { json: "ClientCloseSession", js: "ClientCloseSession", typ: u(undefined, r("ClientCloseSession")) },
        { json: "ClientGame", js: "ClientGame", typ: u(undefined, r("ClientGame")) },
        { json: "ClientGameAuth", js: "ClientGameAuth", typ: u(undefined, r("ClientGameAuth")) },
        { json: "ClientGameHandoff", js: "ClientGameHandoff", typ: u(undefined, r("ClientGameHandoff")) },
        { json: "ClientHello", js: "ClientHello", typ: u(undefined, r("ClientHello")) },
        { json: "ClientKick", js: "ClientKick", typ: u(undefined, r("ClientKick")) },
        { json: "ClientLeave", js: "ClientLeave", typ: u(undefined, r("ClientLeave")) },
        { json: "ClientPing", js: "ClientPing", typ: u(undefined, r("ClientPing")) },
        { json: "ClientResume", js: "ClientResume", typ: u(undefined, r("ClientResume")) },
        { json: "ClientSessionCreate", js: "ClientSessionCreate", typ: u(undefined, r("ClientSessionCreate")) },
        { json: "ClientSessionJoin", js: "ClientSessionJoin", typ: u(undefined, r("ClientSessionJoin")) },
        { json: "ClientSetConfig", js: "ClientSetConfig", typ: u(undefined, r("ClientSetConfig")) },
        { json: "ClientSetReady", js: "ClientSetReady", typ: u(undefined, r("ClientSetReady")) },
        { json: "ClientSetSeatOptions", js: "ClientSetSeatOptions", typ: u(undefined, r("ClientSetSeatOptions")) },
        { json: "ClientStartGame", js: "ClientStartGame", typ: u(undefined, r("ClientStartGame")) },
        { json: "ClientTransferHost", js: "ClientTransferHost", typ: u(undefined, r("ClientTransferHost")) },
        { json: "PlatformCloseSession", js: "PlatformCloseSession", typ: u(undefined, r("PlatformCloseSession")) },
        { json: "PlatformDeliver", js: "PlatformDeliver", typ: u(undefined, r("PlatformDeliver")) },
        { json: "PlatformHostChanged", js: "PlatformHostChanged", typ: u(undefined, r("PlatformHostChanged")) },
        { json: "PlatformMemberJoin", js: "PlatformMemberJoin", typ: u(undefined, r("PlatformMemberJoin")) },
        { json: "PlatformMemberLeave", js: "PlatformMemberLeave", typ: u(undefined, r("PlatformMemberLeave")) },
        { json: "PlatformMemberResume", js: "PlatformMemberResume", typ: u(undefined, r("PlatformMemberResume")) },
        { json: "PlatformMemberUpdate", js: "PlatformMemberUpdate", typ: u(undefined, r("PlatformMemberUpdate")) },
        { json: "PlatformPing", js: "PlatformPing", typ: u(undefined, r("PlatformPing")) },
        { json: "PlatformStart", js: "PlatformStart", typ: u(undefined, r("PlatformStart")) },
        { json: "ServerChat", js: "ServerChat", typ: u(undefined, r("ServerChat")) },
        { json: "ServerError", js: "ServerError", typ: u(undefined, r("ServerError")) },
        { json: "ServerGame", js: "ServerGame", typ: u(undefined, r("ServerGame")) },
        { json: "ServerGameGranted", js: "ServerGameGranted", typ: u(undefined, r("ServerGameGranted")) },
        { json: "ServerGameHandoff", js: "ServerGameHandoff", typ: u(undefined, r("ServerGameHandoff")) },
        { json: "ServerNotice", js: "ServerNotice", typ: u(undefined, r("ServerNotice")) },
        { json: "ServerPong", js: "ServerPong", typ: u(undefined, r("ServerPong")) },
        { json: "ServerSeatGranted", js: "ServerSeatGranted", typ: u(undefined, r("ServerSeatGranted")) },
        { json: "ServerSessionState", js: "ServerSessionState", typ: u(undefined, r("ServerSessionState")) },
        { json: "ServerWelcome", js: "ServerWelcome", typ: u(undefined, r("ServerWelcome")) },
    ], false),
    "AuthorityDeliver": o([
        { json: "items", js: "items", typ: a(r("ItemElement")) },
        { json: "type", js: "type", typ: r("AuthorityDeliverType") },
    ], false),
    "ItemElement": o([
        { json: "payload", js: "payload", typ: "any" },
        { json: "to", js: "to", typ: u(r("ToEnum"), 0) },
    ], false),
    "AuthorityError": o([
        { json: "code", js: "code", typ: "" },
        { json: "fatal", js: "fatal", typ: true },
        { json: "text", js: "text", typ: "" },
        { json: "type", js: "type", typ: r("AuthorityErrorType") },
    ], false),
    "AuthorityPong": o([
        { json: "nonce", js: "nonce", typ: "" },
        { json: "type", js: "type", typ: r("AuthorityPongType") },
    ], false),
    "AuthorityReady": o([
        { json: "processStatus", js: "processStatus", typ: r("ProcessStatus") },
        { json: "type", js: "type", typ: r("AuthorityReadyType") },
    ], false),
    "AuthorityRoundClosed": o([
        { json: "payload", js: "payload", typ: "any" },
        { json: "type", js: "type", typ: r("AuthorityRoundClosedType") },
    ], false),
    "ClientChat": o([
        { json: "text", js: "text", typ: "" },
        { json: "type", js: "type", typ: r("ClientChatType") },
    ], false),
    "ClientCloseSession": o([
        { json: "type", js: "type", typ: r("ClientCloseSessionType") },
    ], false),
    "ClientGame": o([
        { json: "payload", js: "payload", typ: "any" },
        { json: "type", js: "type", typ: r("ClientGameType") },
    ], false),
    "ClientGameAuth": o([
        { json: "gameTicket", js: "gameTicket", typ: u(undefined, "") },
        { json: "handoffCode", js: "handoffCode", typ: u(undefined, "") },
        { json: "type", js: "type", typ: r("ClientGameAuthType") },
    ], false),
    "ClientGameHandoff": o([
        { json: "type", js: "type", typ: r("ClientGameHandoffType") },
    ], false),
    "ClientHello": o([
        { json: "capabilities", js: "capabilities", typ: a("") },
        { json: "clientKind", js: "clientKind", typ: r("ClientKind") },
        { json: "protocolVersion", js: "protocolVersion", typ: 0 },
        { json: "type", js: "type", typ: r("ClientHelloType") },
    ], false),
    "ClientKick": o([
        { json: "targetSeat", js: "targetSeat", typ: 0 },
        { json: "type", js: "type", typ: r("ClientKickType") },
    ], false),
    "ClientLeave": o([
        { json: "type", js: "type", typ: r("ClientLeaveType") },
    ], false),
    "ClientPing": o([
        { json: "nonce", js: "nonce", typ: "" },
        { json: "type", js: "type", typ: r("ClientPingType") },
    ], false),
    "ClientResume": o([
        { json: "code", js: "code", typ: "" },
        { json: "profile", js: "profile", typ: u(undefined, r("Profile")) },
        { json: "ticket", js: "ticket", typ: "" },
        { json: "type", js: "type", typ: r("ClientResumeType") },
    ], false),
    "Profile": o([
        { json: "avatar", js: "avatar", typ: u(undefined, "") },
        { json: "displayColor", js: "displayColor", typ: u(undefined, "") },
        { json: "nick", js: "nick", typ: "" },
    ], false),
    "ClientSessionCreate": o([
        { json: "config", js: "config", typ: m("any") },
        { json: "gameId", js: "gameId", typ: "" },
        { json: "memberSlots", js: "memberSlots", typ: 0 },
        { json: "options", js: "options", typ: m("any") },
        { json: "password", js: "password", typ: u(undefined, "") },
        { json: "profile", js: "profile", typ: r("Profile") },
        { json: "roomName", js: "roomName", typ: "" },
        { json: "type", js: "type", typ: r("ClientSessionCreateType") },
        { json: "version", js: "version", typ: "" },
    ], false),
    "ClientSessionJoin": o([
        { json: "code", js: "code", typ: "" },
        { json: "credentials", js: "credentials", typ: m("any") },
        { json: "gameId", js: "gameId", typ: "" },
        { json: "profile", js: "profile", typ: r("Profile") },
        { json: "rulesHash", js: "rulesHash", typ: "" },
        { json: "type", js: "type", typ: r("ClientSessionJoinType") },
        { json: "version", js: "version", typ: "" },
    ], false),
    "ClientSetConfig": o([
        { json: "config", js: "config", typ: m("any") },
        { json: "type", js: "type", typ: r("ClientSetConfigType") },
    ], false),
    "ClientSetReady": o([
        { json: "ready", js: "ready", typ: true },
        { json: "type", js: "type", typ: r("ClientSetReadyType") },
    ], false),
    "ClientSetSeatOptions": o([
        { json: "options", js: "options", typ: m("any") },
        { json: "seatId", js: "seatId", typ: 0 },
        { json: "type", js: "type", typ: r("ClientSetSeatOptionsType") },
    ], false),
    "ClientStartGame": o([
        { json: "type", js: "type", typ: r("ClientStartGameType") },
    ], false),
    "ClientTransferHost": o([
        { json: "targetSeat", js: "targetSeat", typ: 0 },
        { json: "type", js: "type", typ: r("ClientTransferHostType") },
    ], false),
    "PlatformCloseSession": o([
        { json: "reason", js: "reason", typ: "" },
        { json: "type", js: "type", typ: r("ClientCloseSessionType") },
    ], false),
    "PlatformDeliver": o([
        { json: "fromSeat", js: "fromSeat", typ: 0 },
        { json: "payload", js: "payload", typ: "any" },
        { json: "revision", js: "revision", typ: 0 },
        { json: "type", js: "type", typ: r("AuthorityDeliverType") },
    ], false),
    "PlatformHostChanged": o([
        { json: "hostSeatId", js: "hostSeatId", typ: 0 },
        { json: "revision", js: "revision", typ: 0 },
        { json: "type", js: "type", typ: r("PlatformHostChangedType") },
    ], false),
    "PlatformMemberJoin": o([
        { json: "member", js: "member", typ: r("Member") },
        { json: "revision", js: "revision", typ: 0 },
        { json: "type", js: "type", typ: r("PlatformMemberJoinType") },
    ], false),
    "Member": o([
        { json: "connected", js: "connected", typ: true },
        { json: "kind", js: "kind", typ: r("Kind") },
        { json: "options", js: "options", typ: m("any") },
        { json: "profile", js: "profile", typ: r("Profile") },
        { json: "ready", js: "ready", typ: true },
        { json: "seatId", js: "seatId", typ: 0 },
    ], false),
    "PlatformMemberLeave": o([
        { json: "reason", js: "reason", typ: r("Reason") },
        { json: "revision", js: "revision", typ: 0 },
        { json: "seatId", js: "seatId", typ: 0 },
        { json: "type", js: "type", typ: r("PlatformMemberLeaveType") },
    ], false),
    "PlatformMemberResume": o([
        { json: "profile", js: "profile", typ: r("Profile") },
        { json: "revision", js: "revision", typ: 0 },
        { json: "seatId", js: "seatId", typ: 0 },
        { json: "type", js: "type", typ: r("PlatformMemberResumeType") },
    ], false),
    "PlatformMemberUpdate": o([
        { json: "options", js: "options", typ: m("any") },
        { json: "profile", js: "profile", typ: r("Profile") },
        { json: "ready", js: "ready", typ: true },
        { json: "revision", js: "revision", typ: 0 },
        { json: "seatId", js: "seatId", typ: 0 },
        { json: "type", js: "type", typ: r("PlatformMemberUpdateType") },
    ], false),
    "PlatformPing": o([
        { json: "nonce", js: "nonce", typ: "" },
        { json: "type", js: "type", typ: r("ClientPingType") },
    ], false),
    "PlatformStart": o([
        { json: "gameId", js: "gameId", typ: "" },
        { json: "hostSeatId", js: "hostSeatId", typ: 0 },
        { json: "members", js: "members", typ: a(r("Member")) },
        { json: "revision", js: "revision", typ: 0 },
        { json: "sessionCode", js: "sessionCode", typ: "" },
        { json: "sessionConfig", js: "sessionConfig", typ: m("any") },
        { json: "type", js: "type", typ: r("PlatformStartType") },
        { json: "version", js: "version", typ: "" },
    ], false),
    "ServerChat": o([
        { json: "fromSeat", js: "fromSeat", typ: 0 },
        { json: "profile", js: "profile", typ: r("Profile") },
        { json: "sentAt", js: "sentAt", typ: 0 },
        { json: "text", js: "text", typ: "" },
        { json: "type", js: "type", typ: r("ClientChatType") },
    ], false),
    "ServerError": o([
        { json: "code", js: "code", typ: "" },
        { json: "details", js: "details", typ: u(undefined, m("any")) },
        { json: "text", js: "text", typ: "" },
        { json: "type", js: "type", typ: r("ServerErrorType") },
    ], false),
    "ServerGame": o([
        { json: "fromSeat", js: "fromSeat", typ: u(undefined, 0) },
        { json: "payload", js: "payload", typ: "any" },
        { json: "type", js: "type", typ: r("ClientGameType") },
    ], false),
    "ServerGameGranted": o([
        { json: "gameTicket", js: "gameTicket", typ: "" },
        { json: "seatId", js: "seatId", typ: 0 },
        { json: "sessionId", js: "sessionId", typ: "" },
        { json: "type", js: "type", typ: r("ServerGameGrantedType") },
    ], false),
    "ServerGameHandoff": o([
        { json: "expiresAt", js: "expiresAt", typ: 0 },
        { json: "handoffCode", js: "handoffCode", typ: "" },
        { json: "type", js: "type", typ: r("ClientGameHandoffType") },
        { json: "url", js: "url", typ: "" },
    ], false),
    "ServerNotice": o([
        { json: "code", js: "code", typ: "" },
        { json: "text", js: "text", typ: "" },
        { json: "type", js: "type", typ: r("ServerNoticeType") },
    ], false),
    "ServerPong": o([
        { json: "nonce", js: "nonce", typ: "" },
        { json: "type", js: "type", typ: r("AuthorityPongType") },
    ], false),
    "ServerSeatGranted": o([
        { json: "profile", js: "profile", typ: r("Profile") },
        { json: "seatId", js: "seatId", typ: 0 },
        { json: "sessionCode", js: "sessionCode", typ: "" },
        { json: "ticket", js: "ticket", typ: "" },
        { json: "type", js: "type", typ: r("ServerSeatGrantedType") },
    ], false),
    "ServerSessionState": o([
        { json: "code", js: "code", typ: "" },
        { json: "gameProcess", js: "gameProcess", typ: r("GameProcess") },
        { json: "hostSeatId", js: "hostSeatId", typ: 0 },
        { json: "members", js: "members", typ: a(r("Member")) },
        { json: "revision", js: "revision", typ: 0 },
        { json: "sessionId", js: "sessionId", typ: "" },
        { json: "state", js: "state", typ: r("State") },
        { json: "type", js: "type", typ: r("ServerSessionStateType") },
    ], false),
    "ServerWelcome": o([
        { json: "protocolVersion", js: "protocolVersion", typ: 0 },
        { json: "serverVersion", js: "serverVersion", typ: "" },
        { json: "supported", js: "supported", typ: a("") },
        { json: "type", js: "type", typ: r("ServerWelcomeType") },
    ], false),
    "ToEnum": [
        "all",
    ],
    "AuthorityDeliverType": [
        "deliver",
    ],
    "AuthorityErrorType": [
        "authorityError",
    ],
    "AuthorityPongType": [
        "pong",
    ],
    "ProcessStatus": [
        "running",
    ],
    "AuthorityReadyType": [
        "authorityReady",
    ],
    "AuthorityRoundClosedType": [
        "roundClosed",
    ],
    "ClientChatType": [
        "chat",
    ],
    "ClientCloseSessionType": [
        "closeSession",
    ],
    "ClientGameType": [
        "game",
    ],
    "ClientGameAuthType": [
        "gameAuth",
    ],
    "ClientGameHandoffType": [
        "gameHandoff",
    ],
    "ClientKind": [
        "mobile",
        "native",
        "web",
    ],
    "ClientHelloType": [
        "hello",
    ],
    "ClientKickType": [
        "kick",
    ],
    "ClientLeaveType": [
        "leave",
    ],
    "ClientPingType": [
        "ping",
    ],
    "ClientResumeType": [
        "resume",
    ],
    "ClientSessionCreateType": [
        "sessionCreate",
    ],
    "ClientSessionJoinType": [
        "sessionJoin",
    ],
    "ClientSetConfigType": [
        "setConfig",
    ],
    "ClientSetReadyType": [
        "setReady",
    ],
    "ClientSetSeatOptionsType": [
        "setSeatOptions",
    ],
    "ClientStartGameType": [
        "startGame",
    ],
    "ClientTransferHostType": [
        "transferHost",
    ],
    "PlatformHostChangedType": [
        "hostChanged",
    ],
    "Kind": [
        "ai",
        "player",
        "spectator",
    ],
    "PlatformMemberJoinType": [
        "memberJoin",
    ],
    "Reason": [
        "disconnected",
        "kicked",
        "left",
    ],
    "PlatformMemberLeaveType": [
        "memberLeave",
    ],
    "PlatformMemberResumeType": [
        "memberResume",
    ],
    "PlatformMemberUpdateType": [
        "memberUpdate",
    ],
    "PlatformStartType": [
        "start",
    ],
    "ServerErrorType": [
        "error",
    ],
    "ServerGameGrantedType": [
        "gameGranted",
    ],
    "ServerNoticeType": [
        "notice",
    ],
    "ServerSeatGrantedType": [
        "seatGranted",
    ],
    "GameProcess": [
        "exited",
        "failed",
        "running",
        "starting",
        "stopped",
    ],
    "State": [
        "closed",
        "open",
    ],
    "ServerSessionStateType": [
        "sessionState",
    ],
    "ServerWelcomeType": [
        "welcome",
    ],
};

export type ClientToPlatformMessage = ClientHello | ClientSessionCreate | ClientSessionJoin | ClientResume | ClientSetReady | ClientStartGame | ClientSetConfig | ClientSetSeatOptions | ClientLeave | ClientTransferHost | ClientKick | ClientCloseSession | ClientGame | ClientChat | ClientGameHandoff | ClientGameAuth | ClientPing;

export type PlatformToClientMessage = ServerWelcome | ServerSeatGranted | ServerSessionState | ServerGame | ServerChat | ServerGameHandoff | ServerGameGranted | ServerNotice | ServerError | ServerPong;

export type PlatformToAuthorityMessage = PlatformStart | PlatformMemberJoin | PlatformMemberLeave | PlatformMemberResume | PlatformMemberUpdate | PlatformHostChanged | PlatformDeliver | PlatformCloseSession | PlatformPing;

export type AuthorityToPlatformMessage = AuthorityReady | AuthorityDeliver | AuthorityRoundClosed | AuthorityError | AuthorityPong;

export type ProtocolMessage = ClientToPlatformMessage | PlatformToClientMessage | PlatformToAuthorityMessage | AuthorityToPlatformMessage;
