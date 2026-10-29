# S-MOB2 Ph B — app sealing flow: verification

Date: 2026-10-29 · Branch `feature/s-mob2-b` · Plan `docs/plans/2026-10-29-s-mob2.md` · Builds on Ph A (`docs/S_MOB2_A_VERIFICATION.md`, live on staging).
Build 0.1.0+11 (not yet uploaded to TestFlight).

## What changed

**App (`mobile/lib/features/seal/`)**
- **Prep** (`/seal`): the Brand Voice draft from the Ideas DB row "Recorded sealing" plus not on metal, press firmly,
  turn off music, wait 24 h before shipping. **Practice run** (no seal read, nothing kept) or **I'm ready**.
- **Take** (`/seal/take`): front camera first (switchable before tap 1) → **tap 1** on the loose seal (serial read
  from `sn=`; v1 chips refused as "older kind") → optional `POST /nfc/seal/session` (never waits, never fails the
  take) → **3, 2, 1** → recording with REC clock → "apply the seal on camera" → **tap 2** stops it. A different
  seal on tap 2 is refused and recording keeps going. Warning at 1:45, take over at 2:00 (a late tap 2 can't finish
  it), then "Is the seal already on?" → redo. App leaving the screen (paused, not the NFC sheet's inactive) voids
  the take. Back asks "Stop this take?".
- **Review**: plays the take; **Seal it** or **Redo** (redo = `appliedBeforeRecording: true`, "seal applied before
  recording").
- **Seal it**: video moved to the app's private support folder, SHA-256 computed, entry saved to the keychain
  queue (`am.pendingSeals`, per account) **before** anything goes to the server → **Confirm it's you** (`seal`
  step-up on the chip serial; passkey or authenticator code, **never a backup code**) → `POST /nfc/seal`.
- **Result** (`/seal/result`): waiting = still "Sealed" + quiet "Syncing" (creator only); Verified (moving) only
  after the server accepted. No signal / 5xx / 429 → stays on the phone, **Try now**. `seal_gap`,
  `replay_detected`, `invalid_signature` → **Record it again** (seal on). `already_claimed`, `not_sealable`,
  `creator_only`, unknown seal → refused with the reason. Expired start time → send again without it.
- **Home**: Seal a piece button; "Finish your seal" cards for seals still on the phone.
- **Read check** (`/read-check`, test builds only): reads one seal twice the way a take does and sends both links to
  the Mac. Sends nothing to the server.
- NFC: one read per tap and stop (iOS `readNdef` once; Android the cached message from discovery, no second read).
- `StepUpAction.seal`; `crypto` moved to runtime dependencies.

**Encoder**: `verify` takes `--url` (fills picc / cmac / serial) and `--kms` (real chip keys, profile `am-encoder`).

## Results

| Check | Result |
|---|---|
| `flutter analyze` | ✅ no issues |
| `flutter test` | ✅ 148 passed (seal data 22, take screen 6, routes +2, step-up rule +1) |
| `flutter build ios --debug --no-codesign` (staging defines) | ✅ built |
| tag-encoder pytest | ✅ 255 passed (+2) |
| Backend / frontend | no change |

## Device test (Boss, iPhone, test@ = the only Creator)

**1. Read check: the gate.** Any v2 chip works (chip_004 is fine: nothing goes to the server).
Home → Read check → read the same seal twice → **Send to my Mac**. On the Mac:
```bash
cd tag-encoder
AWS_PROFILE=am-encoder .venv/bin/python -m tag_encoder.cli verify --kms --url '<read 1 link>'
AWS_PROFILE=am-encoder .venv/bin/python -m tag_encoder.cli verify --kms --url '<read 2 link>'
```
Pass = the two `counterValue` numbers differ by exactly 1. If they differ by 2 or more, stop: every take would come
back as "read during the video" (D2). Tell Claude the numbers.

**2. Practice run.** Prep → Practice run: no NFC sheet, both taps pretend, review says nothing is kept.

**3. One fresh chip, every path.** Needs an ENROLLED, unowned v2 chip: encode one without `--item` (also the first
no-name run → expect `chip_005`), or check whether `chip_` is unowned.
1. Take 1: tap the loose seal, 3-2-1, apply it on camera, **have someone tap it with another phone during the video**,
   tap 2, Seal it, Confirm it's you → expect **Record it again** (seal_gap). Check the video in review ran through
   both NFC sheets without stopping.
2. Record it again: tap the applied seal, talk, tap 2 → review → turn on **airplane mode** → Seal it → expect still
   "Sealed" + "Syncing" + "Saved on this phone".
3. Airplane mode off → **Try now** → Confirm it's you → moving Verified seal, "Sealed."
4. Tap the seal with the iPhone camera → tap page shows the seal as claimed.
5. Try to seal it again (new take) → "already claimed".

## Open / next

- **Ph C**: video upload (resumable, hash must match), admin review queue, tap page video states; keep the taps of
  abandoned / redone takes as audit (today a redone entry is deleted from the phone); exclude seal videos from
  iCloud backup.
- Seal code is not shown at tap 1 (the app doesn't know it offline; the server could return it from `/seal/session`).
- Android: untested (no device).
- TestFlight: upload build 0.1.0+11 after review.
