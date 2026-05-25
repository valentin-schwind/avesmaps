# UI Controls Boundary Check

## 1. Current Responsibilities

`js/ui-controls.js` deckt aktuell mehrere Themenbereiche ab:

- Karten-/Leaflet-Controls:
  - Map-Dekorationen und Scale-Band (`getMapDecorationBounds`, `addMapScaleBandControl`, `initializeMapDecorations`).
- Messwerkzeug (Lineal):
  - Start/End-Hebel, Linie, Distanzlabel, Kontextmenue-Sichtbarkeit (`startDistanceMeasurementAt`, `completeDistanceMeasurementAt`, `updateDistanceMeasurementPresentation`).
- Transport-UI:
  - Icon-Select/Combobox, Keyboard-Navigation, Menu-Positionierung, Open/Close, Sync (`initializeTransportIconSelects` und Unterfunktionen).
- Review-Tab/UI:
  - Tab-State aus URL/LocalStorage, Persistierung bei Klick, URL-Parameter-Update (`initializeReviewPanelTabState`).
- Wiki-Sync-Territory-UI-Ergaenzung:
  - Meta-Link-Dekoration + MutationObserver (`initializeWikiSyncTerritoryMetaLinks`).
- Start-/Initialisierungslogik:
  - `initializeReviewUiEnhancements()` plus DOMContentLoaded-Startblock.

## 2. Dependencies

