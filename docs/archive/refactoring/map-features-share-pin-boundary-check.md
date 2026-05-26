# Map-Features Boundary Check: Share-Pin-Cluster

## 1. Zweck der Analyse
Diese Analyse bewertet den Share-Pin-Bereich in `js/map-features.js` als moeglichen kleinen, verhaltensneutralen 1:1-Split-Kandidaten. Es wird kein Code verschoben oder geaendert.

## 2. Exakte Funktionsliste des Share-Pin-Clusters
Im aktuellen Codebestand identifizierte Share-Pin-/Share-Clipboard-Funktionen:
- `createSharePinIcon()`
- `clearSharePin({ syncUrl = true } = {})`
- `setSharePin(latlng, { openPopup = false, syncUrl = true } = {})`
- `fallbackCopyTextToClipboard(text)`
- `copyTextToClipboard(text)`
- `copyCurrentUrlToClipboard()`
- `copyCurrentUrlToClipboardWithFeedback()`

Wichtig zur Namenslage gegen Aufgabenliste:
- `showShareFeedback` ist als eigene Funktion **nicht** vorhanden; funktional genutzt wird `showFeedbackToast(...)`.
- `buildShareUrl` ist als eigene Funktion **nicht** vorhanden; funktional genutzt wird `window.location.href` (lesen) plus URL-Sync ueber `syncPlannerStateToUrl` im Layer-State-Cluster.
- `shareCurrentPlannerState` ist als eigene Funktion **nicht** vorhanden; funktional verteilt auf URL-Sync + Clipboard-Aufruf.

## 3. Welche Funktionen bewusst nicht Teil des Clusters sind
Nicht Teil eines moeglichen Share-Pin-Splits:
- `formatSharePinQueryValue` (liegt in `js/map-features-layer-state.js`)
- `syncPlannerStateToUrl` (liegt in `js/map-features-layer-state.js`)
- `applyPlannerStateFromUrl` (liegt in `js/map-features-layer-state.js`)
- `readSharePinFromUrl` (liegt in `js/map-features-layer-state.js`)
- Routen-/Waypoint-Statusverwaltung
- Kontextmenue-/Popup-Dispatcher (z. B. in `js/routing/routing.js`)
- allgemeine Feedback-UI (`showFeedbackToast`) als globaler Querschnitt

## 4. Welche globalen Daten gelesen werden
Direkt gelesen:
- `sharePinMarker`
- `sharePinCoordinates`
- `map`
- `L`
- `window.location`
- `window.history` (indirekt ueber `syncPlannerStateToUrl`)
- `window.navigator?.clipboard`
- `DEFAULT_SHARE_PIN_ZOOM`

## 5. Welche globalen Daten geschrieben oder mutiert werden
- `sharePinMarker` wird gesetzt/entfernt (`L.marker(...)`, `map.removeLayer(...)`).
- `sharePinCoordinates` wird gesetzt/auf `null` gesetzt.
- Marker-Layer auf `map` werden hinzugefuegt/entfernt.
- URL-Status wird indirekt durch `syncPlannerStateToUrl()` mutiert, wenn `syncUrl` aktiv ist.

## 6. Welche externen Funktionen der Cluster aufruft
- `isWithinMapBounds(...)`
- `syncPlannerStateToUrl(...)` (aus `js/map-features-layer-state.js`)
- `showFeedbackToast(...)` (in `copyCurrentUrlToClipboardWithFeedback`)
- Browser-/DOM-API: `document.createElement`, `document.execCommand`, `navigator.clipboard.writeText`

## 7. Welche Funktionen vermutlich von au�en gebraucht werden
Sicher extern genutzt:
- `setSharePin(...)` (u. a. aus `js/routing/routing.js`, Kontextmenue-Aktion)
- `clearSharePin(...)` (u. a. aus `js/routing/routing.js`, Clear-Aktion)
- `copyCurrentUrlToClipboardWithFeedback(...)` (u. a. aus `js/routing/routing.js`, Share-Aktion)

Wahrscheinlich intern relevant:
- `createSharePinIcon(...)`
- `copyCurrentUrlToClipboard(...)`
- `copyTextToClipboard(...)`
- `fallbackCopyTextToClipboard(...)`

