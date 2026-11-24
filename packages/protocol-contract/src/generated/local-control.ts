// 由 protocol/local-control 生成；请勿手改。
// To parse this data:
//
//   import { Convert, ProtocolTypes } from "./types";
//
//   const protocolTypes = Convert.toProtocolTypes(json);
//
// These functions will throw an error if the JSON doesn't
// match the expected interface, even if the JSON is valid.

export interface ProtocolTypes {
    AuthorityStatus?:   AuthorityStatus;
    ClientHello?:       ClientHello;
    ControlError?:      ControlError;
    Diagnose?:          Diagnose;
    Ping?:              Ping;
    Pong?:              Pong;
    RecoverAuthority?:  RecoverAuthority;
    ServiceStart?:      ServiceStart;
    ServiceStatus?:     ServiceStatus;
    ServiceStop?:       ServiceStop;
    Shutdown?:          Shutdown;
    StartAuthority?:    StartAuthority;
    StopAuthority?:     StopAuthority;
    SupervisorWelcome?: SupervisorWelcome;
}

export interface AuthorityStatus {
    epoch?:    number;
    error?:    string;
    pid?:      number;
    sessionId: string;
    state:     AuthorityStatusState;
    type:      AuthorityStatusType;
}

export type AuthorityStatusState = "stopped" | "starting" | "readyWait" | "running" | "stopping" | "failed" | "exited";

export type AuthorityStatusType = "authorityStatus";

export interface ClientHello {
    clientKind: ClientKind;
    type:       ClientHelloType;
    version:    number;
}

export type ClientKind = "ui" | "service";

export type ClientHelloType = "hello";

export interface ControlError {
    code: string;
    text: string;
    type: ControlErrorType;
}

export type ControlErrorType = "error";

export interface Diagnose {
    type: DiagnoseType;
}

export type DiagnoseType = "diagnose";

export interface Ping {
    nonce: string;
    type:  PingType;
}

export type PingType = "ping";

export interface Pong {
    nonce: string;
    type:  PongType;
}

export type PongType = "pong";

export interface RecoverAuthority {
    epoch:     number;
    sessionId: string;
    type:      RecoverAuthorityType;
}

export type RecoverAuthorityType = "recoverAuthority";

export interface ServiceStart {
    type: ServiceStartType;
}

export type ServiceStartType = "serviceStart";

export interface ServiceStatus {
    gamePort?: number;
    lanPort?:  number;
    pid?:      number;
    state:     ServiceStatusState;
    type:      ServiceStatusType;
    uiPort?:   number;
}

export type ServiceStatusState = "stopped" | "starting" | "running" | "failed" | "exited";

export type ServiceStatusType = "serviceStatus";

export interface ServiceStop {
    type: ServiceStopType;
}

export type ServiceStopType = "serviceStop";

export interface Shutdown {
    type: ShutdownType;
}

export type ShutdownType = "shutdown";

export interface StartAuthority {
    args?:     string[];
    cwd?:      string;
    entry:     string;
    env?:      { [key: string]: string };
    epoch:     number;
    runtime:   string;
    sessionId: string;
    type:      StartAuthorityType;
}

export type StartAuthorityType = "startAuthority";

export interface StopAuthority {
    reason?:   string;
    sessionId: string;
    type:      StopAuthorityType;
}

export type StopAuthorityType = "stopAuthority";

export interface SupervisorWelcome {
    serverVersion: string;
    type:          SupervisorWelcomeType;
    version:       number;
}

