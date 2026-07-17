# Design: Karte anklicken → in der Kartensammlung aufgeklappt zeigen

**Datum:** 2026-07-17 · **Status:** freigegeben, NICHT gebaut
**Auftraggeber-Zitat:** *„das aussehen der maps im infopanel soll unverändert bleiben nur der klick führt
zu vergrößertten kachel in der kartensammlung"* · *„die items sind derzeit nicht klick/Selektierbar"*

## 1. Warum

Der Kartenstreifen im Infopanel zeigt 116px-Kacheln: Bild, Titel, fertig. Alles andere — Art, Typen,
Gültigkeit, Auflösung, Urheber, Quelle, Notiz, die Fundstellen — ist nur im Dialog („Alle anzeigen") zu
sehen, und dort in einer Zeile mit einem 96×68-Vorschaubild. Wer eine Karte wirklich ansehen will, muss
sie erst extern öffnen.

Zwei Dinge fehlen: ein Weg von der Kachel zu **ihren** Angaben, und ein Vorschaubild, auf dem man etwas
erkennt.

## 2. Das Verhalten

**Der Streifen im Infopanel bleibt optisch unverändert** (Owner). Was sich ändert, ist das Klickziel:

| Klick | heute | künftig |
|---|---|---|
| Kachel im Infopanel-Streifen | öffnet die Karte extern | **öffnet die Kartensammlung**, scrollt zu dieser Karte, klappt sie auf |
| Zeile in der Kartensammlung | nichts (nur Thumb/Titel öffnen extern) | **klappt die Zeile auf** |
| Zeile, die schon offen ist | — | klappt sie zu |

**Der Direktweg „Kachel → Karte" entfällt** — Owner-Entscheidung, bewusst: ein Weg, keine Ausnahme. Wer
die Karte selbst will, geht über die aufgeklappte Zeile.

**Akkordeon: immer nur EINE Zeile offen.** Eine zweite zu öffnen schließt die erste. Der Zweck ist
Durchklicken und Vergleichen, nicht Stapeln — bei 20 Karten würde die Liste sonst unbenutzbar lang.

## 3. Die aufgeklappte Zeile

Sie ist dieselbe Zeile, nur mit Platz. Das Grid `96px | 1fr | 196px` wird zu `280px | 1fr | 196px`, das
Vorschaubild wächst von 96×68 auf **280×196** — der eigentliche Punkt der Übung. Dazu ein
**„Karte öffnen ↗"**-Button, weil der Klick auf die Zeile jetzt anderweitig vergeben ist.

Es kommt **kein neues Feld** dazu: alles, was die Zeile zeigt, zeigt sie schon. Sie bekommt nur Luft und
ein Bild, auf dem man etwas sieht.

### Was wo klickt

Der Zeilen-Handler entscheidet nach Ziel und Zustand — die Regel, in dieser Reihenfolge:

1. Klick in der **Fundstellen-Liste** rechts → durchlassen. Das sind echte Links und bleiben es immer.
2. **Aufgeklappt** + Klick auf das **große Bild** oder **„Karte öffnen ↗"** → durchlassen (öffnet extern).
3. Sonst → `preventDefault` + auf-/zuklappen. Das trifft auch Thumb und Titel im zugeklappten Zustand,
   und den Titel im aufgeklappten (= zuklappen).

Das Klickziel des Bildes wechselt also mit dem Zustand: zu = aufklappen, offen = öffnen. Bewusst so
(Owner-Auswahl) — es ist fehlklick-sicher, weil man erst aufklappen MUSS, und ein großes Kartenbild, das
auf Klick nichts tut, lädt sonst zum Fehlklick ein.

## 4. Die Fallen

### 4.1 Der Spoiler-Deckel muss zuerst kommen

`map-features-citymaps-dialog.js:291` deckt Spoiler auf und macht dafür `preventDefault` +
`stopPropagation` — „sonst oeffnet derselbe Klick, der aufdeckt, schon die Karte". Nach dem Umbau gilt
dasselbe für das Aufklappen und das Dialog-Öffnen: **ein Klick, der einen Spoiler aufdeckt, darf nichts
weiter tun.** Der Deckel liegt im Anker, `stopPropagation` trägt das — aber nur, solange die neuen
Handler auf `document` delegieren und nicht am Element selbst hängen.

### 4.2 `links.css` färbt per `!important`

`css/features/links.css` färbt jedes `a[target="_blank"]` per `!important` gold-braun (siehe den Hinweis
in `place-extras.css:509`). Deshalb bleibt die Streifen-Kachel ein **`<a href="<karte>" target="_blank">`**
und bekommt nur ein `preventDefault` im Handler — sie in einen `<button>` zu verwandeln wäre der Weg, auf
dem das Label seine Farbe verliert und „Aussehen unverändert" bricht.

Nebeneffekt, akzeptiert: Strg-/Mittelklick öffnen die Karte weiterhin direkt (Browser-Default, den
`preventDefault` nicht abfängt). Das widerspricht „ein Weg" nicht — ein Strg-Klick ist kein normaler
Klick, und ein `<a>`, der im neuen Tab etwas anderes tut als beim Klick, wäre die schlechtere Lüge.

### 4.3 Kein `display:none` für den Zuklapp-Zustand des Bildes

Das große Bild ist **dasselbe** `<img>` wie das kleine, nur anders dimensioniert (CSS). Ein zweites,
verstecktes Bild würde jede Karte zweimal laden — bei 20 Karten im Dialog 20 unnötige Requests.

## 5. Umsetzung

1. **Zeile aufklappbar** (`buildCityMapRowMarkup` + `place-extras.css`): `.is-expanded` mit dem größeren
   Grid + Thumb, `„Karte öffnen ↗"`-Button (nur im offenen Zustand sichtbar). Neuer i18n-Key
   `cityMaps.openMap`.
2. **Klick-Handler** (`map-features-citymaps-dialog.js`): delegiert auf `document`, Regel aus §3, Akkordeon.
3. **Streifen-Kachel → Dialog** (`map-features-citymaps-dialog.js`): `preventDefault`, Section finden,
   `openDialogForSection(section, publicId)`.
4. **Scroll + Auto-Aufklappen**: `openDialogForSection` bekommt ein optionales `focusPublicId` — nach dem
   Bauen `[data-public-id="…"]` suchen, `.is-expanded` setzen, `scrollIntoView({block:"nearest"})`. Erst
   NACH `is-open`, sonst hat die Zeile kein Layout und der Scroll landet nirgends.

## 6. Test

Node-Tests in `js/map-features/__tests__/citymaps-render.test.js` decken das Markup ab: der Button
existiert, trägt `↗`, und die Zeile rendert ohne `.is-expanded` wie bisher. Das Klickverhalten selbst
(Akkordeon, Zustandswechsel des Bildes, Spoiler-Vorrang) hängt an echten Events im Browser und braucht
einen Owner-Durchlauf — `map-features-citymaps-dialog.js` ist ein IIFE ohne Exports.

## 7. Bewusst nicht

- **Der Dialog bleibt der einzige Ort zum Aufklappen.** Der Infopanel-Streifen klappt nichts auf: 116px
  Kacheln in einem horizontalen Streifen haben keinen Platz für Zusatzangaben, und der Streifen würde bei
  jedem Klick in der Höhe springen.
- **Kein Deep-Link auf eine aufgeklappte Karte.** Die URL-Policy ist eindeutig (`url-sharing-policy`):
  die Adresszeile wird nie automatisch umgeschrieben.
