# Abenteuer-Editor — P2 UI-Spezifikation

> Status: **freigegeben** (Owner-Mockup-Session 2026-07-12). Sprache: Prosa DE, technische Bezeichner
> (Tabellen/Spalten/Funktionen/Endpoints/CSS-Klassen/`error.code`) EN (AGENTS.md §8).
> Kontext: Phase 3 des Abenteuer-Features. **Spec (Warum):** `docs/abenteuer-feature-design.md` §10.
> **Build-Instruction:** `docs/abenteuer-instruction.md` §Phase 3. Diese Datei fixiert die **konkrete
> Editor-UI** (Layout + Interaktionen), die in jenen Docs nur grob umrissen ist.

Diese Spezifikation ist die Vorlage für den Umsetzungsplan (writing-plans) von **P2 (Editor-UI)**. Das
**P1-Backend ist LIVE** (Commit `ee85439b`): `api/edit/map/adventures.php` mit den Actions `list`, `detail`,
`upsert_adventure`, `add_place`, `set_place`, `suppress_place`, `resolve_place` (Lib in
`api/_internal/app/adventures.php` L405–800). Die UI ist ein reiner Client auf diesem Vertrag.
**Ort-Autocomplete ist P3** (danach) — in P2 wird ein Ort per Rohnamen hinzugefügt und per „Auflösen"
serverseitig aufgelöst.

Referenz-Artefakt: `html/adventure-editor-mockup.html` (echte Tokens, Layout-Switcher A/B/C, Dark-Toggle).
Der Mockup ist **wegwerfbar** und wird beim Bau zur echten `html/adventure-editor.html` (Mockup danach
gelöscht).

---

## 1. Owner-Entscheidungen (Mockup-Session 2026-07-12)

| # | Entscheidung | Konsequenz |
|---|---|---|
| **Layout** | **C · 3 Spalten** (Liste \| Stammdaten \| Orte, alles gleichzeitig sichtbar) | Orte permanent im Blick; knüpft ans 3-Spalten-Muster des Siedlungseditors an (ohne Baum). |
| **Startort** | **Mehrere Startorte erlaubt** | „★ Start" ist ein **Umschalter je Zeile** (kein Radio); setzt/löst `role` unabhängig, ohne andere Zeilen zu ändern. |
| **Reihenfolge** | **Manuell ordenbar (▲▼)** | Löst den §10/§3.2-Widerspruch: Editoren ordnen per Hoch/Runter (`sort_order` via `set_place`). **Nie automatisch umsortieren** (CORE-Invariante). |
| **Grabsteine** | **Ausgeblendet + Toggle** | Unterdrückte (entfernte Wiki-)Orte standardmäßig verborgen; „unterdrückte anzeigen (N)" blendet sie inkl. „↺ Zurückholen" ein. |
| **Tokens** | **Editor auf echten Tokens** (`/css/base/tokens.css`) | **NICHT** die hartkodierten Local-Vars des Siedlungseditors (der ist älter als das Token-System). Kein hartkodiertes Hex/Radius/Spacing, kein Blau. |

---

## 2. Shell / Hosting (C1)

- **Self-contained** `html/adventure-editor.html`. Verlinkt `/css/base/fonts.css` + **`/css/base/tokens.css`**
  (absolut; die Seite wird als iframe aus dem App-Root ausgeliefert). Nutzt Tokens via `var(--…)`.
- **Opener** `openAvesmapsAdventureEditorOverlay()` — 1:1 Muster `openAvesmapsSettlementEditorOverlay`
  (`js/review/review-settlement-list.js:483`): Overlay `political-territory-editor-overlay` +
  `…-dialog`/`…__header`/`…__frame`, iframe-`src` mit **`?v=Date.now()`** (kein `ASSET_VERSION`-Bump).
  Header-Titel „Abenteuereditor".
- Kein Deep-Link-Param, kein Baum-Refresh beim Schließen (wie der Siedlungseditor).

## 3. Layout C — Aufbau

```
┌ Header: „Abenteuereditor"  · N Abenteuer · gesynct: <Datum>            ✕ ┐
├───────────────┬───────────────────────────┬────────────────────────────┤
│ LISTE         │ STAMMDATEN                │ ORTE                        │
│ [Suche][+Neu] │  Identität                │  Kopf + „unterdrückte …(N)" │
│ N von M       │  Datierung & Einordnung   │  [+ Ort]-Zeile + Legende    │
│ ▸ Abenteuer   │  Wiki & F-Shop            │  Orts-Zeilen (▲▼ / Rolle /  │
│   …           │                           │   Auflösen / Entfernen)     │
├───────────────┴───────────────────────────┴────────────────────────────┤
│ Fußzeile: „✓ gespeichert"      [Verwerfen] [Stammdaten speichern]        │
└─────────────────────────────────────────────────────────────────────────┘
```

Umsetzung: eine DOM-Struktur, `body[data-layout="c"]`; die Stammdaten- und Orte-Panels liegen als zwei
Flex-Spalten nebeneinander im Detailbereich (Trenner `--color-border`). (A/B im Mockup sind nur
Vergleichsvarianten und wandern **nicht** in den Bau.)

