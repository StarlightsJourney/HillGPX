import { useEffect } from 'react';
import { CONTACT_EMAIL } from '../lib/contribute';
import { ANALYTICS } from '../lib/analytics';
import { ContactForm } from './ContactForm';
import { SiteSearch } from './SearchBar';
import { SiteFooter, SiteHeader } from './SiteChrome';

export type InfoPageId = 'privacy' | 'terms' | 'community' | 'data' | 'contact';

const TABS: { id: InfoPageId; label: string }[] = [
  { id: 'privacy', label: 'Privacy' },
  { id: 'terms', label: 'Contributions and licences' },
  { id: 'community', label: 'How we run and fund it' },
  { id: 'data', label: 'Data and licences' },
  { id: 'contact', label: 'Contact' },
];

function Privacy() {
  return (
    <>
      <h1>Privacy</h1>
      <p className="info-lead">
        hillGPX has no adverts and no tracking cookies. Accounts are optional: you can browse, download and contribute without one.{!ANALYTICS.cloudflare && !ANALYTICS.clarity && ' It does not run analytics.'}
      </p>
      {(ANALYTICS.cloudflare || ANALYTICS.clarity) && (
        <>
          <h2>How we learn what works</h2>
          <ul>
            {ANALYTICS.cloudflare && (
              <li><strong>Visit counts:</strong> Cloudflare Web Analytics counts page views, countries, referring sites and load speed. It sets no cookies and keeps no personal data.</li>
            )}
            {ANALYTICS.clarity && (
              <li><strong>How the site is used:</strong> Microsoft Clarity records clicks, scrolling and anonymised session replays so we can see where people get stuck. Anything you type is masked and it runs without cookies.</li>
            )}
          </ul>
        </>
      )}
      <h2>If you make an account</h2>
      <ul>
        <li><strong>Email sign-up:</strong> your email address, a username and your password, which is stored only as a secure hash.</li>
        <li><strong>Sign in with Google:</strong> Google shares your name, email address and profile picture with us. We use your email to identify your account and suggest a username from it. We never see your Google password, and we cannot access your Gmail, Drive, contacts or anything else in your Google account.</li>
        <li><strong>What it is used for:</strong> signing you in, crediting your contributions to your username, keeping the places and routes you save, and letting you manage or delete what you uploaded. We never sell your data, use it for adverts or share it beyond the services that run the site.</li>
        <li><strong>Where it is kept:</strong> accounts are handled by Supabase Auth. Your email address is never shown publicly; your username and avatar appear next to your contributions.</li>
        <li><strong>Deleting it:</strong> delete your account at any time from your account settings, or ask through the contact page. Your profile, saved items and sign-in details are removed; routes, photos and reviews you published stay up but are no longer linked to your account, unless you delete them first. You can also remove hillGPX's access from your Google account settings.</li>
      </ul>
      <h2>Routes near you</h2>
      <p>If you share your location, it stays in your browser and is used only to find routes near you, or to place a photo or hazard on a route; it is never sent to us. A photo or hazard is pinned to the route point nearest you, not to your exact position. If you do not, we use the country your connection comes from, which Cloudflare (our host) already sees, or your device's time zone. Neither is stored.</p>
      <h2>What stays in your browser</h2>
      <p>Saved places, routes you heart (your Saved routes), GPX files you keep on this device, your unit choice and the name you last contributed under are stored in your browser only. Clearing your browser data removes them.</p>
      <h2>What is stored when you contribute</h2>
      <ul>
        <li><strong>GPX routes:</strong> the track and its elevation. Heart rate, cadence, power and other device data are removed before upload.</li>
        <li><strong>Photos:</strong> re-encoded in your browser before upload, which removes location and camera data.</li>
        <li><strong>Reviews, ratings and reports:</strong> what you write, and the name you give, if any. A route review needs an account. If you post one as anonymous, your name is not shown, but it stays linked to your account privately so you can edit or delete it.</li>
        <li><strong>Contact messages:</strong> what you write in the contact form, and a reply email if you choose to leave one. Only the volunteer moderators see them.</li>
        <li><strong>Automated checks:</strong> usernames, review text, route names, captions and photos are screened by OpenAI's moderation service as you submit them. Anything it flags is refused and not stored. OpenAI does not use this data to train its models.</li>
        <li><strong>Spam protection:</strong> a one-way, salted fingerprint of your network address, used only to limit how often one connection can post. It cannot be turned back into your address and is deleted after a day.</li>
      </ul>
      <p>Contributions are stored with <a href="https://supabase.com" target="_blank" rel="noreferrer">Supabase</a> and are public once published.</p>
      <h2>Services your browser talks to</h2>
      <p>To show the site your browser loads map tiles from OpenFreeMap, terrain from AWS, weather from Open-Meteo, photos from Wikimedia and Mapillary, and fonts from Google Fonts. Each of them sees your network address, as any website you visit does.</p>
      <h2>Removing something</h2>
      <p>To have something you added, or something about you, taken down, use the <a href="#contact">contact page</a>.</p>
    </>
  );
}

