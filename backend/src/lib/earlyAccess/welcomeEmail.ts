/**
 * Early-access welcome email (S-SITE2). Visual spec: canvas board Email-welcome.dc.html.
 *
 * Built as a table layout with inline styles (mail clients ignore flex and <style>).
 * Art ships as 2x PNGs served from the public site (Gmail drops inline SVG); the seal
 * is static. CASL: sender identification, mailing address, working unsubscribe.
 */

export const SENDER_NAME = 'The Craving Company Inc.';
export const MAILING_ADDRESS = '1460 The Queensway, Etobicoke, ON M8Z 1S7';
export const CONTACT_EMAIL = 'hello@authentic-materials.com';
export const WELCOME_SUBJECT = "You're on the list";

/** Public site, for the "See the story" button. */
const siteUrl = (): string => (process.env.PUBLIC_SITE_URL ?? 'https://authentic-materials.com').replace(/\/+$/, '');
/** Where the email art lives (frontend/public/email, deployed with the public site). */
const assetBase = (): string => (process.env.EMAIL_ASSET_BASE ?? `${siteUrl()}/email`).replace(/\/+$/, '');

const ROWS = [
  {
    img: 'coming-seal.png',
    alt: 'The captain critter sealing the gloves on camera',
    title: 'Seal the moment',
    body: 'Creators seal their pieces on camera. The moment travels with the item, for good.',
  },
  {
    img: 'coming-tap.png',
    alt: 'A critter tapping a phone on the sealed gloves',
    title: 'Tap it, watch the story',
    body: 'No app, no account. One tap shows the seal is genuine and plays the moment back.',
  },
  {
    img: 'coming-pass.png',
    alt: 'One critter handing the sealed gloves to a heart-eyed new owner',
    title: 'Owners change, the story stays',
    body: 'Sell it, gift it, pass it down. Every new owner gets the whole story. Your name never shows.',
  },
] as const;

const FONT = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface WelcomeEmail {
  subject: string;
  html: string;
  text: string;
  headers: Array<{ Name: string; Value: string }>;
}

