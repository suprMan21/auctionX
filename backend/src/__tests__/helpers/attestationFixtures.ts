/**
 * Test-only certificate chains for packed attestation (fixtures/attestation,
 * made with openssl; the keys protect nothing). `testVendor` chains to
 * root.pem, which tests trust in place of Yubico's roots; `otherVendor`
 * chains to a root nobody trusts.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const dir = join(__dirname, '..', 'fixtures', 'attestation');
const read = (f: string): string => readFileSync(join(dir, f), 'utf8');

/** The model ID baked into both leaf certificates. */
export const TEST_AAGUID = Buffer.from('112233445566778899aabbccddeeff00', 'hex');

export const TEST_ROOT_PEM = read('root.pem');

export const testVendor = () => ({
  leafKeyPem: read('leaf.key'),
  chainPem: [read('leaf.pem'), read('intermediate.pem')],
  aaguid: TEST_AAGUID,
});

export const otherVendor = () => ({
  leafKeyPem: read('other-leaf.key'),
  chainPem: [read('other-leaf.pem')],
  aaguid: TEST_AAGUID,
});
