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

**1. Read check: the gate.** ✅ Passed 2026-10-30 (Boss: counter +1 per read). Any v2 chip works (chip_004 is fine: nothing goes to the server).
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

## Device test 2026-11-14 (build +13, chip_005): every take voided → native iOS reader (build +14)

- chip_005 encoded with no name (first auto-named chip). `chip_` (5RQPP74E) kept as the spare.
- Offline path ✅ (airplane mode → still Sealed + Syncing + "Saved on this phone").
- Every take came back `seal_gap`: tap 1 / tap 2 counters 4/7, 16/19, 22/25, including one clean take.
  Read check: chip_005 28 → 31, chip_004 30 → 33. **Each app read was +3**, on two chips.
- Cause: `nfc_manager` 4.2.1 iOS discovery (`NfcManagerPlugin.swift` ~754) runs `queryNDEFStatus` and
  `readNDEF` on every tag before Dart sees it, then our reader called `readNdef()` again. Each touches the
  SDM file. (The 2026-10-30 "+1" can't come from this code; treat it as unexplained.)
- Fix (`feature/s-mob2-b-ios-reader`, build 0.1.0+14): `SealReaderPlugin` in `ios/Runner/AppDelegate.swift`
  (`am/seal_reader` channel) runs its own `NFCTagReaderSession`: SELECT D2760000850101, SELECT E104, **one**
  ReadBinary (Le 256), returns the file image; Dart `urlFromNdefFile` parses NLEN + the URI record. Android
  keeps the system's `cachedNdefMessage` (no second read). `platformSealReader()` picks per platform.
- A tap 2 that read the seal but failed now voids the take on the spot (`SealReadException.chipRead`,
  `extraReadCopy`) instead of at Seal it.
- Wording: no more "seal ending in …" (the serial isn't printed on a seal): Finish card says "Started <when>",
  Confirm it's you says "Seal your piece. This is permanent.", wrong seal says "Tap the seal you started with."
- Tests: 155 app tests, analyze clean, iOS no-codesign build OK.
- **Gate before the next take:** Read check on chip_005 with build +14 must be +1. Then: clean take → Sealed →
  camera tap shows claimed → second take "already claimed".
- Also seen: test@'s iCloud passkey "trest1key" is refused in the app ("This passkey could not be used to sign
  in", nothing reaches the server) but works on the web; the 1Password passkey works in the app.

## Device test 2026-11-14 (build +14): ✅ sealed

- Read check on chip_005: 31 → 32 → 33 (+1 per read). Gate passed.
- Clean take: tap 1 = 34, tap 2 = 35 → **accepted**; chip_005 ACTIVE, owned by test@, 1 row in `nfc_seals`.
- Old queued takes (10/13, 22/25) then sent → `already_claimed` (step 5 behaviour confirmed).
- Found: a "Record it again" take stayed queued unless the creator pressed that button, so it kept coming
  back as "Finish your seal". Fixed (build 0.1.0+15, `feature/s-mob2-b-queue`): `PendingSealsController.settle`
  drops a redo take (and its video) as soon as the server says so, and once a take is accepted drops the
  creator's other takes on that seal (`deadTakes`); also pruned on load for phones that already have them.
- Camera tap on chip_005 ✅ (17:46 counter 36, 17:51 counter 39, verify ok; tap page shows Verified).
- Second take on the sealed chip went through a whole recording before "already claimed" at Seal it. Boss: it must
  stop at tap 1. Fixed (build 0.1.0+16 + backend, `feature/s-mob2-b-tap1-check`): the app sends the tap 1 URL with
  `POST /nfc/seal/session` and waits ≤ 5 s; the server answers `already_claimed` / `not_sealable` only for a
  MAC-valid tap above the baseline (unknown serial, bad MAC, old counter → plain session, no oracle), reads only
  (counter not spent), logs `nfc.claim` on the session route. No signal → the take goes ahead; the commit decides.
- **Test (+16, after the backend deploy):** new take on chip_005 → tap 1 → "already claimed", no countdown.
  Airplane mode → tap 1 → countdown starts (refused at Seal it once online).
- +16 ✅ (Boss): tap 1 on the sealed chip says "already claimed" at once. Airplane-mode path showed "This seal is
  no longer on this phone": +15's dead-take rule removed the refused take (sibling of this phone's accepted seal)
  while the result screen was showing it. Fixed in build 0.1.0+17 (`feature/s-mob2-b-result-shown`): the screen
  keeps the last answer after the take leaves the queue. No widget test (needs the step-up sheet); device check.
- The video is not on the tap page yet: it stays on the phone until Ph C (upload, review, tap page states).

## Open / next

- **Ph C**: video upload (resumable, hash must match), admin review queue, tap page video states; keep the taps of
  abandoned / redone takes as audit (today a redone entry is deleted from the phone); exclude seal videos from
  iCloud backup.
- Seal code is not shown at tap 1 (the app doesn't know it offline; the server could return it from `/seal/session`).
- Android: untested (no device).
- TestFlight: upload build 0.1.0+11 after review.