## 4. Linke Spalte — Abenteuer-Liste (Action `list`)

- Kopf: `input[type=search]` (Titel-Filter, client-seitig) + primärer Button **„+ Neu"** (leeres Detail).
- Zähler „N von M".
- Zeilen aus `list` (`{public_id,title,product_type,bf_label,bf_year,wiki_key,origin,status,place_count}`),
  Sortierung wie Backend (neuestes BF-Jahr zuerst, undatiert zuletzt, dann Titel):
  - Zeile 1: Titel (fett).
  - Zeile 2: Produkttyp-Pill · `bf_label` · „N Orte" · ggf. `manuell`-Pill (origin) .
  - `status!='approved'` (Grabstein/Entwurf) → gedimmt/kursiv.
- Auswahl → Action `detail` für die rechten Spalten. Ausgewählte Zeile `--color-active-wash`.

## 5. Mittlere Spalte — Stammdaten (Action `detail` / `upsert_adventure`)

Detail-Kopf: Titel (H2), Meta-Zeile (Produkttyp-Pill · `edition` · `bf_label` · origin-Pill `Quelle: Wiki/Manuell`
· `wiki_key`).

Drei Feldgruppen, jeweils Überschrift mit **durchgehendem Trenner** (`--color-divider`), 2-spaltiges Raster:

| Gruppe | Felder (Spalte in `adventure`) |
|---|---|
| **Identität** | `title`* · `product_type` (Select: gruppenabenteuer\|soloabenteuer\|kurzabenteuer\|szenario\|anthologie\|kampagne) · `edition` (Select DSA1–5) · `is_official` (Checkbox) · `series` |
| **Datierung & Einordnung** | `bf_year` (number) · `bf_label` · `genre` · `complexity_gm` · `complexity_pl` · `authors` |
| **Wiki & F-Shop** | `wiki_url` · `fshop_code` · `cover_url` |

- **Speichern (Owner-Default):** Button **„Stammdaten speichern"** → ein `upsert_adventure` mit **allen
  editierbaren Feldern** (`public_id` mitsenden bei Update; leer = Insert). Das Backend stempelt je
  gesendetem Feld `field_origins_json[feld]='manual'`. „Verwerfen" lädt `detail` neu. Fußzeile „✓
  gespeichert" nach Erfolg.
- **Override-Anzeige:** Felder mit `field_origins[feld]==='manual'` bekommen ein `manuell`-Badge
  (Titel-Tooltip „Manuell gesetzt — ein Wiki-Sync fasst dieses Feld nicht mehr an"). Rein informativ.
- **Bekannte P2-Grenze:** ein `manuell`-Feld wieder „für Sync freigeben" (origin zurück auf `wiki`) gibt es
  in P2 **nicht**. Optionale spätere Backend-Ergänzung (Feld aus `field_origins_json` entfernen).

## 6. Rechte Spalte — Orte (der Kern)

> **🔖 Owner-Anforderung (2026-07-12): Regionen sind vollwertige Ort-Ziele** (z. B. Raschtulswall). `region`
> steht im „Typ"-Dropdown und in der Auflösung (Resolver-Präzedenz settlement→territory→**region**→path);
> ein region-Ort rendert mit Region-Badge, ein nicht auffindbarer bleibt als benannter `unresolved`-Ort
> erhalten. (Die *Anzeige* region-zugewiesener Abenteuer auf der Regions-Infobox ist Phase-2-Display.)

Kopf: „Orte (N)" (approved-Zähler) · Invarianten-Hinweis „★ Startorte oben · manuell ordenbar (▲▼)" ·
rechts der Toggle **„unterdrückte anzeigen (N)"**.

**Hinzufügen-Zeile:** `input` (Rohname/Wiki-Titel) + `select` (Zieltyp-Hinweis:
`automatisch`\|settlement\|territory\|region\|path) + primärer Button **„+ Ort"**.
→ `add_place` (raw_name, optional target_kind, role default `play`, `sort_order`=MAX+1) **und anschließend
automatisch `resolve_place`** (Owner-Default). Legende darunter: „★ = beginnt hier (Spoiler-frei) · übrige =
spielt hier (Spoiler) · mehrere Startorte möglich · neuer Ort wird automatisch aufgelöst".

**Orts-Zeilen** (aus `detail.places`, `sort_order ASC`, nur `status='approved'` im Hauptbereich):
- **▲▼** — `sort_order` per `set_place` tauschen (Nachbarn). Erste Zeile ▲ deaktiviert, letzte ▼ deaktiviert.
  **Nie automatisch umsortieren.**
- **Name** (`raw_name`, fett) + aufgelöstes Ziel „→ `<Kind>` `<target_wiki_key|target_public_id>`" bzw. bei
  `unresolved` das rote Pill „nicht aufgelöst · Rohname bleibt erhalten".
- **Badges:** target_kind (neutral) · origin (`manuell` gold-Umriss / `Wiki` grau-Umriss).
- **„☆/★ Start"-Umschalter** — `set_place` `role` (`start`↔`play`). **Mehrere erlaubt, unabhängig.** Aktive
  (Start-)Zeile bekommt Gold-Rahmen (`--color-accent-strong` + `--color-panel-soft`).
- **„↻ Auflösen"** — nur bei `unresolved`; `resolve_place` (setzt es auf `unresolved` zurück und lässt den
  gemeinsamen Resolver laufen; berührt nur unaufgelöste Orte).
