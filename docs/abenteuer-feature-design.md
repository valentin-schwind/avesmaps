# Abenteuer-Feature — Design / Spezifikation

> Status: **Entwurf** (Owner-freigegebene Richtungsentscheidungen eingearbeitet, 2026-07-11).
> Sprache: Prosa deutsch, technische Bezeichner (Tabellen/Spalten/Funktionen/`error.code`) englisch — gemäß AGENTS.md §8 + Owner-Regel „Planungs-/Design-Docs DE".
> Nächster Schritt nach Freigabe: detaillierter Implementierungsplan (writing-plans).

Zweck dieses Dokuments: die Feature-Entscheidung festhalten, bevor Code entsteht. Es ist die
Single Source of Truth für „was bauen wir und warum so". Der phasenweise Umsetzungsplan entsteht
separat.

---

## 1. Zweck & Umfang

**Abenteuer in einer Gegend.** „Gegend" = **Stadt/Siedlung, politisches Territorium oder Region**.
Wir pflegen eine Datenbank an DSA-Abenteuern (offiziell + inoffiziell, Solo + Gruppe, mit Typ,
Schwierigkeit, Genre, Jahr) und verknüpfen jedes Abenteuer mit den **Orten**, an denen es spielt.
Diese Verknüpfung wird mit den bestehenden Karten-Features im **Infopanel** querverwiesen: klickt man
eine Gegend an, sieht man die dort **beginnenden** Abenteuer; optional (Spoiler) die dort
**spielenden**; und pro Abenteuer eine **Questroute**.

**Scope-Grenzen (YAGNI):**
- **Keine** eigene Abenteuer-Kartenebene, **keine** neuen Karten-Pins für Abenteuer. Abenteuer
  erscheinen ausschließlich als **Infopanel-Abschnitte** an bestehenden Features + als Questroute.
- Rendering **nur** im Infopanel-Modus (`?infopanel=true`) — exakt wie der bestehende Platzhalter.
- Die Questroute nutzt den **bestehenden Routenplaner** bzw. eine ephemere gestrichelte Linie —
  keine neue Routing-Engine.
- Server macht **keine** Geometrie (STRATO-Regel): Aggregation läuft im Client (Weiche B1).

**Bereits vorhanden (wird ersetzt/gefüllt, nicht neu gebaut):** der Platzhalter in
`js/map-features/map-features-place-extras.js` rendert „Abenteuer in <Ort> (57)" schon; `getPlaceAdventures(location)`
bevorzugt `location.adventures`, sonst die Platzhalter-Konstanten. Echte Daten einspeisen ⇒ Platzhalter
verschwindet automatisch. Es existiert **kein** Abenteuer-Entity im Code — echtes Neubauland fürs Backend.

---

## 2. Architektur-Weichen (Owner-freigegeben)

| Weiche | Entscheidung | Begründung |
|---|---|---|
| **A — Katalogquelle** | **A1: bestehende Wiki-Publikations-Ingestion erweitern** | Abenteuer sind Wiki-„Publikationen" (gleiche Infobox). `wiki_publication_catalog` / `publication-sync.php` parst sie schon; wir fangen im selben Pass zusätzliche Felder ein. DRY, nutzt das erprobte override-sichere Reconcile-Muster. |
| **B — Aggregation** | **B1: Laufzeit-Lookup im Client** | Wiederverwendet den vorhandenen Ray-Cast (`territory_wiki_key` je Siedlung) + `parent_wiki_key`-Baum. Kein Server-Geometrie-/N+1-Risiko auf STRATO. |
| **C — Editor-Hosting** | **C1: Siedlungseditor-Muster (iframe-Overlay)** | Self-contained Seite + Overlay-Opener + `?v=Date.now()`; keine `ASSET_VERSION`-Disziplin nötig. Nächste an „einzeln bearbeiten + Sync". |

---

## 3. Domänenmodell: Abenteuer, Orte, Rollen