/** @param unsubscribeUrl the signup's own unsubscribe link (required: no link, no email). */
export const renderWelcomeEmail = (unsubscribeUrl: string): WelcomeEmail => {
  const a = assetBase();
  const site = siteUrl();
  const u = esc(unsubscribeUrl);

  const rows = ROWS.map(
    (r) => `
      <tr><td style="padding:18px 0;border-top:1px solid #1F1F2A;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="150" valign="middle" style="width:150px;">
            <img src="${a}/${r.img}" width="150" height="112" alt="${esc(r.alt)}" style="display:block;width:150px;height:auto;border:0;border-radius:14px;">
          </td>
          <td width="20" style="width:20px;font-size:0;line-height:0;">&nbsp;</td>
          <td valign="middle" style="font-family:${FONT};">
            <p style="margin:0 0 6px;font-size:17px;line-height:1.3;font-weight:700;color:#FFFFFF;">${esc(r.title)}</p>
            <p style="margin:0;font-size:15px;line-height:1.55;color:#C9CBD3;">${esc(r.body)}</p>
          </td>
        </tr></table>
      </td></tr>`,
  ).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${WELCOME_SUBJECT}</title>
</head>
<body style="margin:0;padding:0;background:#1A1A22;">
<div style="display:none;max-height:0;overflow:hidden;">Every piece has a moment. Yours is coming.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#1A1A22;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#070709;font-family:${FONT};color:#FFFFFF;">
  <tr><td style="padding:26px 32px 6px;">
    <img src="${a}/am-mark.png" width="34" height="22" alt="" style="display:inline-block;vertical-align:middle;border:0;">
    <span style="font-size:15px;font-weight:600;color:#FFFFFF;vertical-align:middle;padding-left:8px;">Authentic Materials</span>
  </td></tr>
  <tr><td style="padding:20px 32px 0;">
    <img src="${a}/hero.png" width="536" height="385" alt="The captain critter celebrating the winning goal" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:18px;">
  </td></tr>
  <tr><td style="padding:30px 32px 8px;">
    <h1 style="margin:0;font-size:40px;line-height:1.05;font-weight:800;letter-spacing:.03em;text-transform:uppercase;color:#FFFFFF;">You're on the list</h1>
    <p style="margin:16px 0 0;font-size:18px;line-height:1.5;font-weight:500;color:#EDE9FE;">Every piece has a moment. Soon, yours comes with proof.</p>
    <p style="margin:14px 0 0;font-size:16px;line-height:1.6;color:#C9CBD3;">Thanks for getting in early. You're now one of the first to know when the seal goes live, and we promise not to fill your inbox with filler. Good things only.</p>
  </td></tr>
  <tr><td style="padding:18px 32px 6px;">
    <p style="margin:0 0 4px;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#A78BFA;">What's coming</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}
    </table>
  </td></tr>
  <tr><td style="padding:22px 32px 8px;">
    <a href="${site}/#story" style="display:inline-block;padding:16px 30px;border-radius:12px;background:#7C3AED;background-image:linear-gradient(135deg,#7c3aed 0%,#6366f1 50%,#3b82f6 100%);color:#FFFFFF;font-size:16px;font-weight:700;text-decoration:none;">See the story</a>
  </td></tr>
  <tr><td style="padding:26px 32px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#13131A;border:1px solid #2A2A38;border-radius:18px;"><tr>
      <td width="96" style="padding:22px 0 22px 22px;width:96px;"><img src="${a}/seal.png" width="96" height="96" alt="Genuine AM seal" style="display:block;border:0;"></td>
      <td style="padding:22px;font-family:${FONT};">
        <p style="margin:0;font-size:17px;font-weight:700;color:#FFFFFF;">Look for the seal</p>
        <p style="margin:6px 0 0;font-size:15px;line-height:1.5;color:#C9CBD3;">When you spot it, tap it. When it's yours, you'll know.</p>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:26px 32px 30px;">
    <p style="margin:0;font-size:16px;line-height:1.6;color:#C9CBD3;">Talk soon,<br>The Authentic Materials crew</p>
  </td></tr>
  <tr><td style="padding:22px 32px 30px;background:#0D0D12;border-top:1px solid #1F1F2A;">
    <p style="margin:0;font-size:12px;line-height:1.6;color:#9CA3AF;">You're getting this because you joined the early-access list at authentic-materials.com.</p>
    <p style="margin:8px 0 0;font-size:12px;line-height:1.6;color:#9CA3AF;">${SENDER_NAME} · ${MAILING_ADDRESS} · <a href="mailto:${CONTACT_EMAIL}" style="color:#A78BFA;">${CONTACT_EMAIL}</a></p>
    <p style="margin:8px 0 0;font-size:12px;line-height:1.6;color:#9CA3AF;"><a href="${u}" style="color:#A78BFA;">Unsubscribe</a> anytime, one click, no hard feelings.</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    "YOU'RE ON THE LIST",
    '',
    'Every piece has a moment. Soon, yours comes with proof.',
    '',
    "Thanks for getting in early. You're now one of the first to know when the seal goes live, and we promise not to fill your inbox with filler. Good things only.",
    '',
    "WHAT'S COMING",
    ...ROWS.flatMap((r) => [`- ${r.title}: ${r.body}`]),
    '',
    `See the story: ${site}/#story`,
    '',
    "Look for the seal. When you spot it, tap it. When it's yours, you'll know.",
    '',
    'Talk soon,',
    'The Authentic Materials crew',
    '',
    '--',
    "You're getting this because you joined the early-access list at authentic-materials.com.",
    `${SENDER_NAME} · ${MAILING_ADDRESS} · ${CONTACT_EMAIL}`,
    `Unsubscribe anytime: ${unsubscribeUrl}`,
  ].join('\n');

  return {
    subject: WELCOME_SUBJECT,
    html,
    text,
    // RFC 2369 + RFC 8058: mail apps show their own Unsubscribe button and POST to it.
    headers: [
      // URL only: a mailto: unsubscribe would land in a human inbox nobody is obliged to watch.
      { Name: 'List-Unsubscribe', Value: `<${unsubscribeUrl}>` },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
    ],
  };
};
