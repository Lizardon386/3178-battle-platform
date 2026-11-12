# 由 protocol/v0/messages.schema.json + catalog.json 生成；请勿手改。
from dataclasses import dataclass
from typing import Any, TypeVar, Callable, Type, cast
from enum import Enum


T = TypeVar("T")
EnumT = TypeVar("EnumT", bound=Enum)


def from_str(x: Any) -> str:
    assert isinstance(x, str)
    return x


def from_int(x: Any) -> int:
    assert isinstance(x, int) and not isinstance(x, bool)
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


def from_list(f: Callable[[Any], T], x: Any) -> list[T]:
    assert isinstance(x, list)
    return [f(y) for y in x]


def to_class(c: Type[T], x: Any) -> dict:
    assert isinstance(x, c)
    return cast(Any, x).to_dict()


def to_enum(c: Type[EnumT], x: Any) -> EnumT:
    assert isinstance(x, c)
    return x.value


def from_bool(x: Any) -> bool:
    assert isinstance(x, bool)
    return x


def from_dict(f: Callable[[Any], T], x: Any) -> dict[str, T]:
    assert isinstance(x, dict)
    return { k: f(v) for (k, v) in x.items() }


@dataclass
class ItemElement:
    to: str
    payload: Any = None
    view_revision: int | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'ItemElement':
        assert isinstance(obj, dict)
        to = from_str(obj.get("to"))
        payload = obj.get("payload")
        view_revision = from_union([from_int, from_none], obj.get("viewRevision"))
        return ItemElement(to, payload, view_revision)

    def to_dict(self) -> dict:
        result: dict = {}
        result["to"] = from_str(self.to)
        result["payload"] = self.payload
        if self.view_revision is not None:
            result["viewRevision"] = from_union([from_int, from_none], self.view_revision)
        return result


class AuthorityDeliverType(Enum):
    DELIVER = "deliver"


