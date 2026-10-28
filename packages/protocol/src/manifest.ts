import { stableDigest, type GameManifest } from '@3178/core-abi';

/** 房规摘要。旧项目里写死的牌堆版本号就是这个函数的一个特例。 */
export function computeRulesHash(config: Record<string, unknown> | undefined): string {
  return stableDigest(config ?? {});
}

const MANIFEST_FIELDS = ['id', 'name', 'version', 'rulesHash', 'seats', 'entry'] as const;

/** 收到的 manifest 必须过一遍形状检查再信它——它来自别人的机器。 */
export function isGameManifest(value: unknown): value is GameManifest {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  if (!MANIFEST_FIELDS.every((k) => typeof m[k] === 'string' || k === 'seats')) return false;
  if (typeof m.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(m.id)) return false;
  if (typeof m.name !== 'string' || typeof m.version !== 'string' || typeof m.entry !== 'string') return false;
  if (typeof m.rulesHash !== 'string') return false;
  const seats = m.seats as Record<string, unknown> | undefined;
  if (!seats || typeof seats.min !== 'number' || typeof seats.max !== 'number') return false;
  if (!(seats.min >= 1 && seats.max >= seats.min && seats.max <= 16)) return false;
  if (typeof m.entry !== 'string' || m.entry.includes('..') || /^https?:/i.test(m.entry)) return false;
  if (m.ui !== undefined) {
    if (typeof m.ui !== 'object' || m.ui === null || Array.isArray(m.ui)) return false;
    const ui = m.ui as Record<string, unknown>;
    if (Object.keys(ui).some((key) => key !== 'chat')) return false;
    if (ui.chat !== undefined && ui.chat !== 'platform' && ui.chat !== 'game') return false;
  }
  return true;
}

/** 握手比对：先版本后房规，报错要能分清是"该更新平台"还是"玩法不一样"。 */
export type HandshakeCheck =
  | { ok: true }
  | {
      ok: false;
      code: 'VERSION' | 'RULES';
      message: string;
      detail: { want: string; got: string };
    };

export function checkHandshake(
  want: Pick<GameManifest, 'version' | 'rulesHash'>,
  got: { version?: string; rulesHash?: string },
): HandshakeCheck {
  if (got.version !== undefined && got.version !== want.version) {
    return {
      ok: false,
      code: 'VERSION',
      message: `游戏版本与房主不同：房主 ${want.version}，你这里 ${got.version}`,
      detail: { want: want.version, got: got.version },
    };
  }
  if (got.rulesHash !== undefined && got.rulesHash !== want.rulesHash) {
    return {
      ok: false,
      code: 'RULES',
      message: '与房主的玩法设置不同，无法入房',
      detail: { want: want.rulesHash, got: got.rulesHash },
    };
  }
  return { ok: true };
}
