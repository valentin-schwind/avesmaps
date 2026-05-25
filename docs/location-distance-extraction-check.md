# Location Distance Extraction Check

## 1. Current Definition

- `getLocationDistance` ist derzeit in `js/map-features.js` definiert (`js/map-features.js:1588`).
- Die Funktion nimmt zwei Location-Objekte mit `coordinates` im Format `[lat, lng]`, entpackt beide Koordinatenpaare und ruft `calculateCoordinateDistance([lat, lng], [lat, lng])` auf.
- Effekt: reine euklidische Distanz in Kartenkoordinaten (keine Leaflet-/DOM-/API-Interaktion).

## 2. Dependencies

`getLocationDistance(firstLocation, secondLocation)`

- Liest globale Variablen:
  - keine
- Schreibt globale Variablen:
  - keine
- Aufgerufene Funktionen:
  - `calculateCoordinateDistance(...)` aus `js/utils.js` (`js/utils.js:32`)
- DOM/Leaflet/jQuery/API/map-Abhaengigkeiten:
  - keine direkte Abhaengigkeit

## 3. Call Sites

Alle Treffer von `getLocationDistance(...)`:

1. `index.html:1508`
   - Kontext: `findNearestComponentConnection(...)` im Inline-Script
   - Zweck: Naechste Verbindung zwischen getrennten Graph-Komponenten finden (fuer synthetische Verbindungen).

2. `js/map-features.js:2585`
   - Kontext: `findNearestLocationToLatLng(...)`
   - Zweck: Naechsten Ort zu einer Kartenposition bestimmen (u. a. Kontextmenue-Aktionen in `js/routing.js`).

3. `js/map-features.js:2599`
   - Kontext: `findNearestGraphNodeToLatLng(...)`
   - Zweck: Naechsten Graph-Knoten fuer Edit-/Erstellungsablaeufe bestimmen (z. B. `startPathCreationAt`).

Hinweis zur Definition:
- `js/map-features.js:1588` ist die aktuelle Funktionsdefinition.

## 4. Extraction Recommendation

Empfehlung: **sicher nach `js/route-graph-core.js` verschiebbar** (ohne Verhaltensaenderung), mit unveraendertem Funktionsnamen und unveraenderter Logik.

Begruendung:

- Die Funktion ist rein rechnerisch und frei von DOM/Leaflet/API.
- `js/route-graph-core.js` wird bereits vor `js/map-features.js` geladen (`index.html:875` vs. `index.html:885`), daher bleiben bestehende Aufrufe aus `js/map-features.js` gueltig.
- `calculateCoordinateDistance` bleibt aus `js/utils.js` verfuegbar (`index.html:874`), also ist die Abhaengigkeit bereits vor dem Aufruf vorhanden.
- Fuer den naechsten Schritt (`findNearestComponentConnection` in `route-graph-core.js`) wird die Rueckwaertsabhaengigkeit auf `js/map-features.js` reduziert.

Alternative:
- `js/utils.js` waere technisch ebenfalls moeglich, ist aber weniger klar, weil `getLocationDistance` ein domain-spezifisches Location-Objekt (`coordinates`) erwartet.

## 5. Risk Assessment

Moegliche Regressionen bei spaeterer Verschiebung:

- **Routing / synthetische Verbindungen**:
  - `findNearestComponentConnection` nutzt `getLocationDistance` fuer die Kantenwahl. Schon kleine Aenderungen an Reihenfolge/Koordinateninterpretation (`lat/lng`) koennen zu anderen Verbindungskanten fuehren.
- **Editmode**:
  - `findNearestLocationToLatLng` und `findNearestGraphNodeToLatLng` haengen direkt daran. Fehler wirken auf Kontextmenue-Aktionen und Pfaderstellung.
- **Globale Aufloesung / Load Order**:
  - Bei doppelter Definition oder falscher Reihenfolge kann es zu Shadowing oder `ReferenceError` kommen.
- **Entfernungsmessung**:
  - keine direkte Abhaengigkeit gefunden (`Entfernungsmessung` nutzt andere Distanzpfade), Risiko hier gering.
- **Kartenrendering**:
  - keine direkte Abhaengigkeit; nur indirekt ueber editbezogene Naechstknoten-Workflows.

## 6. Next Safe Commit

Kleinster sichere Folge-Commit (falls umgesetzt werden soll):

1. `getLocationDistance` unveraendert von `js/map-features.js` nach `js/route-graph-core.js` verschieben.
2. Originaldefinition in `js/map-features.js` entfernen.
3. Keine weiteren Funktionen anfassen.
4. Checks:
   - `rg -n "function getLocationDistance|getLocationDistance\\(" index.html js`
   - sicherstellen: genau 1 Definition, Call Sites unveraendert
   - `node --check js/route-graph-core.js`
   - optional: `node --check js/map-features.js`

Fazit:
- Eine spaetere Verschiebung ist **ohne Verhaltensaenderung moeglich**.
- Aufgrund der aktuellen Abhaengigkeitslage ist der Schritt klein und kontrollierbar.
