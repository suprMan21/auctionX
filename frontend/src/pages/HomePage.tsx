import '@authentic-materials/ui/styles.css';
import '@/components/home/home.css';
import {
  AMMark, FactAnywhere, FactCopy, FactMove, FactPrivate, HeroGloves, HeroGuitar, HeroPrint, HeroRibbon,
  IconCheck, IconComment, IconHeart, IconLink, IconLock, IconPlay, IconShare, PieceBall, PieceDrop, PieceGloves,
  PieceGuitar, SceneCreator, SceneGloves, SceneMoment, SceneNope, ScenePass, SceneSeal, SceneSneak, SceneTap,
  SceneVideo, TagSealed, TagSoon,
} from '@/components/home/art';
import { submitEarlyAccess } from '@/components/home/earlyAccess';
import { EarlyAccessForm, type EarlyAccessSubmit } from '@/components/home/EarlyAccessForm';
import { SceneWindow } from '@/components/home/SceneWindow';
import { SealBadge } from '@/components/home/SealBadge';

/**
 * `/`: the story-first public homepage (S-SITE2, canvas Draft 2.4). The item is the hero, the
 * seal is the witness. Brand rules (Notion Brand Voice + Locked "Story-first homepage"):
 *   - say "seal"; no token / NFT / blockchain / chip / security language in headlines;
 *   - titles have no periods; noun-first wording ("Winning game gloves");
 *   - no real people, leagues, teams or marks; platform names as plain text only;
 *   - example screens use a sample seal code (Locked seal_code format), never a serial or UID;
 *   - unreleased seal names never appear (the family shows two wordless "Coming soon" cards).
 * Footer carries Contact only until the legal pages pass counsel (Decisions DB, G4).
 */

export const CONTACT_EMAIL = 'hello@authentic-materials.com';
export const SAMPLE_SEAL_CODE = '7K3Q-9XWD';

const HERO_PIECES = [
  { cls: 'hi1', Art: HeroGuitar, title: 'Farewell-tour guitar', by: 'Sealed by the artist' },
  { cls: 'hi2', Art: HeroPrint, title: 'Signed first print', by: 'Sealed by the painter' },
  { cls: 'hi3', Art: HeroGloves, title: 'Winning game gloves', by: 'Sealed by the captain', seal: true },
] as const;

const RECORD = [
  { Art: SceneMoment, chip: 'The moment', caption: 'The captain buries the winner.' },
  { Art: SceneGloves, chip: 'The item', caption: 'Winning game gloves.' },
  { Art: SceneSeal, chip: 'The story, sealed', caption: 'Sealed on camera. Still in the room.' },
  { Art: SceneTap, chip: 'The proof', caption: 'One tap. It all plays back.' },
] as const;

const TAP_POINTS = [
  { title: 'Genuine seal, or not', body: 'First thing. Every time. No squinting.' },
  { title: 'The moment', body: 'On video, so you see it, not just read about it.' },
  { title: 'Straight from the source', body: 'Who sealed it, in their words, with their links.' },
  { title: 'Who owns it?', body: 'None of your business. Nicely.' },
] as const;

const PIECES = [
  { Art: PieceGloves, title: 'Winning game gloves', body: 'Sealed by the captain, minutes after the horn.' },
  { Art: PieceBall, title: 'Game ball', body: 'Sealed at center court by the player of the game.' },
  { Art: PieceGuitar, title: 'Farewell-tour guitar', body: 'Sealed on stage, right after the encore.' },
  { Art: PieceDrop, title: 'Creator drop', body: 'Sealed live on stream by the creator who made it.' },
] as const;

const FACTS = [
  // Claims held to the BPL-9 claims matrix until S-SEC1 exits clean (Boss, 2026-10-28).
  { Icon: FactCopy, title: 'Built to resist copies', body: 'A fresh one-time code every tap, designed to resist copying.' },
  { Icon: FactMove, title: 'Made to stay put', body: "Designed to break if it's peeled off. A seal that won't read counts as unverified." },
  { Icon: FactAnywhere, title: 'Works wherever it sells', body: 'eBay, Marketplace, a parking-lot meetup. The seal carries the proof.' },
  { Icon: FactPrivate, title: 'Private by default', body: 'Owned on the record, never by name. Past owners too.' },
] as const;