function Terms() {
  return (
    <>
      <h1>Terms and disclaimer</h1>
      <p className="info-lead">Everything people add is public, credited and free for others to reuse.</p>
      <h2>Sharing routes and experiences</h2>
      <p>HillGPX is a community platform for sharing routes and experiences from running, hiking and climbing. Its content is for general information. Publishing a route, place, photo or review does not mean that HillGPX has inspected it, verified it or endorsed it as safe or suitable for you. Other people's experiences reflect their own circumstances and may not match yours.</p>
      <h2>Route accuracy and access</h2>
      <p>Routes, maps, descriptions, photos, weather information and GPX files may contain errors, omissions or outdated details. Distance, elevation gain and loss, location and other figures are estimates. GPS recordings and terrain data can be inaccurate, and a route may include an accidental detour or an unsafe crossing.</p>
      <p>A route or place appearing here does not establish a public right of access or permission to enter. Paths, stairs and buildings may be private, restricted, closed or subject to permits and opening hours. Check current access with the relevant landowner or authority, respect private property, and obey local laws, barriers and signs even when a shared track suggests otherwise.</p>
      <h2>Your safety and decisions</h2>
      <p>Please put your personal safety first. You are ultimately responsible for your own actions and decisions, including whether to start, follow, change or abandon a shared route. Running, hiking and climbing carry risks, including serious injury or death. Assess your fitness, experience, health, equipment and the conditions for yourself. Content on HillGPX is not personalised medical advice, professional guiding or a safety assessment.</p>
      <ul>
        <li><strong>Traffic:</strong> stay alert around vehicles, cyclists and road crossings. Use designated crossings where available, obey traffic signals, and keep your attention on your surroundings rather than your screen.</li>
        <li><strong>Terrain:</strong> watch for uneven ground, slippery stairs, steep slopes, exposed edges, loose rocks, water and other hazards. A recorded track is not a reason to cross an obstacle or continue into danger.</li>
        <li><strong>Weather and preparation:</strong> check forecasts and local warnings, carry suitable footwear, water and equipment, and allow for heat, storms, darkness and changing conditions.</li>
        <li><strong>Your limits:</strong> choose activities suited to your ability. Stop or turn back if you feel unwell, uncertain or unsafe, and seek appropriate help when needed.</li>
      </ul>
      <h2>Navigation and emergencies</h2>
      <p>Do not rely on HillGPX or a downloaded GPX file as your only means of navigation. Carry a suitable offline map and a backup, plan how to return, and let someone know your plans when appropriate. Devices, batteries, mobile coverage, GPS and the platform itself can fail. HillGPX does not monitor your location or provide emergency response; contact local emergency services if you need urgent help.</p>
      <h2>Community content and external services</h2>
      <p>Contributors are responsible for what they share. Routes and experiences are not individually checked before publication, and a report or moderation action does not certify the remaining content as accurate or safe. Third-party maps, weather, downloads and linked websites are provided by their respective services and may change or become unavailable. Independently check information that affects your safety.</p>
      <h2>No warranties and limitation of liability</h2>
      <p>To the fullest extent permitted by applicable law, HillGPX and its content are provided "as is" and "as available", without warranties, express or implied, including warranties of accuracy, completeness, availability, fitness for a particular purpose or non-infringement. We do not guarantee that the platform will be uninterrupted, error-free or that any route will be safe, lawful, accessible or suitable.</p>
      <p>To the fullest extent permitted by applicable law, HillGPX's operators, maintainers and contributors disclaim liability for loss, injury or damage arising from use of, inability to use, or reliance on the platform or its content. This includes accidents, property damage, loss of data, financial loss and indirect or consequential loss associated with shared routes, navigation errors, access restrictions, changing conditions, third-party services or other users' conduct.</p>
      <p>Nothing in these terms excludes or limits liability for fraud, fraudulent misrepresentation, death or personal injury caused by negligence, or any other liability that cannot lawfully be excluded or limited. Your statutory rights remain unaffected. These limitations apply only to the extent permitted by the law that applies to you.</p>
      <h2>Licences for what you add</h2>
      <ul>
        <li><strong>GPX routes and reviews:</strong> CC BY 4.0, credited with the name you give.</li>
        <li><strong>Photos:</strong> CC BY-SA 4.0, credited with the name you give.</li>
      </ul>
      <p>Only share what you made or have the right to share. A route that starts at your home shows where you live; trim the start and end before uploading.</p>
      <h2>House rules</h2>
      <ul>
        <li>Be accurate and kind. No adverts, spam or personal details about other people.</li>
        <li>Names, text and photos are screened by automated checks when you submit them; anything flagged is refused and never published.</li>
        <li>Everything else appears straight away. Anyone can report a photo or review; once three different people have reported it, it is hidden until a moderator looks.</li>
      </ul>
      <h2>The code and the data we build on</h2>
      <p>
        The code is open source under the <a href="#data">MIT licence</a>. Map data © OpenStreetMap contributors (ODbL), summits from GeoNames (CC BY 4.0), photos from Wikimedia Commons and Mapillary under their own licences, weather from Open-Meteo (CC BY 4.0). Singapore neighbourhood search contains information from Master Plan 2019 Subzone Boundary (No Sea) accessed on 25 October 2026 from data.gov.sg which is made available under the terms of the Singapore Open Data Licence version 1.0{' '}
        (<a href="https://data.gov.sg/open-data-licence" target="_blank" rel="noreferrer">licence</a>). The full list is on the{' '}
        <a href="#data">data and licences</a> page.
      </p>
    </>
  );
}

