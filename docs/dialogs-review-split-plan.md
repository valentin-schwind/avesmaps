# Dialogs Review Split Plan

## 1. Current File Responsibilities

`js/dialogs-review.js` (ca. 5400+ Zeilen) vereint aktuell mehrere Subsysteme:

- DOM-Getter/Grundhelper:
  - viele `get...Element`-Funktionen fuer Overlays, Formulare, Statusfelder.
- Status helper/status setter:
  - `setDialogStatus(...)` fuer `dataset.status`
  - `setPanelStateStatus(...)` fuer `dataset.state`
  - Wrapper fuer Dialog-/Panel-Status.
- Submit-/Pending-Setter:
  - `setLocationReportSubmitPending`, `setLocationEditSubmitPending`, `setWikiSyncResolveSubmitPending`, `setPathEditSubmitPending`, `setPowerlineEditSubmitPending`.
- Location report/edit dialogs:
  - Open/Close, Populate, Reset, Submit und zugehoerige UI-/Statuslogik.
- Path edit dialogs:
  - Populate/Open/Submit/Reset inkl. Transportoptionen fuer Pfade.
- Powerline edit dialogs:
  - Populate/Open/Submit/Reset.
- Label/Region edit dialogs:
  - Label-Edit-Flow, Region-Edit-Flow, umfangreiche Region-/Territory-Hilfsfunktionen.
- Wiki sync:
  - Case-Rendering, Filter, Aktionen, Resolve-Flow, Panelzustand.
- Review/change/presence panels:
  - Tabs, Status, Refresh-Logik, Presence-Heartbeat.
- API-nahe Aufrufe:
  - Aufrufer fuer `submitMapFeatureEdit`, `submitPoliticalTerritoryEdit`, Wiki-Sync-Aktionen, Review-/Presence-Endpunkte.
- Initialisierung/Event-Binding:
  - zahlreiche Listener und zeit-/zustandsgetriebene UI-Aktualisierungen.

## 2. Global Surface

### Sicher extern genutzt

Diese Funktionen werden nachweisbar ausserhalb von `js/dialogs-review.js` verwendet:

- `setRegionEditStatus`
- `setRegionEditDialogOpen`
- `setLabelEditDialogOpen`
- `setPowerlineEditDialogOpen`
- `setPathEditDialogOpen`
- `setLocationEditDialogOpen`
- `setLocationReportDialogOpen`
- `setRegionWikiPickerDialogOpen`
- `openLocationEditDialog`
- `openLabelEditDialog`
- `openPathEditDialog`
- `openRegionEditDialog`
- `openPowerlineEditDialog`
- `setEditorPanelTab`
- `setWikiSyncPanelTab`
- `setWikiSyncStatus`
- `syncPathTransportOptions`
- `syncPathAutoNameControls`
- `getDefaultTransportDomainForPathSubtype`

### Wahrscheinlich extern genutzt

- weitere `open...Dialog`, `is...DialogOpen`, `reset...Form`, `set...Status`-Funktionen, die als globale UI-API fungieren.
- einige Review-/Wiki-Sync-Funktionen koennen indirekt durch andere globale Flows genutzt werden.

### Vermutlich nur intern

- viele Normalisierungs-/Render-/Hilfsfunktionen (z. B. Tree-/Breadcrumb-/Formatting-Helfer) ohne Treffer ausserhalb der Datei.

## 3. Internal Dependencies

Wesentliche Abhaengigkeiten zwischen Gruppen:

- Getter/DOM-Helper sind Fundament fuer fast alle Gruppen.
- Statusfunktionen werden breit von Submit-/Dialog-/Wiki-Sync-/Panel-Logik genutzt.
- Pendingfunktionen steuern direkt Open/Close-Sperren (`set...DialogOpen` prueft `is...SubmissionPending`).
- Dialog-Populate/Reset/Submit-Funktionen teilen globale Zustandsvariablen (aktive Eintraege, IDs, Selection-Status).
- Region-/Territory-Subsystem haengt stark intern zusammen (Tree, Drafts, Tabs, Assignment, Render).
- Wiki-Sync-Subsystem haengt stark intern zusammen (Filter, Cases, Actions, Resolve, Panelstatus).
- Panelfunktionen (`setEditorPanelTab`, `setWikiSyncPanelTab`, refresh/sync) werden auch ausserhalb genutzt.

## 4. Candidate Split Files

Vorschlag fuer spaeteren Split (klassische globale Scripts, keine Module):

- `js/dialogs-review-core.js`
  - DOM-Getter + einfache Basishelper + gemeinsame Status/Pending-Basishelper.
  - Abhaengigkeiten: nur DOM, jQuery, globale Konstanten.
  - Lade-Reihenfolge: frueh (vor allen weiteren dialogs-review-Teilen).
  - Risiko: niedrig bis mittel.

- `js/dialogs-review-status.js`
  - `setDialogStatus`, `setPanelStateStatus` + zugehoerige Wrapper.
  - Abhaengigkeiten: Getter aus `dialogs-review-core.js`.
  - Lade-Reihenfolge: nach `dialogs-review-core.js`, vor Subsystemen.
  - Risiko: niedrig.

