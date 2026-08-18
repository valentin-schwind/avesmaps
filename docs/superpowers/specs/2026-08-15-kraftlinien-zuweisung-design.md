# Kraftlinien-Zuweisung — Design

**Datum:** 2026-08-15 · **Auftraggeber:** Owner · **Auslöser:** Discord-Fall **#71**, zweite Hälfte
(„Außerdem verwenden sie nicht das Zuweisungssystem, wie die andern Features (Wege, Flüsse, …)")
**Bezug:** `docs/superpowers/specs/2026-07-23-kraftlinien-editor-design.md` (der Editor, in den das
hier einzieht) · `docs/konfliktmanagement-design.md` · AGENTS.md §5 (eine Ablage, kein zweites
System), §8 (Sprache), §12 (Designsprache)
**Vorgeschichte:** Die erste Hälfte von #71 — die Konfliktregel war blind für den Kraftlinien-Link
und zählte je Segment — ist am 15.08.2026 mit `fb8a4985` erledigt.

---

## 1. Ausgangslage, gemessen

Alle Zahlen sind am Livebestand vom **15.08.2026** erhoben (ein Abruf von
`GET /api/app/map-features.php`), die Wiki-Seite über einen Abruf von
`list=embeddedin&eititle=Vorlage:Infobox Kraftlinie`.

| | |
|---|---|
| Kraftlinien-Segmente auf der Karte | 162 (davon 6 namenlose `Kreuzung - …`) |
| Linien (Segmente mit gleichem Namen) | 55 |
| davon mit Wiki-Link | 18 |
| davon ohne | **37** |
| Kraftlinien-Artikel im Wiki | **23** |
| Artikel ohne Kartenlinie (nach Namensschlüssel) | bis zu 6 |

🔴 **Die entscheidende Messung: 0.** Es gibt **keine einzige** Kartenlinie, deren Name auf einen
Wiki-Artikel passt und die trotzdem unverknüpft wäre. Der Namensabgleich ist damit **erschöpft** —
er hat geholt, was er holen kann. Jede weitere Verknüpfung braucht eine Zuweisung von Hand. Das ist
die Existenzberechtigung dieses Entwurfs, und ohne sie wäre er nicht zu rechtfertigen.

**Woran es heute scheitert.** `avesmapsWikiPowerlineReconcile()`
(`api/_internal/wiki/powerlines.php`) verbindet Wiki und Karte **allein** über
`avesmapsWikiSyncCreateMatchKey($name)`. Der Editor hat zwar ein Feld „Wiki-Link"
(`#plWikiUrl` in `html/wiki-sync-powerline-editor.html`, geschrieben nach `properties.wiki_url` über
`action: update_powerline_line`) — **der Abgleich liest es nie**. Wer es ausfüllt, setzt einen Link
und bekommt keine Wiki-Daten: keine Stärke, keine Affinität, keine Länge, keine Regionen, keinen
Verlauf. Genau das war die Meldung.

**Die echte Arbeitsliste** ist klein und besteht aus Beinahe-Treffern:

| Karte | Wiki | Warum der Namensschlüssel danebengeht |
|---|---|---|
| Brücke **nach** Akrabaal (2 Segmente) | Brücke **von** Akrabaal | `brckenachakrabaal` ≠ `brckevonakrabaal` |
| Satinavs Kette **I** (6) + Satinavs Kette **II** (6) | Satinavs Ketten *(Kraftlinien)* | **ein Artikel, zwei Linien** — mit einem Namensband nie erreichbar |
| Hexenband**(-schleife)** (4) | Hexenband | der Artikel gehört bereits „Hexenband" (6 Segmente) |

Die übrigen Wiki-Waisen — *Schimmelader*, *Sternentreppe*, *Kraftlinie zwischen Himmelsturm und
Heiligtum der alten Götter* — haben auf der Karte kein Gegenstück; sie sind gezeichnet-noch-nicht,
kein Zuordnungsproblem.

⚠️ **Die Waisenliste oben ist über die SEITENTITEL gerechnet, der Abgleich rechnet über das
Infobox-Feld `Name`** (mit Rückfall auf den Titel). Beide gehen auseinander — „Elementare
Schlüssellinien" steht in der Titel-Rechnung als Waise, während auf der Karte
„Schlüssellinie des Eises" verknüpft ist. Maßgeblich ist deshalb allein das, was der Abgleich selbst
unter `unmatched_names` zurückgibt. **Dass diese Zahl heute nirgends auf dem Bildschirm steht, ist
Teil des Problems** (§6).

## 2. Owner-Entscheidungen (15.08.2026)

1. 🔴 **Eine Zuweisung fasst den Kartennamen NICHT an.** Bei den Wegen benennt
   `avesmapsWikiPathAssignTo` den Weg auf den kanonischen Wiki-Namen um (Regel R1); hier ist das
   ausgeschlossen. Grund: bei den Kraftlinien **IST der Name das Band**, das die Segmente einer Linie
   zusammenhält („Linie = alle ihre Segmente", Editor-Entwurf §2). Ein Umbenennen auf den Artikeltitel
   würde „Satinavs Kette I" und „II" zu **einer** Linie verschmelzen und „Hexenband(-schleife)" im
   „Hexenband" auflösen — eine sichtbare Kartenänderung als Nebenwirkung einer Verwaltungshandlung.
2. **Ein dritter Zustand „kein Wiki-Artikel vorhanden"**, der die Linie dauerhaft aus der
   Konfliktliste nimmt.
3. **Das Wiki fasst nach:** taucht später doch ein passender Artikel auf, macht der Abgleich die
   Markierung wieder auf und meldet es.

## 3. Datenmodell — kein neues Feld

Der Zustand einer Linie ist **dreiwertig** und wird aus zwei bereits vorhandenen Feldern gelesen:

| Zustand | Woran erkennbar |
|---|---|
| **offen** | `properties.wiki_url` leer **und** `properties.wiki_no_article` nicht gesetzt |
| **zugewiesen** | `properties.wiki_url` gesetzt |
| **kein Artikel** | `properties.wiki_no_article === true` |

💣 **Es wird KEIN neues Feld eingeführt, und das ist eine Entscheidung, keine Bequemlichkeit.**
Beide Felder existieren, beide schreibt der Editor bereits auf alle Segmente einer Linie, beide kennt
das Konfliktzentrum: `wiki_url` als den einzigen *löschbaren* Anspruch
(`AVESMAPS_CONFLICT_CLAIM_FIELD`), `wiki_no_article` als die negative Aussage, die Fall #38
geschlossen hat (`AVESMAPS_CONFLICT_NO_ARTICLE_FLAG`, beide in
`api/_internal/conflicts/repair.php`). Ein eigenes `wiki_powerline_claim` daneben wäre exakt der
Fehler, den AGENTS.md §5 an der Lore-Quellen-Tabelle beschreibt: ein zweites System für eine Frage,
die schon eine Ablage hat.

🔴 **Was der Abgleich schreibt, bleibt strikt getrennt.** `properties.wiki_powerline` gehört ihm
allein („Touches ONLY properties.wiki_powerline", `powerlines.php`). Die Zuweisung ist die
**Entscheidung**, das Nest sind die **Daten**. Keine Seite fasst die andere an — dieselbe Trennung,
auf der das Konfliktzentrum steht (Befunde werden gerechnet, Entscheidungen gespeichert).

⚠️ **Die Zuweisung steht pro Segment**, wie `description`, `show_label` und der Name auch. Ein später
neu gezeichnetes Segment erbt sie nicht; der Editor ist das, was eine Linie gleich hält (Editor-Entwurf
§3, „Regel für alle Linien-Schreibvorgänge"). Kein Sonderweg für dieses Feld.

## 4. Der Abgleich

`avesmapsWikiPowerlineReconcile()` bekommt eine **Rangfolge** statt eines einzigen Schlüssels. Je
Segment, in dieser Reihenfolge:

1. **Zuweisung** — `properties.wiki_url` zeigt auf einen gestagten Artikel → **der gilt**, unabhängig
   vom Namen.
2. **Name** — `avesmapsWikiSyncCreateMatchKey($name)` trifft einen gestagten Artikel → wie bisher.
3. **nichts** — das Nest wird zurückgezogen (`cleared`), wie bisher.

💣 **Verglichen wird über `avesmapsConflictArticleKey()`, nicht über die rohe Adresse.** Sonst
verfehlen sich `Feste_Hohenstein` und `Feste%20Hohenstein` — dieselbe Falle, die im Konfliktzentrum
schon einmal gestellt wurde (`docs/konfliktmanagement-design.md`). Die Funktion steht in
`api/_internal/conflicts/core.php` und wird hier **wiederverwendet**, nicht nachgebaut.

⚠️ **Eine Adresse, die auf keinen gestagten Artikel zeigt, ist kein Fehler und keine Zuweisung.**
Sie kann ein brandneuer Wiki-Artikel sein, den der letzte Dump nicht kannte, oder eine fremde Quelle.
Das Segment fällt auf Stufe 2 zurück und die Adresse bleibt unangetastet stehen — sie wird **nie**
überschrieben und **nie** gelöscht.

💣 **Und genau hier entsteht ein stilles Loch, deshalb ist die Meldung tragend.** Für §3 und für das
Konfliktzentrum ist die Linie **zugewiesen**, sobald `wiki_url` gefüllt ist — ein Tippfehler nimmt
sie also aus der Beobachtungsliste, während der Abgleich weiterhin nichts holt. Die Linie sähe
erledigt aus und wäre es nicht. Der Lauf zählt solche Fälle als **`claims_unresolved`**, und diese
Zahl **muss in der Oberfläche landen** (§6), nicht nur in der Antwort stehen: eine Zahl, die niemand
sieht, ist dasselbe wie keine Zahl. Das Feld wird schon benutzt: **zwei Linien** („Hexenband",
„Elementares Hexagramm", je 6 Segmente) tragen bereits eine von Hand gesetzte Adresse. Beide lösen
sich auf, weil ihr Name ohnehin trifft — aber der Weg ist beschritten, und der erste Tippfehler
darauf wäre unsichtbar.

### Zwei Meldungen, die es heute nicht gibt

🔴 **Artikel verschwunden.** Ist eine Linie zugewiesen und der Artikel steht nicht mehr im Dump, wird
das **Nest** zurückgezogen (die Daten sind ungültig), die **Zuweisung aber nicht** — sie ist die
Entscheidung eines Menschen und wird nicht von einem Lauf kassiert. Gemeldet als
`claims_orphaned` mit Linienname und Adresse.

🔴 **Artikel aufgetaucht** (die Nachfass-Zusage aus §2.3). Trägt eine Linie `wiki_no_article` und der
Dump enthält einen Artikel, dessen Namensschlüssel auf sie passt, **löscht der Lauf die Markierung**
und meldet es als `no_article_reopened`. 💣 **Er weist NICHT von selbst zu.** Nach einem Namen zu
raten und daraus echte Daten zu machen ist die Fehlerklasse aus Discord #38; die Markierung
aufzumachen stellt nur die Frage neu, die ein Mensch beantwortet.

⚠️ Damit ist `wiki_no_article` bei den Kraftlinien **nicht dauerhaft** — es hält bis zum nächsten
Wiki-Fund. Das ist gewollt und muss in der Oberfläche so dastehen („bis im Wiki etwas auftaucht"),
sonst liest es sich als endgültig und die Wiedervorlage wirkt wie ein Fehler.

## 5. Das Konfliktzentrum

`avesmapsConflictRuleMissingKey()` (`api/_internal/conflicts/rules.php`) überspringt künftig Zeilen
mit `wiki_no_article`.

💣 **Heute beachtet diese Regel den Merker für NIEMANDEN** — nicht für Orte, nicht für Wege, nicht
für Kraftlinien. Der Beleg steht im Livebestand: **eine Kraftlinie trägt den Merker bereits** und
steht trotzdem auf der Beobachtungsliste. Jemand hat sie über den Knopf „Kein Wiki-Eintrag"
stillgelegt, und sie kam zurück — ohne dass das je jemandem aufgefallen wäre, weil beides in
verschiedenen Fenstern steht.

⚠️ **Die Änderung gilt für alle Objektarten, nicht nur für Kraftlinien.** Reichweite gemessen:
**6 Objekte** tragen den Merker (5 Orte, 1 Kraftlinie), alle 6 ohne Link. Es verstummen also genau
diese sechs Einträge, keine Überraschung anderswo. Die Zahl gehört in den Bauplan, damit niemand die
Regeländerung für riskanter hält, als sie ist.

**Rechnung:** 37 offene Kraftlinien-Fälle → nach den ~4 Zuweisungen und den Markierungen bleibt
praktisch nichts offen, und die Wiki-Waisen werden zum ersten Mal sichtbar.

## 6. Die Oberfläche

Alles im **Kraftlinien-Editor** (`html/wiki-sync-powerline-editor.html`), Spalte
**„Eigenschaften"** — dort steht die Linie schon mit allem, was zu ihr gehört. Kein neues Fenster,
kein zweiter Ort.

**Aus dem Feld „Wiki-Link" wird eine Zuweisung.** Es bleibt ein Textfeld — Einfügen einer Adresse
muss weiter gehen —, bekommt aber eine **Vorschlagsliste** über die bekannten Kraftlinien-Artikel
(Name + Adresse). Darunter ein Häkchen **„kein Wiki-Artikel vorhanden"**.

**Neu daneben: die Gegenrichtung.** Eine kurze Liste „Wiki-Linien ohne Kartenlinie" aus
`unmatched_names` des letzten Laufs. Ohne sie weiß niemand, dass „Brücke von Akrabaal" auf eine
Zuweisung wartet — heute steht diese Liste nur in der Antwort des Sync-Aufrufs und verfällt mit ihr.

Dazu die Zahl aus §4: **wie viele Zuweisungen ins Leere zeigen** (`claims_unresolved`). Steht sie
auf 0, schweigt sie.

**Woher die Vorschläge kommen — kein neuer Endpunkt.** Der vorhandene
`GET /api/edit/map/powerlines.php` (Fähigkeit `edit`) bekommt zwei weitere Schlüssel in derselben
Antwort: `wiki_articles` (die gestagten Kraftlinien-Artikel) und `dump_state` (Zustand des letzten
Laufs, für den Hinweis unten). Der Editor holt diese Antwort ohnehin einmal beim Öffnen; ein zweiter
Aufruf wäre ein zweiter Rundweg für 23 Zeilen. Gelesen wird aus **derselben Quelle wie der Abgleich**
(`avesmapsWikiDumpSyncKindFetchRows(..., [AVESMAPS_WIKI_DUMP_ENTITY_POWERLINE], ...)`), nicht aus
einer zweiten — sonst könnten Vorschlagsliste und Abgleich verschiedener Meinung sein.

**Womit geschrieben wird — kein neuer Endpunkt.** Die Zuweisung geht den Weg, den das Feld heute
schon geht: `POST /api/edit/map/features.php`, `action: update_powerline_line`, das auf **alle**
Segmente des Namens schreibt. Diese Aktion muss `wiki_no_article` mit annehmen (heute kennt sie es
nicht) und die Widerspruchsprüfung aus §7 tragen.

💣 **Eine leere Vorschlagsliste sieht aus wie „es gibt keine Artikel", heißt aber fast immer
„es wurde noch kein Dump geholt".** Der Zwischenspeicher ist erst nach einem gelaufenen „Dump holen"
gefüllt; genau daran ist der Abgleich schon einmal gescheitert („Keine Kraftlinien im
Zwischenspeicher", `powerlines.php`). Der Leseweg gibt deshalb den Zustand des Laufs mit zurück, und
die Oberfläche sagt den Unterschied ausdrücklich an, statt eine leere Liste zu zeigen.

### Designsprache

Die Zeile folgt der Nachbarschaft, in der sie steht (AGENTS.md §12): Beschriftungen wie die übrigen
`dt-grid`-Zeilen des Editors, das Häkchen als gewöhnliches Bedienelement, **kein gefüllter
Akzentknopf** — die Haupthandlung des Fensters ist „⚡ Kraftlinien syncen", und was in einer
Eigenschaftszeile steht, ist weich/outline. Farben, Radien und Trenner ausschließlich aus
`css/base/tokens.css`.

## 7. Fallen

- 💣 **Ein Artikel darf zu MEHREREN Linien gehören.** „Satinavs Ketten" ist ein Artikel für „Kette I"
  und „Kette II". Das Konfliktzentrum wertet `powerline|powerline` seit `fb8a4985` als legitim
  (`AVESMAPS_CONFLICT_SEGMENTED_TYPES`) — ohne diese Vorarbeit hätte die erste Doppelzuweisung sofort
  einen Fehler-Eintrag erzeugt. Die Zuweisung darf sie also **nicht** verbieten.
- 💣 **Zuweisung UND „kein Artikel" gleichzeitig ist ein Widerspruch.** Er wird **abgelehnt**, nicht
  aufgelöst: der Server weist den Schreibvorgang mit einer Begründung zurück, statt still eines von
  beidem gewinnen zu lassen. Ein stummer Vorrang wäre eine Regel, die niemand kennt und die je nach
  Leser anders ausfällt — der Merker sitzt im Editor, im Konfliktzentrum und im Abgleich.
- 💣 **`wiki_no_article` wird auch vom Konfliktzentrum geschrieben** (Knopf „Kein Wiki-Eintrag"),
  nicht nur vom Editor. Beide setzen dasselbe Feld auf dieselbe Bedeutung; der Editor zeigt also
  auch, was jemand drüben entschieden hat. Das ist gewollt — aber wer die Bedeutung hier ändert,
  ändert sie dort mit.
- ⚠️ **Der Namensabgleich bleibt.** Er wird nicht ersetzt, nur überstimmt. 18 Linien hängen an ihm;
  ihn abzuschalten würde 18 Zuweisungen von Hand nachfordern, um den Stand von heute zu halten.
- ⚠️ **`AVESMAPS_POWERLINE_LAST_SYNCED_SETTING` bleibt unberührt.** Der Zeitstempel gehört dem Lauf,
  nicht der Zuweisung.
- 🪤 **Der Editor lädt sein iframe mit `?v=Date.now()`**, seine verlinkten Dateien aber über den
  Deploy-Stempel. Wer nur die CSS/JS anfasst, muss sich an §7 halten — hier gilt **nicht** der
  `ASSET_VERSION`-Weg des Territorien-Editors, sondern der normale Stempel.

## 8. Abnahme

**Tests (neu):**

- `api/_internal/wiki/__tests__/powerline-claim-test.php` — die Rangfolge aus §4 als reine Funktion:
  Zuweisung schlägt Namen · Name greift ohne Zuweisung · unauflösbare Adresse fällt auf den Namen
  zurück und wird gezählt · verschwundener Artikel zieht das Nest zurück und **behält** die Zuweisung
  · `wiki_no_article` + passender Artikel im Dump ⇒ Markierung weg, **keine** Zuweisung gesetzt
  · eine Adresse ohne Entsprechung erhöht `claims_unresolved` **und** bleibt unangetastet stehen.
- `api/_internal/conflicts/__tests__/conflict-rules-test.php` (Erweiterung) — eine Zeile mit
  `wiki_no_article` erscheint nicht mehr unter `wiki.missing_key`.
- Widerspruchsprobe: Zuweisung + Häkchen zusammen ⇒ Ablehnung mit Begründung.

**Ablauf, nicht Maß** (AGENTS.md §9): vor „fertig" wird im Editor eine Linie wirklich zugewiesen,
eine wirklich markiert, der Abgleich wirklich angestoßen und die Infobox der Linie auf der Karte
wirklich geöffnet. Der Abnahmefall ist **„Brücke nach Akrabaal" → „Brücke von Akrabaal"**: danach
muss die Infobox Stärke, Affinität, Länge, Regionen und Verlauf zeigen, ohne dass die Linie ihren
Namen geändert hat.

**Vor dem Push** läuft das ganze Testfeld, nicht nur das eigene (AGENTS.md §9).

## 9. Nicht in dieser Fassung

- 🪤 **Kein Massen-Zuweisen — GILT NICHT MEHR, revidiert am 18.08.2026.** Der Satz lautete:
  *„Es gibt kein `assign_all` wie bei den Wegen. Bei 23 Artikeln und einer Arbeitsliste von etwa vier
  Fällen wäre die Maschinerie größer als die Arbeit — und Sammelaktionen mit Entscheidungsgehalt sind
  ohnehin ausgeschlossen (Owner 2026-07-20)."*

  Gebaut wurde er trotzdem (`ce9fee27`), und das ist eine Owner-Entscheidung, keine Nachlässigkeit —
  aber die Begründung gehört hierher, weil der Satz oben sonst weiter das Gegenteil behauptet:

  1. **Die Arbeitsliste war nicht vier, sondern 16.** Am 18.08.2026 live gemessen: 62 Namensgruppen,
     2 zugewiesen, **16 mit wortgleichem Katalogtreffer** über 69 Segmente. Die „etwa vier" waren die
     Ähnlichkeitsfälle, nicht die Treffer.
  2. **Der Lauf hat keinen Entscheidungsgehalt** — und genau daran hängt die Vereinbarkeit mit
     „jeder Fall wird einzeln entschieden" (Owner 2026-07-20, `docs/konfliktmanagement-design.md`).
     Er fasst **ausschliesslich** an, was `avesmapsWikiSyncCreateMatchKey` wortgleich trifft. Jeder
     Ermessensfall bleibt liegen: „Brücke nach/von Akrabaal", „Satinavs Kette I/II", die
     Klirrfrostsaite. ⚠️ **Wer den Lauf je auf ähnliche Treffer ausweitet, bricht die Regel** — dann
     gilt der ursprüngliche Satz wieder, und zwar sofort.
  3. Vorschau vor jedem Schreiben, übersprungene Fälle namentlich, der Owner drückt.

  💣 **Und die Zahl, an der sich zwei Systeme widersprechen:** „Hexenband(-schleife)" sieht wie ein
  17. Treffer aus, ist aber keiner — `avesmapsWikiSyncStripParentheticalSuffix` faltet einen
  Klammerzusatz nur mit **Leerzeichen** davor weg. Gemessen: `Hexenband(-schleife)` →
  `hexenbandschleife`, `Hexenband (-schleife)` → `hexenband`. Ein Zeichen entscheidet, ob die Linie
  den Artikel von „Hexenband" beansprucht.
- 🔧 **Keine Übernahme-Vorschau.** Der Kraftlinien-Abgleich hat keine
  `sync_plan_item`-Anbindung; sie nachzurüsten ist ein eigener Auftrag (Sitzung 5 der
  Übernahme-Vorschau), kein Anhängsel hier.
- 🔧 **Kein Zusammenführen zweier Linien.** Das kann der Editor bereits über das Umbenennen
  („Umbenennen IST Zusammenführen", Editor-Entwurf §3) und bleibt bewusst getrennt von der Zuweisung
  — das ist die Trennung aus §2.1.
- 🔧 **Die Wiki-Waisen ohne Kartenlinie** (*Schimmelader*, *Sternentreppe*, …) werden nur angezeigt.
  Aus einem Artikel eine Linie zu zeichnen, ist Kartenarbeit, keine Zuweisung.
