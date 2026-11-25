# 由 protocol/game-package 生成；请勿手改。
from dataclasses import dataclass
from typing import Any, TypeVar, Callable, Type, cast
from enum import Enum


T = TypeVar("T")
EnumT = TypeVar("EnumT", bound=Enum)


def from_int(x: Any) -> int:
    assert isinstance(x, int) and not isinstance(x, bool)
    return x


def from_str(x: Any) -> str:
    assert isinstance(x, str)
    return x


def from_none(x: Any) -> Any:
    assert x is None
    return x


def from_union(fs, x):
    for f in fs:
        try:
            return f(x)
        except:
            pass
    assert False


def from_bool(x: Any) -> bool:
    assert isinstance(x, bool)
    return x


def from_list(f: Callable[[Any], T], x: Any) -> list[T]:
    assert isinstance(x, list)
    return [f(y) for y in x]


def to_enum(c: Type[EnumT], x: Any) -> EnumT:
    assert isinstance(x, c)
    return x.value


def to_class(c: Type[T], x: Any) -> dict:
    assert isinstance(x, c)
    return cast(Any, x).to_dict()


@dataclass
class AssetElement:
    bytes: int
    path: str
    sha256: str

    @staticmethod
    def from_dict(obj: Any) -> 'AssetElement':
        assert isinstance(obj, dict)
        bytes = from_int(obj.get("bytes"))
        path = from_str(obj.get("path"))
        sha256 = from_str(obj.get("sha256"))
        return AssetElement(bytes, path, sha256)

    def to_dict(self) -> dict:
        result: dict = {}
        result["bytes"] = from_int(self.bytes)
        result["path"] = from_str(self.path)
        result["sha256"] = from_str(self.sha256)
        return result


class AuthorityModel(Enum):
    MODULE = "module"
    PROCESS = "process"


@dataclass
class EntryPoints:
    authority: str
    web: str | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'EntryPoints':
        assert isinstance(obj, dict)
        authority = from_str(obj.get("authority"))
        web = from_union([from_str, from_none], obj.get("web"))
        return EntryPoints(authority, web)

    def to_dict(self) -> dict:
        result: dict = {}
        result["authority"] = from_str(self.authority)
        if self.web is not None:
            result["web"] = from_union([from_str, from_none], self.web)
        return result


class LateJoin(Enum):
    DENY = "deny"
    PLAYER = "player"
    SPECTATOR = "spectator"


@dataclass
class PlatformRequirements:
    max_players: int
    min_players: int
    protocol_version: int
    allow_spectate: bool | None = None
    solo_fill: bool | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'PlatformRequirements':
        assert isinstance(obj, dict)
        max_players = from_int(obj.get("maxPlayers"))
        min_players = from_int(obj.get("minPlayers"))
        protocol_version = from_int(obj.get("protocolVersion"))
        allow_spectate = from_union([from_bool, from_none], obj.get("allowSpectate"))
        solo_fill = from_union([from_bool, from_none], obj.get("soloFill"))
        return PlatformRequirements(max_players, min_players, protocol_version, allow_spectate, solo_fill)

    def to_dict(self) -> dict:
        result: dict = {}
        result["maxPlayers"] = from_int(self.max_players)
        result["minPlayers"] = from_int(self.min_players)
        result["protocolVersion"] = from_int(self.protocol_version)
        if self.allow_spectate is not None:
            result["allowSpectate"] = from_union([from_bool, from_none], self.allow_spectate)
        if self.solo_fill is not None:
            result["soloFill"] = from_union([from_bool, from_none], self.solo_fill)
        return result


@dataclass
class Reference:
    entry: str

    @staticmethod
    def from_dict(obj: Any) -> 'Reference':
        assert isinstance(obj, dict)
        entry = from_str(obj.get("entry"))
        return Reference(entry)

    def to_dict(self) -> dict:
        result: dict = {}
        result["entry"] = from_str(self.entry)
        return result


@dataclass
class OptionElement:
    label: str
    value: str

    @staticmethod
    def from_dict(obj: Any) -> 'OptionElement':
        assert isinstance(obj, dict)
        label = from_str(obj.get("label"))
        value = from_str(obj.get("value"))
        return OptionElement(label, value)

    def to_dict(self) -> dict:
        result: dict = {}
        result["label"] = from_str(self.label)
        result["value"] = from_str(self.value)
        return result


class Role(Enum):
    AI = "ai"
    HOST = "host"
    PLAYER = "player"
    SPECTATOR = "spectator"


class TypeEnum(Enum):
    BOOLEAN = "boolean"
    ENUM = "enum"
    INTEGER = "integer"


@dataclass
class FieldElement:
    key: str
    label: str
    type: TypeEnum
    default: Any = None
    depends_on: str | None = None
    description: str | None = None
    max: int | None = None
    min: int | None = None
    options: list[OptionElement] | None = None
    roles: list[Role] | None = None
    step: int | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'FieldElement':
        assert isinstance(obj, dict)
        key = from_str(obj.get("key"))
        label = from_str(obj.get("label"))
        type = TypeEnum(obj.get("type"))
        default = obj.get("default")
        depends_on = from_union([from_str, from_none], obj.get("dependsOn"))
        description = from_union([from_str, from_none], obj.get("description"))
        max = from_union([from_int, from_none], obj.get("max"))
        min = from_union([from_int, from_none], obj.get("min"))
        options = from_union([lambda x: from_list(OptionElement.from_dict, x), from_none], obj.get("options"))
        roles = from_union([lambda x: from_list(Role, x), from_none], obj.get("roles"))
        step = from_union([from_int, from_none], obj.get("step"))
        return FieldElement(key, label, type, default, depends_on, description, max, min, options, roles, step)

    def to_dict(self) -> dict:
        result: dict = {}
        result["key"] = from_str(self.key)
        result["label"] = from_str(self.label)
        result["type"] = to_enum(TypeEnum, self.type)
        result["default"] = self.default
        if self.depends_on is not None:
            result["dependsOn"] = from_union([from_str, from_none], self.depends_on)
        if self.description is not None:
            result["description"] = from_union([from_str, from_none], self.description)
        if self.max is not None:
            result["max"] = from_union([from_int, from_none], self.max)
        if self.min is not None:
            result["min"] = from_union([from_int, from_none], self.min)
        if self.options is not None:
            result["options"] = from_union([lambda x: from_list(lambda x: to_class(OptionElement, x), x), from_none], self.options)
        if self.roles is not None:
            result["roles"] = from_union([lambda x: from_list(lambda x: to_enum(Role, x), x), from_none], self.roles)
        if self.step is not None:
            result["step"] = from_union([from_int, from_none], self.step)
        return result