### 3.1 Abenteuer
Ein Abenteuer entspricht einer Wiki-Publikation mit einem **Abenteuer-Produkttyp**
(`Gruppenabenteuer`, `Soloabenteuer`, `Kurzabenteuer`, `Szenario`, `Anthologie`, `Kampagne`).
Aus der Wiki-Infobox stammen: Titel, Regelsystem (DSA1–5), Derisches Datum (BF-Label, z. B.
„Travia 1044 BF"), Genre, Komplexität (Spielleiter/Spieler) = Schwierigkeit, Autoren, „Erschienen bei"
(⇒ offiziell/inoffiziell), ISBN, **F-Shop-Produktcode** (z. B. `US25313`), Cover.

### 3.2 Orte + Rollen — die Kern-Semantik
Die Wiki-Infobox hat ein Feld **„Ort"** = eine **geordnete, flache Liste** von Schauplatz-Wikilinks,
**präzise + Gebiete gemischt**. Eine Start/Spielort-Unterscheidung kodiert das Wiki **nicht** — aber
die **Reihenfolge trägt sie**:

> **Der erste Ort der Liste ist der Startort („beginnt hier"); alle weiteren sind Spielorte („spielt hier").**
> Beispiele (Owner): `Salderkeim, Irberod, Bornwald, Firunen` → Start = **Salderkeim**;
> `Festum, Bornstraße, …` → Start = **Festum**; `Zorgan, Elburum, …` → Start = **Zorgan**.

> ⚠️ **Klarstellung (Owner, 2026-07-12): Die „Ort"-Liste ist KEINE Quest-/Routenreihenfolge.** Das
> Bornland-Beispiel `Salderkeim, Irberod, Bornwald, Firunen` bildet die Reihenfolge des Abenteuers
> **nicht** ab. Erhalten bleibt nur: **erster Ort = „beginnt hier"**; alle weiteren = „spielt hier" (eine
> **ungeordnete Menge**). „beginnt/spielt" ist **reine Anzeige** und hat **keinen Bezug zur Route**. Die
> eigentliche **Route ist editor-gepflegt** (§9), wird nicht aus der Liste abgeleitet.

Daraus zwei Attribute je Ort-Zuordnung:

- **`role`**: `start` (erster Ort, „beginnt hier", **spoilerfrei**) | `play` (weitere Orte, „spielt hier", **Spoiler**).
- **`target_kind`** (Präzision, aus der Auflösung, §5): `settlement` \| `territory` \| `region` \| `path` \| `unresolved`.
  - `settlement`/`path` = **präzise** (hat Koordinate/Graph-Knoten → routbar).
  - `territory`/`region` = **Gebiet** (nur Repräsentativpunkt → nicht routbar).

> ⚠️ **Invariante: Quell-Reihenfolge strikt bewahren.** Der Sync-Parser darf die „Ort"-Liste **nie**
> umsortieren/deduplizieren-mit-Reorder — sonst bricht die Start-Erkennung. (Genau dieser Fehler
> entstand beim explorativen WebFetch, der „Ort" nach breit→spezifisch umsortiert zurückgab.)

---

## 4. Spoiler-Modell & Sichtbarkeitsregeln

Drei Sichtbarkeitsstufen, konsistent über alle Flächen:

1. **„beginnt hier" (offen, kein Spoiler).** Eine Gegend listet ein Abenteuer, wenn dessen
   **Start-Ort** dort liegt — direkt oder per Ray-Cast im politischen Subtree. Das ist die
   Default-Ansicht beim Klick auf eine Gegend.
2. **„spielt hier" (Spoiler, verborgen).** Abenteuer, die in der Gegend nur **spielen** (Start
   woanders). **Erst nach explizitem Klick** sichtbar:
   - Im **Infopanel**: ein **Button „Spielt hier (Spoiler)"** unter dem „beginnt hier"-Streifen, der
     die Sicht **inline freigibt** (der Klick = Spoiler-Bestätigung; kein Auto-Reveal).
   - Im **„Alle anzeigen"-Dialog**: ein globaler **Umschalter „beginnt hier | spielt hier (Spoiler)"**.
3. **Questroute (editor-gepflegt, §9).** Die Route wird von Editoren definiert (nicht aus der „Ort"-Liste)
   und ist von „beginnt/spielt" **entkoppelt**. In **Phase 1 nicht enthalten** (kein Auto-Route, keine
   On-Map-Routendarstellung).

**Zähler:** Der Kopf „Abenteuer in <Gegend> (N)" zählt die **beginnenden** Abenteuer (Default-Sicht).
Die „spielt hier"-Menge hat einen eigenen Zähler am Spoiler-Button.

---

## 5. Namensauflösung (wiki-key-basiert) — das eigentliche Kernproblem

Jeder „Ort"-Eintrag ist ein **Wiki-Seitenname** (Wikilink). Auflösung läuft über **wiki-keys /
`wiki_url`**, nicht über Namens-Fuzzy-Match, und über **alle vier Entity-Typen**.

### 5.1 Werkzeugkasten (wiederverwenden, nicht neu bauen)
- **Client-Normalizer:** `normalizeWikiDeeplinkKey()` in `js/app/wiki-deeplink.js:79` — dekodiert
  Prozent-Escapes, `_`→Space, NFD-Diakritika-Strip, lowercase, `ß`→ss, verwirft Nicht-Alphanumerisches.
  `wikiUrlToDeeplinkKey()` (`:103`) zieht das `/wiki/<Page>`-Segment aus einer gespeicherten `wiki_url`.
  → **Beide sind der kanonische Vergleich** und werden für Editor-Autocomplete + Anzeige-Auflösung wiederverwendet.
- **Vorbild-Resolver:** `applyWikiDeeplinkFromUrl()` (`wiki-deeplink.js:293`) macht bereits
  „Seitenname → Objekt" mit **Typ-Präzedenz** (`WIKI_DEEPLINK_PARAM_ROUTING`, `:24`) und Fallback auf
  `api/app/map-search.php`. Genau dieses Muster (Präzedenz + Fallback) übernehmen wir für Ort-Auflösung.
- **Server-Kanonisierung (Sync):** `avesmapsWikiDumpCanonicalWikiKeyForTitle()`
  (`api/_internal/wiki/dump-reader.php:436`) + **`wiki_redirect_alias`** (Redirect → Canonical). Damit
  löst der Sync jeden Ort-Titel serverseitig kanonisch auf, bevor er ihn zuordnet.

### 5.2 Auflösung je Entity-Typ (wo der wiki-key liegt)
| Ort-Typ | Speicher der Wiki-Verknüpfung | Präzision |
|---|---|---|
| Siedlung | `map_features` (`feature_type='location'`), `wiki_url` (Vergleich per `normalizeWikiDeeplinkKey`) | präzise (hat Koordinate + Graph-Knoten) |
| Territorium | `political_territory.wiki_key` / `political_territory_wiki` | Gebiet |
| Region | Region-Feature/`wiki_url` (Spotlight-`regionEntry.wikiUrl`) | Gebiet |
| Weg/Straße/Fluss | `properties.wiki_path.wiki_url` (per Wiki-Namensgruppe) | präzise (Graph-Kante/Segmente) |

> Hinweis zu Slug-Divergenz: serverseitig existieren mehrere, **nicht** deckungsgleiche Normalizer
> (`avesmapsPoliticalSlug` ä→a/Bindestriche behalten vs. `avesmapsWikiSyncCreateMatchKey` ä→a/Separatoren
> strippen). Deshalb ist der **Vergleich gegen `wiki_url`** (nicht gegen einen Slug) die verlässliche
> Achse — so macht es der Deep-Link bereits.

### 5.3 Ergebnis der Auflösung
Pro Ort-Eintrag: `target_kind` + Ziel-Referenz (`target_public_id` bzw. `target_wiki_key`), oder
**`unresolved`** (Rohname bleibt erhalten, Editor löst später auf). **`role`** ist **positionsbasiert**
und **unabhängig** vom Auflösungserfolg (ein unaufgelöster erster Ort ist trotzdem der Start).

---

## 6. Aggregation entlang der politischen Hierarchie (B1)

Ziel: „Königreich Garetien" anklicken → Abenteuer der ganzen Gegend, **entdupliziert** über die Hierarchie.

> ⚠️ **KORREKTUR 2026-07-12 (umgesetzt in Phase 2.1, Commit `71e75e4e`): Die Annahme „Client hat den Baum" war
> falsch.** Das Frontend hat WEDER `territory_wiki_key` pro Siedlung im map-features-Payload NOCH den
> `parent_wiki_key`-Baum (der lädt nur im Edit-Mode; `territory-detail.php` liefert keinen Subtree).
> **Owner-Entscheid: Option A** — der Resolver hängt je Ort die Territoriums-Ahnenkette an
> (`adventure_place.target_territory_path`, JSON deepest→root, aus `properties.territory_wiki_key` +
> `wiki_territory_model`-`parent_wiki_key`-Walk, **NIE** affiliation_path); der Katalog liefert `territory_path`
> pro Ort; der Client-Index `byTerritoryPath` + `getAdventuresForTerritory(wikiKey,{role})` aggregiert den
> Subtree lokal. Live validiert (Gareth = 4 Ebenen). Der Baum wird also NICHT im Client geladen — die
> deepest-wins-/Zuordnungs-Semantik unten bleibt gültig, nur die Datenquelle ist jetzt der `territory_path`.

- **Datenbasis im Client (Datenquelle ÜBERHOLT, siehe Korrektur oben):** je Siedlung das tiefste Territorium
  + dessen `parent_wiki_key`-Kette — **kommt jetzt fertig als `territory_path` pro Ort** aus dem einmaligen
  `adventures.php`-Katalog-Fetch (§7), kein Baum-Fetch im Client.
- **Zuordnung eines Abenteuers zu einer Gegend:** über seine **Start-Orte** (Default) bzw. **Spiel-Orte**
  (Spoiler-Sicht):
  - Ort = Siedlung → deren `territory_wiki_key`-Kette liefert alle Vorfahren-Territorien.
  - Ort = Territorium/Region → direkt dessen Position im Baum.
- **Entduplizierung — „deepest wins":** ein Abenteuer sitzt im Dialog am **tiefsten** bekannten Ort
  seiner (Start-)Zuordnung innerhalb des angeklickten Subtrees; erscheint **genau einmal**. Gleiche
  Semantik wie `pickDeepestTerritory` (`map-features-settlement-territory-assign.js:87`, depth über
  `parent_wiki_key`, cycle-guarded via `depthOf` `:270`). Der Nested-Dialog rendert Rahmen je
  Subtree-Knoten mit „N direkt".
- **Infopanel-Kopf** zeigt Subtree-Summe (beginnen) + Vorschau (neueste zuerst); voller Bestand hinter
  „Alle anzeigen".

---

## 7. Read-API

**`GET /api/app/adventures.php`** (öffentlich, app-facing) — Envelope wie der Gold-Contract
(`{ ok: true, ... }` / `{ ok:false, error:{ code, message } }`).

- **Katalog-Modus (Default):** kompakter Gesamt-Katalog für den Client-Lookup (B1). Pro Abenteuer:
  `public_id, title, wiki_url, product_type, edition, bf_year, bf_label, genre, complexity_gm,
  complexity_pl, is_official, fshop_code, cover_url, series` + **Ort-Links** (`role`, `target_kind`,
  `target_public_id`/`target_wiki_key`, `raw_name`). Spoiler-Trennung passiert **im Client** (Start-Links
  offen; Play-Links gehören zur Spoiler-Sicht) — der Katalog liefert beide, das UI gated.
- **Laden nur bei `IS_INFOPANEL_MODE`:** ein einziger Fetch beim ersten Infopanel-Bedarf; Client baut
  Indizes (nach Siedlungs-/Territoriums-/Regions-wiki_key). **Nicht** in die heiße `map-features`-Payload
  einbetten (Perf: der Default-Kartenpfad bleibt schlank; Abenteuer rendern ohnehin nur im Infopanel).
- Größen-Abschätzung / ggf. Paginierung: bei Bedarf `?place=`-gefilterter Modus als Fallback. Primär
  aber ein Katalog-Fetch, weil Aggregation client-seitig sein soll.

---

## 8. Frontend-Anzeige

### 8.1 Infopanel-Abschnitt (Siedlung + Territorium + Region)
- **Siedlung:** bereits verdrahtet — `buildLocationMarkerPopupHtml` (`map-features-location-marker-entry.js:46`)
  hängt `buildPlaceAdventuresMarkup` an, sobald `location.adventures` gesetzt ist. Wir füllen es aus dem
  Katalog-Index statt aus Platzhaltern.
- **Territorium/Region:** analoger Block im Region-Glue. `avesmapsShowRegionInInfopanel`
  (`map-features-infopanel.js:447`) rendert nach dem `territory-detail.php`-Fetch neu → dort docken wir
  „Abenteuer in <Gebiet>" an (Naht: `createRegionWikiInfoBoxMarkup`, `map-features-region-info-markup.js`).
- **Aufbau** (siehe Layout-Entwurf): Kopf „Abenteuer in X (N)" + Sortierzeile (neueste/Art/alphabetisch,
  Client-Sort existiert schon) + einzeiliger Cover-Streifen der **beginnenden** Abenteuer +
  **Button „Spielt hier (Spoiler)"** (inline-Reveal) + „Alle anzeigen (N)".

