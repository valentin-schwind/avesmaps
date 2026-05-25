# Dialogs Review Submit Pending Boundary Check

## 1. Current Pending Setter Pattern

### `setLocationReportSubmitPending(isPending)`

- Pending-Variable:
  - `isLocationReportSubmissionPending = isPending`
- Form-Element:
  - `getLocationReportFormElement()`
- Formfelder:
  - `Array.from(formElement.elements)` + `fieldElement instanceof HTMLElement` + `fieldElement.disabled = isPending`
- Close-Button:
  - `#location-report-close` -> `disabled = isPending`
- Submit-Button:
  - kein Textwechsel
  - kein eigener `disabled`-Block hier (indirekt ueber Formfeld-Disable plus `updateLocationReportDialogAvailability`-Sonderlogik)

### `setLocationEditSubmitPending(isPending)`

- Pending-Variable:
  - `isLocationEditSubmissionPending = isPending`
- Form-Element:
  - `getLocationEditFormElement()`
- Formfelder:
  - gleiches Disable-Muster
- Close-Button:
  - `#location-edit-close` -> `disabled = isPending`
- Submit-Button:
  - `#location-edit-submit`
  - `textContent = isPending  "Speichert..." : "Speichern"`
  - `disabled = isPending`

### `setWikiSyncResolveSubmitPending(isPending)`

- Pending-Variable:
  - `isWikiSyncResolveSubmissionPending = isPending`
- Form-Element:
  - `getWikiSyncResolveFormElement()`
- Formfelder:
  - gleiches Disable-Muster
- Close-Button:
  - `#wiki-sync-resolve-close` -> `disabled = isPending`
- Submit-Button:
  - `#wiki-sync-resolve-submit`
  - `textContent = isPending  "Speichert..." : "Lösen"`
  - `disabled = isPending`

### `setPathEditSubmitPending(isPending)`

- Pending-Variable:
  - `isPathEditSubmissionPending = isPending`
- Form-Element:
  - `getPathEditFormElement()`
- Formfelder:
  - gleiches Disable-Muster
- Close-Button:
  - `#path-edit-close` -> `disabled = isPending`
- Submit-Button:
  - `#path-edit-submit`
  - `textContent = isPending  "Speichert..." : "Speichern"`
  - `disabled = isPending`

### `setPowerlineEditSubmitPending(isPending)`

- Pending-Variable:
  - `isPowerlineEditSubmissionPending = isPending`
- Form-Element:
  - `getPowerlineEditFormElement()`
- Formfelder:
  - gleiches Disable-Muster
- Close-Button:
  - `#powerline-edit-close` -> `disabled = isPending`
- Submit-Button:
  - `#powerline-edit-submit`
  - `textContent = isPending  "Speichert..." : "Speichern"`
  - `disabled = isPending`

Weitere aehnliche Pending-Funktionen:

- In diesem Cluster wurden nur die oben genannten 5 `set...SubmitPending`-Funktionen gefunden.
- Andere Pending-Variablen (z. B. `isChangeUndoPending`) existieren, sind aber kein analoger Form-/Dialog-Setter-Cluster.

## 2. Similarities

Gemeinsame Muster der 5 Fokusfunktionen:

- `isPending`-Zuweisung in eine spezifische globale Submission-Pending-Variable.
- Form per spezifischem Getter holen, bei fehlendem Form-Element frueher `return`.
- Formfelder iterieren mit:
  - `Array.from(formElement.elements)`
  - `instanceof HTMLElement`
  - `disabled = isPending`
- spezifischen Close-Button per ID holen und `disabled = isPending` setzen.
- in 4 von 5 Faellen zusaetzlich Submit-Button per ID holen und `disabled = isPending` setzen.
- in 4 von 5 Faellen Submit-Text zwischen Pending und Normaltext umschalten.

## 3. Differences / Edge Cases

- Location report Sonderfall:
  - kein expliziter Submit-Textwechsel im Setter.
  - spezieller Zusammenspielpunkt mit `updateLocationReportDialogAvailability()` (konfigurationsabhaengige Enable/Disable-Logik).
