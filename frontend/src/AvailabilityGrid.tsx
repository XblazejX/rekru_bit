import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock3, LoaderCircle, Save, Trash2, X } from 'lucide-react';
import { eventRequest } from './api';
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
}

type ViewMode = 'today' | 'tomorrow' | 'week' | 'day';

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

export default function AvailabilityGrid({ publicId }: { publicId: string }) {
  const [view, setView] = useState<ViewMode>('today');
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => dateInputValue(new Date()));
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [savedSlots, setSavedSlots] = useState<Set<string>>(() => new Set());
  const [aggregate, setAggregate] = useState<AvailabilityAggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [dialogDate, setDialogDate] = useState<Date | null>(null);
  const [dialogStart, setDialogStart] = useState('09:00');
  const [dialogEnd, setDialogEnd] = useState('10:00');
  const [editingBlock, setEditingBlock] = useState<{ start: number; end: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const jumpAfterRender = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      eventRequest<AvailabilityAggregate>(`/${publicId}/availability`),
      eventRequest<AvailabilitySlot[]>(`/${publicId}/availability/me`),
    ])
      .then(([overview, personal]) => {
        if (cancelled) return;
        const ownSlots = new Set(personal.map((slot) => new Date(slot.slot_start).toISOString()));
        setAggregate(overview);
        setSavedSlots(ownSlots);
        setSelected(ownSlots);
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
    if (view === 'today') return [new Date()];
    if (view === 'tomorrow') return [addDays(new Date(), 1)];
    if (view === 'week') return Array.from({ length: 7 }, (_, index) => addDays(mondayOf(anchorDate), index));
    return [parseDate(selectedDate)];
  }, [anchorDate, now, selectedDate, view]);

  const aggregateBySlot = useMemo(
    () => new Map((aggregate?.slots ?? []).map((slot) => [new Date(slot.slot_start).toISOString(), slot])),
    [aggregate],
  );
  const visualBlocks = useMemo(() => {
    const blocks: Array<{ dateIndex: number; start: number; end: number; count?: number; own?: boolean }> = [];
    const ownRanges = new Map<string, string>();
    const heatRanges = new Map<string, string>();
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
    return { blocks, ownRanges, heatRanges };
  }, [aggregate?.total_participants, aggregateBySlot, dates, savedSlots, selected]);
  const dirty = !sameSlots(selected, savedSlots);
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
  }, [anchorDate, selectedDate, view]);
  const firstEditableKey = dates.flatMap((date) =>
    Array.from({ length: SLOT_COUNT }, (_, index) => isPastSlot(date, index, now) ? null : slotKey(date, index)),
  ).find((key): key is string => key !== null);

  const setPreset = (nextView: ViewMode) => {
    const current = new Date();
    if (nextView === 'today') {
      setAnchorDate(current);
      setSelectedDate(dateInputValue(current));
    } else if (nextView === 'tomorrow') {
      const tomorrow = addDays(current, 1);
      setAnchorDate(tomorrow);
      setSelectedDate(dateInputValue(tomorrow));
    } else if (nextView === 'week') {
      setAnchorDate(mondayOf(current));
      setSelectedDate(dateInputValue(current));
    }
    setView(nextView);
  };

  const changePeriod = (direction: number) => {
    if (view === 'week') {
      const next = addDays(anchorDate, direction * 7);
      setAnchorDate(next);
      setSelectedDate(dateInputValue(next));
      return;
    }
    const next = addDays(parseDate(selectedDate), direction);
    setSelectedDate(dateInputValue(next));
    setAnchorDate(next);
    setView('day');
  };

  const jumpToNow = () => {
    if (currentDayIndex < 0) {
      jumpAfterRender.current = true;
      setPreset('today');
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
    } else {
      setEditingBlock(null);
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
    setSelected((current) => {
      const next = new Set(current);
      if (editingBlock) {
        for (let index = editingBlock.start; index < editingBlock.end; index += 1) {
          next.delete(slotKey(dialogDate, index));
        }
      }
      range.forEach((index) => next.add(slotKey(dialogDate, index)));
      return next;
    });
    setDialogDate(null);
    setNotice('Dodano blok. Zapisz zmianę, aby pokazać ją uczestnikom.');
    setError('');
  };

  const removeDialogBlock = () => {
    if (!dialogDate || !editingBlock) return;
    setSelected((current) => {
      const next = new Set(current);
      for (let slot = editingBlock.start; slot < editingBlock.end; slot += 1) next.delete(slotKey(dialogDate, slot));
      return next;
    });
    setDialogDate(null);
    setNotice('Usunięto zaznaczony blok. Zapisz zmianę, aby pokazać ją uczestnikom.');
  };

  const clearVisible = () => {
    const visibleKeys = new Set(dates.flatMap((date) =>
      Array.from({ length: SLOT_COUNT }, (_, index) => slotKey(date, index)),
    ));
    setSelected((current) => new Set([...current].filter((key) => !visibleKeys.has(key))));
    setNotice('Wyczyszczono widoczne dni. Zapisz zmianę.');
  };

  const restoreSaved = () => {
    setSelected(new Set(savedSlots));
    setError('');
    setNotice('Przywrócono zapisane bloki.');
  };

  const saveAvailability = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await eventRequest<AvailabilitySlot[]>(`/${publicId}/availability/me`, 'PUT', {
        slot_starts: [...selected].sort().map((slot) => new Date(slot).toISOString()),
      });
      const ownSlots = new Set(result.map((slot) => new Date(slot.slot_start).toISOString()));
      setSelected(ownSlots);
      setSavedSlots(ownSlots);
      const refreshed = await eventRequest<AvailabilityAggregate>(`/${publicId}/availability`);
      setAggregate(refreshed);
      setNotice('Zapisano dostępność.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nie udało się zapisać dostępności.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="availability-section" aria-label="Kalendarz dostępności">
      <div className="availability-toolbar">
        <div className="availability-presets" role="group" aria-label="Widok kalendarza">
          <button type="button" className={view === 'today' ? 'active' : ''} onClick={() => setPreset('today')}>Dziś</button>
          <button type="button" className={view === 'tomorrow' ? 'active' : ''} onClick={() => setPreset('tomorrow')}>Jutro</button>
          <button type="button" className={view === 'week' ? 'active' : ''} onClick={() => setPreset('week')}>Tydzień</button>
        </div>
        <label className="availability-date-picker" aria-label="Wybierz dzień">
          <input type="date" min={todayValue} value={selectedDate} onChange={(event) => {
            setSelectedDate(event.target.value);
            setAnchorDate(parseDate(event.target.value));
            setView('day');
          }} />
        </label>
        <button type="button" className="availability-now-button" onClick={jumpToNow}><span />Teraz</button>
      </div>

      <div className="availability-scroll" ref={scrollRef} aria-label="Kalendarz; kliknij godzinę, aby dodać blok dostępności">
        <div className="period-navigation">
          <button type="button" aria-label="Poprzedni dzień lub tydzień" onClick={() => changePeriod(-1)}><ChevronLeft size={17} /></button>
          <strong>{view === 'week'
            ? `${formatDate(dates[0], { day: 'numeric', month: 'short' })} – ${formatDate(dates[6], { day: 'numeric', month: 'long', year: 'numeric' })}`
            : formatDate(dates[0], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</strong>
          <button type="button" aria-label="Następny dzień lub tydzień" onClick={() => changePeriod(1)}><ChevronRight size={17} /></button>
        </div>

        {loading ? <div className="availability-loading"><LoaderCircle className="spin" size={22} /></div> : (
          <div className={`availability-matrix ${dates.length > 1 ? 'week-matrix' : 'day-matrix'}`} role="grid" aria-rowcount={SLOT_COUNT + 1} aria-colcount={dates.length + 1}>
            <div className="availability-row availability-header" role="row">
              <div className="availability-time-heading" role="columnheader" />
              {dates.map((date) => <button type="button" role="columnheader" className="availability-day-heading" key={dateInputValue(date)} onClick={() => {
                setSelectedDate(dateInputValue(date));
                setAnchorDate(date);
                setView('day');
              }}>
                <span>{formatDate(date, { weekday: 'short' })}</span><strong>{formatDate(date, { day: 'numeric', month: 'short' })}</strong>
              </button>)}
            </div>
            {Array.from({ length: SLOT_COUNT }, (_, slotIndex) => <div className={`availability-row${slotIndex % 2 === 0 ? ' hour-start' : ''}`} data-slot-index={slotIndex} role="row" key={slotIndex}>
              <div className={`availability-time ${slotIndex % 2 === 0 ? 'hour-mark' : ''}`} role="rowheader">{slotIndex % 2 === 0 ? formatTime(slotIndex) : ''}</div>
              {dates.map((date) => {
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
                const range = visualBlocks.ownRanges.get(key)
                  ?? visualBlocks.heatRanges.get(key)
                  ?? `${formatTime(slotIndex)}–${formatTime(slotIndex + 1)}`;
                return <div className="availability-cell-wrap" role="gridcell" key={key}>
                  <button
                    type="button"
                    className={`availability-cell${past ? ' past-slot' : ''}`}
                    style={{ backgroundColor: 'transparent' }}
                    disabled={past}
                    aria-pressed={isSelected}
                    aria-label={`${formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}, ${formatTime(slotIndex)}. ${count ? `${count} osób dostępnych.` : 'Wolne pole.'} ${isSelected ? 'Twój termin.' : 'Kliknij, aby dodać blok.'}`}
                    title={`${range} · ${count ? `${count} dostępnych` : 'dodaj termin'}`}
                    data-hover-range={range}
                    tabIndex={key === firstEditableKey ? 0 : -1}
                    onClick={() => openSlotDialog(date, slotIndex)}
                  />
                </div>;
              })}
              {currentDayIndex >= 0 && slotIndex === nowSlot && <div className="availability-now-line" aria-hidden="true" style={{ top: `${nowFraction * 100}%` }}>
                <span style={{ gridColumn: currentDayIndex + 2 }}><i>{formatTime(nowSlot)}</i></span>
              </div>}
            </div>)}
            {visualBlocks.blocks.map((block) => {
              const percentage = aggregate?.total_participants && block.count
                ? block.count * 100 / aggregate.total_participants
                : 0;
              const hue = Math.round(14 + percentage * 0.78);
              const opacity = 0.15 + percentage / 310;
              return <div
                aria-hidden="true"
                className={`availability-block-overlay ${block.own ? 'availability-own-block' : 'availability-heat-block'}`}
                key={`${block.dateIndex}-${block.start}-${block.own ? 'own' : block.count}`}
                style={{ top: `${HEADER_HEIGHT + block.start * ROW_HEIGHT}px`, height: `${(block.end - block.start) * ROW_HEIGHT}px` }}
              >
                <span style={{ gridColumn: block.dateIndex + 2, ...(block.own ? {} : { backgroundColor: `hsl(${hue} 39% 47% / ${opacity})` }) }} />
              </div>;
            })}
          </div>
        )}
      </div>

      <div className="availability-actions">
        <button type="button" className="availability-clear-button" onClick={clearVisible} disabled={loading || saving}><Trash2 size={14} />Wyczyść</button>
        <div className="availability-save-actions">
          {dirty && <button type="button" className="button button-secondary button-small" onClick={restoreSaved} disabled={saving}>Cofnij</button>}
          <button type="button" className="button button-primary button-small" onClick={saveAvailability} disabled={loading || saving || !dirty}>
            {saving ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}{saving ? 'Zapisywanie…' : 'Zapisz'}
          </button>
        </div>
      </div>

      {(error || notice) && <div className={`availability-feedback ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}</div>}

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
          {error && <div className="availability-feedback is-error" role="alert">{error}</div>}
          <div className="availability-dialog-actions">
            {editingBlock && <button type="button" className="availability-dialog-delete" onClick={removeDialogBlock}><Trash2 size={15} />Usuń blok</button>}
            <button type="button" className="button button-secondary button-small" onClick={() => setDialogDate(null)}>Anuluj</button>
            <button type="submit" className="button button-primary button-small">Zapisz blok</button>
          </div>
        </form>
      </div>}
    </section>
  );
}
