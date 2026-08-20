# Die Suche findet auch, was nicht auf der Karte steht

> Entwurf, 20.08.2026. Owner-Auftrag: „Kannst du Orte, Regionen, Länder etc., die
> nicht auf der karte sind, trotzdem in der suche auffindbar machen".

## 1. Das Problem

Die Kartensuche (`GET /api/app/map-search.php`, Spotlight) zieht heute aus **sechs**
Töpfen: Kartenobjekte (`map_features`), Herrschaftsgebiete, Innerorts-Objekte,
Kartensammlung, Literatur und Vorkommen.

Wer nach einem Ort sucht, den das Wiki kennt, den aber niemand auf unsere Karte
gesetzt hat, bekommt **nichts** — keinen Treffer, keinen Hinweis, keine Spur. Für
die Suche existiert das Ding nicht. Dasselbe gilt für Landschaften, Wege und
Herrschaftsgebiete ohne Fläche.

Der dritte Topf — die Innerorts-Objekte (`in-settlement-search.php`, live seit
27.07.2026) — löst genau dieses Problem schon einmal, aber nur für Objekte
**innerhalb** einer Stadt: 525 Bauwerke + 10 Wege, die keine eigene Kartenposition
haben, aber eine Stadt, und die Stadt liegt auf der Karte. Ihr Treffer sagt
„Palast in Mengbilla · Innerorts", der Klick fliegt zur Stadt.

**Dieser Entwurf ist die Verallgemeinerung dieses Musters auf alles außerhalb von
Städten.** Er erfindet keine neue Trefferform und keinen zweiten Navigationsweg.

## 2. Owner-Entscheide (20.08.2026)

🔴 **Der Klick springt hin, soweit wir wissen, wo das Ding liegt.** Ein Ort zu
seiner Region, eine Region zu ihrem Land. Daneben die Infobox mit dem, was das
Wiki hergibt, samt Link zum Artikel. Ist der Ort unbekannt, bleibt nur die Infobox
— die Karte bewegt sich dann nicht.

🔴 **Umfang: alles, was einen Platz in der Welt hat.** Orte, Regionen, Länder,
Wege, Gewässer, Gebirge, Burgen, Tempel, Akademien. **Nicht** Personen, Gottheiten
oder Organisationen — eine Person hat keinen Ort, der Klick könnte nirgends
hinspringen, und aus der Kartensuche würde ein Wiki-Sucher.

🔴 **Die neuen Treffer stehen UNTER den Kartentreffern**, nie davor. Ein Ort, den
man anspringen kann, ist mehr wert als einer, den man nur nachlesen kann.

Freigegeben am Mockup (siehe §5), wörtlich: „genauso".

## 3. Die Datenlage — was da ist und was fehlt

Das ist der Kern dieses Entwurfs. Für jede Objektart wurden zwei Fragen am Code
beantwortet: **woher kommen die Zeilen** und **woher kommt das Sprungziel**.

| Art | Quelle | Sprungziel | Zustand |
|---|---|---|---|
| Siedlungen | `wiki_sync_pages` (`settlement_class` ≠ `gebaeude`) | `region` / `staat` der Infobox | ⚠️ **wird geparst, aber verworfen** — siehe §3.2 |
| Bauwerke, Stätten | `wiki_sync_pages` (`settlement_class = 'gebaeude'`) | `standort` (roh, aus der Bauwerks-Infobox) | ✅ vorhanden; die Innerorts-Suche liest es bereits |
| Landschaften, Regionen | `wiki_region_staging` | `region_parent` + `affiliation_staat` | ✅ vorhanden, eigene Spalten |
| Herrschaftsgebiete (Wiki) | `wiki_territory_model` | `parent_wiki_key` | ✅ vorhanden |
| Herrschaftsgebiete (eigene, ohne Fläche) | `political_territory` | `parent_id` | ✅ vorhanden — aber heute aus der Suche ausgeschlossen, siehe §3.3 |
| Wege, Flüsse | `wiki_path_staging` | `lage_raw` | ✅ vorhanden |

