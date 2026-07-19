# Editor-Handbuch — Aufwertung & Aktualisierung

- **Datum:** 2026-07-20
- **Betrifft:** `html/editor-handbuch.html`
- **Vorgänger:** `docs/superpowers/specs/2026-07-07-editor-handbuch-design.md` (Erstbau)

## Ausgangslage

Das Handbuch bildete inhaltlich den Stand **~10.07.2026** ab. Seitdem ~690 Commits.
Drei Befunde machten aus „nachtragen" einen Umbau:

1. **Die Grundannahme stimmte nicht mehr.** Das Handbuch beschrieb durchgehend die
   Popup-Welt („Ein Klick auf die Siedlung öffnet ihr Popup"). Seit 17.07. landet
   ein Klick im **Infopanel**. Damit war der Einstieg fast jeder Anleitung falsch.
2. **Vier Subsysteme fehlten vollständig** (0 Treffer im Volltext): Siedlungseditor,
   Quellen, Abenteuer, Kartensammlung — dazu die Menübänder aller vier Sync-Editoren
   und der „Änderung vorschlagen"-Workflow.
3. **Ein echter Fehler, kein Veralten:** Die Orientierung behauptete, praktisch alle
   Bearbeitungen starteten im Rechtsklick-Menü. Tatsächlich gibt es genau **zwei**
   Kontextmenüs, und das Karten-Menü ist auf leerer Karte, Ort, Kreuzung, Label und
   Weg **identisch** — feature-spezifische Aktionen sitzen im Linksklick-Popup bzw.
   im Infopanel.

## Gliederung (vom Owner vorgegeben)

Sie spiegelt die echte Editor-Navigation: die fünf **Karten-Features** sind die
WikiSync-Reiter, die **Aufgaben** sind die Editor-Panel-Reiter.

```
Erste Schritte      Zugang · Die drei Flächen · Rollen · Goldene Regeln · Erster Durchlauf
Karten-Features     Siedlungen · Territorien · Regionen · Wege · Materialien
                                                          └ Abenteuer · Kartensammlungen
Aufgaben            Bug-System · Meldungen · Bewertungen · Mails · Änderungen · Status
                                                                    └ Editoren · Besucher
Verstehen           Wiki · Sofort live · Graph · Hierarchie · Quellen · Lizenzen · Spoiler · Schalter
Nachschlagen        Auswahllisten · Prüf-Häkchen · Kontextmenüs · Sync-Editoren · Glossar · Hilfe
```

## Stand

- [x] **Phase 1 — Fundament** (`476b7621`). `tokens.css` + `fonts.css` + Theme-Skript;
      die lokalen `--hb-*` sind jetzt Aliasse statt eigener Palette → Hell/Dunkel und
      App-Schrift gratis. Drei Kastentypen (`.hb-tip` / `.hb-warn` / `.hb-check`) statt
      einem gelben `.hb-todo`. Stand-Datum im Kopf.
- [x] **Phase 2 — Gliederung** (`476b7621`). Fünf Ebenen wie oben; Verzeichnis mit allen
      39 Themen in zwei Stufen, mitlaufende Markierung, Filter mit `data-keywords`.
      Regeln stehen nur noch an einer Stelle (`#regeln`).
- [ ] **Phase 3 — Tiefe** (siehe unten). Die neuen Kapitel stehen inhaltlich korrekt,
      aber knapp. Hier wird ausgebaut.
- [ ] **Phase 4 — Auffindbarkeit.** Dauerhafter „Handbuch"-Link in die Kopfleiste von
      `edit/index.php:94` neben „Abmelden". Heute hängt das Handbuch an genau einem
      Faden: dem Wort „Tutorial" hinten an der Statuszeile (`js/routing/routing.js:168`),
      sichtbar erst nach Öffnen des Editor-Panels.
- [ ] **Phase 5 — Nicht wieder veralten.** Ein Satz in AGENTS.md §9: Wer die
      Editor-Oberfläche ändert, zieht den Handbuch-Abschnitt mit. Ohne das steht dieselbe
      Analyse in zwei Wochen wieder an.

## Phase 3 — was noch fehlt

Aus drei Code-Abgleichen (Panel-Oberfläche, Kontextmenüs/Dialoge, Commit-Diff seit 07.07.).
Alles hier ist **verifiziert**, nicht vermutet.

**Siedlungen.** Der Siedlungseditor ist beschrieben, aber flach: Zwei-Achsen-Reiter
(Platziert/Fehlt) und Filtermasken, Territorienbaum mit Tri-State-Auswahl, das
Dry-Run-Fenster von „Siedlungen zuordnen" (der riskanteste Knopf für normale Editoren),
Bildergalerie mit Multi-Upload und Drag-Sortierung, Wappen-/Bilder-Filter in der Liste.

**Quellen.** Die 8er-Taxonomie ist als Liste da, der Ablauf nicht: Abdeckung
„Offiziell"/„Erwähnt" und wie sie die Popup-Reiter steuert, Seitenangaben,
Quellen zusammenführen, der Wiki-Key.

**Abenteuer / Kartensammlungen.** Je ein knapper Abschnitt. Es fehlen: Cover-Herkunft
und „neu ziehen", Shop-Link-Priorität (Ulisses > F-Shop > DNB > Wiki), „enthalten in"
bei Mutterprodukten, Meisterinformationen-Vorrang, die Freigabestrecke für
Community-Fundorte, `has_scale`.

**Meldungen.** Der „Änderung vorschlagen"-Weg ist genannt, aber nicht durchgespielt:
vorbefüllte Felder, rot umrandete Abweichungen, Positionsübernahme, Quellenvorschlag
→ echte `feature_source`.

**Wege.** Nachzutragen: unbenannte Wege benennen, Wegtyp ist Fließtext und kein
Join-Key mehr, Labels sind im Edit-Modus klickdurchlässig (damit Vertices treffbar
bleiben), Verlauf-/Lage-Einträge sind verlinkt.

**Territorien.** Abgeleitete Außengrenzen nur bei Container-Gebieten; Zoom-Band-Regeln;
die drei Ausschneide-Varianten auseinanderhalten.

### Ausdrücklich NICHT ins Handbuch

Owner-Aktionen — höchstens als „gibt es, macht der Betreiber" erwähnen: die Kill-Switches,
„Dump holen"/„Syncen", „Wappen lokalisieren", „Vorschauen holen" samt Lock und
Schrittbudget, Quellen zusammenführen, Admin-/Discord-Verwaltung.
Nicht gebaut, also kein Thema: Ökosystem-Ebene, Audit-Überarbeitung.

## Screenshots

Alle sieben stammen vom 07./08.07. — vor Dark Mode und vor dem Infopanel.

- **02-editor-panel** — gegen `index.html:299` geprüft, vier Reiter und drei Unterreiter
  stimmen. **Bleibt.**
- **03-hinzufuegen**, **04-verlaufeditieren**, **06-territoriumseditor** — plausibel,
  bleiben vorerst.
- **07-gebiet-menu**, **09-herrschaftsgebieteeditor** — unvollständig (Menü und Menüband
  haben seitdem Einträge bekommen). Bildunterschriften entschärft, ersetzen wäre besser.
- **08-ort-popup** — zeigt die abgelöste Popup-Welt. **Entfernt.**

🔧 **Owner:** Neue Aufnahmen kann nur jemand mit Editor-Login machen. Sinnvoll wären:
Infopanel eines Ortes im Bearbeiten-Modus, der Siedlungseditor, ein Menüband, der
Quellen-Bereich im Bearbeiten-Dialog.

## Prüfmittel

Ohne Backend prüfbar und beim Umbau tatsächlich benutzt:

- Ankertest — jeder `href="#…"` muss eine `id` treffen (fand die Navigation vollständig).
- `node --check` auf beide Inline-Skripte **einzeln** (ein `sed`-Bereich über die ganze
  Datei klebt sie zusammen und meldet einen Syntaxfehler, den es nicht gibt).
- Tokens per `file://`-`<link>` nachladen und Computed Styles in beiden Themes lesen —
  der absolute Pfad `/css/base/tokens.css` löst lokal nicht auf, auf dem Server schon.
- Filter funktional testen. Der erste Entwurf lieferte für „wappen" **null** Treffer,
  weil er nur Überschriften sah; daher `data-keywords`.
