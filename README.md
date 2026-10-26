# Bit2Meet

Bit2Meet to aplikacja do wspólnego ustalania terminów spotkań. Użytkownicy mogą tworzyć wydarzenia, zapraszać innych przez link lub znajomych, zaznaczać dostępność w kalendarzu i rozmawiać na czacie wydarzenia. Aplikacja oferuje też profile, powiadomienia i wspólny grafik znajomych.

## Uruchomienie

1. Zainstaluj i uruchom [Docker Desktop](https://www.docker.com/products/docker-desktop/).
2. Otwórz terminal w folderze projektu.
3. Utwórz plik konfiguracyjny `.env` z przykładowego pliku:

   ```powershell
   Copy-Item .env.example .env
   ```

   Jeśli `.env` już istnieje, nie kopiuj pliku ponownie. Domyślna konfiguracja używa testowej poczty (`EMAIL_MODE=mock`), więc nie trzeba ustawiać danych SMTP. Kody rejestracyjne można odczytać w logach API.

4. Zbuduj i uruchom aplikację:

   ```powershell
   docker compose up --build -d
   ```

5. Otwórz aplikację: [http://localhost:3000](http://localhost:3000).

Przy pierwszym uruchomieniu Docker pobierze potrzebne obrazy, a baza danych zostanie przygotowana automatycznie.

Zatrzymanie aplikacji:

```powershell
docker compose down
```

## Technologie

React, TypeScript, FastAPI, PostgreSQL, SQLAlchemy, Alembic i Docker Compose.

## Wykorzystanie AI

Podczas tworzenia projektu korzystano z narzędzi AI, w tym ChatGPT, do wsparcia projektowania, implementacji i poprawiania kodu. Wprowadzone zmiany były weryfikowane przez autora projektu.

## Lubie pizze i kebsa