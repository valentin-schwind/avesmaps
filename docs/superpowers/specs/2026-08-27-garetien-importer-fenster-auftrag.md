# Auftrag: das Fenster „Garetien Importer" — Mockup

**Stand:** 2026-08-27 · **Auftraggeber:** Owner · **Vorgänger:**
`docs/superpowers/specs/2026-08-26-garetien-kartenimport-design.md` (Architektur) und
`docs/superpowers/plans/2026-08-26-garetien-import-stufe-1-gewaesser.md` (Stufe 1, **gebaut und
live**).

> 🔴 **Dieses Dokument ist der Auftrag für ein MOCKUP, nicht für den Bau.** Es hält fest, was
> gemessen wurde, was der Owner entschieden hat und was das Fenster leisten muss. Alle Zahlen
> darin sind **live gemessen**, nicht geschätzt — wo eine Zahl aus einer fremden Quelle stammt,
> steht es dabei.

---

## 1. Was der Owner will, wörtlich

> „was wir nicht wollen sind dubletten und was wir wollen sind ergänzende inhalte, die wir nicht
> haben - und so gut es geht die bei uns reintun."

> „ich würde mich über ein temporäres interface freuen, wo wir alles von garetien sehen und uns
> objekt für objekt entscheiden können ob wir es haben wollen. also ein dialog fenster, man klick
> auf ein item, sieht es und entscheidet sich ob man es haben will oder nicht - bis wir die liste
> durch sind."

> „du machst unter dem button ‚dump holen' ein button für die editoren ‚Garetien Importer' und
> präsentierst die liste mit filter und möglichkeit sich das ding auf der karte anzuzeigen BEVOR
> es dauerhaft bei uns gespeichert wird."

Daraus die drei tragenden Anforderungen:

1. **Sehen, bevor gespeichert wird.** Ein Klick auf eine Zeile zeigt das Objekt auf der Karte —
   ohne dass irgendetwas in eine Nutztabelle geschrieben wird.
2. **Objekt für Objekt entscheiden**, nicht in Gruppen. Die Liste wird durchgearbeitet.
3. **Keine Dubletten, aber Ergänzungen übernehmen.** Das ist kein Ja/Nein je Objekt — siehe §4.

---

## 2. Was schon gebaut und live ist

Der ganze Weg funktioniert, nur ohne Oberfläche. Aufrufbar über die Browser-Konsole.

| Datei | Aufgabe |
|---|---|
| `api/_internal/import/garetien-parser.php` | Zeilenformat, HTML → Zeilen |
| `api/_internal/import/garetien-koordinaten.php` | Wagenhalt → Karteneinheiten (affin, 6 Parameter) |
| `api/_internal/import/garetien-abruf.php` | 18 Ebenen, Abruf, Staging |
| `api/_internal/import/garetien-abgleich.php` | Typzuordnung + Abgleich gegen den Bestand |
| `api/_internal/import/garetien-plan.php` | füllt die **vorhandene** Übernahme-Vorschau |
| `api/_internal/import/garetien-uebernahme.php` | der einzige Schreibweg + `avesmapsGaretienApplyStep` |
| `api/edit/map/garetien-import.php` | Endpunkt: `probe · ebenen · runs · fetch · upload · plan` |
| `api/edit/wiki/sync-plan.php` | Art `garetien` in `AVESMAPS_SYNC_PLAN_KINDS` + Verteiler-Zweig |

🔴 **Es gibt EINE Übernahme-Tür**, und das bleibt so: `api/edit/wiki/sync-plan.php` mit
`kind: 'garetien'`. Dort hängen Einzelflug-Riegel, zweite Bestätigung, Protokoll und der
Fortschritt in Häppchen. Der Import-Endpunkt hat bewusst **kein** eigenes `apply`.

**Der heutige Ablauf** (Browser-Konsole, angemeldet):

