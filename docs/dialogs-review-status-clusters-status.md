# Dialogs Review Status Clusters Status

## 1. Current Split

In `js/dialogs-review.js` sind die Status-Setter jetzt in zwei klar getrennte Helper-Cluster aufgeteilt:

- `setDialogStatus(statusElement, message = "", type = "")`
  - fuer Dialog-Status mit `dataset.status`.
- `setPanelStateStatus(statusElement, message = "", state = "")`
  - fuer Panel-Status mit `dataset.state`.

## 2. Wrapper Coverage

`dataset.status`-Cluster (ueber `setDialogStatus`):

- `setLocationReportStatus`
- `setLocationEditStatus`
- `setWikiSyncResolveStatus`
- `setPathEditStatus`
- `setPowerlineEditStatus`
- `setLabelEditStatus`
- `setRegionEditStatus`

`dataset.state`-Cluster (ueber `setPanelStateStatus`):

- `setReviewPanelStatus`
- `setChangePanelStatus`
- `setPresencePanelStatus`
- `setWikiSyncStatus`

## 3. Boundary Quality

Was besser geworden ist:

- gemeinsame Setter-Logik ist je Semantik-Cluster zentralisiert.
- redundanter Code in beiden Clustern wurde reduziert.
- beide Statuswelten sind sauber getrennt und leichter wartbar.

Warum `dataset.status` und `dataset.state` getrennt bleiben sollen:

- sie adressieren unterschiedliche UI-Vertraege (Dialogstatus vs Panelzustand).
- unterschiedliche Attributnamen sind explizit und fachlich aussagekraeftig.
- ein gemeinsamer "Mega-Helper" wuerde Semantiken vermischen und spaetere Fehler beguenstigen.

Warum oeffentliche Wrapper-Namen erhalten bleiben sollen:

- Aufrufer bleiben stabil.
- Lesbarkeit im Fachkontext bleibt hoch (intention-revealing names).
- spaetere interne Aenderungen bleiben lokal hinter der bestehenden API.

## 4. Areas To Leave Stable

- Submit-/Pending-Setter
- API-/Review-Logik
- Wiki-Sync-Logik
- Dialog-Open/Close
- Form-Reset-/Validation-Logik

## 5. Risk Assessment

- Statusmeldungen:
  - muessen weiterhin im richtigen Zielbereich landen (Dialog vs Panel).
- `dataset.status` vs `dataset.state`:
  - darf nicht vermischt oder umgedeutet werden.
- Review-/Change-/Presence-/Wiki-Sync-Panels:
  - Panel-Status muss weiterhin stabil aktualisiert/geleert werden.
- Dialog-Statusmeldungen:
  - bestehende Dialogfluesse (pending/success/error) duerfen keine Seiteneffekte bekommen.

## 6. Recommendation

- `dialogs-review.js` vorerst stabil lassen.
- kein direkter weiterer Code-Schritt.
- falls spaeter weitergemacht wird: zuerst klar abgegrenzten Subbereich analysieren (z. B. Submit-/Pending-Setter-Cluster), dann erst ueber Mini-Extract entscheiden.

## 7. Next Safe Step

Naechster sicherer Schritt als reine Analyse:

- `docs/dialogs-review-submit-pending-boundary-check.md` erstellen, mit Fokus auf Gemeinsamkeiten/Unterschiede der `set...SubmitPending`-Funktionen und strengem Verhaltensschutz.