### 8.2 „Alle anzeigen"-Dialog
- Modaler Overlay (CSS-Grundgerüst existiert: `.avesmaps-adv-dialog*` in `place-extras.css:184`).
- **Globaler Umschalter „beginnt hier | spielt hier (Spoiler)"** oben.
- **Verschachtelte Rahmen** nach politischer Hierarchie (deepest-wins, §6), Rang-Pill + „N direkt".

### 8.3 Design-Sprache (Pflicht)
- **De-Blue-Fix:** `place-extras.css` nutzt aktuell **Blau** `#3f6fa0` für Titel/Sortierlinks/Labels —
  verstößt gegen die Designsprache (kein Blau). Auf `--color-link` (goldbraun) migrieren. Keine
  hartkodierten Farben/Radien/Trenner — **nur Tokens** aus `css/base/tokens.css` (AGENTS.md §12).
- **Ausnahme Kacheln:** die verschachtelten Rahmen im Dialog sind eine **bewusste** Rahmen-statt-Trenner-
  Ausnahme (Hierarchie-Visualisierung), warm getönt (`--color-panel-soft`/`-muted` + Einrückung).
- Trenner im Panel randlos/durchgehend (Owner-Regel).

---

## 9. Questroute (editor-gepflegt, optional) — Plan-Änderung 2026-07-12