@dataclass
class SessionConfig:
    fields: list[FieldElement]
    seat_options: list[FieldElement] | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'SessionConfig':
        assert isinstance(obj, dict)
        fields = from_list(FieldElement.from_dict, obj.get("fields"))
        seat_options = from_union([lambda x: from_list(FieldElement.from_dict, x), from_none], obj.get("seatOptions"))
        return SessionConfig(fields, seat_options)

    def to_dict(self) -> dict:
        result: dict = {}
        result["fields"] = from_list(lambda x: to_class(FieldElement, x), self.fields)
        if self.seat_options is not None:
            result["seatOptions"] = from_union([lambda x: from_list(lambda x: to_class(FieldElement, x), x), from_none], self.seat_options)
        return result


class Algorithm(Enum):
    ED25519 = "ed25519"


@dataclass
class Signature:
    algorithm: Algorithm
    value: str
    public_key: str | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'Signature':
        assert isinstance(obj, dict)
        algorithm = Algorithm(obj.get("algorithm"))
        value = from_str(obj.get("value"))
        public_key = from_union([from_str, from_none], obj.get("publicKey"))
        return Signature(algorithm, value, public_key)

    def to_dict(self) -> dict:
        result: dict = {}
        result["algorithm"] = to_enum(Algorithm, self.algorithm)
        result["value"] = from_str(self.value)
        if self.public_key is not None:
            result["publicKey"] = from_union([from_str, from_none], self.public_key)
        return result


@dataclass
class GamePackageManifest:
    entry_points: EntryPoints
    id: str
    name: str
    platform_requirements: PlatformRequirements
    reference: Reference
    session_config: SessionConfig
    version: str
    assets: list[AssetElement] | None = None
    authority_model: AuthorityModel | None = None
    late_join: LateJoin | None = None
    required_capabilities: list[str] | None = None
    rules_hash: str | None = None
    signature: Signature | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'GamePackageManifest':
        assert isinstance(obj, dict)
        entry_points = EntryPoints.from_dict(obj.get("entryPoints"))
        id = from_str(obj.get("id"))
        name = from_str(obj.get("name"))
        platform_requirements = PlatformRequirements.from_dict(obj.get("platformRequirements"))
        reference = Reference.from_dict(obj.get("reference"))
        session_config = SessionConfig.from_dict(obj.get("sessionConfig"))
        version = from_str(obj.get("version"))
        assets = from_union([lambda x: from_list(AssetElement.from_dict, x), from_none], obj.get("assets"))
        authority_model = from_union([AuthorityModel, from_none], obj.get("authorityModel"))
        late_join = from_union([LateJoin, from_none], obj.get("lateJoin"))
        required_capabilities = from_union([lambda x: from_list(from_str, x), from_none], obj.get("requiredCapabilities"))
        rules_hash = from_union([from_str, from_none], obj.get("rulesHash"))
        signature = from_union([Signature.from_dict, from_none], obj.get("signature"))
        return GamePackageManifest(entry_points, id, name, platform_requirements, reference, session_config, version, assets, authority_model, late_join, required_capabilities, rules_hash, signature)

    def to_dict(self) -> dict:
        result: dict = {}
        result["entryPoints"] = to_class(EntryPoints, self.entry_points)
        result["id"] = from_str(self.id)
        result["name"] = from_str(self.name)
        result["platformRequirements"] = to_class(PlatformRequirements, self.platform_requirements)
        result["reference"] = to_class(Reference, self.reference)
        result["sessionConfig"] = to_class(SessionConfig, self.session_config)
        result["version"] = from_str(self.version)
        if self.assets is not None:
            result["assets"] = from_union([lambda x: from_list(lambda x: to_class(AssetElement, x), x), from_none], self.assets)
        if self.authority_model is not None:
            result["authorityModel"] = from_union([lambda x: to_enum(AuthorityModel, x), from_none], self.authority_model)
        if self.late_join is not None:
            result["lateJoin"] = from_union([lambda x: to_enum(LateJoin, x), from_none], self.late_join)
        if self.required_capabilities is not None:
            result["requiredCapabilities"] = from_union([lambda x: from_list(from_str, x), from_none], self.required_capabilities)
        if self.rules_hash is not None:
            result["rulesHash"] = from_union([from_str, from_none], self.rules_hash)
        if self.signature is not None:
            result["signature"] = from_union([lambda x: to_class(Signature, x), from_none], self.signature)
        return result


def game_package_manifest_from_dict(s: Any) -> GamePackageManifest:
    return GamePackageManifest.from_dict(s)


def game_package_manifest_to_dict(x: GamePackageManifest) -> Any:
    return to_class(GamePackageManifest, x)
