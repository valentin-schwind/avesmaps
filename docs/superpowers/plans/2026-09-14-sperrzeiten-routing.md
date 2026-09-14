# Sperrzeiten in der Routenwahl — Umsetzungsplan

> **Ausführung:** inline in der Sitzung vom 14.09.2026 (Owner-GO „go, C und Absage im Panel").
> Schritte mit `- [ ]`, TDD je Aufgabe.

**Ziel:** Die Route beachtet Zeitfenster (datumsabhängig) und meldet, wenn eine Sperre — Zeitfenster
oder Land-Reisemittel-Sperre — sie verändert hat: Hinweis oben + Vermerk am Abzweig (Variante C),
Absage mit Grund im Panel.

**Architektur:** Server: Zeitfenster reist an der Kante, der Dijkstra führt eine Kalenderuhr und
überspringt geschlossene Kanten; gesperrte Reisemittel-Kanten liegen in einer Nebenliste, die nur
ein Vergleichslauf liest; `closures.php` baut aus Vergleich und echter Route den Bericht.
Client: schickt `departure` samt aufgelaufener Stunden je Wegpunktpaar, sammelt die Berichte und
zeichnet sie in den Reiseplan.

**Entwurf:** `docs/superpowers/specs/2026-09-14-sperrzeiten-routing-design.md` · **Mockup:**
`docs/sperrzeiten-routing-mockup.html`

## Globale Vorgaben

- Stabiler Vertrag: ohne `departure` bleibt jede Antwort zeichengleich; `closures` fehlt, wenn nichts
  umgangen wurde.
- Deutsch in Kommentaren/Commits; keine hartkodierten Farben (Tokens); keine Schrift unter 11px.
- Einzeln live: erst Server (unsichtbar), dann Client (sichtbar, Owner schaut).
- Vor jedem Push: ganzes Testfeld nach den Workflow-Mustern, Dateizahl gegen den Workflow halten.

---

## Dateikarte

| Datei | Verantwortung |
|---|---|
| `api/_internal/routing/request.php` | `departure` normalisieren (`month`, `day`, `elapsed_hours`, `day_of_year`) |
| `api/_internal/routing/network-data.php` | Pfaddaten tragen `display_name` (Spalte `name`) |
| `api/_internal/routing/transport-season.php` | `avesmapsRouteSeasonWindowForTransport()` — das Fenster EINES Mittels an einer Kante |
| `api/_internal/routing/client-graph.php` | Kante trägt `season_window` + `sperr_weg`; Teilkanten erben beides; Nebenliste `gesperrt`; Dijkstra mit Uhr, Überspringen, `ignore_closures`, `extra_graph`; Legs mit Einzelergebnissen |
| `api/_internal/routing/closures.php` (neu) | Vergleichslauf, Abzweig, Gruppierung, Mehraufwand, Bericht je Etappe |
| `api/_internal/routing/response.php` | Bericht verdrahten, `departure`/`closures` ausgeben, Revision 16 |
| `api/README.md` | Abschnitt „Travel date and closures" |
| `js/routing/route-engine.js` | `departure` + `elapsed_hours` je Paar; Berichte sammeln; Absage im Panel |
| `js/routing/route-closures.js` (neu) | reine Satzbauer: Kopf, Vermerk, Absage |
| `js/routing/route-plan.js` | Kopf-Hinweis und Vermerk zeichnen, Link zoomt auf den Weg |
| `js/app/runtime-state.js`, `js/map-features/map-features.js` | `currentRouteClosures` deklarieren / zurücksetzen |
| `css/features/route-planner.css` | Regeln aus dem Mockup (mit Vertragsmarken) |
| `index.html`, `js/app/i18n-en.js` | Skript-Tag, Tooltip Reisebeginn, Kommentar, englische Sätze |

---

## Aufgabe 1: `departure` in der Anfrage

**Dateien:** `request.php`; Test `api/_internal/routing/__tests__/sperrzeiten-routing-test.php` (neu, Abschnitt A)

**Liefert:** `$request['departure'] = null | ['month' => string, 'day' => int, 'elapsed_hours' => float, 'day_of_year' => int]`

- [ ] Test A: fehlt → `null`; `{month: "Firun", day: 31}` → `firun`, 30, doy 210; `elapsed_hours` fehlt → 0.0;
  unbekannter Monat → `InvalidArgumentException`; `day: "x"` → Exception; `elapsed_hours: -1` → Exception;
  kein Objekt → Exception.
- [ ] rot fahren
- [ ] `avesmapsRouteNormalizeDeparture(mixed $value): ?array` in `request.php` (`require_once travel-calendar.php`),
  Deckel `elapsed_hours` ≤ 10 × 365 × 24.
- [ ] grün fahren

## Aufgabe 2: Die Kante trägt ihr Fenster, die Nebenliste die gesperrten Mittel

**Dateien:** `network-data.php`, `transport-season.php`, `client-graph.php`; Test Abschnitt B

**Liefert:**
- `connection['season_window'] = ['from_day_of_year','to_day_of_year','from_month','from_day','to_month','to_day']` — nur wenn der Weg für das Mittel der Kante ein Fenster trägt
- `connection['sperr_weg'] = ['key' => string, 'name' => string, 'subtype' => string]` — nur an Fenster- und Nebenlisten-Kanten
- `connection['sperre'] = ['kind' => 'transport', 'allowed' => list<string>]` — nur in der Nebenliste
- `$clientGraph['gesperrt']` — Adjazenz wie `graph`, nur Land-Reisemittel-Sperren

- [ ] Test B1: Pass mit Fenster → jede Kante (beide Richtungen, auch mit Gelände) trägt `season_window`; Straße ohne → kein Schlüssel.
- [ ] Test B2 (💣 Teilkante): `avesmapsSplitClientPathAtAnchor` auf die Passkante → beide Hälften tragen `season_window` und `sperr_weg`.
- [ ] Test B3: Gebirgspass nur zu Fuß, Anfrage Kutsche → Kante fehlt im `graph` (wie heute), steht in `gesperrt` mit `sperre.allowed = [groupFoot, lightWalker]`; Flussweg-Sperre → NICHT in `gesperrt`; Pfad + Kutsche (Vorgabe ohne Kutsche) → NICHT in `gesperrt`.
- [ ] rot fahren
- [ ] Umsetzen: `display_name` in `avesmapsBuildRoutePathData`; `avesmapsRouteSeasonWindowForTransport(array $path, string $transport): ?array`;
  in `avesmapsAddClientCompatiblePathSliceConnection` beide Schlüssel an `$connection` VOR den Varianten;
  `avesmapsBuildClientRouteSubPathConnection` kopiert beide; `avesmapsAddClientCompatiblePathConnection`
  nimmt `?array &$gesperrtGraph = null` und baut dort, wenn `avesmapsClientPathTransportLocked()` wahr ist.
- [ ] grün fahren, `transport-restriction-test.php` + `carriage-offroad-test.php` + `path-multisplit-test.php` nachfahren

## Aufgabe 3: Die Uhr im Dijkstra

**Dateien:** `client-graph.php`; Test Abschnitt C

**Liefert:**
- `avesmapsRouteTravelHoursFromCostUnits(float $costUnits): float` (von `avesmapsRouteDurationFromSegments` mitbenutzt)
- `avesmapsRouteConnectionCalendarHours(array $connection): float`
- `avesmapsFindClientCompatibleRoute($clientGraph, $start, $end, $request, array $options = [])`, Optionen
  `start_hours` (float), `ignore_closures` (bool), `extra_graph` (array); Rückgabe zusätzlich `end_hours`, `touched`
- `avesmapsFindClientCompatibleRouteLegs(...)` gibt zusätzlich `legs` (je Etappe: `from`,`to`,`found`,`result`,`start_hours`) und `failed_leg_index`

- [ ] Test C1: im Fenster → über den Pass, `touched === false`.
- [ ] Test C2: außerhalb → Umweg, `touched === true`.
- [ ] Test C3 (Uhr): Aufbruch im Fenster, Ankunft am Pass danach → gesperrt.
- [ ] Test C4: `ignore_closures` → über den Pass; `extra_graph` öffnet die Nebenliste.
- [ ] Test C5: ohne `departure` → Ergebnis identisch mit dem Lauf ohne jede Option.
- [ ] Test C6: via — Uhr läuft über die Station (`legs[1].start_hours > 0`).
- [ ] rot, umsetzen, grün; `via-etappen-test.php`, `etappenrichtung-test.php`, `detour-*`, `offroad-leg-test.php` nachfahren

## Aufgabe 4: Der Bericht

**Dateien:** `closures.php` (neu), `response.php`, `api/README.md`; Test Abschnitt D

**Liefert:** `avesmapsRouteClosureReports(array $clientGraph, array $legsResult, array $request): array{reports: list<array>, stats: array}`

Bericht je Etappe: `leg_index`, `blocked`, `diverges_at_node`, `diverges_at_edge_id`, `avoided[]`
(`kind`, `path_name`, `public_ids`, `subtype`, `transport`, `from_node`, bei season `reached_on`/`open_from`/`open_to`,
bei transport `allowed`), `actual`, `unrestricted` (je `distance_units`, `travel_hours`, `travel_days`).

- [ ] Test D1: Umweg wegen Fenster → ein Bericht, `kind season`, Abzweig an der richtigen Kante, `unrestricted.travel_days < actual.travel_days`.
- [ ] Test D2: nichts berührt → keine Berichte, `stats.compared === 0`.
- [ ] Test D3: Absage → `blocked true`, `actual` null.
- [ ] Test D4: Kutsche → `kind transport`, `allowed`.
- [ ] Test D5: zwei Abschnitte desselben Weges → EIN `avoided`-Eintrag mit zwei `public_ids`.
- [ ] Test D6: `avesmapsBuildMinimalRouteResponse` — ohne Bericht/Datum keine neuen Schlüssel; mit → `departure` + `closures`.
- [ ] Test D7 (Quelltext, kommentarfrei): `response.php` ruft `avesmapsRouteClosureReports` NACH der Sehnen-Verfeinerung, `$fahreRoute()` weiter genau dreimal.
- [ ] rot, umsetzen, grün; README-Abschnitt; `AVESMAPS_ROUTE_API_CODE_REVISION = 16`
- [ ] Mutationsproben (mind.: Teilkante ohne Kopie, Uhr auf 0, `touched` nie gesetzt, Wasser in die Nebenliste, Gruppierung je Kante)
- [ ] ganzes Testfeld, Commit, Push (Server), Live-Probe: Kutsche Yrramis → Greifenfurt → `closures[0].avoided[0].kind === "transport"`

## Aufgabe 5: Der Client fragt mit Datum und sammelt die Berichte

**Dateien:** `route-engine.js`, `runtime-state.js`, `map-features.js`; Test `js/routing/__tests__/sperrzeiten-anfrage.test.js`

- [ ] Test: Paar 1 schickt `departure {month, day, elapsed_hours: 0}`, Paar 2 `elapsed_hours = travel_days×24` von Paar 1;
  ohne Monat kein `departure`; Berichte landen mit `segmentOffset` in `currentRouteClosures`; Absage ohne `alert`,
  stattdessen `renderRouteClosureRefusal` im Panel.
- [ ] rot, umsetzen, grün

## Aufgabe 6: Der Reiseplan zeigt es

**Dateien:** `route-closures.js` (neu), `route-plan.js`, `route-planner.css`, Mockup, `index.html`, `i18n-en.js`;
Test `js/routing/__tests__/sperrzeiten-hinweis.test.js`

- [ ] Test: `showRoutePlan` mit Bericht → Kopf-Hinweis direkt nach `route-plan-summary__head`; Vermerk in genau der Etappe,
  deren `segmentIndexes` die Abzweigkante enthält, samt `route-plan-entry--umweg`; ohne Bericht nichts davon;
  Mehraufwand in Tagen (Schnellste) bzw. Meilen (Kürzeste); Satzformen aus `path-einschraenkung.js`.
- [ ] rot, umsetzen, grün
- [ ] Mockup: VORSCHLAG-Block wird Vertragsblock gegen `css/features/route-planner.css`; Wortlaut-Tafel auf „Gesperrt: …"
- [ ] Browser: Mockup-Treue + echter Ablauf (Kutsche Yrramis → Greifenfurt, Zu Fuß ab 3. Firun, 1. Praios)
- [ ] ganzes Testfeld, AGENTS.md §11, Commit, Push (Client), Owner schaut
