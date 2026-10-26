import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AvailabilityGrid from '../AvailabilityGrid';
import FriendsPage from '../FriendsPage';
import { availabilityColor } from '../scheduleColors';

function response(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function mockFetch(handler: (url: string) => unknown) {
  vi.spyOn(global, 'fetch').mockImplementation((input) => Promise.resolve(response(handler(input.toString()))));
}

function mondayOf(date: Date): Date {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

function slot(dayOffset: number, hour: number, minute = 0): string {
  const date = new Date(mondayOf(new Date()));
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.setItem('bit2meet.accessToken', 'test-token');
  Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
});

describe('shared schedule colors', () => {
  it('uses one event-style color for one person and greener color for overlaps', () => {
    expect(availabilityColor(33)).toBe('hsl(40 39% 47% / 0.2564516129032258)');
    expect(availabilityColor(66)).toBe('hsl(65 39% 47% / 0.3629032258064516)');
    expect(Number(availabilityColor(66).match(/^hsl\((\d+)/)?.[1]))
      .toBeGreaterThan(Number(availabilityColor(33).match(/^hsl\((\d+)/)?.[1]));
  });
});

describe('availability schedule highlighting', () => {
  it('adds an event availability range by dragging and saves it automatically', async () => {
    const date = new Date();
    date.setDate(date.getDate() + 2);
    const dayLabel = new Intl.DateTimeFormat('pl-PL', {
      weekday: 'long', day: 'numeric', month: 'long',
    }).format(date);
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.spyOn(global, 'fetch').mockImplementation((input, init) => {
      const url = input.toString();
      requests.push({ url, init });
      if (url.endsWith('/availability')) {
        return Promise.resolve(response({ public_id: 'example', total_participants: 1, slots: [] }));
      }
      if (url.endsWith('/availability/me') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { slot_starts: string[] };
        return Promise.resolve(response(body.slot_starts.map((slot_start, index) => ({
          id: index + 1, event_id: 1, user_id: 7, slot_start, note: '',
        }))));
      }
      if (url.endsWith('/availability/me') || url.endsWith('/availability/notes')
        || url.includes('/availability/participants?')) return Promise.resolve(response([]));
      throw new Error(`Unexpected request: ${url}`);
    });

    const { container } = render(<AvailabilityGrid publicId="example" currentUserId={7} currentUserName="Anna Nowak" />);
    await screen.findByRole('grid');
    const cells = [...container.querySelectorAll<HTMLButtonElement>('.availability-cell')];
    const first = cells.find((cell) => cell.getAttribute('aria-label')?.startsWith(`${dayLabel}, 10:00.`));
    const second = cells.find((cell) => cell.getAttribute('aria-label')?.startsWith(`${dayLabel}, 10:30.`));
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    fireEvent.pointerDown(first!, { button: 0, pointerId: 1 });
    fireEvent.pointerEnter(second!, { pointerId: 1 });
    expect(second).toHaveClass('is-drag-preview');
    fireEvent.pointerUp(window, { pointerId: 1 });

    await waitFor(() => {
      const save = requests.find((request) => request.url.endsWith('/availability/me') && request.init?.method === 'PUT');
      expect(save).toBeDefined();
      expect(JSON.parse(String(save?.init?.body)).slot_starts).toHaveLength(2);
    }, { timeout: 2500 });

    const canceledStart = cells.find((cell) => cell.getAttribute('aria-label')?.startsWith(`${dayLabel}, 11:00.`));
    const canceledEnd = cells.find((cell) => cell.getAttribute('aria-label')?.startsWith(`${dayLabel}, 11:30.`));
    fireEvent.pointerDown(canceledStart!, { button: 0, pointerId: 2 });
    fireEvent.pointerEnter(canceledEnd!, { pointerId: 2 });
    fireEvent.pointerCancel(window, { pointerId: 2 });
    expect(canceledEnd).not.toHaveClass('is-drag-preview');
    await new Promise((resolve) => window.setTimeout(resolve, 750));
    expect(requests.filter((request) => request.url.endsWith('/availability/me') && request.init?.method === 'PUT')).toHaveLength(1);
  });

  it('adds a friends schedule range by dragging and saves it automatically', async () => {
    const date = new Date();
    date.setDate(date.getDate() + 2);
    const dayLabel = new Intl.DateTimeFormat('pl-PL', {
      weekday: 'long', day: 'numeric', month: 'long',
    }).format(date);
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.spyOn(global, 'fetch').mockImplementation((input, init) => {
      const url = input.toString();
      requests.push({ url, init });
      if (url.endsWith('/social/friends') || url.endsWith('/social/notifications')) return Promise.resolve(response([]));
      if (url.includes('/social/availability/me?') || url.includes('/social/availability?')) return Promise.resolve(response([]));
      if (url.endsWith('/social/availability/me') && init?.method === 'PUT') {
        return Promise.resolve(response([]));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const { container } = render(<FriendsPage events={[]} currentUserName="Anna Nowak" view="schedule" onEventAccepted={() => undefined} />);
    await screen.findByText('Dostępność znajomych');
    const cells = [...container.querySelectorAll<HTMLButtonElement>('.friends-calendar-cell')];
    const first = cells.find((cell) => cell.getAttribute('aria-label')?.startsWith(`${dayLabel} 10:00`));
    const second = cells.find((cell) => cell.getAttribute('aria-label')?.startsWith(`${dayLabel} 10:30`));
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    fireEvent.pointerDown(first!, { button: 0, pointerId: 1 });
    fireEvent.pointerEnter(second!, { pointerId: 1 });
    expect(second).toHaveClass('is-drag-preview');
    fireEvent.pointerUp(window, { pointerId: 1 });

    await waitFor(() => {
      const save = requests.find((request) => request.url.endsWith('/social/availability/me') && request.init?.method === 'PUT');
      expect(save).toBeDefined();
      expect(JSON.parse(String(save?.init?.body)).slot_starts).toHaveLength(2);
    }, { timeout: 2500 });
  });

  it('highlights one friend at a time and toggles the outline off', async () => {
    const firstSlot = slot(2, 10);
    const secondSlot = slot(2, 10, 30);
    const otherSlot = slot(2, 12);
    const ownSlot = firstSlot;
    mockFetch((url) => {
      if (url.endsWith('/social/friends')) return [
        { id: 11, first_name: 'Ala', last_name: 'Nowak' },
        { id: 12, first_name: 'Bartek', last_name: 'Kowalski' },
      ];
      if (url.endsWith('/social/notifications')) return [];
      if (url.includes('/social/availability/me?')) return [{ slot_start: ownSlot, note: '' }];
      if (url.includes('/social/availability?')) return [
        { user_id: 11, first_name: 'Ala', last_name: 'Nowak', slot_start: firstSlot, note: '' },
        { user_id: 11, first_name: 'Ala', last_name: 'Nowak', slot_start: secondSlot, note: '' },
        { user_id: 12, first_name: 'Bartek', last_name: 'Kowalski', slot_start: otherSlot, note: '' },
      ];
      throw new Error(`Unexpected request: ${url}`);
    });

    const { container } = render(<FriendsPage events={[]} currentUserName="Anna Nowak" view="schedule" onEventAccepted={() => undefined} />);
    await waitFor(() => expect(container.querySelectorAll('.friends-legend-person')).toHaveLength(3));
    await waitFor(() => expect(container.querySelectorAll('.friends-availability-overlay')).toHaveLength(3));
    const heatmapBlocks = [...container.querySelectorAll<HTMLElement>('.friends-availability-overlay span')];
    const rgb = (color: string) => color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)?.slice(1).map(Number) ?? [];
    expect(heatmapBlocks[1].style.background).toBe(heatmapBlocks[2].style.background);
    expect(rgb(heatmapBlocks[0].style.background)[1]).toBeGreaterThan(rgb(heatmapBlocks[0].style.background)[0]);
    expect(rgb(heatmapBlocks[1].style.background)[0]).toBeGreaterThan(rgb(heatmapBlocks[1].style.background)[1]);
    const ala = container.querySelector<HTMLButtonElement>('.friends-legend-person:nth-child(2)')!;
    const bartek = container.querySelector<HTMLButtonElement>('.friends-legend-person:nth-child(3)')!;

    fireEvent.click(ala);
    expect(ala).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelectorAll('.friends-selected-overlay')).toHaveLength(1);
    expect(container.querySelector('.friends-availability-overlay.is-own')).toBeNull();
    expect(container.querySelector('.friends-selected-overlay')).toHaveStyle({ top: `${42 + 20 * 26}px` });

    fireEvent.click(bartek);
    expect(ala).toHaveAttribute('aria-pressed', 'false');
    expect(bartek).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelectorAll('.friends-selected-overlay')).toHaveLength(1);
    expect(container.querySelector('.friends-selected-overlay')).toHaveStyle({ top: `${42 + 24 * 26}px` });

    fireEvent.click(bartek);
    expect(bartek).toHaveAttribute('aria-pressed', 'false');
    expect(container.querySelectorAll('.friends-selected-overlay')).toHaveLength(0);
  });

  it('uses the same single-selection and toggle behavior for event participants', async () => {
    const firstSlot = slot(2, 15);
    const secondSlot = slot(2, 16);
    const ownSlot = slot(2, 14);
    mockFetch((url) => {
      if (url.endsWith('/api/events/example/availability')) return {
        public_id: 'example', total_participants: 2, slots: [],
      };
      if (url.endsWith('/api/events/example/availability/me')) return [{ id: 1, event_id: 1, user_id: 7, slot_start: ownSlot, note: '' }];
      if (url.endsWith('/api/events/example/availability/notes')) return [];
      if (url.includes('/api/events/example/availability/participants?')) return [
        { slot_start: firstSlot, user_id: 9, user_name: 'Bartek Tester', note: '' },
        { slot_start: secondSlot, user_id: 10, user_name: 'Celina Tester', note: '' },
      ];
      throw new Error(`Unexpected request: ${url}`);
    });

    const { container } = render(<AvailabilityGrid publicId="example" currentUserId={7} currentUserName="Anna Nowak" />);
    const bartek = await screen.findByRole('button', { name: 'Bartek Tester' });
    const celina = screen.getByRole('button', { name: 'Celina Tester' });

    fireEvent.click(bartek);
    expect(bartek).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelectorAll('.availability-participant-outline')).toHaveLength(1);
    expect(container.querySelector('.availability-own-block')).toHaveClass('is-unhighlighted');
    expect(container.querySelector('.availability-participant-outline')).toHaveStyle({ top: `${42 + 30 * 26}px` });

    fireEvent.click(celina);
    expect(bartek).toHaveAttribute('aria-pressed', 'false');
    expect(celina).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelectorAll('.availability-participant-outline')).toHaveLength(1);
    expect(container.querySelector('.availability-participant-outline')).toHaveStyle({ top: `${42 + 32 * 26}px` });

    fireEvent.click(celina);
    await waitFor(() => expect(container.querySelectorAll('.availability-participant-outline')).toHaveLength(0));
    expect(celina).toHaveAttribute('aria-pressed', 'false');
  });
});