const VOWS = [
  { lead: 'Your legacy, attached.', body: 'Your face, your voice, your moment, on every piece you seal.' },
  { lead: 'No knock-offs on your name.', body: 'Only you can seal as you.' },
  { lead: 'Every next owner meets you first.', body: 'Ten years and five owners later, the tap still starts with you.' },
] as const;

const NAV = [
  { href: '#story', label: 'The story' },
  { href: '#tap', label: 'See a tap' },
  { href: '#share', label: 'Share it' },
  { href: '#creators', label: 'For creators' },
  { href: '#seals', label: 'The seal' },
] as const;

const FOOT_NAV = [
  { href: '#story', label: 'The story' },
  { href: '#tap', label: 'See a tap' },
  { href: '#creators', label: 'For creators' },
] as const;

const EarlyAccessCta = ({ size = 'md' }: { size?: 'md' | 'lg' }) => (
  <a className={`am-btn am-btn--filled${size === 'lg' ? ' am-btn--lg' : ''} state-layer focus-ring`} href="#access">
    Get early access
  </a>
);

export const HomePage = ({ onEarlyAccess = submitEarlyAccess }: { onEarlyAccess?: EarlyAccessSubmit }) => (
  <div className="am-home" data-theme="cinema">
    <a className="skip-link" href="#main">Skip to content</a>

    <header className="nav">
      <div className="wrap navrow">
        <a className="brand focus-ring" href="#top" aria-label="Authentic Materials home">
          <AMMark />
          <span>Authentic Materials</span>
        </a>
        <nav className="links" aria-label="Main">
          {NAV.map((n) => (
            <a key={n.href} className="focus-ring" href={n.href}>{n.label}</a>
          ))}
        </nav>
        <EarlyAccessCta />
      </div>
    </header>

    <main id="main">
      {/* Hero */}
      <section className="hero" id="top">
        <div className="vid" aria-hidden="true"><HeroRibbon /></div>
        <div className="wrap herogrid">
          <div>
            <h1 className="text-display-l">Sealed with<br />a story</h1>
            <p className="lede">Every piece has a moment.</p>
            <div className="ctas">
              <EarlyAccessCta size="lg" />
              <a className="am-btn am-btn--outlined am-btn--lg state-layer focus-ring" href="#story">See the story</a>
            </div>
          </div>
          <div
            className="heroart"
            role="img"
            aria-label="A spread of sealed pieces: a farewell-tour guitar, a signed first print and winning game gloves, each with its genuine seal"
          >
            <div className="hfan">
              {HERO_PIECES.map(({ cls, Art, title, by, ...rest }) => (
                <div key={cls} className={`hitem ${cls}`}>
                  {'seal' in rest && (
                    <span className="hbadge"><SealBadge code={SAMPLE_SEAL_CODE} size="hero" /></span>
                  )}
                  <div className="hvid"><Art /></div>
                  <p className="hcap">{title}</p>
                  <span className="hby">{by}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* The record */}
      <section className="sec" id="story">
        <div className="wrap">
          <p className="kicker">The record</p>
          <h2 className="text-display-s">The moment, the item, the story sealed as proof</h2>
          <ol className="reel" aria-label="The winning game gloves, from the goal to today">
            {RECORD.map(({ Art, chip, caption }, i) => (
              <li key={chip} className="rframe">
                <SceneWindow><Art /></SceneWindow>
                <span className={`am-chip${i === 0 ? ' am-chip--selected' : ''}`}>{chip}</span>
                <p className="rcap">{caption}</p>
              </li>
            ))}
          </ol>
          <p className="reelbig text-headline-s">Proof of the source</p>
          <p className="fine">No app. No account. Just tap.</p>
        </div>
      </section>

      {/* Collectors */}
      <section className="sec alt" id="collectors">
        <div className="wrap collect">
          <div>
            <p className="kicker">For collectors</p>
            <h2 className="text-display-s">Owners change, the story stays for life</h2>
            <p className="sub">
              Sell it, gift it, leave it to your kid. Every new owner gets the moment, the item and the proof. Your
              name? Never on it.
            </p>
            <div className="ctas"><EarlyAccessCta /></div>
          </div>
          <SceneWindow><ScenePass /></SceneWindow>
        </div>
      </section>

      {/* What's in a tap? */}
      <section className="sec" id="tap">
        <div className="wrap demo">
          <div>
            <div className="phone">
              <div
                className="screen"
                role="img"
                aria-label="Example tap page: genuine seal, the moment on video, the item name and story, who sealed it with their links, and private ownership"
              >
                <div className="scrtop"><AMMark /><span>authentic-materials.com</span></div>
                <div className="verdict2">
                  <SealBadge code={SAMPLE_SEAL_CODE} />
                  <div>
                    <strong>Genuine seal</strong>
                    <em className="sealcode">Seal {SAMPLE_SEAL_CODE}</em>
                    <span>Checked just now</span>
                  </div>
                </div>
                <div className="vidwin">
                  <SceneVideo />
                  <div className="vidbar"><IconPlay /><span>The moment</span></div>
                </div>
                <div className="item">
                  <span className="name">The captain's winning game gloves</span>
                  <p className="desc">
                    Game seven, overtime. I wore these for the whole run, and they were on my hands when the winner
                    went in.
                  </p>
                  <p className="meta">Sealed by the captain, on camera</p>
                </div>
                <div className="links2">
                  <span className="lh">From the captain</span>
                  <div className="lrow">
                    {['Instagram', 'TikTok', 'YouTube'].map((p) => (
                      <span key={p} className="lchip"><IconLink />{p}</span>
                    ))}
                  </div>
                </div>
                <div className="owner"><IconLock /><span>Owned. By whom? That's private.</span></div>
                <span className="am-btn am-btn--filled am-btn--mock">This is mine: claim it</span>
              </div>
            </div>
            <p className="fine demofine">Example screen</p>
          </div>
          <div>
            <p className="kicker">See a tap</p>
            <h2 className="text-display-s">What's in a tap?</h2>
            <ul className="points">
              {TAP_POINTS.map((p, i) => (
                <li key={p.title}>
                  <span className="num" aria-hidden="true">{i + 1}</span>
                  <h3 className="text-title-s">{p.title}</h3>
                  <p>{p.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Share it */}
      <section className="sec alt" id="share">
        <div className="wrap share">
          <div>
            <p className="kicker">Share it</p>
            <h2 className="text-display-s">Flex the story</h2>
            <p className="sub">
              Every seal gets its own link: the moment, the seal, the proof. Drop it in the group chat, the feed, the
              listing. Let them be jealous properly.
            </p>
            {/* Illustrative only: the landing build has no share API. */}
            <div className="sharectas" aria-hidden="true">
              <span className="am-btn am-btn--filled am-btn--mock"><IconShare />Share the story</span>
              <span className="am-btn am-btn--outlined am-btn--mock"><IconLink />Copy link</span>
            </div>
          </div>
          <div
            className="post"
            role="img"
            aria-label="Example social post of the sealed gloves, with the genuine seal and the moment on video"
          >
            <div className="posthead"><span className="avatar" /><div><b>@you</b><span>just now</span></div></div>
            <div className="postmedia">
              <SceneVideo />
              <span className="postseal"><SealBadge code={SAMPLE_SEAL_CODE} size="sm" /></span>
            </div>
            <p className="postcap">Got them. Winning game gloves, sealed by the captain himself.</p>
            <div className="postverified"><IconCheck /><span>Genuine seal · {SAMPLE_SEAL_CODE}</span></div>
            <div className="postactions"><IconHeart /><IconComment /><IconShare /></div>
          </div>
        </div>
      </section>

      {/* Pieces worth a story */}
      <section className="sec" id="pieces">
        <div className="wrap">
          <p className="kicker">What gets sealed</p>
          <h2 className="text-display-s">Pieces worth a story</h2>
          <ul className="pieces2">
            {PIECES.map(({ Art, title, body }) => (
              <li key={title}>
                <SceneWindow><Art /></SceneWindow>
                <h3 className="text-title-l">{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Heist */}
      <section className="sec alt" id="heist">
        <div className="wrap">
          <p className="kicker">Sealed means sealed</p>
          <h2 className="text-display-s">The original stays protected</h2>
          <p className="sub">Lift a seal to stick it on a fake and it's designed to break. Nice try.</p>
          <ol className="reel heist2" aria-label="What happens when someone tries to move a seal">
            <li className="rframe">
              <SceneWindow><SceneSneak /></SceneWindow>
              <span className="am-chip am-chip--selected">Sneaky</span>
              <p className="rcap">Lifting the seal off the real thing.</p>
            </li>
            <li className="rframe">
              <SceneWindow><SceneNope /></SceneWindow>
              <span className="am-chip">Nope</span>
              <p className="rcap">Stuck on a fake? It won't read. Busted.</p>
            </li>
          </ol>
        </div>
      </section>

      {/* Why the seal matters */}
      <section className="sec">
        <div className="wrap why">
          <div>
            <p className="kicker">The point</p>
            <h2 className="text-display-s">Why the seal matters</h2>
            <p className="big text-headline-s">
              The receipt proves you bought it. The seal shows where it came from, for whoever owns it next.
            </p>
          </div>
          <ul className="facts">
            {FACTS.map(({ Icon, title, body }) => (
              <li key={title}>
                <Icon />
                <h3 className="text-title-s">{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Creators */}
      <section className="sec alt" id="creators">
        <div className="wrap creator">
          <SceneWindow><SceneCreator /></SceneWindow>
          <div>
            <p className="kicker">For athletes and creators</p>
            <h2 className="text-display-s">Seal the moment</h2>
            <p className="big">
              You made it. You wore it. You won in it. Then it sells, and your part of the story walks out the door.
              Seal it, and it stays.
            </p>
            <ul className="vows">
              {VOWS.map((v) => (
                <li key={v.lead}><IconCheck /><span><b>{v.lead}</b> {v.body}</span></li>
              ))}
            </ul>
            <p className="howline">
              <b>Tap to start. Seal it on camera. Tap to finish.</b>
              <span className="fine">
                One take, two minutes, in the AM app. A quick ID check once, so fans know it's really you.
              </span>
            </p>
            <a className="am-btn am-btn--filled am-btn--lg state-layer focus-ring" href="#access">Join as a creator</a>
          </div>
        </div>
      </section>

      {/* The family */}
      <section className="sec" id="seals">
        <div className="wrap">
          <p className="kicker">The family</p>
          <h2 className="text-display-s">Sealed is first</h2>
          <p className="sub">The creator vouches, on camera, at the moment it's sealed. More ways to vouch are on the way.</p>
          <ul className="seals">
            <li className="glass-1">
              <TagSealed />
              <span className="am-chip am-chip--selected">Now</span>
              <h3 className="text-headline-s">Sealed</h3>
              <p>The creator vouches, on camera.</p>
            </li>
            {[1, 2].map((n) => (
              <li key={n} className="glass-1 soon">
                <TagSoon />
                <span className="soonbar soonbar--h" aria-hidden="true" />
                <span className="soonbar" aria-hidden="true" />
                <span className="soonlabel">Coming soon</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Final CTA */}
      <section className="final" id="access">
        <div className="wrap finalbox">
          <h2 className="text-display-m">Look for the seal</h2>
          <p>Seals are on the way. Get on the list and hear it first.</p>
          <EarlyAccessForm onSubmit={onEarlyAccess} />
        </div>
      </section>
    </main>

    <footer className="foot">
      <div className="wrap footrow">
        <span className="brand footbrand"><AMMark /><strong>Sealed with a story</strong></span>
        <nav className="links" aria-label="Footer">
          {FOOT_NAV.map((n) => (
            <a key={n.href} className="focus-ring" href={n.href}>{n.label}</a>
          ))}
        </nav>
      </div>
      <div className="wrap">
        <nav className="footlegal" aria-label="Contact">
          <a className="focus-ring" href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
        </nav>
        <p className="copy">© {new Date().getFullYear()} The Craving Company Inc.</p>
      </div>
    </footer>
  </div>
);
