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
  MessageCircle,
  Moon,
  Copy,
  Plus,
  Pencil,
  ShieldCheck,
  Sun,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react';
import { authRequest, AuthResponse, deleteAccount, eventRequest, EventItem, socialRequest, tokenStorage, updateProfile, User } from './api';
import AvailabilityGrid from './AvailabilityGrid';
import EventChat from './EventChat';
import FriendsPage from './FriendsPage';
import './styles/auth.css';

type Screen = 'login' | 'register' | 'verify' | 'forgot' | 'reset' | 'dashboard' | 'friends' | 'people' | 'notifications' | 'profile' | 'event';
type Theme = 'dark' | 'light';
interface EventInviteFriend { id: number; first_name: string; last_name: string }

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
  if (sharedEventFromPath()) return { screen: 'event', email: '' };
  return { screen: 'login', email: '' };
}

function setDocumentTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
}

function scrollPageToTop() {
  if (window.scrollY > 0) window.scrollTo(0, 0);
}

function getInitialTheme(): Theme {
  return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Coś poszło nie tak. Spróbuj ponownie.';
}

function sharedEventFromPath(): string | null {
  const match = window.location.pathname.match(/^\/events\/([A-Za-z0-9_-]+)\/?$/);
  return match?.[1] ?? null;
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
  const [events, setEvents] = useState<EventItem[]>([]);
  const [socialUnreadCount, setSocialUnreadCount] = useState(0);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [eventInviteFriends, setEventInviteFriends] = useState<EventInviteFriend[]>([]);
  const [eventFriendsLoading, setEventFriendsLoading] = useState(false);
  const [invitePickerEventId, setInvitePickerEventId] = useState<string | null>(null);
  const [sentEventInvites, setSentEventInvites] = useState<Record<string, number[]>>({});
  const [showFriendCodeEdit, setShowFriendCodeEdit] = useState(false);
  const [showAccountDelete, setShowAccountDelete] = useState(false);
  const [friendCodeDraft, setFriendCodeDraft] = useState('');
  const [sharedEventId, setSharedEventId] = useState(sharedEventFromPath);
  const [sharedEvent, setSharedEvent] = useState<EventItem | null>(null);
  const [sharedEventLoading, setSharedEventLoading] = useState(Boolean(sharedEventId));
  const [isMember, setIsMember] = useState(false);
  const [joinAfterLogin, setJoinAfterLogin] = useState(false);

  const handleMessageCountChange = useCallback((count: number) => {
    setSharedEvent((current) => current ? { ...current, messages_count: count, unread_count: 0 } : current);
    setEvents((current) => current.map((item) => item.public_id === sharedEventId
      ? { ...item, messages_count: count, unread_count: 0 }
      : item));
  }, [sharedEventId]);

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

  const navigateTo = (next: Screen) => {
    if (next !== 'profile') setShowFriendCodeEdit(false);
    window.history.replaceState({}, '', '/');
    scrollPageToTop();
    setSharedEventId(null);
    setSharedEvent(null);
    setSharedEventLoading(false);
    setIsMember(false);
    setJoinAfterLogin(false);
    setError('');
    setNotice('');
    setScreen(next);
  };

  const openEvent = (publicId: string) => {
    window.history.pushState({}, '', `/events/${publicId}`);
    scrollPageToTop();
    setSharedEventId(publicId);
    setSharedEvent(null);
    setSharedEventLoading(true);
    setIsMember(false);
    setError('');
    setNotice('');
    setScreen('event');
  };

  useEffect(() => {
    setDocumentTheme(theme);
  }, [theme]);

  useEffect(() => {
    const syncEventRoute = () => {
      const publicId = sharedEventFromPath();
      if (publicId) {
        scrollPageToTop();
        setSharedEventId(publicId);
        setSharedEvent(null);
        setSharedEventLoading(true);
        setIsMember(false);
        setScreen('event');
      } else if (screen === 'event') {
        scrollPageToTop();
        setSharedEventId(null);
        setSharedEvent(null);
        setSharedEventLoading(false);
        setIsMember(false);
        setScreen(user ? 'dashboard' : 'login');
      }
    };
    window.addEventListener('popstate', syncEventRoute);
    return () => window.removeEventListener('popstate', syncEventRoute);
  }, [screen, user]);

  useEffect(() => {
    const token = tokenStorage.get();
    if (!token) return;
    let cancelled = false;
    authRequest<User>('me', undefined, true)
      .then((profile) => {
        if (cancelled) return;
        setUser(profile);
        setFriendCodeDraft(profile.friend_code);
        setTheme(profile.theme);
        setScreen(sharedEventId ? 'event' : 'friends');
      })
      .catch(() => {
        tokenStorage.clear();
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const refreshEvents = (initial = false) => {
      if (initial) setEventsLoading(true);
      eventRequest<EventItem[]>('', 'GET')
        .then((items) => { if (!cancelled) setEvents(items); })
        .catch((requestError) => { if (!cancelled) setError(errorText(requestError)); })
        .finally(() => { if (!cancelled && initial) setEventsLoading(false); });
    };
    refreshEvents(true);
    const timer = window.setInterval(() => refreshEvents(), 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const refreshNotifications = () => {
      void socialRequest<Array<unknown>>('/notifications')
        .then((items) => { if (!cancelled) setSocialUnreadCount(items.length); })
        .catch(() => { if (!cancelled) setSocialUnreadCount(0); });
    };
    refreshNotifications();
    const timer = window.setInterval(refreshNotifications, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!sharedEventId) return;
    let cancelled = false;
    eventRequest<EventItem>(`/${sharedEventId}`, 'GET', undefined, false)
      .then((event) => { if (!cancelled) setSharedEvent(event); })
      .catch((requestError) => { if (!cancelled) setError(errorText(requestError)); })
      .finally(() => { if (!cancelled) setSharedEventLoading(false); });
    return () => { cancelled = true; };
  }, [sharedEventId]);

  useEffect(() => {
    if (!sharedEventId || !user || joinAfterLogin) return;
    let cancelled = false;
    eventRequest<{ is_member: boolean; is_owner: boolean }>(`/${sharedEventId}/membership`)
      .then((result) => {
        if (!cancelled) {
          setIsMember(result.is_member);
          setSharedEvent((current) => current ? { ...current, is_owner: result.is_owner, is_member: result.is_member } : current);
        }
      })
      .catch((requestError) => { if (!cancelled) setError(errorText(requestError)); });
    return () => { cancelled = true; };
  }, [sharedEventId, user?.id, joinAfterLogin]);

  useEffect(() => {
    if (!joinAfterLogin || !sharedEvent || !user) return;
    setBusy(true);
    eventRequest<EventItem>(`/${sharedEvent.public_id}/join`, 'POST')
      .then((joined) => {
        setSharedEvent(joined);
        setIsMember(true);
        setEvents((current) => current.some((item) => item.id === joined.id)
          ? current.map((item) => item.id === joined.id ? joined : item)
          : [joined, ...current]);
        setNotice('Dołączono do spotkania.');
      })
      .catch((requestError) => setError(errorText(requestError)))
      .finally(() => {
        setJoinAfterLogin(false);
        setBusy(false);
      });
  }, [joinAfterLogin, sharedEvent?.public_id, user?.id]);

  const finishLogin = (response: AuthResponse) => {
    tokenStorage.set(response.access_token);
    sessionStorage.removeItem(FLOW_KEY);
    setUser(response.user);
    setFriendCodeDraft(response.user.friend_code);
    setTheme(response.user.theme);
    setDocumentTheme(response.user.theme);
    setError('');
    setNotice('');
    setScreen(sharedEventId ? 'event' : 'friends');
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
        email_on_friend_requests: data.get('email_on_friend_requests') === 'yes',
      });
      setUser(updated);
      setNotice('Ustawienia zostały zapisane.');
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setBusy(false);
    }
  };

  const handleFriendCodeSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const data = new FormData(event.currentTarget);
      const updated = await updateProfile<User>({
        friend_code: friendCodeDraft.toUpperCase(),
        password: String(data.get('friend_code_password')),
      });
      setUser(updated);
      setFriendCodeDraft(updated.friend_code);
      setShowFriendCodeEdit(false);
      setNotice('Identyfikator znajomego został zmieniony.');
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setBusy(false);
    }
  };

  const toggleEventInvitePicker = async (publicId: string) => {
    if (invitePickerEventId === publicId) {
      setInvitePickerEventId(null);
      return;
    }
    setInvitePickerEventId(publicId);
    setEventFriendsLoading(true);
    setError('');
    try {
      setEventInviteFriends(await socialRequest<EventInviteFriend[]>('/friends'));
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setEventFriendsLoading(false);
    }
  };

  const inviteFriendToEvent = async (publicId: string, friend: EventInviteFriend) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await eventRequest<{ message: string }>(`/${publicId}/invitations`, 'POST', { friend_id: friend.id });
      setSentEventInvites((current) => ({
        ...current,
        [publicId]: [...new Set([...(current[publicId] ?? []), friend.id])],
      }));
      setNotice(response.message);
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setBusy(false);
    }
  };

  const eventInvitePicker = (publicId: string) => invitePickerEventId === publicId && (
    <div className="event-existing-invite-picker">
      <strong>Zaproszeni znajomi</strong>
      {eventFriendsLoading ? <small>Wczytywanie znajomych…</small> : eventInviteFriends.length
        ? <div className="event-invite-options">{eventInviteFriends.map((friend) => {
          const alreadySent = sentEventInvites[publicId]?.includes(friend.id) ?? false;
          return <div className="event-existing-invite-row" key={friend.id}>
            <span>{friend.first_name} {friend.last_name}</span>
            <button className="button button-secondary button-small" type="button" disabled={busy || alreadySent} onClick={() => void inviteFriendToEvent(publicId, friend)}>
              {alreadySent ? 'Zaproszono' : 'Zaproś'}
            </button>
          </div>;
        })}</div>
        : <small>Nie masz jeszcze zaakceptowanych znajomych do zaproszenia.</small>}
    </div>
  );

  const handleAccountDelete = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await deleteAccount(String(data.get('delete_password')));
      tokenStorage.clear();
      setUser(null);
      setEvents([]);
      setShowAccountDelete(false);
      window.history.replaceState({}, '', '/');
      showScreen('login');
      setNotice('Konto zostało trwale usunięte.');
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

  const handleCreateEvent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const created = await eventRequest<EventItem>('', 'POST', {
        title: String(data.get('title')).trim(),
        description: String(data.get('description')).trim() || null,
      });
      setEvents((current) => [created, ...current]);
      setShowEventForm(false);
      setNotice('Wydarzenie zostało utworzone. Możesz teraz zaprosić znajomych lub udostępnić link.');
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setBusy(false);
    }
  };

  const handleJoinEvent = async () => {
    if (!sharedEvent) return;
    if (!user) {
      setJoinAfterLogin(true);
      showScreen('login');
      setNotice('Zaloguj się lub utwórz konto. Po uwierzytelnieniu wrócisz do spotkania.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const joined = await eventRequest<EventItem>(`/${sharedEvent.public_id}/join`, 'POST');
      setSharedEvent(joined);
      setIsMember(true);
      setEvents((current) => current.some((item) => item.id === joined.id)
        ? current.map((item) => item.id === joined.id ? joined : item)
        : [joined, ...current]);
      setNotice('Dołączono do wydarzenia. Możesz teraz uzupełnić swoją dostępność.');
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteEvent = async (target: EventItem | null = sharedEvent) => {
    if (!target || !window.confirm(`Usunąć wydarzenie „${target.title}”? Tej operacji nie można cofnąć.`)) return;
    setBusy(true);
    setError('');
    try {
      await eventRequest<void>(`/${target.public_id}`, 'DELETE');
      setEvents((current) => current.filter((item) => item.id !== target.id));
      if (sharedEvent?.id === target.id) {
        setSharedEvent(null);
        setIsMember(false);
        window.history.replaceState({}, '', '/');
        setScreen('dashboard');
      }
      setNotice('Wydarzenie zostało usunięte.');
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setBusy(false);
    }
  };

  const handleLeaveEvent = async (target: EventItem | null = sharedEvent) => {
    if (!target || !window.confirm(`Opuścić wydarzenie „${target.title}”?`)) return;
    setBusy(true);
    setError('');
    try {
      await eventRequest<void>(`/${target.public_id}/leave`, 'POST');
      setEvents((current) => current.filter((item) => item.id !== target.id));
      if (sharedEvent?.id === target.id) {
        setIsMember(false);
        setSharedEvent((current) => current ? { ...current, is_member: false } : current);
      }
      setNotice('Opuszczono wydarzenie.');
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setBusy(false);
    }
  };

  const handleCopyEventLink = async (publicId: string) => {
    const link = `${window.location.origin}/events/${publicId}`;
    try {
      await navigator.clipboard.writeText(link);
      setNotice('Link do wydarzenia skopiowany.');
      setError('');
    } catch {
      setError(`Skopiuj link do wydarzenia: ${link}`);
      setNotice('');
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Bit2Meet — strona główna">
          <span className="brand-mark"><CalendarDays size={20} strokeWidth={2.2} /></span>
          <span className="brand-name">Bit<span>2</span>Meet</span>
        </a>
        {user && <nav className="main-nav-left" aria-label="Planowanie">
          <button type="button" className={screen === 'friends' ? 'is-active' : ''} onClick={() => navigateTo('friends')}><CalendarDays size={15} /> Grafik</button>
          <button type="button" className={screen === 'dashboard' || screen === 'event' ? 'is-active' : ''} onClick={() => navigateTo('dashboard')}><CalendarDays size={15} /> Wydarzenia</button>
        </nav>}
        {user && <nav className="main-nav-right" aria-label="Konto i znajomi">
          <button type="button" className={screen === 'people' ? 'is-active' : ''} onClick={() => navigateTo('people')}><Users size={15} /> Znajomi</button>
          <button type="button" className={screen === 'notifications' ? 'is-active' : ''} onClick={() => navigateTo('notifications')}><Bell size={15} /> Powiadomienia{socialUnreadCount > 0 && <span className="nav-count">{socialUnreadCount}</span>}</button>
          <button type="button" className={screen === 'profile' ? 'is-active' : ''} onClick={() => navigateTo('profile')}><UserRound size={15} /> Profil</button>
        </nav>}
        <div className="topbar-actions">
          <button className="theme-toggle" onClick={handleThemeToggle} aria-label="Przełącz motyw">
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            <span>{theme === 'dark' ? 'Jasny motyw' : 'Ciemny motyw'}</span>
          </button>
        </div>
      </header>

      {screen === 'dashboard' && user ? (
        <main className="dashboard-page">
          <div className="dashboard-heading-row">
            <div className="dashboard-heading">
              <div className="eyebrow"><span className="status-dot" /> PLANOWANIE SPOTKAŃ</div>
              <h1>Wydarzenia</h1>
              <p>Twórz spotkania i udostępniaj je znajomym.</p>
            </div>
          </div>

          <section className="events-section">
            <div className="events-section-heading">
              <div><div className="form-kicker">PLANOWANIE SPOTKAŃ</div><h2>Twoje wydarzenia</h2></div>
              <button className="button button-primary button-small" onClick={() => setShowEventForm((value) => !value)}>
                {showEventForm ? <ArrowLeft size={15} /> : <Plus size={16} />}{showEventForm ? 'Wróć' : 'Nowe wydarzenie'}
              </button>
            </div>

            {showEventForm && <form className="dashboard-card event-form" onSubmit={handleCreateEvent}>
              <Field label="Nazwa wydarzenia"><input name="title" minLength={3} maxLength={100} placeholder="Np. Spotkanie zespołu" required /></Field>
              <Field label="Opis (opcjonalnie)"><textarea name="description" maxLength={1000} rows={3} placeholder="Dodaj kilka informacji dla uczestników" /></Field>
              <p className="form-help">Po utworzeniu spotkania uczestnicy wybiorą dni i zaznaczą dostępne godziny.</p>
              <button className="button button-primary submit-button" type="submit" disabled={busy}>{busy ? 'Tworzenie…' : 'Utwórz wydarzenie'} <ArrowRight size={16} /></button>
            </form>}

            {eventsLoading ? <div className="dashboard-card events-empty"><LoaderCircle className="spin" size={22} /><p>Ładowanie wydarzeń…</p></div>
              : events.length === 0 ? <div className="dashboard-card events-empty">
                <div className="empty-calendar"><CalendarDays size={25} /></div><h2>Nie masz jeszcze wydarzeń</h2>
                <p>Utwórz wydarzenie i udostępnij link, żeby wspólnie znaleźć dogodny termin.</p>
              </div>
              : <div className="event-list">{events.map((item) => <article className="dashboard-card event-card" key={item.id}>
                <div className="event-card-top"><div><h3><a href={`/events/${item.public_id}`} onClick={(event) => { event.preventDefault(); openEvent(item.public_id); }}>{item.title}</a></h3><p>{item.description || 'Bez opisu'}</p></div>
                  <div className="event-owner-actions">{item.is_owner && <span className="owner-badge">Twórca</span>}
                    {item.is_owner
                      ? <button type="button" className="event-manage-button" aria-label="Usuń wydarzenie" title="Usuń wydarzenie" disabled={busy} onClick={() => void handleDeleteEvent(item)}><Trash2 size={15} /></button>
                      : <button type="button" className="event-manage-button" aria-label="Opuść wydarzenie" title="Opuść wydarzenie" disabled={busy} onClick={() => void handleLeaveEvent(item)}><LogOut size={15} /></button>}
                  </div>
                </div>
                <div className="event-card-bottom"><span><Users size={15} /> {item.participants_count} {item.participants_count === 1 ? 'uczestnik' : 'uczestników'}</span>
                  <span>Wybór dostępności</span>
                  {item.unread_count > 0 && <span className="event-message-count" title={`${item.unread_count} nieprzeczytanych wiadomości`}><MessageCircle size={15} /> {item.unread_count}</span>}
                  {item.is_member && <button className="button button-secondary button-small" type="button" onClick={() => void toggleEventInvitePicker(item.public_id)}><Users size={14} /> Zaproś znajomych</button>}
                  <button className="button button-secondary button-small" onClick={() => handleCopyEventLink(item.public_id)}><Copy size={14} /> Kopiuj link</button>
                </div>
                {eventInvitePicker(item.public_id)}
              </article>)}</div>}
          </section>

          {(error || notice) && <Feedback error={error} notice={notice} />}
          <button className="logout-button" onClick={handleLogout}><LogOut size={16} /> Wyloguj się</button>
        </main>
      ) : screen === 'profile' && user ? (
        <main className="dashboard-page profile-page">
          <div className="dashboard-heading"><div className="form-kicker">KONTO</div><h1>Profil i ustawienia</h1><p>Zarządzaj identyfikatorem i preferencjami.</p></div>
          <section className="dashboard-card profile-card">
            <div className="section-heading"><div className="section-icon"><UserRound size={19} /></div><div><h2>{user.first_name} {user.last_name}</h2><p>{user.email}</p></div></div>
            <div className="profile-details"><div><span>Twój identyfikator</span><strong className="profile-friend-code">#{user.friend_code}</strong><button className="friend-code-edit-trigger" type="button" onClick={() => { setError(''); setShowFriendCodeEdit(true); }}><Pencil size={14} /> Zmień identyfikator</button></div><div><span>Imię i nazwisko</span><strong>{user.first_name} {user.last_name}</strong></div></div>
            {showFriendCodeEdit && <form className="preference-form friend-code-form" onSubmit={handleFriendCodeSave}>
              <label htmlFor="friend-code">Nowy identyfikator</label>
              <div className="friend-code-input"><span>#</span><input id="friend-code" value={friendCodeDraft} onChange={(event) => setFriendCodeDraft(event.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase())} minLength={6} maxLength={6} pattern="[A-Z0-9]{6}" required /></div>
              <small>Dokładnie 6 liter lub cyfr. Identyfikator musi być wolny.</small>
              <Field label="Potwierdź zmianę hasłem"><input name="friend_code_password" type="password" autoComplete="current-password" required /></Field>
              <div className="friend-code-edit-actions"><button className="button button-secondary button-small" type="button" disabled={busy} onClick={() => { setShowFriendCodeEdit(false); setFriendCodeDraft(user.friend_code); }}>Anuluj</button><button className="button button-secondary button-small" type="submit" disabled={busy || friendCodeDraft === user.friend_code}><Check size={16} /> Zapisz identyfikator</button></div>
            </form>}
            <form className="preference-form" onSubmit={handlePreferenceSave}>
              <div className="preference-row"><span className="preference-icon"><Bell size={18} /></span><span className="preference-copy"><strong>E-maile o zaproszeniach do wydarzeń</strong><small>Gdy znajomy zaprosi Cię do wydarzenia</small></span><span className="radio-pair"><label><input type="radio" name="notify_on_events" value="yes" defaultChecked={user.notify_on_events} /> Tak</label><label><input type="radio" name="notify_on_events" value="no" defaultChecked={!user.notify_on_events} /> Nie</label></span></div>
              <div className="preference-row"><span className="preference-icon"><Mail size={18} /></span><span className="preference-copy"><strong>E-maile o zaproszeniach do znajomych</strong><small>Gdy ktoś wyśle Ci zaproszenie do znajomych</small></span><span className="radio-pair"><label><input type="radio" name="email_on_friend_requests" value="yes" defaultChecked={user.email_on_friend_requests} /> Tak</label><label><input type="radio" name="email_on_friend_requests" value="no" defaultChecked={!user.email_on_friend_requests} /> Nie</label></span></div>
              <button className="button button-secondary button-small" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} Zapisz preferencje e-mail</button>
            </form>
            <div className="account-delete-area">
              {!showAccountDelete ? <button className="account-delete-trigger" type="button" onClick={() => { setError(''); setShowAccountDelete(true); }}><Trash2 size={15} /> Usuń konto</button> : <form className="account-delete-form" onSubmit={handleAccountDelete}>
                <h3>Trwale usunąć konto?</h3><p>Twoje konto, dostępność, wiadomości i spotkania, które utworzyłeś, zostaną usunięte. Tej operacji nie można cofnąć.</p><Field label="Potwierdź hasłem"><input name="delete_password" type="password" autoComplete="current-password" required /></Field>
                <div className="account-delete-actions"><button className="button button-secondary button-small" type="button" disabled={busy} onClick={() => setShowAccountDelete(false)}>Anuluj</button><button className="button account-delete-confirm button-small" type="submit" disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />} Trwale usuń konto</button></div>
              </form>}
            </div>
          </section>
          {(error || notice) && <Feedback error={error} notice={notice} />}
          <button className="logout-button" onClick={handleLogout}><LogOut size={16} /> Wyloguj się</button>
        </main>
      ) : ['friends', 'people', 'notifications'].includes(screen) && user ? (
        <FriendsPage
          events={events}
          currentUserName={`${user.first_name} ${user.last_name}`}
          view={screen === 'people' ? 'people' : screen === 'notifications' ? 'notifications' : 'schedule'}
          onEventAccepted={(joined) => setEvents((current) => current.some((item) => item.id === joined.id)
            ? current.map((item) => item.id === joined.id ? joined : item)
            : [joined, ...current])}
        />
      ) : screen === 'event' ? (
        <main className="event-page event-calendar-page">
          <button className="back-link event-back" onClick={() => {
            if (user) {
              navigateTo('dashboard');
            } else showScreen('login');
          }}>
            <ArrowLeft size={16} /> {user ? 'Moje wydarzenia' : 'Przejdź do logowania'}
          </button>
          {sharedEventLoading ? <section className="dashboard-card events-empty"><LoaderCircle className="spin" size={24} /><p>Wczytujemy spotkanie…</p></section>
            : !sharedEvent ? <section className="dashboard-card events-empty">
              <div className="empty-calendar"><CalendarDays size={25} /></div><h2>Nie znaleźliśmy tego spotkania</h2>
              <p>Sprawdź, czy link jest kompletny i spróbuj ponownie.</p>
              {error && <Feedback error={error} notice="" />}
            </section>
            : <>
              <section className="event-overview">
                <div className="event-overview-copy">
                  <h1>{sharedEvent.title}</h1>
                  <p>{sharedEvent.description || 'Organizator nie dodał opisu spotkania.'}</p>
                </div>
                <div className="event-overview-actions">
                  {user && isMember && sharedEvent.is_owner && <button className="button button-secondary button-small" onClick={() => void handleDeleteEvent()} disabled={busy}><Trash2 size={15} /> Usuń wydarzenie</button>}
                  {user && isMember && !sharedEvent.is_owner && <button className="button button-secondary button-small" onClick={() => void handleLeaveEvent()} disabled={busy}><LogOut size={15} /> Opuść wydarzenie</button>}
                  {user && isMember && <button className="button button-secondary button-small" onClick={() => void toggleEventInvitePicker(sharedEvent.public_id)}><Users size={15} /> Zaproś znajomych</button>}
                  {!isMember && <button className="button button-primary" onClick={handleJoinEvent} disabled={busy}>
                    {busy ? 'Dołączanie…' : 'Dołącz do spotkania'} <ArrowRight size={17} />
                  </button>}
                </div>
              </section>
              {eventInvitePicker(sharedEvent.public_id)}
              {(error || notice) && <Feedback error={error} notice={notice} />}
              {user && isMember && <>
                <div className="event-workspace">
                  <AvailabilityGrid publicId={sharedEvent.public_id} currentUserId={user.id} currentUserName={`${user.first_name} ${user.last_name}`} />
                  <EventChat publicId={sharedEvent.public_id} userId={user.id} unreadCount={sharedEvent.unread_count} onCountChange={handleMessageCountChange} />
                </div>
              </>}
            </>}
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
                <p className="form-intro">{sharedEvent
                  ? <>Zaloguj się, aby dołączyć do wydarzenia <strong>{sharedEvent.title}</strong>.</>
                  : 'Zaloguj się, aby przejść do swojego konta.'}</p>
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
                    <legend>E-maile o zaproszeniach do wydarzeń</legend>
                    <p>Czy chcesz otrzymywać e-maile, gdy znajomi zaproszą Cię do wydarzenia?</p>
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
