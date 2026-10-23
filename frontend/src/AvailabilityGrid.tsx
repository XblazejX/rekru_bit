import { FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock3, LoaderCircle, MessageCircle, Trash2, X } from 'lucide-react';
import { eventRequest } from './api';
import { availabilityColor } from './scheduleColors';
import './styles/availability.css';

interface AvailabilityAggregate {
  public_id: string;
  total_participants: number;
  slots: Array<{
    slot_start: string;
    available_count: number;
    available_percentage: number;
  }>;
}

interface AvailabilitySlot {
  id: number;
  event_id: number;
  user_id: number;
  slot_start: string;
  note: string;
}

interface AvailabilityNote {
  slot_start: string;
  user_id: number;
  user_name: string;
  note: string;
}

interface AvailabilityParticipant {
  slot_start: string;
  user_id: number;
  user_name: string;
  note: string;
}

const SLOT_COUNT = 48;
const HEADER_HEIGHT = 42;
const ROW_HEIGHT = 26;

function dateInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date: Date, count: number): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + count);
  return result;
}

function mondayOf(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}

function slotKey(date: Date, slotIndex: number): string {
  return new Date(
    date.getFullYear(), date.getMonth(), date.getDate(),
    Math.floor(slotIndex / 2), (slotIndex % 2) * 30,
  ).toISOString();
}

function formatTime(slotIndex: number): string {
  if (slotIndex === SLOT_COUNT) return '24:00';
  return `${String(Math.floor(slotIndex / 2)).padStart(2, '0')}:${slotIndex % 2 ? '30' : '00'}`;
}

function formatDate(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('pl-PL', options).format(date);
}

function isPastSlot(date: Date, slotIndex: number, now: Date): boolean {
  const slotDate = new Date(
    date.getFullYear(), date.getMonth(), date.getDate(),
    Math.floor(slotIndex / 2), (slotIndex % 2) * 30,
  );
  return slotDate.getTime() < now.getTime();
}

function sameSlots(first: Set<string>, second: Set<string>): boolean {
  return first.size === second.size && [...first].every((slot) => second.has(slot));
}

function sameNotes(first: Map<string, string>, second: Map<string, string>): boolean {
  const normalized = (value: Map<string, string>) => new Map(
    [...value].filter(([, note]) => note.trim()).map(([key, note]) => [key, note.trim()]),
  );
  const firstNotes = normalized(first);
  const secondNotes = normalized(second);
  return firstNotes.size === secondNotes.size && [...firstNotes].every(([key, note]) => secondNotes.get(key) === note);
}

function parseSlotTime(value: string, allowEndOfDay = false): number | null {
  if (allowEndOfDay && value === '24:00') return SLOT_COUNT;
  const match = /^(\d{2}):(00|30)$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23) return null;
  return hours * 2 + (minutes === 30 ? 1 : 0);
}

