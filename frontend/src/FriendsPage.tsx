import { CSSProperties, FormEvent, MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, CalendarDays, Check, ChevronLeft, ChevronRight, LoaderCircle, MailPlus, MessageCircle, Trash2, Users, X } from 'lucide-react';
import { EventItem, eventRequest, socialRequest } from './api';
import { availabilityColor, FRIEND_AVATAR_COLORS } from './scheduleColors';
import './styles/friends.css';

interface Friend {
  id: number;
  first_name: string;
  last_name: string;
}

interface SocialNotification {
  type: 'friend_request' | 'event_invitation';
  id: number;
  created_at: string;
  sender_name: string;
  sender_user_id: number;
  event_public_id: string | null;
  event_title: string | null;
}

interface SharedSlot {
  user_id: number;
  first_name: string;
  last_name: string;
  slot_start: string;
  note: string;
}

interface PersonalSlot {
  slot_start: string;
  note: string;
}

const SLOT_COUNT = 48;
function mondayOf(date: Date): Date {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

function plusDays(date: Date, count: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
}

function dateLabel(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('pl-PL', options).format(date);
}

function slotTime(slot: number): string {
  return `${String(Math.floor(slot / 2)).padStart(2, '0')}:${slot % 2 ? '30' : '00'}`;
}

function slotDate(date: Date, slot: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(slot / 2), slot % 2 ? 30 : 0);
}

function timeForIndex(index: number): string {
  if (index === SLOT_COUNT) return '24:00';
  return `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`;
}

function timeToIndex(value: string, allowEnd = false): number | null {
  const normalized = value.trim().match(/^(\d{1,2})(?::(00|30))?$/);
  if (!normalized) return null;
  const hours = Number(normalized[1]);
  if (allowEnd && hours === 24 && (!normalized[2] || normalized[2] === '00')) return SLOT_COUNT;
  if (hours > 23) return null;
  return hours * 2 + (normalized[2] === '30' ? 1 : 0);
}

function dateRange(start: Date) {
  return {
    start: new Date(start.getFullYear(), start.getMonth(), start.getDate()).toISOString(),
    end: new Date(plusDays(start, 7).getFullYear(), plusDays(start, 7).getMonth(), plusDays(start, 7).getDate()).toISOString(),
  };
}

