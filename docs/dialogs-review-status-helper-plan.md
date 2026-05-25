# Dialogs Review Status Helper Plan

## 1. Current Status Setter Pattern

Die folgenden Funktionen nutzen aktuell praktisch dasselbe Muster:

- `setLocationReportStatus(message = "", type = "")`
- `setLocationEditStatus(message = "", type = "")`
- `setWikiSyncResolveStatus(message = "", type = "")`
- `setPathEditStatus(message = "", type = "")`
- `setPowerlineEditStatus(message = "", type = "")`
- `setLabelEditStatus(message = "", type = "")`
- `setRegionEditStatus(message = "", type = "")`

Gemeinsamer Ablauf:

1. jeweiliges Status-Element per spezifischem Getter holen
2. bei fehlendem Element sofort `return`
3. `statusElement.textContent = message`
4. wenn `type` gesetzt: `statusElement.dataset.status = type`
5. sonst: `delete statusElement.dataset.status`

## 2. Differences / Edge Cases

- Verhaltensunterschiede:
  - bei den 7 Fokusfunktionen **keine** fachlichen Verhaltensunterschiede.
- Unterschiedliche Getter:
  - ja, jede Funktion verwendet ihren eigenen Getter (`getLocationReportStatusElement`, `getPathEditStatusElement`, usw.).
  - das soll erhalten bleiben.
- Unterschiedliche Default-Werte:
  - nein, alle nutzen `message = ""` und `type = ""`.
- Sonderfall `setRegionEditStatus`:
  - nur kompaktere Schreibweise (einzeilige `if`/`else`), aber inhaltlich gleiches Verhalten.
- Status-Setter, die **nicht** in diesen Helper passen:
  - `setReviewPanelStatus`, `setChangePanelStatus`, `setPresencePanelStatus`, `setWikiSyncStatus`.
  - Grund: diese setzen `dataset.state` (nicht `dataset.status`) und nutzen `message || ""`.
  - Diese Funktionen sollten in diesem Schritt unveraendert bleiben.

## 3. Candidate Helper

Geeigneter Kandidat:

- `setDialogStatus(statusElement, message = "", type = "")`

Bewertung:

- kapselt exakt den gemeinsamen Element-Teil.
- spezifische Wrapper-Funktionen bleiben erhalten.
- keine Aenderung an Aufrufer-APIs, keine Aenderung an Getter-Logik.
- sehr kleiner, verhaltensneutraler Schnitt mit geringer Regressionflaeche.

## 4. Recommended Code Shape

Nahezu exakter Zielzuschnitt (noch nicht umsetzen):

```js
function setDialogStatus(statusElement, message = "", type = "") {
	if (!statusElement) {
		return;
	}

	statusElement.textContent = message;
	if (type) {
		statusElement.dataset.status = type;
	} else {
		delete statusElement.dataset.status;
	}
}

function setLocationReportStatus(message = "", type = "") {
	setDialogStatus(getLocationReportStatusElement(), message, type);
}

function setLocationEditStatus(message = "", type = "") {
	setDialogStatus(getLocationEditStatusElement(), message, type);
}

function setWikiSyncResolveStatus(message = "", type = "") {
	setDialogStatus(getWikiSyncResolveStatusElement(), message, type);
}

function setPathEditStatus(message = "", type = "") {
	setDialogStatus(getPathEditStatusElement(), message, type);
}

function setPowerlineEditStatus(message = "", type = "") {
	setDialogStatus(getPowerlineEditStatusElement(), message, type);
}

function setLabelEditStatus(message = "", type = "") {
	setDialogStatus(getLabelEditStatusElement(), message, type);
}

function setRegionEditStatus(message = "", type = "") {
	setDialogStatus(getRegionEditStatusElement(), message, type);
}
```

Wichtig:

- oeffentliche Funktionsnamen bleiben unveraendert.
- Getter pro Dialog bleiben unveraendert.
- nur Duplikatabbau innerhalb dieses Setter-Clusters.

## 5. Risk Assessment

Niedriges Risiko, solange exakt nur der gemeinsame Setter-Code extrahiert wird:

- `textContent` muss unveraendert gesetzt werden.
- `dataset.status` muss unveraendert gesetzt/entfernt werden.
- `delete statusElement.dataset.status` muss erhalten bleiben.
- fehlendes Element muss weiterhin zu fruehem `return` fuehren.
- Default-Parameter (`message = ""`, `type = ""`) muessen unveraendert bleiben.
- keine Aenderung an Submit-/Pending-Logik.
- keine Aenderung an API-/Review-/Wiki-Sync-Flows.

## 6. Recommendation

Empfehlung: **Ja, Code-Schritt ist sinnvoll.**

Begruendung:

- sehr kleiner, lokal begrenzter 1-Commit-Refactor
- klare Duplikationsreduktion
- Wrapper bleiben stabil, Aufrufer bleiben unberuehrt
- geringes Risiko bei strikt identischem Verhalten

## 7. Next Safe Commit

Vorgeschlagener spaeterer Mini-Commit:

- nur `js/dialogs-review.js` aendern
- neuen Helper `setDialogStatus(statusElement, message = "", type = "")` einfuegen
- nur die 7 Fokusfunktionen intern auf den Helper umstellen
- keine weiteren `set*Status`-Funktionen anfassen (insb. nicht die `dataset.state`-Varianten)
- keine anderen Bereiche im File aendern
