# 由 protocol/local-control 生成；请勿手改。
from enum import Enum
from dataclasses import dataclass
from typing import Any, TypeVar, Type, Callable, cast


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


def to_enum(c: Type[EnumT], x: Any) -> EnumT:
    assert isinstance(x, c)
    return x.value


def from_float(x: Any) -> float:
    assert isinstance(x, (float, int)) and not isinstance(x, bool)
    return float(x)


def to_float(x: Any) -> float:
    assert isinstance(x, (int, float))
    return x


def from_list(f: Callable[[Any], T], x: Any) -> list[T]:
    assert isinstance(x, list)
    return [f(y) for y in x]


def from_dict(f: Callable[[Any], T], x: Any) -> dict[str, T]:
    assert isinstance(x, dict)
    return { k: f(v) for (k, v) in x.items() }


def to_class(c: Type[T], x: Any) -> dict:
    assert isinstance(x, c)
    return cast(Any, x).to_dict()


class AuthorityStatusState(Enum):
    EXITED = "exited"
    FAILED = "failed"
    READY_WAIT = "readyWait"
    RUNNING = "running"
    STARTING = "starting"
    STOPPED = "stopped"
    STOPPING = "stopping"


class AuthorityStatusType(Enum):
    AUTHORITY_STATUS = "authorityStatus"


@dataclass
class AuthorityStatus:
    session_id: str
    state: AuthorityStatusState
    type: AuthorityStatusType
    epoch: int | None = None
    error: str | None = None
    pid: int | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'AuthorityStatus':
        assert isinstance(obj, dict)
        session_id = from_str(obj.get("sessionId"))
        state = AuthorityStatusState(obj.get("state"))
        type = AuthorityStatusType(obj.get("type"))
        epoch = from_union([from_int, from_none], obj.get("epoch"))
        error = from_union([from_str, from_none], obj.get("error"))
        pid = from_union([from_int, from_none], obj.get("pid"))
        return AuthorityStatus(session_id, state, type, epoch, error, pid)

    def to_dict(self) -> dict:
        result: dict = {}
        result["sessionId"] = from_str(self.session_id)
        result["state"] = to_enum(AuthorityStatusState, self.state)
        result["type"] = to_enum(AuthorityStatusType, self.type)
        if self.epoch is not None:
            result["epoch"] = from_union([from_int, from_none], self.epoch)
        if self.error is not None:
            result["error"] = from_union([from_str, from_none], self.error)
        if self.pid is not None:
            result["pid"] = from_union([from_int, from_none], self.pid)
        return result


class ClientKind(Enum):
    SERVICE = "service"
    UI = "ui"


class ClientHelloType(Enum):
    HELLO = "hello"


@dataclass
class ClientHello:
    client_kind: ClientKind
    type: ClientHelloType
    version: float

    @staticmethod
    def from_dict(obj: Any) -> 'ClientHello':
        assert isinstance(obj, dict)
        client_kind = ClientKind(obj.get("clientKind"))
        type = ClientHelloType(obj.get("type"))
        version = from_float(obj.get("version"))
        return ClientHello(client_kind, type, version)

    def to_dict(self) -> dict:
        result: dict = {}
        result["clientKind"] = to_enum(ClientKind, self.client_kind)
        result["type"] = to_enum(ClientHelloType, self.type)
        result["version"] = to_float(self.version)
        return result


class ControlErrorType(Enum):
    ERROR = "error"


