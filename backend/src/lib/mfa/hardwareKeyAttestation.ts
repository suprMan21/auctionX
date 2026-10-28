/**
 * S-2FA Ph4: the break-glass (super_admin) account only accepts a genuine
 * YubiKey (Boss, 2026-10-28: any YubiKey model, not one exact model).
 *
 * Registration for that account asks for direct attestation. @simplewebauthn
 * checks the signature, the certificate fields and that the certificate's
 * model ID (AAGUID) matches the key's, but it skips the chain check when no
 * roots are set and accepts self attestation (no certificate). Setting roots
 * globally would also apply to everyone else's passkeys, so this module checks
 * the chain itself, for the break-glass account only:
 *   - format `packed` with a certificate chain (x5c), never self attestation;
 *   - every certificate in date; each one signed by the next; intermediates are CAs;
 *   - the chain ends at one of Yubico's FIDO roots, pinned below;
 *   - the model ID is not all zeros.
 * Synced passkeys are refused separately (backup flags).
 *
 * Roots from https://developers.yubico.com/PKI/yubico-ca-certs.txt (2026-10-28),
 * FIDO roots only (not PIV / OpenPGP). SHA-256 fingerprints:
 *   U2F Root CA Serial 457200631  0F:A1:38:6F:80:EB:87:13:26:3A:E5:C1:D8:4D:EB:45:5B:DF:08:AE:A5:0A:B0:55:03:CE:FE:E8:2B:09:2D:42
 *   FIDO Root CA Serial 450203556 35:F1:A5:4B:35:3B:FB:71:1E:6D:42:AD:BE:B7:6C:0E:9D:EA:D0:95:01:8E:6A:94:78:3B:A2:19:2F:D6:FA:AD
 *   Attestation Root 1            62:76:0C:6A:6E:F9:16:79:F4:54:C8:90:2B:80:FD:00:98:25:B3:F2:5D:A9:0F:1F:BA:CE:2E:C6:58:6C:D5:A8
 */

import { X509Certificate } from 'node:crypto';
import { decodeAttestationObject } from '@simplewebauthn/server/helpers';

const YUBICO_U2F_ROOT_457200631 = `
-----BEGIN CERTIFICATE-----
MIIDHjCCAgagAwIBAgIEG0BT9zANBgkqhkiG9w0BAQsFADAuMSwwKgYDVQQDEyNZ
dWJpY28gVTJGIFJvb3QgQ0EgU2VyaWFsIDQ1NzIwMDYzMTAgFw0xNDA4MDEwMDAw
MDBaGA8yMDUwMDkwNDAwMDAwMFowLjEsMCoGA1UEAxMjWXViaWNvIFUyRiBSb290
IENBIFNlcmlhbCA0NTcyMDA2MzEwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK
AoIBAQC/jwYuhBVlqaiYWEMsrWFisgJ+PtM91eSrpI4TK7U53mwCIawSDHy8vUmk
5N2KAj9abvT9NP5SMS1hQi3usxoYGonXQgfO6ZXyUA9a+KAkqdFnBnlyugSeCOep
8EdZFfsaRFtMjkwz5Gcz2Py4vIYvCdMHPtwaz0bVuzneueIEz6TnQjE63Rdt2zbw
nebwTG5ZybeWSwbzy+BJ34ZHcUhPAY89yJQXuE0IzMZFcEBbPNRbWECRKgjq//qT
9nmDOFVlSRCt2wiqPSzluwn+v+suQEBsUjTGMEd25tKXXTkNW21wIWbxeSyUoTXw
LvGS6xlwQSgNpk2qXYwf8iXg7VWZAgMBAAGjQjBAMB0GA1UdDgQWBBQgIvz0bNGJ
hjgpToksyKpP9xv9oDAPBgNVHRMECDAGAQH/AgEAMA4GA1UdDwEB/wQEAwIBBjAN
BgkqhkiG9w0BAQsFAAOCAQEAjvjuOMDSa+JXFCLyBKsycXtBVZsJ4Ue3LbaEsPY4
MYN/hIQ5ZM5p7EjfcnMG4CtYkNsfNHc0AhBLdq45rnT87q/6O3vUEtNMafbhU6kt
hX7Y+9XFN9NpmYxr+ekVY5xOxi8h9JDIgoMP4VB1uS0aunL1IGqrNooL9mmFnL2k
LVVee6/VR6C5+KSTCMCWppMuJIZII2v9o4dkoZ8Y7QRjQlLfYzd3qGtKbw7xaF1U
sG/5xUb/Btwb2X2g4InpiB/yt/3CpQXpiWX/K4mBvUKiGn05ZsqeY1gx4g0xLBqc
U9psmyPzK+Vsgw2jeRQ5JlKDyqE0hebfC1tvFu0CCrJFcw==
-----END CERTIFICATE-----
`;

