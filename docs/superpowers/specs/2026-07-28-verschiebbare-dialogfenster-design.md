# Verschiebbare Dialogfenster (Design, 2026-07-28)

**Auftrag (Owner):** „Können wir alle Dialogfenster generell verschiebbar machen. Der Drag-Handler
soll der Titel sein." — GO mit zwei Einschränkungen: **nur verschieben** (die Karte darunter wird
dadurch nicht bedienbar), und **Infopanel und Routenplaner bleiben**, wo sie sind. Das sind
angedockte Leisten, keine Fenster, und sie haben keine Titelzeile zum Anfassen.

## Bestand: 26 Fenster in vier Bauarten

| Bauart | Griff | Fenster | Wo |
|---|---|---|---|
| Statisch, Hauptseite | `.location-report-dialog__header`, `.legal-dialog__header`, `.political-territory-editor-dialog__header` | 14 | `index.html` |
| Erst beim Öffnen gebaut | `.avesmaps-adv-dialog__head`, `.avesmaps-lore-dialog__head`, `.tsi-head` | 7 | `js/map-features/*`, `js/routing/transport-speed-info.js` |
| Editor-iframes | `.modal-title` → `.modal-box` | 5 | `html/wiki-sync-monitor.html`, `html/wiki-sync-settlement-editor.html` |

Alle vier haben oben dieselbe Form: Titelzeile mit Überschrift, rechts die Knöpfe. Deshalb wird
**kein Fenster einzeln verdrahtet.**

💣 **Diese Tabelle ist eine Momentaufnahme, keine Konfiguration.** Der erste Entwurf listete genau
diese Klassennamen als Selektoren — beim Rebasen auf einen 149 Commits neueren Stand standen dort
**sechs weitere Fenster** (Landschaften/Ökosystem, Label-Zuweisung) mit eigenen Kopfzeilen-Klassen,
die eine solche Liste nicht gekannt hätte. Ein nicht verschiebbares Fenster fällt niemandem auf, bis
es stört. Gesucht wird deshalb nach der **Form**, nicht nach Namen (siehe unten).

## Lösung: ein delegierter Mechanismus

`js/ui/dialog-drag.js`, einmal je Dokument geladen (Hauptseite + die zwei Editor-iframes; ein iframe
ist ein eigenes Dokument und braucht seine eigene Kopie). Er hängt an `document` und findet beim
Zeigerdruck über `closest()` erst die Titelzeile, dann ihr Fenster.

Der Griff ist **jedes direkte Kind eines `[role="dialog"]`, dessen Klasse `__head…` oder `-head`
enthält** (plus `.modal-box > .modal-title` für die Editor-iframes). Das Fenster ist
`[role="dialog"], .modal-box`. **Ein neues Fenster ist damit automatisch verschiebbar**, sobald es
dem Hausmuster folgt; wer davon abweicht, setzt `data-avesmaps-drag-handle` auf seine Kopfzeile.
Dieselben Selektoren stehen in `css/components/dialog-overlays.css` — dort als Zeiger und
abgeschaltete Textmarkierung.

Nicht verschiebbar und mit Absicht: die Spotlight-Suche (`role="dialog"`, aber keine Titelzeile —
sie ist ein Suchfeld, kein Fenster).

### Drei Entscheidungen, die tragend sind

1. **`translate`, nicht `transform`, und schon gar nicht `position/left/top`.** Die Fenster sitzen
   per Flex-Zentrierung in ihrem Overlay; ein Wechsel auf `position: absolute` risse Breite, Höhe und
   jedes Media-Query-Layout mit. `translate` ist eine eigene Eigenschaft und überschreibt kein
   `transform` aus dem Stylesheet (heute hat kein Dialogkasten eins — morgen vielleicht eine
   Einblend-Animation).

2. 💣 **Das Bezugsmaß wird bei JEDER Bewegung frisch gemessen, nie beim Anfassen gemerkt.** Fenster
   ändern ihre eigene Größe, während sie offen stehen: das Konflikte-Fenster war beim Nachmessen
   200px schmaler als beim Öffnen. Gegen das alte Maß gerechnet landete seine Kopfzeile **unter dem
   Bildschirmrand** — genau der Zustand, den die Begrenzung verhindern soll. Beim Bau erst gemerkt,
   dann gemessen, dann repariert.

