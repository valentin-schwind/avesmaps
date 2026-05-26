# Dialogs Review Core Split Boundary Check

## 1. Current Core Responsibilities

### DOM-Getter
- Liefert gezielt Overlay-/Dialog-/Form-/Status-Elemente fuer Location, WikiSyncResolve, Path, Powerline, Label, Region.
- Ist rein lesend (`document.getElementById(...)`) und hat keine Seiteneffekte.

### Dialog-State-Getter
- `is...DialogOpen` prueft per jQuery `hidden`-State der jeweiligen Overlays.
- Wird fuer Escape-Handling und UI-Flussentscheidungen genutzt.

### Service-Konfigurationspruefung
- `isLocationReportServiceConfigured` kapselt die Pruefung von `LOCATION_REPORT_FORM_ENDPOINT_URL`.

### Modal-Body-State-Sync
- `syncModalDialogBodyState` setzt/entfernt die Body-Klasse `modal-dialog-open` anhand offener Overlays.
- Zentrale UI-Kopplung, von vielen Dialog-Clustern genutzt.

## 2. Current Consumers

### `js/dialogs-review-status.js`
- Nutzt DOM-Getter fuer Status-Elemente:
  - `getLocationReportStatusElement`
  - `getLocationEditStatusElement`
  - `getWikiSyncResolveStatusElement`
  - `getPathEditStatusElement`
  - `getPowerlineEditStatusElement`
  - `getLabelEditStatusElement`
  - `getRegionEditStatusElement`

### `js/dialogs-review-pending.js`
- Nutzt DOM-Getter fuer Formulare:
  - `getLocationReportFormElement`
  - `getLocationEditFormElement`
  - `getWikiSyncResolveFormElement`
  - `getPathEditFormElement`
  - `getPowerlineEditFormElement`

### `js/dialogs-review-paths.js`
- Nutzt DOM-Getter fuer Formulare:
  - `getPathEditFormElement`
  - `getPowerlineEditFormElement`

### `js/dialogs-review-labels.js`
- Nutzt Core/Dialog-Zustand:
  - `syncModalDialogBodyState`
  - `getLabelEditDialogElement`

### `js/dialogs-review-locations.js`
- Nutzt Core/Getters:
  - `getLocationReportFormElement`
  - `getLocationEditFormElement`
  - `getLocationReportServiceNoteElement`
  - `isLocationReportServiceConfigured`
  - `syncModalDialogBodyState`
  - `getLocationReportDialogElement`
  - `getLocationEditDialogElement`

### `js/review/review-region-util.js`
- Nutzt weiterhin den Core breit fuer Reset/Open/Close-/Escape-/Review-/Region-/WikiSync-Logik.

## 3. Candidate Split File

### A. `js/dialogs-review-core.js` mit DOM-Gettern + `is...DialogOpen` + `isLocationReportServiceConfigured` + `syncModalDialogBodyState`
- Vorteil: saubere Abhaengigkeitsrichtung fuer alle bereits ausgelagerten Cluster.
- Vorteil: rein definierende Funktionen, keine Top-Level-UI-Aktionen.
- Risiko: niedrig bis mittel (viele Funktionsnamen, aber mechanischer 1:1-Move).
- Bewertung: **beste Option**.

### B. `js/dialogs-review-dom.js` nur mit DOM-Gettern
- Vorteil: sehr kleiner Scope.
- Nachteil: `syncModalDialogBodyState` und `is...DialogOpen` bleiben in Restdatei, Abhaengigkeiten bleiben verteilt.
- Bewertung: brauchbar, aber architektonisch nur Teilerfolg.

### C. `js/dialogs-review-modal-state.js` nur mit `is...DialogOpen` + `syncModalDialogBodyState`
- Vorteil: explizite Modal-Logikdatei.
- Nachteil: trennt stark zusammengehoerige Basisfunktionen kuenstlich auf zwei Dateien.
- Bewertung: weniger sinnvoll als A.