const YUBICO_FIDO_ROOT_450203556 = `
-----BEGIN CERTIFICATE-----
MIIDMzCCAhugAwIBAgIUSOEjTf//yqRfPW7Qq8qtIyCrAg8wDQYJKoZIhvcNAQEL
BQAwLzEtMCsGA1UEAwwkWXViaWNvIEZJRE8gUm9vdCBDQSBTZXJpYWwgNDUwMjAz
NTU2MCAXDTI0MDUwMTAwMDAwMFoYDzIwNjAwNDMwMDAwMDAwWjAvMS0wKwYDVQQD
DCRZdWJpY28gRklETyBSb290IENBIFNlcmlhbCA0NTAyMDM1NTYwggEiMA0GCSqG
SIb3DQEBAQUAA4IBDwAwggEKAoIBAQCdvl27w2gu1fPXeEFbIdqx0BalvVDVWrQP
J7HqviuEtZHlxSLxSFtcXpTolvLvof8f4tMerQTkVGzcmYzm1EBT4IJuMmoEqfkE
EhWpsADMFrjZkqlZY9EqxQzLoVEEonE5oGxSdVCxCcLIackpyR/CCXvj1Bt/hTgE
9hTlF4pRqxMkx3plF7y8dDZlRHWs7vbnhmBCGeI0ZPEQ6nl2mCg2r74adF2u6K9r
rLfhBC3QLE8EPrgqUsI+hkuq2tK4M2SMOp8uUVVkqUeu3h0kr3WVI0W02pkgrOgi
FKLFNkSrbYhdjMBDj5izmqfc9xJRKoDX612qd8ZGVHpT5AYFX+1hAgMBAAGjRTBD
MB0GA1UdDgQWBBTZyU5DiQ/a2UEgE7qBK0zhIsRNRjASBgNVHRMBAf8ECDAGAQH/
AgEAMA4GA1UdDwEB/wQEAwIBBjANBgkqhkiG9w0BAQsFAAOCAQEAXvnB4SLuUJfY
MSVGAhssL/SmWli3FSccgxydvKlACcidIIWKQqa3q/QSUEQzC9DgEfMgr7iC1BkT
ZbILboV6UZ5knNsvjEZWuMeogJ8tgZs1hVvKwZizwJ+mEcmsjhIrBYuoL1T6yrOJ
vKFg1jv+Cy4ZwA9Bpk/V3UOir1VyK8dCtyHu6vfosotAdYx8FAuR243gRTMV6Jx8
Jdig2JDIAQMlzVeDpSUHX/K2HXRHxHwfgjbgUjjBu/72r8OfehyhzHXI3K8CFFdf
lO+8nEOJK3y8F1ivgS5uN/8SmcYw/STQYwhrxPuwz3nP8baMum4BB2nnYmpB60sX
3bl5k8QUSw==
-----END CERTIFICATE-----
`;