- **„✕ Entfernen"** — `suppress_place`: wiki-Ort → `status='suppressed'` (Grabstein, blockt Re-Sync),
  manueller Ort → hart gelöscht.

**Grabsteine (unterdrückt):** standardmäßig **ausgeblendet** (`.ae-suppressed-wrap[hidden]`). Toggle
„unterdrückte anzeigen (N)" blendet sie ein: durchgestrichen/gedimmt, Badge „unterdrückt", Button **„↺
Zurückholen"** = `add_place` desselben Rohnamens als **neuer manueller** Ort (kein Backend-Umbau nötig; der
suppressed-wiki-Datensatz bleibt als Grabstein liegen).

## 7. Badge-/Token-Sprache (Abschnitt 4, freigegeben)

| Badge | Bedeutung | Token |
|---|---|---|
| `★ Startort` (Gold gefüllt) | `role=start` | `--color-accent-strong` + `--color-active-wash` |
| Kind-Pill (neutral) | `target_kind` | `--color-panel-muted` / `--color-text-muted` |
| `manuell` (Gold-Umriss) | `origin=manual` | `--color-accent` / `--color-accent-strong` |
| `Wiki` (grau-Umriss) | `origin=wiki` | `--color-text-muted` |
| `nicht aufgelöst` (rot-Umriss) | `target_kind=unresolved` | `--color-danger` |
| `unterdrückt` + durchgestrichen | `status=suppressed` | gedimmt (`opacity`) |

## 8. Einstieg + Leerzustände (Abschnitt 5, freigegeben)

- **Button in `index.html`** im Block `.wiki-sync-dump-central` (`index.html:342–355`), direkt **unter**
  „Dump holen", analog `#settlement-editor-open`/`#settlement-editor-synced`:
  ```html
  <div class="wiki-sync-panel__actions">
    <button id="adventure-editor-open" class="wiki-sync-panel__start" type="button"
      title="Öffnet den Abenteuereditor (anlegen/bearbeiten, Orte zuordnen).">🗺️ Abenteuereditor</button>
    <span id="adventure-editor-synced" class="wiki-sync-panel__summary" hidden></span>
  </div>
  ```
  Opener in `js/app/bootstrap.js` neben dem Siedlungseditor-Opener registrieren. Der `…-synced`-Span
  bleibt bis **Phase 4** leer/hidden (Sync-Datum, `review-wiki-sync.js:554`).
- **„+ Neu"** → leeres Detail, `title`-Feld fokussiert, Produkttyp-Default, Orte-Spalte zeigt „Noch keine
  Orte — oben hinzufügen".
- **Kein Abenteuer gewählt** → Detail-/Orte-Spalten zeigen einen ruhigen Platzhalter „Abenteuer links wählen
  oder neu anlegen".

## 9. Invarianten & Fallen (Bau)

- **CORE:** Ort-Reihenfolge = Start(orte) oben, **nie automatisch umsortieren** (nur ▲▼ manuell).
- **Nur Tokens**, kein Blau (AGENTS.md §12).
- **`?v=Date.now()`** beim iframe-`src` — kein `ASSET_VERSION`-Bump (C1).
- **UI-Verifikation** nur via **localhost-Repro + JS-Messung**; Live-Screenshots der Karte timen aus
  (Canvas/rAF). Der **statische** Editor-Mockup ist dagegen headless screenshot-bar (statisches DOM/CSS).
- **STRATO:** Endpoints nur mit **Einzel-Request** proben, nie loopen.
- **Shared Working Tree:** nur eigene Dateien per Pfad stagen, nie `git add -A`.
- **Gold-Contract:** Client erwartet `{ok:true,…}` / `{ok:false,error:{code,message}}`.

## 10. Datei-Landkarte P2

| Datei | Aktion |
|---|---|
| `html/adventure-editor.html` | **neu** — self-contained Editor (aus dem Mockup), Tokens, `list`/`detail`/`upsert`/`*_place` verdrahtet. |
| `js/app/bootstrap.js` | **ändern** — `openAvesmapsAdventureEditorOverlay()` registrieren (Klick auf `#adventure-editor-open`). |
| `index.html` (`.wiki-sync-dump-central`) | **ändern** — Button + `#adventure-editor-synced`-Span (§8). |
| `html/adventure-editor-mockup.html` | **löschen** am Ende (Referenz erfüllt). |

Backend (`api/edit/map/adventures.php` + Lib): **unverändert** — P2 nutzt nur die vorhandenen P1-Actions.