function Community() {
  return (
    <>
      <h1>How we run and fund it</h1>
      <p className="info-lead">hillGPX is free to use and owned by the community that builds it. This is the deal, in plain words.</p>
      <h2>Open by default</h2>
      <ul>
        <li><strong>The code</strong> is open source under the MIT licence.</li>
        <li><strong>Routes and reviews</strong> are shared under CC BY 4.0 — free to download and reuse, with credit to the contributor.</li>
        <li><strong>Photos</strong> are shared under CC BY-SA 4.0, CC BY 4.0 or CC0, whichever the contributor picks.</li>
        <li><strong>Map and summit data</strong> come from OpenStreetMap and GeoNames under their own open licences.</li>
      </ul>
      <p>Browsing, downloading and uploading need no account and no payment, and everything contributed can be exported again — the archive never depends on one host.</p>
      <h2>How people contribute</h2>
      <p>Routes, ratings and reviews go live the moment they are sent. Photos appear after a quick volunteer check. The name a contributor gives is shown on everything they share.</p>
      <h2>How quality stays high</h2>
      <ul>
        <li>Duplicate tracks are refused automatically, and every route shows where its elevation numbers came from.</li>
        <li>Volunteer moderators check photos and read every report; anything several people flag is hidden until a moderator looks.</li>
        <li>Names, text and photos are screened by automated checks before they are stored.</li>
      </ul>
      <h2>Who runs it</h2>
      <ul>
        <li><strong>Maintainers</strong> — always at least two, so there is no single point of failure — look after the site.</li>
        <li><strong>Moderators</strong> check photos and answer reports; they come from local running and hiking clubs.</li>
        <li>Decisions are discussed in the open, and anything involving money gets a public discussion before it ships.</li>
      </ul>
      <h2>What it costs</h2>
      <p>hillGPX runs on free tiers today. Storing photos is the first thing likely to cost real money as the archive grows, and usage and spending are published so the community can see them.</p>
      <h2>Paying for it, without selling out</h2>
      <ul>
        <li>The map, downloads and uploads stay free forever.</li>
        <li>Money never changes the data: no paid ranking, no hidden placements, and nobody's data or tracks are sold.</li>
        <li>Anything sponsored is labelled "Sponsored" or "Partner", every time.</li>
        <li>Income and spending are published.</li>
      </ul>
      <p>Donations and grants cover running costs first. Later, clearly labelled income — event listings, partner cards, tools for clubs — can fund maintainer time and moderation.</p>
      <h2>Where it is heading</h2>
      <p>An open archive where every route has a stable link, a downloadable original file, a licence and a credit — free for other apps and mirrors to build on.</p>
    </>
  );
}

