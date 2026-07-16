# Design: Karten-Wiki-Sync — die fehlenden Pipeline-Stufen 1+2

**Datum:** 2026-07-16 · **Status:** freigegeben, im Bau
**Vorstufe:** `2026-07-16-kartensammlung-wiki-sync-recon.md` (Befund + Messungen)
**Owner-Wahl:** Stadtplanindex **und** Kartenindex. Kategorie-Baum nicht.

## 1. Rahmen

Kein Anbau, sondern die fehlenden **Stufen 1+2** der Haus-Pipeline. Bei der Kartensammlung wurde
Stufe 3 zuerst gebaut. Die Vorlage steht 1:1 daneben:

| Stufe | Abenteuer (Vorlage) | Karten (dieser Bau) |
|---|---|---|
| 1 Dump | `AVESMAPS_WIKI_DUMP_PHASE_ADVENTURES` (`dump-hybrid-driver.php:129`) → `wiki_adventure_catalog` | Phase `citymaps` → `wiki_citymap_catalog` / `wiki_citymap_place_staging` |
| 2 Sync | `case 'sync_adventures'` (`api/edit/wiki/dump.php:594`) | `case 'sync_citymaps'` |
| 3 Pflege | `html/adventure-editor.html` | `html/citymap-editor.html` ✅ existiert |

**Quelle ist der DUMP**, nicht die API (Betreiber-Policy: Dump bevorzugen, API ok, keine HTML-Crawls).

## 2. Zwei Korrekturen an der Recherche

Beim Verifizieren der Annahmen, auf denen die Key-Wahl steht, sind zwei Aussagen der Recherche
gekippt. Beide sind byte- bzw. zählbelegt.

### 2.1 Der Backslash existiert doch — in der NEUEN Liste

