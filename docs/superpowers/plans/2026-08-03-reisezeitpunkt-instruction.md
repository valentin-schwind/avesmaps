# Reisezeitpunkt — Umsetzungsanweisung

**Entwurf:** `docs/superpowers/specs/2026-08-03-reisezeitpunkt-design.md` — **zuerst ganz lesen.**
Diese Datei sagt, in welcher Reihenfolge gebaut und woran jeder Schritt geprüft wird.

**Vor Phase 1 die fünf offenen Punkte aus Entwurf §7 vom Owner bestätigen lassen.** Phase 1 und 2
hängen an der Bänder-Tabelle, Phase 3 an der Pass/Rabenpass-Frage, Phase 4 an der Entscheidung zu
§6. Ohne diese Antworten baut man an Zahlen, die nachher wieder herausfallen.

---

## Was schon da ist (nicht neu erfinden)

| Sache | Ort |
|---|---|
| Einklappbare Einstellgruppen | `js/map-features/map-features-planner-groups.js`, `css/features/route-planner.css` (Abschnitt „Einklappbare Einstellgruppen") |
| Die Optionsgruppe entsteht zur Laufzeit | `enhanceRoutePlannerOptionPanel()` in `js/map-features/map-features-waypoints.js` |
| Muster für den Infodialog | `js/routing/transport-speed-info.js` (195 Z.), `css/features/transport-speed-info.css`, Overlay `.tsi-overlay`, Auslöser `#transport-info-btn` |
| Wegeigenschaften je Weg, Lese-/Schreibseite | `avesmapsReadAllowedTransports` in `api/_internal/map/features.php`, Client `js/map-features/map-features-path-domain.js:216` |
| Sync-Editor „Wege bearbeiten" | `html/wege-editor.html`, `js/pages/wege-editor.js` (Haken ~Z. 310, Entwurf ~Z. 400, Speicher-Nutzlast ~Z. 437) |
| Karten-Editor „Weg bearbeiten" | `js/review/review-paths.js` (~Z. 45–63) |
| Schreib-Endpunkt Wege | `api/edit/map/paths-editor.php` |
| Wegtyp-Geschwindigkeiten (beide Engines) | `api/_internal/routing/client-graph.php` ab Z. 42 |
| Geländefaktoren, in die sich der Saisonfaktor einreiht | `api/_internal/app/terrain-store.php`, Entwurf `docs/oekosystem-feature-design.md` §4 |
| Zahlenformat | `formatDecimalNumber()` in `js/app/utils.js` — 💣 nie `toFixed` |
| i18n | `tr()` / `data-i18n`, Tabelle `js/app/i18n-en.js`. Monatsnamen sind Domäneninhalt und werden **nie** übersetzt (AGENTS §2). |

**Ein bedienbares Mockup existiert** (Sitzung 2026-08-03, im Scratchpad
`reisemonat-mockup.html` samt Bauskript `build_monat2.py`). Es zeigt Anordnung, Klappzeile,
mitlaufenden Kalender und die Ausgabe im Reiseplan. ⚠️ Seine **Prozentwerte sind überholt** —
es rechnet mit erfundenen Aufschlägen, der Entwurf §1.1 rechnet mit den Bodenabzügen der Quelle.
Optik übernehmen, Arithmetik nicht.

---

## Phase 1 — Der Reisebeginn im Panel (ohne Wirkung)

Ziel: die Zeile steht, der Zustand reist im Link mit, gerechnet wird noch nichts.

1. **Beide Optionszeilen auf „Beschriftung zuerst" umstellen** (Owner 2026-08-03):
   `Reisestunden pro Tag: [12,0]` und `Reisebeginn: [25] [Firun (Winter) ▾]`. Die Stundenzeile
   steht in `index.html`; die Beschriftung wandert vor das Feld, der i18n-Schlüssel
   `planner.travelHoursSuffix` wird dabei zu einem Präfix — **Schlüsselnamen mitziehen oder
   bewusst behalten und im Kommentar begründen.**
2. Monatswahl + Tagesfeld als dritte Zeile. Zwölf Monate, Vorauswahl **„Ohne Jahreszeit — kein
   Einfluss"**.
3. Die Klappzeile der Gruppe nennt den Reisebeginn mit — sie wird in
   `map-features-planner-groups.js` aus dem gerenderten Markup gelesen, also genügt es, das
   Markup richtig zu bauen. 💣 Die Zusammenfassung dort liest **keine** eigene Textliste;
   nichts hart eintragen.
4. Zustand in den Teilen-Link, wie `pathType` in
   `js/map-features/map-features-layer-state.js:245`.

**Prüfen:** Zeile sichtbar und bündig mit den anderen; Klappzeile zeigt „ab 25. Firun"; Link
kopieren, in einem neuen Tab öffnen, Datum steht wieder da. Panel darf **keinen** Scrollbalken
bekommen — die Oberfläche liegt aufgeklappt bei 741 px, der Balken kommt ab 777 px
(`css/features/route-planner.css`, Kommentar am `.planner-group__toggle`). Eine dritte Zeile
kostet ~25 px; **nachmessen, nicht schätzen.**

## Phase 2 — Der Zeitfaktor

1. Kalenderhilfen: 12 Monate à 30 Tage + 5 Namenlose Tage (365). Datum an einer Etappe =
   Aufbruch + akkumulierte Kalenderzeit. An Land verbraucht eine Reisestunde `24/Reisestunden`
   Kalenderstunden, auf offener See wird durchgefahren (Reisehandbuch §16, PDF-S. 131).
2. Bodenzustand je Etappe aus Monat + Breitenband + Wegart (Entwurf §3).
3. **Abzug, nicht Aufschlag:** −0,1 bzw. −0,2 auf den Bewegungsfaktor, Untergrenze 0,05
   (Entwurf §1.1). Straßenausnahme nur beim aufgeweichten Boden.
   💣 Avesmaps führt heute **keinen** eigenen Bewegungsfaktor je Wegart, sondern
   Geschwindigkeiten je (Transportmittel × Wegart) in `client-graph.php`. Vor dem Rechnen
   festlegen und im Code begründen, wie der Abzug darauf abgebildet wird — der naheliegende Weg
   ist ein aus der Quelle abgeleiteter Faktor je Wegart, gegen `Strasse = 1,0` normiert.
   **Diese Abbildung ist die heikelste Stelle der ganzen Arbeit.**
4. Ausgabe im Reiseplan: Zusammenfassung (Reisebeginn, Ankunft, Jahreszeit) und je Etappe ihr
   eigenes Datum samt Abzug.

**Prüfen:** Aufbruch 28. Phex → die Route läuft in den Peraine, und der Abzug fällt **mitten in
der Route** von Winter auf Frühling; im Plan an den Etappenvermerken sichtbar. Aufbruch 28. Rahja
→ die Reise läuft durch die Namenlosen Tage. „Ohne Jahreszeit" liefert **exakt** die Zahlen von
vorher. 💣 Server- und Client-Engine gegeneinander prüfen, nicht nur eine
(`routing-two-server-switches`).

## Phase 3 — Sperrzeiten als Wegdaten

1. Felder in den `properties` des Wegs, analog `allowed_transports`: von-Monat/-Tag,
   bis-Monat/-Tag, Art der Sperrung, Quellenvermerk. Über den Jahreswechsel zulässig.
2. Sichtbar **nur** bei `Gebirgspass`, `Seeweg`, `Flussweg` (Entwurf §2.4 — die Quelle nennt
   diese drei, nicht nur den Pass).
3. Beide Editoren: `js/pages/wege-editor.js` neben den Transport-Haken, und
   `js/review/review-paths.js`. Schreibweg über `api/edit/map/paths-editor.php`.
4. Die Tabellen aus Entwurf §2.1–2.3 einpflegen. ⚠️ Vorher die Rabenpass-Frage klären.

**Prüfen:** Fenster an einem Pass setzen, speichern, neu laden, Wert steht. Bei einer
Reichsstraße dürfen die Felder **nicht** erscheinen. Ein Fenster über den Jahreswechsel
(Greifenpass) muss sich speichern und wieder korrekt anzeigen lassen.

## Phase 4 — Sperrung wirkt auf die Wegwahl

Erst jetzt, und erst nach der Entscheidung zu Entwurf §6 (exakt je Kante oder grob gegen das
Aufbruchsdatum).

**Prüfen:** eine Route über den Greifenpass im Firun weicht aus, im Praios nicht. Der Plan sagt
**warum**. Laufzeit vorher/nachher messen — die politische Ebene hat gezeigt, wie schnell ein
zusätzlicher Schritt je Route teuer wird.

## Phase 5 — Infodialog

Die Erklärungsübersicht aus dem Mockup in ein Overlay nach dem Muster von
`transport-speed-info.js`, ausgelöst von einem neuen ⓘ-Knopf an der Kopfzeile „Routenoptionen".
💣 Der ⓘ-Knopf der Transportgruppe hängt per `position: absolute` in der Ecke; in der Kopfzeile
ist er ein gewöhnliches Flex-Kind (`.planner-group__head .tsi-info-btn`) — für den neuen Knopf
dieselbe Regel nutzen, nicht neu erfinden. Inhalt: Bodenabzüge samt Quelle, Bänder-Tabelle,
mitlaufender Kalender, sperrbare Wegarten, PDF-Seitenbezüge.

---

## Leitplanken

- **Rückwärtskompatibel:** ohne Reisebeginn rechnet alles wie heute. `POST /api/route/` ist der
  stabile Vertrag; neue Felder sind optional.
- **Nur Tokens** aus `css/base/tokens.css`, kein fester Farbwert (AGENTS §12).
- **Zahlen über `formatDecimalNumber()`**, nie `toFixed`.
- **Geteilter Checkout:** nur eigene Dateien per Pfad stagen, nie `git add -A` (AGENTS §9).
- **Zeilenenden:** Arbeitsbaum ist CRLF; nach Python-Schreibvorgängen vereinheitlichen
  (`git ls-files --eol`).
- **Handbuch nicht anfassen** — `html/editor-handbuch.html` gehört der nächtlichen Routine.
  Pflicht ist nur ein Commit-Betreff, der die sichtbare Wirkung benennt (AGENTS §9).
- Editor-sichtbare Änderung → `edit/index.php` trägt sein `?v=` von Hand, falls `edit.css`
  angefasst wird (AGENTS §7 Regel 3).
