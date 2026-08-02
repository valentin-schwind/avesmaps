# Spotlight-Suche: Wort-UND-Suche + Kartensammlungen (Entwurf)

**Stand:** 2026-08-02 · **Herkunft:** Discord-Fall **#57** „Kartensammlungen durchsuchen"
(Idee, Valentin, 2026-07-31)

> „Rechtsklick auf die Karte soll einen neuen Menüpunkt ‚Durchsuche Kartensammlungen'
> beinhalten und ein Dialog öffnen, um alle Kartensammlungen zu suchen und dann z. B. nach
> dungeons zu suchen und wo sie sind"

**Abweichung vom Wortlaut des Falls, mit Owner-Zustimmung (2026-08-02):** kein eigener
Rechtsklick-Dialog, sondern ein Ausbau der **vorhandenen Spotlight-Suche**. Begründung: ein
zweiter Suchdialog wäre eine zweite Suchoberfläche mit eigener Eingabe, eigener Trefferliste
und eigener Sprungmechanik — für Daten, die dieselbe Frage beantworten wie alles andere in der
Spotlight-Suche („wo ist das?"). Der Ausbau kostet keine neue Bedienung.

---

## 1. Datenlage — gemessen, nicht geschätzt

Alle Zahlen live erhoben am 2026-08-02 (Einzelproben, keine Schleifen).

### 1.1 Der Bestand trägt — aber nicht das Beispiel aus dem Fall

`GET /api/app/citymaps.php` → **455 Karten**.

| Feld | gefüllt |
|---|---|
| `title` | 455 / 455 |
| Ortszuordnungen | 469 (278 eindeutige Orte) |
| `publisher` | 380 |
| `format` | 118 |
| `art` | 65 |
| `author` | 64 |
| `note` | 60 |

### 1.2 💣 Die Typen sind fast leer — `dungeon` ist 0×

Der Katalog kennt 16 Schlüssel (`api/_internal/app/citymaps.php:92`,
`html/citymap-editor.html:589`). Live vergeben sind **7**:

| Typ | Karten |
|---|---|
| `stadtplan` | 362 |
| `region` | 59 |
| `uebersicht` | 33 |
| `grundriss` | 5 |
| `ortsplan` | 4 |
| `befestigungen` · `hoehlen` | je 2 |
| **`dungeon`, `krypten`, `katakomben`, `schatzkarte`, `bezirk`, `viertel`, `lageplan`, `schauplatz`, `sonstige`** | **0** |

**Die Suche aus dem Fall („nach dungeons suchen") liefert heute null Treffer** — auch über den
Titel, denn kein einziger der 455 Titel enthält das Wort. Die 19 Titel mit dungeon-artigen
Wörtern tragen sie im Klammerzusatz, der die **Publikation** nennt, nicht den Karteninhalt
(„Stadtplan von Ayshabad (Ritterburgen und Spelunken)"). Siehe §5.

### 1.3 💣 Die Suche kennt keine Wort-UND-Verknüpfung

`avesmapsCalculateSearchScore` prüft die **ganze Eingabe als zusammenhängenden String** gegen
**jeden Suchtext einzeln** — vier Stufen (gleich / Präfix / Wortpräfix / enthalten). Es gibt
keine Zerlegung in Wörter und keine Kombination über Felder hinweg.

Beweis am ausgelieferten Quelltext (die drei reinen Funktionen aus `api/app/map-search.php`
ausgeschnitten und ausgeführt), Suchtexte `[Stadtplan von Gareth | Gareth | Stadtplan]`:

```
stadtplan gareth         null     KEIN TREFFER
stadtplan von gareth     0        Treffer
gareth                   0        Treffer
stadtplan                0        Treffer
gareth stadtplan         null     KEIN TREFFER
plan gareth              null     KEIN TREFFER
```

Das betrifft **alle** Objektarten, nicht nur Karten. Live bestätigt:
`q=meer der sieben winde` → 1 Treffer, `q=meer winde` → **0 Treffer**.

Ohne Behebung ist der Kartenausbau stumpf: genau die natürliche Eingabe („stadtplan gareth",
„grundriss akademie") ist die, die scheitert.

### 1.4 💣 Ein Gattungswort flutet die Trefferliste

**331 der 455 Titel beginnen mit „Stadtplan von …".** Bei einem Limit von 20 füllt die Eingabe
„stadtplan" die gesamte Liste mit Karten und verdrängt Ort, Territorium und Weg.

### 1.5 💣 Die Suche existiert ZWEIMAL, mit divergenter Normalisierung

Die Spotlight-Suche führt **zwei** Suchen parallel und mischt die Ergebnisse
(`resolveBackendSpotlightEntries`):

| | Server | Client |
|---|---|---|
| Scoring | `avesmapsCalculateSearchScore` (`api/app/map-search.php`) | `getSpotlightSearchScore` (`js/ui/spotlight-search.js:442`) |
| Normalisierung | `avesmapsNormalizeSearchText` | `normalizeSpotlightSearchText` (`:768`) |
| `ü` wird zu | **`ue`** (Ersetzungstabelle) | **`u`** (NFD + Akzent-Strip) |
| `ß` wird zu | `ss` | `ss` |

**Jede Änderung an der Suchlogik muss beide anfassen**, sonst verhält sich die lokale Suche
anders als die Backend-Suche — bei derselben Eingabe, in derselben Liste.

⚠️ **Nebenbefund, vor dem Umbau zu prüfen (nicht als Bug behauptet):**
`normalizeSpotlightSearchText` speist auch `getSpotlightPathGroupKey` — den **Identitäts­schlüssel
für Weg-Gruppen**, dessen Server-Gegenstück `avesmapsNormalizePathSearchGroupKey` die
Server-Normalisierung benutzt. Bei einem Weg mit Umlaut im Namen können die beiden Schlüssel
auseinanderlaufen (`byPathGroup` in `getSpotlightSearchLookup`). Ob das heute jemanden trifft,
ist **ungemessen**. Wer die Normalisierung angleicht, ändert diesen Schlüssel mit — das ist
kein Nebeneffekt, den man beiläufig mitnimmt (siehe §7).

---

## 2. Zuschnitt

**In diesem Auftrag:**

- **A** — Wort-UND-Suche, global für alle Objektarten (§3)
- **B** — Kartensammlungen als eigene Sektion in der Trefferliste (§4)

**Nicht in diesem Auftrag, mit Begründung:**

- **C** — Karten-Typisierung füllen: **keine Wiki-Quelle vorhanden** (§5). Was bleibt, ist eine
  Owner-Entscheidung, keine Bauaufgabe.
- **D** — Vorkommen (Flora/Fauna/Waren) in die Suche: eigenes Feature mit neuer Interaktion (§6).

---

## 3. Teil A — Wort-UND-Suche (global)

### 3.1 Regel

Die Eingabe wird an Leerzeichen in Wörter zerlegt (nach der Normalisierung). Ein Eintrag ist ein
Treffer, wenn **jedes** Wort in **mindestens einem** seiner Suchtexte trifft. Die Wörter dürfen
sich dabei auf **verschiedene** Suchtexte verteilen — genau das kann die heutige Fassung nicht.

„stadtplan gareth" trifft die Karte, weil `stadtplan` den Typ trifft und `gareth` den Ortsnamen.

### 3.2 Bewertung

Pro Wort wird der beste Score über alle Suchtexte bestimmt (die heutigen vier Stufen bleiben
unverändert: 0 gleich / 1 Präfix / 2 Wortpräfix / 3 enthalten). Der Score des Eintrags ist der
**schlechteste** dieser Wort-Scores — ein Eintrag ist nur so gut wie sein schwächstes Wort.
Die Sortierung dahinter (Score → Objektart → Name) bleibt, wie sie ist.

### 3.3 Rückwärtskompatibilität

**Eine Einwort-Eingabe verhält sich exakt wie heute** — die Zerlegung liefert ein Wort, der
Aggregat-Score ist dessen Score. Das ist die entscheidende Eigenschaft: die Änderung kann für
Einwort-Suchen (der Normalfall) nichts verschlechtern.

Mehrwort-Eingaben liefern **mehr** Treffer als heute. Das ist gewollt, muss aber gegen den
Live-Bestand geprüft werden (§8).

### 3.4 Beide Seiten

Server (`avesmapsCalculateSearchScore`) und Client (`getSpotlightSearchScore`) bekommen dieselbe
Regel. Die Normalisierungs-Divergenz aus §1.5 wird dabei **nicht** stillschweigend mitrepariert
— siehe §7.

---

## 4. Teil B — Kartensammlungen in der Suche

### 4.1 Sektion mit Kontingent (Owner-Entscheidung 2026-08-02, Variante A)

Karten erscheinen in einer **abgesetzten Gruppe** unterhalb der Kartenobjekte, überschrieben mit
„Kartensammlung" und der Gesamtzahl, **gedeckelt auf 5**, gefolgt von „alle N Karten zeigen".

Verworfen wurden:

- **rangniedrig einsortieren** (wie die Innerorts-Objekte heute): scheitert an §1.4 — bei 331
  gleichnamigen Karten füllen sie die Liste trotzdem.
- **nur bei Mehrwort-Suche zeigen**: schützt die Ortssuche vollständig, ist aber eine unsichtbare
  Regel; wer „gareth" tippt, erfährt nie, dass es sieben Gareth-Karten gibt.

Das Kontingent ist **zusätzlich** zum bestehenden Limit von 20 — Kartenobjekte verlieren keinen
Platz an Karten.

### 4.2 Suchtexte einer Karte

`title` · Namen der zugeordneten Orte (`places[].raw_name`) · Typ-**Schlüssel und -Beschriftung**
· `publisher`.

💣 **Typen müssen auf Schlüssel *und* Beschriftung matchen.** Der Payload trägt `uebersicht`, der
Mensch tippt „Übersicht" — nur den Schlüssel zu prüfen scheitert lautlos an jedem Umlaut-Typ.
Dieselbe Falle ist im Karten-Editor bereits gelöst (`TYPE_LABELS` aus `TYPE_KEYS` gebaut), die
Lösung wird gespiegelt.

`note` und `author` bleiben **draußen**: `note` ist Freitext mit Wiki-Resten („Mit Nummern",
„Veraltet UDW, Seite 14"), `author` ist mit 64 von 455 zu dünn, um Rauschen zu rechtfertigen.

### 4.3 Anzeige eines Treffers

Name = `title`. Typzeile = **Typ-Beschriftung + Ortsname** („Stadtplan · Gareth"). Der Ortsname
gehört dorthin, weil er bei einem Teil der Karten der einzige Grund ist, warum sie überhaupt
auftauchen — „Plan des alten Schlosses" nennt Gareth nie (live: 15 von 455 tragen einen Ort, den
ihr Titel nicht nennt).

### 4.4 Sprungziel

Eine Karte hat **keine eigene Geometrie**. Der Treffer springt auf den **zugeordneten Ort** und
öffnet dessen Infobox — dort steht die Kartensammlung bereits als Sektion, der Nutzer landet
also genau da, wo die Karte lebt.

- Bei mehreren Orten entscheidet der erste (`sort_order`).
- 💣 **85 der 469 Ortszuordnungen sind `unresolved`** (kein `target_public_id`). Diese Karten
  bleiben **findbar**, aber der Treffer ist **nicht anspringbar**. Er wird deshalb als solcher
  gekennzeichnet und rangiert hinter den anspringbaren — ein Treffer, der beim Klick nichts tut,
  ist schlimmer als keiner.

### 4.5 Herkunft der Daten

Der Suchindex wird **server-seitig** in `api/app/map-search.php` gebaut, als vierte Quelle neben
`map_features`, `political_territory` und den Innerorts-Objekten. Die Karten liegen zu diesem
Zeitpunkt ohnehin in der Datenbank; ein Client-Index würde den 500-KB-Katalog in jede Sitzung
ziehen, nur damit die Suche ihn durchsehen kann.

💣 **Nicht gegated umgehen:** `citymaps_enabled` (Not-Aus) und der Lizenz-Riegel gelten auch
hier. Ist die Kartensammlung abgeschaltet, liefert die Suche keine Karten.

---

## 5. Teil C — Typisierung: Befund

**Die vorhandene Quelle trägt nicht.** Der Wiki-Sync **liest** den Typ nicht, er **setzt** ihn
als Konstante pro Tabellenspalte (`api/_internal/wiki/citymap-sync.php`):

| Wiki-Quelle | gesetzter `type_key` |
|---|---|
| Stadtplanindex, Spalte „Stadtplan (Farbe)" | `stadtplan` |
| Stadtplanindex, Spalte „Stadtplan (s/w)" | `stadtplan` |
| Stadtplanindex, Spalte „Umgebungskarte" | `uebersicht` |
| Kartenindex, regionale Tabelle | `region` |

362 + 33 + 59 = **454** — das ist exakt der Live-Bestand aus §1.2. Die übrigen Zuweisungen
(`ortsplan` 4, `grundriss` 5, `befestigungen` 2, `hoehlen` 2) sind Handarbeit im Editor.

**Ein Re-Sync ändert daran nichts.** Der Wiki-Index modelliert „Stadt × Publikation × Spalte",
nicht den Karteninhalt. Für `dungeon`, `krypten`, `katakomben`, `schatzkarte`, `bezirk`,
`viertel`, `lageplan` und `schauplatz` gibt es dort schlicht kein Gegenstück.

**Was als Quelle bliebe (keins davon in diesem Auftrag):**

1. **`Datei:`-Seiten und ihre Kategorien** (`Kategorie:Stadtplan` ≈ 47 bekannt). Ob es feinere
   Kategorien gibt, ist **von hier nicht belegbar** — die Wiki-API antwortet auf `api.php` mit
   404, und das Projekt zieht seine Wiki-Daten ohnehin aus dem Dump, der server-only und
   basic-auth-geschützt ist. 🔧 **Das kann nur ein Dump-Lauf beim Owner beantworten.**
2. **Titel-Heuristik** („Plan der/des X" → `grundriss`). Riskant: die dungeon-artigen Wörter
   stehen im Klammerzusatz, der die Publikation nennt — „Stadtplan von Uhdenberg (Eine vergessene
   Mine)" ist ein Stadtplan, keine Mine.
3. **Handarbeit im Editor.** Die Checkboxen existieren; es fehlt nur, dass jemand sie setzt.

**Konsequenz für die Suche:** sie funktioniert ohne die Typen, weil Titel, Ort und Publikation
gefüllt sind. „dungeon" bleibt leer, bis jemand typisiert — und sobald jemand typisiert, wirkt es
sofort, ohne weitere Bauarbeit.

---

## 6. Nicht in diesem Auftrag — Vorkommen (Flora/Fauna/Waren)

Owner-Wunsch 2026-08-02: „Chonchinis eingeben und alle Regionen angezeigt bekommen, wo es die
gibt", ergänzt um „alle Regionen mit ‚Chonchinis Tobrien' gehighlighted".

**Vorrecherche (2026-08-02), damit die eigene Runde nicht bei null anfängt:**

- Chonchinis existiert: `{"wiki_key":"chonchinis","kind":"flora","place_count":3,`
  `"places":["Mittelaventurien","Herz des Kontinents","Echsensümpfe"],"source_count":28}`
- **Die Umkehrung ist datenseitig fertig.** `GET /api/app/lore.php?catalog=1&q=…` ist
  **öffentlich** und liefert die Ortsliste bereits mit. Sie ist nur nirgends mit der Suche
  verbunden.
- **Auflösungsquote gemessen:** von 20 echten Vorkommens-Ortsnamen springen **15** exakt auf ein
  Kartenobjekt. Zwei weitere („Thorwal (Region)", „Bornland (Region)") scheitern nur am
  Klammerzusatz, den `avesmapsWikiSyncCreateMatchKey` bereits strippt → realistisch 17 von 20.
- **Was nicht trägt:** 31 % der Einträge haben gar keine Ortsangabe (155 von 500 in der
  Stichprobe). Der häufigste Ort ist **„Aventurien" (106×)**, dazu Nord-/Süd-/Mittelaventurien,
  die es als Kartenobjekt nicht gibt — genau die Rang-3-Angaben, die das Vorkommen-Feature in der
  Infobox schon bewusst ausblendet.

**Warum es eine eigene Runde ist:** jeder Spotlight-Treffer springt heute an **eine** Stelle. Ein
Vorkommen ist eine **Liste von Orten** — „Chonchinis" hat kein Sprungziel, sondern drei.

**Die Highlight-Idee des Owners ist der richtige Ausweg, und sie ist kein Neubau:** die
Spotlight-Suche hebt bereits Gruppen von Geometrien hervor — ein Weg-Treffer highlightet **alle
Segmente** des Wegs (`spotlightHighlightLayer`, `SPOTLIGHT_PATH_HIGHLIGHT_STYLE`). „Alle Regionen
eines Vorkommens hervorheben" ist dieselbe Mechanik auf einer anderen Geometrieart. Die
Wort-UND-Suche aus §3 liefert dazu passend „Chonchinis Tobrien" frei Haus.

---

## 7. Was bewusst NICHT mitgemacht wird

**Die Normalisierungs-Divergenz aus §1.5 wird in diesem Auftrag nicht behoben.** Sie ist real und
gehört repariert — aber `normalizeSpotlightSearchText` speist den Weg-Gruppen-Identitäts­schlüssel,
und den zu ändern ist ein Eingriff in die Weg-Identität, nicht in die Suche. Das gehört gemessen
(wie viele Wege tragen einen Umlaut? laufen die Schlüssel heute wirklich auseinander?) und dann
für sich entschieden.

**Konsequenz:** die Wort-UND-Suche wird auf beiden Seiten so gebaut, dass sie **auf der jeweils
vorhandenen Normalisierung** aufsetzt. Die Zerlegung in Wörter ist von der Faltungsregel
unabhängig — beide Seiten zerlegen an Leerzeichen, egal ob `ü` vorher zu `u` oder `ue` wurde.

---

## 8. Prüfung

**Einheitentests (rein, ohne DB):**

- Wort-UND-Scoring server-seitig: Wörter über mehrere Suchtexte verteilt · Einwort-Eingabe
  verhält sich unverändert · schlechtestes Wort bestimmt den Score · ein Wort ohne Treffer
  verwirft den Eintrag.
- Dasselbe client-seitig für `getSpotlightSearchScore`.
- Karten-Suchtexte: Typ-Schlüssel **und** -Beschriftung matchen (der Umlaut-Fall `uebersicht` /
  „Übersicht").
- Kontingent: bei > 5 Karten erscheinen 5 plus Ausklapper; Kartenobjekte behalten ihre Plätze.
- Nicht anspringbare Karten (`unresolved`) rangieren hinter anspringbaren.

**Gegen den Live-Bestand (Einzelproben, keine Schleifen):**

- `stadtplan gareth` → findet die Gareth-Stadtpläne (heute: 0 Treffer).
- `meer winde` → findet „Meer der Sieben Winde" (heute: 0 Treffer).
- Eine Stichprobe Einwort-Suchen liefert **dieselben** Treffer wie vor dem Umbau — das ist die
  eigentliche Regressionsprüfung.
- `stadtplan` → Kartenobjekte stehen weiterhin oben, Karten in der gedeckelten Sektion.

---

## 9. Offene Punkte

- 🔧 **Owner:** ein Dump-Lauf würde beantworten, ob die `Datei:`-Seiten feinere Kategorien tragen
  als der Stadtplanindex (§5, Option 1). Ohne das bleibt die Typisierung Handarbeit.
- Die Normalisierungs-Divergenz (§1.5 / §7) ist benannt, gemessen ist sie nicht.
- Vorkommen (§6) warten auf eine eigene Runde.