### 3.1 💣 `details_json` ist genau für die falsche Hälfte gefüllt

`wiki_sync_pages.details_json` trägt die geparste Orts-Infobox — und darin steckt
`lage` (`region · staat`), also exakt das Sprungziel, das wir suchen.

Die Spalte wird an **zwei** Stellen geschrieben
(`avesmapsWikiSettlementCacheDetails`, `settlements.php:869` und `:1368`), und
**beide sind Zuweisungspfade**: sie füllen den Cache in dem Moment, in dem eine
Wiki-Seite mit einem Kartenobjekt verbunden wird. Eine Wiki-Seite **ohne**
Kartenobjekt kommt dort nie vorbei.

⚠️ Wer das Sprungziel in `details_json` sucht, findet es also **systematisch nicht**
— nicht „manchmal leer", sondern bei der ganzen Zielmenge dieses Features leer.
Das sieht in einer Stichprobe aus wie ein Datenproblem und ist in Wahrheit die
Definition der Spalte.

### 3.2 ⭐ Der Dump rechnet das Ziel bereits aus und wirft es weg

`avesmapsWikiSettlementParseInfobox` (`settlements.php:588`) liefert `region`,
`staat` und das fertig zusammengesetzte `lage`. Der Dump-Lauf ruft diesen Parser
für **jede** Ortsseite auf (`dump-entity-scan.php:634`) — und baut danach einen
`$record`, in dem `region`, `staat` und `lage` **nicht vorkommen**. Die Werte
existieren zur Laufzeit und werden nicht gespeichert.

Der Eingriff ist deshalb klein und sitzt an der richtigen Stelle: **eine Spalte an
`wiki_sync_pages`, eine Zeile im `$record`, eine Zeile im Upsert.** Kein neuer
Parser, keine zweite Wahrheit, kein zusätzlicher Wiki-Abruf.

💣 **Es darf kein on-demand-Abruf in den Suchpfad.**
`avesmapsWikiSettlementBuildFromTitle` holt den Wikitext live aus dem Wiki. Die
Suche ist der heißeste öffentliche Pfad der Seite (sie feuert pro Tastendruck,
entprellt) — ein Wiki-Abruf dort ist die Sorte Last, die am 17.07.2026 den
PHP-Pool lahmgelegt hat (AGENTS.md §10). Das Sprungziel muss in einer Spalte
stehen, bevor gesucht wird.

### 3.3 💣 Ein Herrschaftsgebiet ohne Fläche fällt heute am JOIN heraus

`avesmapsFetchPoliticalTerritorySearchRows` (`map-search.php:160`) verlangt
`JOIN political_territory_geometry g ON g.territory_id = st.node_id AND g.is_active = 1`.
Ein Gebiet, das weder selbst noch irgendwo in seinem Unterbaum eine gezeichnete
Fläche hat, verlässt die Suche — **obwohl es in unserer eigenen Tabelle steht, mit
Namen, Rang, Eltern und Wiki-Verweis**.

🪤 **Das ist kein Versehen.** Der Kommentar über der Abfrage sagt den Grund
wörtlich: „Geometrielose Gebiete (auch ohne Nachfahren-Geometrie) fallen raus
(nichts zum Anspringen)." Die Entscheidung war richtig, solange ein Suchtreffer
zwingend ein Flugziel brauchte. **Genau diese Voraussetzung hebt dieses Feature
auf** — ein Treffer darf jetzt zum Elterngebiet springen oder nur die Infobox
öffnen. Die Zeile fällt also nicht, weil sie falsch war, sondern weil ihre
Begründung entfällt; und sie wird durch die zwei Hinweistexte aus §5 ersetzt, nicht
ersatzlos gestrichen.

