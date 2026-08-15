# Handelshäuser: Geschäfte und Organisations-Sitze — Entwurf

> Stand: 2026-08-16 · Phase 3 aus `2026-08-15-besondere-staetten-design.md` §4
> · Anlass: die Wiki-Listen *Handelsgesellschaft*, *Bankhaus*, *Kontor* aus dem
> Owner-Auftrag vom 15.08.2026, die als einzige der zehn offen blieben

## 1. Die Datenlage, gemessen

Erhoben am 2026-08-16 über `list=categorymembers` + `prop=revisions` gegen
`https://de.wiki-aventurica.de/de/api.php`, über die drei Kategorien
*Handelsgesellschaft*, *Bankhaus* und *Kontor* zusammen (**140 Artikel**):

| Infobox | Artikel | Lage heute |
|---|---|---|
| `Organisation` | **75** | kein `Standort=` — nur `Hauptsitz=` + `Weitere Sitze=` |
| `Bauwerk` | 31 | läuft bereits („Belhankaner Kontor" ist live suchbar) |
| **`Geschäft`** | **28** | **fällt durch die Klassifizierungs-Weiche** |
| `Familie` | 5 | keine Orte |
| `NSC` | 1 | kein Ort |

`Art=` sagt: Handelsgesellschaft 68, Kontor 57, Bankhaus 4, dazu ein
„Handelsgesellschaft / Bankhaus".

**Die Sitze:** 72 der 140 Artikel tragen eine Sitzangabe, zusammen **293 Sitze** —
im Schnitt 4,1. Die Spitze: Nordlandbank **35**, Handelshaus Stoerrebrandt 30,
Sharika ay Mada Basari 20, Reederei Terdilion 15, Albenhuser Bund 14. **68 Artikel
haben gar keine Sitzangabe.** Fünf führen „ehemals" im Feld.

🔴 **Korrektur am Vorgänger-Entwurf:** dort steht „`Infobox Geschäft` bleibt draußen —
sie kam bei genau einem Kontor vor". Das war aus sechs Stichproben geraten. Es sind
**28**, und sie tragen `Standort=` wie ein Bauwerk.

## 2. Zwei sehr ungleiche Hälften

### Teil A — die 28 Geschäfte (klein)

`Geschäft` in die Bauwerks-Weiche, genau wie `Lehreinrichtung` am 15.08.2026.

💣 **Die Bedingung steht ZWEIMAL**, wortgleich: `avesmapsWikiDumpClassifyEntityKind`
(`dump-entity-scan.php:205`) und der eigene Riegel in
`avesmapsWikiDumpParseBuildingPage` (`:753`). Wer nur die erste öffnet, bekommt eine
Seite, die klassifiziert wird und danach still am Parser stirbt. Beide tragen seit
dem 15.08. einen Verweis aufeinander.

Sonst nichts: `Standort=` liest der Parser, `Art=[[Kontor]]` liefert die Ortsart über
den vorhandenen Art-Fallback, und `Kontor` steht bereits im Katalog.

### Teil B — die 293 Sitze (neu)

**Hier bricht das vorhandene Modell.** Ein Innerorts-Objekt hat **einen** `standort`,
und sein Titel ist der Schlüssel (`normalized_key` ist UNIQUE). „Nordlandbank"
35-mal in `wiki_sync_pages` zu schreiben geht nicht.

Es braucht eine Zeile **je Organisation-Ort-Paar** — das Hausmuster, das es dreimal
gibt (`adventure_place`, `citymap_place`, `lore_place`):

```
wiki_organisation_seat
  organisation_title   VARCHAR(255)   "Nordlandbank"
  organisation_art     VARCHAR(120)   "Bankhaus"        (aus |Art=)
  place_title          VARCHAR(255)   "Festum"          (roher Linktitel)
  role                 VARCHAR(20)    hauptsitz|zweigsitz
  wiki_url             VARCHAR(500)
  UNIQUE (organisation_title, place_title)
```

Die Sitze fließen danach in **dieselbe Innerorts-Liste**, die Suche und
Stätten-Zeile bereits lesen (`avesmapsBuildInSettlementPlaceList`). „Nordlandbank"
erscheint in Festum als „Bankhaus (Hauptsitz)", in Gareth als „Bankhaus".

⭐ **Kein neuer Anzeigepfad, kein neues Bedienelement, keine neue Abfrage im
Betrieb** — die Liste reist ohnehin im Kartenpayload mit.

## 3. Die Entscheidungen

| # | Entscheidung | Warum |
|---|---|---|
| 1 | **Die Rolle wird gespeichert** (`hauptsitz`/`zweigsitz`) | Ohne sie ist „wo sitzt die Nordlandbank *wirklich*" bei 35 Filialen nicht beantwortbar |
| 2 | **„ehemals" fliegt raus** | Fünf Artikel führen aufgelöste Sitze; eine Filiale, die es nicht mehr gibt, gehört nicht in die Stadt-Infobox |
| 3 | **68 Organisationen ohne Sitzangabe bleiben unsichtbar** | Ohne Ort kein Eintrag — dieselbe Regel wie bei den 38 ortlosen Akademien |
| 4 | **Der Ortsname wird ROH gespeichert** | Die Auflösung gegen die Karte macht `place-scope.php` beim Lesen, wie bei `standort`. Ein beim Schreiben aufgelöster Name veraltet, sobald ein Ort umbenannt wird |

## 4. Fallen

| # | Falle | Wo |
|---|---|---|
| 1 | Die Bauwerks-Bedingung steht **doppelt** | `dump-entity-scan.php:205` + `:753` |
| 2 | 💣 **Eine neue Spalte in einem LESEpfad ist ein stiller Live-Ausfall** | siehe unten |
| 3 | „Weitere Sitze" ist **Freitext mit Links**, kein sauberes Feld | Parser muss `[[…]]` einsammeln, nicht splitten |
| 4 | Ein Sitz-Ort muss **eindeutig auf der Karte** liegen | sonst fällt er raus (`place-scope.php`-Regel, seit 27.07.) |
| 5 | Die Zeilenform der Innerorts-Liste hat **zwei Leser** | Suche + Stätten-Zeile; beide erwarten `{title, raw, type_label, deity, wiki_url}` |

💣 **Zu Falle 2 — die Lehre vom 15.08.2026, teuer bezahlt.** `wiki_sync_pages.deity`
wurde einem Lesepfad hinzugefügt, dessen DDL **nur im Sync-Pfad** läuft. Zwischen
Deploy und erstem Lauf existierte die Spalte nicht; beide Leser stehen in einem
`try/catch`, das eine **leere Liste** liefert — rund zehn Minuten lang waren 1774
Innerorts-Objekte weg und jede Infobox verlor ihren `building_type`, ohne einen
Fehler im Log.
**Für dieses Feature heißt das: jede neue Tabelle und jede neue Spalte bekommt den
Rückfall im SELBEN Commit** (`'' AS x`, bzw. bei einer Tabelle ein `try/catch`, das
nur diesen einen Zweig leer lässt statt der ganzen Liste). 🔴 Kein DDL auf dem
Lesepfad — `map-features.php` ist der heißeste Pfad überhaupt (Pool-Vorfall).

## 5. Abnahme

Handgriffe, keine Zahlen:

**Teil A**
1. „elemitischer kontor" suchen → Treffer, springt auf Amhas.
2. Ein Ort mit Geschäften zeigt sie in der Stätten-Zeile.
3. „Belhankaner Kontor" geht unverändert (Gegenprobe).

**Teil B**
4. Festum öffnen → „Nordlandbank" steht in den Stätten, als Bankhaus (Hauptsitz).
5. Gareth öffnen → dieselbe Nordlandbank, ohne „Hauptsitz".
6. „nordlandbank" suchen → Treffer, springt auf Festum.
7. Ein aufgelöster Sitz („ehemals") taucht **nirgends** auf.

⚠️ Beides wirkt erst nach **„📥 Dump holen" und danach „Syncen"** (🔧 Owner, in
dieser Reihenfolge — „Syncen" allein liest den alten Lauf).

## 6. Tests

| Test | Sichert |
|---|---|
| `dump-entity-scan`-Ergänzung | `Infobox Geschäft` klassifiziert **und** parst; beide Bedingungen nennen dieselben fünf Namen |
| neuer Sitz-Parser-Test | `Hauptsitz=`/`Weitere Sitze=` → Paare; „ehemals" fällt raus; Freitext zwischen den Links stört nicht |
| Rückfall-Test (SQLite) | fehlende Tabelle → die übrige Innerorts-Liste bleibt vollständig |
| Zeilenform-Test | die Sitze haben dieselbe Form wie Bauwerke, beide Leser vertragen sie |

💣 Vor dem Push das **ganze** Testfeld, alle drei Muster (auch die 30 `test-*.php`
außerhalb von `__tests__`), und danach die **Live-Datei** prüfen — ein grüner Deploy
ist kein Beleg (15.08.2026: zwölf grüne Läufe, nichts hochgeladen).

## 7. Reihenfolge

Teil A geht **allein** live und wird angesehen. Er ist für sich vollständig — 28
Geschäfte in Suche und Stätten-Zeile — und trägt kein Stück von Teil B vor sich her.
