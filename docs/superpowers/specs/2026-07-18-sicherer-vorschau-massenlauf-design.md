# Sicherer, selbstlaufender Vorschau-Massenlauf (Karten + Abenteuer) — Design

> **Status:** Spec, vom Owner freigegeben 2026-07-18. Bau in EIGENER, frischer Session (Session-Hygiene).
> **Anlass:** Der Karten-Vorschau-Massenlauf war 2026-07-17 der Auslöser des 3×-PHP-Pool-Hängers. Diese
> Session (Menüband-Konsistenz) hat die „Vorschauen holen"-Kachel in BEIDEN Editoren deshalb vorerst
> `disabled` gesetzt. Dieses Feature macht den Lauf sicher und schaltet die Kachel wieder scharf.
> **Kontext-Memories:** `php-pool-hang-incident-2026-07-17`, `citymaps-autoget-vorschauen`,
> `editor-menuband-consistency`, `adventures-feature-phase1`.

## 1. Ziel

Der „Vorschauen holen"-Lauf (Karten **und** Abenteuer) soll nach **einem** Klick sicher bis zum Ende
durchlaufen, ohne den PHP-Pool zu sättigen, und jederzeit stoppbar sein.

**Owner-Entscheidungen (nicht neu verhandeln):**
- **Quasi-Hintergrund, KEIN Cron/SSH/Hosting-Umbau.** Ein Klick „starten", dann treibt der bestehende
  Client-Loop die Schritte selbst; der Owner kann weiterarbeiten. Tab/Browser zu = Lauf pausiert, der
  Fortschritt bleibt server-seitig gespeichert und läuft beim nächsten Öffnen weiter. **Kein** echter
  Tab-zu-Weiterlauf gewünscht (das bräuchte Cron oder eine selbst-triggernde Server-Kette — bewusst NICHT).
- **EIN gemeinsamer Schlüssel für beide Läufe:** systemweit läuft immer nur *ein* Vorschau-Lauf
  gleichzeitig (egal ob Karten oder Abenteuer) — die ruhigste Wahl.
- Der Session-NFS-Lock ist bereits gelöst (`avesmapsCurrentUser()` → `session_write_close()`,
  `api/_internal/auth.php:38`, Fix `1a1d5ede`) — **nicht** nochmal anfassen, ist NICHT Teil der Wurzel hier.

## 2. Die vier Sicherheitsmechanismen (endpunkt-agnostisch)

Sie regeln **wie oft** und **wie lange** gearbeitet wird — unabhängig davon, WAS geholt wird. Deshalb
gelten sie identisch für den Karten- und den Abenteuer-Lauf.

| # | Mechanismus | Was es tut |
|---|---|---|
| 1 | **Single-Flight-Lock** | `GET_LOCK('<gemeinsamer_name>', 0)` (non-blocking, Timeout 0) am **Anfang jedes Schritts**. Ist er belegt → sofort `{ok:true, busy:true}` zurück, ohne einen Worker lange zu halten. `RELEASE_LOCK` im `finally`. Connection-scoped → bei Crash/Verbindungsabbruch **automatisch frei**. Verhindert, dass ein 2. Tab / Reload / Agent einen zweiten Lauf startet (der tab-lokale JS-Guard `isCitymapAutogetRunning` kann das NICHT). **Gemeinsamer Lock-Name für beide Endpunkte.** |
| 2 | **Zeitbudget statt fixer Quellenzahl** | Der Schritt arbeitet Quellen ab, bis ~**4 s** Wall-Clock (`microtime(true)`) erreicht sind, dann gibt er zurück (`done:false`, `remaining:N`). Ersetzt das heutige fixe `AVESMAPS_CITYMAP_AUTOGET_STEP_SOURCES = 25` (≈15 s/Schritt). Ein Worker ist so nie länger als ~4 s belegt. Der Client-Loop ruft einfach öfter. |
| 3 | **`EnsureTables` raus aus dem Schritt-Pfad** | `avesmapsCitymapsEnsureTables($pdo)` (heute `citymap-autoget.php:40`, bei JEDEM Request) darf im `autoget_step` NICHT mehr laufen — nur bei `status`/`reset` (selten). Die Tabellen existieren längst; die Metadaten-Proben auf NFS sind reine Last (siehe Incident §„Herz-und-Nieren-Audit"). |
| 4 | **Kill-Switch (DB-Flag)** | Ein `app_setting`-Flag (Muster `avesmapsCitymapsEnabled`), das JEDER Schritt am Anfang prüft → belegt/„stop" ⇒ sofort `{ok:true, stopped:true}` zurück, der Client-Loop bricht sauber ab. Tab-übergreifendes Not-Aus (der Browser-„Stop" wirkt nur pro Tab; PHP läuft nach Verbindungsabbruch weiter). |

**Der tragende Effekt = 1 + 2 kombiniert:** höchstens EIN Lauf, höchstens ~4 s Worker-Zeit pro Schritt →
der Lauf kann den Pool nicht mehr sättigen, egal wie viele Tabs/Klicks.

## 3. Karten-Lauf — die vier Mechanismen NACHRÜSTEN

Bestehend, wird umgebaut:
- `api/edit/map/citymap-autoget.php` — Endpunkt (`autoget_step`/`status`/`reset`). Lock + Zeitbudget +
  Kill-Switch rein, `EnsureTables` aus dem Schritt-Pfad.
- Geteilter Fetch `avesmapsCitymapAutogetOne($pdo, $publicId, $mapUrl, ?$knownImageUrl)` in
  `api/_internal/app/citymaps.php` — **unverändert** (er zieht EIN Bild; die Sicherheit sitzt drumherum).
