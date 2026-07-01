# Umbau: Online-WikiSync → „Read WikiDump" (MediaWiki-XML-Dump)

> **Status:** PLAN / Instruction für eine neue Session. Noch nichts umgebaut.
> **Erstellt:** 2026-07-01. **Autor:** Analyse via 4 parallele Explore-Agenten + direkte Dump-Inspektion.
> **Ziel-Freigabe:** Owner muss die offenen Entscheidungen (§11) beantworten, bevor Umbau beginnt.

Diese Datei ist die **einzige Wahrheit** für den Umbau. Sie ist bewusst redundant/fallback-resistent:
jede kritische Invariante ist mehrfach genannt, und jede Phase hat ein Rollback.

---

## 0. Ziel in einem Satz

Ersetze **alle** Online-Crawl-Quellen des WikiSync (Siedlungen, Herrschaftsgebiete/Territorien,
Regionen/Landschaften, Wege/Flüsse, Bauwerke) durch das **Herunterladen + Parsen des offiziellen
MediaWiki-XML-Dumps**. Der Downstream (Staging → Sandbox-Modell → DIFF/TEST/APPLY, der
Territorien-Editor, die Hierarchie, der Routing-Graph) bleibt **1:1**. Die 🚨-Buttons werden von
„WikiSync" (Online-Crawler) zu **„Read WikiDump"** (Dump-Leser).

**Leitprinzip:** Es wird **nur die Fetch-Ebene getauscht**, nicht der Downstream. Das ist ein
chirurgischer Eingriff an genau einer Stelle pro Entität, kein Neubau.

---

## 1. Der Dump — verifizierte Fakten

- **Verzeichnis:** `https://offline.wiki-aventurica.de/dump/` (HTTP **Basic-Auth**, `WWW-Authenticate: Basic realm="Dummy"`).
- **Zugangsdaten:** User `Gareth`, Passwort `Phex`. (Base-Domain ist 403; nur `/dump/` ist mit Auth erreichbar.)
- **Deutsche Datei:** `dewa_dump_small.xml.bz2` — **~39 MB `.bz2` → ~315 MB XML**.
  (Andere Sprachen: `enwa_`, `frwa_`, `itwa_`, `nlwa_`, `ruwa_` — **irrelevant**, nur `dewa_` nehmen.)
