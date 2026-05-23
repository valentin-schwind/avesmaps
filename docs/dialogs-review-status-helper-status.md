# Dialogs Review Status Helper Status

## 1. Current Split

- `setDialogStatus(statusElement, message = "", type = "")` kapselt jetzt den gemeinsamen `dataset.status`-Setter-Teil.
- Folgende sieben Wrapper delegieren auf den Helper und bleiben als oeffentliche Einstiegspunkte erhalten:
  - `setLocationReportStatus`
  - `setLocationEditStatus`
  - `setWikiSyncResolveStatus`
  - `setPathEditStatus`
  - `setPowerlineEditStatus`
  - `setLabelEditStatus`
  - `setRegionEditStatus`
- Bewusst nicht einbezogen wurden die `dataset.state`-Statusfunktionen:
  - `setReviewPanelStatus`
  - `setChangePanelStatus`
  - `setPresencePanelStatus`
  - `setWikiSyncStatus`

## 2. What Improved

- Entfernte Duplikation:
  - das zuvor siebenfach wiederholte Muster (Element pruefen, `textContent`, `dataset.status` setzen/loeschen) ist zentralisiert.
- Erhaltene oeffentliche Wrapper-Namen:
  - alle bisherigen `set*Status`-Namen fuer Dialoge bleiben unveraendert nutzbar.
- Erhaltene Getter-Logik:
  - jeder Wrapper ruft weiterhin seinen spezifischen Getter (`get...StatusElement`) auf.
- Erhaltenes `dataset.status`-Verhalten:
  - `type` truthy -> `statusElement.dataset.status = type`
  - `type` falsy -> `delete statusElement.dataset.status`
  - fehlendes Element -> frueher Abbruch bleibt erhalten.

## 3. Remaining Candidate Areas

A. Submit-Pending-Setter-Cluster

- Potenzial: mehrere `set...SubmitPending`-Funktionen zeigen aehnliche Muster.
- Risiko: mittel, da dort Button-Texte, Disabled-Zustaende und Form-Elemente kombiniert werden.

B. Dialog-Open/Close-Helper

- Potenzial: `set...DialogOpen`-Funktionen sind strukturell aehnlich.
- Risiko: mittel bis hoch wegen Fokussteuerung, Reset-Optionen und Overlay-Zustand.

C. Form-Reset-Helper

- Potenzial: `reset...Form`-Funktionen enthalten wiederkehrende Reset-Schritte.
- Risiko: mittel bis hoch wegen fachlich unterschiedlicher Felder/Seiteneffekte.

D. `dataset.state`-Statusfunktionen separat betrachten

- Potenzial: kleines eigenes Mini-Cluster.
- Risiko: niedrig bis mittel, aber getrennt vom `dataset.status`-Cluster behandeln.

E. `dialogs-review.js` vorerst stabil lassen

- Potenzial: maximale Stabilitaet nach frischem Refactoring.
- Risiko: niedrig.

## 4. Recommendation

Empfehlung: **E. `dialogs-review.js` vorerst stabil lassen.**

Begruendung:

- die letzte Aenderung war klein und erfolgreich, daher zuerst Stabilitaetsfenster.
- groessere Mischbereiche (Pending/Open-Close/Reset) sollten nicht direkt im Anschluss geoeffnet werden.
- so bleibt die lauffaehige Version mit minimaler Regressionflaeche erhalten.

## 5. Risk Assessment

- Statusmeldungen:
  - muessen weiterhin exakt im passenden Dialog erscheinen.
- `dataset.status` vs `dataset.state`:
  - Cluster duerfen nicht vermischt werden.
- Submit-/Pending-Zustaende:
  - beeinflussen Disabled-Logik und Button-Texte.
- Dialog-Open/Close:
  - umfasst Fokus, Overlay-Sichtbarkeit und Form-Reset.
- Review-Panel/Wiki-Sync:
  - haben eigene UI-Zustaende mit separaten Statusfunktionen.
- Edit-Dialoge:
  - sind fachlich unterschiedlich und reagieren sensibel auf kleine Seiteneffekte.

## 6. Next Safe Commit

Kein unmittelbarer Code-Schritt empfohlen.

Naechster sinnvoller Analysebereich:

- `dataset.state`-Statusfunktionen als eigenes Mini-Assessment dokumentieren (nur Doku), um zu entscheiden, ob dort ein analoger kleiner Helper sinnvoll und risikolos ist.
