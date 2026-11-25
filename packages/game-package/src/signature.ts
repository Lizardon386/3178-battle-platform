import { createPublicKey, verify } from 'node:crypto';

export interface PackageSignature {
  algorithm: 'ed25519';
  /** base64 签名值。 */
  value: string;
  /** base64 SPKI DER 公钥；有 trustedKeys 时仅作参考。 */
  publicKey?: string;
}

const keyObject = (value: string) => {
  if (value.includes('BEGIN PUBLIC KEY')) return createPublicKey(value);
  return createPublicKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'spki' });
};

/**
 * 验证 detached `.sig`：签名对象是整包 SHA-256（packageHash）。
 * trustedKeys 非空时必须由其中一把公钥验证通过；为空时退回签名自带公钥（仅自证）。
 */
export function verifyPackageSignature(
  packageHash: string,
  signature: PackageSignature,
  trustedKeys: string[] = [],
): boolean {
  if (signature.algorithm !== 'ed25519' || typeof signature.value !== 'string') return false;
  const candidates = trustedKeys.length > 0
    ? trustedKeys
    : signature.publicKey === undefined ? [] : [signature.publicKey];
  for (const candidate of candidates) {
    try {
      if (verify(null, Buffer.from(packageHash, 'utf8'), keyObject(candidate), Buffer.from(signature.value, 'base64'))) {
        return true;
      }
    } catch {
      // 单把公钥格式错误不阻断其它候选
    }
  }
  return false;
}