- `js/review/review-citymap-autoget.js` — `startCitymapAutoget` versteht neu die `busy`- und
  `stopped`-Antwort (meldet „läuft schon woanders" / bricht ab, statt zu doppeln). Ein-Klick-Selbstlauf
  bleibt. `AVESMAPS_CITYMAP_AUTOGET_MAX_STEPS = 40` ggf. anheben (mehr, kürzere Schritte).

## 4. Abenteuer-Cover-Lauf — NEU nach demselben Muster

Einen Massenlauf gibt es dafür noch nicht (Cover werden heute nur beim Sync gezogen —
`avesmapsAdventureSaveCoverLocal` in `api/_internal/wiki/adventure-sync.php` — oder einzeln im Editor über
`api/edit/map/adventure-cover.php`).

- **Neuer Endpunkt** `api/edit/map/adventure-cover-autoget.php` (Muster `citymap-autoget.php`, cap `edit`),
  Actions `autoget_step`/`status`/`reset`, mit denselben vier Mechanismen (gemeinsamer Lock-Name!).
- **Arbeitseinheit** = ein Abenteuer, dessen lokales Cover fehlt und das eine Cover-Quelle hat. Der
  geteilte Fetch ist `avesmapsAdventureSaveCoverLocal` (wiederverwenden, nicht neu bauen) — nur bei
  Änderung, `own`>`wiki`-Override respektieren (existiert schon).
- **Fortsetzbarkeit:** ein Zustandsfeld analog `citymap.thumb_auto_state` — z. B. `adventure.cover_auto_state`
  (NULL=offen | `ok`|`no_image`|`fetch_failed`|`skipped_manual`), self-healing DDL. Fälligkeits-Query
  NICHT auf ein Herkunfts-Feld filtern (Falle aus `citymaps-autoget-vorschauen`: der Default schließt sonst
  alles aus). Zustand **pro Abenteuer direkt nach dem Fetch** schreiben, nie Batch-Lease vorab.
- **Client-Loop-Zwilling** `js/review/review-adventure-cover-autoget.js` (Muster
  `review-citymap-autoget.js`), `window.startAdventureCoverAutoget`.

## 5. Editoren — Kachel wieder scharf schalten

Beide „Vorschauen holen"-Kacheln sind aktuell `disabled` (diese Session, `editor-menuband-consistency`):
- `html/citymap-editor.html` — `ceAutogetBtn`: `disabled` weg, Klick-Handler + `refreshCeAutogetInfo`
  wieder verdrahten (die Funktionen stehen noch, nur auskommentiert/unverdrahtet).
- `html/adventure-editor.html` — `aeAutogetBtn`: `disabled` weg, Handler an den neuen Client-Loop hängen
  (heute hat die Kachel gar keinen Handler).
- Beide: `busy`/`stopped`-Rückmeldung im Sub-Label anzeigen. Die Icon-Politik bleibt (kein Icon außer sync).
- **`ASSET_VERSION`:** beide Editoren laden mit `?v=Date.now()` → **kein** Bump nötig; nie `?v=` von Hand.

## 6. Nicht-Ziele

- Kein Cron, kein SSH-CLI, kein Dauerprozess, keine selbst-triggernde Server-Kette (Owner: Quasi-Hintergrund
  reicht). STRATO-PHP ist ohnehin CGI (CLI-Skripte scheitern an SAPI-Guards, `discord-bot-phase1`).
- Keine Änderung am eigentlichen Bild-Fetch (`avesmapsCitymapAutogetOne` / `avesmapsAdventureSaveCoverLocal`)
  außer dem Aufruf-Rahmen.
- Kein Anfassen des Session-Locks (schon gelöst).

## 7. Verifikation

- **Sicherheitslogik lokal testbar** (kein Prod nötig): der Single-Flight-Lock (zwei parallele
  `autoget_step` → der zweite bekommt `busy`), das Zeitbudget (ein Schritt endet nach ~4 s mit `done:false`),
  der Kill-Switch (Flag gesetzt → `stopped:true`). Gegen einen lokalen `php -S` + Fake-PDO oder eine
  lokale SQLite/MySQL, ggf. Unit-Test der reinen Budget-/Lock-Wrapper. **STRATO-Regel: Live-Endpunkte NIE
  loopen** — die Sicherheit gerade dieses Endpunkts lokal beweisen, nicht auf Prod.
- **Bild-Fetch (Abenteuer) braucht echte Daten** → **🔧 Owner-Live-Durchlauf** am Ende (ein „Dump holen"
  gibt es schon; dann „Vorschauen holen" im Editor). Wie beim Sync: E2E nur mit Prod-DB möglich.
- **Regressions-Check:** die bestehenden Tests (`citymap-gate-test` etc.) müssen grün bleiben.

## 8. Betroffene Dateien (Anker, exakt im Plan)

- `api/edit/map/citymap-autoget.php` — Lock + Zeitbudget + Kill-Switch, `EnsureTables` raus.
- `api/_internal/app/citymaps.php` — ggf. Helfer für Lock/Budget/Kill-Switch (geteilt).
- `js/review/review-citymap-autoget.js` — `busy`/`stopped` verstehen.
- **NEU** `api/edit/map/adventure-cover-autoget.php` — Abenteuer-Massenlauf.
- `api/_internal/app/adventures.php` — `cover_auto_state` + Fälligkeits-Query + Kill-Switch-Flag-Helfer.
- **NEU** `js/review/review-adventure-cover-autoget.js` — Client-Loop-Zwilling.
- `html/citymap-editor.html`, `html/adventure-editor.html` — Kacheln wieder scharf.
- Bootstrap/Wiring in `index.html` bzw. `js/review/*` für die neue globale `startAdventureCoverAutoget`.
