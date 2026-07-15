# Unverbundene Orte & Kreuzungen im Edit-Mode markieren

**Datum:** 2026-07-15
**Discord-Fall:** #25 („Nur Backend: Orte/Kreuzungen ohne Wegeanbindung filtern", Thomas)
**Status:** Entwurf — im Chat freigegeben, bereit für den Implementierungsplan

## Ziel

Ein Edit-Mode-Häkchen **„Unverbunden"**, das alle aktuell sichtbaren Orte und
Kreuzungen **ohne Anbindung an das Wege-/Seeweg- ODER Kraftliniennetz** deutlich
rot umrandet. Reines Editor-Hilfsmittel zum Auffinden von Anbindungslücken (der
Owner korrigiert die Daten dann im Editor). Keine Datenänderung, keine Route.

## Nicht-Ziele (YAGNI)

- **Keine** Insel-/Komponenten-Erkennung — bewusst nur „0 echte Kanten".
- **Kein** Server-Endpoint — rein clientseitig (der Client-Graph reicht für einen
  optischen Hinweis).
- **Keine** Liste / kein Panel — nur die Markierung.
- **Kein** neuer Distanz-Schwellwert, keine Messung (siehe „Schwellwert").
- Nodices bleiben außen vor (nur Orte + Kreuzungen, wie gemeldet).

## Verbindungs-Definition

Ein Knoten (Ort **oder** Kreuzung) ist **unverbunden**, wenn **beides** zutrifft:

1. **keine echte Weg-/Seeweg-Kante** — im Routing-Graphen (nur reale Pfad-Kanten,
   **ohne** die synthetischen Querfeldein-Verbindungen) hat der Knoten 0 Nachbarn, **und**
2. **keine Kraftlinien-Anbindung** — der Ort ist nicht `from_public_id`/
   `to_public_id` einer Kraftlinie.

### Schwellwert (reuse, keine Messung)

Die „am Weg"-Grenze ist die **bestehende Konstante `THRESHOLD = 0.5`**
(`js/config.js:2`). Weg-Kanten entstehen in `addRegularPathToGraph`
(`js/routing/route-graph-routing.js:111-113`) über `getLocationAtPathEndpoint(...)`,
das intern `THRESHOLD` nutzt: liegt ein Pfad-Endpunkt näher als 0.5 an einem Ort,
bindet er an — sonst nicht (→ Querfeldein). Genau das ist die „kein Querfeldein"-
Grenze. **Es wird kein neuer Wert eingeführt und nichts gemessen.**

## Datengrundlage (alles clientseitig vorhanden)

- **Knoten:** `locationData` (Orte + Kreuzungen; Kreuzung via `isCrossingLocation`).
- **Wege:** `pathData` + `createGraph` / `addRegularPathToGraph`
  (`js/routing/route-graph-routing.js`).
- **Kraftlinien:** Powerline-Features mit `properties.from_public_id` /
  `to_public_id` (`js/map-features/map-features-powerlines.js:1-8`).

## Algorithmus

1. **Konnektivitäts-Graph bauen** (einmalig, gecacht) — wie `createGraph`, aber:
   - mit **allen Land- + See-Transporten aktiv** (ein Knoten zählt als verbunden,
     wenn ihn *irgendein* Transportmittel erreicht — unabhängig von der aktuellen
     Planer-Auswahl), und
   - **ohne** `connectDetachedGraphComponents` — die Querfeldein-Synthetik-Kanten
     dürfen NICHT als „verbunden" zählen.
   Umsetzung: `createGraph` um ein Options-Flag erweitern (z. B.
   `{ skipSyntheticConnections: true, transports: "all" }`) statt einer
   Parallel-Funktion (Duplikat vermeiden — vorhandene Komponente erweitern).
2. **Powerline-Endpunkt-Set** bilden: alle `from_/to_public_id` aus den
   Powerline-Features.
3. `unverbunden(node)` =
   `Object.keys(graph[node.name] || {}).length === 0`
   `&& !powerlineEndpoints.has(node.public_id)`.
4. Ergebnis als `Set<public_id>` cachen; **invalidieren** bei Editor-Writes an
   Pfaden/Orten/Kraftlinien bzw. beim Ein-/Ausschalten des Häkchens neu bauen.

**Kanten-Randfall:** Ein Pfad mit leerer `allowed_transports` (unbefahrbar, vgl.
Commit `b7b3aa18`) erzeugt keine Kante → ein nur so „angebundener" Ort zählt als
unverbunden. Das ist gewollt (routing-realistisch: unbefahrbar = nicht angebunden).

## UI

- Neues Häkchen in der Edit-Mode-Filterzeile (`index.html`, `display-options__row--wrap`,
  bei ~Zeile 1264 neben „Kreuzungen"):
  ```html
  <label id="toggleUnconnectedControl" hidden><input type="checkbox" id="toggleUnconnected" /> Unverbunden</label>
  ```
- Ein-/Ausblendung wie die übrigen Edit-Toggles (`hidden` → im Edit-Mode sichtbar,
  gleiche Mechanik wie `toggleCrossingsControl`).
- State in `runtime-state` (analog zu den vorhandenen Toggles); Umschalten triggert
  einen Marker-Re-Render.

## Darstellung & Scope

- Gezeichnet im vorhandenen Canvas-Marker-Renderer
  (`js/map-features/map-features-location-marker-rendering.js`).
- Ist `toggleUnconnected` an: für jeden **tatsächlich sichtbaren** Knoten, der
  `unverbunden` ist, eine **deutliche rote Umrandung** (Ring).
- „Sichtbar" = reuse der vorhandenen Prädikate: Orte über
  `isLocationTypeVisible(locationType)` (`js/app/bootstrap.js:596`) → automatisch
  „aktiv für die aktive Stadtgrößenkaskade"; Kreuzungen nur bei aktivem
  `toggleCrossings`. Damit erfüllt sich die Owner-Anforderung „aktiv für die
  jeweils aktivierte Kaskade" ohne Extra-Logik.
- Genaue Optik (Ringstärke, -farbe, Radius-Offset) wird **vor** der Umsetzung als
  kleiner sichtbarer Entwurf gezeigt und über eine **Token/Konstante** gesetzt
  (kein hartkodiertes Hex — Design-Regel AGENTS.md §12; warmes/gedämpftes Rot,
  das im Hell- und Dunkelmodus trägt).

## Betroffene Dateien (voraussichtlich)

- `index.html` — Häkchen-Markup.
- `js/config.js` — Rot-Ring-Konstante/Token-Referenz.
- `js/app/runtime-state.js` (+ Toggle-Wiring/Edit-Mode-Einblendung) — Toggle-State.
- `js/routing/route-graph-routing.js` — `createGraph`-Options-Flag
  (skip synthetic, alle Transporte).
- `js/map-features/map-features-powerlines.js` (oder Helper) — Powerline-Endpunkt-Set.
- `js/map-features/map-features-location-marker-rendering.js` — rote Umrandung im
  Draw-Pfad + Cache-Anbindung.

## Verifikation

- Live-Preview im Edit-Mode (`?edit=1`): Häkchen an → bekannte weglose
  Orte/Kreuzungen rot; Kaskade umschalten → nur sichtbare Größen markiert;
  „Kreuzungen" aus → keine roten Kreuzungen; Häkchen aus → alles weg.
- Prüfung via DOM/JS-Messung, **nicht** per Live-Screenshot (Canvas-rAF-Falle):
  Anzahl „unverbunden" gegen eine pre-Querfeldein-0-Kanten-Rechnung plausibilisieren
  und ein paar bekannte Fälle stichprobenartig gegenprüfen.
- Kein Einfluss im Nicht-Edit-Mode.

## Offene Detailpunkte für den Plan

- Exakter Rot-Ring-Stil (sichtbaren Entwurf zeigen, dann Token setzen).
- `createGraph`-Options-Flag genau definieren (Signatur, Default = heutiges Verhalten).
- Cache-Invalidierungs-Hooks: an welche Editor-Events (Pfad/Ort/Kraftlinie
  create/update/delete) hängt sich die Neuberechnung.
