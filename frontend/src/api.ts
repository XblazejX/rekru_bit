export interface User {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  is_active: boolean;
  notify_on_events: boolean;
  theme: 'dark' | 'light';
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: 'bearer';
  user: User;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const TOKEN_KEY = 'bit2meet.accessToken';

export const tokenStorage = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

function errorMessage(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => (item && typeof item === 'object' && 'msg' in item ? String(item.msg) : ''))
      .filter(Boolean)
      .join('. ');
  }
  return 'Nie udało się wykonać operacji. Spróbuj ponownie.';
}

export async function authRequest<T>(
  endpoint: string,
  body?: unknown,
  authenticated = false,
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const token = authenticated ? tokenStorage.get() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/auth/${endpoint}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Nie można połączyć się z serwerem. Sprawdź, czy aplikacja działa.');
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessage(payload.detail));
  return payload as T;
}

export async function updateProfile<T>(changes: unknown): Promise<T> {
  const token = tokenStorage.get();
  if (!token) throw new Error('Sesja wygasła. Zaloguj się ponownie.');
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/auth/me`, {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(changes),
    });
  } catch {
    throw new Error('Nie można połączyć się z serwerem. Sprawdź, czy aplikacja działa.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessage(payload.detail));
  return payload as T;
}