- DOM/jQuery/Leaflet:
  - DOM-APIs (`document.getElementById`, `querySelector(All)`, `createElement`, `addEventListener`).
  - jQuery in Transport-Select Sync (`$(`#${selectId}`).val(...).trigger("change")`, `on("change", ...)`).
  - Leaflet (`L.control`, `L.imageOverlay`, `L.marker`, `L.polyline`, `L.divIcon`, `L.latLng`, `map`).
- Globale Map-/Measurement-States:
  - `map`, `distanceMeasurementStartLatLng`, `distanceMeasurementEndLatLng`, `distanceMeasurementLine`, `distanceMeasurementLabel`, `distanceMeasurementStartHandle`, `distanceMeasurementEndHandle`, `isAwaitingDistanceMeasurementEnd`.
- Routing-/Transportfunktionen bzw. -konfiguration:
  - `ICON_TRANSPORT_SELECT_IDS`, `TRANSPORT_ICON_PATHS`, `DEFAULT_PLANNER_STATE`, `setVersionedIconSource`.
- LocalStorage/URL/History:
  - `window.localStorage`, `new URL(window.location.href)`, `window.history.replaceState(...)`.
- Edit-/Review-Abhaengigkeiten:
  - `IS_EDIT_MODE`, `window.setEditorPanelTab`, `window.setWikiSyncPanelTab`.
  - Wiki-Sync-Datenquelle: `window.wikiSyncTerritoryTreeRowsCache` / `window.AvesmapsWikiSyncTerritoryTreeRowsCache`.

## 3. Candidate Subareas

A. Transport-Menu/Transport-Control-UI

- technisch klarer Bereich, aber eventlastig (Click/Keyboard/Focus/Positioning) und stark nutzersichtbar.

B. Measurement-/Lineal-UI

- konzentrierter Bereich, aber mit Map-Layer-Lebenszyklus und mehreren globalen States.

C. Review-Tab-/Panel-UI

- relativ klein, klar umrissen, wenig Leaflet-/Map-Abhaengigkeit, guter Kandidat fuer kleinen 1:1-Extract.

D. Leaflet-Control-Erstellung

- solide gekapselt, aber direkt kartenrelevant (Dekoration/Scale); Fehler sofort sichtbar.

E. Initialisierungs-/Startup-Block

- sehr klein, aber aenderungsarm; wenig echter Refactoring-Gewinn.

F. Datei vorerst stabil lassen

- immer valide Option, aber es gibt hier einen kleinen, risikoarmen Kandidaten (C).

## 4. Risk Assessment

A. Transport-Menu/Transport-Control-UI

- Nutzer-Sichtbarkeit: hoch
- Seiteneffekte: hoch (Focus, Open/Close, Change-Events)
- globale State-Abhaengigkeiten: mittel
- Testbarkeit: mittel
- Risiko fuer produktive Karte: mittel bis hoch

B. Measurement-/Lineal-UI

- Nutzer-Sichtbarkeit: hoch
- Seiteneffekte: hoch (Layer add/remove, draggable Marker)
- globale State-Abhaengigkeiten: hoch
- Testbarkeit: mittel
- Risiko fuer produktive Karte: mittel bis hoch

C. Review-Tab-/Panel-UI

- Nutzer-Sichtbarkeit: mittel
- Seiteneffekte: mittel (Storage + URL-Param)
- globale State-Abhaengigkeiten: niedrig bis mittel
- Testbarkeit: gut (URL/Storage/Klickpfade)
- Risiko fuer produktive Karte: niedrig bis mittel

D. Leaflet-Control-Erstellung

- Nutzer-Sichtbarkeit: mittel
- Seiteneffekte: mittel (Map-Control Registrierung)
- globale State-Abhaengigkeiten: mittel
- Testbarkeit: mittel
- Risiko fuer produktive Karte: mittel

E. Initialisierungs-/Startup-Block

- Nutzer-Sichtbarkeit: indirekt
- Seiteneffekte: mittel (Init-Reihenfolge)
- globale State-Abhaengigkeiten: mittel
- Testbarkeit: gut
- Risiko fuer produktive Karte: mittel

F. Datei stabil lassen

- Nutzer-Sichtbarkeit: keine neue
- Seiteneffekte: keine neue
- Risiko: niedrig

## 5. Recommended Next Step

Empfehlung: **C. Review-Tab-/Panel-UI als naechster Mini-Schritt**.

Konkret: kleiner 1:1-Extract der doppelt vorhandenen Click-Persistierungslogik in `initializeReviewPanelTabState`.

Warum dieser Schritt:

- kleiner Diff
- keine Routing-Aenderung
- keine Aenderung an `dialogs-review.js`, `map-features.js`, `popups.js`
- geringe technische Kopplung zu Karten-/Leaflet-Laufzeit
- verhaltensneutral gut absicherbar

## 6. Possible Helper

Vorschlag:

- `bindPersistedTabClickHandler(selector, datasetKey, allowedValues, storageKey, urlParameterName)`

Exakte Stelle:

- innerhalb/nahe `initializeReviewPanelTabState`, als Ersatz fuer die zwei nahezu gleichen `querySelectorAll(...).forEach(...addEventListener...)`-Bloecke.

Nahezu exakte Skizze (nicht umsetzen):

```js
function bindPersistedTabClickHandler(selector, datasetKey, allowedValues, storageKey, urlParameterName) {
	document.querySelectorAll(selector).forEach((tabElement) => {
		tabElement.addEventListener("click", () => {
			const value = String(tabElement.dataset[datasetKey] || "").trim();
			if (!allowedValues.includes(value)) return;
			writeReviewTabStorageValue(storageKey, value);
			updateReviewPanelTabUrlParameter(urlParameterName, value);
		});
	});
}
```

## 7. Next Safe Commit

Falls Code spaeter umgesetzt wird:

- Scope: nur `js/ui-controls.js`
- Art: kleinster 1:1-Extract der beiden Tab-Click-Bloecke auf einen lokalen Helper
- keine Aenderung an URL-Parametern, Storage-Keys, erlaubten Values, Event-Reihenfolge

Erforderliche Smoke-Faelle:

1. Review-Tab wechseln (`review`, `changes`, `wiki-sync`, `presence`) und Seite neu laden.
2. Wiki-Sync-Tab wechseln (`locations`, `territories`) und Seite neu laden.
3. URL-Parameter `reviewTab`/`wikiSyncTab` werden bei Klick korrekt gesetzt/aktualisiert.
4. LocalStorage-Werte werden geschrieben und beim Start gelesen.
5. Verhalten in Nicht-Edit-Mode bleibt unveraendert (frueher Return bei `!IS_EDIT_MODE`).

Falls kein Code-Schritt direkt gewuenscht ist:

- naechster Analysebereich: Transport-Menu-UI (nur Analyse), insbesondere Focus-/Keyboard-Handling und Menu-Positionierung.