> **Verworfen:** die frühere „Hybrid"-Questroute, die die Reise **aus der Wiki-„Ort"-Liste** ableitete
> (Planer-Sprung mit den Orten als Wegpunkte bzw. ephemere gestrichelte Linie durch die Orte). Grund: die
> „Ort"-Liste bildet die **Routenreihenfolge nicht** ab (§3.2) — jede daraus abgeleitete Route wäre falsch.
> In Phase 1 gebaut und **wieder entfernt** (Commit-Historie).

**Neues Modell:**
- Die Questroute ist ein **optionales** Feature, das **explizit von den Editoren auf Siedlungsebene
  gepflegt** wird. Die Reise-/Ortsfolge wird **intern definiert** (Editor-Daten), **nicht** aus der
  „Ort"-Liste und **nicht** aus „beginnt/spielt" hergeleitet.
- **„beginnt hier" / „spielt hier" bleibt** (§3, §4), ist aber **entkoppelt von der Route** — reine
  Anzeige-Mengen an einer Gegend.
- **Keine automatischen On-Map-Darstellungen der Route** (kein Planer-Sprung, keine gestrichelte Linie)
  aus den Ort-Daten. Eine spätere Routen-Darstellung setzt auf **editor-definierten Routendaten** auf,
  nicht auf der Ort-Liste.

