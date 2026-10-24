/**
 * Google Identity Services, shared: the sign-in button (accounts.id) and the
 * Google Health token client (accounts.oauth2) load the same script once.
 */

export interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  /** Space-separated scope string the user actually granted. */
  scope?: string;
  error?: string;
  error_description?: string;
}

export interface TokenClient {
  requestAccessToken(overrides?: { prompt?: '' | 'consent' | 'select_account' }): void;
}

export interface GoogleAccounts {
  accounts: {
    id: {
      initialize(config: { client_id: string; callback: (response: { credential: string }) => void }): void;
      renderButton(el: HTMLElement, options: Record<string, unknown>): void;
    };
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback?: (error: { type?: string; message?: string }) => void;
      }): TokenClient;
      revoke(token: string, done?: () => void): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleAccounts;
  }
}

let gisPromise: Promise<GoogleAccounts> | null = null;

/** Load Google Identity Services once, only when a client ID is configured. */
export function loadGis(): Promise<GoogleAccounts> {
  gisPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.defer = true;
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = () => (window.google ? resolve(window.google as GoogleAccounts) : reject(new Error('Google sign-in failed to load.')));
    script.onerror = () => reject(new Error('Google sign-in failed to load.'));
    document.head.appendChild(script);
  });
  gisPromise.catch(() => {
    gisPromise = null;
  });
  return gisPromise;
}
