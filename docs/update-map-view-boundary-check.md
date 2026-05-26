# Update Map View Boundary Check

## 1. Current Definition

- `updateMapView` ist in `js/routing.js` definiert (`js/routing.js:1258`).
- Die Funktion wird als zentraler Orchestrator fuer Routen-Neuberechnung und Darstellung verwendet.
- Aufrufstellen (Suche):
  - `js/routing.js`: u. a. bei Button-Klick, Waypoint-Entfernung, Shared-Route-Wiederherstellung, Kontextaktionen
  - `js/map-features.js`: bei mehreren Edit-/Geometrie-Updates und Sortier-/Drag-Updates

## 2. Responsibilities

`updateMapView` mischt aktuell diese Aufgaben:

- Routentyp aus UI lesen (`shortest`/`fastest`)
- URL-State synchronisieren (`syncPlannerStateToUrl`)
- `graphData` neu bauen (`createGraph`)
- Routenpraesentation zuruecksetzen (`resetRoutePresentation`)
- `selectedLocations` / `invalidLocationInputs` zuruecksetzen
- Wegpunkt-Inputs lesen (`getWaypointContainers`)
- Orte validieren (`validateLocation`)
- ungueltige Inputs markieren (`highlightError`)
- Tooltips fuer ausgewaehlte Orte setzen (`addTooltip`)
- Debug-Logs fuer Auswahl/Graph
- Karte auf aktive Ziele fokussieren (`focusMapOnActiveTargets`)
- Fehlerdialog fuer ungueltige Orte (`alert`)
- Route pro Wegpunkt-Paar berechnen (`calculateRoute`)
- `routeNodeNames` aufbauen
- Routensegmente sammeln (`getRouteSegments`)
- Fehlerdialog bei fehlender Teilroute (`alert` + `return`)
- Route zeichnen (`drawRoute`)
- Routenorte hervorheben (`highlightRouteLocations`)
- Routenplan anzeigen (`showRoutePlan`)

## 3. Dependencies

Direkte Abhaengigkeiten in `updateMapView`:

Globale Daten/State:

- `graphData`
- `selectedLocations`
- `invalidLocationInputs`

DOM/jQuery/UI:

- `$('input[name="pathType"]:checked').val()`
- `getWaypointContainers()` + `.waypoint-input`
- `alert(...)`

Routing-Funktionen:

- `calculateRoute`
- `getRouteSegments`

Rendering-Funktionen:

- `resetRoutePresentation`
- `addTooltip`
- `focusMapOnActiveTargets`
- `drawRoute`
- `highlightRouteLocations`
- `showRoutePlan`
- `highlightError`

Graph-Funktionen:

- `createGraph`

URL-State-Funktionen:

- `syncPlannerStateToUrl`

Alert/Console:

- mehrere `console.log(...)`
- mehrere `alert(...)`

## 4. Candidate Helper Boundaries

A. `updateMapView` unveraendert lassen

- stabil, aber kein Fortschritt bei Entkopplung/Lesbarkeit

B. Helper zum Sammeln/Validieren der Wegpunkte extrahieren

- kleinster sinnvoller Schnitt:
  - lokal begrenzter Block
  - klarer Input/Output
  - geringe Kopplungsgefahr

C. Helper zum Berechnen aller Routensegmente aus `selectedLocations` extrahieren

- sinnvoll, aber risikoreicher als B:
  - enthaelt Alerts, fruehe Returns, Seiteneffekte auf Arrays

D. Helper zum Anzeigen des fertigen Routenergebnisses extrahieren

- auch moeglich, aber geringerer Nutzen als B bei aehnlicher Diff-Groesse

E. Helper fuer Fehlerbehandlung/Alerts extrahieren

- moeglich, aber Gefahr inkonsistenter Meldungsreihenfolge

F. `updateMapView` in `routing.js` lassen, aber in klar benannte lokale Schritte zerlegen

- gutes Zielbild; B ist der kleinste erste Schritt in diese Richtung

G. `updateMapView` verschieben oder nach `routing/route-graph-core.js` verschieben

- nicht sinnvoll:
  - starke UI-/DOM-Kopplung
  - wuerde falsche Verantwortung in den Core ziehen

## 5. Recommended Next Step

Empfehlung: **B als kleinster verhaltensneutraler Schritt**.

Konkret:

- lokalen Wegpunkt-Scan/Validierungsblock in einen Helper in `js/routing.js` extrahieren (nahe bei `updateMapView`).
- `updateMapView` bleibt Orchestrator und ruft den Helper auf.

Warum:

- kleiner Diff
- keine neue UI-Kopplung in `routing/route-graph-core.js`
- gute Lesbarkeit
- geringe Regressionflaeche

Explizit: Ein spaeterer Code-Schritt ohne Verhaltensaenderung ist moeglich.

## 6. Exact Proposed Helper

Skizze fuer den spaeteren Schritt (**noch keine Codeaenderung**):

```js
function collectAndValidateSelectedLocations() {
	selectedLocations = [];
	invalidLocationInputs = [];

	getWaypointContainers().each(function () {
		const $waypoint = $(this);
		const $input = $waypoint.find(".waypoint-input");
		const inputVal = ($input.val() || "").trim();

		if (!inputVal) {
			return;
		}

		const loc = validateLocation(inputVal);
		if (loc) {
			selectedLocations.push({
				...loc,
				waypointId: String($waypoint.data("waypointId") || ""),
			});
		} else {
			invalidLocationInputs.push(inputVal);
			highlightError($input);
		}
	});
}
```

Verwendung in `updateMapView`:

- statt des bisherigen Inline-Blocks:
  - `collectAndValidateSelectedLocations();`

Wichtig:

- keine Aenderung an Alerts, Logs, Rueckgabeformen oder Reihenfolgen danach

## 7. Risk Assessment

Kritische Punkte:

- Wegpunkt-Reihenfolge:
  - Reihenfolge aus DOM darf sich nicht aendern
- ungueltige Orte:
  - Markierung + Sammlung in `invalidLocationInputs` muss identisch bleiben
- Tooltips:
  - weiterhin erst nach Sammlung der validen Orte setzen
- Route ueber mehrere Wegpunkte:
  - Iteration und Segment-Akkumulation unveraendert
- Teilroute ohne Ergebnis:
  - `alert` + `return` muss gleich bleiben
- Segmentaufloesung:
  - keine Aenderung an `getRouteSegments`
- bestehende Logs/Alerts:
  - Reihenfolge und Texte beibehalten
- URL-Sharing:
  - `syncPlannerStateToUrl()` weiterhin zu Beginn
- Drag-and-drop-Wegpunkte:
  - Aufrufer in `map-features.js`/`routing.js` bleiben unveraendert

## 8. Next Safe Commit

Kleinster spaeterer Code-Commit:

1. In `js/routing.js` neuen Helper `collectAndValidateSelectedLocations()` nahe `updateMapView` einfuegen.
2. Bisherigen Wegpunkt-Scan/Validierungsblock in `updateMapView` 1:1 in den Helper verschieben.
3. In `updateMapView` den Block durch einen einzigen Helper-Aufruf ersetzen.
4. Keine weiteren Aenderungen.

Falls das zu riskant wirkt:

- naechster reiner Doku-Schritt: Testmatrix mit konkreten Mehrwegpunktfaellen (2, 3, 4 Wegpunkte inkl. 1 ungueltigem Zwischenpunkt).