## 8. Abh�ngigkeit zu `js/map-features-layer-state.js`
Direkte Kopplung:
- `clearSharePin(...)` und `setSharePin(...)` rufen `syncPlannerStateToUrl(...)` auf.
- `applyPlannerStateFromUrl(...)` in `js/map-features-layer-state.js` ruft wiederum `setSharePin(...)`/`clearSharePin(...)`.
- `buildPlannerSearchParams(...)` nutzt `sharePinCoordinates` + `formatSharePinQueryValue(...)`.

Damit besteht bidirektionale Laufzeitkopplung zwischen Share-Pin-Cluster und Layer-State-Cluster.

## 9. Abh�ngigkeit zu Routen-/Waypoint-State und URL-Sync
- Share-Pin ist Teil des URL-Zustands (Query-Parameter via Layer-State-Helfer).
- Route-/Waypoint-�nderungen triggern denselben URL-Sync-Pfad; Share-Pin darf diesen Fluss nicht brechen.
- Wiederherstellung nach Reload erfolgt ueber `applyPlannerStateFromUrl` + `readSharePinFromUrl`.

## 10. Abh�ngigkeit zu Popup-/Kontextmen�-Flows
- Share-Pin wird im Kontextmenue gesetzt (`routing.js`, `data-context-action="share-pin"`).
- Nach dem Setzen wird Clipboard-Feedback gestartet (`copyCurrentUrlToClipboardWithFeedback`).
- Popup/Feedback-UX haengt von `showFeedbackToast(...)` und Marker-Popup-Verhalten ab.

## 11. M�gliche sp�tere Ziel-Datei
Bewertung:
- `js/map-features-share-pin.js`: risikoaermer fuer einen kleinen, klaren 1:1-Extract (UI/Marker/Clipboard rund um Share-Pin).
- Integration in `js/map-features-layer-state.js`: funktional moeglich, aber Scope-Mischung (URL-Parsing/Serialisierung + Marker/Clipboard/UI) wird groesser.

Fuer klassischen Script-Tag-Aufbau ist `js/map-features-share-pin.js` als enger Mini-Schnitt risikoaermer.

## 12. N�tige Script-Reihenfolge, falls sp�ter ausgelagert w�rde
Empfohlene Reihenfolge bei spaeterem Split:
1. `js/map-features-layer-state.js`
2. `js/map-features-share-pin.js` (neu)
3. `js/map-features.js`

Begruendung:
- Share-Pin-Funktionen rufen `syncPlannerStateToUrl(...)` aus Layer-State auf.
- Rest-Orchestrierung und externe Aufrufer bleiben in `map-features.js`/`routing.js`.

## 13. Risikoanalyse
- URL-Sync: mittel bis hoch
  - falsche Reihenfolge oder fehlende Aufrufe brechen Share-URLs.
- Reload-Wiederherstellung: hoch
  - Kopplung zu `applyPlannerStateFromUrl`/`readSharePinFromUrl` muss intakt bleiben.
- Marker-Layer-Lifecycle: mittel
  - `sharePinMarker` add/remove und Popup-Oeffnen muessen stabil bleiben.
- Clipboard-API-Fallback: mittel
  - Browser-API + `execCommand`-Fallback darf nicht regressieren.
- Feedback-Anzeige: niedrig bis mittel
  - `showFeedbackToast`-Integration muss konsistent bleiben.
- Zusammenspiel mit Routen-Share-URLs: hoch
  - Share-Pin und Planner-State teilen denselben URL-Zustandskanal.

## 14. Klare Empfehlung
- Soll danach ein Code-Split folgen: **ja, aber nur als sehr kleiner 1:1-Schnitt**.
- Minimal zu verschiebende Funktionen:
  - `createSharePinIcon`
  - `clearSharePin`
  - `setSharePin`
  - `fallbackCopyTextToClipboard`
  - `copyTextToClipboard`
  - `copyCurrentUrlToClipboard`
  - `copyCurrentUrlToClipboardWithFeedback`
- Vorarbeit, falls man trotzdem noch pausieren will:
  - kurzer Smoke-Plan fuer Kontextmenue-Share, Reload-Restore und Clipboard-Fallback.
  - expliziter Reihenfolge-Check mit `map-features-layer-state.js` vor moeglichem Share-Pin-Script.
