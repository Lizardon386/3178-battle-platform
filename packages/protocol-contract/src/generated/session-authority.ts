// 由 protocol/session-authority 生成；请勿手改。
// To parse this data:
//
//   import { Convert, ProtocolTypes } from "./types";
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
    PlatformCloseSession?: PlatformCloseSession;
    PlatformDeliver?:      PlatformDeliver;
    PlatformHostChanged?:  PlatformHostChanged;
    PlatformMemberJoin?:   PlatformMemberJoin;
    PlatformMemberLeave?:  PlatformMemberLeave;
    PlatformMemberResume?: PlatformMemberResume;
    PlatformMemberUpdate?: PlatformMemberUpdate;
    PlatformPing?:         PlatformPing;
    PlatformStart?:        PlatformStart;
    PlatformSync?:         PlatformSync;
}

export interface AuthorityDeliver {
    authorityEpoch: number;
    gameSequence:   number;
    items:          [Schema, ...Schema[]];
    type:           AuthorityDeliverType;
}

export interface Schema {
    payload:       unknown;
    to:            string;
    viewRevision?: number;
}

export type AuthorityDeliverType = "deliver";

export interface AuthorityError {
    authorityEpoch: number;
    code:           string;
    fatal:          boolean;
    text:           string;
    type:           AuthorityErrorType;
}

export type AuthorityErrorType = "authorityError";

export interface AuthorityPong {
    nonce: string;
    type:  AuthorityPongType;
}

export type AuthorityPongType = "pong";

export interface AuthorityReady {
    authorityEpoch: number;
    processStatus:  ProcessStatus;
    type:           AuthorityReadyType;
}

export type ProcessStatus = "running";

export type AuthorityReadyType = "authorityReady";

export interface AuthorityRoundClosed {
    authorityEpoch: number;
    payload:        unknown;
    type:           AuthorityRoundClosedType;
}

export type AuthorityRoundClosedType = "roundClosed";

export interface PlatformCloseSession {
    authorityEpoch: number;
    reason:         string;
    type:           PlatformCloseSessionType;
}

export type PlatformCloseSessionType = "closeSession";

export interface PlatformDeliver {
    actionId:       string;
    authorityEpoch: number;
    fromMemberId:   string;
    payload:        unknown;
    revision:       number;
    type:           AuthorityDeliverType;
}

export interface PlatformHostChanged {
    authorityEpoch: number;
    hostMemberId:   string;
    revision:       number;
    type:           PlatformHostChangedType;
}

export type PlatformHostChangedType = "hostChanged";

export interface PlatformMemberJoin {
    authorityEpoch: number;
    member:         Member;
    revision:       number;
    type:           PlatformMemberJoinType;
}

export interface Member {
    gameConnected: boolean;
    graceUntil?:   number;
    memberId:      string;
    options:       { [key: string]: unknown };
    presence:      Presence;
    profile:       Profile;
    ready:         boolean;
    role:          Role;
    slot?:         number;
}

export type Presence = "online" | "grace";

export interface Profile {
    avatar?:       string;
    displayColor?: string;
    nick:          string;
}

export type Role = "player" | "ai" | "spectator";

export type PlatformMemberJoinType = "memberJoin";

export interface PlatformMemberLeave {
    authorityEpoch: number;
    memberId:       string;
    reason:         Reason;
    revision:       number;
    type:           PlatformMemberLeaveType;
}

export type Reason = "disconnected" | "left" | "kicked" | "expired";

export type PlatformMemberLeaveType = "memberLeave";

export interface PlatformMemberResume {
    authorityEpoch: number;
    memberId:       string;
    profile:        Profile;
    revision:       number;
    type:           PlatformMemberResumeType;
}

export type PlatformMemberResumeType = "memberResume";

export interface PlatformMemberUpdate {
    authorityEpoch: number;
    memberId:       string;
    options:        { [key: string]: unknown };
    profile:        Profile;
    ready:          boolean;
    revision:       number;
    type:           PlatformMemberUpdateType;
}

export type PlatformMemberUpdateType = "memberUpdate";

export interface PlatformPing {
    nonce: string;
    type:  PlatformPingType;
}

