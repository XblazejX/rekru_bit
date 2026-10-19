import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from '../App';

describe('App Component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders application title and initial layout', async () => {
    // Mock fetch for health endpoints
    vi.spyOn(global, 'fetch').mockImplementation((url: RequestInfo | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/health/db')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'ok', database: 'connected' }),
        } as Response);
      }
      if (urlStr.includes('/api/health')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'ok', app: 'Bit2Meet', environment: 'development' }),
        } as Response);
      }
      return Promise.reject(new Error('Unknown url'));
    });

    render(<App />);

    expect(screen.getByText('Bit2Meet')).toBeInTheDocument();
    expect(screen.getByText('Koordynator terminów (BIT Web)')).toBeInTheDocument();
    expect(screen.getByText('Stan środowiska — Etap 1')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Działa (ok)')).toBeInTheDocument();
      expect(screen.getByText('Aktywne')).toBeInTheDocument();
    });
  });

  it('toggles theme when button is clicked', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok', app: 'Bit2Meet', environment: 'development' }),
    } as Response);

    render(<App />);
    const themeBtn = screen.getByRole('button', { name: /przełącz motyw/i });
    expect(themeBtn).toBeInTheDocument();

    // Default dark theme
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    // Click to toggle to light
    fireEvent.click(themeBtn);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    // Click again to toggle back to dark
    fireEvent.click(themeBtn);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    await waitFor(() => {
      expect(screen.getByText('Działa (ok)')).toBeInTheDocument();
    });
  });

  it('handles API connection error gracefully', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Failed to fetch'));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/błąd połączenia/i)).toBeInTheDocument();
      expect(screen.getByText('Brak odpowiedzi')).toBeInTheDocument();
    });
  });
});
