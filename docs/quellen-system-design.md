# Mehrquellen-System — Design (Spec)

> Datum: 2026-07-08. Sprache: Deutsch (Design-Doc, Owner-Präferenz). Code/Commits/
> interne API-Messages bleiben Englisch. Betrifft: Siedlungen, Territorien, Regionen, Wege.

## Ziel

Statt genau **einem** verlinkten Quell-Hinweis pro Element (heute: `wiki_url` **oder**
`other_source`, either/or in `featureSourceCreditMarkup` [js/ui/popups.js:77]) sollen
Infoboxen **mehrere** Quellen zeigen — mit Typ und `*`-Markierung für offizielle Quellen —,
und Editoren sowie die Community sollen Quellen **hinzufügen** können. Der Wiki-Link bleibt
automatisch; die bestehende „Andere Quelle" wird **additiv** (überschreibt den Wiki-Link nicht
mehr).

## Vision: vier Teilprojekte

1. **Kern — Datenmodell + Infobox-Anzeige** (diese Spec). Fundament; alles andere hängt daran.
2. **Editor-Overrides „Weitere Quellen hinzufügen"** — in den bestehenden „Details bearbeiten"-
   Dialogen aller 4 Typen (keine neuen Editoren): Suchfeld über den Katalog → bestehende Quelle
   picken **oder** neu anlegen (URL/Label/Typ/offiziell).
3. **Nutzer-Vorschläge + Moderation** — „Quelle vorschlagen"-Button in jeder Infobox → Dialog →
   Meldung (`map_reports` erweitern) → im Review annehmen/ablehnen. Angenommene Vorschläge werden
   zu regulären Verknüpfungen.
4. **URL-Auto-offiziell** — bestimmte URL-Muster (z. B. `https://f-shop.de/%`) automatisch als
   offiziell markieren. Vom Owner explizit auf „später" gelegt.

**Diese Spec liefert nur #1.** Das Schema ist aber so entworfen, dass #2–#4 ohne Umbau
andocken (`status`-Spalte für Moderation, `is_official` für Auto-offiziell).

## Teil 1 — Datenmodell

Zwei Tabellen, normalisiert (Quellen werden **geteilt**: ein Regionalband ist Quelle für viele
Orte). Self-healing `CREATE TABLE IF NOT EXISTS`-DDL wie im Projekt üblich (`sql/` als partieller
Spiegel).

### `sources` (Katalog / „Quellset")
Eine Zeile pro **distinkter** Quelle. Identität = `url`.

| Spalte | Typ | Notiz |
|---|---|---|
| `id` | BIGINT PK AUTO_INCREMENT | |
| `url` | VARCHAR(500) **UNIQUE** | Identität; Dedup hierüber; Pflichtfeld |
| `label` | VARCHAR(200) | Anzeigename, z. B. „F-Shop", „Regionalband Kosch" |
| `source_type` | VARCHAR(32) | `regionalband` · `abenteuer` · `briefspiel` · `sonstiges` |
| `is_official` | TINYINT(1) DEFAULT 0 | → `*` in der Infobox |
| `created_by` | INT NULL | Editor-User-Id (NULL = System/Migration) |
| `created_at` | DATETIME(3) | |

