# Der Deckel — lange Angaben in der Infobox

**Stand:** 2026-08-12 · Am Entwurf entschieden (Owner: „4 is mega, das wollen wir").

## 1. Der Anlass

Die Zeilen Waren/Fauna/Flora zeigten acht Namen und dahinter eine Kachel „+43". Owner-Befund:

> „die +43 und das +13 und das +2 sind leicht zu übersehen … die Leute sehen nicht, dass sie auf die
> kleinen buttons draufklicken und riesige inhalte freischalten können"

Zwei Ursachen, und nur eine ist die Größe:

1. **Die Position wanderte.** Die Kachel stand am Ende einer umbrechenden Liste — mal nach einer
   Zeile, mal nach dreien. Ein Auge kann das nicht erwarten.
2. **Acht von 51 sind weder Liste noch Zusammenfassung.** Zu wenig, um etwas zu zeigen; zu viel,
   damit der Öffner daneben noch auffällt.

🔴 **„Lauter machen" war die falsche Antwort** und wurde verworfen: eine Infobox trägt vier bis fünf
solcher Öffner, und ein kräftiger Knopf multipliziert sich mit ihrer Zahl — genau das verbietet
AGENTS.md §12 für Zeilenhandlungen. Was hilft: **feste Stelle, ein Satz statt einer Zahl, und weniger
Inhalt drumherum.**

⚠️ **Die tabellarische Form bleibt** (Owner: „am lesbarsten ist immer noch die tabellarische Form").
Ein größerer Umbau in Abschnitte lag als Stufe 2 auf dem Tisch und wurde nicht gewählt. Der Deckel
ersetzt den WERT einer Zeile, nie die Zeile.

## 2. Der Deckel

```
Verlauf   ┌────────────────────────────────────┐
          │ Trallop → … → Punin                │
          │ 33 Orte auf dem Weg  alle anzeigen │
          └────────────────────────────────────┘
```

Bauteil: `js/ui/infobox-lid.js` (`buildInfoboxLid`) + `css/components/infobox-lid.css`.

🔴 **EIN Bauteil für alle Nutzer.** „Verlauf" am Weg und Waren/Fauna/Flora an fünf Oberflächen
brauchen dasselbe. Zwei eigene Bauer sähen am Anfang gleich aus und wären nach dem zweiten Feinschliff
zwei verschiedene Deckel — so sind Infobox und Routenplaner einmal auseinandergelaufen.

### Die Sätze (Owner-Wortlaut)

| | Mehrzahl | Einzahl |
|---|---|---|
| Verlauf | 33 **Orte auf dem Weg** | 1 Ort auf dem Weg |
| Waren | 11 **Handelswaren gelistet** | 1 Handelsware gelistet |
| Fauna | 10 **Tierarten beobachtet** | 1 Tierart beobachtet |
| Flora | 12 **Pflanzenarten gesehen** | 1 Pflanzenart gesehen |

🔴 **EIN Satz je Zeile, und er gilt in BEIDEN Zuständen** — zugeklappt wie aufgeklappt (Owner
2026-08-12: „11 Handelswaren gelistet sollte es auch heißen, wenn es zugeklappt is … und wenn es
aufgeklappt ist"). Eine Zwischenfassung hatte ZWEI Sätze und tauschte sie beim Aufklappen („…
gelistet" → „… werden hier gehandelt"). Das ist dieselbe Unruhe wie der springende Satz von zwei
Stunden vorher, nur in Worten statt in Pixeln: **was an derselben Stelle steht, soll auch dasselbe
sagen.** Die Mechanik dafür wurde gebaut, gemessen und wieder ausgebaut.

⭐ Die Sätze sagen, was **erfasst** ist — eine Aussage über den Datenbestand, nicht über den Ort.
„gelistet / beobachtet / gesehen" trägt beide Zustände. Die frühere Fassung („werden hier gehandelt
/ leben hier / wachsen hier") war eine Aussage über den Ort; sie war aufgeklappt schöner und
zugeklappt zu lang, und genau dieser Kompromiss war der Fehler.

⚠️ **Kein Ortswort** („hier", „in der Nähe", „auf dem Weg") in den Lore-Sätzen: dieselbe Zeile steht
an fünf Oberflächen, und was an einer Straße stimmt, liegt bei einem Königreich daneben. Im Test
festgenagelt. „auf dem Weg" darf bleiben — *Verlauf* gibt es nur am Weg.

💣 **Einzahl und Mehrzahl sind Pflicht.** „1 Tierarten beobachtet" entsteht von selbst, sobald jemand
nur den Plural hinterlegt.

### Wann öffenbar, wann nicht

- **Lore: IMMER.** Jede Zeile ist ein Deckel, der aufklappt — auch bei zwei Einträgen (Owner
  2026-08-12: „auch 2 Tierarten leben hier / Berglöwe, Griswolf ← einklappen"). ⭐ Der Gewinn ist
  nicht der gesparte Platz bei zwei Namen, sondern dass **alle Zeilen einer Box gleich aussehen und
  sich gleich verhalten**. Ein Auge, das an drei Zeilen dasselbe lernt, muss bei der vierten nicht
  raten. Die frühere Grenze `AVESMAPS_LORE_LID_MIN` ist ersatzlos entfallen.
- **Zugeklappt steht KEIN Name da** (Owner: „ohne weitere Angaben") — nur der Satz und der Öffner.
  ⭐ Der Weg dahin ging von acht Namen über drei zu null; jeder Schritt machte den Öffner sichtbarer,
  weil weniger daneben stand. `AVESMAPS_LORE_PREVIEW_NAMES` ist ebenfalls entfallen.
- **Verlauf:** unverändert (Owner: „verlauf kann bleiben"). Vorschau *erste → … → letzte* ab
  5 Stationen (`PATH_VERLAUF_LID_MIN_STATIONS`); darunter ein statischer Deckel ohne Öffner. Er ist
  damit der einzige verbliebene Nutzer des statischen Zweigs.

## 3. Die Fallen

💣 **Natives `<details>`, kein selbstgebautes Klappen.** Strg+F findet Text in einem ZUgeklappten
`<details>` und klappt es selbst auf; Fokus, Enter/Leertaste und `aria-expanded` kommen ebenfalls vom
Element. Dieselbe Begründung wie beim Fenster „Hinweise" (AGENTS.md §11). Voraussetzung dafür: der
volle Inhalt steht **von Anfang an im Dokument** — deshalb holt der Lore-Abruf seit 2026-08-12
`full=1`.

💣 **OFFEN HEISST SICHTBAR, OHNE EINE ZEILE JAVASCRIPT.** Die erste Fassung hatte es andersherum: eine
Klasse aus einem `requestAnimationFrame` schaltete den Inhalt ein. In der Abnahme feuerte rAF nicht
(die Vorschau-Pane war zugeklappt) — das `<details>` war offen, die Beschriftung sagte „zuklappen",
der Inhalt hatte Höhe 0. Ein Nutzer in einem Hintergrund-Tab hätte dasselbe gesehen. Seither macht
`[open]` den Inhalt allein per CSS sichtbar; `is-collapsed` unterdrückt ihn nur vorübergehend für die
Bewegung, und die Unterdrückung wird von **rAF UND einem Zeitgeber** aufgehoben. Jeder Ausfall fällt
auf „sichtbar".

💣 **Jede CSS-Regel trägt eine Klasse.** Eine klassenlose `details > summary`-Regel galt bis zum
2026-08-12 für die ganze Seite und legte den gesendeten Mails im Postfach alle Felder nebeneinander.
`js/app/__tests__/details-summary-scope.test.js` wacht darüber; `[open]` und ein Wirt-Selektor zählen
dort ausdrücklich nicht als Bindung.

💣 **Die Zahl im Satz ist, was aufgeklappt dasteht** — nicht die Serverzahl. Seit `full=1` sind beide
gleich; auseinander liefen sie nur, wenn jemand die Grenze wieder einzöge. Ein Satz, der mehr
verspricht als das Aufgeklappte zeigt, ist die stille Lüge, die niemand bemerkt.

💣 **`grid-template-rows: 0fr → 1fr`** ist der einzige Weg, auf eine UNBEKANNTE Höhe zu animieren.
Gemessen werden könnte sie nicht: der Inhalt bricht je nach Panelbreite anders um. Das
`overflow: hidden` am Kind ist tragend.

## 4. Die Gliederung im Aufgeklappten

Owner: „geht das nicht überall?" — **ja, aber nicht mit denselben Überschriften.**

| Gruppe | woher | gilt für |
|---|---|---|
| **Von hier** | `relations` enthält `herkunft` | **nur Waren** |
| **Direkt hier** | `rank` 0 | alle |
| **Aus Untergebieten** | `rank` 1 | alle |
| **Überall in Aventurien** | `rank` 3 | alle |

🔴 **„Von hier / Hier erhältlich" gibt es nur bei Waren.** Am Live-Bestand gemessen (2026-08-12): von
21 Tierarten und 10 Pflanzen trägt **keine** eine Herkunft, alle nur eine Verbreitung. Diese
Gliederung dort hinzuschreiben wäre eine erfundene Unterscheidung. Was überall trägt, ist der Rang —
und das ist dieselbe Einordnung, die der abgelöste „+N"-Dialog schon kannte.

⚠️ **Ein Eintrag mit Herkunft steht NUR in „Von hier"**, nie zusätzlich in seiner Rang-Gruppe.
⚠️ **Eine einzige Gruppe bekommt keine Überschrift** — eine einzige Gruppe gliedert nichts.
⚠️ **Rang 3 bleibt aus der VORSCHAU heraus.** Was überall gilt, sagt über diesen Ort nichts; im
Aufgeklappten steht es unter seiner Überschrift, wo die Einordnung mitgeliefert wird.

**Nicht möglich:** eine Gliederung des *Verlaufs*. Das sind Ortsnamen aus einem Wiki-Textfeld, ohne
Zuordnung zu irgendetwas.

**Verworfen, weil gemessen:** eine Bündelung nach Kategorie. Das Feld `gruppe` trägt bei Waren zu
50 von 51 den Wert „profan" (eine magische Einordnung, keine Warenkategorie); bei Tieren steht dort
die Art selbst („Bär", „Fuchs", „Spinne") — 15 Gruppen für 21 Tiere.

## 5. Was der Deckel ablöst

Der **„+N"-Dialog** (`avesmapsLoreOpenDialog`) ist ersatzlos entfallen, samt seinem CSS und den nur
noch von ihm genutzten Bauern (`avesmapsLoreSectionMarkup`, `avesmapsLoreItemMarkup`,
`avesmapsLoreRenderWikiText`, `AVESMAPS_LORE_SECTIONS`). Seine Einordnung nach Nähe lebt in den
Gruppen weiter; sein Zusatz „Wolf — Raubtier" (`typ`/`gruppe`) ist bewusst **nicht** übernommen
(Owner sah und billigte die Fassung ohne).

🔧 **Offen beim Owner:** 67 % der Tierarten tragen einen `lebensraum` („Gebirgstäler", „Sumpf",
„Wald"). Als Gruppierung taugt er nicht (die Werte reichen bis zu ganzen Sätzen), als kleine graue
Angabe hinter dem Namen wäre er hübsch. Angeboten, noch nicht entschieden.

## 6. Abnahme

Die Handgriffe, nicht die Maßtabellen (AGENTS.md §9):

1. Einen **Weg** anklicken → „Verlauf" ist eingedampft, der Satz steht darunter, ein Klick klappt auf
   und wieder zu.
2. Waren/Fauna/Flora ebenso — aufgeklappt mit ihren Gruppen.
3. Ein **kurzer** Fall (wenige Einträge): Deckel ohne Öffner, alles steht da.
4. **Strg+F** auf einen Namen, der zugeklappt verborgen ist — er wird gefunden und der Deckel geht auf.
5. Gegenprobe **Siedlung, Region, Herrschaftsgebiet, Routen-Etappe**: überall dieselbe Form.
6. Hell UND dunkel.

Tests: `js/ui/__tests__/infobox-lid.test.js` (5/5 Mutationen rot),
`js/map-features/__tests__/lore-lid.test.js` (7/7 rot),
`js/app/__tests__/details-summary-scope.test.js` (Wächter).
Geometrie gegen die echte CSS-Kette geprüft: Vorschau und Fußzeile stapeln, Satz links / Öffner
rechts, Gruppenüberschrift über ihren Namen.