const YUBICO_ATTESTATION_ROOT_1 = `
-----BEGIN CERTIFICATE-----
MIIDPjCCAiagAwIBAgIUXzeiEDJEOTt14F5n0o6Zf/bBwiUwDQYJKoZIhvcNAQEN
BQAwJDEiMCAGA1UEAwwZWXViaWNvIEF0dGVzdGF0aW9uIFJvb3QgMTAgFw0yNDEy
MDEwMDAwMDBaGA85OTk5MTIzMTIzNTk1OVowJDEiMCAGA1UEAwwZWXViaWNvIEF0
dGVzdGF0aW9uIFJvb3QgMTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEB
AMZ6/TxM8rIT+EaoPvG81ontMOo/2mQ2RBwJHS0QZcxVaNXvl12LUhBZ5LmiBScI
Zd1Rnx1od585h+/dhK7hEm7JAALkKKts1fO53KGNLZujz5h3wGncr4hyKF0G74b/
U3K9hE5mGND6zqYchCRAHfrYMYRDF4YL0X4D5nGdxvppAy6nkEmtWmMnwO3i0TAu
csrbE485HvGM4r0VpgVdJpvgQjiTJCTIq+D35hwtT8QDIv+nGvpcyi5wcIfCkzyC
imJukhYy6KoqNMKQEdpNiSOvWyDMTMt1bwCvEzpw91u+msUt4rj0efnO9s0ZOwdw
MRDnH4xgUl5ZLwrrPkfC1/0CAwEAAaNmMGQwHQYDVR0OBBYEFNLu71oijTptXCOX
PfKF1SbxJXuSMB8GA1UdIwQYMBaAFNLu71oijTptXCOXPfKF1SbxJXuSMBIGA1Ud
EwEB/wQIMAYBAf8CAQMwDgYDVR0PAQH/BAQDAgGGMA0GCSqGSIb3DQEBDQUAA4IB
AQC3IW/sgB9pZ8apJNjxuGoX+FkILks0wMNrdXL/coUvsrhzsvl6mePMrbGJByJ1
XnquB5sgcRENFxdQFma3mio8Upf1owM1ZreXrJ0mADG2BplqbJnxiyYa+R11reIF
TWeIhMNcZKsDZrFAyPuFjCWSQvJmNWe9mFRYFgNhXJKkXIb5H1XgEDlwiedYRM7V
olBNlld6pRFKlX8ust6OTMOeADl2xNF0m1LThSdeuXvDyC1g9+ILfz3S6OIYgc3i
roRcFD354g7rKfu67qFAw9gC4yi0xBTPrY95rh4/HqaUYCA/L8ldRk6H7Xk35D+W
Vpmq2Sh/xT5HiFuhf4wJb0bK
-----END CERTIFICATE-----
`;

export const YUBICO_FIDO_ROOTS: readonly string[] = [
  YUBICO_U2F_ROOT_457200631,
  YUBICO_FIDO_ROOT_450203556,
  YUBICO_ATTESTATION_ROOT_1,
];

let roots: readonly string[] = YUBICO_FIDO_ROOTS;

/** Tests only: trust a test CA instead of Yubico's. */
export const __setHardwareKeyRoots = (pems: readonly string[] | null): void => {
  roots = pems ?? YUBICO_FIDO_ROOTS;
};

export type HardwareKeyRefusal = 'no_attestation' | 'bad_chain' | 'unknown_vendor' | 'no_model';

const ZERO_AAGUID = '00000000-0000-0000-0000-000000000000';

const inDate = (c: X509Certificate, now: number): boolean =>
  Date.parse(c.validFrom) <= now && now <= Date.parse(c.validTo);

/** null = accepted. Never throws: anything unreadable is a refusal. */
export const checkHardwareKeyAttestation = (
  attestationObject: Uint8Array<ArrayBuffer>,
  aaguid: string | undefined,
  now: number = Date.now(),
): HardwareKeyRefusal | null => {
  let certs: X509Certificate[];
  try {
    const decoded = decodeAttestationObject(attestationObject);
    if (decoded.get('fmt') !== 'packed') return 'no_attestation';
    const x5c = decoded.get('attStmt').get('x5c');
    if (!Array.isArray(x5c) || x5c.length === 0) return 'no_attestation';
    certs = x5c.map((der) => new X509Certificate(Buffer.from(der)));
  } catch {
    return 'no_attestation';
  }
  try {
    if (!certs.every((c) => inDate(c, now))) return 'bad_chain';
    for (let i = 0; i < certs.length - 1; i++) {
      const next = certs[i + 1];
      if (!next.ca || !certs[i].checkIssued(next) || !certs[i].verify(next.publicKey)) return 'bad_chain';
    }
    const last = certs[certs.length - 1];
    const anchors = roots.map((p) => new X509Certificate(p)).filter((r) => inDate(r, now));
    const anchored = anchors.some(
      (r) => r.fingerprint256 === last.fingerprint256 || (last.checkIssued(r) && last.verify(r.publicKey)),
    );
    if (!anchored) return 'unknown_vendor';
  } catch {
    return 'bad_chain';
  }
  if (!aaguid || aaguid === ZERO_AAGUID) return 'no_model';
  return null;
};