@dataclass
class ControlError:
    code: str
    text: str
    type: ControlErrorType

    @staticmethod
    def from_dict(obj: Any) -> 'ControlError':
        assert isinstance(obj, dict)
        code = from_str(obj.get("code"))
        text = from_str(obj.get("text"))
        type = ControlErrorType(obj.get("type"))
        return ControlError(code, text, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["code"] = from_str(self.code)
        result["text"] = from_str(self.text)
        result["type"] = to_enum(ControlErrorType, self.type)
        return result


class DiagnoseType(Enum):
    DIAGNOSE = "diagnose"


@dataclass
class Diagnose:
    type: DiagnoseType

    @staticmethod
    def from_dict(obj: Any) -> 'Diagnose':
        assert isinstance(obj, dict)
        type = DiagnoseType(obj.get("type"))
        return Diagnose(type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["type"] = to_enum(DiagnoseType, self.type)
        return result


class PingType(Enum):
    PING = "ping"


@dataclass
class Ping:
    nonce: str
    type: PingType

    @staticmethod
    def from_dict(obj: Any) -> 'Ping':
        assert isinstance(obj, dict)
        nonce = from_str(obj.get("nonce"))
        type = PingType(obj.get("type"))
        return Ping(nonce, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["nonce"] = from_str(self.nonce)
        result["type"] = to_enum(PingType, self.type)
        return result


class PongType(Enum):
    PONG = "pong"


@dataclass
class Pong:
    nonce: str
    type: PongType

    @staticmethod
    def from_dict(obj: Any) -> 'Pong':
        assert isinstance(obj, dict)
        nonce = from_str(obj.get("nonce"))
        type = PongType(obj.get("type"))
        return Pong(nonce, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["nonce"] = from_str(self.nonce)
        result["type"] = to_enum(PongType, self.type)
        return result


class RecoverAuthorityType(Enum):
    RECOVER_AUTHORITY = "recoverAuthority"


@dataclass
class RecoverAuthority:
    epoch: int
    session_id: str
    type: RecoverAuthorityType

    @staticmethod
    def from_dict(obj: Any) -> 'RecoverAuthority':
        assert isinstance(obj, dict)
        epoch = from_int(obj.get("epoch"))
        session_id = from_str(obj.get("sessionId"))
        type = RecoverAuthorityType(obj.get("type"))
        return RecoverAuthority(epoch, session_id, type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["epoch"] = from_int(self.epoch)
        result["sessionId"] = from_str(self.session_id)
        result["type"] = to_enum(RecoverAuthorityType, self.type)
        return result


class ServiceStartType(Enum):
    SERVICE_START = "serviceStart"


@dataclass
class ServiceStart:
    type: ServiceStartType

    @staticmethod
    def from_dict(obj: Any) -> 'ServiceStart':
        assert isinstance(obj, dict)
        type = ServiceStartType(obj.get("type"))
        return ServiceStart(type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["type"] = to_enum(ServiceStartType, self.type)
        return result


class ServiceStatusState(Enum):
    EXITED = "exited"
    FAILED = "failed"
    RUNNING = "running"
    STARTING = "starting"
    STOPPED = "stopped"


class ServiceStatusType(Enum):
    SERVICE_STATUS = "serviceStatus"


@dataclass
class ServiceStatus:
    state: ServiceStatusState
    type: ServiceStatusType
    game_port: int | None = None
    lan_port: int | None = None
    pid: int | None = None
    ui_port: int | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'ServiceStatus':
        assert isinstance(obj, dict)
        state = ServiceStatusState(obj.get("state"))
        type = ServiceStatusType(obj.get("type"))
        game_port = from_union([from_int, from_none], obj.get("gamePort"))
        lan_port = from_union([from_int, from_none], obj.get("lanPort"))
        pid = from_union([from_int, from_none], obj.get("pid"))
        ui_port = from_union([from_int, from_none], obj.get("uiPort"))
        return ServiceStatus(state, type, game_port, lan_port, pid, ui_port)

    def to_dict(self) -> dict:
        result: dict = {}
        result["state"] = to_enum(ServiceStatusState, self.state)
        result["type"] = to_enum(ServiceStatusType, self.type)
        if self.game_port is not None:
            result["gamePort"] = from_union([from_int, from_none], self.game_port)
        if self.lan_port is not None:
            result["lanPort"] = from_union([from_int, from_none], self.lan_port)
        if self.pid is not None:
            result["pid"] = from_union([from_int, from_none], self.pid)
        if self.ui_port is not None:
            result["uiPort"] = from_union([from_int, from_none], self.ui_port)
        return result


class ServiceStopType(Enum):
    SERVICE_STOP = "serviceStop"


@dataclass
class ServiceStop:
    type: ServiceStopType

    @staticmethod
    def from_dict(obj: Any) -> 'ServiceStop':
        assert isinstance(obj, dict)
        type = ServiceStopType(obj.get("type"))
        return ServiceStop(type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["type"] = to_enum(ServiceStopType, self.type)
        return result


class ShutdownType(Enum):
    SHUTDOWN = "shutdown"


@dataclass
class Shutdown:
    type: ShutdownType

    @staticmethod
    def from_dict(obj: Any) -> 'Shutdown':
        assert isinstance(obj, dict)
        type = ShutdownType(obj.get("type"))
        return Shutdown(type)

    def to_dict(self) -> dict:
        result: dict = {}
        result["type"] = to_enum(ShutdownType, self.type)
        return result


class StartAuthorityType(Enum):
    START_AUTHORITY = "startAuthority"


@dataclass
class StartAuthority:
    entry: str
    epoch: int
    runtime: str
    session_id: str
    type: StartAuthorityType
    args: list[str] | None = None
    cwd: str | None = None
    env: dict[str, str] | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'StartAuthority':
        assert isinstance(obj, dict)
        entry = from_str(obj.get("entry"))
        epoch = from_int(obj.get("epoch"))
        runtime = from_str(obj.get("runtime"))
        session_id = from_str(obj.get("sessionId"))
        type = StartAuthorityType(obj.get("type"))
        args = from_union([lambda x: from_list(from_str, x), from_none], obj.get("args"))
        cwd = from_union([from_str, from_none], obj.get("cwd"))
        env = from_union([lambda x: from_dict(from_str, x), from_none], obj.get("env"))
        return StartAuthority(entry, epoch, runtime, session_id, type, args, cwd, env)

    def to_dict(self) -> dict:
        result: dict = {}
        result["entry"] = from_str(self.entry)
        result["epoch"] = from_int(self.epoch)
        result["runtime"] = from_str(self.runtime)
        result["sessionId"] = from_str(self.session_id)
        result["type"] = to_enum(StartAuthorityType, self.type)
        if self.args is not None:
            result["args"] = from_union([lambda x: from_list(from_str, x), from_none], self.args)
        if self.cwd is not None:
            result["cwd"] = from_union([from_str, from_none], self.cwd)
        if self.env is not None:
            result["env"] = from_union([lambda x: from_dict(from_str, x), from_none], self.env)
        return result


class StopAuthorityType(Enum):
    STOP_AUTHORITY = "stopAuthority"


@dataclass
class StopAuthority:
    session_id: str
    type: StopAuthorityType
    reason: str | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'StopAuthority':
        assert isinstance(obj, dict)
        session_id = from_str(obj.get("sessionId"))
        type = StopAuthorityType(obj.get("type"))
        reason = from_union([from_str, from_none], obj.get("reason"))
        return StopAuthority(session_id, type, reason)

    def to_dict(self) -> dict:
        result: dict = {}
        result["sessionId"] = from_str(self.session_id)
        result["type"] = to_enum(StopAuthorityType, self.type)
        if self.reason is not None:
            result["reason"] = from_union([from_str, from_none], self.reason)
        return result


class SupervisorWelcomeType(Enum):
    WELCOME = "welcome"


@dataclass
class SupervisorWelcome:
    server_version: str
    type: SupervisorWelcomeType
    version: float

    @staticmethod
    def from_dict(obj: Any) -> 'SupervisorWelcome':
        assert isinstance(obj, dict)
        server_version = from_str(obj.get("serverVersion"))
        type = SupervisorWelcomeType(obj.get("type"))
        version = from_float(obj.get("version"))
        return SupervisorWelcome(server_version, type, version)

    def to_dict(self) -> dict:
        result: dict = {}
        result["serverVersion"] = from_str(self.server_version)
        result["type"] = to_enum(SupervisorWelcomeType, self.type)
        result["version"] = to_float(self.version)
        return result


@dataclass
class ProtocolTypes:
    authority_status: AuthorityStatus | None = None
    client_hello: ClientHello | None = None
    control_error: ControlError | None = None
    diagnose: Diagnose | None = None
    ping: Ping | None = None
    pong: Pong | None = None
    recover_authority: RecoverAuthority | None = None
    service_start: ServiceStart | None = None
    service_status: ServiceStatus | None = None
    service_stop: ServiceStop | None = None
    shutdown: Shutdown | None = None
    start_authority: StartAuthority | None = None
    stop_authority: StopAuthority | None = None
    supervisor_welcome: SupervisorWelcome | None = None

    @staticmethod
    def from_dict(obj: Any) -> 'ProtocolTypes':
        assert isinstance(obj, dict)
        authority_status = from_union([AuthorityStatus.from_dict, from_none], obj.get("AuthorityStatus"))
        client_hello = from_union([ClientHello.from_dict, from_none], obj.get("ClientHello"))
        control_error = from_union([ControlError.from_dict, from_none], obj.get("ControlError"))
        diagnose = from_union([Diagnose.from_dict, from_none], obj.get("Diagnose"))
        ping = from_union([Ping.from_dict, from_none], obj.get("Ping"))
        pong = from_union([Pong.from_dict, from_none], obj.get("Pong"))
        recover_authority = from_union([RecoverAuthority.from_dict, from_none], obj.get("RecoverAuthority"))
        service_start = from_union([ServiceStart.from_dict, from_none], obj.get("ServiceStart"))
        service_status = from_union([ServiceStatus.from_dict, from_none], obj.get("ServiceStatus"))
        service_stop = from_union([ServiceStop.from_dict, from_none], obj.get("ServiceStop"))
        shutdown = from_union([Shutdown.from_dict, from_none], obj.get("Shutdown"))
        start_authority = from_union([StartAuthority.from_dict, from_none], obj.get("StartAuthority"))
        stop_authority = from_union([StopAuthority.from_dict, from_none], obj.get("StopAuthority"))
        supervisor_welcome = from_union([SupervisorWelcome.from_dict, from_none], obj.get("SupervisorWelcome"))
        return ProtocolTypes(authority_status, client_hello, control_error, diagnose, ping, pong, recover_authority, service_start, service_status, service_stop, shutdown, start_authority, stop_authority, supervisor_welcome)

    def to_dict(self) -> dict:
        result: dict = {}
        if self.authority_status is not None:
            result["AuthorityStatus"] = from_union([lambda x: to_class(AuthorityStatus, x), from_none], self.authority_status)
        if self.client_hello is not None:
            result["ClientHello"] = from_union([lambda x: to_class(ClientHello, x), from_none], self.client_hello)
        if self.control_error is not None:
            result["ControlError"] = from_union([lambda x: to_class(ControlError, x), from_none], self.control_error)
        if self.diagnose is not None:
            result["Diagnose"] = from_union([lambda x: to_class(Diagnose, x), from_none], self.diagnose)
        if self.ping is not None:
            result["Ping"] = from_union([lambda x: to_class(Ping, x), from_none], self.ping)
        if self.pong is not None:
            result["Pong"] = from_union([lambda x: to_class(Pong, x), from_none], self.pong)
        if self.recover_authority is not None:
            result["RecoverAuthority"] = from_union([lambda x: to_class(RecoverAuthority, x), from_none], self.recover_authority)
        if self.service_start is not None:
            result["ServiceStart"] = from_union([lambda x: to_class(ServiceStart, x), from_none], self.service_start)
        if self.service_status is not None:
            result["ServiceStatus"] = from_union([lambda x: to_class(ServiceStatus, x), from_none], self.service_status)
        if self.service_stop is not None:
            result["ServiceStop"] = from_union([lambda x: to_class(ServiceStop, x), from_none], self.service_stop)
        if self.shutdown is not None:
            result["Shutdown"] = from_union([lambda x: to_class(Shutdown, x), from_none], self.shutdown)
        if self.start_authority is not None:
            result["StartAuthority"] = from_union([lambda x: to_class(StartAuthority, x), from_none], self.start_authority)
        if self.stop_authority is not None:
            result["StopAuthority"] = from_union([lambda x: to_class(StopAuthority, x), from_none], self.stop_authority)
        if self.supervisor_welcome is not None:
            result["SupervisorWelcome"] = from_union([lambda x: to_class(SupervisorWelcome, x), from_none], self.supervisor_welcome)
        return result


def protocol_types_from_dict(s: Any) -> ProtocolTypes:
    return ProtocolTypes.from_dict(s)


def protocol_types_to_dict(x: ProtocolTypes) -> Any:
    return to_class(ProtocolTypes, x)
