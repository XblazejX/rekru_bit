import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  Clock3,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  Moon,
  ShieldCheck,
  Sun,
  UserRound,
} from 'lucide-react';
import { authRequest, AuthResponse, tokenStorage, updateProfile, User } from './api';
import './styles/auth.css';

type Screen = 'login' | 'register' | 'verify' | 'forgot' | 'reset' | 'dashboard';
type Theme = 'dark' | 'light';

const FLOW_KEY = 'bit2meet.authFlow';
const THEME_KEY = 'bit2meet.theme';

function getInitialFlow(): { screen: Screen; email: string } {
  try {
    const value = sessionStorage.getItem(FLOW_KEY);
    if (value) {
      const parsed = JSON.parse(value) as { screen?: Screen; email?: string };
      if ((parsed.screen === 'verify' || parsed.screen === 'reset') && parsed.email) {
        return { screen: parsed.screen, email: parsed.email };
      }
    }
  } catch {
    sessionStorage.removeItem(FLOW_KEY);
  }
  return { screen: 'login', email: '' };
}

function setDocumentTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
}

function getInitialTheme(): Theme {
  return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Coś poszło nie tak. Spróbuj ponownie.';
}

export const App = () => {
  const initialFlow = getInitialFlow();
  const [screen, setScreen] = useState<Screen>(initialFlow.screen);
  const [email, setEmail] = useState(initialFlow.email);
  const [user, setUser] = useState<User | null>(null);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const showScreen = useCallback((next: Screen, nextEmail = email) => {
    setError('');
    setNotice('');
    if (next === 'verify' || next === 'reset') {
      sessionStorage.setItem(FLOW_KEY, JSON.stringify({ screen: next, email: nextEmail }));
    } else {
      sessionStorage.removeItem(FLOW_KEY);
    }
    setEmail(nextEmail);
    setScreen(next);
  }, [email]);

  useEffect(() => {
    setDocumentTheme(theme);
  }, [theme]);

  useEffect(() => {
    const token = tokenStorage.get();
    if (!token) return;
    let cancelled = false;
    authRequest<User>('me', undefined, true)
      .then((profile) => {
        if (cancelled) return;
        setUser(profile);
        setTheme(profile.theme);
        setScreen('dashboard');
      })
      .catch(() => {
        tokenStorage.clear();
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const finishLogin = (response: AuthResponse) => {
    tokenStorage.set(response.access_token);
    sessionStorage.removeItem(FLOW_KEY);
    setUser(response.user);
    setTheme(response.user.theme);
    setDocumentTheme(response.user.theme);
    setError('');
    setNotice('');
    setScreen('dashboard');
  };

  const handleRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const nextEmail = String(data.get('email')).trim().toLowerCase();
    setBusy(true);
    setError('');
    try {
      await authRequest('register', {
        first_name: String(data.get('first_name')).trim(),
        last_name: String(data.get('last_name')).trim(),
        email: nextEmail,
        password: String(data.get('password')),
        confirm_password: String(data.get('confirm_password')),
        notify_on_events: data.get('notify_on_events') === 'yes',
      });
      showScreen('verify', nextEmail);
      setNotice('Wysłaliśmy kod weryfikacyjny na podany adres. Sprawdź też folder spam.');
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const response = await authRequest<AuthResponse>('verify', {
        email,
        code: String(data.get('code')).trim(),
      });
      finishLogin(response);
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setBusy(false);
    }
  };

  const handleResendCode = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await authRequest<{ message: string }>('resend-code', { email });
      setNotice(response.message);
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const response = await authRequest<AuthResponse>('login', {
        email: String(data.get('email')).trim().toLowerCase(),
        password: String(data.get('password')),
      });
      finishLogin(response);
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setBusy(false);
    }
  };

  const handleForgotPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const nextEmail = String(data.get('email')).trim().toLowerCase();
    setBusy(true);
    setError('');
    try {
      const response = await authRequest<{ message: string }>('forgot-password', {
        email: nextEmail,
      });
      showScreen('reset', nextEmail);
      setNotice(response.message + ' Wpisz kod otrzymany w wiadomości.');
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const response = await authRequest<{ message: string }>('reset-password', {
        email,
        code: String(data.get('code')).trim(),
        new_password: String(data.get('new_password')),
        confirm_new_password: String(data.get('confirm_new_password')),
      });
      showScreen('login');
      setNotice(response.message + ' Możesz zalogować się nowym hasłem.');
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setBusy(false);
    }
  };

  const handleThemeToggle = async () => {
    const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    setDocumentTheme(nextTheme);
    if (user) {
      try {
        const updated = await updateProfile<User>({ theme: nextTheme });
        setUser(updated);
      } catch (requestError) {
        setError(errorText(requestError));
      }
    }
  };

  const handlePreferenceSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await updateProfile<User>({
        notify_on_events: data.get('notify_on_events') === 'yes',
      });
      setUser(updated);
      setNotice('Ustawienia zostały zapisane.');
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = () => {
    tokenStorage.clear();
    setUser(null);
    setNotice('');
    setError('');
    showScreen('login');
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Bit2Meet — strona główna">
          <span className="brand-mark"><CalendarDays size={20} strokeWidth={2.2} /></span>
          <span className="brand-name">Bit<span>2</span>Meet</span>
        </a>
        <div className="topbar-actions">
          {user && <span className="topbar-user">{user.first_name}</span>}
          <button className="theme-toggle" onClick={handleThemeToggle} aria-label="Przełącz motyw">
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            <span>{theme === 'dark' ? 'Jasny motyw' : 'Ciemny motyw'}</span>
          </button>
        </div>
      </header>

      {screen === 'dashboard' && user ? (
        <main className="dashboard-page">
          <div className="dashboard-heading">
            <div className="eyebrow"><span className="status-dot" /> KONTO AKTYWNE</div>
            <h1>Cześć, {user.first_name}.</h1>
            <p>Twoje konto Bit2Meet jest gotowe do użycia.</p>
          </div>

          <section className="dashboard-card profile-card">
            <div className="section-heading">
              <div className="section-icon"><UserRound size={19} /></div>
              <div><h2>Twój profil</h2><p>Dane konta i preferencje</p></div>
            </div>
            <div className="profile-details">
              <div><span>Imię i nazwisko</span><strong>{user.first_name} {user.last_name}</strong></div>
              <div><span>Adres e-mail</span><strong>{user.email}</strong></div>
            </div>
            <form className="preference-form" onSubmit={handlePreferenceSave}>
              <div className="preference-row">
                <span className="preference-icon"><Bell size={18} /></span>
                <span className="preference-copy"><strong>Powiadomienia o wydarzeniach</strong><small>Informacje o zmianach i ustalonych terminach</small></span>
                <span className="radio-pair">
                  <label><input type="radio" name="notify_on_events" value="yes" defaultChecked={user.notify_on_events} /> Tak</label>
                  <label><input type="radio" name="notify_on_events" value="no" defaultChecked={!user.notify_on_events} /> Nie</label>
                </span>
              </div>
              <button className="button button-secondary button-small" type="submit" disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
                Zapisz preferencję
              </button>
            </form>
          </section>

          <section className="dashboard-card events-empty">
            <div className="empty-calendar"><CalendarDays size={25} /></div>
            <h2>Twoje wydarzenia pojawią się tutaj</h2>
            <p>Za chwilę dodamy tworzenie wydarzeń i wspólną siatkę dostępności.</p>
          </section>

          {(error || notice) && <Feedback error={error} notice={notice} />}
          <button className="logout-button" onClick={handleLogout}><LogOut size={16} /> Wyloguj się</button>
        </main>
      ) : (
        <main className="auth-page">
          <section className="welcome-panel">
            <div className="welcome-orb orb-one" />
            <div className="welcome-orb orb-two" />
            <div className="welcome-content">
              <div className="welcome-kicker"><span className="kicker-line" /> MNIEJ USTALANIA. WIĘCEJ SPOTKAŃ.</div>
              <h1>Znajdźcie<br />wspólny <span>czas.</span></h1>
              <p>Jedno miejsce, w którym każdy zaznacza swoją dostępność, a najlepszy termin widać od razu.</p>
              <div className="welcome-points">
                <div><span className="point-icon"><Clock3 size={17} /></span><span>Terminy w czytelnej siatce</span></div>
                <div><span className="point-icon"><ShieldCheck size={17} /></span><span>Twoje konto i preferencje</span></div>
              </div>
            </div>
            <div className="welcome-footer">BIT2MEET <span>·</span> KOORDYNATOR TERMINÓW</div>
          </section>

          <section className="auth-panel">
            <div className="auth-card">
              {screen === 'login' && <>
                <div className="form-kicker">WITAMY PONOWNIE</div>
                <h2>Zaloguj się</h2>
                <p className="form-intro">Zaloguj się, aby przejść do swojego konta.</p>
                <Feedback error={error} notice={notice} />
                <form className="auth-form" onSubmit={handleLogin}>
                  <Field label="Adres e-mail" icon={<Mail size={17} />}><input name="email" type="email" autoComplete="email" placeholder="ty@przyklad.pl" required /></Field>
                  <Field label="Hasło" icon={<LockKeyhole size={17} />}><input name="password" type="password" autoComplete="current-password" placeholder="Wpisz hasło" required /></Field>
                  <button className="text-link forgot-link" type="button" onClick={() => showScreen('forgot')}>Nie pamiętasz hasła?</button>
                  <SubmitButton busy={busy}>Zaloguj się <ArrowRight size={17} /></SubmitButton>
                </form>
                <div className="form-switch">Nie masz jeszcze konta? <button className="text-link" onClick={() => showScreen('register')}>Utwórz konto</button></div>
              </>}

              {screen === 'register' && <>
                <button className="back-link" onClick={() => showScreen('login')}><ArrowLeft size={16} /> Wróć do logowania</button>
                <div className="form-kicker">DOŁĄCZ DO BIT2MEET</div>
                <h2>Utwórz konto</h2>
                <p className="form-intro">Zajmie to tylko chwilę.</p>
                <Feedback error={error} notice={notice} />
                <form className="auth-form" onSubmit={handleRegister}>
                  <div className="name-fields">
                    <Field label="Imię"><input name="first_name" autoComplete="given-name" placeholder="Jan" minLength={2} maxLength={50} required /></Field>
                    <Field label="Nazwisko"><input name="last_name" autoComplete="family-name" placeholder="Kowalski" minLength={2} maxLength={50} required /></Field>
                  </div>
                  <Field label="Adres e-mail" icon={<Mail size={17} />}><input name="email" type="email" autoComplete="email" placeholder="ty@przyklad.pl" required /></Field>
                  <Field label="Hasło" icon={<LockKeyhole size={17} />} hint="Minimum 8 znaków"><input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} placeholder="Utwórz hasło" required /></Field>
                  <Field label="Powtórz hasło" icon={<LockKeyhole size={17} />}><input name="confirm_password" type="password" autoComplete="new-password" minLength={8} maxLength={128} placeholder="Wpisz hasło ponownie" required /></Field>
                  <fieldset className="notification-choice">
                    <legend>Maile o wydarzeniach</legend>
                    <p>Czy chcesz otrzymywać powiadomienia e-mail o wydarzeniach?</p>
                    <div className="choice-options">
                      <label><input type="radio" name="notify_on_events" value="yes" defaultChecked required /> Tak, chcę otrzymywać</label>
                      <label><input type="radio" name="notify_on_events" value="no" /> Nie, dziękuję</label>
                    </div>
                  </fieldset>
                  <SubmitButton busy={busy}>Utwórz konto <ArrowRight size={17} /></SubmitButton>
                </form>
                <div className="form-switch">Masz już konto? <button className="text-link" onClick={() => showScreen('login')}>Zaloguj się</button></div>
              </>}

              {screen === 'verify' && <>
                <button className="back-link" onClick={() => showScreen('register')}><ArrowLeft size={16} /> Wróć do rejestracji</button>
                <div className="large-icon"><Mail size={23} /></div>
                <div className="form-kicker">JESZCZE JEDEN KROK</div>
                <h2>Sprawdź swoją pocztę</h2>
                <p className="form-intro">Wysłaliśmy 6-cyfrowy kod na <strong>{email}</strong>. Wpisz go poniżej, aby aktywować konto.</p>
                <Feedback error={error} notice={notice} />
                <form className="auth-form" onSubmit={handleVerify}>
                  <Field label="Kod weryfikacyjny"><input className="code-input" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} placeholder="000000" required /></Field>
                  <SubmitButton busy={busy}>Potwierdź adres <ArrowRight size={17} /></SubmitButton>
                </form>
                <div className="form-switch">Nie dotarł? <button className="text-link" onClick={handleResendCode} disabled={busy}>Wyślij kod ponownie</button></div>
              </>}

              {screen === 'forgot' && <>
                <button className="back-link" onClick={() => showScreen('login')}><ArrowLeft size={16} /> Wróć do logowania</button>
                <div className="large-icon"><LockKeyhole size={23} /></div>
                <div className="form-kicker">ODZYSKIWANIE DOSTĘPU</div>
                <h2>Nie pamiętasz hasła?</h2>
                <p className="form-intro">Podaj adres e-mail powiązany z kontem. Wyślemy na niego kod do zmiany hasła.</p>
                <Feedback error={error} notice={notice} />
                <form className="auth-form" onSubmit={handleForgotPassword}>
                  <Field label="Adres e-mail" icon={<Mail size={17} />}><input name="email" type="email" autoComplete="email" placeholder="ty@przyklad.pl" required /></Field>
                  <SubmitButton busy={busy}>Wyślij kod <ArrowRight size={17} /></SubmitButton>
                </form>
              </>}

              {screen === 'reset' && <>
                <button className="back-link" onClick={() => showScreen('forgot')}><ArrowLeft size={16} /> Zmień adres e-mail</button>
                <div className="large-icon"><LockKeyhole size={23} /></div>
                <div className="form-kicker">USTAW NOWE HASŁO</div>
                <h2>Zmień hasło</h2>
                <p className="form-intro">Wpisz kod wysłany na <strong>{email}</strong> i ustaw nowe hasło.</p>
                <Feedback error={error} notice={notice} />
                <form className="auth-form" onSubmit={handleResetPassword}>
                  <Field label="Kod z wiadomości"><input className="code-input" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} placeholder="000000" required /></Field>
                  <Field label="Nowe hasło" hint="Minimum 8 znaków"><input name="new_password" type="password" autoComplete="new-password" minLength={8} maxLength={128} placeholder="Utwórz nowe hasło" required /></Field>
                  <Field label="Powtórz nowe hasło"><input name="confirm_new_password" type="password" autoComplete="new-password" minLength={8} maxLength={128} placeholder="Wpisz hasło ponownie" required /></Field>
                  <SubmitButton busy={busy}>Zapisz nowe hasło <ArrowRight size={17} /></SubmitButton>
                </form>
              </>}
            </div>
            <div className="auth-footnote"><ShieldCheck size={15} /> Twoje dane są chronione i używane tylko do obsługi konta.</div>
          </section>
        </main>
      )}
    </div>
  );
};

function Field({
  label,
  icon,
  hint,
  children,
}: {
  label: string;
  icon?: ReactNode;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-heading"><span>{label}</span>{hint && <small>{hint}</small>}</span>
      <span className={`input-wrap${icon ? ' has-icon' : ''}`}>{icon}{children}</span>
    </label>
  );
}

function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button className="button button-primary submit-button" type="submit" disabled={busy}>
      {busy ? <><LoaderCircle className="spin" size={17} /> Chwilka...</> : children}
    </button>
  );
}

function Feedback({ error, notice }: { error: string; notice: string }) {
  if (!error && !notice) return null;
  return <div className={`feedback ${error ? 'feedback-error' : 'feedback-success'}`} role={error ? 'alert' : 'status'}>{error || notice}</div>;
}

export default App;