**Konsequenz für die Phasen:** die Route wandert in den **Editor (Phase 3+)**: dort definieren Editoren je
Abenteuer/Siedlung optional eine Ortsfolge; erst darauf kann (später) eine bewusste Darstellung aufsetzen.
Der Client-Katalog liefert weiterhin die Orte je Abenteuer (`getAdventurePlaces`) als Datengrundlage.

---

## 10. Editor (C1)

Overlay wie der Siedlungseditor (`openAvesmapsSettlementEditorOverlay`, `review-settlement-list.js:483`;
self-contained HTML unter `html/`, `?v=Date.now()`).

**Funktionen:**
- Abenteuer **suchen / anlegen / bearbeiten** (alle Felder aus §3.1 editierbar).
- **Orte zuordnen:** Autocomplete gegen Siedlungen + Territorien + Regionen + Wege (per
  `normalizeWikiDeeplinkKey`/`wiki_url`, §5); **Startort markieren** (Rolle setzen); Orte
  **hinzufügen/entfernen (suppress)**; Reihenfolge editierbar.
- Jede manuelle Aktion setzt **`origin='manual'`** auf Feld bzw. Ort-Link (§11.2) → sync-fest.

**Toolbar-Naht (Owner-Vorgabe):** Button **„Abenteuereditor" unter „Dump holen"** im zentralen Block
`.wiki-sync-dump-central` (`index.html:342–355`, **über** den vier Sync-Tabs), **daneben** „Abenteuer
gesynct: <Datum>" — analog zu `#settlement-editor-open`/`#settlement-editor-synced`.
Datum über neuen Sync-Kind-Zweig (§11.3).

---

## 11. Wiki-Sync (override-sicher)