```js
const ruf = (p, b) => fetch(p, {method:'POST', headers:{'Content-Type':'application/json'},
  credentials:'same-origin', body:JSON.stringify(b)}).then(r => r.json());
const IMPORT = '/api/edit/map/garetien-import.php', VORSCHAU = '/api/edit/wiki/sync-plan.php';

holen = await ruf(IMPORT, {action:'fetch', ebenen:['ggp:Gewaesser','kosch:Gewaesser']});
plan  = await ruf(IMPORT, {action:'plan', run_id: holen.run_id});
liste = await ruf(VORSCHAU, {action:'get', kind:'garetien'});
// haken:      {action:'select', kind:'garetien', run_id: …, ids:[123], selected:0}
// übernehmen: {action:'apply',  kind:'garetien', run_id: …}   -- in Häppchen zu 40
```

---

## 3. Die Datenlage — alles gemessen

### 3.1 Die Quelle

18 Exportseiten, **8348 Zeilen, 64 Typen**, keine defekte Zeile. Gemessen 27.08.2026, deckt sich
mit dem Entwurf.

| Ebene | GGP | Kosch |
|---|---:|---:|
| Grenzen | 2860 | 192 |
| Ortschaften 1–4 | 2019 | 500 |
| Detail 1–2 | 1000 | — |
| Wege | 685 | 47 |
| Wälder | 345 | 113 |
| Berge | 250 | 12 |
| Gewässer | 246 | 43 |
| Sonstiges | 36 | — |

✅ **Der Abruf von STRATO aus GEHT** — `200 158539 Bytes`, vom Owner auf der Servershell gefahren
(27.08.2026). Der Upload-Eingang bleibt als Rückfallebene, ist aber kein Muss.

⏱ Das Rechnen des Plans für 289 Zeilen dauert **0,35 s**. Kein Zeitproblem.

### 3.2 Die vollständige Zuordnungstabelle

| Ihr Typ | Anzahl | → bei uns | Stufe |
|---|---:|---|---|
| Strom · Fluss · Bach | 2 · 30 · 143 | `map_features.path` / `Flussweg` | **1** |
| See | 96 | `ecosystem_region` `topographie/see` + Label | **1** |
| Meer | 2 | `topographie/meer` + Label | **1** |
| Sumpf | 15 | `vegetation/suempfe_moore` + Label | **1** |
| Reichsstrasse · Strasse · Weg · Pfad | 7 · 87 · 226 · 411 | `path`, gleichnamiger Subtyp | 2 |
| Wald · Forst | 442 · 8 | `vegetation/wald` + Label | 3 |
| Urwald | 8 | `vegetation/urwald` — **neue Art, Owner 26.08.** | 3 |
| Gebirge | 99 | `topographie/gebirge` | 3 |
| Huegel | 84 | `topographie/huegelland` | 3 |
| Insel | 16 | `topographie/insel` (Owner 26.08.) | 3 |
| Kueste | 20 | `topographie/kueste` | 3 |
| Berg | 79 | `map_features.label` / `berggipfel` (Punkt) | 3 |
| Koenigsstadt · Reichsstadt | 4 · 18 | `grossstadt` | 4 |
| Stadt | 94 | `stadt` | 4 |
| Markt | 143 | `kleinstadt` | 4 |
| Dorf · Binge | 868 · 13 | `dorf` (Binge: Owner 26.08.) | 4 |
| Burg · Gutshof · Tempel · Kloster · Gebaeude · Gasthaus · Pfalz · Akademie · Magierturm | 471 · 365 · 212 · 76 · 137 · 75 · 14 · 4 · 2 | `gebaeude` | 4 |
| Junkertums- · Baronie- · Grafschaftsflaeche A–E | 585 · 143 · 31 | `political_territory` | 5 |
| Junkertums- · Baronie- · Provinz- · Grafschafts- · Reichsgrenze · Grenzzug | 970 · 583 · 167 · 137 · 119 · 317 | Bausteine der Flächen | 5 |
| `*Klein` (Detail 1–2) | **1000** | — nicht importieren (Innenansichten von Städten) | — |
| Stadtviertel · Kontinent | 22 · 1 | — kein Gegenstück | — |

