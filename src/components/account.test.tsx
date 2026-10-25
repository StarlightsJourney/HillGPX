import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { ApiError } from '../lib/api';
import type { AuthUser } from '../lib/auth';

const USER: AuthUser = {
  id: 'u1',
  username: 'ridge_runner',
  email: 'ridge@example.com',
  providers: ['google'],
  avatarUrl: null,
  createdAt: '2026-03-02T00:00:00Z',
};

const auth = vi.hoisted(() => ({
  changeUsername: vi.fn(),
  deleteAccount: vi.fn(),
  logOut: vi.fn(),
  removeAvatar: vi.fn(),
  uploadAvatar: vi.fn(),
  changePassword: vi.fn(),
  deleteMyRoute: vi.fn(),
}));
vi.mock('../lib/auth', () => ({ ...auth, useAuthUser: () => USER }));
vi.mock('../lib/myRoutes', () => ({
  useMyRoutes: () => ({ routes: [{ slug: 'r1', name: 'Southern Ridges' }], error: null, reload: vi.fn() }),
  forgetMyRoute: vi.fn(),
}));
const mapIntent = vi.hoisted(() => ({ openMapWith: vi.fn() }));
vi.mock('../lib/mapIntent', () => mapIntent);
vi.mock('../lib/savedDetails', () => ({
  nameFromSlug: (slug: string) => slug,
  useSavedDetails: () => ({
    ready: true,
    routes: new Map([['southern-ridges', { slug: 'southern-ridges', name: 'Southern Ridges', distanceM: 10000, gainM: 300 }]]),
    places: new Map([['bukit-timah', { slug: 'bukit-timah', name: 'Bukit Timah Hill', type: 'hill', summitM: 164, gainM: null }]]),
  }),
}));

import { AccountMenu } from './AccountMenu';
import { AccountSaved } from './AccountSaved';
import { DeleteAccountDialog, isDeleteConfirmed } from './DeleteAccountDialog';
import { HeaderControls } from './HeaderControls';
import { SettingsPreferences } from './SettingsPreferences';
import { SettingsProfile } from './SettingsProfile';
import { UnitsProvider } from './UnitsContext';
import { resetSavedForTests, toggleSavedPlace, toggleSavedRoute } from '../lib/saved';

