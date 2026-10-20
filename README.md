# Bit2Meet — Koordynator terminów (BIT Web)

Bit2Meet to nowoczesna aplikacja webowa do wspólnego ustalania terminów spotkań, inspirowana rozwiązaniami takimi jak When2meet oraz LettuceMeet.

Użytkownicy mogą tworzyć wydarzenia, udostępniać je uczestnikom za pomocą publicznego linku, zaznaczać swoją dostępność na interaktywnej siatce godzinowej i łatwo identyfikować optymalny termin spotkania.

---

## 1. Architektura i Stack Technologiczny

| Warstwa | Technologia | Zastosowanie |
|---|---|---|
| **Frontend** | React 18, TypeScript, Vite | Interaktywny interfejs użytkownika, SPA |
| **Stylowanie** | CSS (zmienne CSS) | Spójne motywy: ciemny (domyślny) i jasny |
| **Backend API** | Python 3.12, FastAPI | Asynchroniczne REST API |
| **Baza danych** | PostgreSQL 16 | Relacyjna baza danych |
| **Dostęp do bazy** | SQLAlchemy 2.0 (asyncpg), Alembic | Asynchroniczny ORM i migracje schematu |
| **Uwierzytelnianie** | JWT (PyJWT), bcrypt | Bezpieczna autoryzacja i hashowanie haseł |
| **Poczta e-mail** | SMTP (aiosmtplib) | Kody weryfikacyjne i powiadomienia |
| **Konteneryzacja** | Docker & Docker Compose | Spójne środowisko uruchomieniowe |
| **Serwowanie WWW** | Nginx | Reverse proxy dla API i serwowanie SPA |
| **Testy** | pytest, httpx, Vitest, Testing Library | Testy jednostkowe i integracyjne |

---

## 2. Struktura Repozytorium

```text
bit2meet/
├── frontend/             # Aplikacja React + Vite + TypeScript
│   ├── src/
│   │   ├── styles/       # Zmienne CSS i motywy (dark/light)
│   │   ├── tests/        # Testy Vitest / React Testing Library
│   │   ├── App.tsx       # Główny widok weryfikacyjny (Etap 1)
│   │   └── main.tsx      # Punkt wejścia SPA
│   ├── Dockerfile        # Multi-stage Dockerfile (Node -> Nginx)
│   ├── nginx.conf        # Konfiguracja Nginx z proxy /api/
│   └── package.json
├── backend/              # Asynchroniczne API FastAPI w Pythonie
│   ├── app/
│   │   ├── api/          # Endpointy REST API (w tym /api/health)
│   │   ├── core/         # Konfiguracja z Pydantic Settings
│   │   ├── db/           # Asynchroniczna sesja SQLAlchemy
│   │   └── main.py       # Główna aplikacja FastAPI
│   ├── tests/            # Testy automatyczne pytest
│   ├── Dockerfile        # Obraz produkcyjny Python 3.12-slim
│   └── pyproject.toml    # Zależności i konfiguracja Ruff/Pytest
├── docker-compose.yml    # Orkiestracja serwisów db, api, web
├── .env.example          # Szablon zmiennych środowiskowych
└── README.md
```

---

## 3. Szybki start (Docker Compose)

### Wymagania
- Docker & Docker Compose

### Uruchomienie
1. Skopiuj plik środowiskowy:
   ```bash
   cp .env.example .env
   ```
2. Zbuduj i uruchom kontenery w tle:
   ```bash
   docker compose up --build -d
   ```
   Kontener API automatycznie zastosuje oczekujące migracje Alembica przed uruchomieniem serwera.
3. Aplikacja jest dostępna pod adresami:
   - **Frontend (Web):** [http://localhost:3000](http://localhost:3000)
   - **Backend API:** [http://localhost:8000](http://localhost:8000)
   - **Dokumentacja Swagger:** [http://localhost:8000/docs](http://localhost:8000/docs)
   - **Healthcheck API:** [http://localhost:8000/api/health](http://localhost:8000/api/health)
   - **Healthcheck Bazy:** [http://localhost:8000/api/health/db](http://localhost:8000/api/health/db)

### Uwierzytelnianie (Etap 3)

Endpointy są dostępne pod prefiksem `/api/auth`:

- `POST /register` — rejestracja konta i wysłanie kodu weryfikacyjnego
- `POST /verify` i `POST /resend-code` — potwierdzenie adresu e-mail i ponowna wysyłka kodu
- `POST /login` — token JWT dla aktywnego konta
- `POST /forgot-password` i `POST /reset-password` — reset hasła kodem
- `GET /me` i `PATCH /me` — profil, motyw oraz zgoda na powiadomienia

Domyślnie `EMAIL_MODE=mock`: kod jest wypisywany w logach API, co pozwala uruchomić projekt bez konta pocztowego. Dla SMTP ustaw `EMAIL_MODE=smtp` oraz `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` i `SMTP_FROM` w lokalnym `.env`. Nie umieszczaj haseł ani kluczy pocztowych w repozytorium.

### Spotkania i linki

- `POST /api/events` — utworzenie spotkania (nazwa i opis; dni oraz godziny wybierają uczestnicy).
- `GET /api/events` — lista spotkań zalogowanego użytkownika.
- `GET /api/events/{public_id}` — publiczne szczegóły spotkania dostępne z linku.
- `POST /api/events/{public_id}/join` — dołączenie do spotkania po zalogowaniu.
- `GET /api/events/{public_id}/membership` — sprawdzenie członkostwa.

Link udostępniony uczestnikom otwiera stronę konkretnego spotkania. Konto jest wymagane do dołączenia; po logowaniu lub rejestracji użytkownik wraca do spotkania i zostaje do niego dodany.

---

## 4. Uruchomienie lokalne (Development)

### Backend
```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/macOS:
# source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

---

## 5. Testy automatyczne

### Testy backendu (pytest & ruff)
```bash
cd backend
pytest -v
ruff check .
```

### Testy frontendu (Vitest & typecheck)
```bash
cd frontend
npm run test
npm run lint
```

---

## 6. Informacja o wykorzystaniu AI (Oświadczenie)

Zgodnie z wymaganiami projektu i zasadami transparentności:
- Projekt **Bit2Meet** jest rozwijany we współpracy z asystentem AI (**Antigravity / Gemini**).
- Każdy fragment kodu, konfiguracji oraz architektury podlegał rygorystycznemu cyklowi weryfikacji: planowanie, wdrożenie, statyczna analiza kodu, testy jednostkowe oraz testy uruchomieniowe.
- AI było wykorzystywane jako zaawansowane narzędzie wspierające projektowanie architektury, generowanie szablonów testów i automatyzację powtarzalnych zadań programistycznych.