### `feature_sources` (Verknüpfung Element ↔ Quelle)
| Spalte | Typ | Notiz |
|---|---|---|
| `id` | BIGINT PK AUTO_INCREMENT | |
| `entity_type` | VARCHAR(16) | `settlement` · `territory` · `region` · `path` |
| `entity_public_id` | VARCHAR(64) | Element-Identität (siehe unten) |
| `source_id` | BIGINT | FK-artig → `sources.id` |
| `status` | VARCHAR(16) DEFAULT `approved` | `approved` · `pending` (Moderation #3; #1 schreibt nur `approved`) |
| `created_by` | INT NULL | |
| `created_at` | DATETIME(3) | |
| | UNIQUE(`entity_type`,`entity_public_id`,`source_id`) | kein Doppel-Verknüpfen |
| | KEY(`entity_type`,`entity_public_id`) | Lese-Pfad |

**`entity_public_id`:** `map_features.public_id` für settlement/region/path. Für territory die
stabile öffentliche Identität von `political_territory` (`public_id`, ersatzweise `wiki_key`) —
im Plan gegen das reale Schema prüfen und **eine** Wahl festschreiben.

### Wiki bleibt außerhalb des Katalogs
Der `wiki_url` je Element bleibt unverändert (Spalte bzw. `properties_json.wiki_url` bzw.
`political_territory.wiki_url`). Bei der Anzeige wird er als **synthetische „Wiki"-Quelle**
erzeugt — nie katalogisiert (jede Wiki-Seite ist ohnehin eigen), **nie `is_official`**
(Datengrundlage, kein Kanon — vgl. Framing „Wiki = unsere Datengrundlage").

### Migration bestehender Daten (🔧 Owner führt den DB-Write aus)
Der Agent führt **keine** Prod-Writes aus (nur self-healing DDL). Der Owner migriert per
phpMyAdmin/Konsole nach einem gelieferten, idempotenten Skript:
- Je Element mit `properties.other_source {url,label}` (settlement/region/path): Upsert eines
  `sources`-Eintrags (`source_type='sonstiges'`, `is_official=0`) per `url` + eine
  `feature_sources`-Verknüpfung. `wiki_url` bleibt unangetastet.
- `properties.other_source` bleibt vorerst als Feld bestehen (kein destruktiver Rückbau in #1);
  die Anzeige liest ab jetzt aber aus `feature_sources` (+ Wiki-auto), nicht mehr entweder/oder.

## Teil 2 — Infobox-Anzeige

### Format
Eine Zeile pro Element:
```
Quelle(n): F-Shop* ↗  Wiki ↗  Briefspiel ↗
```
- Präfix `Quelle(n): ` (i18n via `tr()`).
- Jede Quelle = **Label** + `↗`-Link (`target=_blank rel=noopener`), Link-Ziel = `url`.
- Offizielle Quellen: Label mit angehängtem ` *`, Tooltip „offizielle Quelle" (i18n).
- **Reihenfolge:** (1) offizielle Quellen (mit `*`), (2) Wiki (auto), (3) übrige Quellen; innerhalb
  einer Gruppe nach `created_at` (Einfüge-Reihenfolge).
- **Leerfall** (kein `wiki_url` **und** keine `feature_sources`): bestehendes „Keine Quelle
  gefunden".

### Betroffene Element-Typen
- **Siedlungen** (`buildLocationMarkerPopupHtml`, js/map-features/map-features-location-marker-entry.js):
  Quell-Zeile von either/or auf die Liste umstellen.
- **Regionen** (`labelPopupMarkup`, js/ui/popups.js:459): Quell-Zeile ergänzen.
- **Wege/Flüsse:** haben **heute keine** Quell-Zeile → neu einführen (gleiche geteilte Render-Funktion).
- **Territorien:** in der jeweiligen Territoriums-Detail/Viewer-Ansicht die Quell-Zeile ergänzen
  (Ort im Plan lokalisieren).

### Geteilte Render-Funktion
`featureSourceCreditMarkup` wird von „ein Link" auf „Liste" umgebaut: Eingang = `{ wikiUrl,
sources: [{url,label,type,official}] }`, Ausgang = die HTML-Zeile oben. Die vier Popup-Builder
rufen nur diese eine Funktion — keine Logik-Duplikation.

## Teil 3 — Lese-API (Hydration)

Ein schlanker Lazy-Endpoint, **einheitlich für alle 4 Typen**, aufgerufen beim Öffnen eines Popups
(hält den großen `map-features`-Load unangetastet → STRATO-schonend, kein Aufblähen von 4
Ladepfaden):

```
GET /api/app/feature-sources.php?entity_type=<t>&entity_public_id=<id>
→ { "ok": true, "sources": [ { "url","label","type","official" }, ... ] }
```
- Nur `status='approved'` (pending erst in #3).
- **Kein N+1:** genau **eine** parametrisierte Query (`JOIN sources` + `WHERE entity_type/id`).
- Der Wiki-Link kommt **synchron** aus den bereits geladenen Feature-Daten (`wiki_url`); die
  Katalog-Quellen füllen die Zeile nach dem Fetch nach (Wiki ist sofort da, der Rest erscheint
  einen Tick später). Envelope wie Gold-Contract (`{ok:true,...}` / `{ok:false,error:{code,message}}`).

**Optimierung später (nicht #1):** Quellen eager in den `map-features`-Payload batchen (eine
zusätzliche gebündelte Query), falls das Nachfüllen stört.

## Nicht-Ziele (dieser Spec)

- Editier-UI („Weitere Quellen hinzufügen") — **#2**.
- „Quelle vorschlagen" + Moderation — **#3**.
- URL-Auto-offiziell — **#4**.
- Destruktiver Rückbau von `properties.other_source` — später, wenn #2 die Bearbeitung übernimmt.

## Invarianten & Constraints

- **Keine Prod-DB-Writes durch den Agenten** (nur self-healing DDL; Migration = Owner-Skript).
- **STRATO:** schwere Endpoints nicht loopen; die Quell-Query ist eine einzelne kleine Abfrage.
- **Envelope:** neuer Endpoint folgt dem Gold-Contract (`ok`/`error{code,message}`), Auth = public
  (reine Lese-Anzeige, wie `map-features`).
- **Sprache:** alle nutzer­sichtbaren Strings Deutsch via `tr()`; Code/Kommentare Englisch.
- **Deploy:** Push → ~1–2 min Auto-Deploy; kein `git add -A` im geteilten Checkout.

## Definition of Done (#1)

1. `sources` + `feature_sources` existieren (self-healing DDL greift beim ersten Endpoint-Aufruf).
2. `GET /api/app/feature-sources.php` liefert die (approved) Quellen eines Elements (Gold-Envelope,
   eine Query).
3. `featureSourceCreditMarkup` rendert die Liste (Reihenfolge/`*`/Wiki-auto/Leerfall) und wird von
   allen 4 Popup-Buildern genutzt; Wege bekommen erstmalig eine Quell-Zeile.
4. Migrationsskript für `other_source → sources+feature_sources` liegt bereit (Owner-Run).
5. Owner-Smoke: Element mit Wiki + ≥1 Katalog-Quelle zeigt beide (offizielle mit `*`), Leerfall zeigt
   „Keine Quelle gefunden".