💣 **Die Suffixe A–E sind Farbvarianten, keine Ränge.** Wer sie als fünf Typen liest, legt fünf
Hierarchiestufen an, die es nicht gibt.

⚠️ **`Kaiserstadt` kommt NICHT vor** — Gareth liegt außerhalb von Volkers Gebiet. Der Entwurf
nennt den Typ, die Daten haben ihn nicht.

⚠️ Zwei Einzelfälle: `Unbekannte Art:Garetien:Dorf Brakenmoor!Brakenmoor` (Volkers Abfrage konnte
den Typ nicht bestimmen; laut Artikelname ein Dorf) und eine Zeile ganz ohne Typ
(`Hasengrube!Hasengrube;14!;;2000000 2000000`).

🔴 **„Ortschaften" ist der Name der SEITE, nicht ihr Inhalt.** Von 2519 Zeilen sind rund **1127
echte Ortschaften** (Dorf, Markt, Stadt, Reichsstadt, Königsstadt) und rund **1356 einzelne
Bauwerke**. Wer die 2519 als „Ortschaften" weiterreicht, erzeugt eine falsche Erwartung — das ist
in dieser Sitzung passiert und dem Owner sofort aufgefallen.

### 3.3 💣 360 Zeilen haben KEINE Position

Sie tragen die Marke `2000000 2000000`, umgerechnet **(1222 / −115,6)** — außerhalb unserer Karte
(0…1024). Roh:

```
Gasthaus:Gelber Hund!Gelber Hund;14!14;;2000000 2000000     ← keine Position
Dorf:Moorkaten!Moorkaten;8!14;;-203183 -59326               ← platziert
```

🔴 **Alle 360 stehen im Kosch, NULL in GGP.** 359 auf `kosch/Ortschaften_1` (= **72 % dieser
Seite**, nur 141 von 500 sind platziert), einer bei `kosch/Wege`. Es passt zu dem, was der
Entwurf §6 beobachtet: Volkers SVG-Ausgabe liefert für den Kosch nur rund 150 Objekte.

⚠️ **Die LOD-Spanne ist KEIN verlässliches zweites Signal**: 352 der 360 tragen `14!14`, aber acht
nicht — und 375 Zeilen mit `14!14` haben sehr wohl eine Position. **Die Koordinate ist das
Signal.**

🔴 **Es fehlt der Riegel dagegen.** Der heutige Import würde sie klaglos schreiben; sie wären
unsichtbar und unerreichbar. Betrifft Stufe 4, nicht Stufe 1 (die Gewässer sind alle platziert) —
aber der Riegel gehört in `avesmapsGaretienUeberspringGrund`, nicht in die Oberfläche.

### 3.4 Der Stand von Stufe 1 (Gewässer), live gemessen

289 Quellzeilen gegen 1108 Flusswege und 386 Gewässerflächen:

| | |
|---:|---|
| **199** | neu, vorangehakt → werden angelegt |
| **32** | neu, **ungehakt** — Verdacht auf Zufluss/Dublette, Grund steht in der Zeile |
| **3** | widersprüchlich (Artikel trifft, Geometrie nicht) — Stufe 1 legt sie nicht an |
| 49 | deckt sich → kein Vorschlag |
| 6 | übersprungen (3× Nachbarprovinzen, 1× Raschtulswall, 1 ohne Namen, 1 Insel = Stufe 3) |

Ziele: 152 Flusswege · 73 Seen · 15 Sümpfe · 1 Meer.

---

## 4. 🔴 DER KERN DES AUFTRAGS: es fehlt ein vierter Ausgang

Der Abgleich kennt heute drei: **neu · deckt sich · widerspricht**.

Der Owner nennt den Fall, der durchs Raster fällt:

> „die ‚Angbarer Reichsstraße' ist bei uns ‚Reichsstraße 3', wir haben einen ähnlichen straßen
> verlauf, aber nichts was dir sagt, was wir machen sollen"