Das ist eine **zweite** Klasse von „nicht auf der Karte", und sie ist nicht
Wiki-only: wir kennen das Gebiet, wir zeichnen es nur nicht. Sie gehört in dieses
Feature, weil der Owner-Auftrag „Länder" ausdrücklich nennt, und sie ist billiger
als alle anderen — die Zeilen liegen bereits in `political_territory`, und
`parent_id` liefert das Sprungziel ohne jede Zusatzspalte.

### 3.4 Die Mengen sind ungemessen

🔧 **Wie viele Zeilen je Art anfallen, ist nicht bekannt.** Auf der
Entwicklungsmaschine gibt es keine `api/config.local.php` und keinen lokalen Dump;
jede Zahl hier wäre geraten. Die Ortsliste des Editors zählt die Menge bereits
(`wiki_only` in `avesmapsWikiSettlementListRegistry`) — sie wird **vor** dem Bau
einmal live abgefragt, und der Bauplan trägt die Zahlen nach.

⚠️ Das ändert die Gestaltung nicht, aber es entscheidet über die Deckelhöhe (§4.3)
und darüber, ob eine Art überhaupt lohnt.

## 4. Die Lösung

### 4.1 Eine siebte Quelle, gebaut wie die dritte

Neue Bibliothek `api/_internal/app/offmap-search.php`, Vorbild
`in-settlement-search.php`. Sie liefert Zeilen in der Form:

```
{ name, type_label, place_label, place_target, wiki_url, kind }
```

