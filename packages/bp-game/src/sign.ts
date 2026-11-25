import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readPackage } from '@bp/game-package';

export interface PackageSignature {
  algorithm: 'ed25519';
  /** base64 签名值。 */
  value: string;
  /** base64 SPKI DER 公钥，便于分发时自带验证材料。 */
  publicKey: string;
}

const algorithm = 'ed25519';

/** 签名对象是整包 SHA-256（packageHash），不修改包头，避免自引用。 */
export function signPackage(filePath: string, privateKeyPem: string): PackageSignature {
  const { packageHash } = readPackage(filePath);
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const value = sign(null, Buffer.from(packageHash, 'utf8'), privateKey);
  return { algorithm, value: value.toString('base64'), publicKey: publicKey.toString('base64') };
}

export function verifyPackage(filePath: string, signature: PackageSignature, publicKeyPem?: string): boolean {
  if (signature.algorithm !== algorithm || typeof signature.value !== 'string') return false;
  const { packageHash } = readPackage(filePath);
  try {
    const key = publicKeyPem
      ? createPublicKey(publicKeyPem)
      : createPublicKey({ key: Buffer.from(signature.publicKey, 'base64'), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(packageHash, 'utf8'), key, Buffer.from(signature.value, 'base64'));
  } catch {
    return false;
  }
}