export type PlatformPingType = "ping";

export interface PlatformStart {
    authorityEpoch: number;
    gameId:         string;
    hostMemberId:   string;
    members:        Member[];
    revision:       number;
    sessionCode:    string;
    sessionConfig:  { [key: string]: unknown };
    sessionId:      string;
    type:           PlatformStartType;
    version:        string;
}

export type PlatformStartType = "start";

export interface PlatformSync {
    authorityEpoch: number;
    memberId:       string;
    type:           PlatformSyncType;
}

export type PlatformSyncType = "sync";

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
        { json: "PlatformCloseSession", js: "PlatformCloseSession", typ: u(undefined, r("PlatformCloseSession")) },
        { json: "PlatformDeliver", js: "PlatformDeliver", typ: u(undefined, r("PlatformDeliver")) },
        { json: "PlatformHostChanged", js: "PlatformHostChanged", typ: u(undefined, r("PlatformHostChanged")) },
        { json: "PlatformMemberJoin", js: "PlatformMemberJoin", typ: u(undefined, r("PlatformMemberJoin")) },
        { json: "PlatformMemberLeave", js: "PlatformMemberLeave", typ: u(undefined, r("PlatformMemberLeave")) },
        { json: "PlatformMemberResume", js: "PlatformMemberResume", typ: u(undefined, r("PlatformMemberResume")) },
        { json: "PlatformMemberUpdate", js: "PlatformMemberUpdate", typ: u(undefined, r("PlatformMemberUpdate")) },
        { json: "PlatformPing", js: "PlatformPing", typ: u(undefined, r("PlatformPing")) },
        { json: "PlatformStart", js: "PlatformStart", typ: u(undefined, r("PlatformStart")) },
        { json: "PlatformSync", js: "PlatformSync", typ: u(undefined, r("PlatformSync")) },
    ], false),
    "AuthorityDeliver": o([
        { json: "authorityEpoch", js: "authorityEpoch", typ: 0 },
        { json: "gameSequence", js: "gameSequence", typ: 0 },
        { json: "items", js: "items", typ: a(r("Schema")) },
        { json: "type", js: "type", typ: r("AuthorityDeliverType") },
    ], false),
    "Schema": o([
        { json: "payload", js: "payload", typ: "any" },
        { json: "to", js: "to", typ: "" },
        { json: "viewRevision", js: "viewRevision", typ: u(undefined, 0) },
    ], false),
    "AuthorityError": o([
        { json: "authorityEpoch", js: "authorityEpoch", typ: 0 },
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
        { json: "authorityEpoch", js: "authorityEpoch", typ: 0 },
        { json: "processStatus", js: "processStatus", typ: r("ProcessStatus") },
        { json: "type", js: "type", typ: r("AuthorityReadyType") },
    ], false),
    "AuthorityRoundClosed": o([
        { json: "authorityEpoch", js: "authorityEpoch", typ: 0 },
        { json: "payload", js: "payload", typ: "any" },
        { json: "type", js: "type", typ: r("AuthorityRoundClosedType") },
    ], false),
    "PlatformCloseSession": o([
        { json: "authorityEpoch", js: "authorityEpoch", typ: 0 },
        { json: "reason", js: "reason", typ: "" },
        { json: "type", js: "type", typ: r("PlatformCloseSessionType") },
    ], false),
    "PlatformDeliver": o([
        { json: "actionId", js: "actionId", typ: "" },
        { json: "authorityEpoch", js: "authorityEpoch", typ: 0 },
        { json: "fromMemberId", js: "fromMemberId", typ: "" },
        { json: "payload", js: "payload", typ: "any" },
        { json: "revision", js: "revision", typ: 0 },
        { json: "type", js: "type", typ: r("AuthorityDeliverType") },
    ], false),
    "PlatformHostChanged": o([
        { json: "authorityEpoch", js: "authorityEpoch", typ: 0 },
        { json: "hostMemberId", js: "hostMemberId", typ: "" },
        { json: "revision", js: "revision", typ: 0 },
        { json: "type", js: "type", typ: r("PlatformHostChangedType") },
    ], false),
    "PlatformMemberJoin": o([
        { json: "authorityEpoch", js: "authorityEpoch", typ: 0 },
        { json: "member", js: "member", typ: r("Member") },
        { json: "revision", js: "revision", typ: 0 },
        { json: "type", js: "type", typ: r("PlatformMemberJoinType") },
    ], false),
    "Member": o([
        { json: "gameConnected", js: "gameConnected", typ: true },
        { json: "graceUntil", js: "graceUntil", typ: u(undefined, 0) },
        { json: "memberId", js: "memberId", typ: "" },
        { json: "options", js: "options", typ: m("any") },
        { json: "presence", js: "presence", typ: r("Presence") },
        { json: "profile", js: "profile", typ: r("Profile") },
        { json: "ready", js: "ready", typ: true },
        { json: "role", js: "role", typ: r("Role") },
        { json: "slot", js: "slot", typ: u(undefined, 0) },
    ], false),
    "Profile": o([
        { json: "avatar", js: "avatar", typ: u(undefined, "") },
        { json: "displayColor", js: "displayColor", typ: u(undefined, "") },
        { json: "nick", js: "nick", typ: "" },
    ], false),
    "PlatformMemberLeave": o([
        { json: "authorityEpoch", js: "authorityEpoch", typ: 0 },
        { json: "memberId", js: "memberId", typ: "" },
        { json: "reason", js: "reason", typ: r("Reason") },
        { json: "revision", js: "revision", typ: 0 },
        { json: "type", js: "type", typ: r("PlatformMemberLeaveType") },
    ], false),
    "PlatformMemberResume": o([
        { json: "authorityEpoch", js: "authorityEpoch", typ: 0 },
        { json: "memberId", js: "memberId", typ: "" },
        { json: "profile", js: "profile", typ: r("Profile") },
        { json: "revision", js: "revision", typ: 0 },
        { json: "type", js: "type", typ: r("PlatformMemberResumeType") },
    ], false),
    "PlatformMemberUpdate": o([
        { json: "authorityEpoch", js: "authorityEpoch", typ: 0 },
        { json: "memberId", js: "memberId", typ: "" },
        { json: "options", js: "options", typ: m("any") },
        { json: "profile", js: "profile", typ: r("Profile") },
        { json: "ready", js: "ready", typ: true },
        { json: "revision", js: "revision", typ: 0 },
        { json: "type", js: "type", typ: r("PlatformMemberUpdateType") },
    ], false),
    "PlatformPing": o([
        { json: "nonce", js: "nonce", typ: "" },
        { json: "type", js: "type", typ: r("PlatformPingType") },
    ], false),
    "PlatformStart": o([
        { json: "authorityEpoch", js: "authorityEpoch", typ: 0 },
        { json: "gameId", js: "gameId", typ: "" },
        { json: "hostMemberId", js: "hostMemberId", typ: "" },
        { json: "members", js: "members", typ: a(r("Member")) },
        { json: "revision", js: "revision", typ: 0 },
        { json: "sessionCode", js: "sessionCode", typ: "" },
        { json: "sessionConfig", js: "sessionConfig", typ: m("any") },
        { json: "sessionId", js: "sessionId", typ: "" },
        { json: "type", js: "type", typ: r("PlatformStartType") },
        { json: "version", js: "version", typ: "" },
    ], false),
    "PlatformSync": o([
        { json: "authorityEpoch", js: "authorityEpoch", typ: 0 },
        { json: "memberId", js: "memberId", typ: "" },
        { json: "type", js: "type", typ: r("PlatformSyncType") },
    ], false),
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
    "PlatformCloseSessionType": [
        "closeSession",
    ],
    "PlatformHostChangedType": [
        "hostChanged",
    ],
    "Presence": [
        "grace",
        "online",
    ],
    "Role": [
        "ai",
        "player",
        "spectator",
    ],
    "PlatformMemberJoinType": [
        "memberJoin",
    ],
    "Reason": [
        "disconnected",
        "expired",
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
    "PlatformPingType": [
        "ping",
    ],
    "PlatformStartType": [
        "start",
    ],
    "PlatformSyncType": [
        "sync",
    ],
};