- `js/dialogs-review-pending.js`
  - `setFormFieldsDisabled` + `set...SubmitPending`.
  - Abhaengigkeiten: Getter + globale Pending-Variablen + Statussetter.
  - Lade-Reihenfolge: nach core/status, vor Dialog-Open/Close.
  - Risiko: mittel.

- `js/dialogs-review-location.js`
  - Location report/edit + Label/Path/Powerline einfache Dialogflows.
  - Abhaengigkeiten: status/pending/core + API-Helper.
  - Lade-Reihenfolge: nach core/status/pending.
  - Risiko: mittel.

- `js/dialogs-review-region.js`
  - Region-/Territory-Edit-Subsystem.
  - Abhaengigkeiten: sehr hoch intern + externe Integrationen.
  - Lade-Reihenfolge: spaeter, nach core/status/pending.
  - Risiko: hoch.

- `js/dialogs-review-wiki-sync.js`
  - Wiki-Sync-Cases, Filter, Resolve-Actions.
  - Abhaengigkeiten: status/panel/API + map/review hooks.
  - Lade-Reihenfolge: nach core/status/pending.
  - Risiko: hoch.

- `js/dialogs-review-panels.js`
  - Review/change/presence panel switching/status/refresh.
  - Abhaengigkeiten: wiki-sync/location subsystems.
  - Lade-Reihenfolge: spaeter, vor finalem init.
  - Risiko: mittel bis hoch.

- `js/dialogs-review-init.js`
  - gebuendelte Event-Bindings/Startup fuer dialogs-review.
  - Abhaengigkeiten: alle oben.
  - Lade-Reihenfolge: zuletzt im dialogs-review-Block.
  - Risiko: hoch.

## 5. Safest First Move

Sicherster erster spaeterer Code-Schritt:

- nur den bereits stabilisierten Status-Cluster in eine neue Datei auslagern, z. B. `js/dialogs-review-status.js`:
  - `setDialogStatus`
  - `setPanelStateStatus`
  - alle zugehoerigen Status-Wrapper
- `index.html` um genau einen zusaetzlichen Script-Tag erweitern, der **vor** dem verbleibenden `js/dialogs-review.js` geladen wird.
- keine Funktionsumbenennung, keine Aufruferaenderung.

Warum dieser Schritt am sichersten ist:

- sehr kleiner, klar abgegrenzter Block
- bereits als eigenstaendige Cluster stabilisiert
- geringe Seiteneffekte im Vergleich zu Wiki-Sync/Region/Init-Splits

## 6. Moves To Avoid For Now

- API-/Submit-Handler direkt als erstes auslagern.
- Wiki-Sync-Monolith frueh verschieben.
- Initialisierung/Event-Binding frueh verschieben.
- globale Pending-/Flow-Variablen in separaten Schritt verschieben.
- mehrere Subsysteme in einem Commit auslagern.

## 7. Proposed Migration Sequence

1. **Status-Cluster-Split**
   - `dialogs-review-status.js` anlegen, nur Status-Cluster verschieben.
   - Script-Reihenfolge in `index.html`: `dialogs-review-status.js` vor `dialogs-review.js`.

2. **Pending-Cluster-Split**
   - nur `setFormFieldsDisabled` + `set...SubmitPending` in `dialogs-review-pending.js` verschieben.
   - laden vor verbleibendem `dialogs-review.js`.

3. **Stopppunkt dokumentieren**
   - Status + Pending als eigener stabiler Unterbau dokumentieren.

4. **Location/Path/Powerline-Subcluster einzeln vorbereiten**
   - erst Analyse, dann kleiner Move.

5. **Region und Wiki-Sync separat und spaet**
   - nur nach gesonderter Analyse und dediziertem Smoke-Zyklus.

## 8. Smoke-Test Requirements

Pro Split mindestens:

- Status-Cluster-Split:
  - Dialog-Statusmeldungen (dataset.status) + Panel-Statusmeldungen (dataset.state) fuer alle betroffenen Dialoge/Panels.

- Pending-Cluster-Split:
  - alle 5 Submit-Pending-Flows: Formfelder disabled/enabled, Close disabled/enabled, Submit disabled/enabled, Textwechsel (`Speichert...`, `Speichern`, `Lösen`).

- Location/Path/Powerline-Split:
  - Dialog oeffnen/befuellen/speichern/abbrechen; keine Konsolenfehler.

- Region-Split:
  - Region-Dialog, Tab-/Assignment-Flow, Parent-/Wiki-Referenz-Flow, Save/Delete.

- Wiki-Sync-Split:
  - Filter, Case-Render, Resolve-Flow, Panelstatus, Aktionen.

- Panel/Init-Split:
  - Review/change/presence tab switching, visibility sync, startup listeners einmalig und korrekt.

## 9. Recommendation

Empfehlung: **kontrollierter Datei-Split ist sinnvoll, aber nur in sehr kleinen, klar getrennten Mini-Schritten**.

- Weiter nur lokale Mini-Extracts in derselben Datei bringen zunehmend weniger Strukturgewinn.
- Der erste Split sollte auf den bereits stabilisierten Status-Cluster begrenzt bleiben.
- Danach jeweils nur ein Subsystem pro Commit verschieben und nach jedem Schritt gezielt smoke-testen.
