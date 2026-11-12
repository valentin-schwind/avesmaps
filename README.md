# Avesmaps3D

Avesmaps3D ist die Neuentwicklung von [Avesmaps](https://avesmaps.de/), der Karte und dem Routenplaner für Aventurien, die Welt von
Das Schwarze Auge. Die Karte lässt sich drehen und neigen, rechnet Reisen über das Wegenetz und zeigt Orte, Herrschaftsgebiete, Landschaften
und Sprachen. Ein nicht-kommerzielles Fanprojekt von Valentin Schwind und Thomas Braun, ohne Verbindung zu Ulisses Spiele.

*English: Avesmaps3D is the rewrite of Avesmaps, a 3D map and route planner for Aventuria, the world of The Dark Eye. A non-commercial fan
project. The code is MIT-licensed; the map data and all DSA material are not (see [`LEGAL.md`](LEGAL.md)). Comments and documentation are in
German.*

## Über diesen Zweig

- Dieser Zweig ist eine **Ausgabe** aus dem Arbeitsrepository von Avesmaps3D. Jeder Commit heißt „Avesmaps3D, Stand `<sha>`“ und zeigt den
  Quelltext, der zu diesem Stand auf [avesmaps.de](https://avesmaps.de/) läuft. Der Diff zwischen zwei Ausgaben zeigt, was sich geändert
  hat; einzelne Entwicklungscommits gehen nicht mit.
- Der bisherige Stand von Avesmaps (Leaflet, PHP) liegt unverändert im Zweig `master`.
- Beiträge sind willkommen, laufen aber anders als gewohnt: siehe [`CONTRIBUTING.md`](CONTRIBUTING.md). Sicherheitslücken bitte nicht als
  Issue, sondern wie in [`SECURITY.md`](SECURITY.md) beschrieben.
- Einige Verweise im Quelltext zeigen auf Arbeitsunterlagen (`project-control/`, `docs/planning/`, Work Items wie `WI-0303`), die privat
  bleiben. Sie erklären, woher eine Entscheidung kommt; für das Verständnis des Codes sind sie nicht nötig.

## Aufbau

```text
apps/server         Fastify-Server (TypeScript, ESM), Jobs, Migrationen (PostgreSQL 18, PostGIS 3.6)
apps/web            Oberfläche: Vue 3, Vite, MapLibre GL JS
packages/shared     gemeinsame Verträge (TypeBox), von Server und Oberfläche genutzt
config              Konfiguration, Rechtstexte, Versionsnotizen
scripts, tools      Bau-, Prüf- und Datenwerkzeuge
docs/schnittstellen Schnittstellen für Außenstehende
```

## Lokal starten

Voraussetzungen: Node.js 24 oder neuer, PostgreSQL 18 mit PostGIS 3.6. Entwickelt wird auf Windows mit PowerShell, der Server läuft auf Linux;
beides funktioniert.

```powershell
npm install
Copy-Item .env.example .env   # danach DATABASE_URL und TEST_DATABASE_URL anpassen
npm run db:migrate
npm run dev:server            # http://127.0.0.1:3000/health
npm run dev:web               # http://127.0.0.1:5173
```

Prüfen wie vor jedem Beitrag:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
```

Die Tests mit Datenbank laufen gegen `TEST_DATABASE_URL` und leeren sie zwischen den Fällen; ohne die Variable werden sie übersprungen.

### Grenzen beim Nachbauen

- **Die Kartendaten sind nicht dabei.** Orte, Wege, Gebiete, Kacheln und Gelände liegen in der Datenbank und in Datenordnern des Betriebs,
  nicht in diesem Zweig, und dürfen hier auch nicht verbreitet werden (siehe [`LEGAL.md`](LEGAL.md)). Ein eigener Aufbau startet mit einer
  leeren Karte.
- Kacheln, Höhenmodell, Medien, WikiSync, Discord und die Anmeldung brauchen weitere Dienste und Zugänge, die nur im Betrieb eingerichtet sind.
- Einige Tests prüfen Arbeitsunterlagen, die nicht in diesem Zweig liegen, und schlagen hier fehl.

## Schnittstellen

- Entwickler-API v1 (ohne Schlüssel, für jede Herkunft offen: Orte, Suche, Reisen): [`docs/schnittstellen/entwickler-api.md`](docs/schnittstellen/entwickler-api.md),
  maschinenlesbar unter `https://avesmaps.de/api/v1/openapi.json`
- Karten-API v1 (mit Schlüssel, für Kartenpakete): [`docs/schnittstellen/karten-api.md`](docs/schnittstellen/karten-api.md)
- Alle übrigen Routen unter `/api/` sind intern und können sich mit jeder Ausgabe ändern.

## Lizenz und Rechte

- Der selbst geschriebene Programmcode steht unter der MIT-Lizenz: [`LICENSE`](LICENSE).
- Was davon erfasst ist und was ausdrücklich nicht (Kartendaten, DSA-Namen und -Texte, Bilder, Marken): [`LEGAL.md`](LEGAL.md).
- Quellen, Fanrichtlinien und Marken: [`NOTICE.md`](NOTICE.md).

Artwork © Ulisses Spiele. DAS SCHWARZE AUGE, AVENTURIEN, DERE, MYRANOR, THARUN, UTHURIA, RIESLAND und THE DARK EYE sind eingetragene Marken
der Ulisses Spiele GmbH, Waldems.
