# Dialogs Review State Status Plan

## 1. Current State Status Pattern

Die vier Fokusfunktionen folgen aktuell demselben Muster:

- `setReviewPanelStatus(message, state = "")`
- `setChangePanelStatus(message, state = "")`
- `setPresencePanelStatus(message, state = "")`
- `setWikiSyncStatus(message, state = "")`

Gemeinsamer Ablauf:

1. jeweiliges Status-Element per `document.getElementById(...)` holen
2. bei fehlendem Element sofort `return`
3. `statusElement.textContent = message || ""`
4. `statusElement.dataset.state = state`

## 2. Differences From setDialogStatus

Wesentliche Unterschiede zu `setDialogStatus(statusElement, message = "", type = "")`:

- `dataset.state` statt `dataset.status`.
- `message || ""` statt direktem `message`.
- direkte Elementsuche pro Funktion per `document.getElementById(...)` (kein vorgeschalteter Getter).
- Signatur nutzt `message` ohne Default, aber mit Fallback beim Schreiben (`message || ""`).
- `state` wird immer gesetzt (auch leer), waehrend `setDialogStatus` bei leerem `type` `dataset.status` explizit loescht.

Warum diese Funktionen nicht in `setDialogStatus` gehoeren:

- unterschiedliche Daten-Semantik (`state` vs `status`).
- unterschiedliches Verhalten bei leeren Werten (setzen vs loeschen).
- ein gemeinsamer Mega-Helper wuerde zwei unterschiedliche UI-Vertragsformen vermischen.

## 3. Candidate Helper

Moeglicher separater Helper:

- `setPanelStateStatus(statusElement, message = "", state = "")`

Beispielhafte Zielnutzung (spaeter, nicht jetzt):

- jeder Wrapper holt weiterhin sein eigenes Element
- danach Delegation an `setPanelStateStatus(...)`

So bleibt der `dataset.state`-Pfad klar vom `dataset.status`-Pfad getrennt.

## 4. Safety Assessment

- Exaktheit:
  - die vier Fokusfunktionen sind verhaltensgleich aufgebaut und koennen sicher gemeinsam kapselbar sein.
- Nutzen:
  - kleine Duplikationsreduktion.
- Risiko:
  - niedrig, **wenn** nur diese vier Funktionen umgestellt werden und `setDialogStatus` unveraendert bleibt.
- Gesamtabwaegung:
  - technisch sicher machbar, aber geringer funktionaler Mehrwert; deshalb nur als optionaler Mini-Schritt.

## 5. Recommendation

Empfehlung: **kein sofortiger Code-Schritt**.

- Ein separater `dataset.state`-Helper ist grundsaetzlich sinnvoll, aber nur mit kleinem Nutzen.
- Nach den juengsten Refactorings ist ein kurzes Stabilitaetsfenster sinnvoller.
- Falls direkt weitergemacht werden soll, dann nur als sehr enger 1-Commit-Extract ohne weitere Bereiche zu beruehren.

## 6. Next Safe Commit

Falls spaeter umgesetzt, kleinster sicherer Schritt:

- nur `js/review/review-region-util.js` aendern
- neuen Helper `setPanelStateStatus(statusElement, message = "", state = "")` einfuegen
- nur diese vier Wrapper intern delegieren:
  - `setReviewPanelStatus`
  - `setChangePanelStatus`
  - `setPresencePanelStatus`
  - `setWikiSyncStatus`
- `setDialogStatus` nicht aendern
- `dataset.status`-Funktionen nicht aendern
- keine API-/Review-/Wiki-Sync-/Submit-/Pending-Logik anfassen
