import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthModal } from './AuthModal';

const auth = vi.hoisted(() => ({
  logIn: vi.fn(async () => undefined),
  resetPasswordForEmail: vi.fn(async () => undefined),
}));
vi.mock('../lib/auth', () => ({
  GOOGLE_CLIENT_ID: '',
  isGoogleMail: () => false,
  ...auth,
  finishPasswordReset: vi.fn(),
  logInWithGoogle: vi.fn(),
  resendConfirmation: vi.fn(),
  signUp: vi.fn(),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('account email forms', () => {
  it('keeps public sign-up usernames separate from account emails', () => {
    render(<AuthModal onClose={() => undefined} />);
    const username = screen.getByLabelText('Username') as HTMLInputElement;
    expect(username.type).toBe('text');
    expect(username.autocomplete).toBe('username');
  });

  it('signs in with email and never submits a public username', async () => {
    const onClose = vi.fn();
    render(<AuthModal onClose={onClose} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Log in' }));
    const email = screen.getByLabelText('Email address') as HTMLInputElement;
    const submit = screen.getByRole('button', { name: 'Log in' }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.change(email, { target: { value: 'RidgeRunner' } });
    expect(submit.disabled).toBe(true);
    expect(auth.logIn).not.toHaveBeenCalled();
    fireEvent.change(email, { target: { value: 'ridge@example.com' } });
    fireEvent.click(submit);
    await waitFor(() => expect(auth.logIn).toHaveBeenCalledWith('ridge@example.com', 'password123'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('sends password reset to the supplied email without accepting a username', async () => {
    render(<AuthModal onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Log in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    const email = screen.getByLabelText('Email address');
    const submit = screen.getByRole('button', { name: 'Email me a reset link' }) as HTMLButtonElement;
    fireEvent.change(email, { target: { value: 'RidgeRunner' } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(email, { target: { value: 'ridge@example.com' } });
    fireEvent.click(submit);
    await waitFor(() => expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('ridge@example.com'));
  });
});