beforeEach(() => {
  localStorage.clear();
  resetSavedForTests();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('avatar menu keyboard behaviour', () => {
  it('opens onto the first item with Enter, moves with the arrows, and Escape returns to the avatar', () => {
    render(<AccountMenu />);
    const trigger = screen.getByRole('button', { name: 'Account: ridge_runner' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toBe(document.activeElement);

    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(items[1]).toBe(document.activeElement);
    fireEvent.keyDown(items[1], { key: 'ArrowUp' });
    expect(items[0]).toBe(document.activeElement);
    fireEvent.keyDown(items[0], { key: 'End' });
    expect(items[items.length - 1]).toBe(document.activeElement);

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('lists the destinations and puts Log out last', () => {
    render(<AccountMenu />);
    const trigger = screen.getByRole('button', { name: 'Account: ridge_runner' });
    fireEvent.keyDown(trigger, { key: ' ' });
    const names = screen.getAllByRole('menuitem').map((item) => item.textContent ?? '');
    expect(names[0]).toContain('Show my profile');
    expect(names.at(-1)).toContain('Log out');
    expect(screen.getByRole('menuitem', { name: /Settings/ }).getAttribute('href')).toBe('#settings/profile');
    expect(screen.getByRole('menuitem', { name: /Saved/ }).getAttribute('href')).toBe('#account/saved');
  });
});

describe('units stay in sync', () => {
  it('changing the header switch updates Preferences, and the other way round', () => {
    render(
      <UnitsProvider>
        <HeaderControls />
        <SettingsPreferences />
      </UnitsProvider>,
    );
    const metric = screen.getByRole('radio', { name: /Metric/ }) as HTMLInputElement;
    const imperial = screen.getByRole('radio', { name: /Imperial/ }) as HTMLInputElement;
    expect(metric.checked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Switch to feet/ }));
    expect(imperial.checked).toBe(true);
    expect(localStorage.getItem('hillgpx.units')).toBe('imperial');

    fireEvent.click(metric);
    expect(screen.getByRole('button', { name: /Switch to feet/ })).toBeTruthy();
    expect(screen.getByText('Saved')).toBeTruthy();
  });
});

function ProfileHarness() {
  const [draft, setDraft] = useState<string | null>(null);
  return <SettingsProfile user={USER} draft={draft} onDraft={setDraft} />;
}

describe('username validation', () => {
  const field = () => screen.getByLabelText('Username') as HTMLInputElement;
  const save = () => screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;

  it('stays quiet while typing, shows the rule on blur, clears once valid', () => {
    render(<ProfileHarness />);
    expect(save().disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(field(), { target: { value: 'ab' } });
    expect(screen.queryByText('Use at least 3 characters.')).toBeNull();
    expect(screen.getByText('Unsaved changes')).toBeTruthy();

    fireEvent.blur(field());
    expect(screen.getByText('Use at least 3 characters.')).toBeTruthy();
    expect(field().getAttribute('aria-invalid')).toBe('true');

    fireEvent.change(field(), { target: { value: 'abc' } });
    expect(screen.queryByText('Use at least 3 characters.')).toBeNull();
    expect(field().getAttribute('aria-invalid')).toBeNull();
  });

  it('words each rule', () => {
    render(<ProfileHarness />);
    fireEvent.change(field(), { target: { value: 'x'.repeat(25) } });
    fireEvent.blur(field());
    expect(screen.getByText('Use 24 characters or fewer.')).toBeTruthy();
    fireEvent.change(field(), { target: { value: 'no spaces' } });
    expect(screen.getByText('Use only letters, numbers, dots, dashes or underscores.')).toBeTruthy();
  });

  it('shows the counter and the live preview', () => {
    render(<ProfileHarness />);
    fireEvent.change(field(), { target: { value: 'new_name' } });
    expect(screen.getByText('8/24')).toBeTruthy();
    expect(screen.getByText(/by @new_name/)).toBeTruthy();
  });

  it('reports a taken name from the server', async () => {
    auth.changeUsername.mockRejectedValue(new ApiError('That username is taken.', 409));
    render(<ProfileHarness />);
    fireEvent.change(field(), { target: { value: 'taken_one' } });
    fireEvent.click(save());
    expect(await screen.findByText('@taken_one is already taken. Try another.')).toBeTruthy();
  });

  it('confirms a successful rename inline and with a toast', async () => {
    auth.changeUsername.mockResolvedValue(undefined);
    render(<ProfileHarness />);
    fireEvent.change(field(), { target: { value: 'fresh_name' } });
    fireEvent.click(save());
    await waitFor(() => expect(auth.changeUsername).toHaveBeenCalledWith('fresh_name'));
    expect(await screen.findByText('Username updated')).toBeTruthy();
    expect(screen.getByText(/Saved\. Your routes now credit @fresh_name\./)).toBeTruthy();
  });
});

describe('delete account confirmation', () => {
  const deleteButton = () => screen.getByRole('button', { name: 'Delete account' }) as HTMLButtonElement;
  const typeName = (value: string) => fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value } });

  it('matches the username exactly', () => {
    expect(isDeleteConfirmed('ridge_runner', 'ridge_runner')).toBe(true);
    expect(isDeleteConfirmed('Ridge_Runner', 'ridge_runner')).toBe(false);
    expect(isDeleteConfirmed('ridge_runner ', 'ridge_runner')).toBe(false);
    expect(isDeleteConfirmed('', 'ridge_runner')).toBe(false);
  });

  it('keeps Delete disabled until the name matches, and Escape and Cancel close it', () => {
    const onClose = vi.fn();
    render(<DeleteAccountDialog user={USER} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Delete your account?' })).toBeTruthy();
    expect(deleteButton().disabled).toBe(true);
    typeName('ridge');
    expect(deleteButton().disabled).toBe(true);
    typeName('ridge_runner');
    expect(deleteButton().disabled).toBe(false);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('shows Deleting… (and ignores Escape) while running, then confirms', async () => {
    let finish: () => void = () => undefined;
    auth.deleteAccount.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const onClose = vi.fn();
    render(<DeleteAccountDialog user={USER} onClose={onClose} />);
    typeName('ridge_runner');
    fireEvent.click(deleteButton());
    expect(await screen.findByText('Deleting…')).toBeTruthy();
    expect(auth.deleteAccount).toHaveBeenCalledWith('', { stay: true });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => finish());
    expect(await screen.findByText('Account deleted')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to the map' })).toBeTruthy();
  });
});

describe('saved items open on the map', () => {
  it('opens a saved route with the route intent', () => {
    toggleSavedRoute('southern-ridges');
    render(
      <UnitsProvider>
        <AccountSaved tab="routes" />
      </UnitsProvider>,
    );
    expect(screen.getByText('Route · 10.0 km · +300 m')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Southern Ridges on map' }));
    expect(mapIntent.openMapWith).toHaveBeenCalledWith({ kind: 'route', slug: 'southern-ridges' });
  });

  it('opens a saved place with the venue intent', () => {
    toggleSavedPlace('bukit-timah');
    render(
      <UnitsProvider>
        <AccountSaved tab="places" />
      </UnitsProvider>,
    );
    expect(screen.getByText('Place · 164 m')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Bukit Timah Hill on map' }));
    expect(mapIntent.openMapWith).toHaveBeenCalledWith({ kind: 'venue', slug: 'bukit-timah' });
  });

  it('shows the empty state when nothing is saved', () => {
    render(
      <UnitsProvider>
        <AccountSaved tab="routes" />
      </UnitsProvider>,
    );
    expect(screen.getByText('Nothing saved yet. Tap the heart on a route or place on the map to keep it here.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Explore the map' })).toBeTruthy();
  });
});