Diese Straße landet auf **deckt sich** — und „deckt sich" erzeugt **keinen Vorschlag**. Ihr Name
und ihr Wiki-Artikel werden weggeworfen, unsere heißt weiter „Reichsstraße 3". Genau das, was der
Owner will (*ergänzende Inhalte*), geht dabei verloren.

**Messbar bei den Gewässern:** von 76 Geometrietreffern trugen **25** auf unserer Seite gar keinen
Namen (`Flussweg-5112`, `See-264`, `Fläche-031`). Ein Viertel.

Der vierte Ausgang heißt **„haben wir — aber sie wissen mehr"**: er füllt nur LÜCKEN (Name,
Wiki-Artikel, Quelle) und überschreibt nie etwas, was bei uns schon steht.

**Owner-Entscheid 27.08.2026:** Ja, unsere `Flussweg-5112` darf zu „Alke" werden — *„aber wir
wollen uns den fall anschauen, ob er alle segmente auch hat"*.

### 4.1 💣 Und genau daran hängt das Schwierigste

Unsere Flüsse liegen in **Abschnitten**, ihre nicht. Gemessen am Livebestand:

- „Der Große Fluss" bei uns in **38** Stücken, Yaquir 28, Mhanadi 26
- **158 von 526** Namensgruppen sind mehrteilig
- Ihre Fassung ist EINE Linie — ihr Großer Fluss: 294 Stützpunkte über 296 Karteneinheiten

Was ihre Objekte bei uns treffen (98 Fließgewässer liegen auf unserem Bestand):

| ihres | trifft unsere Abschnitte | die heißen bei uns |
|---|---:|---|
| Großer Fluss | 13 | **Breite** · Der Große Fluss |
| Barun-Ulah | 8 | Barun-Ulah (7) + 1 namenloser |
| Dergel | 8 | Dergel (6) + 2 namenlose |
| Natter | 5 | **Natter · Gardel · Darpat** |
| Rakula | 5 | Drommsel · Rakula · Der Große Fluss |
| Gardel | 5 | Gardel · Silk · Pilperbach |
| Gernat | 2 | Dergel + 1 namenloser |

🔴 **Ihr EINES Objekt läuft über mehrere unserer Flüsse.** Ihre „Natter" trifft drei verschiedene.
Ein pauschales Umbenennen wäre falsch.

Die Fälle teilen sich:

- **3 Fälle**: alle getroffenen Abschnitte namenlos → sauberer Fall
- **6 Fälle**: gemischt — z. B. Barun-Ulah, 7 benannt + 1 Lücke → **genau das, was der Owner will**
- **Rest**: läuft über mehrere unserer Flüsse → keine Umbenennungsfrage, sondern eine
  Zugehörigkeitsfrage

**Konsequenz für das Fenster:** beim Anklicken muss sichtbar sein, **welche unserer Abschnitte das
Objekt trifft, wie sie heißen und welche namenlos sind** — und gehakt wird **je Abschnitt**, nicht
je Objekt.

---

## 5. Was das Fenster leisten muss

### 5.1 Der Einstieg

Knopf **„Garetien Importer"** unter „Dump holen" (Editor-Oberfläche, Fähigkeit `edit`; das
Holen/Rechnen braucht heute `admin`).

### 5.2 Die Liste

