import { useEffect } from 'react';
import { CONTACT_EMAIL, CONTACT_URL, REPO_URL } from '../lib/contribute';
import { ANALYTICS } from '../lib/analytics';
import { SiteSearch } from './SearchBar';
import { SiteFooter, SiteHeader } from './SiteChrome';

export type InfoPageId = 'privacy' | 'terms' | 'contact';

const TABS: { id: InfoPageId; label: string }[] = [
  { id: 'privacy', label: 'Privacy' },
  { id: 'terms', label: 'Contributions and licences' },
  { id: 'contact', label: 'Contact' },
];

function Privacy() {
  return (
    <>
      <h1>Privacy</h1>
      <p className="info-lead">
        hillGPX has no accounts, no adverts and no tracking cookies.{!ANALYTICS.cloudflare && !ANALYTICS.clarity && ' It does not run analytics.'}
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
      <h2>What stays in your browser</h2>
      <p>Saved places, routes you keep on this device, your unit choice and the name you last contributed under are stored in your browser only. Clearing your browser data removes them.</p>
      <h2>What is stored when you contribute</h2>
      <ul>
        <li><strong>GPX routes:</strong> the track and its elevation. Heart rate, cadence, power and other device data are removed before upload.</li>
        <li><strong>Photos:</strong> re-encoded in your browser before upload, which removes location and camera data.</li>
        <li><strong>Reviews, ratings and reports:</strong> what you write, and the name you give, if any.</li>
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
        <li>Everything appears straight away. Anyone can report a photo or review; once three different people have reported it, it is hidden until a moderator looks.</li>
      </ul>
      <h2>The code and the data we build on</h2>
      <p>
        The code is open source under the <a href={`${REPO_URL}/blob/HEAD/LICENSE`} target="_blank" rel="noreferrer">MIT licence</a>. Map data © OpenStreetMap contributors (ODbL), summits from GeoNames (CC BY 4.0), photos from Wikimedia Commons and Mapillary under their own licences, weather from Open-Meteo (CC BY 4.0). The full list is in the{' '}
        <a href={`${REPO_URL}/blob/HEAD/README.md#data-sources-and-licensing`} target="_blank" rel="noreferrer">data sources and licences</a>.
      </p>
    </>
  );
}

function Contact() {
  return (
    <>
      <h1>Contact</h1>
      <p className="info-lead">Questions, corrections and removal requests are all welcome.</p>
      <ul className="info-contact">
        <li>
          <strong>Ask or request a removal</strong>
          <span>Use the public form on GitHub. Do not include private details there; say if you need a private reply.</span>
          <a className="btn btn-dark" href={CONTACT_URL} target="_blank" rel="noreferrer">Open the contact form</a>
        </li>
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

/** Privacy, contribution terms and licences, and contact: one quiet page with three tabs, reached from the footer. */
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
        <article className="info-article">{page === 'privacy' ? <Privacy /> : page === 'terms' ? <Terms /> : <Contact />}</article>
      </main>
      <SiteFooter />
    </div>
  );
}