export default function FriendsPage({
  events,
  currentUserName,
  view,
  onEventAccepted,
}: {
  events: EventItem[];
  currentUserName: string;
  view: 'schedule' | 'people' | 'notifications';
  onEventAccepted: (event: EventItem) => void;
}) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [notifications, setNotifications] = useState<SocialNotification[]>([]);
  const [sharedSlots, setSharedSlots] = useState<SharedSlot[]>([]);
  const [ownSlots, setOwnSlots] = useState<Set<string>>(new Set());
  const [ownNotes, setOwnNotes] = useState<Map<string, string>>(new Map());
  const [highlightedUserId, setHighlightedUserId] = useState<number | null>(null);
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [friendCode, setFriendCode] = useState('');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [blockDialog, setBlockDialog] = useState<{ day: Date; editStart: number | null; editEnd: number | null } | null>(null);
  const [blockStart, setBlockStart] = useState('09:00');
  const [blockEnd, setBlockEnd] = useState('10:00');
  const [blockNote, setBlockNote] = useState('');
  const [hoverNote, setHoverNote] = useState<{ left: number; top: number; range: string; entries: Array<{ name: string; range: string; note: string }> } | null>(null);
  const [now, setNow] = useState(() => new Date());
  const saveTimer = useRef<number | null>(null);
  const pendingNowJump = useRef(false);
  const ownSlotsRef = useRef(ownSlots);
  const ownNotesRef = useRef(ownNotes);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => plusDays(weekStart, index)), [weekStart]);
  const range = useMemo(() => dateRange(weekStart), [weekStart]);
  const rangeRef = useRef(range);
  const availabilityBlocks = useMemo(() => {
    const blocks: Array<{ dayIndex: number; start: number; end: number; participantIds: number[]; count: number }> = [];
    const friendKeys = new Map(friends.map((friend) => [friend.id, new Set(sharedSlots.filter((slot) => slot.user_id === friend.id).map((slot) => new Date(slot.slot_start).toISOString()))]));
    days.forEach((day, dayIndex) => {
      let rangeStart = -1;
      let rangeCount = 0;
      let rangeIds = new Set<number>();
      for (let slot = 0; slot <= SLOT_COUNT; slot += 1) {
        const key = slot < SLOT_COUNT ? slotDate(day, slot).toISOString() : '';
        const activeIds = slot < SLOT_COUNT
          ? friends.filter((friend) => friendKeys.get(friend.id)?.has(key)).map((friend) => friend.id)
          : [];
        if (slot < SLOT_COUNT && ownSlots.has(key)) activeIds.push(-1);
        if (activeIds.length !== rangeCount) {
          if (rangeCount > 0) {
            blocks.push({ dayIndex, start: rangeStart, end: slot, participantIds: [...rangeIds], count: rangeCount });
          }
          rangeStart = activeIds.length ? slot : -1;
          rangeCount = activeIds.length;
          rangeIds = new Set(activeIds);
        } else if (rangeCount > 0) {
          activeIds.forEach((id) => rangeIds.add(id));
        }
      }
    });
    return blocks.map((block) => ({ ...block, participantIds: block.participantIds.sort((first, second) => first - second) }));
  }, [days, friends, ownSlots, sharedSlots]);

  const loadPage = async (showSpinner = true, refreshPersonalSlots = true) => {
    if (showSpinner) setLoading(true);
    const query = `?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`;
    try {
      const [nextFriends, nextNotifications, personalSlots, nextSharedSlots] = await Promise.all([
        socialRequest<Friend[]>('/friends'),
        socialRequest<SocialNotification[]>('/notifications'),
        refreshPersonalSlots ? socialRequest<PersonalSlot[]>(`/availability/me${query}`) : Promise.resolve(null),
        socialRequest<SharedSlot[]>(`/availability${query}`),
      ]);
      setFriends(nextFriends);
      setNotifications(nextNotifications);
      if (personalSlots) {
        setOwnSlots(new Set(personalSlots.map((slot) => new Date(slot.slot_start).toISOString())));
        setOwnNotes(new Map(personalSlots.filter((slot) => slot.note).map((slot) => [new Date(slot.slot_start).toISOString(), slot.note])));
      }
      setSharedSlots(nextSharedSlots);
      setError('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nie udało się wczytać znajomych.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    ownSlotsRef.current = ownSlots;
  }, [ownSlots]);

  useEffect(() => {
    ownNotesRef.current = ownNotes;
  }, [ownNotes]);

  useEffect(() => {
    rangeRef.current = range;
  }, [range]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const scrollToCurrentTime = () => {
    const scroll = document.querySelector<HTMLElement>('.friends-calendar-scroll');
    const slot = now.getHours() * 2 + (now.getMinutes() >= 30 ? 1 : 0);
    const row = scroll?.querySelector<HTMLElement>(`[data-slot-index="${slot}"]`);
    if (!scroll || !row) return;

    const scrollRect = scroll.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const fraction = (now.getMinutes() % 30) / 30;
    const contentY = scroll.scrollTop + rowRect.top - scrollRect.top - scroll.clientTop + rowRect.height * fraction;
    scroll.scrollTo({ top: Math.max(0, contentY - scroll.clientHeight * 0.45), behavior: 'smooth' });
  };

  useEffect(() => {
    if (!pendingNowJump.current || loading) return;
    pendingNowJump.current = false;
    const frame = window.requestAnimationFrame(scrollToCurrentTime);
    return () => window.cancelAnimationFrame(frame);
  }, [weekStart, loading, now]);

  useEffect(() => {
    if (view !== 'schedule' || loading) return;
    const frame = window.requestAnimationFrame(scrollToCurrentTime);
    return () => window.cancelAnimationFrame(frame);
  }, [view, loading]);

  useEffect(() => {
    void loadPage();
    return () => {
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
        void persistSlots(ownSlotsRef.current, ownNotesRef.current, rangeRef.current);
      }
    };
  }, [weekStart]);

  const persistSlots = async (nextSlots: Set<string>, nextNotes = ownNotes, selectedRange = range) => {
    setSaveStatus('Zapisywanie…');
    try {
      await socialRequest<PersonalSlot[]>('/availability/me', 'PUT', {
        ...selectedRange,
        slot_starts: [...nextSlots],
        slot_notes: Object.fromEntries(nextNotes),
      });
      setSaveStatus('Grafik zapisany');
      window.setTimeout(() => setSaveStatus(''), 2200);
    } catch (requestError) {
      setSaveStatus('Nie udało się zapisać grafiku');
      setError(requestError instanceof Error ? requestError.message : 'Nie udało się zapisać grafiku.');
    }
  };

  const openBlockDialog = (date: Date, slot: number) => {
    const key = slotDate(date, slot).toISOString();
    if (ownSlots.has(key)) {
      let start = slot;
      while (start > 0 && ownSlots.has(slotDate(date, start - 1).toISOString())) start -= 1;
      let end = slot + 1;
      while (end < SLOT_COUNT && ownSlots.has(slotDate(date, end).toISOString())) end += 1;
      const today = date.toDateString() === now.toDateString();
      const editableStart = today ? Math.max(start, now.getHours() * 2 + (now.getMinutes() >= 30 ? 1 : 0)) : start;
      setBlockDialog({ day: date, editStart: editableStart, editEnd: end });
      setBlockStart(timeForIndex(editableStart));
      setBlockEnd(end === SLOT_COUNT ? '00:00' : timeForIndex(end));
      setBlockNote(ownNotes.get(key) ?? '');
    } else {
      setBlockDialog({ day: date, editStart: null, editEnd: null });
      setBlockStart(timeForIndex(slot));
      const end = Math.min(SLOT_COUNT, slot + 2);
      setBlockEnd(end === SLOT_COUNT ? '00:00' : timeForIndex(end));
      setBlockNote('');
    }
  };

  const saveBlock = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!blockDialog) return;
    const start = timeToIndex(blockStart);
    const parsedEnd = timeToIndex(blockEnd, true);
    const end = parsedEnd === 0 && start !== null && start > 0 ? SLOT_COUNT : parsedEnd;
    if (start === null || end === null || end <= start) {
      setError('Wpisz prawidłowy zakres, np. 15:00–16:30.');
      return;
    }
    if (Array.from({ length: end - start }, (_, offset) => start + offset)
      .some((slot) => slotDate(blockDialog.day, slot).getTime() < Date.now())) {
      setError('Wybierz termin, który jeszcze się nie rozpoczął.');
      return;
    }
    const nextSlots = new Set(ownSlots);
    const nextNotes = new Map(ownNotes);
    if (blockDialog.editStart !== null && blockDialog.editEnd !== null) {
      for (let slot = blockDialog.editStart; slot < blockDialog.editEnd; slot += 1) {
        const key = slotDate(blockDialog.day, slot).toISOString();
        nextSlots.delete(key);
        nextNotes.delete(key);
      }
    }
    for (let slot = start; slot < end; slot += 1) nextSlots.add(slotDate(blockDialog.day, slot).toISOString());
    let mergedStart = start;
    let mergedEnd = end;
    const today = blockDialog.day.toDateString() === now.toDateString();
    const editableFloor = today ? now.getHours() * 2 + (now.getMinutes() >= 30 ? 1 : 0) : 0;
    while (mergedStart > editableFloor && nextSlots.has(slotDate(blockDialog.day, mergedStart - 1).toISOString())) mergedStart -= 1;
    while (mergedEnd < SLOT_COUNT && nextSlots.has(slotDate(blockDialog.day, mergedEnd).toISOString())) mergedEnd += 1;
    const note = blockNote.trim();
    for (let slot = mergedStart; slot < mergedEnd; slot += 1) {
      const key = slotDate(blockDialog.day, slot).toISOString();
      if (note) nextNotes.set(key, note);
      else nextNotes.delete(key);
    }
    setOwnSlots(nextSlots);
    setOwnNotes(nextNotes);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    setSaveStatus('');
    saveTimer.current = window.setTimeout(() => void persistSlots(nextSlots, nextNotes), 400);
    setBlockDialog(null);
    setError('');
  };

  const deleteBlock = () => {
    if (!blockDialog || blockDialog.editStart === null || blockDialog.editEnd === null) return;
    const nextSlots = new Set(ownSlots);
    const nextNotes = new Map(ownNotes);
    for (let slot = blockDialog.editStart; slot < blockDialog.editEnd; slot += 1) {
      const key = slotDate(blockDialog.day, slot).toISOString();
      nextSlots.delete(key);
      nextNotes.delete(key);
    }
    setOwnSlots(nextSlots);
    setOwnNotes(nextNotes);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void persistSlots(nextSlots, nextNotes), 400);
    setBlockDialog(null);
  };

  const changeWeek = (offset: number) => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      void persistSlots(ownSlots);
    }
    setWeekStart((current) => plusDays(current, offset * 7));
  };

  const jumpToCurrentTime = () => {
    const today = new Date();
    pendingNowJump.current = true;
    if (weekStart.toDateString() !== mondayOf(today).toDateString()) {
      setWeekStart(mondayOf(today));
      return;
    }
    if (!loading) {
      pendingNowJump.current = false;
      window.requestAnimationFrame(scrollToCurrentTime);
    }
  };

  const showNotesForSlot = (event: ReactMouseEvent<HTMLButtonElement>, day: Date, slot: number) => {
    const key = slotDate(day, slot).toISOString();
    const participantIds = [
      ...friends.filter((friend) => sharedSlots.some((entry) => entry.user_id === friend.id && new Date(entry.slot_start).toISOString() === key)).map((friend) => friend.id),
      ...(ownSlots.has(key) ? [-1] : []),
    ];
    if (!participantIds.length) {
      setHoverNote(null);
      return;
    }
    const hasSlot = (userId: number, index: number) => {
      if (index < 0 || index >= SLOT_COUNT) return false;
      const slotKey = slotDate(day, index).toISOString();
      return userId === -1
        ? ownSlots.has(slotKey)
        : sharedSlots.some((entry) => entry.user_id === userId && new Date(entry.slot_start).toISOString() === slotKey);
    };
    const entries = participantIds.map((userId) => {
      let start = slot;
      let end = slot + 1;
      while (hasSlot(userId, start - 1)) start -= 1;
      while (hasSlot(userId, end)) end += 1;
      const availability = userId === -1
        ? null
        : sharedSlots.find((entry) => entry.user_id === userId && new Date(entry.slot_start).toISOString() === key);
      return {
        name: userId === -1 ? currentUserName : `${availability?.first_name ?? ''} ${availability?.last_name ?? ''}`.trim(),
        range: `${timeForIndex(start)}–${timeForIndex(end)}`,
        note: userId === -1 ? ownNotes.get(key) ?? '' : availability?.note ?? '',
      };
    });
    const rect = event.currentTarget.getBoundingClientRect();
    const width = Math.min(260, window.innerWidth - 24);
    const left = rect.right + width + 12 <= window.innerWidth ? rect.right + 8 : Math.max(12, rect.left - width - 8);
    const height = Math.min(150, 58 + entries.length * 48);
    const top = Math.min(window.innerHeight - height - 12, Math.max(12, rect.top));
    setHoverNote({ left, top, range: dateLabel(day, { weekday: 'long', day: 'numeric', month: 'long' }), entries });
  };

  const sendRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await socialRequest<{ message: string }>('/friend-requests', 'POST', { friend_code: friendCode });
      setNotice(response.message);
      setFriendCode('');
      await loadPage(false, false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nie udało się wysłać zaproszenia.');
    } finally {
      setBusy(false);
    }
  };

  const respondToNotification = async (notification: SocialNotification, accepted: boolean) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (notification.type === 'friend_request') {
        const action = accepted ? 'accept' : 'reject';
        await socialRequest(`/friend-requests/${notification.id}/${action}`, 'POST', {});
        setNotice(accepted ? `Dodano ${notification.sender_name} do znajomych.` : 'Odrzucono zaproszenie.');
      } else if (accepted) {
        const joined = await eventRequest<EventItem>(`/invitations/${notification.id}/accept`, 'POST', {});
        onEventAccepted(joined);
        setNotice(`Dołączono do spotkania „${joined.title}”.`);
      } else {
        await eventRequest(`/invitations/${notification.id}/reject`, 'POST', {});
        setNotice('Odrzucono zaproszenie do spotkania.');
      }
      await loadPage(false, false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nie udało się zaktualizować powiadomienia.');
    } finally {
      setBusy(false);
    }
  };

  const removeFriend = async (friend: Friend) => {
    if (!window.confirm(`Usunąć ${friend.first_name} ${friend.last_name} ze znajomych?`)) return;
    setBusy(true);
    try {
      await socialRequest(`/friends/${friend.id}`, 'DELETE');
      setNotice(`${friend.first_name} nie jest już na liście znajomych.`);
      await loadPage(false, false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nie udało się usunąć znajomego.');
    } finally {
      setBusy(false);
    }
  };

  const inviteFriend = async (friend: Friend) => {
    if (!selectedEventId) {
      setError('Najpierw wybierz spotkanie, do którego chcesz zaprosić znajomego.');
      return;
    }
    const event = events.find((item) => item.public_id === selectedEventId);
    if (!event) return;
    setBusy(true);
    setError('');
    try {
      const response = await eventRequest<{ message: string }>(`/${event.public_id}/invitations`, 'POST', { friend_id: friend.id });
      setNotice(response.message);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nie udało się wysłać zaproszenia.');
    } finally {
      setBusy(false);
    }
  };

  const pendingCount = notifications.length;
  const weekLabel = `${dateLabel(days[0], { day: 'numeric', month: 'short' })} – ${dateLabel(days[6], { day: 'numeric', month: 'long', year: 'numeric' })}`;
  const todayIndex = days.findIndex((day) => day.toDateString() === now.toDateString());
  const nowSlot = now.getHours() * 2 + (now.getMinutes() >= 30 ? 1 : 0);
  const nowFraction = (now.getMinutes() % 30) / 30;

  return (
    <main className="friends-page">
      <header className="friends-page-heading">
        <div className="section-icon">{view === 'notifications' ? <Bell size={20} /> : view === 'people' ? <Users size={20} /> : <CalendarDays size={20} />}</div>
        <div><div className="form-kicker">TWÓJ KRĄG</div><h1>{view === 'notifications' ? 'Powiadomienia' : view === 'people' ? 'Znajomi' : 'Grafik znajomych'}</h1><p>{view === 'schedule' ? 'Zaznacz wolny czas blokami. Znajomi zobaczą go w swoim grafiku.' : view === 'people' ? 'Dodawaj znajomych po ich identyfikatorze Bit2Meet.' : 'Tutaj zaakceptujesz zaproszenia do znajomych i wydarzeń.'}</p></div>
      </header>

      {error && <div className="feedback feedback-error" role="alert">{error}</div>}
      {notice && <div className="feedback feedback-success" role="status">{notice}</div>}

      {view === 'notifications' && <section className="dashboard-card friends-card">
        <div className="friends-section-title"><div><h2><Bell size={17} /> Powiadomienia</h2><p>{pendingCount ? `${pendingCount} oczekujących odpowiedzi` : 'Nie masz nowych zaproszeń'}</p></div></div>
        {loading ? <div className="friends-empty"><LoaderCircle className="spin" size={18} /> Wczytywanie…</div>
          : pendingCount === 0 ? <div className="friends-empty">Tutaj pojawią się zaproszenia do znajomych i wydarzeń.</div>
            : <div className="social-notification-list">{notifications.map((notification) => <article className="social-notification" key={`${notification.type}-${notification.id}`}>
              <div><strong>{notification.type === 'friend_request' ? notification.sender_name : notification.event_title}</strong><p>{notification.type === 'friend_request' ? 'chce dodać Cię do znajomych' : `${notification.sender_name} zaprasza Cię do spotkania`}</p></div>
              <div className="social-notification-actions">
                <button className="button button-primary button-small" disabled={busy} onClick={() => void respondToNotification(notification, true)}><Check size={14} /> Akceptuj</button>
                <button className="social-reject-button" disabled={busy} aria-label="Odrzuć zaproszenie" onClick={() => void respondToNotification(notification, false)}><X size={16} /></button>
              </div>
            </article>)}</div>}
      </section>}

      {view === 'people' && <>

      <section className="dashboard-card friends-card">
        <div className="friends-section-title"><div><h2><MailPlus size={17} /> Dodaj znajomego</h2><p>Wpisz identyfikator wyświetlany w profilu, np. #A2B3C4.</p></div></div>
        <form className="friend-request-form" onSubmit={sendRequest}>
          <input type="text" value={friendCode} onChange={(event) => setFriendCode(event.target.value.toUpperCase())} placeholder="#A2B3C4" aria-label="Identyfikator znajomego" maxLength={7} required />
          <button className="button button-primary button-small" disabled={busy || !friendCode.trim()}><MailPlus size={15} /> Wyślij zaproszenie</button>
        </form>
      </section>

      <section className="dashboard-card friends-card">
        <div className="friends-section-title friends-list-heading"><div><h2><Users size={17} /> Znajomi</h2><p>{friends.length ? `${friends.length} zaakceptowanych osób` : 'Zaakceptowane kontakty pojawią się tutaj.'}</p></div>
          {events.length > 0 && friends.length > 0 && <label className="friend-event-picker"><span>Zaproś do</span><select value={selectedEventId} onChange={(event) => setSelectedEventId(event.target.value)}>
            <option value="">Wybierz spotkanie</option>{events.map((event) => <option value={event.public_id} key={event.public_id}>{event.title}</option>)}
          </select></label>}
        </div>
        {loading ? <div className="friends-empty"><LoaderCircle className="spin" size={18} /> Wczytywanie…</div>
          : friends.length === 0 ? <div className="friends-empty">Nie masz jeszcze znajomych. Dodaj kogoś po identyfikatorze.</div>
            : <div className="friend-list">{friends.map((friend, index) => <article className="friend-row" key={friend.id}>
              <span className="friend-avatar" style={{ '--friend-color': FRIEND_AVATAR_COLORS[index % FRIEND_AVATAR_COLORS.length] } as CSSProperties}>{friend.first_name.slice(0, 1)}{friend.last_name.slice(0, 1)}</span>
              <strong>{friend.first_name} {friend.last_name}</strong>
              {events.length > 0 && <button className="friend-invite-button" disabled={busy || !selectedEventId} onClick={() => void inviteFriend(friend)}><MailPlus size={14} /> Zaproś</button>}
              <button className="friend-remove-button" aria-label={`Usuń ${friend.first_name} ze znajomych`} title="Usuń ze znajomych" disabled={busy} onClick={() => void removeFriend(friend)}><Trash2 size={15} /></button>
            </article>)}</div>}
      </section>
      </>}

      {view === 'schedule' && <section className="dashboard-card friends-card">
        <div className="friends-section-title friends-calendar-title"><div><h2><CalendarDays size={17} /> Dostępność znajomych</h2><p>Kliknij pola, aby ustawić swój wolny czas. Zmiany zapisują się automatycznie.</p></div>
          <div className="friends-week-controls"><button aria-label="Poprzedni tydzień" onClick={() => changeWeek(-1)}><ChevronLeft size={17} /></button><strong>{weekLabel}</strong><button aria-label="Następny tydzień" onClick={() => changeWeek(1)}><ChevronRight size={17} /></button><button className="friends-now-button availability-now-button" onClick={jumpToCurrentTime}><span />Teraz</button></div>
        </div>
        <div className="friends-legend" role="group" aria-label="Wyróżnij dostępność osoby">
          <button type="button" className={`friends-legend-person${highlightedUserId === -1 ? ' is-selected' : ''}`} aria-pressed={highlightedUserId === -1} onClick={() => setHighlightedUserId((current) => current === -1 ? null : -1)}><i style={{ background: availabilityColor(100 / (friends.length + 1)) }} /> {currentUserName}</button>
          {friends.map((friend) => <button type="button" className={`friends-legend-person${highlightedUserId === friend.id ? ' is-selected' : ''}`} aria-pressed={highlightedUserId === friend.id} key={friend.id} onClick={() => setHighlightedUserId((current) => current === friend.id ? null : friend.id)}><i style={{ background: availabilityColor(100 / (friends.length + 1)) }} /> {friend.first_name} {friend.last_name}</button>)}
          <small>{saveStatus}</small>
        </div>
        <div className="friends-calendar-scroll">
          {loading ? <div className="friends-empty"><LoaderCircle className="spin" size={18} /> Wczytywanie grafiku…</div> : <div className="friends-calendar-grid">
            <div className="friends-calendar-row friends-calendar-header"><span className="friends-time-heading" />{days.map((day) => <div className="friends-day-heading" key={day.toISOString()}><span>{dateLabel(day, { weekday: 'short' })}</span><strong>{dateLabel(day, { day: 'numeric', month: 'short' })}</strong></div>)}</div>
            {Array.from({ length: SLOT_COUNT }, (_, slot) => <div className="friends-calendar-row" data-slot-index={slot} key={slot}>
              <span className={`friends-time-label${slot % 2 === 0 ? ' hour' : ''}`}>{slot % 2 === 0 ? slotTime(slot) : ''}</span>
              {days.map((day) => {
                const dateKey = slotDate(day, slot).toISOString();
                const own = ownSlots.has(dateKey);
                const slotPeople = friends.filter((friend) => sharedSlots.some((entry) => entry.user_id === friend.id && new Date(entry.slot_start).toISOString() === dateKey));
                const title = [...(ownSlots.has(dateKey) ? [currentUserName] : []), ...slotPeople.map((person) => `${person.first_name} ${person.last_name}`)].join(', ');
                const past = slotDate(day, slot).getTime() < now.getTime();
                return <button className={`friends-calendar-cell${own ? ' is-own' : ''}${past ? ' is-past' : ''}`} type="button" key={dateKey} aria-disabled={past} tabIndex={past ? -1 : 0} aria-label={`${dateLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })} ${slotTime(slot)}${title ? `, ${title}` : ''}${past ? ', termin minął' : ''}`} onMouseEnter={(event) => showNotesForSlot(event, day, slot)} onMouseLeave={() => setHoverNote(null)} onClick={() => { if (!past) openBlockDialog(day, slot); }} />;
              })}
              {todayIndex >= 0 && slot === nowSlot && <div className="friends-now-line" style={{ top: `${nowFraction * 100}%` }} aria-hidden="true"><span><i>{now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', hour12: false })}</i></span></div>}
            </div>)}
            {availabilityBlocks.map((block) => {
              const day = days[block.dayIndex];
              const hasNote = sharedSlots.some((entry) => block.participantIds.includes(entry.user_id) && entry.note && new Date(entry.slot_start).getTime() >= slotDate(day, block.start).getTime() && new Date(entry.slot_start).getTime() < slotDate(day, block.end).getTime())
                || (block.participantIds.includes(-1) && Array.from({ length: block.end - block.start }, (_, offset) => ownNotes.has(slotDate(day, block.start + offset).toISOString())).some(Boolean));
              const percentage = block.count * 100 / (friends.length + 1);
              return <div className="friends-availability-overlay" key={`${block.dayIndex}-${block.start}-${block.count}`} style={{ top: `${42 + block.start * 26}px`, height: `${(block.end - block.start) * 26}px` }}><span style={{ gridColumn: block.dayIndex + 2, background: availabilityColor(percentage) }}>{hasNote && <MessageCircle className="friends-block-note-icon" size={13} />}</span></div>;
            })}
            {highlightedUserId !== null && days.flatMap((day, dayIndex) => {
              const userSlots = highlightedUserId === -1
                ? ownSlots
                : new Set(sharedSlots.filter((entry) => entry.user_id === highlightedUserId).map((entry) => new Date(entry.slot_start).toISOString()));
              const ranges: Array<{ start: number; end: number }> = [];
              let start = -1;
              for (let slot = 0; slot <= SLOT_COUNT; slot += 1) {
                const available = slot < SLOT_COUNT && userSlots.has(slotDate(day, slot).toISOString());
                if (available && start < 0) start = slot;
                if (!available && start >= 0) {
                  ranges.push({ start, end: slot });
                  start = -1;
                }
              }
              return ranges.map((block) => <div className="friends-selected-overlay" aria-hidden="true" key={`${highlightedUserId}-${dayIndex}-${block.start}`} style={{ top: `${42 + block.start * 26}px`, height: `${(block.end - block.start) * 26}px` }}><span style={{ gridColumn: dayIndex + 2 }} /></div>);
            })}
          </div>}
        </div>
      </section>}
      {blockDialog && <div className="availability-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setBlockDialog(null); }}>
        <form className="availability-dialog" role="dialog" aria-modal="true" aria-labelledby="friend-block-title" onSubmit={saveBlock}>
          <div className="availability-dialog-heading"><div><span className="availability-dialog-icon"><CalendarDays size={17} /></span><div><h3 id="friend-block-title">{blockDialog.editStart !== null ? 'Edytuj blok' : 'Dodaj dostępność'}</h3><p>{dateLabel(blockDialog.day, { weekday: 'long', day: 'numeric', month: 'long' })}</p></div></div><button type="button" className="availability-dialog-close" aria-label="Zamknij" onClick={() => setBlockDialog(null)}><X size={18} /></button></div>
          <div className="availability-dialog-fields"><label>Od<input type="time" step={1800} value={blockStart} onChange={(event) => setBlockStart(event.target.value)} /></label><span>—</span><label>Do<input type="time" step={1800} value={blockEnd} onChange={(event) => setBlockEnd(event.target.value)} /></label></div>
          <p className="availability-dialog-hint">Wybierz godzinę i minuty strzałkami. Godzina 00:00 może oznaczać koniec dnia.</p>
          <label className="availability-note-field">Notatka do bloku<textarea maxLength={500} rows={3} value={blockNote} onChange={(event) => setBlockNote(event.target.value)} placeholder="Np. mogę dojechać po pracy" /></label>
          <div className="availability-dialog-actions">{blockDialog.editStart !== null && <button type="button" className="availability-dialog-delete" onClick={deleteBlock}><Trash2 size={15} />Usuń blok</button>}<button type="button" className="button button-secondary button-small" onClick={() => setBlockDialog(null)}>Anuluj</button><button type="submit" className="button button-primary button-small">{blockDialog.editStart !== null ? 'Zmień blok' : 'Dodaj blok'}</button></div>
        </form>
      </div>}
      {hoverNote && <aside className="availability-note-popover" role="tooltip" style={{ left: hoverNote.left, top: hoverNote.top }}><strong>{hoverNote.range}</strong>{hoverNote.entries.map((entry, index) => <div className="availability-note-popover-entry" key={`${entry.name}-${index}`}><span>{entry.name} · {entry.range}</span>{entry.note && <p>{entry.note}</p>}</div>)}</aside>}
    </main>
  );
}
