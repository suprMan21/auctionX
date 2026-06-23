"""S-NFC2 encode-gate check — plain NTAG 424 DNA vs TagTamper (Tx) discriminator.

UNAUTHENTICATED, READ-ONLY. Writes nothing, changes no keys/config. Safe to run
on factory-state stock.

Method
------
The GetTTStatus command (native code 0xF7) exists ONLY on the TagTamper (Tx)
silicon. So an unauthenticated probe discriminates by status word:

  * 0x911C  ILLEGAL_COMMAND_CODE  -> command doesn't exist  -> PLAIN  (gate clears)
  * 0x9100  OK (+status data)     -> command exists, plain comms -> TAGTAMPER
  * 0x91AE  AUTHENTICATION_ERROR  -> command exists, auth-gated   -> TAGTAMPER
  * 0x919D  PERMISSION_DENIED     -> command exists, perm-gated   -> TAGTAMPER
  * other                          -> INCONCLUSIVE (report raw SW)

We also run GetVersion first to confirm we're actually talking to a 424 DNA-class
chip and to capture the HW sub-type nibble (0x02 = plain per DR-9).

Run:  /tmp/nfc-venv/bin/python tag-encoder/tools/gate_check.py
"""
from __future__ import annotations

# ---- NTAG 424 DNA native APDUs (ISO-wrapped, CLA 0x90) --------------------
SELECT_NDEF_APP = [0x00, 0xA4, 0x04, 0x00, 0x07, 0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01, 0x00]
GET_VERSION     = [0x90, 0x60, 0x00, 0x00, 0x00]   # part 1 -> 91AF + 7 HW bytes
GET_VERSION_AF  = [0x90, 0xAF, 0x00, 0x00, 0x00]   # additional frames
GET_TT_STATUS   = [0x90, 0xF7, 0x00, 0x00, 0x00]   # Tx-only

# NTAG status words (low byte of the 91xx native status)
SW_OK                 = 0x9100
SW_ILLEGAL_CMD_CODE   = 0x911C
SW_AUTH_ERROR         = 0x91AE
SW_PERMISSION_DENIED  = 0x919D


def classify_tt_status(sw: int, data: list[int] | None = None) -> tuple[str, str]:
    """Return (verdict, explanation) from the GetTTStatus status word."""
    if sw == SW_ILLEGAL_CMD_CODE:
        return ("PLAIN", "GetTTStatus (0xF7) is not implemented (91 1C illegal command "
                         "code) -> this is plain NTAG 424 DNA. Encode gate CLEARS.")
    if sw == SW_OK:
        return ("TAGTAMPER", f"GetTTStatus returned OK (91 00) with status data "
                             f"{data!r} -> the chip implements TagTamper -> Tx variant.")
    if sw in (SW_AUTH_ERROR, SW_PERMISSION_DENIED):
        return ("TAGTAMPER", f"GetTTStatus exists but is access-gated (SW {sw:04X}) -> the "
                             f"command handler is present -> Tx variant.")
    return ("INCONCLUSIVE", f"Unexpected SW {sw:04X}; cannot classify from this alone. "
                            f"Fall back to the supplier order code.")


def _sw(resp_sw1: int, resp_sw2: int) -> int:
    return (resp_sw1 << 8) | resp_sw2


def main() -> int:
    from smartcard.System import readers
    from smartcard.util import toHexString
    from smartcard.CardRequest import CardRequest
    from smartcard.CardType import AnyCardType

    rl = [r for r in readers() if "PICC" in str(r)] or readers()
    if not rl:
        print("NO READER. Plug in the ACR1252.")
        return 2
    reader = rl[0]
    print(f"Reader: {reader}")
    print("Place a SAMPLE tag on the reader (waiting up to 45s)...")

    cr = CardRequest(timeout=45, readers=[reader], cardType=AnyCardType())
    try:
        svc = cr.waitforcard()
    except Exception as e:
        print(f"No card within timeout: {e}")
        return 2
    conn = svc.connection
    conn.connect()
    print(f"ATR = {toHexString(conn.getATR())}\n")

    def tx(apdu, label):
        data, sw1, sw2 = conn.transmit(apdu)
        sw = _sw(sw1, sw2)
        print(f"  {label:<16} -> data={toHexString(data) if data else '(none)':<40} SW={sw:04X}")
        return data, sw

    # 1. Select NDEF app (best-effort; native GetVersion also works without it)
    tx(SELECT_NDEF_APP, "SELECT app")

    # 2. GetVersion -> confirm 424 DNA class + capture sub-type
    data, sw = tx(GET_VERSION, "GetVersion")
    if sw == 0x91AF and len(data) >= 7:
        vendor, hw_type, sub_type, _maj, _min, storage, proto = data[:7]
        print(f"    vendor=0x{vendor:02X} type=0x{hw_type:02X} sub_type=0x{sub_type:02X} "
              f"storage=0x{storage:02X} proto=0x{proto:02X}")
        is_424 = vendor == 0x04 and hw_type == 0x04 and storage == 0x11
        print(f"    -> {'NTAG 424 DNA-class confirmed' if is_424 else 'NOT a 424 DNA-class chip!'}; "
              f"GetVersion sub-type {'0x02 (plain)' if sub_type == 0x02 else hex(sub_type)}")
        # drain the remaining GetVersion frames so the chip is in a clean state
        tx(GET_VERSION_AF, "GetVersion AF1")
        tx(GET_VERSION_AF, "GetVersion AF2")

    # 3. The discriminator
    print()
    data, sw = tx(GET_TT_STATUS, "GetTTStatus")
    verdict, why = classify_tt_status(sw, data)
    print("\n" + "=" * 68)
    print(f"VERDICT: {verdict}")
    print(why)
    print("=" * 68)
    return 0 if verdict == "PLAIN" else (1 if verdict == "TAGTAMPER" else 3)


if __name__ == "__main__":
    raise SystemExit(main())