### D. vorerst kein Core-Split
- Stabil, aber haelt kuenstliche Rueckwaertsabhaengigkeit auf `js/review/review-region-util.js` aufrecht.
- Bewertung: nur sinnvoll, wenn aktuell keine weiteren Dialog-Splits geplant sind.

## 4. Script-Reihenfolge

Empfohlene Reihenfolge fuer spaeteren Split:
1. `js/dialogs-review-core.js`
2. `js/dialogs-review-status.js`
3. `js/dialogs-review-pending.js`
4. `js/dialogs-review-paths.js`
5. `js/dialogs-review-labels.js`
6. `js/dialogs-review-locations.js`
7. `js/review/review-region-util.js`

Bewertung:
- Diese Reihenfolge ist sinnvoll und risikoarm, weil alle konsumierenden Dateien dann ihre Basishilfen garantiert vorfinden.
- Kritische Voraussetzung: neue Core-Datei enthaelt nur Funktionsdefinitionen, keine Top-Level-Ausfuehrung.

## 5. Dependency/Risk Analysis

- jQuery-Abhaengigkeit: `is...DialogOpen` und `syncModalDialogBodyState` brauchen `$`; jQuery wird in `index.html` frueh geladen, daher stabil.
- Konfig-Abhaengigkeit: `isLocationReportServiceConfigured` nutzt `LOCATION_REPORT_FORM_ENDPOINT_URL`; Zugriff erfolgt zur Laufzeit.
- DOM-Verfuegbarkeit: Getter greifen erst beim Aufruf auf DOM zu, nicht beim Dateiladen.
- Kein Top-Level-DOM-Sideeffect: Core-Funktionen sind deklarativ und damit gut splitbar.
- Verbesserte Abhaengigkeitsrichtung: ausgelagerte Cluster haengen dann nicht mehr von Definitionsresten in `js/review/review-region-util.js` ab.

## 6. Safest Possible First Move

Empfehlung: **ein gemeinsamer Core-Split nach Variante A**.

### Neue Datei
- `js/dialogs-review-core.js`

### Exakt zu verschiebende Funktionen
- Alle genannten DOM-Getter
- Alle genannten `is...DialogOpen`
- `isLocationReportServiceConfigured`
- `syncModalDialogBodyState`

### Script-Reihenfolge
- wie in Abschnitt 4.

Warum sicher:
- mechanischer 1:1-Transfer ohne Verhaltensaenderung,
- keine Veraenderung an State, Event-Bindings oder Submit-Flows,
- entkoppelt bereits gesplittete Cluster sauber.

## 7. Moves To Avoid

- Keine globalen State-Variablen verschieben.
- Keine Region-/Wiki-Sync-Logik verschieben.
- Keine Submit-Handler verschieben.
- Keine Event-Bindings verschieben.
- Keine bereits gesplitteten Feature-Cluster erneut anfassen.
- Keine ES-Module, kein Build-System.

## 8. Smoke-Test Requirements

- Seite laedt ohne `ReferenceError`.
- Dialoge oeffnen/schliessen (soweit schnell):
  - Ort melden
  - Ort bearbeiten
  - Weg bearbeiten
  - Kraftlinie bearbeiten
  - Label bearbeiten
  - Region bearbeiten (falls schnell)
  - WikiSyncResolve (falls schnell)
- Body-Klasse `modal-dialog-open` wird beim Oeffnen/Schliessen korrekt gesetzt/entfernt.
- Keine neuen Konsolenfehler.

## 9. Recommendation

- **Core-Split ist als naechster Code-Schritt sinnvoll.**
- Die genannten Funktionen sollten **gemeinsam** in eine Datei (`js/dialogs-review-core.js`) verschoben werden, nicht in mehrere Mini-Dateien.
- Nach diesem Split: als naechsten Analysebereich `Review/Change/Presence` pruefen (kein direkter weiterer Verschiebe-Schritt ohne neue Boundary-Analyse).