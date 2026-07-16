# Design: Linkchecker, Abenteuer-Liste, Kartensammlung, Menü-Vereinheitlichung, Regionen-Infopanel

**Datum:** 2026-07-16
**Aufgaben:** A (Linkchecker) · B (Abenteuerdialog als Liste) · C (Kartensammlung) · D (schwebende Menüs) · E (Regionen-Infopanel)

Fünf Aufgaben, eine Kette: **A** ist das Fundament für **B** und **C**, **C** ist das Fundament für **E**, **D** ist ein isolierter Bugfix, den **E** trotzdem braucht (sonst brechen die neuen Kacheln um).

---

## 0. Reihenfolge & Abhängigkeiten

```
A (Linkchecker) ─┬─> B (Abenteuer-Liste)
                 └─> C (Kartensammlung) ──> E (Regionen)
D (Menü-Fix) ─────────────────────────────> E
```

| Phase | Inhalt | Parallelisierbar |
|---|---|---|
| 1 | **A** + **D** | ja — disjunkte Dateien |
| 2 | **B** | nein — teilt `place-extras.js` + Abenteuer-Backend mit C |
| 3 | **C** | nein |
| 4 | **E** | nein — braucht C's Kartensammlung-Sektion |

Smoketests erst am Ende jeder Phase, nicht zwischendurch.

---

## 1. Aufgabe A — Linkchecker

Eigenständiges Modul. **Kennt weder Abenteuer noch Karten** — es kennt nur URLs, ihren Zustand und wer sie referenziert. Anbindung über eine Provider-Registry.

### 1.1 Warum kein Cron