- **Frische:** **täglich** neu generiert (beobachtet: `2026-07-01 06:16`).
- **Format:** MediaWiki-XML-Export **v0.11**, Generator **MediaWiki 1.43.0**, `<sitename>Wiki Aventurica</sitename>`, `<dbname>dewa</dbname>`.
- **Umfang:** **223.583 `<page>`**; NUR aktuelle Revision je Seite („_small" = keine Historie).
- **Namespace-Umfang (verifiziert):**
  - Artikel/Main (ns 0): **202.897** ✅
  - Vorlage (ns 10): 4.007 — **brauchen wir NICHT** (Infobox-Params werden direkt geparst, nicht gerendert)
  - Kategorie (ns 14): 16.127 — optional (Enumeration läuft besser über Infobox-Präsenz, s. §4.4)
  - **Datei (ns 6): 0** 🚩 — **keine Wappen-Lizenz-Metadaten im Dump** (s. §3, Invariante I5)
  - Benutzer/Diskussion: 0 (gut, kein Ballast)
- **Redirects:** 20.563 Weiterleitungen, kodiert als `<page>…<redirect title="Ziel"/>…</page>`.
- **Download-Rezept (verifiziert, funktioniert):**
  ```bash
  curl -s -u "Gareth:Phex" -o dewa.xml.bz2 "https://offline.wiki-aventurica.de/dump/dewa_dump_small.xml.bz2"
  bunzip2 -kf dewa.xml.bz2          # -> dewa.xml (~315 MB)
  ```
- **Test-Fixture:** Eine dekomprimierte Kopie liegt (session-lokal) unter `%TEMP%/wadump/dewa.xml`.
  Für die neue Session neu herunterladen (obiges Rezept).

### Beispiel-Wikitext (verifiziert, alle Felder vorhanden)

**Siedlung** — `{{Infobox Siedlung}}` (Bsp. „Angbar"): `|Name= |Wappen={{Boximage|Wappen Angbar.webp}}
|Herrschaftsform= |Einwohnerzahl=5300 <small>(… [[1041 BF]])</small> |Oberhaupt= |Region= |Staat= |Gründungsdatum=`
+ `==Kurzbeschreibung==` Fließtext + `{{Aventurien}}` (Kontinent) + `{{DereGlobus-Link|Länge(x)=…|Breite(y)=…}}` (Koordinaten).

**Territorium** — `{{Infobox Staat}}` (Bsp. „Fürstentum Kosch"): `|Name= |Wappen= |Art=[[Fürstentum]] …
|Status= |Herrschaftsform= |Hauptstadt=[[Angbar]] |Oberhaupt= |Sprache= |Währung= |Handelswaren=
|Einwohnerzahl= |Gründungsdatum={{Datum|0|||}} |Gründer= |aufgelöst= |Region= |Staat=[[Mittelreich]]`
→ **`|Staat=` = das Obergebiet (parent) für die Hierarchie.**

**Region** — `{{Infobox Region}}` (Bsp. „Hügellande"): `|Name= |Art= |Einwohnerzahl= |Sprache=
|Region=[[Kosch (Region)]] (=Lage) |Staat=[[Mittelreich]]: [[Fürstentum Kosch]] (=Zugehörigkeit) |Vegetationszonen=`.

**Fluss/Weg** — `{{Infobox Fluss}}`: `|Name= |Bild= |Art= |Länge= |Regionen= |Verlauf=` — **KEINE Geometrie** (nur Metadaten).
`{{Infobox Bauwerk}}` (2.487×): `|Name= |Art= |Standort= |Zugehörigkeit= |erbaut= |zerstört= |Besitzer= …`.

**Infobox-Zählung im Dump (relevante):** `Infobox Siedlung` 2.661 · `Infobox Region` 1.851 ·
`Infobox Staat` 1.370 · `Infobox Bauwerk` 2.487 · `Infobox Fluss` 401 (+ `Infobox Straße`).

---

## 2. Kern-Architektur des Umbaus (was sich ändert / was bleibt)

```
                          ┌──────────────── UNVERÄNDERT (Downstream) ─────────────────┐
  ┌── ERSETZT ──┐         │  Staging-Tabellen → Sandbox-Modell → DIFF → TEST → APPLY   │
  │  Online-    │         │  Editor (Territorien) · Assign (Wege/Regionen) · Cases     │
  │  Crawler    │  ──▶    │  political_territory(_geometry) · map_features · Graph      │
  │  (5 Stück)  │         └────────────────────────────────────────────────────────────┘
  └─────────────┘
        ▲
        │  wird zu
        ▼
  ┌── NEU ───────────────────────────────────────────────────────────────────────┐
  │  DUMP-READER: dewa.xml.bz2 holen → Streaming-Parse (XMLReader) → dieselben     │
  │  Staging-Tabellen füllen, mit DENSELBEN wiki_key-/Infobox-Parsern wie bisher   │
  └────────────────────────────────────────────────────────────────────────────────┘
```

**Der einzige HTTP-Einstiegspunkt, der wegfällt:** `avesmapsWikiSyncApiRequest()` in
`api/_internal/wiki/sync.php` (schießt gegen `https://de.wiki-aventurica.de/de/api.php`, throttled 600ms).
Dahinter hängen alle 5 Crawler.

**Wiederverwendbar (NICHT neu bauen), weil bereits wikitext-basiert:**
- `avesmapsWikiSyncMonitorExtractInfoboxBlock()` — findet den `{{Infobox …}}`-Block (klammer-tief).
- `avesmapsWikiSyncMonitorParseTemplateParams()` — `|Feld=Wert` → Assoc-Array.
- `avesmapsWikiSyncCleanPoliticalTerritoryWikiValue()` — 10-stufige Wikitext-Bereinigung (Links, {{Datum}}, refs …).
- `avesmapsWikiSyncBuildPoliticalTemporalPayload()` — BF-Jahre aus Text (`founded_*`, `dissolved_*`).
- `avesmapsWikiSyncReadWikiTemplateFields()`, `…MonitorCoatOfArmsUrl()`, `…MonitorNormFields()`.
(Alle in `api/_internal/wiki/sync-monitor-parsing.php` bzw. `territories-parsing.php`.)

**Was WEGFÄLLT (die „wilde HTML-Parserei"):**
- `avesmapsWikiSyncFetchParsedWikiHtml()` (`action=parse` → HTML) und
  `avesmapsWikiSyncParsePoliticalTerritoryRowsFromHtml()` (DOMDocument/XPath über `Staat/Liste`-Tabellen).
  → Ersetzt durch **Infobox-Präsenz-Enumeration** im Dump (s. §4.4). Territorien werden nicht mehr aus
  HTML-Listentabellen entdeckt, sondern durch Scan nach `{{Infobox Staat}}` (+ Kategorien).
- Kategorie-Enumeration via `list=categorymembers` → **Scan des Dumps** nach Infobox-Templates.
- Throttling / HTTP-Retry / Batch-Scheduling (20 Titel/Call) → entfällt (lokale Datei).
- Wappen-Lizenz-Enrichment via Commons-API → s. Invariante I5 (Sonderfall).

---

## 3. Kritische Invarianten & Fallstricke 🚩 (mehrfach lesen)

> Diese Liste ist der wichtigste Teil. Verletzt der Umbau eine davon, sind Daten/Routen/Hierarchie kaputt.

**I1 — `wiki_key` MUSS bit-genau gleich abgeleitet werden wie heute.**
Der `wiki_key` ist der Identitäts-Anker zwischen DB-Zeile und Wiki-Seite. Ableitung heute (⚠️ es gibt
mehrere Schemata je Entität — **exakt verifizieren, nicht raten**):
- Territorien: `avesmapsPoliticalBuildWikiKey($wikiUrl, $name)` → z. B. `wiki:mittelreich` (Prefix `wiki:` + normalisierter Slug). Anker in `political_territory.wiki_key` (UNIQUE) + `political_territory_wiki.wiki_key`.
- Siedlungen/Regionen/Wege: `avesmapsWikiSyncCreateMatchKey()` (+ `normalized_key`/`match_key`) in `api/_internal/wiki/sync.php`.
**TASK 1 des Umbaus = diese Funktionen extrahieren, mit dem Dump-`<title>` als Input aufrufen, und
per Vergleichs-Test (§9) beweisen: 0 verlorene Matches.** Der Dump-Reader ruft dieselben Funktionen auf,
erfindet nichts neu. (Memory-Warnung: der Slug „verschluckt ö/ä/ü" — genau diese Eigenheit reproduzieren.)

**I2 — Der Routing-Graph muss 1:1 identisch bleiben.**
Der Graph wird aus `map_features` gebaut (Knoten = Location-Namen; Kanten = Pfad-Segmente; Gewicht =
Distanz/Speed nach `feature_subtype`; Split an inneren Location-Vertices) in `api/_internal/routing/client-graph.php`.
**Das Wiki liefert KEINE Geometrie** (`{{Infobox Fluss}}` hat nur `|Verlauf=` als Text). Der Wege-Import
schreibt heute NUR `properties_json['wiki_path']` (Metadaten) an gematchte Segmente.
→ **VERBOTEN beim Dump-Import:** `geometry_json`, `feature_subtype` (ohne UI-Review), Location-Koordinaten
oder Location-`name` anfassen. Diese speisen den Graphen. Erlaubt: nur das `wiki_path`-Metadaten-Objekt.

**I3 — `political_territory_geometry` wird NIE automatisch neu zugewiesen.**
Geometrien hängen unabhängig per `territory_id`-FK. Der Sync fasst sie nicht an (Independence-Prinzip).
Der Dump-Import darf das nicht ändern.

**I4 — Editor-Korrekturen überleben den Re-Import.**
`wiki_territory_model.parent_locked=1` + `metadata_overrides_json` schützen manuelle Hierarchie-/Feld-
Korrekturen vor dem (Re-)Crawl. Der Dump-Reader füllt nur die Sandbox (`political_territory_wiki_test` +
`auto_parent_wiki_key`); REBUILD/DIFF/TEST/APPLY bleiben identisch → Overrides bleiben erhalten.

**I5 — 🚩 Wappen-Lizenz ist NICHT im Dump (0 Datei-Seiten).**
Der `_small`-Dump enthält keine `Datei:`-Seiten → keine Lizenz-Templates. Der aktuelle Crawler holt die
Lizenz (`coat_license_status`, `coat_author`, …) via separatem Commons/WA-File-API-Call.
**Konsequenz + Lösung:**
- Der Dump liefert weiterhin den **Wappen-Dateinamen** (aus `|Wappen={{Boximage|Wappen X.webp}}`) → URL wie bisher baubar.
- Beim APPLY die **bestehende Lizenz-Klassifikation NICHT überschreiben** (behalten). So bleiben alle heute
  als `public_domain` klassifizierten Wappen sichtbar (Policy: nur `public_domain` wird öffentlich gezeigt).
- Für **neue/geänderte** Wappen: Status default `unknown` → wird ausgeblendet (safe), Editor klassifiziert
  weiter manuell (Policy erlaubt das).
- **Optionaler Zusatz:** ein winziger, gezielter Online-Lizenz-Fetch **nur für neue/geänderte Wappen-Dateien**
  (viel kleiner als der Voll-Crawl) ODER die WA-Betreiber um einen Datei-Namespace-Dump / Lizenz-Export bitten.
  → **Offene Entscheidung O3 (§11).**

**I6 — Kategorie-Mitgliedschaft aus Templates ist im Roh-Wikitext unsichtbar.**
Viele Kategorien werden von Templates gesetzt (z. B. `{{Register Siedlung}}`, `{{Aventurien}}`), nicht als
`[[Kategorie:]]` im Artikel. Deshalb:
- **Enumeration** (welche Seite ist Siedlung/Territorium/…): über **Infobox-Präsenz** (`{{Infobox Siedlung}}`
  etc.) — stärkeres Signal als Kategorien.
- **Kontinent**: über den Marker-Template `{{Aventurien}}` / `{{Dere}}` / `{{Myranor}}` im Wikitext
  (Angbar hat `{{Aventurien}}`). Nur `Aventurien` wird importiert (Filter wie heute).
- Rest-Risiko (Seite in Kategorie, aber ohne Infobox) → deckt der Vergleichs-Test (§9) auf.

**I7 — Redirects konsistent auflösen.**
20.563 Redirects im Dump (`<redirect title="…"/>`). Beim Reader eine **Alias-Map** bauen und
`wiki_redirect_alias` daraus befüllen (statt via API-`redirects=1`). Parent-Referenzen, die auf eine
Weiterleitung zeigen, müssen genauso auf den kanonischen `wiki_key` aufgelöst werden wie heute.

**I8 — Rollback jederzeit.** Der Online-Crawler bleibt vorerst funktionsfähig (nicht löschen) als Fallback,
bis der Vergleichs-Test grün ist und der Owner freigibt (s. §10).

---

## 4. Neue Komponente: der Dump-Reader

Neues Internal-Lib-File, z. B. `api/_internal/wiki/dump-reader.php` (+ dünner Endpoint-Wrapper).

### 4.1 Bezug der Datei (Auto-Upload) — s. §6.

### 4.2 Dekompression
- Beim **Server-Fetch** (s. §5) kommt die Datei als `.bz2` → auf STRATO dekomprimieren. **Zuerst prüfen (Task):**
  `extension_loaded('bz2')`. Wenn ja: `bzopen`/`bzdecompress` (streamend). Wenn nein: Fallback `exec('bunzip2')`
  (falls erlaubt) / pure-PHP-bzip2-Decoder (langsamer, aber ~ok für 40 MB) / bei WA `.gz`-Variante erbitten.
- (Nur falls später doch die GitHub-Action-Variante gewählt würde: Datei läge als `.xml.gz` vor → `compress.zlib://`;
  zlib ist auf STRATO immer vorhanden.)

### 4.3 Streaming-Parse (Pflicht — 315 MB dürfen NIE in den RAM)
- **`XMLReader`** (nicht SimpleXML/DOM!). Iteriere `<page>`-Elemente; je Seite: `title`, `ns`, ggf.
  `<redirect>`, und `revision/text` (der Wikitext).
- Memory bleibt konstant klein. Kein `file_get_contents` der ganzen Datei.

### 4.4 Zwei Durchläufe (oder ein Durchlauf + Index)
1. **Pass A — Index/Alias:** einmal durch, sammle
   (a) Redirect-Map `alias_slug → Zielseite` (→ `wiki_redirect_alias`),
   (b) optional einen Titel→Offset-Index für Random-Access (nicht zwingend).
2. **Pass B — Entitäten:** einmal durch; für jede Main-NS-Seite:
   - Prüfe Infobox-Präsenz: `{{Infobox Siedlung|Region|Staat|Bauwerk|Fluss|Straße}}`.
   - Bei Treffer: Infobox-Block + Params via **bestehende Parser** (§2) → Feld-Mapping (§7) →
     UPSERT in die passende Staging-Tabelle mit **`wiki_key` = bestehende Ableitung (I1)**.
   - Kontinent-Filter via `{{Aventurien}}` (I6).

### 4.5 Chunking / Resume (STRATO-Zeitlimit)
- Ein Voll-Pass über 315 MB in einem Web-Request sprengt `max_execution_time`.
- **Wiederverwende die bestehende Resume-Infrastruktur:** `wiki_sync_runs` (State/Progress) +
  ein „Reader-Cursor" (XMLReader kann nicht serialisiert werden → Cursor = **letzte verarbeitete Seiten-ID
  bzw. Byte-Offset**; pro Step von vorne öffnen und bis zum Cursor `read()` überspringen, dann N Seiten
  verarbeiten). Alternativ: **CLI/Cron-Lauf** (falls STRATO das erlaubt) in einem Rutsch.
- Das Frontend-Polling (`crawl_step`/`advance_run`, §5-Analyse) wird zu `read_step` — gleiches
  `<progress>`-Muster, nur Fortschritt = verarbeitete Seiten / geschätzte Gesamt.

### 4.6 Idempotenz
- Alle Staging-Tabellen sind `UNIQUE(wiki_key)` → `INSERT … ON DUPLICATE KEY UPDATE`. Ein Re-Read
  erzeugt keine Dubletten. Ein abgebrochener Lauf ist gefahrlos wiederholbar.

---

## 5. Dump-Bezug — MANUELL (wie bisher) 🚩 O1 ENTSCHIEDEN (2026-07-01)

**Owner-Vorgabe:** manuell syncen wie heute, **KEIN täglicher Auto-Sync**. Begründung des Owners:
unbeaufsichtigte Änderungen sollen nicht „einfach passieren", und ein Cred-Wechsel bei WA soll auffallen.

**Entscheidung: Server-Fetch-Button** (ein Klick, wie der jetzige 🚨-Button) mit **selbst-heilendem
Credential-Handling** (§5.0). Ablauf bei „Read WikiDump":
1. Server-Endpoint holt `dewa_dump_small.xml.bz2` von WA mit **Basic-Auth**, Creds aus dem **DB-Setting** (§5.0).
2. Dekomprimiert (§4.2) → parst chunked (`read_step`) → füllt **Staging/Sandbox**.
3. Danach wie heute: **DIFF → TEST → APPLY/Assign — manuell, reviewt.** Nichts wird automatisch angewandt.

### 5.0 Credential-Handling 🚩 (Owner-Wunsch, entschieden)
- Die Dump-Creds sind **nicht wirklich geheim** — das Wiki stellt User/Passwort öffentlich bereit. Sie liegen
  in einem **DB-Setting** (admin-only, capability-gated; „zuletzt genutzt"), damit sie **zur Laufzeit editierbar**
  sind — **nicht** hartkodiert, **nicht** nur in `config.local.php`. **Default-Seed:** `Gareth` / `Phex`.
- **Prompt-bei-401 (self-service):** Liefert der Fetch **HTTP 401** (WA hat die Creds geändert), zeigt das Panel
  **direkt ein kleines Dialog** (User/Passwort, User vorbefüllt mit „zuletzt genutzt"). Du tippst die neuen Creds
  ein → Server wiederholt den Fetch → bei Erfolg werden sie als **neue „zuletzt genutzt" gespeichert** → Sync läuft weiter.
- **Ergebnis:** kein Redeploy, kein config-Edit. Cred-Wechsel wird beim Sync **erkannt UND inline behoben**.

**Warum das genau die Owner-Sorgen löst:**
- ✅ **Manuell wie bisher** — nichts passiert, bis du klickst.
- ✅ **Nichts „passiert unbemerkt":** Fetch+Parse füllt nur die Sandbox; die Live-Karte ändert sich erst beim
  manuellen APPLY/Assign nach Review. (So ist es heute schon — der Sync importiert nie direkt in die Live-Karte.)
- ✅ **Cred-Wechsel = sofort sichtbar UND sofort behebbar:** 401 beim Klick → Inline-Prompt → neue Creds eintippen → weiter.

**Bedenken gegen Server-Fetch sind hier keine:** Outbound-HTTP macht der jetzige Crawler schon (zu `de.wiki-aventurica.de`);
Creds im DB-Setting sind runtime-editierbar + admin-gated. Restfrage: **bz2-Dekompression auf STRATO** → §4.2 (erst verifizieren).

### 5.1 Optionales Frühwarn-Signal (jetzt WIRKLICH optional)
Der Inline-Prompt (§5.0) behebt den Cred-Wechsel bereits beim Sync. Falls du **zusätzlich vorher** gewarnt werden
willst: ein winziger wöchentlicher **HEAD-Ping** (kein Download) → **E-Mail bei 401/unreachable** über die SMTP-Infra.
Rein optional; Owner tendiert zum Inline-Prompt.

### 5.2 Alternativen (falls Server-Fetch/bz2 auf STRATO klemmt oder du es anders willst)
- **Manueller Upload-Button:** `.bz2` (≤40 MB) selbst hochladen statt Server-Fetch. Braucht `upload_max_filesize` ≥ 45 MB (`.user.ini`).
- **Tägliche GitHub-Action (automatisch):** NUR falls du später doch Automatik willst (holt+SFTP-transferiert den Dump täglich;
  Apply bliebe trotzdem manuell). **Vom Owner aktuell abgelehnt** („will manuell syncen"). Vorteil wäre: Creds als GitHub-Secrets
  statt auf STRATO, kein bz2 auf STRATO. Für den manuellen Wunsch aber der falsche Fit (automatisch + Silent-Fail bei Cred-Wechsel).

---

## 6. Umbau je Entität

Für **jede** Entität gilt: nur die **Befüllung der Staging-Tabelle** wird vom Online-Crawler auf den
Dump-Reader umgestellt. Assign/Apply/Editor/Review bleiben.

### 6.1 Siedlungen (Siedlungen-Tab, `#wiki-sync-start`)
- Heute: Kategorien (Dorf/Kleinstadt/Stadt/Großstadt/Metropole) → `wiki_sync_pages` → Cases → `map_features(location).properties_json.wiki_settlement`.
- Neu: Dump-Scan nach `{{Infobox Siedlung}}` → gleiche Felder (name, art/Siedlungsart, Einwohnerzahl,
  Oberhaupt, Region, Staat, Wappen, Koordinaten via `{{DereGlobus-Link}}`/`{{Positionskarte}}`, Beschreibung
  aus `==Kurzbeschreibung==`) → `wiki_sync_pages` mit **gleichem `normalized_key`/`wiki_key`**.
- **Bauwerke** (heute `crawlSettlementBuildingsChunked`): Dump-Scan nach `{{Infobox Bauwerk}}` → gebaeude/Festungen.
- Risiko: **niedrig** (Metadaten + Koordinaten; Geometrie n/a). Case-/Matching-Flow unverändert.

### 6.2 Regionen (Regionen-Tab, `#region-sync-crawl`)
- Heute: derographie-Kategorien → `wiki_region_staging` → Assign an `map_features(label)`.
- Neu: Dump-Scan nach `{{Infobox Region}}` → Felder (art→label_subtype, Region=Lage→region_parent,
  Staat→affiliation_staat, Einwohnerzahl, Sprache, Vegetationszonen, Nachbarn, Bild, Beschreibung).
- Risiko: **niedrig** (flache Liste, kein Graph).

### 6.3 Wege/Flüsse (Wege-Tab, `#path-sync-crawl`)
- Heute: Fluss/Straße/Reichsstraße/Pass/Karawanenroute-Kategorien → `wiki_path_staging` → Assign schreibt
  `properties_json['wiki_path']` an gematchte Segmente (per `match_key`).
- Neu: Dump-Scan nach `{{Infobox Fluss}}`/`{{Infobox Straße}}` → gleiche Felder (name, art, lage, laenge,
  verlauf, description, synonyms, kind, continent) → `wiki_path_staging` mit **gleichem `match_key`/`wiki_key`**.
- 🚩 **I2/Graph:** Assign bleibt exakt; **niemals** Geometrie/Subtyp/Location anfassen.
- Risiko: **niedrig** (nur Metadaten, Graph unberührt).

### 6.4 Herrschaftsgebiete/Territorien (Territorien-Tab → Editor-iframe, `#btnCrawl`) — der große Brocken
- Heute: 23 Seed-Seiten (`Staat/Liste`, `Königreich/Liste`, …) via `action=parse` → **HTML-Tabellen-Parse**
  (DOMDocument) → `political_territory_wiki_test` (Sandbox); zusätzlich Infobox-Detail-Enrichment; dann
  REBUILD-Modell (`wiki_territory_model.parent_wiki_key`) → DIFF → TEST → APPLY (mit `political_territory_identity_backup`).
- Neu: **HTML-Listen-Parse fällt weg.** Territorien werden per **Dump-Scan nach `{{Infobox Staat}}`**
  (+ Kontinent `{{Aventurien}}`) entdeckt und aus dem Infobox-Wikitext befüllt (die Infobox-Parser existieren
  schon!). Felder → `political_territory_wiki_test` (gleiche Spalten): type/art, status, herrschaftsform,
  hauptstadt, oberhaupt, sprache, waehrung, handelswaren, einwohnerzahl, gruendungsdatum→founded_*(BF),
  aufgelöst→dissolved_*(BF), gruender, blazon, coat_of_arms_url, **`|Staat=` → affiliation/parent** →
  `affiliation_path_json`/`affiliation_root`.
- **Hierarchie (`parent_id`):** wie heute abgeleitet aus `wiki_territory_model.parent_wiki_key` beim APPLY.
  Der `|Staat=`-Link liefert den Parent; Redirect-Alias-Auflösung (I7) sorgt fürs Matching.
- 🚩 **I1/I3/I4:** `wiki_key`-Ableitung identisch; Geometrie unberührt; parent_locked/Overrides bleiben.
  **REBUILD/DIFF/TEST/APPLY + der ganze Editor-Workflow bleiben 1:1** — nur die Sandbox-Befüllung ändert sich.
- Risiko: **hoch** (Hierarchie + `wiki_key`) → dafür der Vergleichs-Test (§9) mit Fokus Territorien.

---

## 7. Feld-Mapping (Dump-Infobox-Param → Staging-Spalte)

> **Regel:** Die bestehenden Parser (`…ParseTemplateParams` + `…MonitorNormFields` +
> `…CleanPoliticalTerritoryWikiValue`) übernehmen Normalisierung/Cleaning. Das Mapping unten nur zur Kontrolle,
> dass alle Zielspalten bedient werden. Feldnamen im Dump sind teils mit Umlaut (`Einwohnerzahl`, `Gründungsdatum`,
> `Währung`, `aufgelöst`) — der `FieldKey()`-Normalizer faltet die schon.

**Territorium `{{Infobox Staat}}` → `political_territory_wiki(_test)`:**
`Art/Typ→type` · `Status→status` · `Herrschaftsform→form_of_government` · `Hauptstadt→capital_name` ·
`Herrschaftssitz→seat_name` · `Oberhaupt→ruler` · `Sprache→language` · `Währung→currency` ·
`Handelswaren→trade_goods` · `Einwohnerzahl→population` · `Gründungsdatum→founded_text/founded_*_bf` ·
`Gründer→founder` · `aufgelöst→dissolved_text/dissolved_*_bf` · `Wappen→coat_of_arms_url` ·
`(Blasonierung)→blazon` · `Staat→affiliation/affiliation_path_json/affiliation_root` · `Name→name` ·
(Kontinent aus `{{Aventurien}}`).

**Siedlung `{{Infobox Siedlung}}` → `wiki_sync_pages`:**
`Name→name` · `Siedlungsart/Art→settlement_class/label` · `Einwohnerzahl→…` · `Oberhaupt→…` · `Region→…` ·
`Staat→…` · `Wappen→coat_url` · Koordinaten aus `{{DereGlobus-Link}}`/`{{Positionskarte}}` · Beschreibung aus `==Kurzbeschreibung==`.

**Region `{{Infobox Region}}` → `wiki_region_staging`:**
`Name→name` · `Art→art/label_subtype` · `Region→region_parent (Lage)` · `Staat→affiliation_staat` ·
`Einwohnerzahl→…` · `Sprache→…` · `Vegetationszonen→vegetation` · Nachbarn→neighbors_json · `Bild→image_url` · Beschreibung.

**Weg `{{Infobox Fluss}}`/`{{Infobox Straße}}` → `wiki_path_staging`:**
`Name→name/wiki_key/match_key` · `Art→art/kind` · `Regionen/Lage→lage` · `Länge→laenge` · `Verlauf→verlauf` ·
Beschreibung · Synonyme · Kontinent.

**Bauwerk `{{Infobox Bauwerk}}` → (gebaeude-Pfad der Siedlungen):**
`Name→name` · `Art→…` · `Standort→…` · `Zugehörigkeit→…` · `erbaut→founded` · `zerstört→dissolved` · `Besitzer→…`.

---

## 8. Umbenennung „WikiSync" → „Read WikiDump"

Nicht i18n'd (hart-kodiertes Deutsch). Zu ändern (≈12 Stellen, Analyse-verifiziert):
- `index.html`: Buttons Z.348, 321, 334 (`🚨 WikiSync`→`📥 Read WikiDump`), Z.383 (`WikiSync & Editor`→`Read WikiDump & Editor`), Tab Z.289 (`WikiSync`→`Read WikiDump`), Dialog-Titel Z.616 (`WikiSync-Fall lösen`→`WikiDump-Fall lösen`), `data-wiki-sync-panel-tab` etc. (nur Label-Text, DOM-ids/data-attrs **nicht** umbenennen, um JS nicht zu brechen — nur sichtbare Strings).
- `html/wiki-sync-monitor.html`: Z.199 `🚨 Sync starten`→`📥 Read WikiDump`.
- Confirm-Dialoge: `js/app/bootstrap.js:221`, `js/review/review-path-sync.js:447`, `js/review/review-region-sync.js:380`
  (Text „… crawlt das Wiki im Hintergrund neu" → „… liest den WikiDump ein").
- Status-Strings: `js/review/review-wiki-sync.js:49,95,123`.
> **Wichtig:** Nur **sichtbare Strings** umbenennen. DOM-`id`s (`wiki-sync-*`), `data-*`-Attribute, JS-Funktions-
> und Tabellennamen **unverändert lassen** (sonst bricht die Verdrahtung). Optional später als eigener Refactor.

---

## 9. Der große Vergleichs-Test (ohne Re-Crawl) 🚩 (Owner-Kernwunsch)

**Zweck:** Beweisen, dass der Dump-Reader denselben Datenstand liefert wie der jetzige (per Online-Crawl
befüllte) DB-Stand — **bis auf redaktionelle Wiki-Änderungen seit dem letzten Sync**. Kein erneuter Online-Crawl.

**Aufbau:** Ein eigenständiges Test-Tool (PHP-CLI oder eine Diagnostics-Seite `api/diagnostics/…`), das:
1. Den Dump **read-only** parst (kein Schreiben in die Live-Tabellen — in **Schatten-Staging**-Tabellen
   `*_dumptest`, oder in `political_territory_wiki_test`, das ja schon Sandbox ist).
2. Den aktuellen DB-Stand lädt.
3. Zeilenweise vergleicht und einen **Report** ausgibt.

**Pflicht-Asserts (Kern):**
- **A1 `wiki_key`-Deckung (härtester Assert):** Für **jede** existierende DB-Zeile mit `wiki_key` erzeugt der
  Dump-Reader denselben `wiki_key` und findet die zugehörige Dump-Seite. **Ziel: 0 verlorene Matches**,
  0 Dubletten. Getrennt je Entität (Territorien / Siedlungen / Regionen / Wege).
- **A2 Hierarchie identisch:** Für Territorien: die aus dem Dump abgeleiteten `parent_wiki_key`/`parent_id`
  stimmen mit dem aktuellen `political_territory.parent_id` überein (modulo `parent_locked`-Overrides, die
  bewusst abweichen dürfen). **Report listet jede Abweichung** (neu/geändert/entfernt).
- **A3 Graph unberührt (Beweis für „1:1"):** Der Dump-Import für Wege ändert **kein** `geometry_json`, **kein**
  `feature_subtype`, **keine** Location-Koordinaten/-Namen. Assert: der geplante Schreib-Diff enthält
  ausschließlich `properties_json['wiki_path']`. (Zusätzlich: eine Handvoll Referenz-Routen vor/nach berechnen
  → identische Segmentliste/Kosten.)
- **A4 Feld-Diff (redaktionell):** Pro Entität ein Diff der Infobox-Felder (Einwohner, Oberhaupt, Gründung/BF,
  Wappen-Dateiname, …) DB vs. Dump. Erwartung: nur echte redaktionelle Änderungen seit letztem Sync. Der Report
  ist die **Review-Liste** für den Owner.
- **A5 Wappen-Lizenz:** Report zählt Wappen, deren Lizenz im Dump fehlt (I5), und markiert „behalte bestehende Klassifikation".
- **A6 Kontinent-Filter:** nur `Aventurien`; Report zählt gefilterte Nicht-Aventurien-Seiten (Gegenprobe zur alten Kategorie-Methode).

**Ergebnis:** Grüner Test = Dump-Reader ist deckungsgleich → Umschaltung freigegeben. Roter Test = Report zeigt
exakt, wo (welche `wiki_key`s / Felder / Parents) es klemmt → gezielt nachbessern, bevor irgendetwas live geht.

---

## 10. Rollout & Fallback-Strategie

1. **Phase 0 (nicht-destruktiv):** Dump-Reader + Auto-Upload + Vergleichs-Test bauen. Online-Crawler bleibt
   voll funktionsfähig. Nichts an Live-Tabellen ändern. → Test grün bekommen.
2. **Phase 1 (Schatten-Betrieb):** Dump-Reader füllt die **Sandbox**/Schatten-Staging; Owner reviewt den A4-Diff.
   Immer noch kein Live-Write über den Dump.
3. **Phase 2 (Umschalten je Entität, einzeln):** Reihenfolge nach Risiko: **Wege → Regionen → Siedlungen →
   Territorien** (Territorien zuletzt, weil kritisch). Je Entität: Button auf Dump-Reader umhängen, ein
   kontrollierter Lauf, Review, ggf. Revert (`political_territory_identity_backup` / Staging ist idempotent).
4. **Phase 3 (Aufräumen):** Erst wenn alle Entitäten stabil auf Dump laufen: Online-Crawl-Code als „deprecated"
   markieren (nicht sofort löschen — Fallback). Umbenennung „Read WikiDump" finalisieren. Server↔Repo-Drift beachten
   (Deploy löscht nie; alte PHP-Crawler-Endpoints ggf. via „Retire orphaned remote files"-Schritt entfernen — **nie `mirror --delete`**).

**Rollback pro Phase:** Staging ist idempotent (I6); APPLY ist per Backup-Batch reversibel (I4); der Online-Crawler
bleibt bis Phase 3 als Notausgang.

---

## 11. Offene Entscheidungen für den Owner (VOR Umbaustart klären)

- **O1 — Dump-Bezug → ENTSCHIEDEN: manueller Server-Fetch-Button** (kein Auto-Sync). Creds im **DB-Setting**
  („zuletzt genutzt", Default Gareth/Phex), **Prompt-bei-401** (neue Creds inline eintippen → Server holt Dump →
  speichert sie, §5.0). Frühwarn-Signal (§5.1) rein optional. Restfrage: bz2-Extension auf STRATO (§4.2, Task).
- **O2 — Wo läuft der schwere Parse? → ENTSCHIEDEN (recherchiert 2026-07-01): chunked im Web-Request (`read_step`, resumierbar).**
  Belege aus dem eigenen Code: `api/_internal/wiki/sync.php:71` versucht `@set_time_limit(300)` + `@ini_set('memory_limit','512M')`,
  ABER alle Crawl-Steps kappen `step_runtime` auf **max 28s** (`min(28,…)` in sync-monitor/paths/regions) + `set_time_limit($step+15)`
  → das **reale sichere Web-Request-Budget ist ~30–45s**, Chunking ist Pflicht. Vorteil Dump: der Parse ist **viel schneller** als der
  alte Crawl (kein 600ms-Throttle/HTTP pro Seite) → nur ~9k relevante Infoboxen von 223k Seiten, wenige Steps. **Kein Cron nötig.**
  🚩 Wichtig: STRATO-MySQL ist auf Shared-Hosting i. d. R. **localhost-only** → der Parse MUSS **auf STRATO** laufen (nicht in der
  GitHub-Action, die kann nicht remote in die DB schreiben). Die Action macht **nur den Transfer** der Datei; STRATO parst lokal.
  Optionaler Bonus: falls STRATO-Cron/CLI verfügbar (STRATO bietet Cron; CLI-PHP hat meist `max_execution_time=0`), ginge auch ein
  Ein-Rutsch-Lauf — nicht erforderlich, `read_step` reicht.
- **O3 — Wappen-Lizenz (I5) → ENTSCHIEDEN: bestehende Klassifikation behalten + gezielter Mini-Online-Lizenz-Fetch NUR für
  neue/geänderte Wappen-Dateien.** (Wiederverwendet den vorhandenen Lizenz-Enrichment-Pfad `sync-monitor-licenses.php`
  / `sync-monitor-identity.php`, aber gefiltert auf neue Wappen → winziger Online-Rest, kein Voll-Crawl.)
- **O4 — Enumeration:** Infobox-Präsenz (empfohlen) vs. zusätzlich `[[Kategorie:]]`-Scan als Sicherheitsnetz.
- **O5 — Test-Schreibziel:** eigene `*_dumptest`-Schatten-Tabellen vs. das vorhandene `political_territory_wiki_test`.

---

## 12. Task-Liste für die neue Session (geordnet, jede Task eigenständig testbar)

> Ausführung via `superpowers:subagent-driven-development` empfohlen. Reihenfolge = Abhängigkeit.
>
> **Modell-Empfehlung (hohes Risiko, Korrektheit-kritisch):** Controller/Reviews + die Judgment-lastigen
> Tasks (**1 wiki_key**, **2 bz2-Check**, **Dump-Reader**, **Territorien/Hierarchie**, **Vergleichs-Test**)
> auf **Opus 4.8**. Mechanische Tasks (**Umbenennung**, **Buttons umhängen**, CSS/UI) dürfen auf **Sonnet 5**
> (schneller/günstiger). SDD kann Modell pro Task setzen → Hybrid = bestes Kosten/Qualität. Wer EIN Modell will:
> **Opus 4.8** für den ganzen Umbau (Einsätze rechtfertigen es), Sonnet 5 nur für spätere Routine-Politur.

1. **Key-Funktionen fixieren (I1):** `avesmapsPoliticalBuildWikiKey`, `avesmapsWikiSyncCreateMatchKey`,
   `normalized_key`-Ableitung exakt lokalisieren; Mini-Unit-Test (Titel→Key) für 20 reale Fälle inkl. ö/ä/ü.
2. **Dump-Reader-Skelett:** `api/_internal/wiki/dump-reader.php` — `.xml.gz` per `compress.zlib://` streamen
   (XMLReader), Pass A (Redirect-Alias-Map → `wiki_redirect_alias`), Progress/Resume via `wiki_sync_runs`+Cursor.
3. **Auto-Upload (O1):** GitHub-Action `dump-mirror` (Creds als Secrets) → bz2→gz → SFTP in geschütztes `dump/`.
   `.htaccess`-Deny für `dump/`.
4. **Entitäts-Parser anschließen (Reuse!):** Pro Entität (Wege → Regionen → Siedlungen → Bauwerke → Territorien)
   den Dump-Scan an die **bestehenden** Infobox-Parser + Staging-UPSERTs hängen. Kontinent-Filter `{{Aventurien}}`.
5. **Vergleichs-Test (§9):** CLI/Diagnostics-Tool mit Asserts A1–A6, Report-Ausgabe. **Grün machen.**
6. **Buttons umhängen:** die 5 Trigger (§1-Analyse) von `crawl_step` auf `read_step` (Dump-Reader); gleiches
   `<progress>`-Muster.
7. **Umbenennung (§8):** sichtbare „WikiSync"-Strings → „Read WikiDump" (DOM-ids/Tabellen unverändert).
8. **Rollout (§10):** phasenweise umschalten, je Entität reviewen; Online-Crawler bis zuletzt als Fallback.
9. **Cleanup:** Online-Crawl-Pfad deprecaten (nicht sofort löschen); Doku/Memory aktualisieren.

---

## Anhang: wichtigste Code-Anker (aus der Analyse)

- **HTTP-Fetch (ersetzen):** `api/_internal/wiki/sync.php` → `avesmapsWikiSyncApiRequest()`.
- **Wikitext-Infobox-Parser (behalten):** `api/_internal/wiki/sync-monitor-parsing.php`, `…/territories-parsing.php`.
- **HTML-Listen-Parse (entfällt):** `avesmapsWikiSyncParsePoliticalTerritoryRowsFromHtml()`, `…FetchParsedWikiHtml()`.
- **Endpoints:** `api/edit/wiki/{sync-monitor,sync,territories,regions,paths}.php`.
- **Staging-Tabellen:** `wiki_sync_pages`, `political_territory_wiki(_test)`, `wiki_region_staging`,
  `wiki_path_staging`, `wiki_crawl_queue`/`…_region_queue`/`…_path_queue`, `wiki_territory_model`,
  `wiki_redirect_alias`, `wiki_sync_runs`, `political_territory_identity_backup`.
- **Live-Tabellen:** `political_territory`, `political_territory_geometry`, `map_features`.
- **Editor/Apply (behalten):** `api/_internal/wiki/sync-monitor*.php`, `api/_internal/political/territories-*.php`,
  `js/territory/*`, `html/political-territory-editor.html`, `html/wiki-sync-monitor.html`.
- **Graph (nicht anfassen):** `api/_internal/routing/client-graph.php`, `…/network-data.php`, `…/map-data.php`.