function DataSources() {
  return (
    <>
      <h1>Data sources and licences</h1>
      <p className="info-lead">Everything on the map is credited to the people and projects it came from.</p>
      <h2>Where the data comes from</h2>
      <ul>
        <li><strong>Map data</strong> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors (ODbL), served by <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a>.</li>
        <li><strong>Worldwide summits</strong> from <a href="https://www.geonames.org" target="_blank" rel="noreferrer">GeoNames</a> (CC BY 4.0) and OpenStreetMap (ODbL).</li>
        <li><strong>Place summaries</strong> from <a href="https://en.wikipedia.org" target="_blank" rel="noreferrer">Wikipedia</a> (CC BY-SA).</li>
        <li><strong>Photos</strong> from <a href="https://commons.wikimedia.org" target="_blank" rel="noreferrer">Wikimedia Commons</a> and <a href="https://www.mapillary.com" target="_blank" rel="noreferrer">Mapillary</a>, each credited.</li>
        <li><strong>Weather</strong> from <a href="https://open-meteo.com" target="_blank" rel="noreferrer">Open-Meteo</a> (CC BY 4.0).</li>
        <li><strong>Elevation and hillshade</strong> from <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">AWS Terrain Tiles</a>.</li>
        <li><strong>Singapore blocks</strong> from <a href="https://data.gov.sg" target="_blank" rel="noreferrer">data.gov.sg</a>; neighbourhood search contains information from Master Plan 2019 Subzone Boundary (No Sea) accessed on 25 October 2026 from data.gov.sg under the <a href="https://data.gov.sg/open-data-licence" target="_blank" rel="noreferrer">Singapore Open Data Licence 1.0</a>.</li>
      </ul>
      <h2>Licences for what people add</h2>
      <ul>
        <li><strong>GPX routes and reviews:</strong> CC BY 4.0, credited with the name the contributor gives.</li>
        <li><strong>Photos:</strong> CC BY-SA 4.0, CC BY 4.0 or CC0 — the contributor picks at upload.</li>
      </ul>
      <h2>The code</h2>
      <p>hillGPX's code is open source under the MIT licence:</p>
      <pre className="licence-block">{MIT_TEXT}</pre>
    </>
  );
}

const MIT_TEXT = `MIT License

Copyright (c) 2026 hillGPX contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

function Contact() {
  return (
    <>
      <h1>Contact</h1>
      <p className="info-lead">Questions, corrections and removal requests are all welcome — they go straight to the volunteer moderators.</p>
      <ContactForm />
      <ul className="info-contact">
        {CONTACT_EMAIL && (
          <li>
            <strong>Private requests</strong>
            <span>For anything that should not be public.</span>
            <a className="btn btn-light" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </li>
        )}
        <li>
          <strong>Report a mistake on a place or route</strong>
          <span>Every place page and route has a "Report an issue" link, which goes straight to the moderators.</span>
        </li>
      </ul>
    </>
  );
}

/** Privacy, contribution terms and licences, the community and data pages, and contact: one quiet page with five tabs, reached from the footer. */
export function InfoPage({ page }: { page: InfoPageId }) {
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.title = `${TABS.find((tab) => tab.id === page)?.label ?? 'About'} · hillGPX`;
    return () => {
      document.title = 'hillGPX: hills, mountains and GPX routes worldwide';
    };
  }, [page]);
  return (
    <div className="info-page">
      <SiteHeader sticky center={<SiteSearch />} />
      <main className="info-page-body">
        <nav className="info-tabs" aria-label="About hillGPX">
          {TABS.map((tab) => (
            <a key={tab.id} href={`#${tab.id}`} aria-current={tab.id === page ? 'page' : undefined}>
              {tab.label}
            </a>
          ))}
        </nav>
        <article className="info-article">
          {page === 'privacy' ? <Privacy /> : page === 'terms' ? <Terms /> : page === 'community' ? <Community /> : page === 'data' ? <DataSources /> : <Contact />}
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