### 11.1 Ingestion (A1)
Die bestehende Publikations-Ingestion (`publication-sync.php`, staging `wiki_publication_catalog` /
`wiki_entity_publication`) wird — sofern die Abenteuer-Infobox vom selben Parser erfasst wird (§14
Vorabcheck) — im selben Parse-Pass erweitert, um pro Publikation zusätzlich zu erfassen:
**Produkttyp, Ort-Liste (in Quell-Reihenfolge!), Komplexität, Genre, F-Shop-Code, Cover, Regelsystem,
Derisches Datum**. „Abenteuer" = Publikationen mit Abenteuer-Produkttyp. Schreibt **nur** in Staging
(WikiDump-Invariante: Sync fasst Live-Tabellen nie direkt an — außer dem override-sicheren Reconcile).

### 11.2 Override-Modell (pro Feld + pro Ort-Zuordnung)
Exakt das erprobte `feature_sources`-Muster (`avesmapsPublicationDiffLinks`, reiner Planer):
- **`origin`** je Datensatz/Link: `wiki` (vom Sync) vs. `manual` (Editor).
- **`status`**: `approved` vs. `suppressed` (= Grabstein; blockt Wiederhinzufügen).
- **Reconcile-Garantie:** schreibt/aktualisiert/löscht **nur** `origin='wiki' AND status='approved'`;
  `manual` + `suppressed` bleiben **unangetastet**; idempotent per `wiki_key`. → Dein Szenario „Kosch
  entfernen, Angbar setzen": Editor suppress't den Kosch-Link (`manual`/`suppressed`) und legt Angbar an
  (`manual`); ein Re-Sync fügt Kosch **nicht** wieder hinzu und lässt Angbar stehen.
- Auch **`role`** (Start/Play) ist geschützt: sobald der Editor die Rolle eines Links ändert, wird der
  Link `origin='manual'` (voll besessen) → Re-Sync fasst seine Rolle nicht mehr an.

### 11.3 Last-Sync-Datum
Neuer Sync-Kind `adventure`:
- Backend: `avesmapsWikiDumpSyncKindLastSynced` (`dump-sync-kind.php:150`) um einen `adventure`-Zweig
  (`MAX(synced_at)`/`completed_at`) ergänzen; Kind-Liste `AVESMAPS_WIKI_DUMP_SYNC_KINDS` (`:84`).
- Frontend: Eintrag in der Fill-Array-Stelle `review-wiki-sync.js:554`
  (z. B. `["adventure-editor-synced", synced && synced.adventure]`).

---

## 12. Cover + F-Shop

- **Cover anzeigen** (Ulisses-Erlaubnis liegt vor). Auslieferung über einen **`coat.php`-artigen
  Proxy-Cache** (kein Hotlink; hostseitig gecacht), analog zum Wappen-System.
- **Klick aufs Cover → Ulisses F-Shop-Produktseite**, gebaut aus dem `fshop_code` (z. B. `US25313` aus
  der Infobox) **+ dem F-Shop-UID-Parameter**. ⚠️ **Offen:** exaktes UID-/URL-Format holt der Owner in
  Phase 5 (siehe §14).
- Legal: DSA-Fanprojekt-Guidelines beachten (NOTICE.md); Cover nur im erlaubten Rahmen.

---

## 13. Phasen (grobe Reihenfolge; Detailplan separat)

1. **Fundament + Anzeige:** Schema (`adventure`, `adventure_place`), Read-API `adventures.php`
   (Katalog), Client-Index + Einspeisung in die **Siedlungs**-Listen (Platzhalter ersetzt), „beginnt/
   spielt"-Anzeige + Spoiler. Erste manuell/importierte Testdaten. (Die früher hier geplante Questroute
   ist **entfallen** → editor-gepflegt, §9.)
2. **Aggregation:** Territorien/Regionen-Block im Infopanel + **Nested-Dialog** mit Umschalter
   (deepest-wins).
3. **Editor (C1):** CRUD + Ort-Zuordnung + Start-Markierung + Suppress + Override-Tracking; Button
   „Abenteuereditor" unter „Dump holen".
4. **Wiki-Sync:** Publikations-Ingestion erweitern (Ort/Produkttyp/Komplexität/Genre/F-Shop),
   override-sicherer Reconcile, Last-Sync-Datum.
5. **Cover/F-Shop-Politur:** Proxy-Cache + F-Shop-UID-Links.

---

