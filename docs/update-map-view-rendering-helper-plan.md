# Update Map View Rendering Helper Plan

## 1. Current Rendering Block

Aktueller Block in `updateMapView` (nach erfolgreichem `routeResult`):

- `console.log("Komplette Route (Knoten):", routeNodeNames)`
- `console.log("Routensegmente:", segments)`
- `if (segments.length)`
  - `logRoutePoints(segments)`
  - `drawRoute(segments)`
  - `highlightRouteLocations(routeNodeNames, segments)`
  - `showRoutePlan(routeNodeNames, segments)`
- `else`
  - `alert("Keine gültigen Routensegmente gefunden.")`

## 2. Candidate Helper

Kandidat:

- `renderRouteResult(routeNodeNames, segments)`

Bewertung:

- sinnvoll als kleiner 1:1-Extract
- reduziert Komplexitaet in `updateMapView`, ohne Verantwortung zu verlagern
- verbleibt bewusst in `js/routing.js` (UI-/Rendering-nah)

## 3. Exact Proposed Function

Nahezu exakter Entwurf (noch **nicht** umsetzen):

```js
function renderRouteResult(routeNodeNames, segments) {
	console.log("Komplette Route (Knoten):", routeNodeNames);
	console.log("Routensegmente:", segments);
	if (segments.length) {
		logRoutePoints(segments);
		drawRoute(segments);
		highlightRouteLocations(routeNodeNames, segments);
		showRoutePlan(routeNodeNames, segments);
	} else {
		alert("Keine gültigen Routensegmente gefunden.");
	}
}
```

Invarianten:

- Log-Texte unveraendert
- Log-Reihenfolge unveraendert
- Rendering-Reihenfolge unveraendert
- Alert-Text unveraendert
- kein zusaetzlicher Rueckgabewert noetig

## 4. Boundary Quality

Gewinn fuer `updateMapView`:

- klarere Trennung zwischen "Route berechnen" und "Route darstellen"
- kuerzerer Orchestrator, besser scanbar

Bewusst verbleibende Seiteneffekte in `routing.js`:

- Console-Logs
- Alert
- Layer-Rendering und Highlighting
- Plan-UI-Aufbau

Warum nicht nach `routing/route-graph-core.js`:

- der Block ist rein UI/Rendering-orientiert
- keine Core-Graph-Verantwortung
- Verschiebung in den Core wuerde unnoetige UI-Kopplung erzeugen

## 5. Risks

- Rendering-Reihenfolge:
  - Reihenfolge von `logRoutePoints -> drawRoute -> highlightRouteLocations -> showRoutePlan` darf nicht kippen
- leere Segmente:
  - Alert muss identisch bleiben
- Route mit mehreren Wegpunkten:
  - `routeNodeNames`/`segments` unveraendert weiterreichen
- `highlightRouteLocations(routeNodeNames, segments)`:
  - unveraenderte Parameterreihenfolge
- `showRoutePlan(routeNodeNames, segments)`:
  - unveraenderte Parameterreihenfolge
- bestehende Logs/Alerts:
  - keine Textaenderung, keine Reihenfolgeaenderung

## 6. Recommendation

Empfehlung:

- jetzt nur planen (diese Datei)
- Code-Schritt erst nach weiterem kurzen Stabilitaets-/Smoke-Fenster

## 7. Next Safe Code Commit

Wenn spaeter umgesetzt:

1. nur `js/routing.js` aendern
2. nur `renderRouteResult(routeNodeNames, segments)` neu einfuegen
3. in `updateMapView` den bestehenden Rendering-Block 1:1 durch `renderRouteResult(routeNodeNames, segments)` ersetzen
4. keine sonstigen Aenderungen

