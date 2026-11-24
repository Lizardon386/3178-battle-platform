# 由 protocol/session-authority 生成；请勿手改。
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
class Schema:
    to: str
    payload: Any = None
    view_revision: int | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'Schema':
        assert isinstance(obj, dict)
        to = from_str(obj.get("to"))
        payload = obj.get("payload")
        view_revision = from_union([from_int, from_none], obj.get("viewRevision"))
        return Schema(to, payload, view_revision)

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
    items: list[Schema]
    type: AuthorityDeliverType

    @staticmethod
    def from_dict(obj: Any) -> 'AuthorityDeliver':
        assert isinstance(obj, dict)
        authority_epoch = from_int(obj.get("authorityEpoch"))
        game_sequence = from_int(obj.get("gameSequence"))
        items = from_list(Schema.from_dict, obj.get("items"))
        type = AuthorityDeliverType(obj.get("type"))
        return AuthorityDeliver(authority_epoch, game_sequence, items, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["authorityEpoch"] = from_int(self.authority_epoch)
        result["gameSequence"] = from_int(self.game_sequence)
        result["items"] = from_list(lambda x: to_class(Schema, x), self.items)
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


class PlatformCloseSessionType(Enum):
    CLOSE_SESSION = "closeSession"


@dataclass
class PlatformCloseSession:
    authority_epoch: int
    reason: str
    type: PlatformCloseSessionType

    @staticmethod
    def from_dict(obj: Any) -> 'PlatformCloseSession':
        assert isinstance(obj, dict)
        authority_epoch = from_int(obj.get("authorityEpoch"))
        reason = from_str(obj.get("reason"))
        type = PlatformCloseSessionType(obj.get("type"))
        return PlatformCloseSession(authority_epoch, reason, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["authorityEpoch"] = from_int(self.authority_epoch)
        result["reason"] = from_str(self.reason)
        result["type"] = to_enum(PlatformCloseSessionType, self.type)
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


class Role(Enum):
    AI = "ai"
    PLAYER = "player"
    SPECTATOR = "spectator"


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


class PlatformPingType(Enum):
    PING = "ping"


@dataclass
class PlatformPing:
    nonce: str
    type: PlatformPingType

    @staticmethod
    def from_dict(obj: Any) -> 'PlatformPing':
        assert isinstance(obj, dict)
        nonce = from_str(obj.get("nonce"))
        type = PlatformPingType(obj.get("type"))
        return PlatformPing(nonce, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["nonce"] = from_str(self.nonce)
        result["type"] = to_enum(PlatformPingType, self.type)
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


class PlatformSyncType(Enum):
    SYNC = "sync"


@dataclass
class PlatformSync:
    authority_epoch: int
    member_id: str
    type: PlatformSyncType

    @staticmethod
    def from_dict(obj: Any) -> 'PlatformSync':
        assert isinstance(obj, dict)
        authority_epoch = from_int(obj.get("authorityEpoch"))
        member_id = from_str(obj.get("memberId"))
        type = PlatformSyncType(obj.get("type"))
        return PlatformSync(authority_epoch, member_id, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["authorityEpoch"] = from_int(self.authority_epoch)
        result["memberId"] = from_str(self.member_id)
        result["type"] = to_enum(PlatformSyncType, self.type)
        return result


@dataclass
class ProtocolTypes:
    authority_deliver: AuthorityDeliver | None = None
    authority_error: AuthorityError | None = None
    authority_pong: AuthorityPong | None = None
    authority_ready: AuthorityReady | None = None
    authority_round_closed: AuthorityRoundClosed | None = None
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

    @staticmethod
    def from_dict(obj: Any) -> 'ProtocolTypes':
        assert isinstance(obj, dict)
        authority_deliver = from_union([AuthorityDeliver.from_dict, from_none], obj.get("AuthorityDeliver"))
        authority_error = from_union([AuthorityError.from_dict, from_none], obj.get("AuthorityError"))
        authority_pong = from_union([AuthorityPong.from_dict, from_none], obj.get("AuthorityPong"))
        authority_ready = from_union([AuthorityReady.from_dict, from_none], obj.get("AuthorityReady"))
        authority_round_closed = from_union([AuthorityRoundClosed.from_dict, from_none], obj.get("AuthorityRoundClosed"))
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
        return ProtocolTypes(authority_deliver, authority_error, authority_pong, authority_ready, authority_round_closed, platform_close_session, platform_deliver, platform_host_changed, platform_member_join, platform_member_leave, platform_member_resume, platform_member_update, platform_ping, platform_start, platform_sync)

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
        return result


def protocol_types_from_dict(s: Any) -> ProtocolTypes:
    return ProtocolTypes.from_dict(s)


def protocol_types_to_dict(x: ProtocolTypes) -> Any:
    return to_class(ProtocolTypes, x)
