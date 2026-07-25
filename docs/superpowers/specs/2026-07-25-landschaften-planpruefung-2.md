# Landschaften — zweite Planprüfung (die Überarbeitung)

**Stand:** 2026-07-25 · **Status:** Prüfbericht. **Nichts gebaut, nichts geändert.**
**Prüfling:** `docs/superpowers/plans/2026-07-24-landschaften.md` (1145 Z.)
**Prüfstand:** HEAD `b9e4bf1c` — **nicht** `8b0224eb`, wie der Plan im Kopf behauptet (siehe D6).

Drei Rollen-Agenten mit Interesse statt Prüfauftrag: **die Datenbank** (wer das Schema
in drei Jahren pflegt), **der Editor** (wer die ~500 Flächen zeichnet), **der öffentliche
Betrieb** (wer avesmaps.de für die Besucher verantwortet — die Richtung, die bisher
niemand eingenommen hat). Dazu eine eigene Messung: ein einzelner `curl` auf
`GET /api/app/map-features.php`, im Scratchpad ausgewertet.

Jede Fundstelle unten habe ich **selbst nachgeschlagen**, auch die der Agenten. Was ich
nicht bestätigen konnte, steht in E.

---

## A. Blocker — vor dem ersten Handgriff

### A1 🔴 V-1 Schritt 1 ist nicht lauffähig. Drei unabhängige Fehler in fünf Zeilen.

Der Plan schreibt (`:165–167`):

```php
if ($diagnostic !== '') {
    avesmapsRequireUserWithCapability($pdo, 'edit');
}
```

