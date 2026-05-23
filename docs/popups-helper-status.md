# Popups Helper Status

## 1. Current Split

- `popupActionButtonMarkup(...)`:
  - erzeugt ein einzelnes Button-Markup mit optionaler Klasse und Attributen.
- `locationPopupActionsMarkup(...)`:
  - kapselt ein Array von Action-Buttons in den Popup-Actions-Container.
- `pathCreationActionButtonsMarkup(publicId)`:
  - liefert den Pfad-Aktionsblock als Button-Markup-Array abhaengig von `pendingPathCreationStart`.
- `locationActionsMarkup(name, publicId, location)`:
  - baut die Ortsaktionen (Route, Pfad, ggf. Powerline, Edit/Delete) auf.
- `crossingActionsMarkup(name, publicId)`:
  - baut die Kreuzungsaktionen inkl. Pfad-/Powerline-/Edit/Delete auf.
- `labelActionsMarkup(publicId)`:
  - baut die Labelaktionen inkl. optionaler Powerline-Aktion auf.

## 2. What Improved

- Entfernte Duplikation:
  - der zuvor doppelte Pfad-Aktionsblock (Weiterfuehren/Abschliessen vs. Neuer Weg) wurde zentral in `pathCreationActionButtonsMarkup(publicId)` gebuendelt.
- Gemeinsame Call-Sites:
  - `locationActionsMarkup` nutzt jetzt denselben Pfad-Helper.
  - `crossingActionsMarkup` nutzt jetzt denselben Pfad-Helper.
- Warum verhaltensneutral:
  - gleiche Labels, gleiche `data-popup-action`-Werte, gleiche `data-public-id`-Nutzung, gleiche Reihenfolge, gleiche Bedingung (`pendingPathCreationStart`).

## 3. Remaining Duplication / Candidate Helpers

A. Powerline-Action-Button-Helper

- Beobachtung:
  - der Powerline-Button (`Kraftlinie abschliessen` / `Neue Kraftlinie`) wird in mehreren Action-Funktionen aehnlich gebaut.
- Nutzen:
  - kleine Reduktion von Wiederholungen.
- Risiko:
  - mittel, weil Eligibility-Logik je Kontext unterschiedlich bleibt (Location/Crossing/Label).

B. Danger/Delete-Button-Helper

- Beobachtung:
  - Delete-Buttons sind aehnlich strukturiert.
- Nutzen:
  - gering bis mittel.
- Risiko:
  - mittel, da `data-*` Attribute je Entitaet variieren und keine Reihenfolge veraendert werden darf.

C. Edit/details Button-Helper

- Beobachtung:
  - Edit-/Details-Buttons aehneln sich in Aufbau.
- Nutzen:
  - gering.
- Risiko:
  - mittel, da unterschiedliche Action-Kombinationen und Attribute je Popup-Typ bestehen.

D. `popups.js` vorerst stabil lassen

- Nutzen:
  - hoechste Stabilitaet direkt nach einem frischen 1:1-Extract.
- Risiko:
  - niedrig.

## 4. Recommendation

Empfehlung: **D. `popups.js` vorerst stabil lassen.**

Begruendung:

- lauffaehige Version hat Prioritaet
- der letzte Schritt hat genau den kleinsten sicheren Duplikationsblock adressiert
- weitere Micro-Extracts in Popups beruehren schnell viele aehnliche, aber nicht identische Attribute
- so bleibt das Risiko fuer UI-Texte, Action-Werte und Reihenfolgen minimal

## 5. Risk Assessment

- Editmode-Popups:
  - Actions muessen in allen Modi identisch bleiben.
- Location vs Crossing vs Label:
  - jede Variante hat eigene Kombinationen aus Aktionen und Attributen.
- Powerline eligibility:
  - Entscheidung basiert auf Endpoint-Eignung; darf nicht versehentlich vereinheitlicht werden.
- `pendingPathCreationStart`:
  - steuert den Pfad-Button-Switch (1 vs 2 Buttons).
- `pendingPowerlineCreationStart`:
  - steuert den Powerline-Button-Text und die Action.
- Button-Reihenfolge:
  - ist fachlich relevant fuer Bedienbarkeit und Erwartung.
- Button-Texte:
  - duerfen fuer verhaltensneutrale Schritte nicht geaendert werden.
- `data-public-id`:
  - muss in jeder Aktion unveraendert korrekt gesetzt bleiben.

## 6. Next Safe Commit

Kein sofortiger Code-Schritt empfohlen.

Naechster Analyse-/Doku-Schritt:

- `docs/popups-powerline-helper-check.md` erstellen, um **nur** den Powerline-Button-Block auf einen moeglichen 1:1-Helper zu pruefen (ohne Umsetzung), inklusive exakter Invarianten fuer Labels, Actions, Reihenfolge und Eligibility.
