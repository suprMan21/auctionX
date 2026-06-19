#!/usr/bin/env node
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  generateAesKey,
  generateTagUid,
  simulateTap,
} from '../src/services/nfc/ntag424Simulator';

type Args = Record<string, string | true>;

const parseArgs = (argv: string[]): { cmd: string; args: Args } => {
  const [, , cmd = '', ...rest] = argv;
  const args: Args = {};
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    if (tok.startsWith('--')) {
      const key = tok.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return { cmd, args };
};

const requireEnv = (name: string): string => {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env: ${name}. Run via: op run --env-file backend/.env.op -- npx tsx backend/scripts/ntag-simulator.ts ...`);
    process.exit(1);
  }
  return v;
};

const requireArg = (args: Args, name: string): string => {
  const v = args[name];
  if (typeof v !== 'string') {
    console.error(`Missing required arg: --${name}`);
    process.exit(1);
  }
  return v;
};

const getSupabase = (): SupabaseClient => {
  const url = requireEnv('SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
};

const TENANT = 'auctionx';

const cmdGenerate = () => {
  console.log(JSON.stringify({ tagUid: generateTagUid(), aesKey: generateAesKey() }, null, 2));
};

const cmdSeed = async (args: Args) => {
  const sellerId = requireArg(args, 'seller-id');
  const baseUrl = (args['base-url'] as string) ?? 'http://localhost:5173';
  const supabase = getSupabase();

  const { data: listing, error: listingErr } = await supabase
    .from('listings')
    .select('id, title')
    .eq('seller_id', sellerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (listingErr) throw new Error(`listing lookup failed: ${listingErr.message}`);
  if (!listing) {
    console.error(`No listing found for seller ${sellerId}. Create one in the UI first.`);
    process.exit(1);
  }

  const explicitToken = (args['token-name'] as string) ?? '';
  const tokenName = explicitToken || `sim_${Date.now().toString(36)}`;

  // Optional: bind a real physical token's UID (e.g. from S-NFC1 Tag HQ) instead
  // of a random one, so the smoke test runs against an actual token's identity.
  const explicitUid = (args['tag-uid'] as string) ?? '';
  const tagUid = explicitUid ? explicitUid.replace(/\s/g, '').toUpperCase() : generateTagUid();
  if (explicitUid && !/^[0-9A-F]{14}$/.test(tagUid)) {
    console.error(`--tag-uid must be 14 hex chars (7-byte UID); got "${explicitUid}"`);
    process.exit(1);
  }
  const aesKey = generateAesKey();

  const { data: verif, error: verifErr } = await supabase
    .from('item_verifications')
    .insert({
      listing_id: listing.id,
      seller_id: sellerId,
      token_name: tokenName,
      nfc_tag_uid: tagUid,
      status: 'VERIFIED',
      nfc_programmed_at: new Date().toISOString(),
    })
    .select('id, token_name')
    .single();
  if (verifErr) throw new Error(`item_verifications insert failed: ${verifErr.message}`);

  const { data: tag, error: tagErr } = await supabase
    .from('nfc_tags')
    .insert({
      tenant_id: TENANT,
      tag_uid: tagUid,
      seller_id: sellerId,
      item_id: listing.id,
      verification_id: verif.id,
      aes_key_enc: aesKey,
      status: 'active',
      activated_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (tagErr) throw new Error(`nfc_tags insert failed: ${tagErr.message}`);

  const { error: nftErr } = await supabase
    .from('nft_metadata')
    .insert({
      tag_id: tag.id,
      chain: 'base',
      contract_address: '0xSIMULATORDEADBEEF000000000000000000000000',
      token_id: '1',
      mint_tx_hash: '0xSIMULATEDTXHASH00000000000000000000000000000000000000000000000000',
      metadata_uri: null,
      metadata_json: { simulator: true, note: 'placeholder NFT data — replace before prod' },
      minted_at: new Date().toISOString(),
    });
  if (nftErr) throw new Error(`nft_metadata insert failed: ${nftErr.message}`);

  const verifyUrl = `${baseUrl.replace(/\/$/, '')}/verify/${encodeURIComponent(verif.token_name)}`;

  console.log(JSON.stringify({
    tagUid,
    aesKey,
    tokenName: verif.token_name,
    verificationId: verif.id,
    tagId: tag.id,
    listingId: listing.id,
    listingTitle: listing.title,
    verifyUrl,
  }, null, 2));
};

const cmdTap = async (args: Args, opts: { scan: boolean }) => {
  const tagUid = requireArg(args, 'tag-uid').toUpperCase();
  const baseUrl = (args['base-url'] as string) ?? 'http://localhost:5173';
  const apiUrl = (args['api-url'] as string) ?? 'http://localhost:3001';
  const supabase = getSupabase();

  const { data: tag, error: tagErr } = await supabase
    .from('nfc_tags')
    .select('id, tag_uid, aes_key_enc, sun_counter, verification_id')
    .eq('tag_uid', tagUid)
    .maybeSingle();
  if (tagErr) throw new Error(`tag lookup failed: ${tagErr.message}`);
  if (!tag) {
    console.error(`No tag with tag_uid=${tagUid}. Run \`seed\` first.`);
    process.exit(1);
  }

  let tokenName = (args['token-name'] as string) ?? '';
  if (!tokenName && tag.verification_id) {
    const { data: verif } = await supabase
      .from('item_verifications')
      .select('token_name')
      .eq('id', tag.verification_id)
      .maybeSingle();
    tokenName = verif?.token_name ?? '';
  }
  if (!tokenName) tokenName = 'unknown';

  const counter = (tag.sun_counter ?? 0) + 1;
  const sim = simulateTap({
    tagUid: tag.tag_uid,
    counter,
    aesKeyHex: tag.aes_key_enc,
    baseUrl,
    tokenName,
  });

  if (!opts.scan) {
    console.log(JSON.stringify({ tagUid: tag.tag_uid, counter, ...sim }, null, 2));
    return;
  }

  const scanRes = await fetch(`${apiUrl.replace(/\/$/, '')}/api/v1/nfc/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tagUid: tag.tag_uid, piccData: sim.piccData, cmac: sim.cmac }),
  });
  const scanBody = await scanRes.json().catch(() => ({}));
  console.log(JSON.stringify({
    tagUid: tag.tag_uid,
    counter,
    sunUrl: sim.sunUrl,
    scanStatus: scanRes.status,
    scanBody,
  }, null, 2));
  if (!scanRes.ok || !scanBody?.data?.valid) process.exit(1);
};

const cmdCleanup = async (args: Args) => {
  const tagUid = requireArg(args, 'tag-uid').toUpperCase();
  const supabase = getSupabase();

  const { data: tag } = await supabase
    .from('nfc_tags')
    .select('id, verification_id')
    .eq('tag_uid', tagUid)
    .maybeSingle();
  if (!tag) {
    console.error(`No tag with tag_uid=${tagUid}.`);
    process.exit(1);
  }

  await supabase.from('nft_metadata').delete().eq('tag_id', tag.id);
  await supabase.from('verification_events').delete().eq('tag_id', tag.id);
  if (tag.verification_id) {
    await supabase.from('ownership_transfers').delete().eq('verification_id', tag.verification_id);
  }
  await supabase.from('nfc_tags').delete().eq('id', tag.id);
  if (tag.verification_id) {
    await supabase.from('item_verifications').delete().eq('id', tag.verification_id);
  }

  console.log(JSON.stringify({ cleaned: { tagUid, tagId: tag.id, verificationId: tag.verification_id ?? null } }, null, 2));
};

const usage = () => {
  console.log(`ntag-simulator — software mimic for NTAG 424 DNA SUN URLs.

Run via 1Password: op run --env-file backend/.env.op -- npx tsx backend/scripts/ntag-simulator.ts <cmd> [args]

Commands:
  generate                                  Print a fresh (tagUid, aesKey) pair. No DB writes.
  seed --seller-id <uuid> [--base-url url]  Create item_verifications + nfc_tags + nft_metadata for the seller's most recent listing. Prints {tagUid, aesKey, tokenName, verifyUrl}.
  tap --tag-uid <hex> [--base-url url]      Generate a fresh SUN URL for a registered tag (counter = stored + 1). No DB write.
  tap-and-scan --tag-uid <hex>              Same as tap, then POST to /api/v1/nfc/scan and print the response.
                  [--api-url url] [--base-url url]
  cleanup --tag-uid <hex>                   Remove all rows seeded for this tagUid (events → nft → transfers → tag → verification).
`);
};

const main = async () => {
  const { cmd, args } = parseArgs(process.argv);
  switch (cmd) {
    case 'generate': cmdGenerate(); return;
    case 'seed': await cmdSeed(args); return;
    case 'tap': await cmdTap(args, { scan: false }); return;
    case 'tap-and-scan': await cmdTap(args, { scan: true }); return;
    case 'cleanup': await cmdCleanup(args); return;
    case '':
    case 'help':
    case '--help':
    case '-h': usage(); return;
    default:
      console.error(`Unknown command: ${cmd}`);
      usage();
      process.exit(1);
  }
};

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