| | Befund | Fundstelle |
|---|---|---|
| **Signatur** | `function avesmapsRequireUserWithCapability(string $capability): array` — **ein** Parameter. Der Aufruf mit zweien ist ein `TypeError`. | `api/_internal/auth.php:94` |
| **`$pdo`** | kommt in `api/route/index.php` **null mal** vor, `avesmapsCreatePdo` ebenfalls null mal (selbst gegrept: 0 Treffer). Die Verbindung entsteht erst *innerhalb* `avesmapsLoadRouteMapData`. Schritt 2 („die Prüfung **nach** `avesmapsCreatePdo()` setzen") schickt den Arbeiter zu einem Aufruf, den es in dieser Datei nicht gibt. | `api/route/index.php`, `api/_internal/routing/map-data.php:6` |
| **Einbindung** | Die Datei lädt bootstrap, request, map-data, network-data, graph, response — **nicht** `auth.php`. Die Funktion ist undefiniert. | `api/route/index.php:5–10` |

Die Folge ist nicht „schlägt fehl", sondern **schlimmer als das**: `catch (Throwable)`
bei `:341–342` fängt den `Error` ab, und alle sechs Zweige antworten **500 statt 401**.
Die Owner-Abnahme (Schritt 3 erwartet 401) fängt das — aber Schritt 2 ist als
„prüfen, ob `$pdo` existiert" formuliert und legt die falsche Fährte.

Die Reparatur ist klein: `require_once __DIR__ . '/../_internal/auth.php';` ergänzen,
Argument ersatzlos streichen.

### A2 🔴 V-1 kehrt eine festgeschriebene Owner-Entscheidung um, ohne sie zu nennen

`docs/refactoring-masterplan.md:73`, Abschnitt **„Owner decisions (locked in 2026-06-13)"**,
Punkt 4: *„**Diagnostics endpoints:** stay public."* Das Inventar bei `:79–84` listet
exakt die sechs Zweige. `CLAUDE.md` nennt den Masterplan als das Dokument, das trackt,
„which changes need owner sign-off".

Der **Vertrag** ist nicht betroffen — `api/README.md:95`: *„They are not part of the
stable external API contract."* Das deckt V-1 sauber ab. Aber der Plan verkauft V-1 als
Routing-Hygiene, und es ist die Umkehr einer eingefrorenen Entscheidung. Sie gehört als
solche deklariert und im Masterplan nachgezogen.

**Entwarnung, selbst geprüft:** Es gibt **keinen** internen Aufrufer. `grep` über `js/`,
`html/`, `tools/`, `index.html` nach `diagnostic=`: **0 Treffer**. V-1 bricht keine
Diagnoseseite. Ebenso: `sitemap.xml` enthält genau ein `<loc>`, `robots.txt` sperrt nur
`/admin/`. Kein Crawler-Risiko.

### A3 🔴 Ich kann mit V1–V4 keine benannte Fläche erzeugen — womöglich gar keine

`ecosystem_area` trägt **nur Geometrie**: `region_id INT UNSIGNED NOT NULL` (Plan `:681`).
Name, `kind`, `region_type`, `wiki_region_key`, `wiki_url` sitzen **alle** auf
`ecosystem_region` (`:660–664`). Die Aktionen sind getrennt: `create_region` **und**
`create_area` (`:786`).

Kein einziger Schritt in V3 ruft `create_region`, und keiner nennt eine `region_id`.
V3.2 sagt nur „Analog `startPathCreationAt`, aber ohne Graph-Knoten-Bindung und mit
Polygon-Abschluss" (`:943`). Damit gibt es zwei Möglichkeiten, und beide sind Blocker:

- `create_area` ohne `region_id` → **NOT NULL, der Save schlägt fehl** — bemerkt beim
  Abschluss der allerersten Fläche.
- oder V3.2 legt implizit je Fläche eine Region an → nach 300 Flächen liegen **300
  namenlose Regionszeilen** im Bestand, zusammenführbar nur durch V6, und V6 ist
  ausdrücklich nicht beauftragt (`:126`, `:1103`).

Die Selbstprüfung des Plans hält die Frage für erledigt (`:1134`): *„V3.2 („in welcher
Ebene landet die neue Fläche?") → `activeEcosystemLayerKind` ✅"*. Das beantwortet
**`kind`**, nicht **`region_id`** — und `kind` steht auf der Region, nicht auf der Fläche.

**Der fehlende Erzeuger ist nicht `promote_trial` und nicht der Revisionszähler. Es ist
`region_id`.** Die Erzeuger-Tabelle (`:1126–1134`) hat genau diese Zeile nicht.

### A4 🔴 Der Erprobungsdialog stellt eine Prüfung, die bei gesunder Software „nicht bestanden" meldet

V3.5 (`:1032`): *„Zeichne eine einzige Fläche. Verschiebe die Karte. **Lade neu.** Ist sie
noch da?"* — Nach dem Reload ist sie **nicht** da. Kette selbst nachgelesen:

1. `getInitialPlannerSearchParams()` stellt den gemerkten Editor-Zustand aus `localStorage`
   **nur** wieder her, wenn außer `edit`/`debugMap` **kein** Parameter in der URL steht
   — `hasPlannerStateSearchParams()`, `js/map-features/map-features-layer-state.js:177–186`.
2. Der Erprobungslink trägt `landschaften=1`; über die Shell zusätzlich `_v=<filemtime>`
   (`edit/index.php:57`). Beide fallen durchs Raster → **Restore übersprungen**.
3. Ohne `mapLayerMode` in der URL greift `layer-state.js:101`:
   `setSelectedMapLayerMode(searchParams.get("mapLayerMode") || "deregraphic")`
   (`js/config.js:483`). **Der Modus ist „Standard"**, nicht „Landschaften".
4. V3.0 Schritt 2 lädt aber nur, `„wenn getSelectedMapLayerMode() === "ecosystem"`"
   (`:881`). Kein Fetch, keine Fläche.

**Das Flag, das die Ebene einschaltet, ist genau das Flag, das den Zustands-Restore
abschaltet.** Der Editor, der die drei Schritte brav macht — und der Dialog ist
ausdrücklich so gebaut, dass sie gemacht werden (`:1025`) — schließt in der ersten
Minute: „die Fläche ist weg." Das ist der teuerste mögliche Fehlalarm.

*(Nebenbefund: über `/edit/` ist dieser Restore wegen `_v` **schon heute** tot, für alle
Editoren, unabhängig von den Landschaften.)*

### A5 🔴 V2.4 bewaffnet einen zweiten Schreibpfad in `map_revision` — gegen Globale Regel 3

Das ist mein eigener Befund, keiner der drei Rollen hat ihn.

Regel 3 (`:65–68`) verbietet, dass ein Flächen-Save `map_revision` anfasst. V2.4 ist als
Zweizeiler beschrieben („`'ecosystem'` in beide Arrays"). Was dahinter liegt:

```
api/_internal/app/feature-sources.php:428   avesmapsNextMapRevision($pdo);   // Quelle hinzufügen
api/_internal/app/feature-sources.php:468   avesmapsNextMapRevision($pdo);   // Quelle entfernen
api/_internal/app/feature-sources.php:512   avesmapsNextMapRevision($pdo);
```

Der Kommentar bei `:421–427` sagt es wörtlich: die Quellenliste *„rides in the
ETag-cached map-features payload"* — deshalb der Bump. Sobald `entity_type='ecosystem'`
freigeschaltet ist, invalidiert **jedes Anhängen einer Quelle an eine Landschaftsfläche
die 29,65-MB-Nutzlast für jeden Besucher.** Genau der Vorgang, den Regel 3 mit „~2.000
Speichervorgänge" begründet — nur durch eine Tür, die der Plan selbst aufmacht und nicht
bemerkt.

Zweite Hälfte desselben Befunds: **der öffentliche Payload liest `feature_sources` ohne
`entity_type`-Filter.**

```
api/app/map-features.php:754–761   SELECT … FROM feature_sources fs … WHERE fs.status='approved'
api/app/map-features.php:722–731   Katalog: alle sources mit irgendeinem approved-Ref
```

Live gemessen reiten dort heute **10.721 Ref-Schlüssel** und **1.526 Katalogeinträge**
mit, verteilt auf `settlement` 1853, `path` 1804, `territory` 878, `citymap` 631,
`region` 468, `lore` 5087. `ecosystem` würde der siebte — und der Totmannschalter in
`api/app/ecosystem-areas.php` deckt diesen Pfad **nicht**.

> Die Lücke ist nicht neu: `citymap` hat sie bereits (Katalog kill-switchbar, Quellen
> nicht). Neu ist, dass die Landschaften **unfertige Erprobungsdaten** sind — genau das,
> wovon V3.5 sagt, es „kann sich noch als falsch erweisen".

**Der billigste Ausweg ist, V2.4 hinter V4 zu schieben.** Vor V6 kann ohnehin niemand
eine Quelle anhängen; die Whitelist-Zeile kauft im ersten Vorhaben nichts und öffnet
zwei Türen.

### A6 🔴 Die fünfte Stelle des Totmannschalters, und die sechste

Regel 4 nennt vier. Es sind mindestens sechs.

**Fünfte — `api/app/feature-sources.php`.** Allowlist `:33`, **keine Auth** (Kommentar
`:5–7`), **kein Kill-Switch**; die einzigen Tore sind CORS `:17` und die Allowlist `:35`.
`feature_sources.status` steht per DDL auf `DEFAULT 'approved'`
(`api/_internal/app/feature-sources.php:28`). Also: `GET /api/app/feature-sources.php?entity_type=ecosystem&entity_public_id=<uuid>`
liefert an jeden anonymen Aufrufer — auch bei `ecosystem_enabled='0'`.

**Sechste — der Segmentschalter (V3.0).** Der Plan hängt ihn allein an
`mode === "ecosystem"`. Die von ihm selbst genannte Vorlage hat **zwei** Tore:

```
js/map-features/map-features-political-timeline.js
:9   const isPoliticalMode = getSelectedMapLayerMode() === "political";
:15  const interactive = isPoliticalTimelineEnabled();   // :3-5 = IS_EDIT_MODE || …
:19  const showTimeline = isPoliticalMode && (interactive || readOnly);
```

Der Plan übernimmt nur das erste. `IS_EDIT_MODE && IS_ECOSYSTEM_ENABLED` gehört dazu —
und das ist nicht Kosmetik, weil der Modus per URL erreichbar bleibt (A7).

### A7 🔴 `.prop("disabled", true).remove()` ist in sich widersprüchlich, und beide Hälften versagen verschieden

V1.1 Schritt 6 macht beides gleichzeitig. Das zitierte Vorbild macht **nur** `disabled`:
`js/map-features/map-features.js:31`. Entscheidend ist aber etwas anderes: **die
Whitelist bei `js/map-features/map-features-display-mode.js:155` prüft das Flag nicht.**
V1.1 Schritt 3 nimmt `"ecosystem"` bedingungslos auf. Ein fremder Link mit
`?mapLayerMode=ecosystem` läuft über `layer-state.js:101` durch.

| Variante | was der anonyme Besucher bekommt |
|---|---|
| nur `disabled` | jQuery setzt `option.selected` auch auf einer *disabled* Option. `getSelectedMapLayerMode()` liefert `"ecosystem"` → **er ist im Modus**, inklusive der in V1.1 Schritt 5 erweiterten `TERRITORY_BOUNDARY_MODES`, lädt also Territoriumsdaten. |
| mit `remove()` | `.val("ecosystem")` trifft keine Option → `selectedIndex = -1`. Die **Karte** fällt auf `deregraphic` zurück (`display-mode.js:128`), aber `syncTransportControl` (`js/ui/ui-controls.js:364–377`) findet keine Option: Beschriftung wird nie aktualisiert, keine Option bekommt `is-active`/`aria-selected` → **eine Combobox, die gar keine Auswahl anzeigt**. |

Kein stiller sauberer Rückfall — ein halb leerer Bedienknopf. Sauber ist **genau eine**
der beiden Varianten, konsequent durchgezogen und mit der Whitelist gekoppelt.

### A8 🔴 V0.2 Schritt 2 widerspricht dem eigenen Warnkasten drei Zeilen darüber

Plan Schritt 2: *„`break`, sobald `$currentNode === $endName` extrahiert wurde. Das ist
bei nicht-negativen Kanten **immer korrekt, unabhängig vom Transportmodell**."*

Wörtlich im Code (selbst gelesen, `api/_internal/routing/client-graph.php:743–760`):

```php
$currentDistance = $distances[$currentNode] ?? INF;          // :747  Label, NICHT die Priorität
…
if ($minimizeTransfers && $currentTransport !== null && $transport !== $currentTransport)
    $weight += AVESMAPS_ROUTE_CLIENT_TRANSFER_PENALTY;        // :753  Kosten hängen am EINGEHENDEN Mittel
$alternative = $currentDistance + $weight;
$queue->insert(['node' => $neighbor, 'transport' => $transport], -$alternative);   // :759
```

Der Abbruch am Ziel ist genau dann sicher, wenn die Prioritäten entlang der Extraktionen
monoton wachsen. Hier tun sie das nicht: Ein veralteter Heap-Eintrag für `u` (eingereiht
mit Priorität 10) wird beim Auspacken mit dem **inzwischen kleineren** `$distances[u] = 7`
gerechnet — und mit **seinem eigenen** `transport`. Die daraus entstehende Relaxation
`7 + w` kann unter der Priorität liegen, bei der das Ziel bereits extrahiert wurde.

Der Plan hat die beiden Hälften vertauscht: das **Unsichere** (Abbruch) steht unbedingt
in Schritt 2, das **Sichere** (Settled-Set nach `(node, transport)`) hängt in Schritt 3
an einer Bedingung. Und der Test aus Schritt 1 ist **eine** Route — der Fehlerfall
braucht eine, bei der eine teurere gleichtransportige Fortsetzung eine billigere
Umsteige-Kante schlägt, entdeckt *nach* der ersten Zielextraktion.

### A9 🔴 V0 kann Routen umschreiben, die Besucher längst geteilt haben

Ein `?s=`-Link speichert **kein Ergebnis, sondern ein Rezept**:

| Stufe | Fundstelle |
|---|---|
| Wegpunkte gehen als **Namen** in die Query | `js/map-features/map-features-layer-state.js:236` |
| `minimizeTransfers` reist mit | `:277–279` |
| Der Teilen-Knopf nimmt genau diese Query | `js/app/share-link.js:58–59` |
| Der Server legt sie ab | `api/app/share-link.php:128` → `map_share_links.target_query` |
| **Kein Verfall** | DDL `api/app/share-link.php:19–31`: kein `expires_at`, kein Cleanup im Repo |

Jeder `?s=`-Link wird bei jedem Öffnen **serverseitig neu gerechnet**
(`api/_internal/routing/response.php:167–170`). Jede Verhaltensdrift in V0.1 (Reihenfolge
bei zwei Orten im selben Toleranzfenster) oder V0.2 (A8) verschiebt still eine Route, die
jemand vor Wochen geteilt hat. Der Link löst weiter auf und zeichnet weiter eine Route —
eine andere.

V0.1 Schritt 9 fordert immerhin „Segmentliste identisch" für **eine** Route. V0.2 hat
kein Äquivalent. Und die Narbe steht im eigenen Haus: `docs/oekosystem-instruction.md:217`
— *„Neuberechnen andere Reisezeiten liefern und Routen lautlos verschieben."*

---

## B. Wo die drei sich widersprechen — beide Seiten, keine Mittelung

### B1 `is_trial`: **Blocker** (Datenbank) gegen **Notiz** (Editor)

Beide sehen dieselben zwei Fakten: `is_trial` steht auf `ecosystem_region` (Plan `:667`),
`ecosystem_area` hat die Spalte nicht (`:678–693`), und V3.5 Schritt 3 verlangt
„`is_trial`-Weitergabe an **jede** `create_*`-Aktion" (`:1038`) — `create_area` hat kein
Ziel dafür.

> **Datenbank:** Blocker, zweifach. (a) `DEFAULT 1` plus ein dauerhaft im Endpunkt
> stehendes `promote_trial(discard)` (`:786`, `:807`) ist eine Datenvernichtungsfalle
> *nach* V4: nach `keep` steht alles auf 0, die nächste Region bekommt wieder den
> DEFAULT 1, und ein zweiter `discard` — ein halbes Jahr später, aus einem Skript —
> löscht die Flächen jeder seither entstandenen Region weich. Ohne Audit-Log (B3) ist
> der Vorzustand nicht rekonstruierbar. (b) Beide Richtungen sind falsch: eine
> übernommene Region macht neue Flächen zu „alten"; eine misslungene Fläche hält 40 gute
> Flächen in der Erprobung.
>
> **Editor:** Notiz. Ob `discard` die richtigen Flächen erwischt, hängt **vollständig**
> an der ungelösten Frage aus A3 — welche Region gehört zu welcher Fläche. Solange die
> offen ist, ist `is_trial` ein Folgeproblem, kein eigenes.

**Die Entscheidung hängt an A3.** Wird A3 mit „eine Region je Fläche" gelöst, fällt die
halbe Datenbank-Sorge weg (Region ≙ Fläche). Wird A3 mit „eine Region, viele Flächen"
gelöst, ist die Datenbank-Sicht die richtige und `is_trial` gehört auf `ecosystem_area`
— oder ganz weg, ersetzt durch ein `app_setting['ecosystem_trial']`, das der Client beim
Anlegen liest. **Ich halte den zweiten Weg für richtig** (siehe F), aber es ist deine
Entscheidung, weil sie den ganzen Datenschnitt festlegt.

### B2 Regel 8 / i18n: **Defekt im Plan** (Editor) gegen **Defekt in der Regel** (Betrieb)

> **Editor:** V1.2, V3.0, V3.4, V3.5, V3.6 liefern neue sichtbare Strings **ohne**
> i18n-Schlüssel; nur V1.1 befolgt Regel 8 (`data-i18n="view.mode.ecosystem"`, `:504`).
> Der Plan lässt es schweigend aus, statt es zu entscheiden.
>
> **Betrieb:** Regel 8 ist hier **zu weit gefasst**. Die Nachbarschaft hält sie faktisch
> nicht ein — die Editor-Häkchen `index.html:1475–1481` und die Untermenü-Einträge
> `:249–256` tragen kein `data-i18n`, während die öffentlichen Menüpunkte `:259–265` es
> tragen. Editor-Oberflächen bleiben laut Masterplan M8 bewusst deutsch. Kein Einwand.

Beide haben recht über die Fakten und ziehen den entgegengesetzten Schluss. **Zu
entscheiden:** gilt Regel 8 für Edit-only-Oberflächen? Wenn nein, gehört der Satz im Plan
präzisiert („neue **öffentliche** UI-Strings"); wenn ja, fehlen in fünf Aufgaben Schlüssel
und in der Nachbarschaft auch. Ein Nebeneffekt spricht für „nein": `js/app/i18n-en.js`
hängt bedingungslos in `index.html:1646` — ein Schlüssel `view.mode.ecosystem` geht an
**jeden** Besucher, auch ohne Flag.

### B3 Wo man anfängt: drei verschiedene Antworten

Kein Widerspruch in den Fakten, aber drei unvereinbare Startpunkte:

| | „zuerst" | Begründung |
|---|---|---|
| **Datenbank** | das Schema (Audit-Log, `geometry_revision` als Wächter, `JSON` statt `LONGTEXT`) | „Was in V2.1 falsch angelegt ist, kostet in drei Jahren eine Datenmigration." |
| **Editor** | `region_id` (A3) | „Ohne das entsteht in V3 nichts Brauchbares, und V4 misst das Falsche." |
| **Betrieb** | V-1 (A1) | „Das Vorhaben beginnt mit einer Aufgabe, die nicht kompiliert." |

Meine Auflösung steht in F — sie folgt keiner der drei ganz.

### B4 Der bbox-Index: **ERNST** (Datenbank) gegen meiner Einschätzung nach **NOTIZ**

Die Datenbank rechnet sauber vor, dass `idx_ecosystem_area_bbox (min_x, min_y, max_x, max_y)`
den Überlappungstest nicht beschleunigen kann: die führende Spalte trägt die
Bereichsbedingung `min_x <= :bbox_max_x`, und die erste Bereichsbedingung beendet den
nutzbaren Präfix — `min_y`, `max_x`, `max_y` sind danach nur noch Filter. Bei
gleichverteilten Flächen liest der Index ~78 % der Tabelle, am rechten Kartenrand ~100 %.

Das stimmt, und der Index ist wörtlich das Hausmuster (`sql/schema.sql:88`, `:388`).
**Aber bei ~500 Zeilen ist die Frage bedeutungslos** — das räumt die Datenbank selbst ein.
Ich stufe es auf NOTIZ zurück. Nicht „reparieren", nur nicht als Optimierung verbuchen.

---

## C. Was der Plan übersieht

### C1 Es gibt kein Audit-Log — während **beide** geometrieführenden Nachbarn eins haben

| | Tabelle | Schreiber |
|---|---|---|
| Kartenobjekte | `map_audit_log` (`sql/schema.sql:106`, mit `before_json`/`after_json`/`undone_at`) | `api/_internal/map/features.php:2547` |
| Territoriumsgeometrie | `political_territory_geometry_audit_log` (`api/_internal/political/territory.php:91`) | `api/_internal/political/territories-audit.php:426–442` |

Die Editor-Oberfläche „Änderungen" mischt **genau diese zwei Quellen und keine dritte**
(`js/review/review-panels-change-log.js:42–45`). Eine Landschaftsfläche erscheint dort
nie. Für die Query um zwei Uhr nachts heißt das: `updated_by` kennt nur den Letzten, und
`delete_region` („weich, **mit seinen Flächen**", `:802`) sowie `promote_trial`
überschreiben ihn auf allen betroffenen Zeilen mit dem Bulk-Auslöser. Einen Vorher-Stand
einer Geometrie gibt es nicht.

Verschärfend: V3.3 gibt Strg+Z einen **flüchtigen** 20-Schritt-Stapel im Speicher
(`:964`). Dieselbe Taste macht bei jedem anderen Objekt ein **serverseitiges, dauerhaftes**
Undo (`review-panels-change-log.js:307`, `:321`). Das ist bewusst entschieden — aber es
ist der einzige Undo, den Landschaften je bekommen, und er überlebt kein F5.

### C2 `geometry_revision` ist ein Schreibrecht ohne Leser — dabei gäbe es zwei Vorbilder

Plan `:685` legt die Spalte an, `:801` zählt sie hoch. Danach kommt sie nicht mehr vor:
kein Schritt schickt sie zum Client, keiner vergleicht sie beim Schreiben.

Das Haus: `avesmapsAssertFeatureCanBeEdited` (`api/_internal/map/features.php:1007–1025`)
prüft (a) `expected_revision` gegen `map_features.revision`, sonst `AvesmapsConflictException`
(`:1008–1011`), **und** (b) einen Datensatz in `map_feature_locks` mit TTL (`:1013–1024`).

Zwei Editoren, dieselbe Fläche, Plan-Stand: **der zweite Save gewinnt vollständig, der
erste ist weg — ohne Meldung, ohne Konflikt und (C1) ohne Spur.** Das ist kein Randfall:
V3.0 zeigt alle drei Ebenen gleichzeitig, V3.6 erzeugt Kopien, und der Plan rechnet
selbst mit ~2.000 Speichervorgängen. Sperren sind für eine Erprobung mit zwei Editoren
verzichtbar; der optimistische Wächter nicht — ~6 Zeilen, derselbe Code wie `:1008–1011`.

### C3 `LONGTEXT` für Geometrie ist im Projekt beispiellos und nimmt genau das Diagnosewerkzeug weg

| Spalte | Typ | Fundstelle |
|---|---|---|
| `map_features.geometry_json` | `JSON` | `sql/schema.sql:71` |
| `political_territory_geometry.geometry_geojson` | `JSON` | `api/_internal/political/territory.php:65` |
| `political_territory_derived_geometry.geometry_geojson` | `JSON` | `sql/schema.sql:440` |
| `adventure_place.target_territory_path` | `JSON` | `api/_internal/app/adventures.php:88` |

Der Plan (`:666`, `:682`) erfindet `LONGTEXT` hier neu. Der Preis ist konkret: MySQL
validiert `JSON` beim Schreiben, `LONGTEXT` nimmt alles — einen abgeschnittenen Body, ein
halbes Polygon. Die Zeile existiert, die bbox-Spalten sind gefüllt, die Fläche ist weg,
und in SQL kann man **nicht einmal fragen, ob die Geometrie parst**. Mit `JSON` gäbe es
`JSON_VALID` und die Query „stimmt die gespeicherte bbox noch zur Geometrie?".

Und die bbox-Drift ist real: die bbox wird beim Schreiben mitgerechnet (`:800–801`).
Das Haus schreibt Geometrie und bbox in **einem** Statement (`features.php:2403`), der
Plan sagt dazu nichts. Gehen sie auseinander, verschwindet die Fläche aus dem
bbox-gefilterten Lesepfad, obwohl die Zeile intakt ist.

### C4 Die V2.2-Vorlage trägt das ETag-Muster nicht — und fährt DDL auf jedem anonymen Treffer

Zwei unabhängige Befunde an derselben Datei:

**(a) `api/app/citymaps.php` hat gar kein ETag** (selbst gegrept: 0 Treffer für
`ETag|304|If-None-Match`). Der einzige Endpunkt mit ETag/304 ist `api/app/map-features.php`
— und der ist sehr wohl bbox-fähig (`:132–142`) und faltet den **rohen bbox-String** mit
in den Seed:

```php
// api/app/map-features.php:225-228
$seed = (string)($queryParams['since_revision'] ?? '') . '|' . (string)($queryParams['bbox'] ?? '');
return 'W/"mf-' . AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION . '-' . $revision . '-' . substr(hash('sha1',$seed),0,10) . '"';
```

Das Muster, das V2.2 bauen will, existiert also fertig — nur in einer anderen Datei als
der genannten. Nebenbei beantwortet es die Frage „ETag global oder am bbox-Parameter?":
**beides**, Revision × bbox-String.

**(b) Der Kill-Switch-Check ist selbst eine DDL-Runde.** `avesmapsAppSettingGet`
(`api/_internal/app/app-setting.php:28–34`) ruft **als Erstes**
`avesmapsAppSettingEnsureTable` (`:17–26`, `CREATE TABLE IF NOT EXISTS`) — auf einem
öffentlichen Pfad, auch im ausgeschalteten Zustand. Genau das Muster, das AGENTS.md §10
als Hotspot führt und das M6 einmal entfernt hat (`refactoring-masterplan.md`, M6:
„DDL out of cache-hit path"). Dem Plan-Schnipsel fehlt außerdem `avesmapsCreatePdo` —
die Vorlage hat ihn bei `citymaps.php:38`, eine Zeile vor dem `if`.

**Was der globale Zähler als ETag-Basis kostet:** 304 tritt nur ein, wenn Revision **und**
bbox-String gleich sind. Der Loader aus V3.0 Schritt 3 feuert an `moveend`/`zoomend` —
nach jedem Schwenk ist der String ein anderer, also immer 200. Der ETag zahlt sich in
genau einem Fall aus: F5 auf demselben Ausschnitt. Und genau den bricht der globale
Zähler, weil er bei **jedem** Save irgendwo auf der Karte kippt: der Editor in Maraskan
verliert sein 304, weil jemand in Bornland eine Ecke gezogen hat.

### C5 V1.2 Schritt 3 übersteuert nicht den Modus, sondern **alles**

`shouldShowLabelMarker` ist **ein einziges `return`** aus vier UND-verknüpften
Bedingungen (selbst gelesen, `js/map-features/map-features-labels.js:493–505`):

```js
return getSelectedMapLayerMode() === "deregraphic"
    && bandZoom >= minZoom
    && bandZoom <= maxZoom
    && isLatLngInRenderBounds(entry.marker.getLatLng(), renderBounds);
```

Ein vorgezogenes `return box.checked` hebelt **alle vier** aus — das Zoomband *und* das
Viewport-Culling. Mit gesetztem Haken landen im Edit-Modus alle Label-Marker auf jeder
Zoomstufe auf der Karte, und `scheduleLabelCollisionResolution()` (`:524`) läuft über den
ganzen Satz. Richtige Form: `(getSelectedMapLayerMode() === "deregraphic" || editorOverride) && …`.

Spiegelbildlich Schritt 4: der Einschub **vor** `boundary-canvas-overlay.js:487`
übersteuert nur in Richtung **aus** — im Widerspruch zur eigenen Ansage „in **beide**
Richtungen".

Und: `shouldShowLabelMarker` steckt in einer Schleife **pro Label** (`syncLabelVisibility`
`:520–525`, `syncLabelIcons` `:527–537`, beide bei jedem Zoom/Move). Der Plan setzt dort
ein `document.getElementById` je Label je Sync hinein.

### C6 Der Rückweg aus der falschen Ebene fehlt, und V3.6 hat kein Menü

- **Verschieben zwischen Ebenen:** existiert nicht. V3.6 ist ausdrücklich Kopie (`:1050`).
- **Löschen:** existiert in V1–V4 **nur als API-Aktion** (`delete_area`, `:786`). Kein
  V3-Task baut eine Oberfläche dafür. Der Rückweg ist „Senden an …" + `curl`.
- **V3.6 setzt ein Flächen-Kontextmenü voraus, das niemand baut.** Es gibt drei Menüs:
  `#map-context-menu` (`index.html:247`, Untermenü `:249–256`), `#region-context-menu`
  (`:267–278`, hängt per `polygon.on("contextmenu")` an **politischen** Polygonen,
  `js/map-features/map-features.js:491–504`) — und keines für Landschaftsflächen. V3.4
  baut nur die drei „Neue …"-Einträge, also das **Karten**-Menü.
- Dazu ist `#region-context-menu` eine **flache** Liste; ein Untermenü kennt nur
  `#map-context-menu`. „Senden an …" → zwei Ziele ist ein **neues Bauteil**.

### C7 „Senden an …" ist der falsche Handgriff für die Zwillinge

Gerechnet mit der Struktur aus dem Plan (Sekunden geschätzt): Rechtsklick 2 s + Menü
treffen 3 s + Ziel wählen 2 s + Roundtrip 3–6 s + Editor springt in die Kopie 2 s +
zurückschalten 3 s = **15–18 s reiner Menü-Overhead je Fläche**, bevor eine Ecke
angepasst ist. Bei ~270–300 Zwillingen sind das **~80 Minuten reines Menü**.

Der Plan kennt das richtige Muster bereits: `promote_trial` (`:807`, `:1090`) — *„Ein
Aufruf, kein Aufräumen von Hand."* Die Zwillinge sind derselbe Fall: eine 1:1-Abbildung
über den Subtyp, ohne Einzelentscheidung. Ein `copy_regions(kind_from → kind_to)` kostet
serverseitig dasselbe und den Editor **einen** Handgriff. Der Einzel-Handgriff bleibt
richtig — für die Ausnahme, nicht für 300 Stück.

**Nebenwirkung auf V4:** Durchgang B übernimmt 10 Flächen per „Senden an …" und braucht
dafür 10 passende **Quellflächen**. Durchgang A zeichnet 10 Flächen unbestimmter Ebene.
Steht die Reihenfolge nicht fest, misst B entweder nichts oder etwas anderes.

### C8 V4 misst die günstigste Hälfte der Arbeit unter den günstigsten Bedingungen

- **Die ersten zehn sind systematisch die leichtesten.** `insel` 95 und `see` 46 sind
  klein und rundlich; `region` 134, `wald` 67, `gebirge` 61, `meer` 35 sind groß und
  zerklüftet. Schlimmer: V5 (`:1102`) will genau die leichte Klasse **komplett** aus der
  Handarbeit nehmen. Was für die Hand übrig bleibt, ist per Konstruktion der schwere Rest.
  **Die Messung gehört auf den Rest nach V5, nicht auf alle 500.**
- **Es wird nur Geometrie gemessen.** Benennen, Typ, Wiki-Zuweisung existieren nicht (A3)
  — V4 *kann* diesen Teil nicht messen, und er kommt später zu jeder der 500 dazu.
- **Ermüdung und Bestand fehlen.** Bei Fläche 10 liegt nichts unter dir; bei Fläche 300
  liegen 300 in überlappenden Ebenen (`:916`: „Schneckenkamm liegt in den Windhagbergen").
  Der Plan sagt das selbst — *„Drei Flächen fühlen sich mit jedem Werkzeug gut an. Zwanzig
  nicht."* (`:1079`) — und misst dann zehn.

Zur Kernfrage „1–2 min statt 3–5 min": **die Zeichenzeit ja, die Gesamtzeit nein.**
Nachgerechnet auf dem Arbeitspunkt des Plans (40 Ecken): Sechseck-Route = 6 Startecken +
9 Strg+Klicks à 4 Ecken (`map-features-region-edit-edge-controls.js:209`, Aufrufe `:67`/`:171`)
+ 42 Züge = 51 Aktionen in 180–300 s ⇒ 3,5–5,9 s je Aktion — plausibel. Klick-für-Klick:
42 Klicks à 1,5–2,5 s ⇒ **63–105 s**. Die Behauptung stimmt **für die Geometrie**.
Nicht drin (geschätzt): nächste Fläche finden 20–40 s, benennen + Typ + Wiki 45–60 s,
Save abwarten 3–6 s, Reload-Steuer 3–8 s ⇒ **+1,2–1,9 min je Fläche**. Realistisch also
500 × ~3 min ≈ **25 h** statt 17. Die Entscheidungsschwelle des Plans („bei 2 min wird es
fertig") wird an einer Zahl gemessen, die die Hälfte der Arbeit auslässt — und zwar die
Hälfte, die es noch gar nicht gibt.

### C9 Der Umschalter steht außerhalb des Blickfelds und wird still geschaltet

`#political-timeline` ist `position: fixed; top: 10px; left: 50%`
(`css/features/political-timeline.css:6–20`) — **oben mittig**. Gezeichnet wird unten
links bei Zoom 4. Und der Editor kommt nie dorthin: V3.4 (`:1012`) lässt jeden der drei
Kontextmenü-Einträge „die Ebene mitschalten", also Rechtsklick unten → Untermenü →
„Neue Topographie". Der Blick bleibt unten, der Umschalter oben ändert sich lautlos.

**Reicht „blass"?** Nein — und am wenigsten dort, wo man am ehesten falsch liegt: bei der
**ersten** Fläche in einer leeren Gegend. „Blass" ist ein *Vergleich*; ohne zweite Fläche
im Bild gibt es nichts zu vergleichen. Bleibt der Farbton: drei Farben × zwei
Deckkraftstufen = sechs Zustände, kein Text.

### C10 Kleinere, aber echte Lücken

- **Doppelklick ist zweimal belegt.** V3.2 (`:939`) schließt die Fläche per Doppelklick
  ab; der Vertex-Editor löscht damit eine Ecke **und speichert**
  (`js/map-features/map-features-region-edit-handles.js:62–66`, `:84–97`). Öffnet der
  Abschluss die Bearbeitung (die Vorlage tut das: `map-features-region-crud.js:199`), kann
  der zweite Klick den frischen Griff treffen.
- **Der Loader entdoppelt nicht.** V3.0 räumt nur beim **Verlassen des Modus** auf
  (`:892`). Das Vorbild räumt bei **jedem** `moveend` auf
  (`map-features-region-rendering.js:150–163`) — genau das verbietet V1.3 Falle 1 zu
  übernehmen, **ohne einen Ersatz zu nennen**. Ohne Schlüsselung nach `public_id` liegt
  nach dem dritten Schwenk jede Fläche dreimal in `ecosystemLayers`.
- **Die versprochene Vorschaulinie gibt es in der Vorlage nicht.**
  `js/map-features/map-features-path-creation.js:58–104` hat **keinen** `mousemove`-Handler;
  `updatePendingPathCreationLine()` (`:36–56`) zeichnet nur durch die **gesetzten** Punkte.
  Das Gummiband ist Neubau — und es ist der Teil, der das Zeichnen erträglich macht.
  Dazu kodiert die Vorlage ihre Farbe zweimal hart als `#1452F7` (`:28`, `:48`) — Blau,
  das AGENTS.md §12 ausschließt.
- **Für die „ruhige Statuszeile" existiert schon ein Bauteil:** `#open-path-ends-chip`
  (`index.html:604`), `role="status" aria-live="polite"`, edit-only, **unten mittig**
  (`bottom: 132px`), vollständig token-basiert (`css/features/location-popups-markers.css:768–785`:
  `--color-warning-soft`, `--radius-md`, `--font-size-small`, `--z-dialog`). Der Plan
  erfindet daneben ein zweites.
- **Die genannte Vorlage verletzt §12 selbst.** `css/features/political-timeline.css:15–20`
  schreibt `#b79d7d`, `rgba(250,243,236,0.96)`, `#3f3428`, `border-radius: 8px` und
  `z-index: 1000` statt `var(--z-map-ui)` (das Token existiert, `css/base/tokens.css:249`).
  Wer „dieselbe Stelle" kopiert, kopiert das mit. Für den Segmentschalter nennt der Plan
  **kein** Token, kein Rollenmodell (Radiogroup vs. Tablist) und keine Tastaturregel,
  obwohl zwei `role="tablist"`-Vorlagen im Haus liegen (`index.html:935`, `:1267`) und
  `css/base/tokens.css:194–197` `--color-focus`/`--focus-ring` bereithält.
- **Nichts zeigt, was schon fertig ist.** Kein Zähler, keine Liste, kein „braucht keine
  Fläche" — obwohl die Analyse es ausdrücklich als durable Entscheidung verlangt (§8.11).
  V6 hätte die Liste und ist nicht beauftragt.
- **`wiki_region_key` ohne genannte Ableitung.** Keine Aufgabe schreibt oder liest sie.
  Die Ableitung ist im Projekt **kein freier Entwurf**: `avesmapsPoliticalSlug`
  (`api/_internal/political/territory.php:1060`) über `avesmapsFoldToAscii`
  (`api/_internal/text/ascii-fold.php:87`), seit dem 24.07. mit zwei Schutztests.
  Funktion beim Namen nennen — oder die Spalte streichen, bis sie einen Schreiber hat.
- **Vier Spalten ohne Schreiber:** `origin`, `wiki_region_key`, `wiki_url`,
  `properties_json` (`:663–666`) füllt keine V2.3-Aktion und liest kein Schritt. Die
  Erzeuger-Prüfung des Plans (`:1124–1134`) fragt nur nach *Verbrauchern ohne Erzeuger*,
  nie umgekehrt.
- **`ecosystem_region_type`: `is_active` plus „idempotenter Seed" ist ein stiller
  Widerspruch.** Läuft der Seed als `INSERT … ON DUPLICATE KEY UPDATE` (das häufigste
  Muster im Repo, u. a. `app-setting.php:41–42`), macht er jede Deaktivierung rückgängig.
  Richtig ist `INSERT IGNORE` (`api/_internal/app/citymaps.php:1652`).
- **Ein Editor kann den Erprobungsmodus dauerhaft öffentlich verlinken.**
  `js/app/share-link.js:71` löscht `["s","edit","debugMap","serverrouting","clientrouting","lang","place",…]`
  — **`mapLayerMode` steht nicht drin**, und `buildPlannerSearchParams` schreibt es
  bewusst mit (`layer-state.js:253–254`). Ein `?s=`-Link mit `mapLayerMode=ecosystem`,
  ohne Verfall (A9), führt zusammen mit A7 in den kaputten Combobox-Zustand.
- **`html/editor-handbuch.html` ist öffentlich** (kein `.htaccess` in `html/`), und die
  Nachtroutine schreibt bei editor-sichtbaren Änderungen hinein (AGENTS.md §9). V1.1 und
  V1.2 sind genau das. Der Plan erwähnt das Handbuch mit keinem Wort — die Erprobung
  landet also in einer öffentlich abrufbaren Seite, es sei denn, der Commit-Text sagt der
  Routine, dass der Modus flaggengesteuert und nicht zu dokumentieren ist.
- **`ecosystem_region` legt eine zweite Identität für Landschaften an.** Die 540 Labels
  existieren bereits als `map_features`-Zeilen mit Name, Position und Wiki-Bezug
  (Allowlist `api/_internal/map/features.php:767`). `ecosystem_region` speichert dieselbe
  Identität ein zweites Mal (`name`, `wiki_region_key`, `wiki_url`) und hat **keine**
  Spalte, die auf die Label-Zeile zeigt. Die einzige Brücke ist Namensgleichheit — und die
  ist in diesem Projekt keine Identität. Zwei Zeilen nach dem Muster
  `citymap_place.target_public_id`/`target_wiki_key` (`api/_internal/app/citymaps.php:192–193`)
  würden es abfangen; V5 und V8 brauchen sie.

### C11 Was **nicht** kaputt ist (geprüft, damit es niemand „repariert")

- **Keine übersehene `?v=`-Pflicht.** Der Deploy stempelt alles von `index.html`
  Erreichbare (`.github/workflows/deploy-avesmaps-strato.yml:195–219`). Die beiden
  Handausnahmen greifen nicht: `edit/index.php` betrifft nur `css/pages/edit.css`,
  `ASSET_VERSION` nur die Inline-Host-Assets. Regel 9 reicht so.
- **Der Zurück-Knopf ist kein Weg hinein.** Kein einziger `popstate`-Listener in `js/`,
  und `syncPlannerStateToUrl` steigt bei `!IS_EDIT_MODE` sofort aus
  (`layer-state.js:326–328`) — die Adresszeile eines Besuchers wird nie umgeschrieben.
- **Suche/Spotlight und Infopanel sind unbeteiligt**, weil Landschaftsflächen in eigenen
  Tabellen liegen; `api/app/map-search.php` kann sie nicht sehen.
- **Die zwei Häkchen erfinden nichts.** `index.html:1475–1477` ist wörtlich
  `<label id="togglePathsControl" hidden><input type="checkbox" id="togglePaths" /> Wege</label>`
  — dasselbe Muster, implizite Beschriftung, tastaturerreichbar, kein `aria-*` nötig.
- **V0.3 stimmt inhaltlich**, und die Behauptung zu `:76` vs. `:92` ist exakt: `:76` ist
  `!== 'label'`, `:92` ist `!== 'powerline'`. **Aber** `avesmapsLoadRouteMapData` bedient
  auch `api/locations/index.php:26` — den *zweiten* stabilen Vertragsendpunkt. Der gehört
  in die Abnahme.
- **`avesmapsNextEcosystemRevision`** (`:716–725`) ist eine getreue Kopie von
  `avesmapsNextMapRevision` (`api/_internal/map/features.php:2531–2545`), inklusive des
  `VALUES (1, 2)`-Tricks. Ebenso stimmt der Hinweis, `app-setting.php` explizit zu requiren.
- **Kein FK ist Hausmuster**, nicht Nachlässigkeit: `sql/schema.sql:31` — *„No foreign-key
  constraints anywhere."* Der einzige Repo-Treffer für `FOREIGN KEY` steht **auskommentiert**
  (`js/territory/territory-editor-embedded.js:71–77`).
  *Aber:* dieselbe Form hat im politischen Layer Waisen erzeugt, bis jemand
  `avesmapsPoliticalPurgeUnassignedGeometries` nachbauen musste
  (`api/_internal/political/territories-geometry.php:1028–1046`). Und die harten
  Löschungen im Haus räumen Kinder **zuerst und in einer Transaktion**
  (`api/_internal/app/adventures.php:1284–1293`). Der Plan hat dazu einen halben Satz.
- **„Aktive Fläche unter gelöschter Region" wird nirgends entschieden** — und der Lesepfad
  *braucht* den JOIN, weil `kind` nur auf der Region steht. Das Haus hat die Antwort
  zweimal: `INNER JOIN … AND territory.is_active = 1`
  (`api/_internal/political/territories-derived-geometry-plan.php:238–241`,
  `territories-claims.php:199`). Fehlt der Satz, schreibt der Bauer wahrscheinlich nur
  `WHERE area.is_active = 1` — und eine gelöschte Region kommt als Flächen zurück.
- **Alle neuen Namen sind frei** — siehe D5.

---

## D. Frisch gemessene Zahlen

Ein einziger `curl` auf `https://avesmaps.de/api/app/map-features.php`, 2026-07-25,
`Accept-Encoding: identity`, Antwort im Scratchpad ausgewertet. HTTP 200, 3,47 s.

### D1 Payload und Bestand

| | Plan (`:99–111`) | **heute gemessen** | Δ |
|---|---:|---:|---:|
| Payload roh | 29.646.676 B | **29.651.233 B** | **+4.557** |
| `revision` (Top-Level) | — | **35.074** | — |
| Features gesamt | 10.746 | **10.745** | −1 |
| ⤷ `location` / `crossing` / `junction` | — | 2.608 / 798 / 1.125 | — |
| ⤷ `path` | — | **5.512** | — |
| ⤷ `label` | 538 | **540** | +2 |
| ⤷ `powerline` | 162 | **162** | ±0 |
| Orte im Routing-Sinn | 4.531 | **4.531** | ±0 |
| routingfähige Wege | 5.515 | **5.512** | −3 |
| `source_catalog` | — | **1.526** | — |
| `feature_sources` (Ref-Schlüssel) | — | **10.721** | — |

`feature_sources` nach Präfix: `lore` 5.087 · `settlement` 1.853 · `path` 1.804 ·
`territory` 878 · `citymap` 631 · `region` 468 · `powerline` 0. → siehe A5.

### D2 Landschafts-Labels nach Subtyp

| Ebene | Plan | **heute** | Δ |
|---|---:|---:|---:|
| **Derographisch** (`region` 134, `insel` 95, `sonstiges` 3, `kontinent` 2) | 234 | **234** | ±0 |
| **Topographie** (`gebirge` 61, `see` 46, `meer` 35, **`berggipfel` 34**, `huegelland` 3, `kueste` 2) | 180 | **181** | **+1** |
| **Vegetation** (`wald` 67, `suempfe_moore` 28, `steppe` 10, `auenlandschaft` 8, `wueste` 4, `graslandschaft` 2) | 119 | **119** | ±0 |
| *(Linie)* `fluss` | 5 | **5** | ±0 |
| **`ebene`** | **0** | **1** | **+1** |
| **Gesamt** | 538 | **540** | +2 |

### D3 🪤 `ebene` hat kein Nulllabel mehr — die Prämisse für seinen Ausschluss ist weg

Der Plan begründet den Ausschluss von `ebene` aus dem Seed-Vokabular ausdrücklich
(`:742–744`) und stützt sich dabei auf „`tundra`, `ebene` | 0 | **0** — bestätigt"
(`:106`). Heute trägt **ein** Label den Subtyp: **„Zwergenpforte"**
(`735a89f2-dedb-43d0-a17a-697757d9e000`), mit Wiki-Link. `tundra` bleibt bei 0.

Folge: nach V2.1 gibt es für dieses Label keinen Typ, dem es zugeordnet werden kann.
Klein, aber es ist genau die Sorte Zahl, die der Plan als „bestätigt" führt.
`ecosystem_region_type` = **16 Zeilen** stimmt dagegen (4 + 5 + 7, nachgezählt) —
`berggipfel` und `fluss` fehlen ebenfalls, vermutlich absichtlich (Punkte bzw. Linien),
aber unkommentiert.

### D4 Die abgeleiteten Zahlen des Plans wurden nicht mitgezogen

| Plan-Aussage | Herkunft | mit den heutigen Zahlen |
|---|---|---|
| „**282** Zwillinge" (`:1046`, `:1076`) | 166 + 116 aus der **alten** Tabelle | 181 + 119 = **300**; ohne die 34 `berggipfel` (Punkte) **266** |
| „V5 nimmt **147 Flächen** ab" (`:1102`) | alte Zahlen ohne `wueste` | die aufgezählte Liste ergibt 95+46+2+2+4 = **149** |
| „**500** Flächen" | — | 234+181+119 = 534 − 34 `berggipfel` = **500** ✅ |

Die Grundzahlen wurden ersetzt, die daraus abgeleiteten nicht. Beide falschen Zahlen
tragen Argumente: die 282 begründen V3.6, die 147 begründen V5.

### D5 Namensfreiheit — für die **neuen** Namen erstmals geprüft

Der Prüfbericht bestätigte `landschaftenLayers`, `IS_LANDSCHAFTEN_ENABLED`,
`syncLandschaftenVisibility`, `landschaftenPane`. Der Plan hat danach **alles auf
`ecosystem*` umbenannt** — und niemand hat die Prüfung wiederholt. Ich habe sie geführt:

```
grep -rn "ecosystemLayers|syncEcosystemVisibility|ecosystemPane|IS_ECOSYSTEM_ENABLED|activeEcosystemLayerKind"  js/ index.html   → 0
grep -rn "ecosystem_region|ecosystem_area|ecosystem_revision|avesmapsNextEcosystemRevision|ecosystem_enabled"   api/ tools/ sql/ → 0
grep -rli "ecosystem"  js/ api/ css/ html/ index.html                                                            → 0 Dateien
```

**Regel 6 hält** — aber weil ich es geprüft habe, nicht weil die Beweislage im Plan es
deckt. Die Klammer bei `:636–637` („*Vor dem Umbau geprüft: alle Namen 0 Treffer*")
belegt die alten Namen.

### D6 Der Prüfstand des Plans ist 15 Commits alt — folgenlos, mit einer Ausnahme

Der Plan-Kopf sagt „überarbeitet nach der Planprüfung gegen HEAD `8b0224eb`". HEAD ist
**`b9e4bf1c`**. Dazwischen 15 Commits (wiki-key-Transliteration, Territorien-Zoomband,
Favicon). **Keine** Kernzieldatei ist betroffen: `client-graph.php`, `route/index.php`,
`map-features-*.js`, `feature-sources.php`, `map-data.php`, `network-data.php` —
unverändert. Alle Zeilennummern des Plans außerhalb von `index.html` gelten weiter.

Die Ausnahme ist `index.html`: **+6 Zeilen** im `<head>` (Favicon-Deklaration, `b9e4bf1c`)
**plus** die fremde unkommittierte Arbeit. Die Entscheidung des Plans, dort mit **Ankern
statt Zeilennummern** zu arbeiten (Regel 5), ist damit erneut bestätigt — und beide Anker
existieren: `togglePathsControl` `index.html:1475`, `political-timeline` `:609`.

---

## E. Was ich an den Agentenbefunden für falsch oder überzogen halte

1. **„282 → 299" (Editor).** Die Rechnung auf den Plan-Zahlen ist richtig, aber 299
   enthält die `berggipfel`, die Punkte und keine Flächen sind. Heute sind es **266**
   (D4). Der Editor hat das selbst angemerkt; ich schreibe es nur fest, damit nicht die
   nächste falsche Zahl in den Plan wandert. **Die eigentliche Lehre ist, dass die Zahl
   instabil ist und keine Aufgabe tragen sollte** — sie begründet V3.6 zweimal.

2. **`promote_trial(discard)` als BLOCKER (Datenbank).** Der Mechanismus stimmt, aber
   nichts zwingt dazu, die Aktion nach V4 im Endpunkt zu lassen. Ich stufe es auf ERNST.
   Der vorgeschlagene Ein-Zeichen-Fix (`DEFAULT 0` statt `1`, Erprobung über ein
   `app_setting`) ist trotzdem richtig und kostet nichts.

3. **Der bbox-Index als ERNST (Datenbank).** Bei 500 Zeilen bedeutungslos — siehe B4.
   NOTIZ.

4. **„Die Karte springt auf die Übersicht" als zweiter Grund für A4 (Editor).**
   `js/app/bootstrap.js:13` (`setView([478,539], 2)`, unbedingt) stimmt — aber das ist
   Bestandsverhalten, mit dem jeder Editor seit je lebt. **A4 trägt allein über den
   Modus-Rückfall**; der Kartensprung ist Beiwerk. Ich habe A4 entsprechend gekürzt.

5. **Die `IS_EDIT_MODE`-Asymmetrie (Betrieb).** Der Betrieb hält den `typeof`-Guard für
   überflüssig und die nackte Referenz für sicher — das stimmt (Ladereihenfolge
   `js/config.js` `index.html:1644` vor beiden Verbrauchern). Aber sein Ersatzvorschlag,
   die Haken-Referenz „einmal cachen", ist selbst eine Falle: das Element hängt in einem
   `hidden`-Container, der beim Moduswechsel umgeschaltet wird. Eine gecachte Referenz auf
   ein ersetztes Element zeigt ins Leere. Richtig ist, den **Wert** bei jedem Sync-Lauf
   einmal zu lesen, nicht das Element einmalig zu greifen.

6. **Was keiner der drei geprüft hat und ich auch nicht konnte:** ob `?diagnostic=`
   heute tatsächlich 200 liefert. Kein Code sperrt es (verifiziert), gerufen habe ich es
   nicht — auftragsgemäß.

---

## F. Urteil

**Nein, der Plan ist so noch nicht baubar — aber er ist deutlich näher dran als die
Vorfassung, und die Lücken sind alle klein.**

Die Überarbeitung hat die sechs Baustellen des ersten Prüfberichts sauber geschlossen:
V0.1 ist jetzt korrekt (`route_x`/`route_y`, drei Aufrufstellen, die Reihenfolgen-Falle
#5 ist sogar *neu* gefunden und richtig gelöst), die acht Modus-Stellen stehen da, die
drei fehlenden Erzeuger sind nachgetragen, V3.0 ist zurück, „Senden an …" ist vorgezogen,
Strg+Z ist als belegt erkannt. Was jetzt übrig ist, sind **vier Klassen von Fehlern**:

1. **Nicht kompilierender Code** (A1) — 20 Minuten.
2. **Vier Löcher im Totmannschalter** (A5, A6, A7) — die ernsteste Klasse, weil sie den
   einen Satz kippt, auf dem das ganze Vorhaben ruht: „Nichts davon kommt beim Besucher
   an." Zwei davon sind durch **Weglassen** zu schließen (V2.4 hinter V4 schieben), einer
   durch ein zweites Tor, einer durch eine Entscheidung zwischen `disabled` und `remove`.
3. **Eine Lücke im Datenfluss** (A3) — `region_id`. Ohne sie erzeugt V3 nichts Benanntes,
   und V4 misst das Falsche.
4. **Ein selbstwidersprüchlicher Abnahmeschritt** (A4) — der Erprobungsdialog verlangt
   einen Test, den das eigene Flag zum Scheitern bringt.

Dazu ein Messfehler, der mir wichtiger ist als er aussieht: **V4s Payload-Probe ist als
Kriterium unbrauchbar.** Der Plan sagt „`curl | wc -c` vor/nach, Basis 29.646.676 B;
ändert sich die Zahl, ist Regel 3 verletzt". Gemessen sind es heute 29.651.233 B —
**+4.557 B an einem einzigen Tag gewöhnlicher Editorarbeit, ohne jede Landschaft.** Die
Byte-Zahl driftet dauernd; die Probe schlägt immer an. Der richtige Wächter steht
daneben und ist exakt der, aus dem der ETag gesät wird: das Feld **`revision`** im
Payload-Kopf (heute 35.074). Bleibt es über einen Flächen-Save konstant, hält Regel 3.

### Womit ich anfangen würde

Nicht mit V-1, nicht mit dem Schema und nicht mit `region_id` — **mit einer Stunde am
Plan selbst**, ohne eine Zeile Code:

| # | | Aufwand |
|---|---|---|
| 1 | **A3 entscheiden:** eine Region je Fläche oder eine Region mit vielen Flächen? Das ist die Wurzel — es legt `is_trial` fest (B1), die Benennungs-Oberfläche, den Lesepfad-JOIN und ob V6 vorgezogen werden muss. **Ich empfehle „eine Region je Fläche"** für das erste Vorhaben: dann ist `create_area` ein Aufruf, `is_trial` sitzt richtig, `promote_trial` ist eindeutig, und V6 fasst später zusammen statt aufzuteilen. | 20 min |
| 2 | **V2.4 aus dem ersten Vorhaben streichen.** Vor V6 kann niemand eine Quelle anhängen; die Whitelist-Zeile kauft nichts und öffnet A5 **und** A6. | 2 min |
| 3 | **A7 entscheiden** (`disabled` **oder** `remove`, plus Whitelist ans Flag koppeln) und **A6** ergänzen (`IS_EDIT_MODE && IS_ECOSYSTEM_ENABLED` am Segmentschalter). | 15 min |
| 4 | **A4 auflösen:** entweder den Modus in `localStorage` unabhängig vom Restore-Filter merken, oder — billiger — den Dialogtext auf einen Test ändern, der wirklich hält („Verschiebe die Karte, schalte den Modus hin und zurück"). | 10 min |
| 5 | **A8 umdrehen:** Settled-Set nach `(node, transport)` in Schritt 2, Abbruch am Ziel in Schritt 3 mit der Bedingung `!minimizeTransfers`. Und den Netzlauf aus A9 als Abnahme beider V0-Aufgaben festschreiben — 5–10 echte Routen, Byte-Vergleich, wie §8.9 es für die Routing-Stufe ohnehin verlangt. | 15 min |
| 6 | **V4s Payload-Probe auf `revision` umstellen** und die drei abgeleiteten Zahlen korrigieren (D4). | 10 min |

**Danach ist V-1 der richtige erste Handgriff** — klein, abgeschlossen, unabhängig
freigebbar. Nur mit `require_once auth.php`, ohne `$pdo`, und mit dem Satz im Masterplan,
dass Owner-Entscheidung 4 aufgehoben ist.

Das Schema (C1–C3) würde ich **nicht** vorziehen. Audit-Log, `expected_revision` und
`JSON` statt `LONGTEXT` sind alle richtig — aber `JSON` ist ein Ein-Wort-Fix in V2.1, und
Audit-Log plus optimistischer Wächter sind zusammen ~80 Zeilen, die man sinnvoll baut,
wenn der Datenschnitt aus Schritt 1 feststeht. Sie gehören in V2.1 nachgetragen, nicht
davor.

---

## Was diese Prüfung nicht beantwortet

- **Nichts wurde ausgeführt.** Keine lokale Datenbank (`api/config.local.php` fehlt),
  kein Browser, kein Preview-Server (parallele Sitzungen). Jede Aussage über
  Laufzeitverhalten ist aus dem Quelltext abgeleitet. Bei C10 (Doppelklick, Loader-Dopplung)
  ist das der Unterschied zwischen „ist so gebaut" und „passiert".
- **Die Diagnose-Endpunkte wurden nicht gerufen** (auftragsgemäß). Ob sie heute 200
  liefern, ist unbestätigt — nur, dass kein Code sie sperrt.
- **Die Messwerte des Plans** (983 ms, 62 MB resident, 152 MB Peak, 11,3 s) sind nicht
  nachgemessen. Verifiziert ist nur die *Struktur*.
- **Die Zellindex-Rechnung aus V0.1** habe ich nicht neu geführt — der erste Prüfbericht
  §4.5 hat sie sauber, und die Codegrundlage (Toleranz `client-graph.php:5`, das
  Tschebyschow-Kästchen `:620–633`, genau drei Aufrufstellen `:103`/`:104`/`:400`) ist
  einzeln bestätigt.
- **jQuery-Feinverhalten** (A7: `.val(x)` ohne passende Option → `selectedIndex = -1`;
  `disabled` Optionen bleiben programmatisch selektierbar) ist dokumentiertes
  Standardverhalten, hier aber nicht im Browser reproduziert. Die Schlussfolgerung hängt
  nicht daran — sie steht in `display-mode.js:155`.
- **Sekundenwerte in C7 und C8** sind geschätzt und als solche gekennzeichnet. Die
  Struktur dahinter (9 Strg+Klicks, 42 Züge, 1 gegen 51 Saves) ist am Code verifiziert.

---

## G. Owner-Entscheidungen (2026-07-25) und was daraus folgt

### G1 Datenschnitt: **eine Region, mehrere Flächen** — und eine Fläche darf selbst MultiPolygon sein

Entschieden gegen meine Empfehlung. Beides muss gehen: der Farindel als *ein*
MultiPolygon **und** drei separate `ecosystem_area`-Zeilen unter derselben Region.

Was das am Plan ändert:

| # | Folge | Aufwand |
|---|---|---|
| 1 | **`is_trial` gehört auf `ecosystem_area`**, nicht auf die Region (Plan `:667`). `promote_trial discard` muss Flächen löschen, nicht Regionen — sonst reißt es die guten Flächen einer teilweise erprobten Region mit. Empfehlung zusätzlich: `DEFAULT 0`, gesetzt vom Client, solange `app_setting['ecosystem_trial']` an ist. | 1 Spalte |
| 2 | 🔴 **V3 braucht eine Regionsauswahl, bevor Zeichnen nützlich ist.** Der Zeichenvorgang muss wissen, in welche Region die neue Fläche geht: „aktive Region" + „neue Region anlegen (Name, Typ)". Das ist ein Stück V6, das in das erste Vorhaben **vorgezogen werden muss** — mit A3 als „eine Region je Fläche" wäre es entfallen. **~150–250 Z. zusätzlich.** | eigene Aufgabe V3.0b |
| 3 | **Lesepfad muss joinen:** `INNER JOIN ecosystem_region r ON r.id = a.region_id AND r.is_active = 1` — Hausmuster `territories-derived-geometry-plan.php:238–241`. Damit ist C-„aktive Fläche unter gelöschter Region" beantwortet: sie ist unsichtbar. | 1 Zeile |
| 4 | **`delete_region` muss seine Flächen in **einer Transaktion** mitnehmen** (Plan `:802` sagt es, ohne Transaktion). Muster `adventures.php:1284–1293`. | 5 Z. |
| 5 | **V3.6 „Senden an …" wird mehrdeutig:** in *welche* Region der Zielebene? Braucht „neue Region" oder „an bestehende anhängen" — sonst entstehen dort doch wieder namenlose Einzelregionen. | Entscheidung offen |
| 6 | **`geometry_geojson` muss Polygon *und* MultiPolygon annehmen**, und die bbox über **alle** Teile rechnen. V3.1 fordert Ringfähigkeit bereits (`:900–920`) — jetzt ist sie nicht mehr Vorsorge, sondern Tag-1-Anforderung. | — |
| 7 | **C3 (`JSON` statt `LONGTEXT`) gewinnt an Wert:** nur damit ist „wie viele Teile hat diese Fläche?" eine SQL-Frage (`JSON_LENGTH`). | 1 Wort |

### G2 Diagnose-Endpunkte: Owner-Entscheidung 4 wird aufgehoben

Die Entscheidung stand seit 2026-06-13 in `docs/refactoring-masterplan.md:73`. Ihr
vollständiger Wortlaut ist eine Zeile: *„Diagnostics endpoints: stay public. A full
inventory is maintained. M1 still closes the exception-payload leaks (content, not
access)."* **Eine Begründung ist nirgends festgehalten** — die Trennung war „Inhalt
reparieren, Zugang lassen". Zu diesem Zeitpunkt hatte niemand die 62 MB je Aufruf
gemessen; die Messung stammt aus der Machbarkeitsanalyse vom 2026-07-24.

⚠️ **Die Entscheidung deckt mehr ab, als V-1 anfasst.** Das Inventar bei `:79–92`
listet außerdem:

- `GET /api/app/political-derived-geometry-debug.php` (leakt Exception-Payload)
- `api/app/political-territories.php?action=` → `debug`, `audit`,
  `geometry_assignment`, `debug_boundary_contract`, `change_log`,
  `geometry_inventory`, `geometry_collision`
- `?debug_errors=1` auf `territories-endpoint.php` und
  `political-territory-display-sync.php`
- `html/political-boundary-diagnostics.html` (öffentlich, kein `.htaccess` in `html/`)

V-1 schließt **nur** die sechs `api/route/?diagnostic=`-Zweige. Der politische Rest
bleibt offen und ist der teurere Teil (`territories-endpoint.php` ist laut AGENTS.md §10
ohnehin ein Perf-Hotspot). Das gehört als eigene Aufgabe benannt, nicht stillschweigend
mitgemeint.

### G3 Sichtbarkeit der Erprobung: `?landschaften=1` wie geplant

Keine JS-Injektion. Der Name im Quelltext ist in Ordnung. Damit fällt Betrieb-N5
ersatzlos weg.

### G4 🪤 Der F5-Zustand: eine Hälfte ist eine datierte Regression, die andere gab es nie

Die Erinnerung stimmt zur Hälfte, und die Diagnose des Owners („der Inline-Käfig im
Edit-Modus hat sich geändert") trifft genau:

**(a) Ebenen-/Filterauswahl — funktionierte, seit 2026-07-10 tot.**
Der Speicher (`avesmaps.edit.plannerState`) und der Restore
(`hasPlannerStateSearchParams`) existieren seit **2026-05-06 / 05-10**
(`b35bf926`, `fefcc1b0`, `4bf10e27`). Der Restore greift nur, wenn außer
`edit`/`debugMap` **kein** Parameter in der URL steht
(`js/map-features/map-features-layer-state.js:177–186`).

Am **2026-07-10** hängte `694f9929` — *„fix(edit): cache-bust the editor map iframe so
deploys land without a hard reload"* — bedingungslos `&_v=filemtime(index.html)` an die
iframe-URL (`edit/index.php:53–58`). Seither sieht `hasPlannerStateSearchParams()` **immer**
einen Fremdparameter, und der Restore wird **bei jedem Laden über `/edit/` übersprungen**
— für jeden Editor, seit 15 Tagen.

> Der Cache-Bust selbst ist richtig und muss bleiben. Der Fehler ist, dass der
> Restore-Filter „Parameter vorhanden" mit „der Nutzer hat einen Zustand in der URL
> mitgebracht" gleichsetzt. `_v` (und `landschaften`) sind Infrastruktur, kein Zustand.
> Die Reparatur ist, `ignoredParams` von `{edit, debugMap}` auf `{edit, debugMap, _v, …}`
> zu erweitern — **eine Zeile**, und sie repariert einen Bestandsfehler, der mit den
> Landschaften nichts zu tun hat.

**(b) Zoom und Bildausschnitt — gab es nie.** *(Nachgeprüft mit `-S flyTo` auf
Owner-Hinweis; das Ergebnis wurde dadurch belastbarer, nicht anders.)*

Gesucht über die **volle Historie** (4.072 Commits, bis `0c5a0f1b`, 2025-06-12; keine
Lücke, die „Restore"-Commits von 2026-05-25 liegen innerhalb):
`flyTo` · `getCenter()` · `getZoom()` · `viewState` · `mapView` · `lastView` ·
`savedView` · `restoreView` · `mapCenter` · `storedCenter` · `zoom=` · `lat=` · `lng=` ·
`center=` · `#map=` · `L.Hash` · `onhashchange` — dazu das 2026-05-17 entfernte
`map/`-Verzeichnis (enthielt nur Daten und Python, keine App).

`flyTo` hat **25** Commits. Jeder einzelne ist **Navigation**, keiner ein Start-Restore:
Spotlight-Fokus (`99211bd7`), Review-Liste (`975e143f`), Konflikte-„Anzeigen"
(`7cd60e1e`), Infopanel-Reiter (`3e7fa57d`), Kraftlinienliste (`7da453d5`),
Routen-Fit (`25284f81`). In `js/app/` und `index.html` gibt es `flyTo` nur zweimal —
beide Male der Report-Review-Sprung (`bb92fbdc`), später nach `js/review/` verschoben.

Der Start-`setView` war **von der allerersten Zeile an fest verdrahtet**:

| Commit | Datum | Aufruf |
|---|---|---|
| `0c5a0f1b` | 2025-06-12 | `.setView([533.015307, 552.375], 3)` |
| `98675bf0` | 2026-04-23 | `.setView([533.015307, 552.375], 3)` |
| `4bf10e27` | 2026-05-10 | `.setView([IMG_HEIGHT / 2, IMG_WIDTH / 2], 0)` |
| `98461d29` | — | `.setView([478.0, 539.0], 2)` — heute, `js/app/bootstrap.js:13` |

Nie eine gespeicherte, nie eine aus der URL abgeleitete Position.

> **Woher die Erinnerung vermutlich stammt: am 2026-07-10 landeten zwei unabhängige
> Dinge am selben Tag.** `d1e7c79c` — *„find-nearest popup and waypoint breadcrumb
> recenter with **setView instead of flyTo**"* — ersetzte auf mehreren Wegen das Fliegen
> durch harte Sprünge (im Code als **„Owner-Regel"** vermerkt,
> `js/map-features/map-features-location-lookup.js:291`,
> `js/map-features/map-features-infopanel.js:358`). Und `694f9929` tötete am selben Tag
> den Zustands-Restore (a). Seither fliegt der Editor an mehreren Stellen nicht mehr
> **und** verliert seine Filter bei F5 — zwei Ursachen, ein Datum, ein Eindruck.

Das ist deshalb ein **neues** Vorhaben, kein Rückbau: Kartenmitte + Zoom bei `moveend`
/`zoomend` gedrosselt in denselben `localStorage`-Satz schreiben, beim Start
wiederherstellen, wenn kein Share-Pin/Deep-Link/Route etwas anderes verlangt. Die
Vorrangfrage ist der eigentliche Inhalt der Aufgabe (`?s=`, `?siedlung=`, `?route=`,
Spotlight-Fokus müssen gewinnen) — geschätzt **60–100 Z.**, eigene Abnahme.

**Zusammen ergibt (a)+(b) genau das, wonach gefragt war** („F5 drücken, Ansicht und
Bildausschnitt bleiben") — und (a) allein löst zusätzlich A4: der Erprobungs-Reload-Test
hält dann von selbst.

---

**Arbeitsbaum:** unverändert bis auf **diese Datei**. Kein Commit, keine geänderte
Bestandsdatei, `docs/superpowers/plans/2026-07-24-landschaften.md` nicht angefasst.
