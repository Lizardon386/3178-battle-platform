#!/usr/bin/env bash
# 接缝闸门：平台包（packages/*）里不得出现任何玩法词。
# 存在的理由：uno-online 的 room.js 同时是座位管理器和牌类规则引擎，
# 重构时最容易"顺手搬过来"，搬过来平台就永远带着那个游戏的形状。
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# 只用词边界匹配：handshake 不会被 hand 命中，draw 不算 withdraw。
WORDS=(uno deck card cards peng discard pile wild drawfrom syntheticcard)
SCAN_DIRS=(
  "$ROOT"/packages/*/src
  "$ROOT"/tools/testkit/contract-harness
  "$ROOT"/tools/testkit/fake-context
  "$ROOT"/tools/testkit/test-games
)

fail=0
for w in "${WORDS[@]}"; do
  hits=$(grep -rniE "\b${w}\b" "${SCAN_DIRS[@]}" 2>/dev/null | grep -v '\.map:' || true)
  if [ -n "$hits" ]; then
    echo "[缝] 平台源码或 testkit 命中玩法词 '${w}':"
    echo "$hits" | sed "s|$ROOT/||"
    fail=1
  fi
done

# 平台不得直接 import 任何 games/ 下的东西
if grep -rnE "from ['\"][^'\"]*games/" "${SCAN_DIRS[@]}" 2>/dev/null | grep -v '\.map:'; then
  echo "[缝] ^ 平台包直接 import 了 games/ 路径（只允许运行时按 id 动态加载）"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "seam OK: 平台包与玩法零耦合（已扫 ${#WORDS[@]} 个词 + games/ 引用；testkit 只含测试夹具）"
fi
exit "$fail"
