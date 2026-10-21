import { FormEvent, useEffect, useRef, useState } from 'react';
import { LoaderCircle, MessageCircle, Send, X } from 'lucide-react';
import { eventRequest } from './api';
import './styles/event-chat.css';

interface EventMessage {
  id: number;
  event_id: number;
  user_id: number;
  user_name: string;
  body: string;
  created_at: string;
}

interface MessageList {
  total: number;
  messages: EventMessage[];
}

export default function EventChat({ publicId, userId, unreadCount, onCountChange }: {
  publicId: string;
  userId: number;
  unreadCount: number;
  onCountChange: (count: number) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<EventMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [stickToBottom, setStickToBottom] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesBoxRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const messageCountRef = useRef(0);

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    const loadMessages = async () => {
      try {
        const result = await eventRequest<MessageList>(`/${publicId}/messages`);
        if (!cancelled) {
          if (result.total < messageCountRef.current) return;
          setMessages((current) => {
            if (current.length === result.messages.length && current.every((message, index) => message.id === result.messages[index]?.id)) return current;
            return result.messages;
          });
          messageCountRef.current = result.total;
          onCountChange(result.total);
          setError('');
        }
      } catch (requestError) {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Nie udało się wczytać rozmowy.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadMessages();
    const timer = window.setInterval(() => void loadMessages(), 10000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isOpen, publicId, onCountChange]);

  useEffect(() => {
    if (stickToBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, stickToBottom]);

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError('');
    try {
      const created = await eventRequest<EventMessage>(`/${publicId}/messages`, 'POST', { body });
      setStickToBottom(true);
      setMessages((current) => [...current.filter((message) => message.id !== created.id), created]);
      messageCountRef.current += 1;
      onCountChange(messageCountRef.current);
      setDraft('');
      if (draftRef.current) draftRef.current.style.height = '';
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nie udało się wysłać wiadomości.');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
    {!isOpen ? <button className="event-chat-toggle dashboard-card" type="button" onClick={() => setIsOpen(true)} aria-label={unreadCount > 0 ? `Otwórz czat, ${unreadCount} nieprzeczytanych wiadomości` : 'Otwórz czat'}>
      <MessageCircle size={20} />
      {unreadCount > 0 && <span>{unreadCount}</span>}
    </button> : <section className="event-chat dashboard-card" aria-label="Rozmowa o spotkaniu">
      <div className="event-chat-heading">
        <span className="event-chat-icon"><MessageCircle size={18} /></span>
        <div><h2>Rozmowa</h2><p>Wiadomości widzą uczestnicy spotkania</p></div>
        <button className="event-chat-close" type="button" aria-label="Zwiń czat" onClick={() => setIsOpen(false)}><X size={17} /></button>
      </div>
      <div className="event-chat-messages" aria-live="polite" ref={messagesBoxRef} onScroll={(event) => {
        const element = event.currentTarget;
        setStickToBottom(element.scrollHeight - element.scrollTop - element.clientHeight < 48);
      }}>
        {loading ? <div className="event-chat-state"><LoaderCircle size={18} className="spin" /> Wczytywanie…</div>
          : messages.length === 0 ? <div className="event-chat-state">Zacznijcie rozmowę o tym spotkaniu.</div>
            : messages.map((message) => (
              <article className={`event-message${message.user_id === userId ? ' event-message-own' : ''}`} key={message.id}>
                <div className="event-message-meta">
                  <strong>{message.user_id === userId ? 'Ty' : message.user_name}</strong>
                  <time dateTime={message.created_at}>{new Intl.DateTimeFormat('pl-PL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(message.created_at))}</time>
                </div>
                <p>{message.body}</p>
              </article>
            ))}
        <div ref={bottomRef} />
      </div>
      {error && <p className="event-chat-error" role="alert">{error}</p>}
      <form className="event-chat-form" onSubmit={sendMessage}>
        <textarea ref={draftRef} aria-label="Treść wiadomości" rows={1} maxLength={2000} placeholder="Napisz wiadomość…" value={draft} onChange={(event) => {
          setDraft(event.target.value);
          const textarea = event.currentTarget;
          textarea.style.height = 'auto';
          textarea.style.height = `${Math.min(textarea.scrollHeight, Math.floor(window.innerHeight * 0.35))}px`;
        }} onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }} />
        <button className="button button-primary" type="submit" disabled={sending || !draft.trim()} aria-label="Wyślij wiadomość">
          {sending ? <LoaderCircle size={17} className="spin" /> : <Send size={16} />}<span>Wyślij</span>
        </button>
      </form>
    </section>}
    </>
  );
}
