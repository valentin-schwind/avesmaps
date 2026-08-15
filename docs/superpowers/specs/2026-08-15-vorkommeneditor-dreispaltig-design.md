# Vorkommeneditor: dieselbe Form wie die vier anderen Editoren — plus Reiter „Alle"

**Stand:** 2026-08-15 · **Owner-GO:** 2026-08-15 („los") · Mockup im Gespräch gezeigt und abgenickt.

Betrifft NUR Layout/Aufbau des Fensters „Vorkommen bearbeiten" (`#wiki-sync-lore-overlay`)
und einen fehlenden Reiter. Keine Änderung an Daten, Endpunkten, Rechten oder am
öffentlichen Frontend.

## 1. Warum

Der Editor trägt die Designsprache seit `be08016c` in Teilen — Menüband, Statuszeile,
goldene Spaltentitel, warmer Grund. Er ist aber **der einzige der fünf, der kein
iframe ist**: er lebt als Dialog in `index.html` und bindet deshalb weder
`css/components/editor-page.css` (die gemeinsamen Hüllenmaße `--avm-*`) noch die
Editor-Bildlaufleisten. Genau dort ist er auseinandergelaufen. `editor-huellenmasse`
notierte ihn seinerzeit ausdrücklich als „nicht geprüft".

Vorbild ist der **Kartensammlungs-Editor** (`html/citymap-editor.html`) — er hat
dieselbe Dreiteilung *Liste | Stammdaten | Orte* und ist damit der nächste Verwandte.
Die Maße kommen aus `editor-page.css`, nicht abgeschrieben.

## 2. Was sich ändert

| # | Heute | Künftig |
|---|---|---|
| 1 | Rahmen um die **ganze** Spalte, Titel und Suche stecken darin | Rahmen nur um den **scrollenden** Inhalt, Titel und Suche stehen darüber |
| 2 | Ohne gewählten Eintrag steht rechts ein Satz auf leerer Fläche → wirkt zweispaltig | Drei Spalten immer sichtbar, „Stammdaten" und „Vorkommen" mit Titel und Platzhalter |
| 3 | Rechts scrollt alles zusammen, die Titel wandern weg | Jede Spalte scrollt für sich, Titel bleiben stehen |
| 4 | Der Eintragsname steht im Scrollbereich | Feste Kopfzeile über beiden rechten Spalten (Vorbild `.ce-detail__head`) |
| 5 | 18 px Innenrand, `--radius-lg`, randloses ✕, Menüband abgesetzt | Titelleiste mit Trennlinie, `--radius-sm`, gerahmtes ✕, Menüband/Status bis zur Kante |
| 6 | Bildlaufleisten 7 px (App-Wert) | 10 px wie in den vier Editorseiten |
| 7 | Reiter Fauna · Flora · Waren · Spezies | **Alle** davor, mit Summe; in „Alle" trägt jede Zeile ihre Art |

## 3. Aufbau (Ziel)

```
#wiki-sync-lore-dialog            Grund --color-page-bg, padding 0, --radius-sm
  .location-report-dialog__header Titelleiste, --color-panel, Trennlinie, gerahmtes ✕
  .lore-ribbon                    --color-panel
  .lore-dlg__status               --color-panel-soft
  .lore-dlg__tabs                 Alle · Fauna · Flora · Waren · Spezies
  .lore-dlg__body                 grid 1fr : 2fr
    .lore-dlg__col--list            padding --avm-col-pad, border-right
      h3.lore-dlg__coltitle         „Vorkommen"
      .lore-dlg__top                Suche + Trichter
      p#lore-dlg-count
      #lore-dlg-scroll              ← gerahmter Kasten, scrollt
    .lore-dlg__detail
      #lore-dlg-detailhead          ← FESTE Kopfzeile, überlebt jedes Neuzeichnen
      .lore-dlg__panels             grid 1fr : 1fr
        .lore-dlg__col--stamm         h3 „Stammdaten" + #lore-dlg-stamm (gerahmt, scrollt)
        .lore-dlg__col--places        h3 „Vorkommen (n)" + #lore-dlg-places (gerahmt, scrollt)
```

## 4. Die Fallen (Abnahmeliste — jede vor „fertig" einzeln abhaken)

- 💣 **Der gerahmte Kasten braucht einen dunkleren Grund dahinter.** Steht der Dialog auf
  `--color-panel` wie die Kästen, hängt der Rahmen im Nichts. Deshalb geht der
  Dialoggrund auf `--color-page-bg` — dieselbe Voraussetzung, an der der
  Abenteuer-Editor einmal gescheitert ist (`ab3a7f97`).
- 💣 **`.location-report-dialog__header` und `__close` gehören ALLEN Dialogen.** Jede
  Änderung daran wird über `#wiki-sync-lore-dialog` gescopet, nie global — sonst wandert
  die Titelleiste durch Ortsmeldung, Konfliktzentrum und WikiSync-Fall mit.
- 💣 **Der feste Kopf und die Spaltentitel dürfen NICHT im neu gezeichneten Bereich
  liegen.** `renderLoreDetail` baut bei **jedem gespeicherten Feld** neu auf; ein Titel im
  `innerHTML` wäre danach weg oder doppelt. Sie stehen als Geschwister davor — wörtlich
  die Lehre aus `#ceStammBody` im Karteneditor.
- 💣 **`#lore-detail` verschwindet, seine vier Aufrufer müssen mit.**
  `moveLoreSectionIntoDialog`, `openLoreDetail`, `closeLoreDetail`, `renderLoreDetail`.
  Der Umzug per JS entfällt — die Maske steht künftig direkt im Fensterrumpf. Was BLEIBT:
  der Umzug des **Sync-Knopfs** ins Menüband (er hängt an einer Bindung aus
  `bootstrap.js`, die am ELEMENT klebt, nicht an der id).
- 💣 **`mountFeatureSourceEditor` erst NACH dem `innerHTML`**, und vorher
  `__fsDetachAutocomplete()` — die Vorschlagsliste hängt an `document.body`. Beim Aufteilen
  auf zwei Kästen darf diese Reihenfolge nicht verrutschen.
- 💣 **„Alle" ist ein LEERER `kind`-Parameter, kein Wert „all".** Der Katalog verwirft
  unbekannte Werte und täte damit versehentlich das Richtige — das ist kein Vertrag. Die
  Weiche steht schon in `avesmapsLoreFetchList`; der Reiter im Fenster fehlte bloß.
- 💣 **Die Zähler-Schleife kennt nur echte Arten.** `counts_by_kind` hat keinen Schlüssel
  `all`; ohne eigene Summe bliebe der Reiter dauerhaft leer. „?" statt „0", solange nichts
  bekannt ist — eine Summe über ein leeres Objekt behauptet „es gibt keine".
- ⚠️ **In „Alle" muss die Zeile ihre Art nennen.** „Bräubier" und „Bräuwurm" sind sonst
  nicht auseinanderzuhalten. Die Art steht als erstes Glied der Meta-Zeile, und **nur** in
  dieser Ansicht — in „Fauna" wäre „· Fauna" in jeder Zeile Lärm.
- ⚠️ **Kein Umbau am Speichern.** Die anderen Editoren haben eine Speicherleiste, hier
  speichert jedes Feld beim Verlassen. Das ist Verhalten, nicht Layout, und bleibt.
- ⚠️ **Die Art-Reiter bleiben in voller Breite** über allen drei Spalten (Spec §3.1: sie
  schalten den ganzen Editor um, nicht nur die Liste).
- 🔴 **`css/features/lore.css` enthält auch das öffentliche Infopanel** (`.avesmaps-lore*`)
  und den Regeleditor (`.lore-rule-*`). Nur der `.lore-dlg__*`/`.lore-detail__*`-Block
  wird angefasst.

## 5. Prüfen

- Unit: `js/review/__tests__/lore-dialog-layout.test.js` — Markup und CSS gegen die
  Zusagen oben (drei Spalten im Ruhezustand, Titel außerhalb der Kästen, „Alle" als
  erster Reiter, Art nur in „Alle").
- Vor dem Push das **ganze** Testfeld (AGENTS.md §9), nicht nur die eigenen Tests.
- Handbuch wird NICHT angefasst (Nachtroutine); die Commit-Betreffs nennen die sichtbare
  Wirkung.
