# Calculate Route Boundary Check

## 1. Current Definition

- `calculateRoute` ist im Inline-Script von `index.html` definiert (`index.html:1408`).
- Die Funktion berechnet mit einer Priority-Queue eine Route zwischen zwei Knotennamen auf Basis von `graphData`.
- Sie gibt ein Array von Schritten `{ from, to, connectionId }` zurueck oder `[]`, wenn Start/Ziel im Graphen fehlen oder kein Pfad rekonstruiert werden kann.

## 2. Responsibilities

Aufgaben innerhalb von `calculateRoute`:

- Start-/Endpruefung:
  - `if (!graphData.[startName] || !graphData.[endName]) return [];`
- UI-Status lesen:
  - `const minimizeTransfers = $("#minimizeTransfers").is(":checked");`
- Distanztabelle initialisieren:
  - `distances`, `previousNodes`, `previousTransport`, `connectionUsed`
  - alle `graphData`-Knoten auf `Infinity`, Start auf `0`
- `PriorityQueue` nutzen:
  - initial `enqueue({ node: startName, transport: null }, 0)`
- Kanten iterieren:
  - `Object.entries(graphData[currentNode])`
  - pro Nachbar alle moeglichen Verbindungen
- Transportoption bestimmen:
  - `const transport = conn.transportOption || getTransportOption(conn.routeType);`
- Gewicht berechnen:
  - `useShortestPath  conn.distance : conn.time`
- Transfer-Penalty anwenden:
  - bei aktiviertem `minimizeTransfers` und Transportwechsel `+ TRANSFER_PENALTY`
- Vorgaenger rekonstruieren:
  - Ruecklauf ueber `previousNodes` von `endName` nach vorne
- Route zurueckgeben:
  - rekonstruiertes Schritt-Array

## 3. Dependencies

Globale Variablen/Daten:

- `graphData` (lesen)

Globale Konstanten:

- `TRANSFER_PENALTY` (direkt in `index.html` oberhalb definiert, `index.html:1406`)

Aufgerufene Funktionen/Klassen:

- `getTransportOption(routeType)` aus `js/routing.js`
- `PriorityQueue` aus `js/priority-queue.js`

DOM-/jQuery-/UI-Abhaengigkeiten:

- `$("#minimizeTransfers").is(":checked")`
- indirekt zusaetzlich ueber `getTransportOption`, das weitere UI-Controls liest:
  - `#allowLand`, `#landTransport`, `#allowRiver`, `#riverTransport`, `#allowSea`, `#seaTransport`

Abhaengigkeiten auf `route-graph-core.js`:

- keine direkte Funktionsabhaengigkeit
- indirekte Datenform-Abhaengigkeit:
  - erwartet `graphData[currentNode][neighbor]` als Liste von Verbindungen mit `id`, `distance`, `time`, `routeType`, optional `transportOption`
  - diese Struktur wird durch `createGraph`/synthetische Helfer vorbereitet

Abhaengigkeiten auf `routing.js`:

- direkte Abhaengigkeit auf `getTransportOption`
- Aufrufkontext in `updateMapView` (`js/routing.js:1310`)

## 4. Call Sites

Gefundene Aufrufstellen von `calculateRoute`:

- `js/routing.js:1310` in `updateMapView()`
  - pro Wegpunkt-Paar: `route = calculateRoute(start, end, useShortest);`

Weitere Aufrufstellen wurden per Suche nicht gefunden.

## 5. UI Coupling

Entscheidende Kopplungen:

- `$("#minimizeTransfers").is(":checked")`
  - beeinflusst Gewichtung direkt innerhalb des Dijkstra-Laufs.
- `getTransportOption(conn.routeType)`
  - UI-Auswahl steuert Transport fuer Verbindungen ohne `conn.transportOption`.
- `conn.transportOption || getTransportOption(conn.routeType)`
  - bevorzugt verbindungsspezifischen Transport (wichtig fuer stabile Reproduktion),
  - faellt sonst auf aktuellen UI-Zustand zurueck.

Auswirkungen:

- Land-/Fluss-/See-Auswahl:
  - kann Verbindungen effektiv deaktivieren (wenn `getTransportOption` `null` liefert, wird Verbindung uebersprungen).