- **Filter**, mindestens: Ebene (18) · Objekttyp (64) · Urteil (neu / deckt sich / widerspricht /
  „sie wissen mehr") · Wiki (ggp / kosch) · „nur ungehakte" · Freitext auf den Namen
- **Bilanzzeile** wie bei den WikiSync-Listen (`js/review/review-list-balance.js` ist der eine
  Erzeuger dafür — nicht nachbauen)
- Die Zeile zeigt: Name · Typ · Urteil · Grund · Häkchen
- ⚠️ Die vorhandene Vorschau deckelt bei **200 je Gruppe** (`AVESMAPS_SYNC_PLAN_CATEGORY_LIMIT`).
  Bei 231 „neu" sind 31 nicht sichtbar, **behalten aber ihr Häkchen und kommen mit**. Das Fenster
  muss das entweder auflösen (blättern) oder laut sagen.

### 5.3 Die Einzelansicht — das Herzstück

Ein Klick auf eine Zeile zeigt:

1. **Das Objekt auf der Karte**, in ihrer Geometrie, **bevor** etwas gespeichert wird.
   💣 Die Geometrie liegt fertig umgerechnet in `sync_plan_item.after_json` → `geometry` (GeoJSON
   in unseren Karteneinheiten). Es braucht **keinen** zweiten Rechenweg im Browser.
2. **Was bei uns an derselben Stelle liegt** — mitgezeichnet, in anderer Farbe, mit Namen.
3. Bei mehrteiligen Treffern: **die Liste unserer Abschnitte** samt Name, und je Abschnitt ein
   Häkchen für „Namen übernehmen".
4. Ihre Angaben: Wiki-Artikel (verlinkt), Typ, LOD-Spanne, `extra` (bei politischen Flächen
   `pop=` und `level=`).
5. Die Entscheidung: **übernehmen · lassen · später**.

### 5.4 Was das Fenster NICHT tun darf

- 🔴 **Kein zweiter Schreibweg.** Gespeichert wird ausschließlich über
  `api/edit/wiki/sync-plan.php` mit `kind: 'garetien'`.
- 🔴 **Keine zweite Übernahme-Vorschau.** Die Liste liest `sync_plan_item`; wenn die vorhandene
  Bauform (`js/review/sync-plan-sheet.js`) reicht, wird sie benutzt und nicht nachgebaut.
- 🔴 **Keine zweite Rechnung im Browser.** Urteil, Geometrie und Grund kommen fertig vom Server.
- ⚠️ **Kein blaues Chrome** (AGENTS.md §12). Blau ist erlaubt, wo Farbe DATEN kodiert.

---

## 6. Die Fallen, die schon zugeschnappt sind

Jede davon ist live passiert. Sie stehen als Zusicherung im Code; wer sie hier liest, muss sie
nicht noch einmal bezahlen.

| 💣 | Was |
|---|---|
| **Das KoschWiki schreibt Koordinaten mit Semikolon** (`x;y; x;y` statt `x y,`). 2 Zeilen, darunter der **Angbarer See**. Als Verweisliste gelesen ergibt das NICHTS — der größte See des Kosch wäre ohne Fehlermeldung verschwunden. Und das Semikolon ist unser FELDtrenner. |
| **Der Sammelartikel steht im ARTIKEL, nicht im Namensraum.** `Fluss:Nachbarprovinzen!Llavari` hat gar keinen Namensraum. Im Namensraum gesucht findet man keine der vier Zeilen. |
| **Unsere Flüsse liegen in Abschnitten.** Gegen EINEN Kandidaten gemessen gilt ihr Großer Fluss als „neu" — die schlimmste Dublette, die dieser Import anrichten kann, vorangehakt. Gemessen wird die **Deckung durch alle Kandidaten zusammen**. |
| **Unsere Einordnung darf von ihrer abweichen.** Angbarer See: bei ihnen `Meer`, bei uns `see`. Nur unter `meer` gesucht → „neu" → Dublette. Die Zuordnung kennt eine **Suchfamilie**; ⚠️ der Sumpf bleibt allein. |
| **Ein Zufluss liegt auf seinem Hauptfluss.** 34 von 37 Widersprüchen waren Bäche neben ihrem Fluss („Seitenarm der Natter" traf „Natter" auf 0,29). Als `deckt_sich` wären sie stillschweigend nicht importiert worden. |
| **Der Ausdehnungsriegel misst gegen EINEN Kandidaten, nicht gegen die Summe.** Die Summe wäre schärfer und erzeugte einen Fehlalarm an Abschnittsgrenzen. Diese Überkorrektur stand eine Runde lang drin. |
| **Gemessen wird zum nächsten STÜTZPUNKT, nicht zur Strecke.** Deshalb steht die Trefferschwelle bei 2,0 und nicht bei 0,5. Live: Treffer bis 1,98, nächster Nicht-Treffer 2,07 — eine saubere Lücke. |
| **Kein Vorfilter über die gespeicherten bbox-Spalten.** Sie stehen unter Verdacht, veraltet zu sein („Was ist hier?" ist um Al'Anfa blind). Eine veraltete bbox meldete einen vorhandenen Fluss als „neu". |
| **`avesmapsFeatureSourceUpsert` kürzt die `source_type`-Whitelist LAUTLOS.** Was nicht darinsteht, wird `sonstiges` — ohne Fehler, mit gültiger id zurück. |
| **Ein abgelehntes Item braucht einen VERMERK**, sonst gilt es als offen und der Häppchen-Lauf wird nie fertig. |
| **`IN ()` ist unter SQLite gültig, unter MySQL ein Syntaxfehler.** Der frühe Ausstieg bei leerer Auswahl ist deshalb nicht am Verhalten prüfbar. |

---

## 7. Owner-Entscheide, die gelten

| | |
|---|---|
| `Binge` → `dorf` | 26.08.2026 |
| `Urwald` → neue Art `vegetation/urwald` | 26.08.2026 |
| `Insel` → `topographie/insel` (Fläche) | 26.08.2026 |
| Namensnennung: **„VolkoV / garetien.de"** bzw. **„VolkoV / koschwiki.de"**, CC BY-NC-SA 3.0 | 27.08.2026 |
| Kategorie: **„Briefspiel (Garetien)" / „Briefspiel (Kosch)"**, `source_type = 'briefspiel'` | 27.08.2026 |
| Quellen bekommen **zwei Felder**: `license` (Schlüssel) + `attribution` (Freitext) | 27.08.2026 |
| Zuflüsse → `new`, **ungehakt**, mit Grund in der Beschriftung | 27.08.2026 |
| Flüsse werden als `Flussweg` angelegt, **Routing-Anbindung später** | 27.08.2026 |
| Umbenennen unserer namenlosen Objekte: **ja**, aber der Fall wird angesehen (§4.1) | 27.08.2026 |
| Sichtbare Änderungen gehen **einzeln** live | AGENTS.md §9 |

---

## 8. 🔧 Offen — gehört in das Fenster oder daneben

1. **Der vierte Ausgang** (§4) ist noch nicht gebaut. Ohne ihn gibt es nichts anzuzeigen für „sie
   wissen mehr".
2. **Der Riegel gegen die 360 ohne Position** (§3.3) fehlt.
3. **Die 32 Zweifelsfälle** brauchen die Einzelansicht, sonst sind sie nicht beurteilbar. Drei
   Muster: (a) Zuflüsse mit eigenem Namen — vermutlich haken; (b) mehrere ihrer Seen auf EINER
   unserer Flächen (`See-264` trägt Kristallsee, Nassersee, Storchensee; `See-182` vier
   „See in Brendiltal") — echte Datenfrage; (c) namenlose Nebenflüsse ohne eigenen Artikel —
   vermutlich nicht haken.
4. **Routing:** kein einziger der 129 neuen Flüsse schließt ans Wegenetz an — null von 129, Median
   0,663 Karteneinheiten daneben. Sie werden als Inseln im Graphen liegen.
5. **Eine bestehende Quelle umschreiben** geht nicht; man legt sie mit derselben URL erneut an,
   dann füllt der Upsert die leeren Felder.
6. **Der Ablauf im Browser mit angemeldeter Sitzung** ist nie gelaufen — kein Handgriff lief je
   gegen die echte Datenbank.

---

## 9. Vorbilder im Haus

- `docs/sync-uebernahme-mockup.html` + `docs/sync-uebernahme-fallliste-mockup.html` — die
  vorhandene Übernahme-Vorschau
- `docs/wikisync-listen-mockup.html` — **die** Listenzeile (`.wikisync-itemlist .tree-item`);
  AGENTS.md §11 sagt: es gibt ZWEI Rezepturen und das ist die Obergrenze
- `js/review/sync-plan-sheet.js` — das Bauteil, das die Vorschau zeichnet
- `docs/design-language.md` — vor jeder CSS-Arbeit lesen
