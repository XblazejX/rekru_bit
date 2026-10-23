import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import type { AuthResponse, User } from '../api';

const sampleUser: User = {
  id: 7,
  first_name: 'Anna',
  last_name: 'Nowak',
  email: 'anna@example.com',
  friend_code: 'A1B2C3',
  is_active: true,
  notify_on_events: true,
  email_on_friend_requests: false,
  theme: 'dark',
  created_at: '2026-10-20T10:00:00Z',
};

const authResponse: AuthResponse = {
  access_token: 'test-access-token',
  token_type: 'bearer',
  user: sampleUser,
};

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.spyOn(global, 'fetch').mockImplementation((input, init) =>
    Promise.resolve(handler(input.toString(), init)),
  );
}

describe('Bit2Meet authentication UI', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    vi.restoreAllMocks();
  });

  it('registers an account, verifies its email and opens the friends schedule', async () => {
    let registrationBody: Record<string, unknown> | undefined;
    let verificationBody: Record<string, unknown> | undefined;
    mockFetch((url, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (url.endsWith('/auth/register')) {
        registrationBody = body;
        return response({ message: 'Kod wysłany.' }, 202);
      }
      if (url.endsWith('/auth/verify')) {
        verificationBody = body;
        return response(authResponse);
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Utwórz konto' }));

    fireEvent.change(screen.getByLabelText('Imię'), { target: { value: 'Anna' } });
    fireEvent.change(screen.getByLabelText('Nazwisko'), { target: { value: 'Nowak' } });
    fireEvent.change(screen.getByLabelText('Adres e-mail'), {
      target: { value: 'ANNA@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Hasło/), { target: { value: 'SilneHaslo123!' } });
    fireEvent.change(screen.getByLabelText('Powtórz hasło'), {
      target: { value: 'SilneHaslo123!' },
    });
    fireEvent.click(screen.getByLabelText('Nie, dziękuję'));
    fireEvent.click(screen.getByRole('button', { name: /utwórz konto/i }));

    expect(await screen.findByRole('heading', { name: 'Sprawdź swoją pocztę' })).toBeInTheDocument();
    expect(registrationBody).toMatchObject({
      first_name: 'Anna',
      last_name: 'Nowak',
      email: 'anna@example.com',
      notify_on_events: false,
    });

    fireEvent.change(screen.getByLabelText('Kod weryfikacyjny'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: /potwierdź adres/i }));

    expect(await screen.findByRole('heading', { name: 'Grafik znajomych' })).toBeInTheDocument();
    expect(verificationBody).toEqual({ email: 'anna@example.com', code: '123456' });
    expect(localStorage.getItem('bit2meet.accessToken')).toBe('test-access-token');
  });

  it('logs in, saves notification preferences and persists theme', async () => {
    const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
    mockFetch((url, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method: init?.method ?? 'GET', body });
      if (url.endsWith('/auth/login')) return response(authResponse);
      if (url.endsWith('/auth/me')) {
        return response({ ...sampleUser, notify_on_events: false, theme: 'light' });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<App />);
    fireEvent.change(screen.getByLabelText('Adres e-mail'), {
      target: { value: 'anna@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Hasło'), { target: { value: 'SilneHaslo123!' } });
    fireEvent.click(screen.getByRole('button', { name: /zaloguj się/i }));

    expect(await screen.findByRole('heading', { name: 'Grafik znajomych' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /wydarzenia/i }));
    expect(await screen.findByRole('heading', { name: 'Wydarzenia' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Profil' }));
    expect(await screen.findByRole('heading', { name: 'Profil i ustawienia' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Grafik' }));
    expect(await screen.findByRole('heading', { name: 'Grafik znajomych' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Profil' }));
    fireEvent.click(screen.getAllByLabelText('Nie')[0]);
    fireEvent.click(screen.getByRole('button', { name: /zapisz preferencje/i }));
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'Przełącz motyw' }));
    await waitFor(() => expect(localStorage.getItem('bit2meet.theme')).toBe('light'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('deletes the account only after submitting the current password', async () => {
    let deleteCall: { method?: string; body?: Record<string, unknown>; authorization?: string } | undefined;
    mockFetch((url, init) => {
      if (url.endsWith('/auth/login')) return response(authResponse);
      if (url.endsWith('/api/events')) return response([]);
      if (url.endsWith('/auth/me') && init?.method === 'DELETE') {
        deleteCall = {
          method: init.method,
          body: JSON.parse(String(init.body)),
          authorization: new Headers(init.headers).get('Authorization') ?? undefined,
        };
        return response({}, 204);
      }
      throw new Error(`Unexpected request: ${url} (${init?.method ?? 'GET'})`);
    });

    render(<App />);
    fireEvent.change(screen.getByLabelText('Adres e-mail'), { target: { value: sampleUser.email } });
    fireEvent.change(screen.getByLabelText('Hasło'), { target: { value: 'SilneHaslo123!' } });
    fireEvent.click(screen.getByRole('button', { name: /zaloguj się/i }));
    expect(await screen.findByRole('heading', { name: 'Grafik znajomych' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Profil' }));

    fireEvent.click(screen.getByRole('button', { name: 'Usuń konto' }));
    fireEvent.change(screen.getByLabelText('Potwierdź hasłem'), { target: { value: 'SilneHaslo123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Trwale usuń konto' }));

    expect(await screen.findByRole('heading', { name: 'Zaloguj się' })).toBeInTheDocument();
    expect(screen.getByText('Konto zostało trwale usunięte.')).toBeInTheDocument();
    expect(deleteCall).toEqual({
      method: 'DELETE',
      body: { password: 'SilneHaslo123!' },
      authorization: 'Bearer test-access-token',
    });
    expect(localStorage.getItem('bit2meet.accessToken')).toBeNull();
  });

  it('requests a reset code and submits matching new passwords', async () => {
    const resetBodies: Array<Record<string, unknown>> = [];
    mockFetch((url, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (url.endsWith('/auth/forgot-password')) return response({ message: 'Jeśli konto istnieje, wysłaliśmy instrukcję resetu hasła.' }, 202);
      if (url.endsWith('/auth/reset-password')) {
        resetBodies.push(body);
        return response({ message: 'Hasło zostało zmienione.' });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /nie pamiętasz hasła/i }));
    fireEvent.change(screen.getByLabelText('Adres e-mail'), {
      target: { value: 'anna@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /wyślij kod/i }));

    expect(await screen.findByRole('heading', { name: 'Zmień hasło' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Kod z wiadomości'), {
      target: { value: '654321' },
    });
    fireEvent.change(screen.getByLabelText(/^Nowe hasło/), {
      target: { value: 'NoweSilneHaslo123!' },
    });
    fireEvent.change(screen.getByLabelText('Powtórz nowe hasło'), {
      target: { value: 'NoweSilneHaslo123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /zapisz nowe hasło/i }));

    expect(await screen.findByRole('heading', { name: 'Zaloguj się' })).toBeInTheDocument();
    expect(resetBodies[0]).toEqual({
      email: 'anna@example.com',
      code: '654321',
      new_password: 'NoweSilneHaslo123!',
      confirm_new_password: 'NoweSilneHaslo123!',
    });
  });
});