function normalizeHourInput(value: string, allowEndOfDay = false): string | null {
  const match = /^(\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  if (allowEndOfDay && hours === 24) return '24:00';
  if (hours > 23) return null;
  return `${String(hours).padStart(2, '0')}:00`;
}

export default function AvailabilityGrid({ publicId, currentUserId, currentUserName }: { publicId: string; currentUserId: number; currentUserName: string }) {
  const [anchorDate, setAnchorDate] = useState(() => mondayOf(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => dateInputValue(new Date()));
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [savedSlots, setSavedSlots] = useState<Set<string>>(() => new Set());
  const [selectedNotes, setSelectedNotes] = useState<Map<string, string>>(() => new Map());
  const [savedNotes, setSavedNotes] = useState<Map<string, string>>(() => new Map());
  const [noteSlots, setNoteSlots] = useState<AvailabilityNote[]>([]);
  const [participantSlots, setParticipantSlots] = useState<AvailabilityParticipant[]>([]);
  const [highlightedUserId, setHighlightedUserId] = useState<number | null>(null);
  const [aggregate, setAggregate] = useState<AvailabilityAggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [dialogDate, setDialogDate] = useState<Date | null>(null);
  const [dialogStart, setDialogStart] = useState('09:00');
  const [dialogEnd, setDialogEnd] = useState('10:00');
  const [dialogNote, setDialogNote] = useState('');
  const [editingBlock, setEditingBlock] = useState<{ start: number; end: number } | null>(null);
  const [hoverNote, setHoverNote] = useState<{ key: string; left: number; top: number; range: string; notes: Array<{ userName: string; range: string; note: string }> } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const jumpAfterRender = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      eventRequest<AvailabilityAggregate>(`/${publicId}/availability`),
      eventRequest<AvailabilitySlot[]>(`/${publicId}/availability/me`),
      eventRequest<AvailabilityNote[]>(`/${publicId}/availability/notes`),
    ])
      .then(([overview, personal, notes]) => {
        if (cancelled) return;
        const ownSlots = new Set(personal.map((slot) => new Date(slot.slot_start).toISOString()));
        const ownNotes = new Map(personal.filter((slot) => slot.note).map((slot) => [new Date(slot.slot_start).toISOString(), slot.note]));
        setAggregate(overview);
        setNoteSlots(notes);
        setSavedSlots(ownSlots);
        setSelected(ownSlots);
        setSavedNotes(ownNotes);
        setSelectedNotes(ownNotes);
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Nie udało się wczytać dostępności.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [publicId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const dates = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => addDays(mondayOf(anchorDate), index));
  }, [anchorDate]);

  useEffect(() => {
    let cancelled = false;
    const start = mondayOf(anchorDate);
    const end = addDays(start, 7);
    const query = `?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`;
    setParticipantSlots([]);
    eventRequest<AvailabilityParticipant[]>(`/${publicId}/availability/participants${query}`)
      .then((slots) => { if (!cancelled) setParticipantSlots(slots); })
      .catch((requestError) => { if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Nie udało się wczytać dostępności uczestników.'); });
    return () => { cancelled = true; };
  }, [publicId, anchorDate]);

  const aggregateBySlot = useMemo(
    () => new Map((aggregate?.slots ?? []).map((slot) => [new Date(slot.slot_start).toISOString(), slot])),
    [aggregate],
  );
  const schedulePeople = useMemo(() => {
    const people = new Map<number, string>([[currentUserId, currentUserName]]);
    participantSlots.forEach((entry) => people.set(entry.user_id, entry.user_name));
    return [...people].sort(([firstId], [secondId]) => firstId - secondId).map(([id, name]) => ({ id, name }));
  }, [currentUserId, currentUserName, participantSlots]);
  const highlightedBlocks = useMemo(() => {
    if (highlightedUserId === null) return [];
    const userSlots = highlightedUserId === currentUserId
      ? selected
      : new Set(participantSlots.filter((entry) => entry.user_id === highlightedUserId).map((entry) => new Date(entry.slot_start).toISOString()));
    const blocks: Array<{ dateIndex: number; start: number; end: number }> = [];
    dates.forEach((date, dateIndex) => {
      let start = -1;
      for (let slot = 0; slot <= SLOT_COUNT; slot += 1) {
        const available = slot < SLOT_COUNT && userSlots.has(slotKey(date, slot));
        if (available && start < 0) start = slot;
        if (!available && start >= 0) {
          blocks.push({ dateIndex, start, end: slot });
          start = -1;
        }
      }
    });
    return blocks;
  }, [currentUserId, dates, highlightedUserId, participantSlots, selected]);
  const visualBlocks = useMemo(() => {
    const blocks: Array<{ dateIndex: number; start: number; end: number; count?: number; own?: boolean }> = [];
    const noteBlocks: Array<{ dateIndex: number; start: number; end: number; note: string; userId: number; userName: string }> = [];
    const ownRanges = new Map<string, string>();
    const heatRanges = new Map<string, string>();
    const noteRanges = new Map<string, string[]>();
    dates.forEach((date, dateIndex) => {
      let heatStart = -1;
      let heatCount = 0;
      let ownStart = -1;
      for (let slotIndex = 0; slotIndex <= SLOT_COUNT; slotIndex += 1) {
        const key = slotIndex < SLOT_COUNT ? slotKey(date, slotIndex) : '';
        const aggregateSlot = key ? aggregateBySlot.get(key) : undefined;
        const wasSelected = key ? savedSlots.has(key) : false;
        const isSelected = key ? selected.has(key) : false;
        const rawCount = aggregateSlot?.available_count ?? 0;
        const count = slotIndex < SLOT_COUNT
          ? Math.min(aggregate?.total_participants ?? 0, Math.max(0, rawCount + (isSelected && !wasSelected ? 1 : 0) - (!isSelected && wasSelected ? 1 : 0)))
          : 0;

        if (count !== heatCount || count === 0) {
          if (heatStart >= 0) {
            blocks.push({ dateIndex, start: heatStart, end: slotIndex, count: heatCount });
            const range = `${formatTime(heatStart)}–${formatTime(slotIndex)}`;
            for (let index = heatStart; index < slotIndex; index += 1) heatRanges.set(slotKey(date, index), range);
          }
          heatStart = count > 0 ? slotIndex : -1;
          heatCount = count;
        }
        if (isSelected && ownStart < 0) ownStart = slotIndex;
        if (!isSelected && ownStart >= 0) {
          blocks.push({ dateIndex, start: ownStart, end: slotIndex, own: true });
          const range = `${formatTime(ownStart)}–${formatTime(slotIndex)}`;
          for (let index = ownStart; index < slotIndex; index += 1) ownRanges.set(slotKey(date, index), range);
          ownStart = -1;
        }
      }
    });
    dates.forEach((date, dateIndex) => {
      const notesForDate = noteSlots.filter((entry) => dateInputValue(new Date(entry.slot_start)) === dateInputValue(date))
        .map((entry) => ({
          index: new Date(entry.slot_start).getHours() * 2 + (new Date(entry.slot_start).getMinutes() >= 30 ? 1 : 0),
          userId: entry.user_id,
          userName: entry.user_name,
          note: entry.note,
        }))
        .sort((first, second) => first.userId - second.userId || first.index - second.index);
      let group: typeof notesForDate = [];
      const flushNotes = () => {
        if (!group.length) return;
        const first = group[0];
        const last = group[group.length - 1];
        noteBlocks.push({ dateIndex, start: first.index, end: last.index + 1, note: first.note, userId: first.userId, userName: first.userName });
        for (const entry of group) {
          const key = slotKey(date, entry.index);
          noteRanges.set(key, [...(noteRanges.get(key) ?? []), `${entry.userName}: ${entry.note}`]);
        }
        group = [];
      };
      for (const entry of notesForDate) {
        const previous = group[group.length - 1];
        if (previous && (entry.index !== previous.index + 1 || entry.userId !== previous.userId || entry.note !== previous.note)) flushNotes();
        group.push(entry);
      }
      flushNotes();
    });
    return { blocks, ownRanges, heatRanges, noteBlocks, noteRanges };
  }, [aggregate?.total_participants, aggregateBySlot, dates, noteSlots, savedSlots, selected]);

  const showNotePopover = (event: MouseEvent<HTMLButtonElement>, dateIndex: number, slotIndex: number) => {
    const day = dates[dateIndex];
    const hoveredKey = slotKey(day, slotIndex);
    const matches = participantSlots.filter((entry) => new Date(entry.slot_start).toISOString() === hoveredKey)
      .map((entry) => ({ ...entry, note: entry.user_id === currentUserId ? selectedNotes.get(hoveredKey) ?? '' : entry.note }));
    if (selected.has(hoveredKey) && !matches.some((entry) => entry.user_id === currentUserId)) {
      matches.push({ slot_start: hoveredKey, user_id: currentUserId, user_name: currentUserName, note: selectedNotes.get(hoveredKey) ?? '' });
    }
    if (!matches.length) {
      setHoverNote(null);
      return;
    }
    const key = matches.map((entry) => `${entry.user_id}:${entry.slot_start}`).join('|');
    // Read the DOM event synchronously. React may run state updater functions
    // later, when event.currentTarget has already been cleared.
    const cell = event.currentTarget.getBoundingClientRect();
    const anchor = { left: cell.left, right: cell.right, top: cell.top };
    const width = Math.min(260, window.innerWidth - 24);
    const height = Math.min(200, 58 + matches.reduce((total, entry) => total + 27 + (entry.note ? Math.min(42, Math.ceil(entry.note.length / 34)) * 15 : 0), 0));
    const rightPosition = anchor.right + 8;
    const leftPosition = anchor.left - width - 8;
    const centeredPosition = anchor.left + (anchor.right - anchor.left - width) / 2;
    const left = rightPosition + width <= window.innerWidth - 12
      ? rightPosition
      : leftPosition >= 12
        ? leftPosition
        : Math.min(window.innerWidth - width - 12, Math.max(12, centeredPosition));
    const top = Math.min(window.innerHeight - height - 12, Math.max(12, anchor.top));
    const daySlots = participantSlots.map((entry) => ({
      ...entry,
      date: new Date(entry.slot_start),
      index: new Date(entry.slot_start).getHours() * 2 + (new Date(entry.slot_start).getMinutes() >= 30 ? 1 : 0),
    }));
    const entries = matches.map((entry) => {
      const userSlots = new Set(daySlots.filter((candidate) => candidate.user_id === entry.user_id
        && dateInputValue(candidate.date) === dateInputValue(day)).map((candidate) => candidate.index));
      if (entry.user_id === currentUserId) {
        selected.forEach((selectedKey) => {
          const selectedDate = new Date(selectedKey);
          if (dateInputValue(selectedDate) === dateInputValue(day)) {
            userSlots.add(selectedDate.getHours() * 2 + (selectedDate.getMinutes() >= 30 ? 1 : 0));
          }
        });
      }
      const hoveredIndex = new Date(entry.slot_start).getHours() * 2 + (new Date(entry.slot_start).getMinutes() >= 30 ? 1 : 0);
      let start = hoveredIndex;
      let end = hoveredIndex + 1;
      while (start > 0 && userSlots.has(start - 1)) start -= 1;
      while (end < SLOT_COUNT && userSlots.has(end)) end += 1;
      return { userName: entry.user_name, range: `${formatTime(start)}–${formatTime(end)}`, note: entry.note };
    });
    const nextPopover = {
      key,
      left,
      top,
      range: formatDate(day, { weekday: 'long', day: 'numeric', month: 'long' }),
      notes: entries,
    };
    setHoverNote((current) => current?.key === key ? current : nextPopover);
  };
  const dirty = !sameSlots(selected, savedSlots) || !sameNotes(selectedNotes, savedNotes);
  const todayValue = dateInputValue(now);
  const currentDayIndex = dates.findIndex((date) => dateInputValue(date) === todayValue);
  const nowSlot = now.getHours() * 2 + (now.getMinutes() >= 30 ? 1 : 0);
  const nowFraction = (now.getMinutes() % 30) / 30;
  const scrollToCurrentTime = (behavior: ScrollBehavior = 'smooth') => {
    const container = scrollRef.current;
    const row = container?.querySelector<HTMLElement>(`[data-slot-index="${nowSlot}"]`);
    if (!container || !row) return;
    const periodNavigation = container.querySelector<HTMLElement>('.period-navigation');
    const top = (periodNavigation?.offsetHeight ?? 0) + row.offsetTop + nowFraction * row.offsetHeight;
    container.scrollTo({ top: Math.max(0, top - container.clientHeight * 0.45), behavior });
  };
  useEffect(() => {
    if (loading) return undefined;
    const frame = window.requestAnimationFrame(() => scrollToCurrentTime());
    return () => window.cancelAnimationFrame(frame);
  }, [loading]);
  useEffect(() => {
    if (!jumpAfterRender.current) return;
    jumpAfterRender.current = false;
    scrollToCurrentTime();
  }, [anchorDate, selectedDate]);
  const firstEditableKey = dates.flatMap((date) =>
    Array.from({ length: SLOT_COUNT }, (_, index) => isPastSlot(date, index, now) ? null : slotKey(date, index)),
  ).find((key): key is string => key !== null);

  const changePeriod = (direction: number) => {
    const next = addDays(anchorDate, direction * 7);
    setAnchorDate(next);
    setSelectedDate(dateInputValue(next));
  };

  const jumpToNow = () => {
    if (currentDayIndex < 0) {
      jumpAfterRender.current = true;
      const today = new Date();
      setAnchorDate(mondayOf(today));
      setSelectedDate(dateInputValue(today));
      return;
    }
    scrollToCurrentTime();
  };

  const openSlotDialog = (date: Date, slotIndex: number) => {
    if (isPastSlot(date, slotIndex, now)) return;
    const key = slotKey(date, slotIndex);
    let startIndex = slotIndex;
    let endIndex = Math.min(SLOT_COUNT, slotIndex + 2);
    if (selected.has(key)) {
      while (startIndex > 0 && selected.has(slotKey(date, startIndex - 1))) startIndex -= 1;
      endIndex = slotIndex + 1;
      while (endIndex < SLOT_COUNT && selected.has(slotKey(date, endIndex))) endIndex += 1;
      setEditingBlock({ start: startIndex, end: endIndex });
      setDialogNote(selectedNotes.get(key) ?? '');
    } else {
      setEditingBlock(null);
      setDialogNote('');
    }
    setDialogDate(date);
    setDialogStart(formatTime(startIndex));
    setDialogEnd(formatTime(endIndex === SLOT_COUNT ? 0 : endIndex));
    setError('');
    setNotice('');
  };

  const addBlock = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dialogDate) return;
    const normalizedStart = normalizeHourInput(dialogStart) ?? dialogStart.trim();
    const normalizedEnd = normalizeHourInput(dialogEnd, true) ?? dialogEnd.trim();
    setDialogStart(normalizedStart);
    setDialogEnd(normalizedEnd);
    const start = parseSlotTime(normalizedStart);
    let end = parseSlotTime(normalizedEnd, true);
    if (end === 0 && start !== null && start > 0) end = SLOT_COUNT;
    if (start === null || end === null) {
      setError('Podaj godziny w formacie 00:00 lub 00:30; koniec może być 24:00.');
      return;
    }
    if (end <= start) {
      setError('Godzina końca musi być późniejsza od godziny początku.');
      return;
    }
    const range = Array.from({ length: end - start }, (_, offset) => start + offset);
    if (range.some((index) => isPastSlot(dialogDate, index, now))) {
      setError('Ten zakres zawiera minioną godzinę. Wybierz przyszły termin.');
      return;
    }
    const next = new Set(selected);
    const nextNotes = new Map(selectedNotes);
    if (editingBlock) {
      for (let index = editingBlock.start; index < editingBlock.end; index += 1) {
        const key = slotKey(dialogDate, index);
        next.delete(key);
        nextNotes.delete(key);
      }
    }
    range.forEach((index) => next.add(slotKey(dialogDate, index)));
    let mergedStart = start;
    let mergedEnd = end;
    while (mergedStart > 0 && next.has(slotKey(dialogDate, mergedStart - 1))) mergedStart -= 1;
    while (mergedEnd < SLOT_COUNT && next.has(slotKey(dialogDate, mergedEnd))) mergedEnd += 1;
    const note = dialogNote.trim();
    for (let index = mergedStart; index < mergedEnd; index += 1) {
      const key = slotKey(dialogDate, index);
      if (note) nextNotes.set(key, note);
      else nextNotes.delete(key);
    }
    setSelected(next);
    setSelectedNotes(nextNotes);
    setDialogDate(null);
    setNotice('Dodano blok. Zapisuję dostępność…');
    setError('');
  };

  const removeDialogBlock = () => {
    if (!dialogDate || !editingBlock) return;
    setSelected((current) => {
      const next = new Set(current);
      for (let slot = editingBlock.start; slot < editingBlock.end; slot += 1) next.delete(slotKey(dialogDate, slot));
      return next;
    });
    setSelectedNotes((current) => {
      const next = new Map(current);
      for (let slot = editingBlock.start; slot < editingBlock.end; slot += 1) next.delete(slotKey(dialogDate, slot));
      return next;
    });
    setDialogDate(null);
    setNotice('Usunięto blok. Zapisuję dostępność…');
  };

  const clearVisible = () => {
    const visibleKeys = new Set(dates.flatMap((date) =>
      Array.from({ length: SLOT_COUNT }, (_, index) => slotKey(date, index)),
    ));
    setSelected((current) => new Set([...current].filter((key) => !visibleKeys.has(key))));
    setSelectedNotes((current) => new Map([...current].filter(([key]) => !visibleKeys.has(key))));
    setError('');
    setNotice('Wyczyszczono widoczne dni. Zapisuję dostępność…');
  };

  const saveAvailability = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await eventRequest<AvailabilitySlot[]>(`/${publicId}/availability/me`, 'PUT', {
        slot_starts: [...selected].sort().map((slot) => new Date(slot).toISOString()),
        slot_notes: Object.fromEntries([...selectedNotes].filter(([key, note]) => selected.has(key) && note.trim()).map(([key, note]) => [key, note.trim()])),
      });
      const ownSlots = new Set(result.map((slot) => new Date(slot.slot_start).toISOString()));
      const ownNotes = new Map(result.filter((slot) => slot.note).map((slot) => [new Date(slot.slot_start).toISOString(), slot.note]));
      setSelected(ownSlots);
      setSavedSlots(ownSlots);
      setSelectedNotes(ownNotes);
      setSavedNotes(ownNotes);
      const refreshed = await eventRequest<AvailabilityAggregate>(`/${publicId}/availability`);
      setAggregate(refreshed);
      setNoteSlots(await eventRequest<AvailabilityNote[]>(`/${publicId}/availability/notes`));
      const rangeStart = mondayOf(anchorDate);
      const rangeEnd = addDays(rangeStart, 7);
      const participantQuery = `?start=${encodeURIComponent(rangeStart.toISOString())}&end=${encodeURIComponent(rangeEnd.toISOString())}`;
      setParticipantSlots(await eventRequest<AvailabilityParticipant[]>(`/${publicId}/availability/participants${participantQuery}`));
      setNotice('Dostępność została zapisana.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nie udało się zapisać dostępności.');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!dirty || loading || saving || error) return undefined;
    const timer = window.setTimeout(() => { void saveAvailability(); }, 650);
    return () => window.clearTimeout(timer);
  }, [dirty, loading, saving, error, selected, selectedNotes, publicId]);

  return (
    <section className="availability-section" aria-label="Kalendarz dostępności">
      <div className="availability-toolbar">
        <div className="availability-presets" role="group" aria-label="Widok kalendarza">
          <button type="button" className="active" onClick={() => {
            const today = new Date();
            setAnchorDate(mondayOf(today));
            setSelectedDate(dateInputValue(today));
          }}>Tydzień</button>
        </div>
        <label className="availability-date-picker" aria-label="Wybierz dzień">
          <input type="date" min={todayValue} value={selectedDate} onChange={(event) => {
            setSelectedDate(event.target.value);
            setAnchorDate(mondayOf(parseDate(event.target.value)));
          }} />
        </label>
        <button type="button" className="availability-now-button" onClick={jumpToNow}><span />Teraz</button>
      </div>

      <div className="availability-people-legend" role="group" aria-label="Wyróżnij dostępność uczestnika">
        {schedulePeople.map((person) => <button type="button" className={`availability-person-button${highlightedUserId === person.id ? ' is-selected' : ''}`} aria-pressed={highlightedUserId === person.id} key={person.id} onClick={() => setHighlightedUserId((current) => current === person.id ? null : person.id)}>
          <i style={{ backgroundColor: availabilityColor(100 / schedulePeople.length) }} />{person.name}
        </button>)}
        {!schedulePeople.length && <span className="availability-people-empty">Brak uczestników</span>}
      </div>

      <div className="availability-scroll" ref={scrollRef} aria-label="Kalendarz; kliknij godzinę, aby dodać blok dostępności">
        <div className="period-navigation">
          <button type="button" aria-label="Poprzedni dzień lub tydzień" onClick={() => changePeriod(-1)}><ChevronLeft size={17} /></button>
          <strong>{`${formatDate(dates[0], { day: 'numeric', month: 'short' })} – ${formatDate(dates[6], { day: 'numeric', month: 'long', year: 'numeric' })}`}</strong>
          <button type="button" aria-label="Następny dzień lub tydzień" onClick={() => changePeriod(1)}><ChevronRight size={17} /></button>
        </div>

        {loading ? <div className="availability-loading"><LoaderCircle className="spin" size={22} /></div> : (
          <div className={`availability-matrix ${dates.length > 1 ? 'week-matrix' : 'day-matrix'}`} role="grid" aria-rowcount={SLOT_COUNT + 1} aria-colcount={dates.length + 1}>
            <div className="availability-row availability-header" role="row">
              <div className="availability-time-heading" role="columnheader" />
              {dates.map((date) => <button type="button" role="columnheader" className={`availability-day-heading${selectedDate === dateInputValue(date) ? ' selected-day' : ''}`} key={dateInputValue(date)} onClick={() => {
                setSelectedDate(dateInputValue(date));
              }}>
                <span>{formatDate(date, { weekday: 'short' })}</span><strong>{formatDate(date, { day: 'numeric', month: 'short' })}</strong>
              </button>)}
            </div>
            {Array.from({ length: SLOT_COUNT }, (_, slotIndex) => <div className={`availability-row${slotIndex % 2 === 0 ? ' hour-start' : ''}`} data-slot-index={slotIndex} role="row" key={slotIndex}>
              <div className={`availability-time ${slotIndex % 2 === 0 ? 'hour-mark' : ''}`} role="rowheader">{slotIndex % 2 === 0 ? formatTime(slotIndex) : ''}</div>
              {dates.map((date, dateIndex) => {
                const key = slotKey(date, slotIndex);
                const aggregateSlot = aggregateBySlot.get(key);
                const isSelected = selected.has(key);
                const wasSelected = savedSlots.has(key);
                const rawCount = aggregateSlot?.available_count ?? 0;
                const count = Math.min(
                  aggregate?.total_participants ?? 0,
                  Math.max(0, rawCount + (isSelected && !wasSelected ? 1 : 0) - (!isSelected && wasSelected ? 1 : 0)),
                );
                const past = isPastSlot(date, slotIndex, now);
                const notes = visualBlocks.noteRanges.get(key) ?? [];
                return <div className="availability-cell-wrap" role="gridcell" key={key}>
                  <button
                    type="button"
                    className={`availability-cell${past ? ' past-slot' : ''}${notes.length ? ' has-note' : ''}`}
                    style={{ backgroundColor: 'transparent' }}
                    disabled={past}
                    aria-pressed={isSelected}
                    aria-label={`${formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}, ${formatTime(slotIndex)}. ${count ? `${count} osób dostępnych.` : 'Wolne pole.'} ${notes.length ? `Notatka: ${notes.join(' / ')}.` : ''} ${isSelected ? 'Twój termin.' : 'Kliknij, aby dodać blok.'}`}
                    tabIndex={key === firstEditableKey ? 0 : -1}
                    onMouseEnter={(event) => showNotePopover(event, dateIndex, slotIndex)}
                    onMouseLeave={() => setHoverNote(null)}
                    onClick={() => openSlotDialog(date, slotIndex)}
                  />
                </div>;
              })}
              {currentDayIndex >= 0 && slotIndex === nowSlot && <div className="availability-now-line" aria-hidden="true" style={{ top: `${nowFraction * 100}%` }}>
                <span><i>{now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', hour12: false })}</i></span>
              </div>}
            </div>)}
            {visualBlocks.blocks.map((block) => {
              const percentage = aggregate?.total_participants && block.count
                ? block.count * 100 / aggregate.total_participants
                : 0;
              return <div
                aria-hidden="true"
                className={`availability-block-overlay ${block.own ? `availability-own-block${highlightedUserId !== null && highlightedUserId !== currentUserId ? ' is-unhighlighted' : ''}` : 'availability-heat-block'}`}
                key={`${block.dateIndex}-${block.start}-${block.own ? 'own' : block.count}`}
                style={{ top: `${HEADER_HEIGHT + block.start * ROW_HEIGHT}px`, height: `${(block.end - block.start) * ROW_HEIGHT}px` }}
              >
                <span style={{ gridColumn: block.dateIndex + 2, ...(block.own ? {} : { backgroundColor: availabilityColor(percentage) }) }} />
              </div>;
            })}
            {visualBlocks.noteBlocks.map((block) => <div
              aria-hidden="true"
              className="availability-block-overlay availability-note-overlay"
              key={`note-${block.dateIndex}-${block.userId}-${block.start}-${block.end}`}
              style={{ top: `${HEADER_HEIGHT + block.start * ROW_HEIGHT}px`, height: `${(block.end - block.start) * ROW_HEIGHT}px` }}
            >
              <span style={{ gridColumn: block.dateIndex + 2 }}><MessageCircle size={13} /></span>
            </div>)}
            {highlightedBlocks.map((block) => <div
              aria-hidden="true"
              className="availability-block-overlay availability-participant-outline"
              key={`participant-${highlightedUserId}-${block.dateIndex}-${block.start}`}
              style={{ top: `${HEADER_HEIGHT + block.start * ROW_HEIGHT}px`, height: `${(block.end - block.start) * ROW_HEIGHT}px` }}
            >
              <span style={{ gridColumn: block.dateIndex + 2 }} />
            </div>)}
          </div>
        )}
      </div>

      <div className="availability-actions">
        <button type="button" className="availability-clear-button" onClick={clearVisible} disabled={loading || saving}><Trash2 size={14} />Wyczyść</button>
        <span className={`availability-save-status${error ? ' is-error' : ''}`} role="status">{loading ? 'Wczytywanie…' : error ? 'Nie zapisano' : saving || dirty ? 'Zapisywanie…' : 'Zmiany zapisane'}</span>
      </div>

      {(error || notice) && <div className={`availability-feedback ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}</div>}

      {hoverNote && <aside className="availability-note-popover" role="tooltip" style={{ left: hoverNote.left, top: hoverNote.top }}>
        <strong>{hoverNote.range}</strong>
        {hoverNote.notes.map((entry, index) => <div className="availability-note-popover-entry" key={`${entry.userName}-${index}`}>
          <span>{entry.userName} · {entry.range}</span>{entry.note && <p>{entry.note}</p>}
        </div>)}
      </aside>}

      {dialogDate && <div className="availability-dialog-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setDialogDate(null);
      }}>
        <form className="availability-dialog" role="dialog" aria-modal="true" aria-labelledby="availability-dialog-title" onSubmit={addBlock}>
          <div className="availability-dialog-heading">
            <div><span className="availability-dialog-icon"><Clock3 size={17} /></span><div><h3 id="availability-dialog-title">{editingBlock ? 'Edytuj blok' : 'Dodaj dostępność'}</h3><p>{formatDate(dialogDate, { weekday: 'long', day: 'numeric', month: 'long' })}</p></div></div>
            <button type="button" className="availability-dialog-close" aria-label="Zamknij" onClick={() => setDialogDate(null)}><X size={18} /></button>
          </div>
          <div className="availability-dialog-fields">
            <label>Od<input type="time" step="1800" autoFocus value={dialogStart} onChange={(event) => setDialogStart(event.target.value)} onBlur={() => {
              const normalized = normalizeHourInput(dialogStart);
              if (normalized) setDialogStart(normalized);
            }} inputMode="numeric" placeholder="09:00" /></label>
            <span>—</span>
            <label>Do<input type="time" step="1800" value={dialogEnd} onChange={(event) => setDialogEnd(event.target.value)} onBlur={() => {
              const normalized = normalizeHourInput(dialogEnd, true);
              if (normalized) setDialogEnd(normalized);
            }} inputMode="numeric" placeholder="10:30" /></label>
          </div>
          <p className="availability-dialog-hint">Godziny wpisz co pół godziny, np. 09:00 lub 09:30.</p>
          <label className="availability-note-field">Notatka do bloku <textarea maxLength={500} rows={3} value={dialogNote} onChange={(event) => setDialogNote(event.target.value)} placeholder="Np. mogę dojechać po pracy" /></label>
          {error && <div className="availability-feedback is-error" role="alert">{error}</div>}
          <div className="availability-dialog-actions">
            {editingBlock && <button type="button" className="availability-dialog-delete" onClick={removeDialogBlock}><Trash2 size={15} />Usuń blok</button>}
            <button type="button" className="button button-secondary button-small" onClick={() => setDialogDate(null)}>Anuluj</button>
            <button type="submit" className="button button-primary button-small">{editingBlock ? 'Zmień blok' : 'Dodaj blok'}</button>
          </div>
        </form>
      </div>}
    </section>
  );
}
