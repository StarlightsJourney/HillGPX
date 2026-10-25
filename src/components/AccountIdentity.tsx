import { useMemo } from 'react';
import { accountHref, type AccountView } from '../lib/accountRoute';
import type { AuthUser, MyUpload } from '../lib/auth';
import { openImportHere } from '../lib/contribute';
import { useSavedPlaces, useSavedRoutes } from '../lib/saved';
import { ContourArt } from './AccountParts';
import { Avatar } from './Avatar';
import { useUnits } from './UnitsContext';
import { ChartIcon, ChevronRightIcon, GearIcon, HeartIcon, PencilIcon, RouteLineIcon, UploadIcon } from './icons';

function memberSince(createdAt: string): string | null {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** Totals across a user's published routes. */
export function routeTotals(routes: MyUpload[]) {
  return {
    count: routes.length,
    downloads: routes.reduce((sum, route) => sum + route.downloads, 0),
    gainM: routes.reduce((sum, route) => sum + route.gainM, 0),
  };
}

/**
 * The fixed left card: who you are, three numbers, the four places to go and
 * the one primary action. Settings and the photo editor open from here too.
 */
export function AccountIdentity({ user, routes, view }: { user: AuthUser; routes: MyUpload[] | null; view: AccountView }) {
  const units = useUnits();
  const savedCount = useSavedRoutes().size + useSavedPlaces().size;
  const totals = useMemo(() => (routes ? routeTotals(routes) : null), [routes]);
  const since = memberSince(user.createdAt);

  const stat = (value: string | null) => value ?? <span className="ac-skel ac-skel-stat" aria-hidden="true" />;

  const nav: { id: AccountView; label: string; href: string; count: number | null; icon: JSX.Element }[] = [
    { id: 'routes', label: 'Your routes', href: accountHref.routes, count: routes ? routes.length : null, icon: <RouteLineIcon /> },
    { id: 'stats', label: 'Stats', href: accountHref.stats(), count: null, icon: <ChartIcon size={20} /> },
    { id: 'saved', label: 'Saved', href: accountHref.saved(), count: savedCount, icon: <HeartIcon size={20} /> },
  ];

  return (
    <aside className="ac-identity" aria-label="Your profile">
      <ContourArt className="ac-identity-art" />
      <a className="ac-icon-btn ac-identity-gear" href={accountHref.settings('profile')} aria-label="Settings">
        <GearIcon size={22} />
      </a>
      <div className="ac-avatar">
        <Avatar url={user.avatarUrl} username={user.username} size={92} />
        <a className="ac-avatar-edit" href={accountHref.settings('profile')} aria-label="Change photo">
          <PencilIcon size={16} />
        </a>
      </div>
      <h1 className="ac-name">{user.username}</h1>
      <p className="ac-since">{since ? `Member since ${since}` : 'Member'}</p>

      <dl className="ac-stats">
        <div>
          <dd>{stat(totals ? totals.count.toLocaleString() : null)}</dd>
          <dt>Routes</dt>
        </div>
        <div>
          <dd>{stat(totals ? totals.downloads.toLocaleString() : null)}</dd>
          <dt>Downloads</dt>
        </div>
        <div>
          <dd>{stat(totals ? units.height(totals.gainM) : null)}</dd>
          <dt>Gain</dt>
        </div>
      </dl>

      <nav className="ac-nav" aria-label="Profile">
        {nav.map((item) => (
          <a key={item.id} href={item.href} aria-current={item.id === view ? 'page' : undefined}>
            {item.icon}
            <span className="ac-nav-label">{item.label}</span>
            {item.count !== null && <em>{item.count.toLocaleString()}</em>}
            <ChevronRightIcon size={16} />
          </a>
        ))}
      </nav>

      <a className="ac-primary" href="#import" onClick={openImportHere}>
        <UploadIcon size={18} /> Upload GPX
      </a>
    </aside>
  );
}
