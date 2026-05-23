# UI Controls Transport Menu Boundary Check

## 1. Current Responsibilities

Der Transport-Menu-/Combobox-Bereich in `js/ui-controls.js` verantwortet aktuell:

- Oeffnen/Schliessen der Menues (`setTransportMenuOpen`, `closeTransportMenu`, `closeAllTransportMenus`).
- Menuepositionierung relativ zum Trigger-Button (`positionTransportMenu`, `positionOpenTransportMenus`).
- Keyboard-Handling fuer Button und Menue (`handleTransportButtonKeydown`, `handleTransportMenuKeydown`).
- Focus-Handling (insb. Fokus auf aktive Option und Ruecksprung auf Button).
- Sync von Icon/Label/ARIA-Selection mit dem zugrunde liegenden Select (`syncTransportControl`).
- jQuery-Select-Change-Sync inklusive `trigger("change")` bei Klick auf Menueoption.
- globale Listener auf `document`/`window` (Outside Click, Resize, Scroll).

## 2. Event Flow

- Button click:
  - toggelt Menuezustand (`hidden`), schliesst andere Menues, positioniert, setzt bei geoeffnetem Menue Fokus auf aktive Option.
- Button keydown:
  - bei `ArrowDown/ArrowUp/Enter/Space` Menue oeffnen + Fokus auf aktive Option.
- Menu click:
  - Option ermitteln, bei gueltiger Option Select-Wert setzen, `.trigger("change")`, Menue schliessen, Fokus zurueck auf Button.
- Menu keydown:
  - `Escape`: schliessen + Fokus auf Button
  - `Enter/Space`: aktive Option klicken
  - `Home/End`: erster/letzter Option-Button
  - `ArrowDown/ArrowUp`: zyklische Navigation.
- Select change:
  - pro Select-ID `syncTransportControl(selectId)`.
- Outside click:
  - Klick ausserhalb `.transport-icon-select` schliesst alle Menues.
- Resize/scroll repositioning:
  - bei `window.resize` und `#search`-Scroll offene Menues neu positionieren.

## 3. State / DOM Dependencies

- Konstanten/Globals:
  - `ICON_TRANSPORT_SELECT_IDS`
  - `TRANSPORT_ICON_PATHS`
  - `DEFAULT_PLANNER_STATE`
  - `setVersionedIconSource(...)`
- DOM-Struktur:
  - IDs der Selects (per `selectId`)
  - Klassen: `.transport-icon-select`, `.transport-combobox`, `.transport-combobox__menu`, `.transport-combobox__option`, `.transport-option-inline-icon`, `.transport-combobox__label`.
- jQuery-Abhaengigkeit:
  - `$(`#${selectId}`).val(...).trigger("change")`
- ARIA:
  - `aria-expanded` am Button
  - `aria-selected` an Optionsbuttons
  - `role="option"`.
- Sichtbarkeit/Fokus:
  - `menuElement.hidden`
  - `.focus()` auf Option/Button.

## 4. Candidate Helper Boundaries

A. Positionierungslogik extrahieren/aendern

- technisch moeglich, aber hoher Layout-/Viewport-Randfall-Anteil.

B. Keyboard-Navigation extrahieren/aendern

- hoher Interaktions-/Accessibility-Risikohebel; kleine Fehler sofort sichtbar.

C. Option-Button-Erstellung weiter kapseln

- bereits relativ gut gekapselt (`createTransportOptionButton`); geringer Zusatznutzen.

D. Event-Binding-Block in `initializeTransportIconSelect` kapseln

- sinnvollster Mini-Kandidat: nur Registrierung der drei Listener (Button click/keydown, Menu click/keydown) in einen lokalen Helper extrahieren.
- moeglich als 1:1-Extract ohne Aenderung von Handler-Reihenfolge oder Semantik.

E. Transport-Menu-Bereich vorerst stabil lassen

- konservativste Option nach juengsten Refactorings in anderen Bereichen.

## 5. Risk Assessment

- Fokusverlust:
  - Gefahr bei Aenderungen in open/close/escape/select-Flow.
- Keyboard-Navigation:
  - Home/End/Arrow-Zyklen sind fehleranfaellig.
- Screenreader-/ARIA-Verhalten:
  - `aria-expanded`/`aria-selected` muessen konsistent bleiben.
- Menueposition bei Scroll/Resize:
  - empfindlich bei viewportnahen Positionen.
- Change-Event fuer Routing-Neuberechnung:
  - `.trigger("change")` darf nicht entfallen/verschoben werden.
- Mobile/Touch-Klicks:
  - outside-click-close und toggle muessen robust bleiben.
- Outside-click-close:
  - darf offene Menues weder zu aggressiv noch zu spaet schliessen.

## 6. Recommendation

Empfehlung: **E vorerst stabil lassen, danach nur den Mini-Schnitt D vorbereiten/umsetzen.**

Konkret als naechster Schritt jetzt: kein weiterer Code ohne neuen, engen Commit-Scope.

Begruendung:

- Transport-Combobox ist stark interaktiv und regressionssensibel.
- Ein Code-Schritt ist moeglich, aber sollte als strikter 1:1-Extract in separatem Commit erfolgen, nicht kombiniert mit anderen Anpassungen.

## 7. Next Safe Commit

Falls als spaeterer Code-Schritt umgesetzt:

- nur `js/ui-controls.js`
- genau ein lokaler Helper, z. B. `bindTransportControlEvents(control, selectId)`
- Inhalt: nur bestehende Listener-Registrierungen aus `initializeTransportIconSelect` 1:1 verschieben
- keine Handler-Logik aendern

Erforderliche Smoke-Faelle:

1. Menue pro Transport-Select per Klick oeffnen/schliessen.
2. Arrow/Enter/Space/Escape/Home/End im Menue pruefen.
3. Option per Klick waehlen -> Select-Wert aendert sich, Menue schliesst, Fokus springt zurueck.
4. Outside-Click schliesst Menue.
5. Resize + `#search`-Scroll repositionieren offene Menues korrekt.
6. Icon/Label/ARIA (`aria-expanded`, `aria-selected`) bleiben konsistent.
7. Keine neuen Konsolenfehler.
