/** 线协议版本。任何破坏兼容的改动（字段语义、消息形状）都必须 +1。 */
export const PROTOCOL_VERSION = 1;

/** 服务端接受的最低客户端协议版本。 */
export const MIN_SUPPORTED_PROTOCOL = 1;

export type ProtocolCheck =
  | { ok: true }
  | { ok: false; code: 'PROTOCOL'; message: string };

export function checkProtocol(requested: number, serverVersion = PROTOCOL_VERSION): ProtocolCheck {
  if (!Number.isInteger(requested)) {
    return { ok: false, code: 'PROTOCOL', message: '协议版本号不是整数' };
  }
  if (requested < MIN_SUPPORTED_PROTOCOL) {
    return {
      ok: false,
      code: 'PROTOCOL',
      message: `客户端协议过旧（需要 ≥${MIN_SUPPORTED_PROTOCOL}，本机 ${requested}），请更新平台`,
    };
  }
  if (requested > serverVersion) {
    return {
      ok: false,
      code: 'PROTOCOL',
      message: `房主协议过旧（房主 ${serverVersion}，本机 ${requested}），请让房主更新平台`,
    };
  }
  return { ok: true };
}
