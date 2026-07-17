# Menüband-Konsistenz: Abenteuer- ↔ Kartensammlungs-Editor — Design

> **Status:** Spec, in Owner-Abstimmung 2026-07-17.
> **Kontext:** Die beiden Editoren (`html/citymap-editor.html`, `html/adventure-editor.html`)
> haben getrennt gewachsene Menübänder. Diese Arbeit gleicht sie zu **einer** Leiste an und
> ergänzt den fehlenden Abenteuer-Feature-Schalter.
> **Verwandt:** `2026-07-17-kartenvorschau-autoget-design.md` (der Karten-Massenlauf, hier
> stillgelegt), `docs/abenteuer-feature-design.md`, `docs/design-language.md` (§12 warme Tokens).

## 1. Ziel

Beide Editoren tragen dasselbe Kachel-Menüband — gleiche Reihenfolge, gleiche Beschriftung,
gleiche Icon-Politik, gleiche Kachelstruktur:

```
[ 🚨 X syncen ] [ Links prüfen ] [ Vorschauen holen ] [ Vorschauen: AN/AUS ] [ X: AN/AUS ]
```

`X` = „Karten" bzw. „Abenteuer". Die Leiste ist linksbündig (Owner 2026-07-17: „beide das
kachelmenüband, linksbündig").

**Bedeutung der fünf Kacheln** (Owner-Definition):
- **X syncen** — Wiki-Dump override-sicher übernehmen (unverändert, primär, der einzige Alarm).
- **Links prüfen** — Erreichbarkeit der Links (unverändert).
- **Vorschauen holen** — Wiki-Cover neu ziehen (wenn neu/verändert), Massenlauf. **In dieser
  Session in BEIDEN Editoren deaktiviert** (siehe §4.4 / §5).
- **Vorschauen: AN/AUS** — Cover/Vorschaubilder im öffentlichen Frontend an/aus.
- **X: AN/AUS** — das ganze Feature im Frontend an/aus (schwebende Kachel + Infopanel-Sektionen).

## 2. Ist-Zustand

| | Kartensammlung (`citymap-editor.html`) | Abenteuer (`adventure-editor.html`) |
|---|---|---|
| Kacheln | **5** vorhanden | nur **3** vorhanden |
| Reihenfolge | sync · **Kartensammlung-an/aus** · Links · Vorschauen holen · Vorschauen-an/aus | **Cover-an/aus** · sync · Links |
| Icons | 🚨 sync · 🔗 Links · 🖼️ Vorschauen holen | 🖼️ Cover · 🚨 sync · 🔗 Links |
| Fehlt | — | **Vorschauen holen** · **Abenteuer an/aus** |

Der Kartensammlungs-Editor hat also alle fünf Kacheln, nur in falscher Reihenfolge und mit zu
vielen Icons. Dem Abenteuer-Editor fehlen zwei Kacheln, und der Cover-Schalter heißt anders und
sitzt an falscher Stelle.

## 3. Owner-Entscheidungen (2026-07-17 — nicht neu verhandeln)

1. **Icon-Politik: nur die Sync-Kachel trägt ein Icon** (🚨 Alarm). Die vier anderen sind rein
   textlich — die heutigen 🔗/🖼️ werden entfernt.
2. **Umfang dieser Session:** Menüs angleichen **+** neuer Schalter „Abenteuer an/aus". Der echte
   Abenteuer-Cover-Massenlauf wird **nicht** gebaut; seine Kachel wird deaktiviert angelegt.
3. **„Vorschauen holen" auch bei den Karten deaktivieren** — „zur Sicherheit". Der Massenlauf
   `citymap-autoget.php` war heute 3× der Auslöser des PHP-Pool-Hängers.
   - **Nur die Kachel** deaktivieren, **kein** Server-Riegel jetzt (bewusster Owner-Entscheid,
     Restrisiko akzeptiert: ein alter offener Editor-Tab könnte den scharfen Endpunkt theoretisch
     noch anwerfen). Der serverseitige Ein-Lauf-Lock kommt zusammen mit dem Abenteuer-Massenlauf
     in einer eigenen, fokussierten Session.
4. **Kachelstruktur** folgt dem Kartensammlungs-Muster: die Toggle-Kacheln tragen den Zustand in
   Zeile 1 (`Vorschauen: AN` / `Abenteuer: AN`) und „öffentliche Anzeige" bzw. „Frontend-Zugriff"
   in Zeile 2.

## 4. Bausteine

### 4.1 Kartensammlung-Menü — umsortieren + Icons

`html/citymap-editor.html`, `.ce-header` (ab Zeile 416).

- Reihenfolge → `ceSyncBtn · ceLinkCheckBtn · ceAutogetBtn · cePreviewsToggle · ceEnabledToggle`.
  Der einzige Umbau: **`ceEnabledToggle` von Position 2 ans Ende** (Position 5).
- Icons entfernen: 🔗 aus `ceLinkCheckBtn` (HTML-Label **und** die JS-Stelle, die es beim
  Umschalten neu setzt, `handleLinkCheckClick`/busy-Label), 🖼️ aus `ceAutogetBtn` (HTML **und**
  die busy-Label-Stelle). 🚨 bleibt bei `ceSyncBtn`.
- `ceAutogetBtn` **deaktivieren** (§4.4).

Kein CSS nötig: `.ce-btn2:disabled { opacity: 0.6; cursor: default; }` existiert bereits.

### 4.2 Abenteuer-Menü — umsortieren, umbenennen, zwei neue Kacheln

`html/adventure-editor.html`, `.ae-header` (ab Zeile 322).

- Reihenfolge → `aeSyncBtn · aeLinkCheckBtn · [neu] aeAutogetBtn (deaktiviert) · aeCoversToggle · [neu] aeEnabledToggle`.
- `aeSyncBtn` nach vorne (🚨 bleibt); `aeLinkCheckBtn` 🔗 entfernen (HTML + busy-Label).
- **`aeCoversToggle` umbauen** zu „Vorschauen: AN/AUS":
  - 🖼️ entfernen, Beschriftung „Cover" → „Vorschauen".
  - Kachelstruktur an das Kartensammlungs-Muster angleichen: **Zeile 1** = `Vorschauen: AN`/`AUS`
    (dynamisch, heute in Zeile 2), **Zeile 2** = statisch „öffentliche Anzeige".
  - Funktion **unverändert**: schaltet weiter `adventure_covers_enabled` (`toggleCovers`,
    `set_covers_enabled`). Nur Beschriftung/Layout ändern sich, nicht das Verhalten.
- **[neu] `aeAutogetBtn`** „Vorschauen holen" — sichtbar, aber deaktiviert (§4.4). Kein Handler,
  kein Backend.
- **[neu] `aeEnabledToggle`** „Abenteuer: AN/AUS" — der Feature-Schalter (§4.3). Vorbild
  `ceEnabledToggle`/`toggleEnabled`/`setEnabledToggleState` token- und struktur-gleich.

### 4.3 „Abenteuer an/aus" — Feature-Kill-Switch (Backend, Vorbild `citymaps_enabled`)

Der Schalter deaktiviert im öffentlichen Frontend die **Möglichkeit, auf Abenteuer zuzugreifen**:
das schwebende Info-Menü (Kachel „Abenteuer") **und** die Infopanel-Sektionen („beginnt hier"/
„spielt hier" sowie die „Abenteuer in …"-Liste bei Territorium/Region/Weg). Owner-Wortlaut.

**Mechanik = 1:1 das Kartensammlungs-Muster:**
- Neues Flag `adventures_enabled` über den generischen `app_setting`-Store, Default **AN**, nur
  ein gespeichertes `'0'` schaltet aus. Getter/Setter `avesmapsAdventuresEnabled` /
  `avesmapsSetAdventuresEnabled` in `api/_internal/app/adventures.php`, neben dem bereits
  existierenden `avesmapsAdventuresCoversEnabled` (Zeile 141 ff., exaktes Vorbild).
- **Öffentlicher Katalog** (`api/app/adventures.php` → Kern in `api/_internal/app/adventures.php`):
  ist der Schalter aus, wird eine **leere Abenteuer-Liste** geliefert (Feld `adventures_enabled`
  reist im Payload mit, analog `citymaps_enabled`).
- **Kein Frontend-Eingriff nötig.** Der Client baut aus der leeren Liste leere Indizes → jeder
  Ort hat 0 Abenteuer → schwebende Kachel wird über den **bestehenden** Disabled-Mechanismus
  `aria-disabled` (wie bei „keine Abenteuer"), und die Infopanel-Sektionen rendern nicht. Das ist
  die minimal-invasive Wahl **gegenüber** einem eigenen Client-Flag; sie folgt exakt dem, was der
  Kartensammlungs-Schalter tut, und hält beide Features auf einem Verhalten.
- **Editor:** neue Edit-Action `set_adventures_enabled` (cap `edit`) in
  `api/edit/map/adventures.php` (Vorbild `set_citymaps_enabled` in `api/edit/map/citymaps.php`);
  die Editor-`list`-Antwort liefert `adventures_enabled` mit (wie schon `covers_enabled`), damit
  die Kachel beim Öffnen ihren Zustand kennt.

**Bekannte, akzeptierte Eigenschaft** (wie bei Cover/Kartensammlung): der Katalog wird im
Frontend **einmal** geladen → das Umschalten wirkt beim nächsten Katalog-Laden, nicht in bereits
offenen Tabs.

### 4.4 „Vorschauen holen" deaktiviert (beide Editoren)

- `ceAutogetBtn` und der neue `aeAutogetBtn` tragen das native `disabled`-Attribut (→ vorhandenes
  `:disabled`-Styling, kein Klick, kein Handler feuert). Zeile 2 der Kachel nennt den Grund kurz
  (z. B. „vorübergehend deaktiviert").
- Kartensammlung: `ceAutogetBtn` bekommt `disabled`; sein Klick-Handler/Refresh
  (`handleAutogetClick`/`refreshCeAutogetInfo`) wird nicht mehr verdrahtet bzw. läuft nicht an.
  Der Massenlauf-Endpunkt `citymap-autoget.php` bleibt unverändert (kein Server-Riegel, §3.3).
- Der **Einzelbild-Refetch pro Karte** (`citymap-image.php` `mode=autoget`, im Detail-Panel)
  bleibt — er ist ein einzelner Fetch, kein Massenlauf, und war nicht am Pool-Hänger beteiligt.

## 5. Nicht-Ziele dieser Session

- **Kein** Abenteuer-Cover-Massenlauf-Endpunkt (die Kachel bleibt deaktiviert).
- **Kein** serverseitiger Ein-Lauf-Lock für `citymap-autoget.php`.
- Beides gehört zusammen in eine eigene, fokussierte Session mit vollem Pool-Riegel
  (`GET_LOCK`/DB-Zeile, `EnsureTables` aus dem Schritt-Pfad, `session_write_close`) — siehe
  `php-pool-hang-incident-2026-07-17` (Prävention Punkt 1–4).

## 6. Verifikation (Pool-sicher)

Reine Frontend- + Flag-Arbeit; **kein** neuer last-erzeugender Endpunkt, **kein** Loopen von
Live-Endpunkten (STRATO-Regel).

- Editoren ohne Login prüfbar über `?edit=1` (rendert das Panel; 401 auf Schreib-Endpunkten
  beweist den Lazy-Load). Schreibflows via Stub, nicht gegen Prod.
- Beide Menübänder visuell gegenprüfen: identische Reihenfolge/Beschriftung, nur sync mit Icon,
  „Vorschauen holen" in beiden deaktiviert, Toggle-Kacheln zweizeilig mit Zustand + „öffentliche
  Anzeige"/„Frontend-Zugriff".
- `adventures_enabled`: der neue Getter/Setter + Katalog-Gate werden gegen das citymaps-Muster
  geprüft (PHP-Lint; ggf. Unit-Test analog `citymap-gate-test.php`). Der Frontend-Effekt (leere
  Liste → Kachel disabled + keine Sektionen) wird im lokalen Repro mit injiziertem leerem Katalog
  bestätigt — **nicht** durch Loopen des Live-Endpunkts.
- `ASSET_VERSION`-Falle beachten: die beiden `html/*-editor.html` werden dynamisch geladen; nach
  Änderung ggf. Cache-Bust nach Projektregel (Editor-Assets), **nie** `?v=` von Hand.

## 7. Betroffene Dateien (Übersicht, exakte Zeilen im Plan)

- `html/citymap-editor.html` — Kachel-Reihenfolge, Icons raus, `ceAutogetBtn` disabled.
- `html/adventure-editor.html` — Kachel-Reihenfolge, Icons raus, `aeCoversToggle` umbauen,
  `aeAutogetBtn` (neu, disabled) + `aeEnabledToggle` (neu) + Toggle-Logik/Verdrahtung.
- `api/_internal/app/adventures.php` — `adventures_enabled` Getter/Setter + Katalog-Gate + Payload.
- `api/edit/map/adventures.php` — Edit-Action `set_adventures_enabled`.
- (evtl.) `api/_internal/app/__tests__/` — Gate-Test analog Kartensammlung.
