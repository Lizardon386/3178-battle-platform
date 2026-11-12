#!/usr/bin/env python3
"""协议 v0 canonical JSON 的 Python 参考实现。

规则与 TS 实现一致：对象键按 UTF-8 字节序、只接受安全整数、拒绝孤立代理项。
stdin 读 JSON，stdout 写 canonical JSON；--hash 输出 SHA-256（小写 hex）。
"""

import hashlib
import json
import sys

MAX_SAFE_INTEGER = 2**53 - 1


class CanonicalError(ValueError):
    pass


def _string(value):
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise CanonicalError("string contains a lone surrogate") from exc
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _number(value):
    if isinstance(value, bool):
        raise CanonicalError("boolean is not a number")
    if isinstance(value, int):
        if abs(value) > MAX_SAFE_INTEGER:
            raise CanonicalError("number must be a safe integer")
        return str(value)
    if isinstance(value, float):
        if not value.is_integer():
            raise CanonicalError("number must be a safe integer")
        integer = int(value)
        if abs(integer) > MAX_SAFE_INTEGER:
            raise CanonicalError("number must be a safe integer")
        return str(integer)
    raise CanonicalError("unsupported number")


def _serialize(value):
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return _string(value)
    if isinstance(value, (int, float)):
        return _number(value)
    if isinstance(value, list):
        return "[" + ",".join(_serialize(item) for item in value) + "]"
    if isinstance(value, dict):
        for key in value:
            if not isinstance(key, str):
                raise CanonicalError("object keys must be strings")
            _string(key)
        keys = sorted(value, key=lambda key: key.encode("utf-8"))
        return "{" + ",".join(_string(key) + ":" + _serialize(value[key]) for key in keys) + "}"
    raise CanonicalError("unsupported value")


def canonical_json(value):
    return _serialize(value)


def _reject_constant(name):
    raise CanonicalError(f"{name} is not allowed")


def main(argv):
    try:
        text = sys.stdin.buffer.read().decode("utf-8")
        value = json.loads(text, parse_constant=_reject_constant)
        canonical = canonical_json(value)
        if "--hash" in argv:
            result = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        else:
            result = canonical
        sys.stdout.buffer.write(result.encode("utf-8"))
        sys.stdout.buffer.write(b"\n")
    except Exception as exc:  # noqa: BLE001 - CLI 需要把原因写回调用方
        sys.stderr.write(str(exc) + "\n")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
