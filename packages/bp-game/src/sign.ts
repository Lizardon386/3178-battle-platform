import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readPackage, verifyPackageSignature, type PackageSignature } from '@bp/game-package';

export type { PackageSignature } from '@bp/game-package';

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
  const { packageHash } = readPackage(filePath);
  return verifyPackageSignature(packageHash, signature, publicKeyPem === undefined ? [] : [publicKeyPem]);
}
