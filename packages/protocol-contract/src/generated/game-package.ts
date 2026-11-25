// 由 protocol/game-package 生成；请勿手改。
// To parse this data:
//
//   import { Convert, GamePackageManifest } from "./types";
//
//   const gamePackageManifest = Convert.toGamePackageManifest(json);
//
// These functions will throw an error if the JSON doesn't
// match the expected interface, even if the JSON is valid.

export interface GamePackageManifest {
    assets?:               AssetElement[];
    authorityModel?:       AuthorityModel;
    entryPoints:           EntryPoints;
    id:                    string;
    lateJoin?:             LateJoin;
    name:                  string;
    platformRequirements:  PlatformRequirements;
    reference:             Reference;
    requiredCapabilities?: string[];
    rulesHash?:            string;
    sessionConfig:         SessionConfig;
    signature?:            Signature;
    version:               string;
}

export interface AssetElement {
    bytes:  number;
    path:   string;
    sha256: string;
}

export type AuthorityModel = "process" | "module";

export interface EntryPoints {
    authority: string;
    web?:      string;
}

export type LateJoin = "spectator" | "player" | "deny";

export interface PlatformRequirements {
    allowSpectate?:  boolean;
    maxPlayers:      number;
    minPlayers:      number;
    protocolVersion: number;
    soloFill?:       boolean;
}

export interface Reference {
    entry: string;
}

export interface SessionConfig {
    fields:       FieldElement[];
    seatOptions?: FieldElement[];
}

export interface FieldElement {
    default:      unknown;
    dependsOn?:   string;
    description?: string;
    key:          string;
    label:        string;
    max?:         number;
    min?:         number;
    options?:     [OptionElement, ...OptionElement[]];
    roles?:       [Role, ...Role[]];
    step?:        number;
    type:         Type;
}

export interface OptionElement {
    label: string;
    value: string;
}

export type Role = "host" | "player" | "ai" | "spectator";

export type Type = "boolean" | "enum" | "integer";

export interface Signature {
    algorithm:  Algorithm;
    publicKey?: string;
    value:      string;
}

export type Algorithm = "ed25519";

// Converts JSON strings to/from your types
// and asserts the results of JSON.parse at runtime
export class Convert {
    public static toGamePackageManifest(json: string): GamePackageManifest {
        return cast(JSON.parse(json), r("GamePackageManifest"));
    }

    public static gamePackageManifestToJson(value: GamePackageManifest): string {
        return JSON.stringify(uncast(value, r("GamePackageManifest")), null, 2);
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
    "GamePackageManifest": o([
        { json: "assets", js: "assets", typ: u(undefined, a(r("AssetElement"))) },
        { json: "authorityModel", js: "authorityModel", typ: u(undefined, r("AuthorityModel")) },
        { json: "entryPoints", js: "entryPoints", typ: r("EntryPoints") },
        { json: "id", js: "id", typ: "" },
        { json: "lateJoin", js: "lateJoin", typ: u(undefined, r("LateJoin")) },
        { json: "name", js: "name", typ: "" },
        { json: "platformRequirements", js: "platformRequirements", typ: r("PlatformRequirements") },
        { json: "reference", js: "reference", typ: r("Reference") },
        { json: "requiredCapabilities", js: "requiredCapabilities", typ: u(undefined, a("")) },
        { json: "rulesHash", js: "rulesHash", typ: u(undefined, "") },
        { json: "sessionConfig", js: "sessionConfig", typ: r("SessionConfig") },
        { json: "signature", js: "signature", typ: u(undefined, r("Signature")) },
        { json: "version", js: "version", typ: "" },
    ], false),
    "AssetElement": o([
        { json: "bytes", js: "bytes", typ: 0 },
        { json: "path", js: "path", typ: "" },
        { json: "sha256", js: "sha256", typ: "" },
    ], false),
    "EntryPoints": o([
        { json: "authority", js: "authority", typ: "" },
        { json: "web", js: "web", typ: u(undefined, "") },
    ], false),
    "PlatformRequirements": o([
        { json: "allowSpectate", js: "allowSpectate", typ: u(undefined, true) },
        { json: "maxPlayers", js: "maxPlayers", typ: 0 },
        { json: "minPlayers", js: "minPlayers", typ: 0 },
        { json: "protocolVersion", js: "protocolVersion", typ: 0 },
        { json: "soloFill", js: "soloFill", typ: u(undefined, true) },
    ], false),
    "Reference": o([
        { json: "entry", js: "entry", typ: "" },
    ], false),
    "SessionConfig": o([
        { json: "fields", js: "fields", typ: a(r("FieldElement")) },
        { json: "seatOptions", js: "seatOptions", typ: u(undefined, a(r("FieldElement"))) },
    ], false),
    "FieldElement": o([
        { json: "default", js: "default", typ: "any" },
        { json: "dependsOn", js: "dependsOn", typ: u(undefined, "") },
        { json: "description", js: "description", typ: u(undefined, "") },
        { json: "key", js: "key", typ: "" },
        { json: "label", js: "label", typ: "" },
        { json: "max", js: "max", typ: u(undefined, 0) },
        { json: "min", js: "min", typ: u(undefined, 0) },
        { json: "options", js: "options", typ: u(undefined, a(r("OptionElement"))) },
        { json: "roles", js: "roles", typ: u(undefined, a(r("Role"))) },
        { json: "step", js: "step", typ: u(undefined, 0) },
        { json: "type", js: "type", typ: r("Type") },
    ], false),
    "OptionElement": o([
        { json: "label", js: "label", typ: "" },
        { json: "value", js: "value", typ: "" },
    ], false),
    "Signature": o([
        { json: "algorithm", js: "algorithm", typ: r("Algorithm") },
        { json: "publicKey", js: "publicKey", typ: u(undefined, "") },
        { json: "value", js: "value", typ: "" },
    ], false),
    "AuthorityModel": [
        "module",
        "process",
    ],
    "LateJoin": [
        "deny",
        "player",
        "spectator",
    ],
    "Role": [
        "ai",
        "host",
        "player",
        "spectator",
    ],
    "Type": [
        "boolean",
        "enum",
        "integer",
    ],
    "Algorithm": [
        "ed25519",
    ],
};