STRATO nutzt keinen Cron (`docs/refactoring-wikidump-migration.md:409`: „Kein Cron nötig"), und schwere Endpoints in Schleifen haben hier schon einmal die PHP-Worker gesättigt (AGENTS.md §9). Deshalb dasselbe Muster wie der WikiSync-Dump-Treiber: **ein begrenzter Schritt pro Request, der Client treibt die Wiederholung.** Dazu ein CLI-Skript für den Vollbestand ohne 28-Sekunden-Deckel.

### 1.2 Datenmodell (self-healing DDL, Muster `api/_internal/app/feature-sources.php:7`)

`link_status` — der Cache. Identität ist der URL-Hash, weil `url` als `TEXT` nicht indizierbar ist (dieselbe Begründung wie bei `sources.url_hash`).

| Spalte | Typ | Bedeutung |
|---|---|---|
| `id` | `BIGINT UNSIGNED AUTO_INCREMENT PK` | |
| `url` | `TEXT NOT NULL` | |
| `url_hash` | `CHAR(64) NOT NULL` | `sha256(url)`, `UNIQUE` |
| `host` | `VARCHAR(190) NOT NULL DEFAULT ''` | für Throttle/Diagnose |
| `state` | `VARCHAR(16) NOT NULL DEFAULT 'unchecked'` | `unchecked` \| `online` \| `dead` |
| `http_status` | `SMALLINT UNSIGNED NOT NULL DEFAULT 0` | 0 = kein HTTP (Timeout/DNS) |
| `redirect_url` | `TEXT NULL` | Endziel nach Redirects |
| `fail_streak` | `INT UNSIGNED NOT NULL DEFAULT 0` | aufeinanderfolgende Fehlschläge |
| `first_failed_at` | `DATETIME(3) NULL` | |
| `last_checked_at` | `DATETIME(3) NULL` | |
| `last_online_at` | `DATETIME(3) NULL` | |
| `check_after` | `DATETIME(3) NULL` | Fälligkeit **und** Lease (siehe 1.5) |
| `created_at` / `updated_at` | `DATETIME(3)` | |

Indizes: `UNIQUE uq_link_status_url_hash (url_hash)`, `KEY idx_link_status_due (check_after)`, `KEY idx_link_status_state (state)`.

`link_ref` — die Registry. Beantwortet „welche Entität hängt an dieser URL" und damit auch „zeig mir alle toten Links".

| Spalte | Typ |
|---|---|
| `id` | `BIGINT UNSIGNED AUTO_INCREMENT PK` |
| `url_hash` | `CHAR(64) NOT NULL` |
| `entity_type` | `VARCHAR(24) NOT NULL` — `adventure` \| `citymap` \| `source` |
| `entity_public_id` | `VARCHAR(64) NOT NULL` |
| `field` | `VARCHAR(32) NOT NULL DEFAULT ''` — `link_fshop`, `wiki_url`, `map_url`, `extra:<id>` … |
| `label` | `VARCHAR(200) NOT NULL DEFAULT ''` |
| `seen_at` | `DATETIME(3) … ON UPDATE CURRENT_TIMESTAMP(3)` |

Indizes: `UNIQUE uq_link_ref (entity_type, entity_public_id, field, url_hash)`, `KEY idx_link_ref_hash (url_hash)`, `KEY idx_link_ref_entity (entity_type, entity_public_id)`.

### 1.3 Zustandslogik

Drei Zustände nach außen, weil der Owner „noch nicht geprüft" sichtbar haben will:

- **`unchecked`** → „noch nicht geprüft" (grau). Registriert, aber nie erfolgreich beurteilt.
- **`online`** → „(online)" (grün). Letzter Check war 2xx.
- **`dead`** → „(nicht mehr erreichbar)" (grau, durchgestrichener Link).

Der Übergang ist **nicht** naiv, sonst macht ein einzelner Timeout einen lebenden Link tot:

| Ergebnis | Wirkung |
|---|---|
| 2xx (auch nach Redirects) | `state='online'`, `fail_streak=0`, `last_online_at=NOW()` |
| 404 / 410 / 403 / 401 | **sofort** `state='dead'` — definitiv |
| 429 / 408 | kein Urteil, nur `check_after` verschieben (wir wurden gedrosselt) |
| 5xx / Timeout / DNS | `fail_streak++`; erst ab `fail_streak >= 3` → `state='dead'` |

`AVESMAPS_LINK_DEAD_STREAK = 3`. Ein bisher `online`er Link bleibt also bei einem 500er weiter grün — das ist Absicht: der Serverfehler ist wahrscheinlich transient, und eine flackernde Anzeige wäre schlimmer als eine leicht verzögerte.

Recheck-Kadenz: `online` → +7 Tage; `dead` → +14 Tage (tote Links kommen manchmal zurück, aber wir hämmern nicht); `429/408` → +1 Tag.

### 1.4 HTTP-Prüfung

`avesmapsLinkCheckProbe(string $url): array` in `api/_internal/linkcheck/probe.php`.

- **HEAD zuerst** (`CURLOPT_NOBODY`), bei 405/501/400 **GET-Fallback** mit `Range: bytes=0-0`. Viele Shops mögen HEAD nicht.
- cURL-Optionen nach dem härtesten Vorbild im Repo (`api/_internal/wiki/dump-fetch.php:424`): `SSL_VERIFYPEER=true`, `SSL_VERIFYHOST=2`, `PROTOCOLS`/`REDIR_PROTOCOLS = CURLPROTO_HTTP|CURLPROTO_HTTPS`, `FOLLOWLOCATION=true`, `MAXREDIRS=5`, `TIMEOUT=15`, `CONNECTTIMEOUT=8`, **`FAILONERROR=false`** (wir werten den Status selbst aus).
- User-Agent nach Hauskonvention: `AvesmapsLinkBot/1.0 (+https://avesmaps.de)`.
- **SSRF-Riegel:** Schema muss `http`/`https` sein; der aufgelöste Host darf nicht in Loopback / RFC1918 / Link-Local / CGNAT liegen. Die URLs stammen zwar durchweg von `edit`-berechtigten Editoren (Community-Vorschläge landen erst nach Freigabe hier), aber ein Modul, das beliebige URLs abruft, bekommt den Riegel trotzdem.
- **Höflichkeit:** `avesmapsWikiSyncThrottleWikiRequest()`-Analog — 600ms + Jitter **pro Host**, nicht global.

### 1.5 Nebenläufigkeit ohne Lock-Tabelle

Kein Lock-Row. Stattdessen **Lease**: der Schritt stempelt vor dem Prüfen `check_after = NOW() + 5 MINUTE` auf die selektierten Zeilen. Ein paralleler Läufer sieht sie dann nicht mehr als fällig. Stürzt der Läufer ab, wird die Zeile nach 5 Minuten von selbst wieder fällig. Kein Aufräumen, kein Stale-Takeover, keine 409er.

### 1.6 Provider-Registry

```php
// api/_internal/linkcheck/providers.php
function avesmapsLinkCheckProviders(): array {
    return [
        'adventure' => 'avesmapsLinkCheckCollectAdventureLinks',
        'citymap'   => 'avesmapsLinkCheckCollectCitymapLinks',
        'source'    => 'avesmapsLinkCheckCollectSourceLinks',
    ];
}
```

Jeder Provider gibt `[['entity_public_id'=>…, 'field'=>…, 'label'=>…, 'url'=>…], …]` zurück. Der `sync`-Schritt schreibt daraus `link_ref` (Upsert, `seen_at` gestempelt), legt fehlende `link_status`-Zeilen als `unchecked` an, und löscht `link_ref`-Zeilen, deren `seen_at` älter als der Sync-Beginn ist (= die URL steht nicht mehr am Objekt). `link_status`-Zeilen ohne jede `link_ref` werden gelöscht — sonst prüfen wir bis in alle Ewigkeit Links, die niemand mehr hat.

**`source`-Provider Sonderfall:** `sources`-Zeilen mit `url = ''` (die Wiki-Publikationen, gehasht als `wikipub:<wiki_key>`) werden übersprungen — da ist nichts zu prüfen.

### 1.7 API

**Öffentlich, das „einfache API" aus der Aufgabenstellung:**
`GET /api/app/link-status.php?hashes=<h1>,<h2>,…` (max 200) → `{ok:true, statuses:{"<hash>":{state,http_status,checked_at}}}`. Für Seiten, die Links haben, aber keinen eigenen Payload — die Integrations-Luke.

**Eingebettet, der schnelle Weg:** `api/app/adventures.php` und `api/app/citymaps.php` liefern den Status pro Link direkt mit (LEFT JOIN auf `link_status`). Kein zweiter Roundtrip, kein Nachladen im Dialog.

**Editor:** `POST /api/edit/map/link-check.php`, Capability `edit`, Actions:

| Action | Wirkung |
|---|---|
| `sync` | Registry neu aufbauen (begrenzt, `done`-Flag) |
| `check_step` | bis zu 40 fällige Links / max 25s prüfen → `{done, checked, online, dead, remaining}` |
| `status` | Zähler: total / online / dead / unchecked / fällig |
| `recheck` | `check_after=NOW()` für einen Hash oder eine Entität erzwingen |

Client-Schleife `while (!done)` mit `MAX_STEPS`-Sicherung, exakt wie `js/review/review-wiki-sync.js:621`.

**CLI:** `scripts/check-links.php` — voller Durchlauf ohne Zeitlimit, `--dry-run` als Default, `--confirm` zum Schreiben (Muster `scripts/migrate-other-source-to-sources.php`).

### 1.8 Frontend-Modul

`js/app/link-status.js`, eine Funktion:

```js
avesmapsLinkStatusMarkup(state)  // -> ' <span class="link-status link-status--online">(online)</span>' | … | ''
```

Und `css/components/link-status.css`. **Zwei neue Tokens** in `css/base/tokens.css` (die Design-Regel verlangt: erst Token, dann benutzen — ein passendes Paar existiert nicht):

```css
--color-status-online: var(--color-success);   /* themefähig, hell #2f7d3a / dunkel #7cc48a */
--color-status-offline: #8b8478;               /* + Dark-Override */
```

Nicht `--color-map-presence*` nehmen: das ist bewusst in beiden Themes identisch gepinnt (es liegt auf den immer hellen Kartenkacheln) und würde im Dark Mode nicht mitziehen.

i18n: `linkStatus.online` / `linkStatus.dead` / `linkStatus.unchecked` in beide String-Tabellen.

---

## 2. Aufgabe B — Abenteuerdialog als Liste

### 2.1 Was sich ändert und was nicht

**Nur der Dialog** wird zur Liste. Der Streifen im Infopanel bleibt der horizontale Cover-Streifen — der Owner hat ihn so bestellt („Der Dialog von Abenteuern … soll die Abenteuer anders darstellen").

### 2.2 Das Klon-Problem

Es gibt **zwei** Dialoge: der flache (`#avesmaps-adv-dialog`, `map-features-place-extras.js:380`) **klont die DOM-Karten des Streifens**; der verschachtelte (`#avesmaps-adv-tree-dialog`) rendert datengetrieben. Eine Zeile mit Link-Spalte lässt sich aus einer 78px-Streifenkarte nicht klonen — die Links stehen dort nicht im DOM.

**Entscheidung: beide Dialoge werden datengetrieben.** Der flache holt seine Daten künftig genauso aus dem Katalog-Index wie der verschachtelte, über `data-adv-scope` + einen neuen `data-adv-place-key` am Section-Wrapper. Der Klon-Pfad entfällt. Das ist kein Umweg, sondern räumt den Grund auf, warum die zwei Dialoge überhaupt auseinanderliefen.

Mitgenommen wird dabei die vom Recon gefundene Doppelung: `dialogFiltersMarkup()` (`place-extras.js:423`) und `filtersMarkup()` (`adventures-dialog.js:117`) sind ~40 fast identische Zeilen, die bei jeder Filteränderung zweimal angefasst werden müssen → eine geteilte `advFiltersMarkup()`.

### 2.3 Zeilen-Layout

Neuer Builder `buildAdventureRowMarkup(a)` neben dem bestehenden `buildAdventureCardMarkup(a, …)`. Grid `62px | minmax(0,1fr) | 196px`:

- **links** Thumb 62×88 (A4), bleibt der **Primärlink** (`advBestLink` → Ulisses → F-Shop → Wiki → DNB), unverändert.
- **Mitte** Titel (→ Wiki), Edition · BF-Jahr · Produkttyp, Genre · Komplexität, „enthalten in: …".
- **rechts** alle Links mit Status-Marker. Tote Links bleiben klickbar, durchgestrichen, grau.

Dialogbreite `min(680px)` → `min(860px, 100%)`. Filterleiste, Sortierung und Spoiler-Umschalter bleiben wie sie sind.

### 2.4 Zusatzlinks

Neue Tabelle `adventure_link`:

| Spalte | Typ |
|---|---|
| `id` | `INT AUTO_INCREMENT PK` |
| `adventure_id` | `INT NOT NULL` |
| `label` | `VARCHAR(120) NOT NULL` — z.B. „Rezension von XY" |
| `url` | `VARCHAR(500) NOT NULL` |
| `sort_order` | `INT NOT NULL DEFAULT 0` |
| `origin` | `VARCHAR(16) NOT NULL DEFAULT 'manual'` |
| `status` | `VARCHAR(16) NOT NULL DEFAULT 'approved'` |
| `created_at` / `updated_at` | `DATETIME(3)` |

`KEY idx_adventure_link_adventure (adventure_id, sort_order)`.

Editor: neue Gruppe „Weitere Links" in `html/adventure-editor.html` unter „Shop-Links" — Zeilen aus Titel + URL, ▲▼, Löschen. Eine Action `set_links` mit dem vollständigen Array (atomar, keine ID-Jonglage; die Links sind Blattdaten ohne Wiki-Reconcile, anders als die Orte).

### 2.5 Link-Liste serverseitig

Heute baut `advShopLinks()` (`place-extras.js:102`) die Linkliste **im Client**. Der Linkchecker braucht dieselbe Liste **im Server** (zum Registrieren und Hashen). Zwei Kopien derselben Prioritätsregel wären genau die Divergenz, die dieses Projekt schon einmal hatte.

**Entscheidung:** `avesmapsAdventureLinks(array $row, array $extraLinks): array` in `api/_internal/app/adventures.php` wird die einzige Definition. Sie liefert `[{key, label, url, url_hash}]` in Prioritätsreihenfolge. `api/app/adventures.php` hängt `state` an und liefert `links[]` im Payload; der Linkcheck-Provider nutzt dieselbe Funktion. Der Client nimmt `a.links` wenn vorhanden, sonst den alten Client-Builder (Platzhalterdaten ohne Backend).

Nebeneffekt: der veraltete Kommentar in `place-extras.js:124` („Ulisses -> F-Shop -> DNB -> Wiki", widerspricht dem eigenen Code) verschwindet mit.

---

## 3. Aufgabe C — Kartensammlung

Das Frontend-Gerüst existiert: `getPlaceCityMaps(location)` (`place-extras.js:63`) liest bereits `location.cityMaps` und fällt nur ersatzweise auf `AVESMAPS_PLACEHOLDER_CITYMAPS` zurück. Sobald echte Daten im Payload sind, retiriert sich der Platzhalter selbst. Backend: null.

### 3.1 Datenmodell

`citymap`:

| Spalte | Typ | Anmerkung |
|---|---|---|
| `id` | `INT AUTO_INCREMENT PK` | |
| `public_id` | `CHAR(36) NOT NULL` | `UNIQUE`, UUIDv4 |
| `title` | `VARCHAR(300) NOT NULL` | |
| `parent_id` | `INT NULL` | übergeordnete Karte |
| `map_url` | `VARCHAR(500) NOT NULL DEFAULT ''` | externer Link — **immer gespeichert, immer angezeigt** |
| `map_local_url` | `VARCHAR(500) NULL` | eigener Upload |
| `map_license` | `VARCHAR(24) NOT NULL DEFAULT 'unknown_other'` | |
| `map_license_note` | `VARCHAR(2000) NULL` | **editor-only** |
| `thumb_url` | `VARCHAR(500) NULL` | externes Thumb |
| `thumb_local_url` | `VARCHAR(500) NULL` | eigener Upload |
| `thumb_license` | `VARCHAR(24) NOT NULL DEFAULT 'unknown_other'` | |
| `thumb_license_note` | `VARCHAR(2000) NULL` | **editor-only** |
| `art` | `VARCHAR(24) NULL` | `politisch` \| `derographisch` \| `topologisch` \| `skizze` |
| `is_color` | `TINYINT(1) NULL` | **NULL = unbekannt** |
| `is_multilevel` | `TINYINT(1) NULL` | |
| `is_labeled` | `TINYINT(1) NULL` | „beschriftet (mit Legende)" |
| `is_official` | `TINYINT(1) NULL` | |
| `is_spoiler` | `TINYINT(1) NULL` | |
| `width_px` / `height_px` | `INT NULL` | Auflösung |
| `valid_from_bf` / `valid_to_bf` | `INT NULL` | zeitliche Gültigkeit |
| `author` | `VARCHAR(300) NULL` | Urheber |
| `note` | `VARCHAR(2000) NULL` | |
| `status` | `VARCHAR(16) NOT NULL DEFAULT 'approved'` | `approved` \| `suppressed` |
| `origin` | `VARCHAR(16) NOT NULL DEFAULT 'manual'` | `manual` \| `community` |
| `created_by` | `INT NULL` | |
| `created_at` / `updated_at` | `DATETIME(3)` | |

**Alle Eigenschaften außer Titel und Quelle sind optional.** `NULL` heißt *unbekannt* und wird in der Leseransicht **weggelassen** — nicht als „unbekannt" ausgeschrieben. Deshalb sind die Booleans `TINYINT NULL` (dreiwertig), nicht `NOT NULL DEFAULT 0`.

`citymap_type` (Mehrfachauswahl): `citymap_id` + `type_key`, PK auf beiden.
Werte: `ortsplan`, `stadtplan`, `bezirk`, `viertel`, `lageplan`, `uebersicht`, `schauplatz`, `grundriss`, `befestigungen`, `dungeon`, `hoehlen`, `krypten`, `katakomben`, `schatzkarte`, `region`, `sonstige`.

`citymap_place` — 1:1 zu `adventure_place` (`sort_order`, `raw_name`, `target_kind` ∈ settlement\|territory\|region\|path\|unresolved, `target_public_id`, `target_wiki_key`, `target_territory_path`, `status`, `origin`). Damit gilt der Ort-Autocomplete aus `docs/abenteuer-editor-p3-autocomplete.md` unverändert.

`citymap_related` — `citymap_id` + `related_citymap_id`, PK auf beiden. `parent_id` deckt „übergeordnet", diese Tabelle „verwandt".

### 3.2 Quellen — der bestehende Katalog

Karten hängen über `feature_sources` mit **`entity_type = 'citymap'`** am vorhandenen `sources`-Katalog (`url`, `label`, `source_type`, `is_official`, dedupliziert per `url_hash`). Kein zweites Quellenfeld. „Ulisses F-Shop" existiert damit einmal, nicht vierzigmal, und `source_type` (Regionalspielhilfe / Abenteuer / Bote / …) sowie die Linkprüfung kommen gratis mit.

Zu prüfen beim Bauen: `avesmapsReadFeatureSources` mischt für `settlement|region|path` noch das Legacy-`other_source` aus `map_features` dazu — für `citymap` darf dieser Zweig nicht greifen.

### 3.3 Lizenz & Bild-Gate

```php
const AVESMAPS_CITYMAP_LICENSES = ['public_domain', 'cc0', 'ai_generated', 'permission_granted', 'unknown_other'];
const AVESMAPS_CITYMAP_LICENSE_DEFAULT = 'unknown_other';
const AVESMAPS_CITYMAP_LICENSES_FREE  = ['public_domain', 'cc0', 'ai_generated', 'permission_granted'];
```

**Genau eine Definition**, in `api/_internal/app/citymaps.php`. Sowohl das öffentliche Gate als auch der Editor requiren diese Datei. (Beim Siedlungsbild-System ist dieselbe Liste an *drei* Stellen hartkodiert — das erben wir nicht.)

**Thumb und Karte haben getrennte Lizenzen** (Owner-Entscheidung): eine Quelle darf ein freies Cover und eine geschützte Karte haben.

Regeln:
- `map_url` (extern) — **immer gespeichert, immer ausgeliefert.**
- `map_local_url` / `thumb_local_url` — nur ausgeliefert, wenn die **jeweilige** Lizenz in `LICENSES_FREE` ist. Sonst `unset`.
- Der Upload-Button erscheint im Editor **nur**, wenn die jeweilige Lizenz in `LICENSES_FREE` ist.
- `*_license_note` verlässt den Editor nie.
- **Kein serverseitiges Nachziehen externer Bilder.** Das „neu ziehen" der Abenteuer-Cover funktioniert nur, weil die Quell-URL aus dem Wiki-Dateinamen *abgeleitet* wird und nie vom Client kommt. Eine beliebige externe Karten-URL abzurufen wäre SSRF. Upload only.
- Gefiltert wird **serverseitig** (Muster `map-features.php:276`), nicht clientseitig geblankt wie bei den Abenteuer-Covern. Was nicht raus darf, verlässt die Box nicht.

Kill-Switch `citymaps_enabled` über die generischen `avesmapsAppSettingGet/Set` (`api/_internal/app/adventures.php:129`) — nicht die handgeklöppelte Siedlungs-Variante duplizieren.

### 3.4 Upload

`POST /api/edit/map/citymap-image.php`, Capability `edit`, Slots `thumb` und `map`.
Muster `api/edit/wiki/settlement-images.php:183`: finfo-MIME (nie `$_FILES['type']`), PNG/JPEG/WebP/GIF, **kein SVG**, GD-Reencode, Zufallsdateiname, `chmod 0644`, realpath-begrenztes Aufräumen des Vorgängers.
Ziel: `/uploads/kartensammlungen/<safeId>/`. Thumb → längste Kante 400px. Karte → längste Kante 4000px, max 12 MB.
**Nebeneffekt:** GD liefert die Maße → `width_px`/`height_px` werden beim Upload automatisch gefüllt.

### 3.5 Endpoints

- `GET /api/app/citymaps.php` → `{ok, citymaps:[…], citymaps_enabled}`, Links inkl. `state`. Aufbau analog `api/app/adventures.php`, zwei Queries, kein N+1.
- `POST /api/edit/map/citymaps.php` (cap `edit`) → `list`, `detail`, `upsert_citymap`, `set_types`, `set_related`, `add_place`, `set_place`, `suppress_place`, `resolve_place`, `set_citymaps_enabled`.
- `POST /api/edit/map/citymap-image.php` (cap `edit`) → Upload.

### 3.6 Editor

`html/citymap-editor.html`, self-contained nach dem Vorbild `html/adventure-editor.html` (Inline-CSS/JS, Token-Alias-Block, Theme-Bootstrap, `?v=Date.now()` → **kein ASSET_VERSION-Bump nötig**).
Geöffnet über `#citymaps-editor-open`, Button **„Kartensammlung editieren"** im WikiSync-Reiter „Abenteuer", als neuer `.wiki-sync-panel__actions`-Block **unter** `.wiki-sync-adv-picker` (`index.html`, nach dem schließenden `</div>` der Picker-Karte). Verdrahtung neben `js/app/bootstrap.js:277`.
Die Kartenliste im Editor: gleiche Größe/Optik wie die Abenteuerliste (`.wiki-sync-adv-picker`, `css/features/review-panel.css:497`), Doppelklick öffnet die Karte.

### 3.7 Leser-Dialog

Fensterstruktur wie „Abenteuer in …": Kopf, Filterleiste, Liste, Fußzeile.
Filter: Typ (Mehrfach-Chips mit Zähler), Art, Quelle, farbig, mehrstöckig, beschriftet, offiziell, Spoiler, BF-Jahr.
**Unbekannte Werte werden nicht angezeigt** und matchen keinen Filter außer „alle".
**Spoiler:** Thumb unscharf + Overlay „Spoiler — aufdecken", Klick deckt auf. Analog zum „Spielt hier (Spoiler)"-Umschalter der Abenteuer.
Fußzeile: Hinweis „Karten sind externe Verweise. Vorschau nur bei freier Lizenz." + Button „Karte vorschlagen".

### 3.8 Community-Vorschlag

**Nicht** über „Änderung vorschlagen", sondern ein eigener Dialog direkt aus der Kartensammlung (Owner-Vorgabe), konzeptionell aber am `openChangeSuggestionDialog`-Flow orientiert (`js/review/review-locations.js:275`).

Feldumfang: **voll wie im Editor** (Owner-Entscheidung).
Transport: `POST /api/app/report-location.php` mit neuem `report_type` `karte` in `AVESMAPS_REPORT_TYPES` (`report-location.php:8`), `report_mode='new'`. Die Kartenfelder reisen in einer neuen Spalte `payload_json` (self-healing `ALTER`, Muster `avesmapsEnsureMapReportColumn`, `report-location.php:481`).
Anti-Missbrauch: Honeypot + `elapsed_ms` + Rate-Limit greifen wie gehabt (`report_mode='new'` ist **nicht** vom Limiter befreit — nur `change` ist das).
Freigabe im Meldungs-Reiter (`api/edit/reports/locations.php`) legt daraus die `citymap` an, `origin='community'`.

### 3.9 Anzeige an den Orten

Eine Karte kann — wie ein Abenteuer — an Siedlung, Territorium, Region und Weg/Fluss hängen. Sie erscheint dort in der Sektion „Kartensammlung", im Edit- wie im Normalmodus.
Client-Index analog `map-features-adventures.js:89`: `bySettlementPublicId`, `bySettlementKey`, `byTerritoryKey`, `byRegionKey`, `byPathPublicId`, …
**Falle aus dem Abenteuer-Feature übernehmen:** der Server-Slug (`ö→oe`) und der Client-Normalisierer (`ö→o`) laufen auseinander — für Territorien immer den Server-`wiki_key` aus `territory-detail.php` nehmen, nie den clientnormalisierten (`place-extras.js:246`).

---

## 4. Aufgabe D — schwebende Menüs vereinheitlichen

### 4.1 Befund

Es gibt **einen** Menü-Builder (`popupActionButtonMarkup` / `locationPopupActionsMarkup`, `js/ui/popups.js:1`). **Keine** CSS-Regel setzt `flex-direction: column` auf `.location-popup__actions` — die Leiste ist immer `flex` + `wrap`. Die Vertikalität ist ein **Umbruch-Effekt einer fehlenden Breite**:

`js/map-features/map-features-labels.js:426`
```js
const options = labelHasWikiRegion(entry.label)
    ? { className: "settlement-popup floating-location-popup", minWidth: 320, maxWidth: 400 }
    : { className: "floating-location-popup" };   // <- Kontinent: Kachel-CSS, aber keine Breite
```
`.settlement-popup .location-popup` ist die einzige Regel, die die Grundbreite von 260px (`location-popups-markers.css:17`) auf 400px anhebt. Ohne sie bleibt die Box bei 260px, und die 90px-Kacheln passen nicht mehr nebeneinander. Commit `5b224f30` (13.07.) hat den Zweig halb migriert.

### 4.2 Fix

Beide Zweige bekommen identische Optionen. Zusätzlich: `map-features-region-tooltip-lifecycle.js:408` benutzt `className: "location-popup-wrapper"` — eine Klasse, zu der es **im ganzen Repo kein CSS gibt** → auf `settlement-popup floating-location-popup` korrigieren.

**Share-Pin bleibt unangetastet.** `map-features-share-pin.js:41` hat denselben fehlenden Anker, aber genau einen Danger-Button („Markierung entfernen"). Den auf 400px zu ziehen wäre keine Vereinheitlichung, sondern eine Regression. Der Owner-Auftrag lautet „für alle Regionen".

Eine globale `.floating-location-popup .location-popup { width: … }`-Regel wäre der kürzere Weg, würde aber genau den Share-Pin mitreißen. Deshalb der gezielte Fix.

### 4.3 Was E zusätzlich braucht

`.region-info-box` ist `width: min(360px, …)` (`map-labels.css:326`), und ihre Aktionsleiste ist **kein direktes Kind** von `.location-popup` — die `flex: 1 1 calc((100% - 24px) / 4)`-Regel (`location-popups-markers.css:298`) greift dort also nicht, die Kacheln bleiben starr bei 90px. Vier Kacheln = 4×90 + 3×8 = **384px > 360px** → sie würden umbrechen. Also: Flex-Regel auch für `.region-info-box > .location-popup__actions > .location-popup__action-button`.

---

## 5. Aufgabe E — Regionen bekommen das Infopanel

### 5.1 Befund

Die Prämisse „Regionen nutzen das Infopanel noch nicht" stimmt so nicht: seit dem 12.07. (`23dea65e`, `aa306522`, `b047e699`, `e9abeeda`) laufen Region-Klicks ins Panel. **Aber nur mit zugewiesener `wiki_region`.** `map-features-labels.js:370`:
```js
interactive: IS_EDIT_MODE || labelHasWikiRegion(label),
```
Ohne Wiki-Zuweisung ist das Label im Lesemodus komplett inert — kein Popup, kein Panel, kein Trefferziel. Das ist die Lücke.

### 5.2 Umfang (Owner: alle vier)

1. **Label-Regionen ohne Wiki klickbar machen** — `interactive: true` für alle Labels. Das Panel zeigt dann Name + Typ + Kartensammlung + Abenteuer + „Änderung vorschlagen"; die Wiki-Infobox entfällt mangels Daten. Ein Panel ohne Wiki-Zeilen ist ein gültiger Zustand, kein Fehler.
   **⚠️ Perf-Vorbehalt:** Labels werden per Canvas gezeichnet, die Marker sind aber Leaflet-Objekte. Alle Labels interaktiv zu schalten erhöht die Zahl der Hit-Ziele. Dieses Projekt hat eine lange Perf-Historie genau an dieser Stelle. Wird beim Bauen gemessen; falls es beißt, greift der Canvas-Klick-Arbiter (`map-features-location-canvas-layer.js:315`) statt Marker-Handlern.
2. **Landschafts-Labels** (`wald`, `gebirge`, `meer`, `wueste`, `insel`, `see`, `fluss`, … ~17 Subtypen) — dieselbe Behandlung.
3. **Region-Polygone** (`feature_type='region'`) und Territorien — Menü-Ergänzung in `createRegionWikiInfoBoxMarkup` (`map-features-region-info-markup.js:95`).
4. **Menü + Sektionen** überall.

### 5.3 Menü

Owner: *„Vier Kacheln + Brief nur im Panel"*.

| Oberfläche | Kacheln |
|---|---|
| schwebende Box auf der Karte | Zentrieren · Link teilen · Abenteuer · Kartensammlung |
| Infopanel | dieselben vier **+ Änderung vorschlagen** |

Das spiegelt exakt die Siedlung, wo „Änderung vorschlagen" schon heute an `!options.floating` hängt (`js/ui/popups.js:450`).

**„Zentrieren"** ist eine neue Aktion: `data-popup-action="center"` → `map.flyTo(coords)`. Delegierter Handler neben `suggest-change` in `js/routing/routing.js:766`.
Guard: mit `Number.isFinite` prüfen — ein Pan mit `NaN` zerstört das Map-Center (bekannter Bug, `routing-nan-pan-crash`).

**🔧 DU:** Für „Zentrieren" fehlt ein Icon in `img/menu/`. Vorhanden sind `abenteuer.webp`, `brief.webp`, `linkteilen.webp`, `markierung.webp`, `stadtkarte.webp`, `waypoint*.webp`. Ich nehme vorläufig `icons/sextant.webp` (das die Slim-Box schon für „Anzeigen" nutzt). Wenn Du ein aventurisches Zentrieren-Icon zeichnest, lege es als `img/menu/zentrieren.webp` ab — ich tausche den einen `src` dann aus. Sonst musst Du nichts tun.

### 5.4 Sektionen

`buildRegionCityMapsMarkup(label|regionEntry)` neben dem bestehenden `buildRegionAdventuresMarkup` (`place-extras.js:288`). Beide über den Kern-Renderer.
Neue Sektionsklasse `.avesmaps-citymaps` muss in **zwei** Selektorlisten eingetragen werden — sonst fehlt entweder der Trenner oder er läuft nicht randlos:
- `css/features/place-extras.css:7` (die `border-top`-Gruppe)
- `css/features/infopanel.css:438` (die Full-Bleed-Gruppe)

Owner-Regel: **eine** Linie pro Sektion, randlos von Rand zu Rand (negative Seitenmargin = Padding).

---

## 6. Was bewusst NICHT gebaut wird

- **Kein Wiki-Sync für Karten.** Karten sind kuratiert + Community, kein Dump-Import. (Später möglich, das `origin`-Feld ist da.)
- **Kein serverseitiger Bild-Fetch für Karten.** SSRF-Risiko ohne Gegenwert — der Editor lädt hoch.
- **Kein Cron.** Siehe 1.1.
- **Kein Link-Status im `map-features`-Payload.** Ein Statuswechsel würde `avesmapsNextMapRevision()` erzwingen und damit die **komplette 14-MB-Nutzlast** für **alle** Clients invalidieren. Der Linkstatus reist ausschließlich in `adventures.php` / `citymaps.php` / `link-status.php`.
- **Kein `mirror --delete` beim Deploy.** Wie immer.

## 7. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Alle Labels interaktiv → Zoom-Ruckler | messen; notfalls Canvas-Klick-Arbiter statt Marker-Handler (5.2) |
| Fremdhosts drosseln uns (429) | 600ms + Jitter **pro Host**, 429 = kein Urteil, +1 Tag |
| Einzelner Timeout tötet lebenden Link | `fail_streak >= 3`, nur 4xx ist sofort tödlich (1.3) |
| `sources`-Zeilen ohne URL (Wiki-Publikationen) | Provider überspringt `url = ''` |
| Lizenz-Enum driftet auseinander | genau eine Definition, beide Seiten requiren sie (3.3) |
| Vier Kacheln brechen in der 360px-Regionsbox um | Flex-Regel für `.region-info-box` (4.3) |
| Editor-Assets veraltet im Browser | `citymap-editor.html` per `?v=Date.now()` → kein ASSET_VERSION nötig |
| `map_features`-Payload-Shape ändert sich | `AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION` bumpen — **oberhalb** des `try`-Blocks, top-level `const` ist sequenziell |

## 8. Smoketests (am Ende jeder Phase, nicht zwischendurch)

- **A:** Editor-Button „Links prüfen" → Schleife läuft durch → `status` zeigt online/dead/unchecked. Ein bekannt toter Link (404) wird `dead`, ein bekannt lebender `online`.
- **B:** Dialog „Alle anzeigen" bei Gareth → Liste statt Raster, Links rechts mit Markern, Cover öffnet Ulisses/F-Shop. Editor: Zusatzlink anlegen → erscheint im Dialog.
- **C:** Karte im Editor anlegen, Ort zuweisen, Thumb hochladen (freie Lizenz) → erscheint in der Kartensammlung der Siedlung. Lizenz auf `unknown_other` → lokales Bild verschwindet aus dem Payload, externer Link bleibt.
- **D:** Kontinent-Label im Editmode anklicken → Kacheln nebeneinander.
- **E:** Region ohne Wiki anklicken → Panel öffnet. Vier Kacheln auf der Karte, fünf im Panel.