@dataclass
class AuthorityDeliver:
    authority_epoch: int
    game_sequence: int
    items: list[ItemElement]
    type: AuthorityDeliverType

    @staticmethod
    def from_dict(obj: Any) -> 'AuthorityDeliver':
        assert isinstance(obj, dict)
        authority_epoch = from_int(obj.get("authorityEpoch"))
        game_sequence = from_int(obj.get("gameSequence"))
        items = from_list(ItemElement.from_dict, obj.get("items"))
        type = AuthorityDeliverType(obj.get("type"))
        return AuthorityDeliver(authority_epoch, game_sequence, items, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["authorityEpoch"] = from_int(self.authority_epoch)
        result["gameSequence"] = from_int(self.game_sequence)
        result["items"] = from_list(lambda x: to_class(ItemElement, x), self.items)
        result["type"] = to_enum(AuthorityDeliverType, self.type)
        return result


class AuthorityErrorType(Enum):
    AUTHORITY_ERROR = "authorityError"


@dataclass
class AuthorityError:
    authority_epoch: int
    code: str
    fatal: bool
    text: str
    type: AuthorityErrorType

    @staticmethod
    def from_dict(obj: Any) -> 'AuthorityError':
        assert isinstance(obj, dict)
        authority_epoch = from_int(obj.get("authorityEpoch"))
        code = from_str(obj.get("code"))
        fatal = from_bool(obj.get("fatal"))
        text = from_str(obj.get("text"))
        type = AuthorityErrorType(obj.get("type"))
        return AuthorityError(authority_epoch, code, fatal, text, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["authorityEpoch"] = from_int(self.authority_epoch)
        result["code"] = from_str(self.code)
        result["fatal"] = from_bool(self.fatal)
        result["text"] = from_str(self.text)
        result["type"] = to_enum(AuthorityErrorType, self.type)
        return result


class AuthorityPongType(Enum):
    PONG = "pong"


@dataclass
class AuthorityPong:
    nonce: str
    type: AuthorityPongType

    @staticmethod
    def from_dict(obj: Any) -> 'AuthorityPong':
        assert isinstance(obj, dict)
        nonce = from_str(obj.get("nonce"))
        type = AuthorityPongType(obj.get("type"))
        return AuthorityPong(nonce, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["nonce"] = from_str(self.nonce)
        result["type"] = to_enum(AuthorityPongType, self.type)
        return result


class ProcessStatus(Enum):
    RUNNING = "running"


class AuthorityReadyType(Enum):
    AUTHORITY_READY = "authorityReady"


@dataclass
class AuthorityReady:
    authority_epoch: int
    process_status: ProcessStatus
    type: AuthorityReadyType

    @staticmethod
    def from_dict(obj: Any) -> 'AuthorityReady':
        assert isinstance(obj, dict)
        authority_epoch = from_int(obj.get("authorityEpoch"))
        process_status = ProcessStatus(obj.get("processStatus"))
        type = AuthorityReadyType(obj.get("type"))
        return AuthorityReady(authority_epoch, process_status, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["authorityEpoch"] = from_int(self.authority_epoch)
        result["processStatus"] = to_enum(ProcessStatus, self.process_status)
        result["type"] = to_enum(AuthorityReadyType, self.type)
        return result


class AuthorityRoundClosedType(Enum):
    ROUND_CLOSED = "roundClosed"


@dataclass
class AuthorityRoundClosed:
    authority_epoch: int
    type: AuthorityRoundClosedType
    payload: Any = None

    @staticmethod
    def from_dict(obj: Any) -> 'AuthorityRoundClosed':
        assert isinstance(obj, dict)
        authority_epoch = from_int(obj.get("authorityEpoch"))
        type = AuthorityRoundClosedType(obj.get("type"))
        payload = obj.get("payload")
        return AuthorityRoundClosed(authority_epoch, type, payload)

    def to_dict(self) -> dict:
        result: dict = {}
        result["authorityEpoch"] = from_int(self.authority_epoch)
        result["type"] = to_enum(AuthorityRoundClosedType, self.type)
        result["payload"] = self.payload
        return result


class ClientAddAIType(Enum):
    ADD_AI = "addAi"


@dataclass
class ClientAddAI:
    type: ClientAddAIType
    request_id: str | None = None
    slot: int | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'ClientAddAI':
        assert isinstance(obj, dict)
        type = ClientAddAIType(obj.get("type"))
        request_id = from_union([from_str, from_none], obj.get("requestId"))
        slot = from_union([from_int, from_none], obj.get("slot"))
        return ClientAddAI(type, request_id, slot)

    def to_dict(self) -> dict:
        result: dict = {}
        result["type"] = to_enum(ClientAddAIType, self.type)
        if self.request_id is not None:
            result["requestId"] = from_union([from_str, from_none], self.request_id)
        if self.slot is not None:
            result["slot"] = from_union([from_int, from_none], self.slot)
        return result


class ClientChatType(Enum):
    CHAT = "chat"


@dataclass
class ClientChat:
    message_id: str
    text: str
    type: ClientChatType

    @staticmethod
    def from_dict(obj: Any) -> 'ClientChat':
        assert isinstance(obj, dict)
        message_id = from_str(obj.get("messageId"))
        text = from_str(obj.get("text"))
        type = ClientChatType(obj.get("type"))
        return ClientChat(message_id, text, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["messageId"] = from_str(self.message_id)
        result["text"] = from_str(self.text)
        result["type"] = to_enum(ClientChatType, self.type)
        return result


class ClientCloseSessionType(Enum):
    CLOSE_SESSION = "closeSession"


@dataclass
class ClientCloseSession:
    type: ClientCloseSessionType
    request_id: str | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'ClientCloseSession':
        assert isinstance(obj, dict)
        type = ClientCloseSessionType(obj.get("type"))
        request_id = from_union([from_str, from_none], obj.get("requestId"))
        return ClientCloseSession(type, request_id)

    def to_dict(self) -> dict:
        result: dict = {}
        result["type"] = to_enum(ClientCloseSessionType, self.type)
        if self.request_id is not None:
            result["requestId"] = from_union([from_str, from_none], self.request_id)
        return result


class ClientGameType(Enum):
    GAME = "game"


@dataclass
class ClientGame:
    action_id: str
    type: ClientGameType
    payload: Any = None

    @staticmethod
    def from_dict(obj: Any) -> 'ClientGame':
        assert isinstance(obj, dict)
        action_id = from_str(obj.get("actionId"))
        type = ClientGameType(obj.get("type"))
        payload = obj.get("payload")
        return ClientGame(action_id, type, payload)

    def to_dict(self) -> dict:
        result: dict = {}
        result["actionId"] = from_str(self.action_id)
        result["type"] = to_enum(ClientGameType, self.type)
        result["payload"] = self.payload
        return result


class ClientGameAuthType(Enum):
    GAME_AUTH = "gameAuth"


@dataclass
class ClientGameAuth:
    type: ClientGameAuthType
    game_ticket: str | None = None
    handoff_code: str | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'ClientGameAuth':
        assert isinstance(obj, dict)
        type = ClientGameAuthType(obj.get("type"))
        game_ticket = from_union([from_str, from_none], obj.get("gameTicket"))
        handoff_code = from_union([from_str, from_none], obj.get("handoffCode"))
        return ClientGameAuth(type, game_ticket, handoff_code)

    def to_dict(self) -> dict:
        result: dict = {}
        result["type"] = to_enum(ClientGameAuthType, self.type)
        if self.game_ticket is not None:
            result["gameTicket"] = from_union([from_str, from_none], self.game_ticket)
        if self.handoff_code is not None:
            result["handoffCode"] = from_union([from_str, from_none], self.handoff_code)
        return result


class ClientGameHandoffType(Enum):
    GAME_HANDOFF = "gameHandoff"


@dataclass
class ClientGameHandoff:
    type: ClientGameHandoffType

    @staticmethod
    def from_dict(obj: Any) -> 'ClientGameHandoff':
        assert isinstance(obj, dict)
        type = ClientGameHandoffType(obj.get("type"))
        return ClientGameHandoff(type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["type"] = to_enum(ClientGameHandoffType, self.type)
        return result


class ClientKind(Enum):
    MOBILE = "mobile"
    NATIVE = "native"
    WEB = "web"


class ClientHelloType(Enum):
    HELLO = "hello"


@dataclass
class ClientHello:
    capabilities: list[str]
    client_kind: ClientKind
    protocol_version: int
    type: ClientHelloType

    @staticmethod
    def from_dict(obj: Any) -> 'ClientHello':
        assert isinstance(obj, dict)
        capabilities = from_list(from_str, obj.get("capabilities"))
        client_kind = ClientKind(obj.get("clientKind"))
        protocol_version = from_int(obj.get("protocolVersion"))
        type = ClientHelloType(obj.get("type"))
        return ClientHello(capabilities, client_kind, protocol_version, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["capabilities"] = from_list(from_str, self.capabilities)
        result["clientKind"] = to_enum(ClientKind, self.client_kind)
        result["protocolVersion"] = from_int(self.protocol_version)
        result["type"] = to_enum(ClientHelloType, self.type)
        return result


class ClientKickType(Enum):
    KICK = "kick"


@dataclass
class ClientKick:
    target_member_id: str
    type: ClientKickType
    request_id: str | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'ClientKick':
        assert isinstance(obj, dict)
        target_member_id = from_str(obj.get("targetMemberId"))
        type = ClientKickType(obj.get("type"))
        request_id = from_union([from_str, from_none], obj.get("requestId"))
        return ClientKick(target_member_id, type, request_id)

    def to_dict(self) -> dict:
        result: dict = {}
        result["targetMemberId"] = from_str(self.target_member_id)
        result["type"] = to_enum(ClientKickType, self.type)
        if self.request_id is not None:
            result["requestId"] = from_union([from_str, from_none], self.request_id)
        return result


class ClientLeaveType(Enum):
    LEAVE = "leave"


@dataclass
class ClientLeave:
    type: ClientLeaveType
    request_id: str | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'ClientLeave':
        assert isinstance(obj, dict)
        type = ClientLeaveType(obj.get("type"))
        request_id = from_union([from_str, from_none], obj.get("requestId"))
        return ClientLeave(type, request_id)

    def to_dict(self) -> dict:
        result: dict = {}
        result["type"] = to_enum(ClientLeaveType, self.type)
        if self.request_id is not None:
            result["requestId"] = from_union([from_str, from_none], self.request_id)
        return result


class ClientListGamesType(Enum):
    LIST_GAMES = "listGames"


@dataclass
class ClientListGames:
    type: ClientListGamesType

    @staticmethod
    def from_dict(obj: Any) -> 'ClientListGames':
        assert isinstance(obj, dict)
        type = ClientListGamesType(obj.get("type"))
        return ClientListGames(type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["type"] = to_enum(ClientListGamesType, self.type)
        return result


class ClientMoveSlotType(Enum):
    MOVE_SLOT = "moveSlot"


@dataclass
class ClientMoveSlot:
    member_id: str
    slot: int
    type: ClientMoveSlotType
    request_id: str | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'ClientMoveSlot':
        assert isinstance(obj, dict)
        member_id = from_str(obj.get("memberId"))
        slot = from_int(obj.get("slot"))
        type = ClientMoveSlotType(obj.get("type"))
        request_id = from_union([from_str, from_none], obj.get("requestId"))
        return ClientMoveSlot(member_id, slot, type, request_id)

    def to_dict(self) -> dict:
        result: dict = {}
        result["memberId"] = from_str(self.member_id)
        result["slot"] = from_int(self.slot)
        result["type"] = to_enum(ClientMoveSlotType, self.type)
        if self.request_id is not None:
            result["requestId"] = from_union([from_str, from_none], self.request_id)
        return result


class ClientPingType(Enum):
    PING = "ping"


@dataclass
class ClientPing:
    nonce: str
    type: ClientPingType

    @staticmethod
    def from_dict(obj: Any) -> 'ClientPing':
        assert isinstance(obj, dict)
        nonce = from_str(obj.get("nonce"))
        type = ClientPingType(obj.get("type"))
        return ClientPing(nonce, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["nonce"] = from_str(self.nonce)
        result["type"] = to_enum(ClientPingType, self.type)
        return result


class ClientRecoverGameType(Enum):
    RECOVER_GAME = "recoverGame"


@dataclass
class ClientRecoverGame:
    type: ClientRecoverGameType
    request_id: str | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'ClientRecoverGame':
        assert isinstance(obj, dict)
        type = ClientRecoverGameType(obj.get("type"))
        request_id = from_union([from_str, from_none], obj.get("requestId"))
        return ClientRecoverGame(type, request_id)

    def to_dict(self) -> dict:
        result: dict = {}
        result["type"] = to_enum(ClientRecoverGameType, self.type)
        if self.request_id is not None:
            result["requestId"] = from_union([from_str, from_none], self.request_id)
        return result


class ClientRemoveAIType(Enum):
    REMOVE_AI = "removeAi"


@dataclass
class ClientRemoveAI:
    member_id: str
    type: ClientRemoveAIType
    request_id: str | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'ClientRemoveAI':
        assert isinstance(obj, dict)
        member_id = from_str(obj.get("memberId"))
        type = ClientRemoveAIType(obj.get("type"))
        request_id = from_union([from_str, from_none], obj.get("requestId"))
        return ClientRemoveAI(member_id, type, request_id)

    def to_dict(self) -> dict:
        result: dict = {}
        result["memberId"] = from_str(self.member_id)
        result["type"] = to_enum(ClientRemoveAIType, self.type)
        if self.request_id is not None:
            result["requestId"] = from_union([from_str, from_none], self.request_id)
        return result


@dataclass
class Profile:
    nick: str
    avatar: str | None = None
    display_color: str | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'Profile':
        assert isinstance(obj, dict)
        nick = from_str(obj.get("nick"))
        avatar = from_union([from_str, from_none], obj.get("avatar"))
        display_color = from_union([from_str, from_none], obj.get("displayColor"))
        return Profile(nick, avatar, display_color)

    def to_dict(self) -> dict:
        result: dict = {}
        result["nick"] = from_str(self.nick)
        if self.avatar is not None:
            result["avatar"] = from_union([from_str, from_none], self.avatar)
        if self.display_color is not None:
            result["displayColor"] = from_union([from_str, from_none], self.display_color)
        return result


class ClientResumeType(Enum):
    RESUME = "resume"


@dataclass
class ClientResume:
    session_id: str
    ticket: str
    type: ClientResumeType
    code: str | None = None
    profile: Profile | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'ClientResume':
        assert isinstance(obj, dict)
        session_id = from_str(obj.get("sessionId"))
        ticket = from_str(obj.get("ticket"))
        type = ClientResumeType(obj.get("type"))
        code = from_union([from_str, from_none], obj.get("code"))
        profile = from_union([Profile.from_dict, from_none], obj.get("profile"))
        return ClientResume(session_id, ticket, type, code, profile)

    def to_dict(self) -> dict:
        result: dict = {}
        result["sessionId"] = from_str(self.session_id)
        result["ticket"] = from_str(self.ticket)
        result["type"] = to_enum(ClientResumeType, self.type)
        if self.code is not None:
            result["code"] = from_union([from_str, from_none], self.code)
        if self.profile is not None:
            result["profile"] = from_union([lambda x: to_class(Profile, x), from_none], self.profile)
        return result


class ClientSessionCreateType(Enum):
    SESSION_CREATE = "sessionCreate"


@dataclass
class ClientSessionCreate:
    config: dict[str, Any]
    game_id: str
    member_slots: int
    profile: Profile
    room_name: str
    type: ClientSessionCreateType
    version: str
    password: str | None = None
    spectator_limit: int | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'ClientSessionCreate':
        assert isinstance(obj, dict)
        config = from_dict(lambda x: x, obj.get("config"))
        game_id = from_str(obj.get("gameId"))
        member_slots = from_int(obj.get("memberSlots"))
        profile = Profile.from_dict(obj.get("profile"))
        room_name = from_str(obj.get("roomName"))
        type = ClientSessionCreateType(obj.get("type"))
        version = from_str(obj.get("version"))
        password = from_union([from_str, from_none], obj.get("password"))
        spectator_limit = from_union([from_int, from_none], obj.get("spectatorLimit"))
        return ClientSessionCreate(config, game_id, member_slots, profile, room_name, type, version, password, spectator_limit)

    def to_dict(self) -> dict:
        result: dict = {}
        result["config"] = from_dict(lambda x: x, self.config)
        result["gameId"] = from_str(self.game_id)
        result["memberSlots"] = from_int(self.member_slots)
        result["profile"] = to_class(Profile, self.profile)
        result["roomName"] = from_str(self.room_name)
        result["type"] = to_enum(ClientSessionCreateType, self.type)
        result["version"] = from_str(self.version)
        if self.password is not None:
            result["password"] = from_union([from_str, from_none], self.password)
        if self.spectator_limit is not None:
            result["spectatorLimit"] = from_union([from_int, from_none], self.spectator_limit)
        return result


class Role(Enum):
    AI = "ai"
    PLAYER = "player"
    SPECTATOR = "spectator"


class ClientSessionJoinType(Enum):
    SESSION_JOIN = "sessionJoin"


@dataclass
class ClientSessionJoin:
    code: str
    credentials: dict[str, Any]
    game_id: str
    profile: Profile
    rules_hash: str
    type: ClientSessionJoinType
    version: str
    role: Role | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'ClientSessionJoin':
        assert isinstance(obj, dict)
        code = from_str(obj.get("code"))
        credentials = from_dict(lambda x: x, obj.get("credentials"))
        game_id = from_str(obj.get("gameId"))
        profile = Profile.from_dict(obj.get("profile"))
        rules_hash = from_str(obj.get("rulesHash"))
        type = ClientSessionJoinType(obj.get("type"))
        version = from_str(obj.get("version"))
        role = from_union([Role, from_none], obj.get("role"))
        return ClientSessionJoin(code, credentials, game_id, profile, rules_hash, type, version, role)

    def to_dict(self) -> dict:
        result: dict = {}
        result["code"] = from_str(self.code)
        result["credentials"] = from_dict(lambda x: x, self.credentials)
        result["gameId"] = from_str(self.game_id)
        result["profile"] = to_class(Profile, self.profile)
        result["rulesHash"] = from_str(self.rules_hash)
        result["type"] = to_enum(ClientSessionJoinType, self.type)
        result["version"] = from_str(self.version)
        if self.role is not None:
            result["role"] = from_union([lambda x: to_enum(Role, x), from_none], self.role)
        return result


class ClientSessionProbeType(Enum):
    SESSION_PROBE = "sessionProbe"


@dataclass
class ClientSessionProbe:
    code: str
    type: ClientSessionProbeType

    @staticmethod
    def from_dict(obj: Any) -> 'ClientSessionProbe':
        assert isinstance(obj, dict)
        code = from_str(obj.get("code"))
        type = ClientSessionProbeType(obj.get("type"))
        return ClientSessionProbe(code, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["code"] = from_str(self.code)
        result["type"] = to_enum(ClientSessionProbeType, self.type)
        return result


class ClientSetConfigType(Enum):
    SET_CONFIG = "setConfig"


@dataclass
class ClientSetConfig:
    config: dict[str, Any]
    type: ClientSetConfigType
    request_id: str | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'ClientSetConfig':
        assert isinstance(obj, dict)
        config = from_dict(lambda x: x, obj.get("config"))
        type = ClientSetConfigType(obj.get("type"))
        request_id = from_union([from_str, from_none], obj.get("requestId"))
        return ClientSetConfig(config, type, request_id)

    def to_dict(self) -> dict:
        result: dict = {}
        result["config"] = from_dict(lambda x: x, self.config)
        result["type"] = to_enum(ClientSetConfigType, self.type)
        if self.request_id is not None:
            result["requestId"] = from_union([from_str, from_none], self.request_id)
        return result


class ClientSetProfileType(Enum):
    SET_PROFILE = "setProfile"


@dataclass
class ClientSetProfile:
    profile: Profile
    type: ClientSetProfileType
    request_id: str | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'ClientSetProfile':
        assert isinstance(obj, dict)
        profile = Profile.from_dict(obj.get("profile"))
        type = ClientSetProfileType(obj.get("type"))
        request_id = from_union([from_str, from_none], obj.get("requestId"))
        return ClientSetProfile(profile, type, request_id)

    def to_dict(self) -> dict:
        result: dict = {}
        result["profile"] = to_class(Profile, self.profile)
        result["type"] = to_enum(ClientSetProfileType, self.type)
        if self.request_id is not None:
            result["requestId"] = from_union([from_str, from_none], self.request_id)
        return result


class ClientSetReadyType(Enum):
    SET_READY = "setReady"


@dataclass
class ClientSetReady:
    ready: bool
    type: ClientSetReadyType
    request_id: str | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'ClientSetReady':
        assert isinstance(obj, dict)
        ready = from_bool(obj.get("ready"))
        type = ClientSetReadyType(obj.get("type"))
        request_id = from_union([from_str, from_none], obj.get("requestId"))
        return ClientSetReady(ready, type, request_id)

    def to_dict(self) -> dict:
        result: dict = {}
        result["ready"] = from_bool(self.ready)
        result["type"] = to_enum(ClientSetReadyType, self.type)
        if self.request_id is not None:
            result["requestId"] = from_union([from_str, from_none], self.request_id)
        return result


class ClientSetSeatOptionsType(Enum):
    SET_SEAT_OPTIONS = "setSeatOptions"


@dataclass
class ClientSetSeatOptions:
    member_id: str
    options: dict[str, Any]
    type: ClientSetSeatOptionsType
    request_id: str | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'ClientSetSeatOptions':
        assert isinstance(obj, dict)
        member_id = from_str(obj.get("memberId"))
        options = from_dict(lambda x: x, obj.get("options"))
        type = ClientSetSeatOptionsType(obj.get("type"))
        request_id = from_union([from_str, from_none], obj.get("requestId"))
        return ClientSetSeatOptions(member_id, options, type, request_id)

    def to_dict(self) -> dict:
        result: dict = {}
        result["memberId"] = from_str(self.member_id)
        result["options"] = from_dict(lambda x: x, self.options)
        result["type"] = to_enum(ClientSetSeatOptionsType, self.type)
        if self.request_id is not None:
            result["requestId"] = from_union([from_str, from_none], self.request_id)
        return result


class ClientStartGameType(Enum):
    START_GAME = "startGame"


@dataclass
class ClientStartGame:
    type: ClientStartGameType
    request_id: str | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'ClientStartGame':
        assert isinstance(obj, dict)
        type = ClientStartGameType(obj.get("type"))
        request_id = from_union([from_str, from_none], obj.get("requestId"))
        return ClientStartGame(type, request_id)

    def to_dict(self) -> dict:
        result: dict = {}
        result["type"] = to_enum(ClientStartGameType, self.type)
        if self.request_id is not None:
            result["requestId"] = from_union([from_str, from_none], self.request_id)
        return result


class ClientSyncType(Enum):
    SYNC = "sync"


@dataclass
class ClientSync:
    type: ClientSyncType

    @staticmethod
    def from_dict(obj: Any) -> 'ClientSync':
        assert isinstance(obj, dict)
        type = ClientSyncType(obj.get("type"))
        return ClientSync(type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["type"] = to_enum(ClientSyncType, self.type)
        return result


class ClientTransferHostType(Enum):
    TRANSFER_HOST = "transferHost"


@dataclass
class ClientTransferHost:
    target_member_id: str
    type: ClientTransferHostType
    request_id: str | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'ClientTransferHost':
        assert isinstance(obj, dict)
        target_member_id = from_str(obj.get("targetMemberId"))
        type = ClientTransferHostType(obj.get("type"))
        request_id = from_union([from_str, from_none], obj.get("requestId"))
        return ClientTransferHost(target_member_id, type, request_id)

    def to_dict(self) -> dict:
        result: dict = {}
        result["targetMemberId"] = from_str(self.target_member_id)
        result["type"] = to_enum(ClientTransferHostType, self.type)
        if self.request_id is not None:
            result["requestId"] = from_union([from_str, from_none], self.request_id)
        return result


@dataclass
class PlatformCloseSession:
    authority_epoch: int
    reason: str
    type: ClientCloseSessionType

    @staticmethod
    def from_dict(obj: Any) -> 'PlatformCloseSession':
        assert isinstance(obj, dict)
        authority_epoch = from_int(obj.get("authorityEpoch"))
        reason = from_str(obj.get("reason"))
        type = ClientCloseSessionType(obj.get("type"))
        return PlatformCloseSession(authority_epoch, reason, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["authorityEpoch"] = from_int(self.authority_epoch)
        result["reason"] = from_str(self.reason)
        result["type"] = to_enum(ClientCloseSessionType, self.type)
        return result


@dataclass
class PlatformDeliver:
    action_id: str
    authority_epoch: int
    from_member_id: str
    revision: int
    type: AuthorityDeliverType
    payload: Any = None

    @staticmethod
    def from_dict(obj: Any) -> 'PlatformDeliver':
        assert isinstance(obj, dict)
        action_id = from_str(obj.get("actionId"))
        authority_epoch = from_int(obj.get("authorityEpoch"))
        from_member_id = from_str(obj.get("fromMemberId"))
        revision = from_int(obj.get("revision"))
        type = AuthorityDeliverType(obj.get("type"))
        payload = obj.get("payload")
        return PlatformDeliver(action_id, authority_epoch, from_member_id, revision, type, payload)

    def to_dict(self) -> dict:
        result: dict = {}
        result["actionId"] = from_str(self.action_id)
        result["authorityEpoch"] = from_int(self.authority_epoch)
        result["fromMemberId"] = from_str(self.from_member_id)
        result["revision"] = from_int(self.revision)
        result["type"] = to_enum(AuthorityDeliverType, self.type)
        result["payload"] = self.payload
        return result


class PlatformHostChangedType(Enum):
    HOST_CHANGED = "hostChanged"


@dataclass
class PlatformHostChanged:
    authority_epoch: int
    host_member_id: str
    revision: int
    type: PlatformHostChangedType

    @staticmethod
    def from_dict(obj: Any) -> 'PlatformHostChanged':
        assert isinstance(obj, dict)
        authority_epoch = from_int(obj.get("authorityEpoch"))
        host_member_id = from_str(obj.get("hostMemberId"))
        revision = from_int(obj.get("revision"))
        type = PlatformHostChangedType(obj.get("type"))
        return PlatformHostChanged(authority_epoch, host_member_id, revision, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["authorityEpoch"] = from_int(self.authority_epoch)
        result["hostMemberId"] = from_str(self.host_member_id)
        result["revision"] = from_int(self.revision)
        result["type"] = to_enum(PlatformHostChangedType, self.type)
        return result


class Presence(Enum):
    GRACE = "grace"
    ONLINE = "online"


@dataclass
class Member:
    game_connected: bool
    member_id: str
    options: dict[str, Any]
    presence: Presence
    profile: Profile
    ready: bool
    role: Role
    grace_until: int | None = None
    slot: int | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'Member':
        assert isinstance(obj, dict)
        game_connected = from_bool(obj.get("gameConnected"))
        member_id = from_str(obj.get("memberId"))
        options = from_dict(lambda x: x, obj.get("options"))
        presence = Presence(obj.get("presence"))
        profile = Profile.from_dict(obj.get("profile"))
        ready = from_bool(obj.get("ready"))
        role = Role(obj.get("role"))
        grace_until = from_union([from_int, from_none], obj.get("graceUntil"))
        slot = from_union([from_int, from_none], obj.get("slot"))
        return Member(game_connected, member_id, options, presence, profile, ready, role, grace_until, slot)

    def to_dict(self) -> dict:
        result: dict = {}
        result["gameConnected"] = from_bool(self.game_connected)
        result["memberId"] = from_str(self.member_id)
        result["options"] = from_dict(lambda x: x, self.options)
        result["presence"] = to_enum(Presence, self.presence)
        result["profile"] = to_class(Profile, self.profile)
        result["ready"] = from_bool(self.ready)
        result["role"] = to_enum(Role, self.role)
        if self.grace_until is not None:
            result["graceUntil"] = from_union([from_int, from_none], self.grace_until)
        if self.slot is not None:
            result["slot"] = from_union([from_int, from_none], self.slot)
        return result


class PlatformMemberJoinType(Enum):
    MEMBER_JOIN = "memberJoin"


@dataclass
class PlatformMemberJoin:
    authority_epoch: int
    member: Member
    revision: int
    type: PlatformMemberJoinType

    @staticmethod
    def from_dict(obj: Any) -> 'PlatformMemberJoin':
        assert isinstance(obj, dict)
        authority_epoch = from_int(obj.get("authorityEpoch"))
        member = Member.from_dict(obj.get("member"))
        revision = from_int(obj.get("revision"))
        type = PlatformMemberJoinType(obj.get("type"))
        return PlatformMemberJoin(authority_epoch, member, revision, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["authorityEpoch"] = from_int(self.authority_epoch)
        result["member"] = to_class(Member, self.member)
        result["revision"] = from_int(self.revision)
        result["type"] = to_enum(PlatformMemberJoinType, self.type)
        return result


class Reason(Enum):
    DISCONNECTED = "disconnected"
    EXPIRED = "expired"
    KICKED = "kicked"
    LEFT = "left"


class PlatformMemberLeaveType(Enum):
    MEMBER_LEAVE = "memberLeave"


@dataclass
class PlatformMemberLeave:
    authority_epoch: int
    member_id: str
    reason: Reason
    revision: int
    type: PlatformMemberLeaveType

    @staticmethod
    def from_dict(obj: Any) -> 'PlatformMemberLeave':
        assert isinstance(obj, dict)
        authority_epoch = from_int(obj.get("authorityEpoch"))
        member_id = from_str(obj.get("memberId"))
        reason = Reason(obj.get("reason"))
        revision = from_int(obj.get("revision"))
        type = PlatformMemberLeaveType(obj.get("type"))
        return PlatformMemberLeave(authority_epoch, member_id, reason, revision, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["authorityEpoch"] = from_int(self.authority_epoch)
        result["memberId"] = from_str(self.member_id)
        result["reason"] = to_enum(Reason, self.reason)
        result["revision"] = from_int(self.revision)
        result["type"] = to_enum(PlatformMemberLeaveType, self.type)
        return result


class PlatformMemberResumeType(Enum):
    MEMBER_RESUME = "memberResume"


@dataclass
class PlatformMemberResume:
    authority_epoch: int
    member_id: str
    profile: Profile
    revision: int
    type: PlatformMemberResumeType

    @staticmethod
    def from_dict(obj: Any) -> 'PlatformMemberResume':
        assert isinstance(obj, dict)
        authority_epoch = from_int(obj.get("authorityEpoch"))
        member_id = from_str(obj.get("memberId"))
        profile = Profile.from_dict(obj.get("profile"))
        revision = from_int(obj.get("revision"))
        type = PlatformMemberResumeType(obj.get("type"))
        return PlatformMemberResume(authority_epoch, member_id, profile, revision, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["authorityEpoch"] = from_int(self.authority_epoch)
        result["memberId"] = from_str(self.member_id)
        result["profile"] = to_class(Profile, self.profile)
        result["revision"] = from_int(self.revision)
        result["type"] = to_enum(PlatformMemberResumeType, self.type)
        return result


class PlatformMemberUpdateType(Enum):
    MEMBER_UPDATE = "memberUpdate"


@dataclass
class PlatformMemberUpdate:
    authority_epoch: int
    member_id: str
    options: dict[str, Any]
    profile: Profile
    ready: bool
    revision: int
    type: PlatformMemberUpdateType

    @staticmethod
    def from_dict(obj: Any) -> 'PlatformMemberUpdate':
        assert isinstance(obj, dict)
        authority_epoch = from_int(obj.get("authorityEpoch"))
        member_id = from_str(obj.get("memberId"))
        options = from_dict(lambda x: x, obj.get("options"))
        profile = Profile.from_dict(obj.get("profile"))
        ready = from_bool(obj.get("ready"))
        revision = from_int(obj.get("revision"))
        type = PlatformMemberUpdateType(obj.get("type"))
        return PlatformMemberUpdate(authority_epoch, member_id, options, profile, ready, revision, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["authorityEpoch"] = from_int(self.authority_epoch)
        result["memberId"] = from_str(self.member_id)
        result["options"] = from_dict(lambda x: x, self.options)
        result["profile"] = to_class(Profile, self.profile)
        result["ready"] = from_bool(self.ready)
        result["revision"] = from_int(self.revision)
        result["type"] = to_enum(PlatformMemberUpdateType, self.type)
        return result


@dataclass
class PlatformPing:
    nonce: str
    type: ClientPingType

    @staticmethod
    def from_dict(obj: Any) -> 'PlatformPing':
        assert isinstance(obj, dict)
        nonce = from_str(obj.get("nonce"))
        type = ClientPingType(obj.get("type"))
        return PlatformPing(nonce, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["nonce"] = from_str(self.nonce)
        result["type"] = to_enum(ClientPingType, self.type)
        return result


class PlatformStartType(Enum):
    START = "start"


@dataclass
class PlatformStart:
    authority_epoch: int
    game_id: str
    host_member_id: str
    members: list[Member]
    revision: int
    session_code: str
    session_config: dict[str, Any]
    session_id: str
    type: PlatformStartType
    version: str

    @staticmethod
    def from_dict(obj: Any) -> 'PlatformStart':
        assert isinstance(obj, dict)
        authority_epoch = from_int(obj.get("authorityEpoch"))
        game_id = from_str(obj.get("gameId"))
        host_member_id = from_str(obj.get("hostMemberId"))
        members = from_list(Member.from_dict, obj.get("members"))
        revision = from_int(obj.get("revision"))
        session_code = from_str(obj.get("sessionCode"))
        session_config = from_dict(lambda x: x, obj.get("sessionConfig"))
        session_id = from_str(obj.get("sessionId"))
        type = PlatformStartType(obj.get("type"))
        version = from_str(obj.get("version"))
        return PlatformStart(authority_epoch, game_id, host_member_id, members, revision, session_code, session_config, session_id, type, version)

    def to_dict(self) -> dict:
        result: dict = {}
        result["authorityEpoch"] = from_int(self.authority_epoch)
        result["gameId"] = from_str(self.game_id)
        result["hostMemberId"] = from_str(self.host_member_id)
        result["members"] = from_list(lambda x: to_class(Member, x), self.members)
        result["revision"] = from_int(self.revision)
        result["sessionCode"] = from_str(self.session_code)
        result["sessionConfig"] = from_dict(lambda x: x, self.session_config)
        result["sessionId"] = from_str(self.session_id)
        result["type"] = to_enum(PlatformStartType, self.type)
        result["version"] = from_str(self.version)
        return result


@dataclass
class PlatformSync:
    authority_epoch: int
    member_id: str
    type: ClientSyncType

    @staticmethod
    def from_dict(obj: Any) -> 'PlatformSync':
        assert isinstance(obj, dict)
        authority_epoch = from_int(obj.get("authorityEpoch"))
        member_id = from_str(obj.get("memberId"))
        type = ClientSyncType(obj.get("type"))
        return PlatformSync(authority_epoch, member_id, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["authorityEpoch"] = from_int(self.authority_epoch)
        result["memberId"] = from_str(self.member_id)
        result["type"] = to_enum(ClientSyncType, self.type)
        return result


class Kind(Enum):
    MEMBER = "member"
    SYSTEM = "system"


@dataclass
class ServerChat:
    chat_revision: int
    kind: Kind
    message_id: str
    sent_at: int
    text: str
    type: ClientChatType
    from_member_id: str | None = None
    profile: Profile | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'ServerChat':
        assert isinstance(obj, dict)
        chat_revision = from_int(obj.get("chatRevision"))
        kind = Kind(obj.get("kind"))
        message_id = from_str(obj.get("messageId"))
        sent_at = from_int(obj.get("sentAt"))
        text = from_str(obj.get("text"))
        type = ClientChatType(obj.get("type"))
        from_member_id = from_union([from_str, from_none], obj.get("fromMemberId"))
        profile = from_union([Profile.from_dict, from_none], obj.get("profile"))
        return ServerChat(chat_revision, kind, message_id, sent_at, text, type, from_member_id, profile)

    def to_dict(self) -> dict:
        result: dict = {}
        result["chatRevision"] = from_int(self.chat_revision)
        result["kind"] = to_enum(Kind, self.kind)
        result["messageId"] = from_str(self.message_id)
        result["sentAt"] = from_int(self.sent_at)
        result["text"] = from_str(self.text)
        result["type"] = to_enum(ClientChatType, self.type)
        if self.from_member_id is not None:
            result["fromMemberId"] = from_union([from_str, from_none], self.from_member_id)
        if self.profile is not None:
            result["profile"] = from_union([lambda x: to_class(Profile, x), from_none], self.profile)
        return result


class ServerChatHistoryType(Enum):
    CHAT_HISTORY = "chatHistory"


@dataclass
class ServerChatHistory:
    chat_revision: int
    messages: list[ServerChat]
    type: ServerChatHistoryType

    @staticmethod
    def from_dict(obj: Any) -> 'ServerChatHistory':
        assert isinstance(obj, dict)
        chat_revision = from_int(obj.get("chatRevision"))
        messages = from_list(ServerChat.from_dict, obj.get("messages"))
        type = ServerChatHistoryType(obj.get("type"))
        return ServerChatHistory(chat_revision, messages, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["chatRevision"] = from_int(self.chat_revision)
        result["messages"] = from_list(lambda x: to_class(ServerChat, x), self.messages)
        result["type"] = to_enum(ServerChatHistoryType, self.type)
        return result


class ServerErrorType(Enum):
    ERROR = "error"


@dataclass
class ServerError:
    code: str
    text: str
    type: ServerErrorType
    details: dict[str, Any] | None = None
    request_id: str | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'ServerError':
        assert isinstance(obj, dict)
        code = from_str(obj.get("code"))
        text = from_str(obj.get("text"))
        type = ServerErrorType(obj.get("type"))
        details = from_union([lambda x: from_dict(lambda x: x, x), from_none], obj.get("details"))
        request_id = from_union([from_str, from_none], obj.get("requestId"))
        return ServerError(code, text, type, details, request_id)

    def to_dict(self) -> dict:
        result: dict = {}
        result["code"] = from_str(self.code)
        result["text"] = from_str(self.text)
        result["type"] = to_enum(ServerErrorType, self.type)
        if self.details is not None:
            result["details"] = from_union([lambda x: from_dict(lambda x: x, x), from_none], self.details)
        if self.request_id is not None:
            result["requestId"] = from_union([from_str, from_none], self.request_id)
        return result


@dataclass
class ServerGame:
    authority_epoch: int
    game_sequence: int
    type: ClientGameType
    from_member_id: str | None = None
    payload: Any = None
    view_revision: int | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'ServerGame':
        assert isinstance(obj, dict)
        authority_epoch = from_int(obj.get("authorityEpoch"))
        game_sequence = from_int(obj.get("gameSequence"))
        type = ClientGameType(obj.get("type"))
        from_member_id = from_union([from_str, from_none], obj.get("fromMemberId"))
        payload = obj.get("payload")
        view_revision = from_union([from_int, from_none], obj.get("viewRevision"))
        return ServerGame(authority_epoch, game_sequence, type, from_member_id, payload, view_revision)

    def to_dict(self) -> dict:
        result: dict = {}
        result["authorityEpoch"] = from_int(self.authority_epoch)
        result["gameSequence"] = from_int(self.game_sequence)
        result["type"] = to_enum(ClientGameType, self.type)
        if self.from_member_id is not None:
            result["fromMemberId"] = from_union([from_str, from_none], self.from_member_id)
        result["payload"] = self.payload
        if self.view_revision is not None:
            result["viewRevision"] = from_union([from_int, from_none], self.view_revision)
        return result


class ServerGameGrantedType(Enum):
    GAME_GRANTED = "gameGranted"


@dataclass
class ServerGameGranted:
    authority_epoch: int
    game_ticket: str
    member_id: str
    session_id: str
    type: ServerGameGrantedType

    @staticmethod
    def from_dict(obj: Any) -> 'ServerGameGranted':
        assert isinstance(obj, dict)
        authority_epoch = from_int(obj.get("authorityEpoch"))
        game_ticket = from_str(obj.get("gameTicket"))
        member_id = from_str(obj.get("memberId"))
        session_id = from_str(obj.get("sessionId"))
        type = ServerGameGrantedType(obj.get("type"))
        return ServerGameGranted(authority_epoch, game_ticket, member_id, session_id, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["authorityEpoch"] = from_int(self.authority_epoch)
        result["gameTicket"] = from_str(self.game_ticket)
        result["memberId"] = from_str(self.member_id)
        result["sessionId"] = from_str(self.session_id)
        result["type"] = to_enum(ServerGameGrantedType, self.type)
        return result


@dataclass
class ServerGameHandoff:
    expires_at: int
    handoff_code: str
    type: ClientGameHandoffType
    url: str

    @staticmethod
    def from_dict(obj: Any) -> 'ServerGameHandoff':
        assert isinstance(obj, dict)
        expires_at = from_int(obj.get("expiresAt"))
        handoff_code = from_str(obj.get("handoffCode"))
        type = ClientGameHandoffType(obj.get("type"))
        url = from_str(obj.get("url"))
        return ServerGameHandoff(expires_at, handoff_code, type, url)

    def to_dict(self) -> dict:
        result: dict = {}
        result["expiresAt"] = from_int(self.expires_at)
        result["handoffCode"] = from_str(self.handoff_code)
        result["type"] = to_enum(ClientGameHandoffType, self.type)
        result["url"] = from_str(self.url)
        return result


@dataclass
class GameElement:
    id: str
    manifest: dict[str, Any]
    name: str
    version: str

    @staticmethod
    def from_dict(obj: Any) -> 'GameElement':
        assert isinstance(obj, dict)
        id = from_str(obj.get("id"))
        manifest = from_dict(lambda x: x, obj.get("manifest"))
        name = from_str(obj.get("name"))
        version = from_str(obj.get("version"))
        return GameElement(id, manifest, name, version)

    def to_dict(self) -> dict:
        result: dict = {}
        result["id"] = from_str(self.id)
        result["manifest"] = from_dict(lambda x: x, self.manifest)
        result["name"] = from_str(self.name)
        result["version"] = from_str(self.version)
        return result


class ServerGameListType(Enum):
    GAME_LIST = "gameList"


@dataclass
class ServerGameList:
    games: list[GameElement]
    type: ServerGameListType

    @staticmethod
    def from_dict(obj: Any) -> 'ServerGameList':
        assert isinstance(obj, dict)
        games = from_list(GameElement.from_dict, obj.get("games"))
        type = ServerGameListType(obj.get("type"))
        return ServerGameList(games, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["games"] = from_list(lambda x: to_class(GameElement, x), self.games)
        result["type"] = to_enum(ServerGameListType, self.type)
        return result


class ServerNoticeType(Enum):
    NOTICE = "notice"


@dataclass
class ServerNotice:
    code: str
    text: str
    type: ServerNoticeType

    @staticmethod
    def from_dict(obj: Any) -> 'ServerNotice':
        assert isinstance(obj, dict)
        code = from_str(obj.get("code"))
        text = from_str(obj.get("text"))
        type = ServerNoticeType(obj.get("type"))
        return ServerNotice(code, text, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["code"] = from_str(self.code)
        result["text"] = from_str(self.text)
        result["type"] = to_enum(ServerNoticeType, self.type)
        return result


@dataclass
class ServerPong:
    nonce: str
    type: AuthorityPongType

    @staticmethod
    def from_dict(obj: Any) -> 'ServerPong':
        assert isinstance(obj, dict)
        nonce = from_str(obj.get("nonce"))
        type = AuthorityPongType(obj.get("type"))
        return ServerPong(nonce, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["nonce"] = from_str(self.nonce)
        result["type"] = to_enum(AuthorityPongType, self.type)
        return result


class ServerSeatGrantedType(Enum):
    SEAT_GRANTED = "seatGranted"


@dataclass
class ServerSeatGranted:
    member_id: str
    profile: Profile
    session_code: str
    session_id: str
    ticket: str
    type: ServerSeatGrantedType

    @staticmethod
    def from_dict(obj: Any) -> 'ServerSeatGranted':
        assert isinstance(obj, dict)
        member_id = from_str(obj.get("memberId"))
        profile = Profile.from_dict(obj.get("profile"))
        session_code = from_str(obj.get("sessionCode"))
        session_id = from_str(obj.get("sessionId"))
        ticket = from_str(obj.get("ticket"))
        type = ServerSeatGrantedType(obj.get("type"))
        return ServerSeatGranted(member_id, profile, session_code, session_id, ticket, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["memberId"] = from_str(self.member_id)
        result["profile"] = to_class(Profile, self.profile)
        result["sessionCode"] = from_str(self.session_code)
        result["sessionId"] = from_str(self.session_id)
        result["ticket"] = from_str(self.ticket)
        result["type"] = to_enum(ServerSeatGrantedType, self.type)
        return result


class LateJoin(Enum):
    DENY = "deny"
    PLAYER = "player"
    SPECTATOR = "spectator"


class ServerSessionPreviewType(Enum):
    SESSION_PREVIEW = "sessionPreview"


@dataclass
class ServerSessionPreview:
    code: str
    config: dict[str, Any]
    game_id: str
    late_join: LateJoin
    manifest: dict[str, Any]
    manifest_hash: str
    member_slots: int
    name: str
    required_capabilities: list[str]
    rules_hash: str
    spectator_limit: int
    type: ServerSessionPreviewType
    version: str

    @staticmethod
    def from_dict(obj: Any) -> 'ServerSessionPreview':
        assert isinstance(obj, dict)
        code = from_str(obj.get("code"))
        config = from_dict(lambda x: x, obj.get("config"))
        game_id = from_str(obj.get("gameId"))
        late_join = LateJoin(obj.get("lateJoin"))
        manifest = from_dict(lambda x: x, obj.get("manifest"))
        manifest_hash = from_str(obj.get("manifestHash"))
        member_slots = from_int(obj.get("memberSlots"))
        name = from_str(obj.get("name"))
        required_capabilities = from_list(from_str, obj.get("requiredCapabilities"))
        rules_hash = from_str(obj.get("rulesHash"))
        spectator_limit = from_int(obj.get("spectatorLimit"))
        type = ServerSessionPreviewType(obj.get("type"))
        version = from_str(obj.get("version"))
        return ServerSessionPreview(code, config, game_id, late_join, manifest, manifest_hash, member_slots, name, required_capabilities, rules_hash, spectator_limit, type, version)

    def to_dict(self) -> dict:
        result: dict = {}
        result["code"] = from_str(self.code)
        result["config"] = from_dict(lambda x: x, self.config)
        result["gameId"] = from_str(self.game_id)
        result["lateJoin"] = to_enum(LateJoin, self.late_join)
        result["manifest"] = from_dict(lambda x: x, self.manifest)
        result["manifestHash"] = from_str(self.manifest_hash)
        result["memberSlots"] = from_int(self.member_slots)
        result["name"] = from_str(self.name)
        result["requiredCapabilities"] = from_list(from_str, self.required_capabilities)
        result["rulesHash"] = from_str(self.rules_hash)
        result["spectatorLimit"] = from_int(self.spectator_limit)
        result["type"] = to_enum(ServerSessionPreviewType, self.type)
        result["version"] = from_str(self.version)
        return result


class GameProcess(Enum):
    EXITED = "exited"
    FAILED = "failed"
    RUNNING = "running"
    STARTING = "starting"
    STOPPED = "stopped"


class State(Enum):
    CLOSED = "closed"
    CLOSING = "closing"
    OPEN = "open"


class ServerSessionStateType(Enum):
    SESSION_STATE = "sessionState"


@dataclass
class ServerSessionState:
    authority_epoch: int
    code: str
    config: dict[str, Any]
    game_id: str
    game_process: GameProcess
    host_member_id: str
    members: list[Member]
    member_slots: int
    name: str
    revision: int
    rules_hash: str
    session_id: str
    spectator_limit: int
    state: State
    type: ServerSessionStateType
    version: str

    @staticmethod
    def from_dict(obj: Any) -> 'ServerSessionState':
        assert isinstance(obj, dict)
        authority_epoch = from_int(obj.get("authorityEpoch"))
        code = from_str(obj.get("code"))
        config = from_dict(lambda x: x, obj.get("config"))
        game_id = from_str(obj.get("gameId"))
        game_process = GameProcess(obj.get("gameProcess"))
        host_member_id = from_str(obj.get("hostMemberId"))
        members = from_list(Member.from_dict, obj.get("members"))
        member_slots = from_int(obj.get("memberSlots"))
        name = from_str(obj.get("name"))
        revision = from_int(obj.get("revision"))
        rules_hash = from_str(obj.get("rulesHash"))
        session_id = from_str(obj.get("sessionId"))
        spectator_limit = from_int(obj.get("spectatorLimit"))
        state = State(obj.get("state"))
        type = ServerSessionStateType(obj.get("type"))
        version = from_str(obj.get("version"))
        return ServerSessionState(authority_epoch, code, config, game_id, game_process, host_member_id, members, member_slots, name, revision, rules_hash, session_id, spectator_limit, state, type, version)

    def to_dict(self) -> dict:
        result: dict = {}
        result["authorityEpoch"] = from_int(self.authority_epoch)
        result["code"] = from_str(self.code)
        result["config"] = from_dict(lambda x: x, self.config)
        result["gameId"] = from_str(self.game_id)
        result["gameProcess"] = to_enum(GameProcess, self.game_process)
        result["hostMemberId"] = from_str(self.host_member_id)
        result["members"] = from_list(lambda x: to_class(Member, x), self.members)
        result["memberSlots"] = from_int(self.member_slots)
        result["name"] = from_str(self.name)
        result["revision"] = from_int(self.revision)
        result["rulesHash"] = from_str(self.rules_hash)
        result["sessionId"] = from_str(self.session_id)
        result["spectatorLimit"] = from_int(self.spectator_limit)
        result["state"] = to_enum(State, self.state)
        result["type"] = to_enum(ServerSessionStateType, self.type)
        result["version"] = from_str(self.version)
        return result


class ServerWelcomeType(Enum):
    WELCOME = "welcome"


@dataclass
class ServerWelcome:
    protocol_version: int
    server_version: str
    supported: list[str]
    type: ServerWelcomeType

    @staticmethod
    def from_dict(obj: Any) -> 'ServerWelcome':
        assert isinstance(obj, dict)
        protocol_version = from_int(obj.get("protocolVersion"))
        server_version = from_str(obj.get("serverVersion"))
        supported = from_list(from_str, obj.get("supported"))
        type = ServerWelcomeType(obj.get("type"))
        return ServerWelcome(protocol_version, server_version, supported, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["protocolVersion"] = from_int(self.protocol_version)
        result["serverVersion"] = from_str(self.server_version)
        result["supported"] = from_list(from_str, self.supported)
        result["type"] = to_enum(ServerWelcomeType, self.type)
        return result


@dataclass
class ProtocolTypes:
    authority_deliver: AuthorityDeliver | None = None
    authority_error: AuthorityError | None = None
    authority_pong: AuthorityPong | None = None
    authority_ready: AuthorityReady | None = None
    authority_round_closed: AuthorityRoundClosed | None = None
    client_add_ai: ClientAddAI | None = None
    client_chat: ClientChat | None = None
    client_close_session: ClientCloseSession | None = None
    client_game: ClientGame | None = None
    client_game_auth: ClientGameAuth | None = None
    client_game_handoff: ClientGameHandoff | None = None
    client_hello: ClientHello | None = None
    client_kick: ClientKick | None = None
    client_leave: ClientLeave | None = None
    client_list_games: ClientListGames | None = None
    client_move_slot: ClientMoveSlot | None = None
    client_ping: ClientPing | None = None
    client_recover_game: ClientRecoverGame | None = None
    client_remove_ai: ClientRemoveAI | None = None
    client_resume: ClientResume | None = None
    client_session_create: ClientSessionCreate | None = None
    client_session_join: ClientSessionJoin | None = None
    client_session_probe: ClientSessionProbe | None = None
    client_set_config: ClientSetConfig | None = None
    client_set_profile: ClientSetProfile | None = None
    client_set_ready: ClientSetReady | None = None
    client_set_seat_options: ClientSetSeatOptions | None = None
    client_start_game: ClientStartGame | None = None
    client_sync: ClientSync | None = None
    client_transfer_host: ClientTransferHost | None = None
    platform_close_session: PlatformCloseSession | None = None
    platform_deliver: PlatformDeliver | None = None
    platform_host_changed: PlatformHostChanged | None = None
    platform_member_join: PlatformMemberJoin | None = None
    platform_member_leave: PlatformMemberLeave | None = None
    platform_member_resume: PlatformMemberResume | None = None
    platform_member_update: PlatformMemberUpdate | None = None
    platform_ping: PlatformPing | None = None
    platform_start: PlatformStart | None = None
    platform_sync: PlatformSync | None = None
    server_chat: ServerChat | None = None
    server_chat_history: ServerChatHistory | None = None
    server_error: ServerError | None = None
    server_game: ServerGame | None = None
    server_game_granted: ServerGameGranted | None = None
    server_game_handoff: ServerGameHandoff | None = None
    server_game_list: ServerGameList | None = None
    server_notice: ServerNotice | None = None
    server_pong: ServerPong | None = None
    server_seat_granted: ServerSeatGranted | None = None
    server_session_preview: ServerSessionPreview | None = None
    server_session_state: ServerSessionState | None = None
    server_welcome: ServerWelcome | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'ProtocolTypes':
        assert isinstance(obj, dict)
        authority_deliver = from_union([AuthorityDeliver.from_dict, from_none], obj.get("AuthorityDeliver"))
        authority_error = from_union([AuthorityError.from_dict, from_none], obj.get("AuthorityError"))
        authority_pong = from_union([AuthorityPong.from_dict, from_none], obj.get("AuthorityPong"))
        authority_ready = from_union([AuthorityReady.from_dict, from_none], obj.get("AuthorityReady"))
        authority_round_closed = from_union([AuthorityRoundClosed.from_dict, from_none], obj.get("AuthorityRoundClosed"))
        client_add_ai = from_union([ClientAddAI.from_dict, from_none], obj.get("ClientAddAI"))
        client_chat = from_union([ClientChat.from_dict, from_none], obj.get("ClientChat"))
        client_close_session = from_union([ClientCloseSession.from_dict, from_none], obj.get("ClientCloseSession"))
        client_game = from_union([ClientGame.from_dict, from_none], obj.get("ClientGame"))
        client_game_auth = from_union([ClientGameAuth.from_dict, from_none], obj.get("ClientGameAuth"))
        client_game_handoff = from_union([ClientGameHandoff.from_dict, from_none], obj.get("ClientGameHandoff"))
        client_hello = from_union([ClientHello.from_dict, from_none], obj.get("ClientHello"))
        client_kick = from_union([ClientKick.from_dict, from_none], obj.get("ClientKick"))
        client_leave = from_union([ClientLeave.from_dict, from_none], obj.get("ClientLeave"))
        client_list_games = from_union([ClientListGames.from_dict, from_none], obj.get("ClientListGames"))
        client_move_slot = from_union([ClientMoveSlot.from_dict, from_none], obj.get("ClientMoveSlot"))
        client_ping = from_union([ClientPing.from_dict, from_none], obj.get("ClientPing"))
        client_recover_game = from_union([ClientRecoverGame.from_dict, from_none], obj.get("ClientRecoverGame"))
        client_remove_ai = from_union([ClientRemoveAI.from_dict, from_none], obj.get("ClientRemoveAI"))
        client_resume = from_union([ClientResume.from_dict, from_none], obj.get("ClientResume"))
        client_session_create = from_union([ClientSessionCreate.from_dict, from_none], obj.get("ClientSessionCreate"))
        client_session_join = from_union([ClientSessionJoin.from_dict, from_none], obj.get("ClientSessionJoin"))
        client_session_probe = from_union([ClientSessionProbe.from_dict, from_none], obj.get("ClientSessionProbe"))
        client_set_config = from_union([ClientSetConfig.from_dict, from_none], obj.get("ClientSetConfig"))
        client_set_profile = from_union([ClientSetProfile.from_dict, from_none], obj.get("ClientSetProfile"))
        client_set_ready = from_union([ClientSetReady.from_dict, from_none], obj.get("ClientSetReady"))
        client_set_seat_options = from_union([ClientSetSeatOptions.from_dict, from_none], obj.get("ClientSetSeatOptions"))
        client_start_game = from_union([ClientStartGame.from_dict, from_none], obj.get("ClientStartGame"))
        client_sync = from_union([ClientSync.from_dict, from_none], obj.get("ClientSync"))
        client_transfer_host = from_union([ClientTransferHost.from_dict, from_none], obj.get("ClientTransferHost"))
        platform_close_session = from_union([PlatformCloseSession.from_dict, from_none], obj.get("PlatformCloseSession"))
        platform_deliver = from_union([PlatformDeliver.from_dict, from_none], obj.get("PlatformDeliver"))
        platform_host_changed = from_union([PlatformHostChanged.from_dict, from_none], obj.get("PlatformHostChanged"))
        platform_member_join = from_union([PlatformMemberJoin.from_dict, from_none], obj.get("PlatformMemberJoin"))
        platform_member_leave = from_union([PlatformMemberLeave.from_dict, from_none], obj.get("PlatformMemberLeave"))
        platform_member_resume = from_union([PlatformMemberResume.from_dict, from_none], obj.get("PlatformMemberResume"))
        platform_member_update = from_union([PlatformMemberUpdate.from_dict, from_none], obj.get("PlatformMemberUpdate"))
        platform_ping = from_union([PlatformPing.from_dict, from_none], obj.get("PlatformPing"))
        platform_start = from_union([PlatformStart.from_dict, from_none], obj.get("PlatformStart"))
        platform_sync = from_union([PlatformSync.from_dict, from_none], obj.get("PlatformSync"))
        server_chat = from_union([ServerChat.from_dict, from_none], obj.get("ServerChat"))
        server_chat_history = from_union([ServerChatHistory.from_dict, from_none], obj.get("ServerChatHistory"))
        server_error = from_union([ServerError.from_dict, from_none], obj.get("ServerError"))
        server_game = from_union([ServerGame.from_dict, from_none], obj.get("ServerGame"))
        server_game_granted = from_union([ServerGameGranted.from_dict, from_none], obj.get("ServerGameGranted"))
        server_game_handoff = from_union([ServerGameHandoff.from_dict, from_none], obj.get("ServerGameHandoff"))
        server_game_list = from_union([ServerGameList.from_dict, from_none], obj.get("ServerGameList"))
        server_notice = from_union([ServerNotice.from_dict, from_none], obj.get("ServerNotice"))
        server_pong = from_union([ServerPong.from_dict, from_none], obj.get("ServerPong"))
        server_seat_granted = from_union([ServerSeatGranted.from_dict, from_none], obj.get("ServerSeatGranted"))
        server_session_preview = from_union([ServerSessionPreview.from_dict, from_none], obj.get("ServerSessionPreview"))
        server_session_state = from_union([ServerSessionState.from_dict, from_none], obj.get("ServerSessionState"))
        server_welcome = from_union([ServerWelcome.from_dict, from_none], obj.get("ServerWelcome"))
        return ProtocolTypes(authority_deliver, authority_error, authority_pong, authority_ready, authority_round_closed, client_add_ai, client_chat, client_close_session, client_game, client_game_auth, client_game_handoff, client_hello, client_kick, client_leave, client_list_games, client_move_slot, client_ping, client_recover_game, client_remove_ai, client_resume, client_session_create, client_session_join, client_session_probe, client_set_config, client_set_profile, client_set_ready, client_set_seat_options, client_start_game, client_sync, client_transfer_host, platform_close_session, platform_deliver, platform_host_changed, platform_member_join, platform_member_leave, platform_member_resume, platform_member_update, platform_ping, platform_start, platform_sync, server_chat, server_chat_history, server_error, server_game, server_game_granted, server_game_handoff, server_game_list, server_notice, server_pong, server_seat_granted, server_session_preview, server_session_state, server_welcome)

    def to_dict(self) -> dict:
        result: dict = {}
        if self.authority_deliver is not None:
            result["AuthorityDeliver"] = from_union([lambda x: to_class(AuthorityDeliver, x), from_none], self.authority_deliver)
        if self.authority_error is not None:
            result["AuthorityError"] = from_union([lambda x: to_class(AuthorityError, x), from_none], self.authority_error)
        if self.authority_pong is not None:
            result["AuthorityPong"] = from_union([lambda x: to_class(AuthorityPong, x), from_none], self.authority_pong)
        if self.authority_ready is not None:
            result["AuthorityReady"] = from_union([lambda x: to_class(AuthorityReady, x), from_none], self.authority_ready)
        if self.authority_round_closed is not None:
            result["AuthorityRoundClosed"] = from_union([lambda x: to_class(AuthorityRoundClosed, x), from_none], self.authority_round_closed)
        if self.client_add_ai is not None:
            result["ClientAddAI"] = from_union([lambda x: to_class(ClientAddAI, x), from_none], self.client_add_ai)
        if self.client_chat is not None:
            result["ClientChat"] = from_union([lambda x: to_class(ClientChat, x), from_none], self.client_chat)
        if self.client_close_session is not None:
            result["ClientCloseSession"] = from_union([lambda x: to_class(ClientCloseSession, x), from_none], self.client_close_session)
        if self.client_game is not None:
            result["ClientGame"] = from_union([lambda x: to_class(ClientGame, x), from_none], self.client_game)
        if self.client_game_auth is not None:
            result["ClientGameAuth"] = from_union([lambda x: to_class(ClientGameAuth, x), from_none], self.client_game_auth)
        if self.client_game_handoff is not None:
            result["ClientGameHandoff"] = from_union([lambda x: to_class(ClientGameHandoff, x), from_none], self.client_game_handoff)
        if self.client_hello is not None:
            result["ClientHello"] = from_union([lambda x: to_class(ClientHello, x), from_none], self.client_hello)
        if self.client_kick is not None:
            result["ClientKick"] = from_union([lambda x: to_class(ClientKick, x), from_none], self.client_kick)
        if self.client_leave is not None:
            result["ClientLeave"] = from_union([lambda x: to_class(ClientLeave, x), from_none], self.client_leave)
        if self.client_list_games is not None:
            result["ClientListGames"] = from_union([lambda x: to_class(ClientListGames, x), from_none], self.client_list_games)
        if self.client_move_slot is not None:
            result["ClientMoveSlot"] = from_union([lambda x: to_class(ClientMoveSlot, x), from_none], self.client_move_slot)
        if self.client_ping is not None:
            result["ClientPing"] = from_union([lambda x: to_class(ClientPing, x), from_none], self.client_ping)
        if self.client_recover_game is not None:
            result["ClientRecoverGame"] = from_union([lambda x: to_class(ClientRecoverGame, x), from_none], self.client_recover_game)
        if self.client_remove_ai is not None:
            result["ClientRemoveAI"] = from_union([lambda x: to_class(ClientRemoveAI, x), from_none], self.client_remove_ai)
        if self.client_resume is not None:
            result["ClientResume"] = from_union([lambda x: to_class(ClientResume, x), from_none], self.client_resume)
        if self.client_session_create is not None:
            result["ClientSessionCreate"] = from_union([lambda x: to_class(ClientSessionCreate, x), from_none], self.client_session_create)
        if self.client_session_join is not None:
            result["ClientSessionJoin"] = from_union([lambda x: to_class(ClientSessionJoin, x), from_none], self.client_session_join)
        if self.client_session_probe is not None:
            result["ClientSessionProbe"] = from_union([lambda x: to_class(ClientSessionProbe, x), from_none], self.client_session_probe)
        if self.client_set_config is not None:
            result["ClientSetConfig"] = from_union([lambda x: to_class(ClientSetConfig, x), from_none], self.client_set_config)
        if self.client_set_profile is not None:
            result["ClientSetProfile"] = from_union([lambda x: to_class(ClientSetProfile, x), from_none], self.client_set_profile)
        if self.client_set_ready is not None:
            result["ClientSetReady"] = from_union([lambda x: to_class(ClientSetReady, x), from_none], self.client_set_ready)
        if self.client_set_seat_options is not None:
            result["ClientSetSeatOptions"] = from_union([lambda x: to_class(ClientSetSeatOptions, x), from_none], self.client_set_seat_options)
        if self.client_start_game is not None:
            result["ClientStartGame"] = from_union([lambda x: to_class(ClientStartGame, x), from_none], self.client_start_game)
        if self.client_sync is not None:
            result["ClientSync"] = from_union([lambda x: to_class(ClientSync, x), from_none], self.client_sync)
        if self.client_transfer_host is not None:
            result["ClientTransferHost"] = from_union([lambda x: to_class(ClientTransferHost, x), from_none], self.client_transfer_host)
        if self.platform_close_session is not None:
            result["PlatformCloseSession"] = from_union([lambda x: to_class(PlatformCloseSession, x), from_none], self.platform_close_session)
        if self.platform_deliver is not None:
            result["PlatformDeliver"] = from_union([lambda x: to_class(PlatformDeliver, x), from_none], self.platform_deliver)
        if self.platform_host_changed is not None:
            result["PlatformHostChanged"] = from_union([lambda x: to_class(PlatformHostChanged, x), from_none], self.platform_host_changed)
        if self.platform_member_join is not None:
            result["PlatformMemberJoin"] = from_union([lambda x: to_class(PlatformMemberJoin, x), from_none], self.platform_member_join)
        if self.platform_member_leave is not None:
            result["PlatformMemberLeave"] = from_union([lambda x: to_class(PlatformMemberLeave, x), from_none], self.platform_member_leave)
        if self.platform_member_resume is not None:
            result["PlatformMemberResume"] = from_union([lambda x: to_class(PlatformMemberResume, x), from_none], self.platform_member_resume)
        if self.platform_member_update is not None:
            result["PlatformMemberUpdate"] = from_union([lambda x: to_class(PlatformMemberUpdate, x), from_none], self.platform_member_update)
        if self.platform_ping is not None:
            result["PlatformPing"] = from_union([lambda x: to_class(PlatformPing, x), from_none], self.platform_ping)
        if self.platform_start is not None:
            result["PlatformStart"] = from_union([lambda x: to_class(PlatformStart, x), from_none], self.platform_start)
        if self.platform_sync is not None:
            result["PlatformSync"] = from_union([lambda x: to_class(PlatformSync, x), from_none], self.platform_sync)
        if self.server_chat is not None:
            result["ServerChat"] = from_union([lambda x: to_class(ServerChat, x), from_none], self.server_chat)
        if self.server_chat_history is not None:
            result["ServerChatHistory"] = from_union([lambda x: to_class(ServerChatHistory, x), from_none], self.server_chat_history)
        if self.server_error is not None:
            result["ServerError"] = from_union([lambda x: to_class(ServerError, x), from_none], self.server_error)
        if self.server_game is not None:
            result["ServerGame"] = from_union([lambda x: to_class(ServerGame, x), from_none], self.server_game)
        if self.server_game_granted is not None:
            result["ServerGameGranted"] = from_union([lambda x: to_class(ServerGameGranted, x), from_none], self.server_game_granted)
        if self.server_game_handoff is not None:
            result["ServerGameHandoff"] = from_union([lambda x: to_class(ServerGameHandoff, x), from_none], self.server_game_handoff)
        if self.server_game_list is not None:
            result["ServerGameList"] = from_union([lambda x: to_class(ServerGameList, x), from_none], self.server_game_list)
        if self.server_notice is not None:
            result["ServerNotice"] = from_union([lambda x: to_class(ServerNotice, x), from_none], self.server_notice)
        if self.server_pong is not None:
            result["ServerPong"] = from_union([lambda x: to_class(ServerPong, x), from_none], self.server_pong)
        if self.server_seat_granted is not None:
            result["ServerSeatGranted"] = from_union([lambda x: to_class(ServerSeatGranted, x), from_none], self.server_seat_granted)
        if self.server_session_preview is not None:
            result["ServerSessionPreview"] = from_union([lambda x: to_class(ServerSessionPreview, x), from_none], self.server_session_preview)
        if self.server_session_state is not None:
            result["ServerSessionState"] = from_union([lambda x: to_class(ServerSessionState, x), from_none], self.server_session_state)
        if self.server_welcome is not None:
            result["ServerWelcome"] = from_union([lambda x: to_class(ServerWelcome, x), from_none], self.server_welcome)
        return result


def protocol_types_from_dict(s: Any) -> ProtocolTypes:
    return ProtocolTypes.from_dict(s)


def protocol_types_to_dict(x: ProtocolTypes) -> Any:
    return to_class(ProtocolTypes, x)

ClientToPlatformMessage = ClientHello | ClientSessionCreate | ClientSessionJoin | ClientSessionProbe | ClientResume | ClientSetReady | ClientStartGame | ClientRecoverGame | ClientSetConfig | ClientSetSeatOptions | ClientAddAI | ClientRemoveAI | ClientMoveSlot | ClientSetProfile | ClientLeave | ClientTransferHost | ClientKick | ClientCloseSession | ClientListGames | ClientGame | ClientSync | ClientChat | ClientGameHandoff | ClientGameAuth | ClientPing

PlatformToClientMessage = ServerWelcome | ServerSeatGranted | ServerSessionState | ServerSessionPreview | ServerGame | ServerChat | ServerChatHistory | ServerGameList | ServerGameHandoff | ServerGameGranted | ServerNotice | ServerError | ServerPong

PlatformToAuthorityMessage = PlatformStart | PlatformMemberJoin | PlatformMemberLeave | PlatformMemberResume | PlatformMemberUpdate | PlatformHostChanged | PlatformDeliver | PlatformSync | PlatformCloseSession | PlatformPing

AuthorityToPlatformMessage = AuthorityReady | AuthorityDeliver | AuthorityRoundClosed | AuthorityError | AuthorityPong

ProtocolMessage = ClientToPlatformMessage | PlatformToClientMessage | PlatformToAuthorityMessage | AuthorityToPlatformMessage;