Recherche §5 („Korrekturen"): *„Das Wiki schreibt `Al\'Anfa` war falsch — ein Artefakt meiner eigenen
Shell-Quotierung. Die rohen Bytes zeigen 8× `Al'Anfa`, nie mit Backslash."*

**Das gilt nur für die alte Liste.** In der neuen Liste steht der Backslash real:
`A l \ ' A n f a` → `U+005C U+0027`, byte-verifiziert am Wikitext (34402 Bytes, identisch zur Recherche).

- **13 Backslashes** im Dokument, **ausnahmslos** vor Apostrophen (13 Backslash gesamt = 13 `\'`).
- Betroffen: Al'Ahabad, Al'Anfa (2×), Charr'Jrzz Pfahldorf (2×), Gh'Orrgelmur, Krs'Zzah (2×),
  Tie'Shianna (2×) — **und der Quellenname** „Al\'Anfa und der tiefe Süden" (3×).
- Warum die Recherche es übersah: sie suchte nach `Al'Anfa`; der String `Al\'Anfa` **enthält diesen
  Substring nicht**. Die 8 sauberen Treffer stammen aus der alten Liste + Legende.

**Folge ohne Unescaping:** Al'Anfa spaltet in zwei Kartensätze auf (alt unter `Al'Anfa`, neu unter
`Al\'Anfa`), und der Quellenname der neuen Liste matcht sein eigenes Wikilink-Ziel in der alten nicht.

### 2.2 „neu = reichere Felder" trägt nicht als Quellen-Autorität

Die Quellenspalte der neuen Liste ist maschinell **nicht zuverlässig zerlegbar**:

- Titel **enthalten Kommas**: `Arivor | Fürsten, Händler, Intriganten` ist EINE Quelle, sieht aus wie drei.
- Der Trenner wechselt: `Brabak | IdDM, Al\'Anfa und der tiefe Süden; A166` — hier ein **Semikolon**.
- Parallel-Arrays sind teils inkonsistent: `Baliho | SdR, Alptraum ohne Ende, Märchenwälder, Zauberflüsse | 17 x 11,5/-/-`
  → 3 Format-Werte, aber 4 Komma-Teile (weil „Märchenwälder, Zauberflüsse" ein Titel ist und „11,5"
  selbst ein Komma trägt).
- Ad-hoc-Kürzel ohne Legende: „IdDM" = „In den Dschungeln Meridianas", steht **nicht** in der Legende.
  Die alte Liste schreibt dasselbe Werk als `[[In den Dschungeln Meridianas|G1]]`.

**Gemessen:** 39 von 230 Zeilen (17 %) haben ein Trennzeichen in der Quellenspalte **ohne** Parallel-Array,
das die Anzahl bestätigt → nicht entscheidbar.

**Entschärfung:** Die alte Liste ist die Identitäts-Autorität. Von den 39 mehrdeutigen Zeilen betreffen
**37 Städte, die auch in der alten Liste stehen** — dort sind die Quellen saubere Wikilinks.
**Nur 2 mehrdeutige Zeilen** betreffen Nur-Neu-Städte.

| Liste | Zeilen | Quellen-Extraktion |
|---|---|---|
| alt | 136 | **283 Wikilink-Quellen** sauber extrahierbar, 13 Zellen mit Klartext-Rest |
| neu | 230 | 191 eindeutig · **39 nicht entscheidbar** (davon nur 2 schmerzhaft) |

### 2.3 Die Legende braucht keinen Parser

`[[Al'Anfa und der tiefe Süden|Al'Anfa]] || Al'Anfa und der tiefe Süden` — das **Link-Ziel ist bereits
der Volltitel**, nur der Anzeigetext ist gekürzt. Wer das Ziel statt des Anzeigetexts nimmt, hat
„VG2"/„G1"/„Land" automatisch aufgelöst. **Kein Legende-Parser nötig.**

## 3. Entscheidungen

### 3.1 wiki_key (Owner-Wahl: Stadt + Quelle + Spaltentyp)

```
stadtplanindex:<norm-stadt>:<norm-quelle>:<spaltentyp>
kartenindex:<norm-region>:<norm-quelle>:<art>
```

**Warum die Wiki-Zeile die Karte ist:** die neue Liste gibt Format/Maßstab/Künstler **pro Quelle** als
Parallel-Array (`A2/-`) — das Wiki modelliert selbst „pro Quelle eine Karte". Der Spaltentyp muss in den
Key, weil dieselbe Quelle Stadtplan **und** Umgebungskarte enthalten kann.

**Quellen-Identität:**
- **Primär** das Wikilink-**Ziel** der alten Liste (283 saubere Tripel).
- Für die 69 Nur-Neu-Städte: Klartext der neuen Liste, konservativ geparst.
- Bei mehrdeutiger Zelle (Trenner ohne bestätigendes Parallel-Array): **als EINE Quelle übernehmen,
  nicht raten** (Recherche: „aufgeben statt raten"). Betrifft 2 Fälle; im Editor korrigierbar.

`citymap` bekommt `wiki_key VARCHAR(190) NULL` + `UNIQUE KEY` — self-healing ALTER via
information_schema-Probe (Muster: `thumb_auto_url` in `citymaps.php`). NULL bleibt für manuelle Karten
erlaubt (MySQL: UNIQUE ignoriert NULLs → „eindeutig, sobald gesetzt", wie bei `adventure`).

### 3.2 Unescaping (Owner-Wahl: erst am echten Dump verifizieren)

**Der Dump ist vor dem Bau nicht erreichbar:** Basic-Auth-geschützt, liegt nur serverseitig unter
`uploads/dumps` (HTTP-denied). Vorab-Verifikation ist unmöglich; der einzige Weg dorthin ist der
„Dump holen"-Lauf, den erst dieser Bau ermöglicht.

**Auflösung ohne Extrarunde:**
1. Der Normalisierer entfernt Backslash-vor-Apostroph. Bei sauberem Dump ist das ein **No-op** —
   es existiert kein legitimer Backslash, der kaputtgehen könnte (13/13 stehen vor Apostrophen).
   Der Parser ist damit gegen **beide** Realitäten robust, nicht gegen eine geraten.
2. Die Phase führt einen Zähler **`escaped_names_seen`** im „Dump holen"-Fortschritt mit. Der erste
   echte Lauf zeigt `0` (Dump sauber, API-Artefakt) oder `13` (Dump escapet genauso) — Verifikation
   am echten Dump zum frühestmöglichen Zeitpunkt.

### 3.3 Ortlose Kontinentkarten (Owner-Wahl: als unresolved)

Aventurienkarten/Derekarten nennen keinen Ort → `citymap_place` mit `raw_name='Aventurien'` bzw.
`'Dere'`, `target_kind='unresolved'`. Exakt wie die 33 echten Lücken (Bosparan, Keft, Malquis).
**Kein Sonderpfad im Code.** Sie erscheinen heute nirgends, sind im Editor pflegbar, und lösen sich
automatisch auf, falls je ein passendes Ziel entsteht.

### 3.4 origin='wiki'

`citymap.origin` kennt heute nur `manual|community`. Neu: `wiki`.
- `avesmapsUpsertCitymap` (`citymaps.php:845`) stempelt hart `'manual'` → bekommt einen
  **`origin`-Parameter** (Default `'manual'`, damit alle Bestandsaufrufer unverändert bleiben).
  **Kein zweiter Anlegepfad** — die Funktion ist die geteilte Tür, die auch die parallele
  Community-Sitzung nutzt.
- Editor-Liste: `pill--wiki` neben den bestehenden Pillen.

## 4. Bauplan

1. **Parser** (`api/_internal/wiki/citymap-sync.php`) — reine Funktionen über Wikitext, unit-getestet
   gegen den echten Wikitext als Fixture. Myranor-Abschnitte ausgefiltert (0/12 auflösbar).
   `Abmessungen` (cm) → `note`, **niemals** `width_px`/`height_px` (die sind Pixel).
2. **Staging + Phase** — `avesmapsEnsureCitymapStagingTables` **nur auf dem Sync-Pfad**;
   **nicht** in `avesmapsCitymapsEnsureTables`, die bei jedem öffentlichen Read läuft (AGENTS.md §10).
   Phase `citymaps` in `dump-hybrid-driver.php` neben `PHASE_ADVENTURES`.
3. **Reconcile** (`sync_citymaps` in `api/edit/wiki/dump.php`) — 1:1 nach `sync_adventures`:
   `edit`-Gate, Pipeline-Lock, Heartbeat, `wiki_key`-Cursor, ein Schritt pro Request (STRATO).
   Schreibt/löscht **nur** `origin='wiki'`; manual/community/suppressed unberührt.
   `feature_sources` **nur** mit `origin='wiki_publication'` (Muster: Publikations-Sync).
4. **UI** — Button „Karten syncen" in der Karteneditor-Kopfzeile neben „Links prüfen"
   (Muster `html/adventure-editor.html:320` `#aeSyncBtn` → `window.parent.startWikiSync…()`),
   **nicht** im Menüband. `pill--wiki` in der Liste.
5. **Smoketest** — „Dump holen" (Phase `citymaps` läuft mit, `escaped_names_seen` ablesen) →
   „Karten syncen" → Karten mit Wiki-Pille in der Liste → erscheinen an ihren Siedlungen.
   **Zweiter Sync-Lauf legt KEINE Dubletten an.**

## 5. Bekannte Risiken

- **Kartenindex-Quote ungemessen.** Recherche §6 lässt sie offen; die 83 % gelten nur für den
  Stadtplanindex. Unauflösbare Zeilen werden `unresolved` mit erhaltenem `raw_name` — kein Datenverlust,
  aber die Regionalkartenwerk-Abschnitte könnten im Editor mager aussehen.
- **Dump ≠ API ungeprüft.** Ob Stadtplanindex/Kartenindex im Dump identisch aussehen, zeigt erst der
  erste Lauf (siehe §3.2). Der Parser ist gegen beide Formen robust.
- **2 mehrdeutige Nur-Neu-Quellenzellen** werden als je eine Quelle angelegt (statt zerlegt).

## 6. Parallel laufende Sitzungen

Die jeweils andere C-Sitzung (§3.8 Community bzw. Wiki-Sync) legt ebenfalls citymaps aus fremder
Quelle an. Geteilte Tür: **`avesmapsUpsertCitymap`** — kein zweiter Anlegepfad (§3.4).
Überschneidung sonst nur `css/styles.css` (`?v=`) und `js/app/i18n-en.js` (cityMaps-Block).