- `name` — der gesuchte Titel
- `type_label` — die Art („Burg", „Baronie", „Gebirgspass")
- `place_label` — wo es liegt („Weiden"), leer wenn unbekannt
- `place_target` — worauf der Klick zielt (aufgelöstes Kartenobjekt) oder `null`
- `kind` — Objektart, für das Symbol

💣 **Der reine Teil bleibt DB-frei.** Wie bei `in-settlement-search.php` ist alles
außer den Abfragen eine reine Funktion, damit ein Test sie ohne MySQL fahren kann —
das Einzige, was auf dieser Maschine beweisbar ist.

**Wie aus dem Rohwert ein Sprungziel wird.** Die Quellspalten sind verschieden
geformt: `standort` trägt rohes Wiki-Markup („[[Gareth]]: [[Arenaviertel]]"), `lage`
ist bereits geputzt und zusammengesetzt („Garetien · Mittelreich"), `region_parent`
und der Elternname eines Gebiets sind blanke Namen. Alle drei Formen liefern
Kandidaten in Nennungsreihenfolge; der erste, der auf der Karte liegt, gewinnt.

🪤 **Dieser Absatz stand bis zum 20.08.2026 falsch hier** — er nannte
`avesmapsPlaceScopeClassifyWithIndex` als Auflöser. Die Funktion gibt ein Ziel aber
**nur heraus, wenn es eine SIEDLUNG ist** (`place-scope.php:316`): sie ist gebaut
für die Frage „in welcher Stadt liegt dieses Bauwerk". Die Sprungziele dieses
Features sind überwiegend Regionen und Länder — für die hätte sie ausnahmslos leer
geliefert, und **jeder** Treffer wäre im „kein Ort auf der Karte"-Zweig gelandet.
Gefunden beim Bau, bevor eine Zeile davon abhing.

💣 **Es sind zwei Fragen, und sie brauchen zwei Werkzeuge:**

| Frage | Werkzeug | Rolle |
|---|---|---|
| „Liegt das innerorts?" | `avesmapsPlaceScopeClassifyWithIndex` | **Ausschluss** — `inside` gehört der dritten Quelle |
| „Welches Kartenobjekt ist gemeint?" | `avesmapsOffmapResolvePlace` (neu) | **Auflösung** — gegen den Ziel-Index |

⚠️ Der Fall `unklar` bleibt **drin**, nur ohne Sprungziel: dort weiß niemand, ob
eine Stadt oder ein Gebiet gemeint ist, und ein Treffer ohne Ziel ist besser als
gar keiner.

💣 **EIN Index für die ganze Anfrage, nie einer je Zeile.** `settlements.php:1444`
schreibt genau das als Regel hin, und der Grund ist STRATO: die Suche ist der
heißeste Pfad der Seite. Derselbe Grund verbietet eine zusätzliche Ortsabfrage —
die Auflösung läuft gegen die `map_features`, die der Endpunkt ohnehin schon
geladen hat.

⚠️ **Bleibt der Rohwert unauflösbar, ist das Sprungziel `null`** — nicht der
Rohtext als Anzeige. Ein „liegt in [[Kosch]]", das nirgendwo hinführt, ist die
Sorte Halbwahrheit, die §5 mit dem zweiten Hinweistext ausschließt.

### 4.2 💣 „Liegt auf der Karte?" ist EINE Rechnung, und sie steht schon da

`avesmapsWikiSettlementListRegistry` (`settlements.php:1440–1655`) entscheidet
diese Frage bereits, und zwar so: ein Index `$mapKeys` aus
`avesmapsWikiSyncCreateMatchKey($name)` **aller** Kartenobjekte, **plus** dem
Match-Key jedes zugewiesenen `wiki_settlement.title` — der zweite Teil ist tragend,
sonst gilt eine Seite als wiki-only, sobald der Kartenname vom Wiki-Titel abweicht.

🔴 **Diese Rechnung wird aufgerufen, nicht nachgebaut.** Eine eigene, strengere
Fassung meldet gepflegte Objekte als fehlend — dieselbe Lehre wie bei den
verwaisten Außenhüllen (AGENTS.md §11: „‚Hat Quellen?' ist EINE Rechnung, und sie
muss DIESELBE sein wie im Layer"). Der gemeinsame Teil wandert dafür in eine
Funktion, die beide Seiten aufrufen.

💣 **Die Innerorts-Objekte dürfen nicht doppelt erscheinen.** `place-scope.php`
teilt Bauwerke in `inside` / `outside` / `unklar`; die Innerorts-Quelle nimmt
**nur `inside`** (ein Treffer, der auf die falsche Stadt springt, ist schlechter
als keiner). Die neue Quelle nimmt deshalb `outside` und `unklar` — und `unklar`
ohne Sprungziel, weil genau das der unklare Fall ist.

### 4.3 💣 Gedeckelt, sonst fluten sie

Wie Kartensammlung, Literatur und Vorkommen bekommt die neue Quelle einen eigenen
Deckel (`AVESMAPS_OFFMAP_SEARCH_LIMIT`), unabhängig vom 20er-Limit der Gesamtliste.
Ohne ihn schiebt ein Allerweltswort („burg", „stein") einen Schwall Wiki-Zeilen vor
die echten Kartentreffer. Der Grund steht wörtlich im heutigen Code: „abenteuer"
steckt in 1040 von 1352 Werken und würde die Liste allein füllen.

⚠️ Der Deckel wird **sichtbar** gemacht (Gesamtzahl im Abschnitt), nicht still
abgeschnitten — eine stumme Kappung liest sich wie „mehr gibt es nicht"
(AGENTS.md §11, „No silent caps").

### 4.4 Die Reihenfolge

Kartentreffer zuerst, danach die neuen. Innerhalb der neuen: Treffer **mit**
Sprungziel vor Treffern **ohne** — wer hinfliegen kann, ist mehr wert als wer nur
lesen kann. Die Bewertung selbst (`map-search-scoring.php`) bleibt unangetastet.

## 5. Die Trefferzeile

Keine neue Form. Die Zeile ist die bestehende (`spotlightResultMarkup`,
`js/ui/spotlight-search.js`), mit den zwei Klassen, die es schon gibt:

- `--not-on-map` → der gedämpfte Ton (der Treffer springt woanders hin)
- `--two-line` → die Breite für die zweite Zeile (240px statt 150px)

💣 **Das sind ZWEI Fragen, und sie dürfen nicht wieder zusammenfallen.** Bis zum
15.08.2026 hing die Breite an `--not-on-map`; ein verborgener Ort — der auf der
Karte IST — bekam sie dadurch nicht, und die Ellipse fraß bei 150px genau das Wort,
das die Zeile rechtfertigte. Der Kommentar dazu steht in
`css/components/spotlight-search.css`.

**Zwei Hinweistexte, und der Unterschied ist die Aussage:**

| Hinweis | Bedeutung | Klick |
|---|---|---|
| „nicht auf der Karte" | wir wissen, wo es liegt — die Zeile darüber sagt es (`Burg · Weiden`) | fliegt nach Weiden, Infobox dazu |
| „kein Ort auf der Karte" | wir wissen es nicht | Infobox, Karte bleibt stehen |

🔴 Der zweite Satz ist **nicht neu** — `spotlight.noPlaceOnMap` trägt ihn heute für
Karten und Werke ohne Ziel. Er wird wiederverwendet, nicht nachgedichtet.

💣 **Ein Treffer ohne Ziel darf nie so aussehen wie einer mit.** Wer „nicht auf der
Karte" liest und klickt, erwartet Bewegung; bleibt die Karte stehen, hält er es für
kaputt. Deshalb hängt der Hinweistext am aufgelösten `place_target`, nicht an der
Objektart.

## 6. Was NICHT dazugehört

- **Kein Editor.** Diese Treffer werden nicht bearbeitbar, nicht zuweisbar und
  nicht auf die Karte gesetzt. Dafür gibt es die WikiSync-Listen.
- **Keine zweite Infobox.** Es wird die bestehende benutzt, mit den Feldern, die da
  sind. Fehlt ein Feld, fehlt die Zeile — kein Platzhalter.
- **Keine neue Tabelle.** Alle Zeilen stehen bereits in Staging-Tabellen; das
  Einzige, was entsteht, ist eine Spalte für ein Feld, das schon berechnet wird.
- **Kein Personen-/Gottheiten-/Organisationssucher** (Owner-Entscheid §2).
- **Keine Änderung an der Bewertung.** `map-search-scoring.php` bleibt, wie es ist.

## 7. Tests

- `api/_internal/app/__tests__/offmap-search-test.php` — der reine Teil ohne MySQL:
  Zeilenform, die zwei Hinweisfälle, die `outside`/`unklar`-Weiche, der Deckel.
- **Die geteilte „liegt auf der Karte"-Rechnung** bekommt einen eigenen Test, der
  festnagelt, dass Ortsliste und Suche dieselbe Antwort geben — inklusive des Falls
  „Kartenname weicht vom Wiki-Titel ab, ist aber zugewiesen".
- `js/ui/__tests__/` — dass ein Treffer ohne Ziel den anderen Hinweis trägt und die
  zwei CSS-Klassen weiterhin zwei Fragen beantworten.
- 💣 **Vor dem Push das GANZE Testfeld**, nicht die eigenen (AGENTS.md §9), samt der
  `tools/wikidump/test-*.php`, die das übliche Muster nicht findet.

## 8. Offene Punkte

- 🔧 **Die Mengen sind ungemessen** (§3.4) — einmal live abfragen, bevor gebaut
  wird; die Zahlen entscheiden über die Deckelhöhe und darüber, ob eine Objektart
  sich lohnt.
- 🔧 **Die neue Spalte füllt sich erst beim nächsten Dump-Lauf.** Bis dahin haben
  Siedlungen ohne Kartenobjekt kein Sprungziel und tragen „kein Ort auf der Karte".
  Das ist korrekt, aber es heißt: der sichtbare Nutzen für Siedlungen kommt einen
  Sync später als der Code. Bauwerke, Regionen, Wege und Territorien wirken sofort.
- 🔧 **Abnahme im Browser mit angemeldeter Sitzung** steht aus — gemessen wird der
  Ablauf, nicht eine Zahl (AGENTS.md §9): tippen, Treffer sehen, klicken, fliegen.