## 14. Offene Punkte

- **Infobox-Template-Abgleich (Phase-4-Vorabcheck):** verifizieren, dass die Abenteuer-Infobox
  wirklich vom bestehenden `publication-sync`-Parser erfasst wird (gleiches Template/Feldnamen, inkl.
  `Ort`/`Produkttyp`/`Komplexität`). Falls die Abenteuer eine abweichende Infobox nutzen, ist es eine
  Parser-**Erweiterung** statt reiner Feld-Ergänzung — betrifft Aufwand von A1, nicht die Architektur.
- **F-Shop-UID/URL-Format** (Phase 5) — exakter Parameter vom Owner.
- **Schwierigkeit/Genre-Vokabular:** Rohwerte aus dem Wiki speichern (`complexity_*`, `genre`) +
  optional normalisierte Facetten für Filter; kein starres Taxonomie-Schema vorab (YAGNI). Ob im „Alle
  anzeigen"-Dialog zusätzlich nach Solo/Gruppe, offiziell, Schwierigkeit, Genre gefiltert wird: in
  Phase 2 mit sichtbarem Entwurf entscheiden.
- **Katalog-Payload-Größe:** falls der Gesamt-Katalog zu groß wird, `?place=`-gefilterter Fallback-Modus
  (Messung in Phase 1).
- **Regionen (Landschaften) als Gegend:** Infopanel-Region-Glue behandelt politisches Territorium **und**
  Landschafts-Region — Block für beide vorsehen.

---

## 15. Wiederverwendung & konkrete Nahtstellen

| Bereich | Bestehendes, das wir nutzen/erweitern |
|---|---|
| Anzeige Siedlung | `map-features-place-extras.js` (`getPlaceAdventures*`), `map-features-location-marker-entry.js:46` |
| Anzeige Territorium/Region | `map-features-infopanel.js:447` (`avesmapsShowRegionInInfopanel`), `map-features-region-info-markup.js` |
| Dialog-CSS | `css/features/place-extras.css:184` (`.avesmaps-adv-dialog*`) |
| Namensauflösung | `wiki-deeplink.js` (`normalizeWikiDeeplinkKey`, `applyWikiDeeplinkFromUrl`, map-search-Fallback), `wiki_redirect_alias`, `avesmapsWikiDumpCanonicalWikiKeyForTitle` |
| Aggregation | `territory_wiki_key` (properties_json, Ray-Cast), `parent_wiki_key`-Baum, `pickDeepestTerritory`/`depthOf` |
| Questroute | **editor-gepflegt (§9)** — Route aus Editor-Daten (Phase 3+), NICHT aus der „Ort"-Liste; `getAdventurePlaces` liefert die Orte als Grundlage |
| Editor | `openAvesmapsSettlementEditorOverlay` (`review-settlement-list.js:483`), `html/wiki-sync-settlement-editor.html`-Muster |
| Sync + Override | `publication-sync.php` (`avesmapsPublicationDiffLinks`), `feature_sources.origin`/`status`-Muster |
| Button/Last-Sync | `.wiki-sync-dump-central` (`index.html:342`), `dump-sync-kind.php:84/150`, `review-wiki-sync.js:554` |

---

## 16. Invarianten & Fallen

- **Quell-Reihenfolge der „Ort"-Liste bewahren** — nur zur Start-Erkennung (erster = „beginnt hier"); die
  Liste ist **keine Routenreihenfolge** (§3.2, §9).
- **Kein Server-Geometrie** — Aggregation im Client (STRATO).
- **Nur `?infopanel=true`** rendert Abenteuer (wie der Platzhalter).
- **Keine automatische Route aus den Ort-Daten** — die Questroute ist editor-gepflegt (§9); keine
  On-Map-Routendarstellung aus der „Ort"-Liste. „beginnt/spielt" ohne Bezug zur Route. (Adresszeile
  weiterhin nie auto-umschreiben, URL-Policy.)
- **Kein Blau, nur Tokens** — inkl. De-Blue-Fix von `place-extras.css` (§8.3).
- **Editor-Assets:** C1 nutzt `?v=Date.now()` → **kein** `ASSET_VERSION`-Bump nötig (anders als der
  Territorien-Inline-Host).
- **Shared Working Tree** — nur eigene Dateien per Pfad stagen, nie `git add -A` (AGENTS.md §9).
- **STRATO** — schwere Endpoints nie loopen/proben.