- WikiSyncResolve Sondertext:
  - Normaltext ist `"Lösen"` statt `"Speichern"`.
- Standardtext bei den anderen 3 Submit-Buttons:
  - `"Speichern"`.
- unterschiedliche Close-/Submit-IDs pro Dialog.
- damit nicht alle Teile in einen einzigen "alles-in-einem"-Helper ziehen, ohne Verhaltensrisiko.

## 4. Candidate Helper Boundaries

A. Helper nur fuer Form-Felder deaktivieren: `setFormFieldsDisabled(formElement, isPending)`

- sehr kleiner, klarer 1:1-Schnitt.
- geringes Risiko, da rein mechanischer gemeinsamer Teil.

B. Helper fuer Close-Button deaktivieren: `setElementDisabledById(elementId, isDisabled)`

- ebenfalls klein, aber geringer Mehrwert allein.

C. Kombinierter Helper fuer Form + Close + Submit: `setDialogSubmitPendingState(...)`

- groesserer Eingriff, mehr Parameter und Sonderfaelle (Location-Report, WikiSync-Text).
- hoehere Fehlerwahrscheinlichkeit.

D. Alle Pending-Funktionen unveraendert lassen

- sicherste Option, aber Duplikation bleibt.

## 5. Recommendation

Empfehlung: **A als kleinster sicherer Schnitt** (optional, spaeter).

- kleinster Diff
- keine Verhaltensaenderung
- keine API-/Submit-Handler-Logik
- oeffentliche Wrapper bleiben erhalten
- Buttontexte bleiben in Wrappern explizit und unveraendert

## 6. Exact Proposed Helper

Nahezu exakte Skizze (nicht umsetzen):

```js
function setFormFieldsDisabled(formElement, isPending) {
	Array.from(formElement.elements).forEach((fieldElement) => {
		if (fieldElement instanceof HTMLElement) {
			fieldElement.disabled = isPending;
		}
	});
}
```

Geplante Nutzung (ebenfalls nur skizziert):

- Jede der 5 Funktionen setzt weiter **ihre eigene** globale Pending-Variable.
- Jede Funktion holt weiter **ihr eigenes** Form-Element per bestehendem Getter.
- Nach dem Guard (`if (!formElement) return;`) wird nur der iterierende Disable-Block durch `setFormFieldsDisabled(formElement, isPending)` ersetzt.
- Close-/Submit-Button-Logik inkl. Texte bleibt je Wrapper unveraendert lokal.

## 7. Risk Assessment

- doppelte Submit-Vermeidung:
  - darf nicht beeinflusst werden; Pending-Variablen und Disabled-States muessen identisch bleiben.
- disabled-Zustaende:
  - Formfelder, Close-Buttons, Submit-Buttons muessen weiterhin exakt wie bisher geschaltet werden.
- Close-Button waehrend Submit:
  - muss weiterhin deaktiviert bleiben.
- Submit-Button-Texte:
  - `"Speichert..."`, `"Speichern"`, `"Lösen"` muessen unveraendert bleiben.
- WikiSyncResolve-Sondertext:
  - darf keinesfalls vereinheitlicht werden.
- LocationReport-Sonderlogik:
  - kein Submit-Textwechsel im Setter; Zusammenspiel mit `updateLocationReportDialogAvailability` bleibt unberuehrt.
- Fehlerfall Form fehlt:
  - fruehes `return` muss unveraendert bleiben.
- Statusmeldungen nach Submit:
  - duerfen nicht betroffen sein.
- keine API-/Review-/Wiki-Sync-Seiteneffekte:
  - muss strikt gewahrt bleiben.

## 8. Next Safe Commit

Falls spaeter umgesetzt:

- nur `js/dialogs-review.js`
- genau ein sehr kleiner Helper: `setFormFieldsDisabled(formElement, isPending)`
- nur die 5 Fokusfunktionen intern auf diesen einen Teil umstellen
- keine Aufrufer aendern
- keine Submit-Handler aendern
- keine API-Calls aendern

Wenn vorerst kein Code:

- Bereich stabil lassen und als naechste Analyse den Dialog-Open/Close-Block gegenueber Pending-Zustaenden (nur Doku) untersuchen.