- Synthetische Verbindungen:
  - werden im Graphen mit `transportOption` erzeugt; dadurch greift meist kein UI-Fallback in `calculateRoute`.
  - bei fehlendem `transportOption` waere der Fallback aber wieder UI-abhaengig.

## 6. Refactoring Options

A. `calculateRoute` unveraendert nach `js/route-graph-core.js` verschieben

- Technisch moeglich.
- Architektur: unguenstig, weil direkte UI/jQuery-Kopplung mitgezogen wird.

B. `calculateRoute` im Inline-Script lassen

- Stabil und risikoarm.
- Verbessert Grenzen aber nicht.

C. Reinen Dijkstra-Kern als neue Funktion extrahieren (`calculateRouteCore(...)`)

- Gute Zielgrenze: Kern ohne DOM/jQuery.
- Erlaubt spaetere Auslagerung ohne Verhaltensaenderung.

D. UI-Werte vor dem Aufruf berechnen und als Parameter uebergeben

- Passend als Teil von C:
  - `minimizeTransfers` vorab lesen
  - Transport-Resolver als Parameter/Funktionsargument

E. Nur kleine Helper-Funktion extrahieren

- Moeglich, z. B. pure Gewichts-/Relaxierungs-Helfer.
- Sehr kleiner Diff, aber begrenzter Grenznutzen.

F. Vorerst nur Tests/Smoke-Check erweitern

- Sehr sicher, aber keine technische Entkopplung.

## 7. Recommendation

Empfohlener naechster Schritt: **C + D in einem kleinen, verhaltensneutralen Wrapper-Schritt vorbereiten, aber `calculateRoute` selbst vorerst nicht nach `route-graph-core.js` verschieben.**

Konkret:

- `calculateRoute` bleibt als UI-Wrapper im Inline-Script.
- neuer reiner Kern bekommt alle benoetigten Werte als Parameter.
- keine neue UI-Kopplung in `route-graph-core.js`.

Explizit: Ein spaeterer Code-Schritt ohne Verhaltensaenderung ist moeglich.

## 8. Risk Assessment

Moegliche Regressionen:

- kuerzeste vs. schnellste Route:
  - Verwechslung von `distance` und `time` aendert Routenwahl sofort sichtbar.
- Umstiege minimieren:
  - falsche Penalty-Anwendung veraendert Pfadwahl subtil.
- Transportauswahl:
  - falscher Resolver/Fallback kann ganze Kantenklassen ausblenden.
- synthetische Querfeldein-Verbindungen:
  - wenn `transportOption`/Fallback anders ausgewertet wird, werden bestehende Verbindungen ggf. ignoriert.
- fehlende Route:
  - kleine Fehler in Relaxierung oder Rekonstruktion fuehren zu `[]`.
- Routenanzeige mit Segmenten:
  - falsche `connectionId`-Kette fuehrt spaeter zu fehlenden Segmenten (`getRouteSegments`-Warnungen).

## 9. Next Safe Commit

Kleinstmoeglicher sinnvoller Code-Commit:

1. Im Inline-Script eine neue pure Funktion einfuehren, z. B.:
   - `calculateRouteCore(graph, startName, endName, options)`
2. `calculateRoute` unveraendert als Wrapper behalten:
   - liest weiter UI (`minimizeTransfers`)
   - uebergibt `getTransportOption` als Resolver
   - uebergibt `TRANSFER_PENALTY` und `useShortestPath`
3. Keine Verhaltensaenderung:
   - identische Transport-Fallback-Logik (`conn.transportOption || resolver(conn.routeType)`)
   - identische Rekonstruktion und Rueckgabeform
4. Verifikation:
   - Definition/Callsite-Suche
   - Syntaxcheck `index.html`-naher JS-Ausschnitt manuell
   - manueller Smoke-Test auf `https://avesmaps.de/` (Routenarten + Umstiege minimieren + synthetische Verbindung)

Wenn dieser Schritt zu gross wirkt:

- naechster besserer Doku-Schritt: kurzer manueller Regressions-Checklist-Block speziell fuer Routing-Varianten (`shortest/fastest`, `minimizeTransfers` an/aus, Transportkombinationen).

