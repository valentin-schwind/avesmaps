# Landschaftsdialog — Übergabe an die nächste Sitzung

**Stand: 26.08.2026.** Alle drei Stufen sind gebaut und live. Was fehlt, ist die **Abnahme mit
angemeldeter Sitzung** — und genau die kann eine Agenten-Sitzung nicht leisten.

**Entwurf:** `docs/superpowers/specs/2026-08-25-landschaft-dialog-vereinigung-design.md`
**Bauplan:** `docs/superpowers/plans/2026-08-25-landschaft-dialog-vereinigung.md`
**Prototyp:** `docs/landschaft-dialoge-mockup.html` (Reiter „Vereinigung")

---

## 1. Was gebaut wurde

Fläche und Beschriftung werden in **einem** Fenster bearbeitet: `#landschaft-dialog-overlay`
(„Landschaft bearbeiten"). Die zwei alten Fenster `#label-edit-overlay` und
`#ecosystem-properties-overlay` sind aus `index.html` verschwunden.

| Teil | wo |
|---|---|
| **Hülle** (Öffnen/Schließen, Reiter, Kopf, Speichern, Datenlagen, Löschbezug) | `js/map-features/landschaft-dialog.js` |
| **Beschriftungs-Hälfte** (Felder) | unverändert `js/review/review-labels.js` |
| **Flächen-Hälfte** (Felder) | unverändert `js/map-features/map-features-ecosystem-properties.js` |
| **Stil** | `css/components/landschaft-dialog.css` + die 19 eigenen Regeln in `region-sync.css` |

🔴 **Die tragende Entscheidung: das Markup ZOG UM, es wurde nicht neu geschrieben.** Alle
Element-IDs (`label-edit-*`, `ecosystem-properties-*`) wanderten unverändert mit — deshalb laufen
die zwei Steuerungen (950 und 2075 Zeilen) fast unangetastet weiter. Wer hier etwas ändert, sollte
diese Eigenschaft nicht aufgeben.

**Aufbau:** gemeinsamer Kopf (Name · Art · Auto-Name) über drei Reitern — **Fläche ·
Beschriftung · Wiki & Quellen** — und EINER Knopfleiste.

---

## 2. Die neun Regeln, die man kennen muss

1. 💣 **Jeder Weg ins Fenster geht durch `avesmapsLandschaftDialogSichtbar`.** Dort werden Reiter
   und Knopfleiste verdrahtet. Wer `overlayElement.hidden` selbst setzt, öffnet ein Fenster, dessen
   Bedienelemente **allesamt tot** sind. *Diese Falle ist in einem Umbau DREIMAL zugeschnappt*,
   zuletzt vom Owner gemeldet („geht alles noch nicht"). Gewacht von
   `landschaft-dialog-trichter.test.js`.
2. 💣 **Text und Art stehen im Kopf, also AUSSERHALB des `<form>`**, und tragen deshalb
   `form="label-edit-form"`. `buildLabelEditPayload` liest sie über `new FormData(formElement)` —
   ohne das Attribut speichert der Dialog einen **leeren Namen**.
3. 💣 **„Speichern" schickt nur ANGEMELDETE Hälften ab.** Jede Hälfte meldet sich selbst an
   (`avesmapsLandschaftDialogHaelfte`). Beide blind zu schicken legte an einer Fläche ohne
   Beschriftung bei **jedem** Speichern eine neue an (`create_label` bei leerer `public_id`).
   Die **Fläche zuerst** — ihre Änderung propagiert ohnehin ans Label.
4. 💣 **„Löschen" bedeutet Verschiedenes.** Der Knopf heißt „Fläche löschen" bzw. „Beschriftung
   löschen" und ist im dritten Reiter verborgen. Das letzte Label einer Region nimmt Region UND
   Flächen mit; ein `berggipfel`-Label ist ein Stützpunkt des Höhenfelds.
5. 🔴 **Vier Zwillinge sind eingeschmolzen** (Name, Art, Nodix, Kurvenbeschriftung + Anzahl). Das
   Flächenmodul erreicht sie über **eine** Tabelle `AVESMAPS_ECO_ZWILLINGE` statt über umgeschriebene
   Lesestellen.
6. 🔴 **Die Quellen liegen an der BESCHRIFTUNG** (`entity_type='region'`). Der zweite Kasten der
   Fläche war live LEER (0 von 30 Flächen; `ecosystem` kommt in der Kartenpayload unter 6336
   Objekten nicht vor) und ist gefallen. ⚠️ Eine Fläche ohne Beschriftung kann damit keine Quellen
   tragen — 334 von 1026; offen benannt, nicht übersehen.
7. 🔴 **Der Einstieg ist ein PARAMETER**, kein gemerkter Zustand. `openLabelEditDialog` setzt
   „beschriftung" am Trichter; nur der Flächen-Öffner nennt „flaeche" ausdrücklich.
8. ⚠️ **Ein Reiter wird nie gesperrt.** Fehlt seine Hälfte, steht dort **ein** Satz und ein Angebot.
9. 🪤 **Ein Selektor auf eine abgeschaffte Kennung ist STILL.** Die 19 eigenen CSS-Regeln des
   Fensters und zwei `getElementById` zeigten nach dem Umzug ins Leere — Felder sprangen von 29 auf
   35 px, der Fokus blieb auf der Karte. Kein Fehler, keine Warnung.

---

## 3. 🔧 WAS OFFEN IST — und warum eine Agenten-Sitzung es nicht schließen kann

**Kein einziger Schreibvorgang lief je gegen die echte Datenbank.** Alles wurde im Browser
durchgeklickt, aber **ohne angemeldete Sitzung**: die Landschaften-Ebene lädt anonym keine Flächen,
und jeder Schreibweg braucht eine Fähigkeit. Der Flächenweg ließ sich nur über eine eingelegte
Attrappe im Bestand fahren (`AvesmapsEcosystemProperties.open`).

**Die Abnahmeliste für die nächste Sitzung — mit Editor-Sitzung, an einer echten Landschaft:**

- [ ] **Fläche mit Beschriftung**: Namen im Kopf ändern, „Speichern". Danach **beide** Zeilen
      nachsehen (`ecosystem_region.name` UND `map_features.text`). ⚠️ Das ist der wichtigste Punkt:
      die Reihenfolge „Fläche zuerst" ist noch nie unter Last gelaufen.
- [ ] **Art im Kopf ändern**, speichern, beide Zeilen prüfen. 💣 `avesmapsEcosystemAssertRegionType`
      lehnt eine ebenenfremde Art mit 400 ab — passiert das NACH einem erfolgreichen Label-Speichern?
- [ ] **Fläche ohne Beschriftung** öffnen → Reiter „Beschriftung" → **„Beschriftung anlegen"**.
      Erscheint die Meldung mit dem Punkt der Unzugänglichkeit? Steht die Beschriftung danach auf
      der Karte? 💣 Der Server lässt eine Region höchstens EIN primäres Label tragen — die Rücknahme
      in `createEcosystemRegionLabel` ist nie live gelaufen.
- [ ] **Ingvaltal oder Yaquirtal** (drei Beschriftungen) öffnen: erscheint die Wahl? Wechselt sie?
      Fragt sie zurück?
- [ ] **Löschen** in beiden Reitern bis zur Rückfrage — und dann **abbrechen**. Nennt die Rückfrage
      die Kaskade?
- [ ] **Quellen** an einer Landschaft eintragen und entfernen. Erscheinen sie in der Infobox?
- [ ] **Landschaften-Editor** (`html/landschaften-editor.html`): zeigt der Quellenkasten die Liste
      der Beschriftung? Steht bei einer Fläche ohne Beschriftung der Satz statt eines Feldes?

---

## 4. Was noch nicht schön ist

- ⚠️ **Der Löschknopf-Text wechselt beim Reiterwechsel** — richtig, aber ungewohnt. Wenn der Owner
  ihn lieber fest hätte, ist `avesmapsLandschaftDialogLoeschText` die eine Stelle.
- ⚠️ **Die Reihenfolge im Reiter „Fläche"**: „Landschaftsfläche / Gehört zu" steht vor dem
  Abschnitt „Fläche". Gewachsen, nicht entworfen.
- 🔧 **Der Titel** heißt je Ebene „Derographie-Label bearbeiten" o. ä. (Kennung `label-edit-title`),
  obwohl das Fenster jetzt beides bearbeitet. „Landschaft bearbeiten" wäre ehrlicher — aber ein Test
  nagelt die Ebenen-Titel fest, und der Owner hat dazu nichts gesagt.
- 🔧 Der Commit `de4b691a` hat **Lücken im Text**: Backticks in einer `-m`-Nachricht hat die Shell
  gefressen. Kein Force-Push zur Reparatur. **Lehre: Commit-Botschaften immer per Heredoc mit
  quotiertem Delimiter.**

---

## 5. Werkzeug-Fallen dieser Sitzung (teuer bezahlt)

- 💣 **Backslashes und Backticks überleben die Bash-Werkzeugkette nicht.** `\\r`, `\\n`, `\\(`
  landeten als echte Zeilenumbrüche bzw. verschwanden; Backticks wurden als Kommando ausgeführt.
  ⭐ **Für Dateiänderungen das Edit/Write-Werkzeug nehmen**, nicht `node -e` über Bash — oder ein
  Heredoc mit `<<'ENDE'` UND ohne Backslash-Sequenzen im Text.
- 💣 **`index.html` ist CRLF.** Zeilenweise arbeiten, `\r\n` beim Zusammenfügen.
- 💣 **Ein Dateipfad in einem Kommentar überholt einen `indexOf`-Test.** In HTML-Kommentaren
  Dateinamen ohne Verzeichnis nennen.
- 💣 **Kommentare vor jedem Zählen strippen** — und zwar mehrzeilig: ein Block mit `<div class=…>`
  als Text verfälscht jede Tiefenzählung.
- 💣 **`vm`-Sandkasten ist ein eigener Realm**: `deepStrictEqual([], [])` schlägt dort fehl.
- ⚠️ **Der Vorschauserver** läuft aus dem Worktree
  `C:/GIT/avesmaps/.claude/worktrees/label-kompakt` auf Port **8973** (Eintrag
  `label-dialog-kompakt` in `.claude/launch.json`). Der Worktree steht noch; er darf weg, sobald der
  Owner ihn nicht mehr braucht (`git worktree remove`).

---

## 6. Testfeld

288 JS-Tests, 296 PHP-Tests. Vorbestehend rot: **nur** `linkcheck/link-url-test.php` (echter
DNS-Abruf). Neu in dieser Arbeit:

`landschaft-dialog-reiter` · `-speichern` · `-lagen` · `-geschwister` · `-einstieg` · `-trichter`