3. **Die unverschobene Lage ist immer erlaubt.** Ein Fenster, das höher als der Bildschirm ist, hängt
   bei Flex-Zentrierung oben und unten heraus (`top` ist negativ). Eine stur auf `top >= 0` pochende
   Begrenzung ließe so ein Fenster beim ersten Anfassen springen. Die Begrenzung soll bremsen, nicht
   schubsen.

### Verhalten

- Beim Ziehen bleiben immer 120px Fensterbreite und die volle Kopfzeilenhöhe im Bild.
- Doppelklick auf den Titel holt das Fenster zurück in die Mitte.
- Die Lage bleibt, solange die Seite offen ist; ein Neuladen startet wieder mittig. Fenster, die beim
  Schließen weggeworfen und neu gebaut werden (Vorkommen, Natur & Waren), starten ohnehin mittig.
- Knöpfe und Eingabefelder in der Kopfzeile bleiben bedienbar (die Suche im Konflikte-Fenster sitzt
  dort) — sie lösen kein Ziehen aus und behalten ihren eigenen Zeiger.
- Maus und Stift, nicht Finger: am Handy füllen die Fenster ohnehin den Schirm.

### Sicherheitsnetz gegen unerreichbare Fenster

Drei Wege holen ein verschobenes Fenster zurück ins Bild, wenn sich etwas hinter seinem Rücken
ändert:

1. `ResizeObserver` — das Fenster ändert seine eigene Größe.
2. `resize` am Browserfenster — der Bildschirm wird kleiner.
3. **Ein Zeigerdruck irgendwo im Dokument** — der Kehraus, der an keiner Renderschleife hängt. Bei
   keinem verschobenen Fenster (dem Normalfall) kostet er nichts.

Weg 3 ist nicht doppelt gemoppelt: 1 und 2 hängen an der Renderschleife des Browsers. In einem nicht
gerenderten Tab liefern sie **gar nichts** — nachgewiesen mit einem Kontroll-Observer auf demselben
Element, der ebenfalls 0-mal feuerte. Weg 3 deckte in der Prüfung beide Fälle vollständig ab.

## Nebenbefund, gleich mit repariert

`#wiki-sync-dump-credentials-overlay` („Dump-Zugangsdaten") stand in **keiner** der drei
ID-Selektorlisten in `dialog-overlays.css` und erbte deshalb nichts: `position: static`,
`z-index: auto`, kein Abdunkeln. Geöffnet erschien es nicht mittig, sondern als gewöhnlicher Block
**unterhalb des Seitenendes** (gemessen bei `top: 800px`). Der Öffner ist live
(`openWikiSyncDumpCredentialsPrompt`, `js/review/review-wiki-sync.js`), der Fall also erreichbar.

Aufgefallen ist es, weil dieses eine Fenster sich als einziges nicht senkrecht ziehen ließ — es lag
längst außerhalb des Bildes. Die drei fehlenden Einträge sind nachgetragen; das Fenster ist jetzt
zentriert, abgedunkelt und verschiebbar wie die übrigen. (Genau der Fall, den
`new-overlay-dialog-css-checklist` beschreibt: ein Overlay-`<div>` erbt nichts.)

## Prüfstand

- `node js/ui/__tests__/dialog-drag.test.js` — die reine Begrenzungsrechnung inklusive der drei
  Randfälle oben.
- Am echten DOM auf `localhost` geprüft: alle drei statischen Bauarten, zwei dynamisch gebaute
  Fenster über **die Öffner der App selbst**, beide Editor-iframe-Seiten; dazu Schließen-Knopf,
  Fensterkörper, Kopfzeilen-Suchfeld, Finger, rechte Maustaste und das Sicherheitsnetz.
- Nicht prüfbar in dieser Umgebung (Tab rendert nicht, per Kontrollversuch belegt):
  `ResizeObserver`, `resize`, `setPointerCapture` mit echtem Zeiger, Screenshots.