export type SupervisorWelcomeType = "welcome";

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
        { json: "AuthorityStatus", js: "AuthorityStatus", typ: u(undefined, r("AuthorityStatus")) },
        { json: "ClientHello", js: "ClientHello", typ: u(undefined, r("ClientHello")) },
        { json: "ControlError", js: "ControlError", typ: u(undefined, r("ControlError")) },
        { json: "Diagnose", js: "Diagnose", typ: u(undefined, r("Diagnose")) },
        { json: "Ping", js: "Ping", typ: u(undefined, r("Ping")) },
        { json: "Pong", js: "Pong", typ: u(undefined, r("Pong")) },
        { json: "RecoverAuthority", js: "RecoverAuthority", typ: u(undefined, r("RecoverAuthority")) },
        { json: "ServiceStart", js: "ServiceStart", typ: u(undefined, r("ServiceStart")) },
        { json: "ServiceStatus", js: "ServiceStatus", typ: u(undefined, r("ServiceStatus")) },
        { json: "ServiceStop", js: "ServiceStop", typ: u(undefined, r("ServiceStop")) },
        { json: "Shutdown", js: "Shutdown", typ: u(undefined, r("Shutdown")) },
        { json: "StartAuthority", js: "StartAuthority", typ: u(undefined, r("StartAuthority")) },
        { json: "StopAuthority", js: "StopAuthority", typ: u(undefined, r("StopAuthority")) },
        { json: "SupervisorWelcome", js: "SupervisorWelcome", typ: u(undefined, r("SupervisorWelcome")) },
    ], false),
    "AuthorityStatus": o([
        { json: "epoch", js: "epoch", typ: u(undefined, 0) },
        { json: "error", js: "error", typ: u(undefined, "") },
        { json: "pid", js: "pid", typ: u(undefined, 0) },
        { json: "sessionId", js: "sessionId", typ: "" },
        { json: "state", js: "state", typ: r("AuthorityStatusState") },
        { json: "type", js: "type", typ: r("AuthorityStatusType") },
    ], false),
    "ClientHello": o([
        { json: "clientKind", js: "clientKind", typ: r("ClientKind") },
        { json: "type", js: "type", typ: r("ClientHelloType") },
        { json: "version", js: "version", typ: 3.14 },
    ], false),
    "ControlError": o([
        { json: "code", js: "code", typ: "" },
        { json: "text", js: "text", typ: "" },
        { json: "type", js: "type", typ: r("ControlErrorType") },
    ], false),
    "Diagnose": o([
        { json: "type", js: "type", typ: r("DiagnoseType") },
    ], false),
    "Ping": o([
        { json: "nonce", js: "nonce", typ: "" },
        { json: "type", js: "type", typ: r("PingType") },
    ], false),
    "Pong": o([
        { json: "nonce", js: "nonce", typ: "" },
        { json: "type", js: "type", typ: r("PongType") },
    ], false),
    "RecoverAuthority": o([
        { json: "epoch", js: "epoch", typ: 0 },
        { json: "sessionId", js: "sessionId", typ: "" },
        { json: "type", js: "type", typ: r("RecoverAuthorityType") },
    ], false),
    "ServiceStart": o([
        { json: "type", js: "type", typ: r("ServiceStartType") },
    ], false),
    "ServiceStatus": o([
        { json: "gamePort", js: "gamePort", typ: u(undefined, 0) },
        { json: "lanPort", js: "lanPort", typ: u(undefined, 0) },
        { json: "pid", js: "pid", typ: u(undefined, 0) },
        { json: "state", js: "state", typ: r("ServiceStatusState") },
        { json: "type", js: "type", typ: r("ServiceStatusType") },
        { json: "uiPort", js: "uiPort", typ: u(undefined, 0) },
    ], false),
    "ServiceStop": o([
        { json: "type", js: "type", typ: r("ServiceStopType") },
    ], false),
    "Shutdown": o([
        { json: "type", js: "type", typ: r("ShutdownType") },
    ], false),
    "StartAuthority": o([
        { json: "args", js: "args", typ: u(undefined, a("")) },
        { json: "cwd", js: "cwd", typ: u(undefined, "") },
        { json: "entry", js: "entry", typ: "" },
        { json: "env", js: "env", typ: u(undefined, m("")) },
        { json: "epoch", js: "epoch", typ: 0 },
        { json: "runtime", js: "runtime", typ: "" },
        { json: "sessionId", js: "sessionId", typ: "" },
        { json: "type", js: "type", typ: r("StartAuthorityType") },
    ], false),
    "StopAuthority": o([
        { json: "reason", js: "reason", typ: u(undefined, "") },
        { json: "sessionId", js: "sessionId", typ: "" },
        { json: "type", js: "type", typ: r("StopAuthorityType") },
    ], false),
    "SupervisorWelcome": o([
        { json: "serverVersion", js: "serverVersion", typ: "" },
        { json: "type", js: "type", typ: r("SupervisorWelcomeType") },
        { json: "version", js: "version", typ: 3.14 },
    ], false),
    "AuthorityStatusState": [
        "exited",
        "failed",
        "readyWait",
        "running",
        "starting",
        "stopped",
        "stopping",
    ],
    "AuthorityStatusType": [
        "authorityStatus",
    ],
    "ClientKind": [
        "service",
        "ui",
    ],
    "ClientHelloType": [
        "hello",
    ],
    "ControlErrorType": [
        "error",
    ],
    "DiagnoseType": [
        "diagnose",
    ],
    "PingType": [
        "ping",
    ],
    "PongType": [
        "pong",
    ],
    "RecoverAuthorityType": [
        "recoverAuthority",
    ],
    "ServiceStartType": [
        "serviceStart",
    ],
    "ServiceStatusState": [
        "exited",
        "failed",
        "running",
        "starting",
        "stopped",
    ],
    "ServiceStatusType": [
        "serviceStatus",
    ],
    "ServiceStopType": [
        "serviceStop",
    ],
    "ShutdownType": [
        "shutdown",
    ],
    "StartAuthorityType": [
        "startAuthority",
    ],
    "StopAuthorityType": [
        "stopAuthority",
    ],
    "SupervisorWelcomeType": [
        "welcome",
    ],
};
