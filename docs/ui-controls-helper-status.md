# UI Controls Helper Status

## 1. Current Split

- `readReviewTabStorageValue(storageKey)`:
  - liest den gespeicherten Tab-Wert aus `localStorage` robust mit `try/catch`.
- `writeReviewTabStorageValue(storageKey, value)`:
  - schreibt den Tab-Wert in `localStorage`, mit Warn-Log bei Fehlern.
- `updateReviewPanelTabUrlParameter(parameterName, value)`:
  - synchronisiert den jeweiligen URL-Parameter ueber `URL` + `history.replaceState`.
- `bindPersistedTabClickHandler(selector, datasetKey, allowedValues, storageKey, urlParameterName)`:
  - bindet Click-Handler fuer Tab-Elemente und persistiert nur erlaubte Werte.
- `initializeReviewPanelTabState()`:
  - frueher Return bei Nicht-Edit-Mode,
  - liest URL/Storage,
  - setzt initial aktive Tabs,
  - ruft den neuen Click-Binding-Helper fuer Review- und Wiki-Sync-Tabs auf.

## 2. What Improved

- Entfernte Duplikation:
  - die zwei nahezu identischen `querySelectorAll(...).addEventListener(...)`-Bloecke wurden in einen gemeinsamen Helper ueberfuehrt.
- Erhaltene URL-/Storage-Semantik:
  - gleiche Keys (`avesmaps.review.activeTab`, `avesmaps.review.wikiSync.activeTab`),
  - gleiche URL-Parameter (`reviewTab`, `wikiSyncTab`),
  - gleiche Reihenfolge: zuerst Storage schreiben, danach URL aktualisieren.
- Warum verhaltensneutral:
  - gleiche Selektoren, gleiche Dataset-Felder, gleiche Allowed-Value-Pruefung, gleicher frueher Return bei ungueltigem Wert.

## 3. Remaining Candidate Areas

A. Transport-Menu/Combobox-UI

- hoher Nutzen als eigener Refactoring-Bereich, aber eventlastig (Focus, Keyboard, Click-outside, Positioning).

B. Measurement-/Lineal-UI

- klar abgegrenzter Block, jedoch mit mehreren globalen Measurement- und Leaflet-Zustaenden.

C. Wiki-Sync-Territory-Meta-Link-Dekoration

- mittlere Komplexitaet; MutationObserver + DOM-Dekoration sind sensibel bei Timing/Updates.

D. Leaflet-Control-Erstellung

- relativ klein, aber direkt kartenrelevant (Dekoration/Scale-Band).

E. `ui-controls.js` vorerst stabil lassen

- nach frischem, kleinen Extract die risikoaermste Option.

## 4. Recommendation

Empfehlung: **E. `ui-controls.js` vorerst stabil lassen.**

Begruendung:

- lauffaehige Version sichern hat Prioritaet.
- letzter Schritt war frisch und zielgenau; direktes Weiterrefactoring im gleichen Bereich erhoeht kumulatives UI-Risiko.
- naechster Eingriff sollte erst nach separater Analyse des naechsten Subbereichs erfolgen.

## 5. Risk Assessment

- Review-Tab-Persistenz:
  - darf weder URL- noch Storage-Verhalten verlieren.
- Wiki-Sync-Tab-Persistenz:
  - gleiches Risiko wie oben mit separatem Parameter/Key.
- URL-Parameter:
  - falsche Zuordnung fuehrt zu inkonsistentem Deep-Linking.
- LocalStorage:
  - Schreib-/Lesefehler muessen robust bleiben.
- Nicht-Edit-Mode:
  - frueher Return muss unveraendert bleiben.
- Transport-UI:
  - hohes Interaktionsrisiko (Keyboard/Fokus/Position).
- Messwerkzeug:
  - hohes Risiko durch Layer-Lifecycle + globale Zustandsvariablen.
- Wiki-Sync-Meta-Links:
  - Observer-/DOM-Timing kann leicht regressieren.

## 6. Next Safe Commit

Kein direkter Code-Schritt empfohlen.

Naechster Analysebereich:

- **Transport-Menu/Combobox-UI** als reine Analyse (`docs/ui-controls-transport-subarea-check.md`), mit Fokus auf Event-Reihenfolge, Focus-Management und Menu-Positionierung, bevor dort Code extrahiert wird.
