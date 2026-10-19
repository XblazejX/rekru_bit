import React, { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, XCircle, RefreshCw, Moon, Sun, Server, Database, Calendar } from 'lucide-react';

interface ApiHealth {
  status: string;
  app: string;
  environment: string;
}

interface DbHealth {
  status: string;
  database: string;
}

export const App: React.FC = () => {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [apiHealth, setApiHealth] = useState<ApiHealth | null>(null);
  const [dbHealth, setDbHealth] = useState<DbHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
  };

  const checkHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Sprawdzenie API
      const apiRes = await fetch('/api/health');
      if (!apiRes.ok) throw new Error(`Błąd API: status ${apiRes.status}`);
      const apiData = await apiRes.json();
      setApiHealth(apiData);

      // 2. Sprawdzenie Bazy Danych
      try {
        const dbRes = await fetch('/api/health/db');
        if (dbRes.ok) {
          const dbData = await dbRes.json();
          setDbHealth(dbData);
        } else {
          setDbHealth({ status: 'error', database: 'disconnected' });
        }
      } catch {
        setDbHealth({ status: 'error', database: 'disconnected' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Nie można połączyć się z API';
      setError(msg);
      setApiHealth(null);
      setDbHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    checkHealth();
  }, [checkHealth, theme]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Pasek nawigacyjny */}
      <header
        style={{
          borderBottom: '1px solid var(--border)',
          backgroundColor: 'var(--surface)',
          padding: '1rem 2rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-text)',
            }}
          >
            <Calendar size={20} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Bit2Meet</h1>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
              Koordynator terminów (BIT Web)
            </p>
          </div>
        </div>

        <button
          onClick={toggleTheme}
          aria-label="Przełącz motyw"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 1rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--surface-hover)',
            color: 'var(--text)',
            fontSize: '0.875rem',
            transition: 'background-color var(--transition-fast)',
          }}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          <span>{theme === 'dark' ? 'Jasny motyw' : 'Ciemny motyw'}</span>
        </button>
      </header>

      {/* Główna treść */}
      <main
        style={{
          flex: 1,
          maxWidth: '800px',
          width: '100%',
          margin: '0 auto',
          padding: '2.5rem 1.5rem',
        }}
      >
        <section
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '2rem',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '1.5rem',
              flexWrap: 'wrap',
              gap: '1rem',
            }}
          >
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Stan środowiska — Etap 1</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                Weryfikacja komunikacji między serwisami (Frontend ↔ Backend ↔ Baza PostgreSQL).
              </p>
            </div>

            <button
              onClick={checkHealth}
              disabled={loading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.625rem 1.25rem',
                backgroundColor: 'var(--accent)',
                color: 'var(--accent-text)',
                borderRadius: 'var(--radius-md)',
                fontWeight: 600,
                fontSize: '0.875rem',
                opacity: loading ? 0.7 : 1,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              <RefreshCw size={16} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
              <span>{loading ? 'Sprawdzanie...' : 'Odśwież status'}</span>
            </button>
          </div>

          {error && (
            <div
              style={{
                padding: '1rem',
                marginBottom: '1.5rem',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid var(--danger)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--danger)',
                fontSize: '0.875rem',
              }}
            >
              <strong>Błąd połączenia:</strong> {error}
            </div>
          )}

          {/* Karty statusu */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '1rem',
              marginTop: '1rem',
            }}
          >
            {/* Karta API */}
            <div
              style={{
                padding: '1.25rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--bg)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                  <Server size={18} color="var(--accent)" />
                  Backend API (FastAPI)
                </span>
                {apiHealth?.status === 'ok' ? (
                  <CheckCircle2 size={20} color="var(--success)" aria-label="API działa poprawnie" />
                ) : (
                  <XCircle size={20} color="var(--danger)" aria-label="API niedostępne" />
                )}
              </div>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                {apiHealth ? (
                  <>
                    <div>Status: <span style={{ color: 'var(--success)', fontWeight: 600 }}>Działa ({apiHealth.status})</span></div>
                    <div>Aplikacja: {apiHealth.app}</div>
                    <div>Środowisko: {apiHealth.environment}</div>
                  </>
                ) : (
                  <div>Status: <span style={{ color: 'var(--danger)' }}>Brak odpowiedzi</span></div>
                )}
              </div>
            </div>

            {/* Karta Bazy Danych */}
            <div
              style={{
                padding: '1.25rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--bg)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                  <Database size={18} color="var(--accent)" />
                  Baza Danych (PostgreSQL)
                </span>
                {dbHealth?.database === 'connected' ? (
                  <CheckCircle2 size={20} color="var(--success)" aria-label="Baza podłączona" />
                ) : (
                  <XCircle size={20} color="var(--danger)" aria-label="Baza niepodłączona" />
                )}
              </div>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                {dbHealth?.database === 'connected' ? (
                  <div>Połączenie: <span style={{ color: 'var(--success)', fontWeight: 600 }}>Aktywne</span></div>
                ) : (
                  <div>Połączenie: <span style={{ color: 'var(--danger)' }}>Brak połączenia</span></div>
                )}
                <div>Silnik: PostgreSQL 16</div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Stopka */}
      <footer
        style={{
          borderTop: '1px solid var(--border)',
          backgroundColor: 'var(--surface)',
          padding: '1rem',
          textAlign: 'center',
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
        }}
      >
        Bit2Meet &copy; 2026 — Projekt zaliczeniowy BIT Web | Etap 1: Szkielet projektu
      </footer>
    </div>
  );
};

export default App;
