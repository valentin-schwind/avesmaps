# „Was ist hier?" — die angeklickte Stelle als Auskunft

**Stand:** 15.08.2026 · **Zustand:** Entwurf, nichts gebaut
**Mockup:** `docs/was-ist-hier-mockup.html` (drei gemessene Punkte, echte CSS-Kette)

Rechtsklick auf die Karte → **„Was ist hier?"** → die Markierung wird gesetzt und
das Infopanel sagt, was an dieser Stelle ist: in welchem Herrschaftsgebiet, in
welcher Landschaft, in welcher Klimazone, was dort wächst und gehandelt wird, und
was in der Nähe liegt. Angelehnt an Google Maps, gebaut aus dem, was diese Karte
ohnehin weiß.

Owner-Entscheide vom 15.08.2026, in dieser Reihenfolge gefallen:

| Frage | Entscheid |
|---|---|
| Verhältnis zur vorhandenen Markierung | **Verschmelzen** — es gibt genau EINE |
| „Stelle markieren und teilen" | **bleibt** als Schnellweg ohne Panel |
| Aufbau des Panels | **eigener Abschnitt** „In der Nähe", **alles tabellarisch** wie bei Siedlungen |
| Himmelsrichtung | **drehendes Pfeilchen** statt „N / NO / W" |
| Welcher Menüpunkt weicht | **„🔗 Link für diese Route kopieren"** |

---

## 1 · Was eine Stelle hergibt — gemessen, nicht vermutet

Drei Punkte, alle am 15.08.2026 gegen die Live-Daten geprüft.

💣 **Die Koordinate dreht sich.** `?pin=` ist `lat,lng` = **`y,x`**; die API will
`{x, y}`. Der Landpunkt heißt als Link `?pin=516.016,491.032` und in der Anfrage
`x=491.032, y=516.016`. Dieselbe Drehung hat am 14.08.2026 eine Stunde Fehlersuche
an der falschen Kartenstelle gekostet.

| | **Land** `516.016,491.032` | **See** `300.000,640.000` | **Insel** `362.539,722.498` |
|---|---|---|---|
| Herrschaft | Grafenmark Ferdok → Grafschaft Ferdok → Fürstentum Kosch → Heiliges Neues Kaiserreich | *keine* | Fürstkomturei Tobimora *(unabhängig, eine Stufe)* |
| Derographie | Aventurien | — | — |
| Topographie | Der große Fluss *(Tal)* | Perlenmeer *(Meer)* | Maraskan *(Insel)* |
| Vegetation | Dunkelwald *(Wald)* **und** Flusslande | — | — |
| Klimazone | Gemäßigte Zone | Tropische Zone | Tropische Zone |
| Waren | 1 | 0 | 70 |
| Fauna | 0 | 0 | 74 |
| Flora | 1 | 0 | 70 |
| Nächster Weg | Pfad, 2,5 Meilen | Seeweg, 7,6 Meilen | Pfad, 23,4 Meilen |
| Nächste Ortschaft | Ziegenhain, 4,2 Meilen | Thalusa, 35,2 Meilen | Alrurdan, 23,4 Meilen |

Dazu aus `territory-detail.php` für das tiefste Gebiet: Wappen (Lizenz geprüft),
Wiki-Artikel, Sprache (Garethi), Währung, Gründung, Status.

---

## 2 · Der Weg der Daten — zwei Runden

**Runde 1, sofort und ohne Server.** Koordinate, nächste Ortschaften, nächster
Weg samt Fußpunkt, Flüsse, Kraftlinien, freie Labels. Das liegt alles schon als
`locationData` / `pathData` im Browser; die Zahlen in §1 sind genau so gerechnet.

**Runde 2, eine Anfrage.** `GET /api/app/what-is-here.php?x=…&y=…` liefert die
Herrschaftskette, die vier Landschaftsebenen, die Klimazone und die
**Lore-Schlüssel**. Das Panel wird nachgezeichnet, wenn sie da ist — derselbe
zweistufige Ablauf wie beim Herrschaftsgebiet (`avesmapsShowRegionInInfopanel`
zeichnet erst, holt `territory-detail.php` nach, zeichnet erneut).

**Runde 3 gibt es nicht — und das ist der Punkt.** Natur & Waren holt der
vorhandene Lore-Container selbst: `buildLoreMarkup(placeRef)` setzt eine leere
Hülle in die Feldliste und füllt sie, sobald `lore.php` antwortet. Für eine
Siedlung tut er das seit Monaten. Er bekommt hier dieselbe Art von `placeRef` —
mehr ist an der Lore nicht zu bauen.

### Warum ein eigener Endpunkt

Der vorhandene Politik-Layer kann die Frage bereits beantworten
(`political-territories.php?action=layer&bbox=…`), aber er antwortet mit
**Geometrie**: gemessen **397.738 Bytes** für den Landpunkt und **387.044** für
den Seepunkt — weil das Kaiserreich-Polygon die halbe Karte bedeckt und
mitreist. Der neue Endpunkt liefert **Namen**, rund 2 KB.

⭐ **Billig ist er, weil die Arbeit schon getan ist.** Beide Tabellen haben einen
bbox-Index:

```
KEY idx_political_territory_geometry_bbox (min_x, min_y, max_x, max_y)   api/_internal/political/territory.php:84
KEY idx_ecosystem_area_bbox               (min_x, min_y, max_x, max_y)   api/_internal/app/ecosystem.php:300
```

Eine Punktabfrage (`min_x <= :x AND max_x >= :x AND min_y <= :y AND max_y >= :y`)
trifft damit eine Handvoll Zeilen statt der ganzen Tabelle.

---

## 3 · Der Endpunkt

```
GET /api/app/what-is-here.php?x=<float>&y=<float>[&year_bf=<int>]

{ "ok": true,
  "point": { "x": 491.032, "y": 516.016 },
  "territories": [                       // 💣 BLATT -> WURZEL, entdoppelt
    { "name": "Grafenmark Ferdok", "short_name": "", "type": "Grafenmark",
      "territory_public_id": "b006076c-…", "coat_url": "/uploads/wappen/…" },
    …
    { "name": "Heiliges Neues Kaiserreich vom Greifenthron zu Gareth", … }
  ],
  "landscapes": {                        // je Ebene 0..n Treffer
    "derographisch": [ { "name": "Aventurien", "type_label": "Kontinent",
                         "region_public_id": "…", "wiki_key": "aventurien" } ],
    "topographie":   [ … ],
    "vegetation":    [ … ],
    "klima":         [ { "name": "Gemäßigte Zone", "key": "gemaessigt" } ]
  },
  "lore": { "place": ["grafenmark-ferdok", "dunkelwald"],   // wiki_keys: Gebietskette + Regionen
            "area":  ["9188801c-…", "37794487-…"] }         // Regions-public_ids
}
```

🔴 **`place` trägt BEIDES — die Gebietskette UND die Landschaftsregionen**, denn
die Lore hängt mal am einen, mal am anderen. Gemessen: `grafenmark-ferdok` (das
Gebiet) liefert die *Ferdoker Kriegslanze*, `dunkelwald` (die Vegetationsfläche)
liefert nichts — auf Maraskan ist es umgekehrt, dort trägt die
**Topographiefläche** „Maraskan" alle 214 Einträge und das Gebiet keinen. Wer nur
eine der beiden Quellen fragt, verliert an der Hälfte der Karte alles.

⚠️ **`area` ist etwas anderes als `place`** und ersetzt es nicht: `area` prüft die
**Lebensraum-Regeln** gegen die Regionen, `place` die **Ortsverknüpfungen** der
Wiki-Artikel. Gemessen über 25 Vegetationsregionen liefern die Regeln heute
zusammen **einen einzigen** Eintrag (die Vierblättrige Einbeere) — die Masse
kommt aus `place`. Beide gehören trotzdem mit: die Regeln sind die Zukunft dieser
Zeile, und `lore.php` vereinigt sie in einer Anfrage.

Fehler nach dem Goldvertrag (AGENTS §4): `{ "ok": false, "error": { "code": …,
"message": … } }`, Codes `bad_request` (x/y fehlt oder ist keine Zahl) und
`point_out_of_bounds` (außerhalb 0…1024).

**Regeln, die im Endpunkt stehen:**

- 💣 **bbox ist ein Vorfilter, kein Treffer.** Nach der SQL läuft
  `avesmapsPointInGeometry` über jeden Kandidaten. Am Seepunkt lagen **9 Gebiete**
  im bbox und **0** haben den Punkttest bestanden. Wer den bbox-Treffer für die
  Antwort hält, schreibt vier Herrschaften mitten ins Perlenmeer.
- 💣 **`territories` steht BLATT → WURZEL, nicht umgekehrt.** Nicht weil das
  schöner wäre, sondern weil `buildSettlementHierarchyMarkup` (`js/ui/popups.js:863`)
  die Treppe genau so erwartet und selbst umdreht — dieselbe Richtung, die
  `map-features.php` einer Siedlung mitgibt. Gedreht geliefert stünde die
  Grafenmark oben und das Kaiserreich unten, und die Treppe zeigte in die falsche
  Richtung. Das Panel benutzt diese Funktion **unverändert**.
- 💣 **Ein Gebiet kann MEHRFACH getroffen werden.** Am Inselpunkt liefert der
  Punkttest die Fürstkomturei Tobimora **zweimal** — dasselbe Gebiet mit zwei
  Geometrie-Zeilen. Entdoppelt wird über `territory_public_id`, nicht über
  `geometry_public_id`. (Das ist die bekannte Eigenart „VIELE Features je Gebiet".)
- 🔴 **KORRIGIERT (Fix-Runde 3, 15.08.2026): der Punkttest allein findet fast nie
  die ganze Kette.** Diese erste Fassung entschied bewusst, die Tiefe NUR innerhalb
  der Trefferliste des Punkttests zu bestimmen — kein zusätzlicher `parent_id`-Lauf
  in die Datenbank, mit der Begründung, ein Vorfahr ohne eigene Fläche solle „Liegt
  in" gar nicht erst nennen. **Live gemessen war das falsch:** Elterngebiete wie
  Grafschaft/Fürstentum/Kaiserreich sind fast immer **abgeleitete Außengrenzen**
  (`political_territory_derived_geometry`, `territories-derived-layer.php:306`
  setzt dort `is_aggregate = true`) — sie liegen in einer ANDEREN Tabelle als die
  gezeichneten Flächen und tragen strukturell **nie** eine eigene Geometrie, die
  der Punkttest finden könnte. Die Kette hatte dadurch fast immer nur EINE Stufe
  statt vier (gemessen an `x=491.032&y=516.016`: nur „Grafenmark Ferdok"). Der
  Endpunkt macht deshalb zusätzlich den `parent_id`-Lauf, den das Haus für
  Siedlungen längst benutzt (`api/app/map-features.php`, ~Zeile 780–815): ab dem
  tiefsten Punkttest-Treffer aufwärts durch `political_territory.parent_id`,
  gedeckelt bei 12 Stufen, mit Besuchsriegel gegen zyklische Elterndaten
  (`avesmapsWhatIsHereAncestorChain`/`avesmapsWhatIsHereReadAncestors`,
  `api/_internal/app/what-is-here.php`). Der Punkttest bleibt dafür zuständig, WO
  die Kette beginnt (und deckt den seltenen Fall mehrerer eigens gezeichneter
  Ebenen ab, z. B. Baronie UND Grafschaft beide mit eigener Fläche); der
  `parent_id`-Lauf ergänzt nur, was darüber liegt.
- 🔴 **Keine Zoom-Filterung.** Der Layer-Endpunkt kappt nach `min_zoom/max_zoom`,
  weil er zeichnet. Hier wird nicht gezeichnet: das Kaiserreich rendert nur auf
  Zoom 0–1, ist aber auch auf Zoom 5 das Reich dieses Punktes.
- Zeitbezug beim GEZEICHNETEN Treffer wie beim Layer: `valid_from_bf`/`valid_to_bf`
  (auf `political_territory_geometry`) gegen `year_bf` (Vorgabe: das laufende Jahr
  der App). ⚠️ **Der `parent_id`-Lauf der Vorfahren filtert NICHT nach `year_bf`** —
  bewusste Entscheidung (Fix-Runde 3): er folgt `parent_id` als Organigramm, genau
  wie die Siedlungs-Vorlage in `map-features.php` (die über `wiki_key` immer den
  aktuellsten Knoten wählt, unabhängig vom betrachteten Jahr). Ein Filter auf
  `political_territory.valid_from_bf`/`valid_to_bf` wäre hier riskanter als
  nützlich gewesen: gemessen tragen zwei der drei betroffenen Vorfahren
  `valid_to_bf = NULL`, und ein Filter hätte bei jeder Zeile mit enger oder
  lückenhaft gepflegter Zeitspanne die Kette erneut lautlos abgeschnitten — dasselbe
  Fehlerbild wie der eigentliche Befund dieser Runde, nur eine Ebene höher.
- 💣 **Kein DDL, keine `information_schema`-Sonde.** Dieser Endpunkt liegt auf
  einem Besucherpfad; genau davor warnt AGENTS §10 bei `territories-endpoint.php`.
- 🔴 **Die Derographie liefert KEINE Lore.** Ihre Fläche heißt „Aventurien", und
  „Aventurien" trägt **1.167** Lore-Einträge (`lore.php?stats=1`, top_places). Ihr
  Schlüssel in `lore.place` aufzunehmen hieße: jeder Punkt der Karte listet
  dieselben 1.167 Einträge. Was überall gilt, sagt über diese Stelle nichts —
  dieselbe Begründung, mit der die Infobox rank-3-Einträge aus der Vorschau nimmt.

---

## 4 · Das Panel

Kein neuer Kastentyp. Es ist die Infobox-Grammatik der Siedlung, mit einem
Subjekt, das keinen Namen hat.

> 💣 **Und das widerspricht NICHT dem Merksatz von `sharePinMenuMarkup`.** Dort
> steht „DIE MARKIERUNG IST KEIN ORT", und das war richtig: der geliehene
> Ortskasten hatte der Markierung nichts zu sagen — kein Name, kein Typ, keine
> Beschreibung, kein Wappen; übrig blieb sein Rahmen. Der Satz endet aber mit der
> Regel „wer hier etwas anbaut, fragt zuerst, ob der Ortskasten es könnte — und
> wenn ja, gehört es dorthin." Ab jetzt **kann er es**: die Markierung hat eine
> Herrschaftskette, vier Landschaftszeilen, Natur & Waren und eine Nachbarschaft.
> Der schwebende 215-px-Kasten fällt, der 400-px-Ortskasten im Panel trägt.

**Reihenfolge der Blöcke** (dieselbe wie bei der Siedlung, `map-features-location-marker-entry.js:154-165`):

1. **Kopf** — Bild, Titel „Markierte Stelle", Untertitel = die Koordinate.
2. **Kacheln** — `+ Reiseziel hinzufügen` (gefüllt) · `Link teilen` · `Entfernen` (Gefahr).
3. **„Liegt in"** — die vorhandene Treppe, Wurzel oben, jede Stufe ein Gold-Flug-Link mit Wappen.
4. **Feldliste** — Landschaft, Natur & Waren, Klimazone.
5. **„In der Nähe"** — eigener Abschnitt, Inhalt in derselben Tabellenform.

⭐ **Das Kopfbild IST der Landschaftsbefund.** „Wald" trifft
`icons/header/wald.webp`, „Insel" → `insel.webp`, „Meer" → `meer.webp` — über die
**vorhandene** Tabelle `INFO_HEADER_IMAGE_BY_ART` (`js/ui/popups.js:303`). Keine
zweite Liste. Vorrang: Vegetation, sonst Topographie, sonst `region.webp`.

⚠️ **Das Wappen gehört an die „Liegt in"-Zeile, nicht in den Kopf.** Es ist das
Wappen des Gebiets, nicht dieser Stelle — im Kopf läse es sich, als hätte der
Punkt eins.

### Die Zeilen der Feldliste

| Zeile | Quelle | Bemerkung |
|---|---|---|
| Derographie | `landscapes.derographisch` | |
| Topographie | `landscapes.topographie` | |
| Vegetation | `landscapes.vegetation` | 💣 **mehrere Treffer sind der Normalfall** |
| **Waren** | `lore.php` | Deckel, „70 Handelswaren gelistet" |
| **Fauna** | `lore.php` | Deckel, „74 Tierarten beobachtet" |
| **Flora** | `lore.php` | Deckel, „70 Pflanzenarten gesehen" |
| Klimazone | `landscapes.klima` | 🔴 **immer direkt unter Flora** (Owner 2026-08-03) |

🔴 **Waren · Fauna · Flora, in dieser Reihenfolge — das ist `AVESMAPS_LORE_ROWS`
(`map-features-lore.js:251`), keine Wahl dieses Entwurfs.** `lore.php` liefert
zusätzlich `spezies`; die Infobox hat diese Art noch nie gezeigt, und „Was ist
hier?" erfindet dafür keine vierte Zeile.

🔴 **Jede Lore-Zeile ist ein Deckel, auch bei EINEM Eintrag.** Owner 12.08.2026:
„auch 2 Tierarten leben hier / Berglöwe, Griswolf ← einklappen". Der Gewinn ist
nicht der Platz, sondern dass alle Zeilen einer Box gleich aussehen. Im Mockup
steht am Landpunkt deshalb „1 Handelsware gelistet" als Deckel, nicht als
nackter Name.

🔴 **Eine Zeile ohne Antwort fällt weg, sie steht nie als „—" da.** Der Seepunkt
zeigt genau zwei Zeilen (Topographie, Klimazone) — und das ist eine vollständige
Antwort, kein Fehler. Leer werden kann das Panel nie: Koordinate und nächste
Ortschaft gibt es immer, die Owner-Regel „nie leer öffnen" gilt ohne Sonderfall.

---

## 5 · „In der Nähe"

Eigener Abschnitt wie Kartensammlung und Literatur, mit **genau deren Maßen** —
und das ist der Kern der Nacharbeit vom 15.08.:

```css
.avesmaps-near        == .avesmaps-citymaps / .avesmaps-adv     place-extras.css:7-12
.avesmaps-near__head  == .avesmaps-citymaps__head               place-extras.css:14-19
.avesmaps-near__count == .avesmaps-adv__count                   place-extras.css:172-175
.avesmaps-near__list  == margin-top von .avesmaps-citymaps__scroll  place-extras.css:27-31
randlos               == die Geschwisterliste                   infopanel.css:585-596
```

💣 Der erste Entwurf setzte stattdessen `--space-4`/`--space-3` und einen
`border-top` **im Inhalt** statt am Abschnitt. Ergebnis: kein Spielraum über der
Überschrift, und die Trennlinie lief nicht bis an die Panelkante. Gemessen nach
der Korrektur: 12 px Tabelle → Linie, 11 px + Linie → Überschrift, 9 px →
Liste, Abschnitt und Datentabelle beginnen beide bei derselben x-Kante.

Inhalt in derselben Tabellenform: `dt` = die **Art**, `dd` = Name · Entfernung ·
Pfeilchen. Namen sind `.avesmaps-traffic-link` — der vorhandene Knopf, der wie
ein Link aussieht und auf der Karte hinspringt (heute schon in der Zeile
„Verkehrswege").

### Die Auswahlregel, und wie sie entstanden ist

> **Die drei nächsten Ortschaften, dazu je Wegart höchstens ein Weg und höchstens
> vier Wege — und kein Weg weiter als das Anderthalbfache der weitesten
> gezeigten Ortschaft.** Alles zusammen nach Entfernung sortiert.

Jeder Teil dieser Regel hat einen gemessenen Anlass:

- **Ohne „je Wegart höchstens einer"** stünden am Landpunkt vier namenlose Wege in
  Folge — Pfad-5401, Pfad-5400, Weg-5248, Strasse-5219 —, bevor das erste Dorf
  käme. Am Seepunkt drängen sechs Wege **alle** Ortschaften aus der Liste.
- **Ohne die Entfernungsschranke** stünde am Inselpunkt eine **Reichsstraße 534
  Meilen** und ein **Wüstenpfad 634 Meilen** weit weg — formal die nächsten ihrer
  Art, praktisch auf einem anderen Kontinent.
- ⚠️ **Der Maßstab ist die Ortsliste, nicht die Wegeliste.** Eine Schranke, die
  mit dem mitwandert, was sie begrenzen soll, begrenzt nichts. Das ist die Lehre
  aus dem Querfeldein-Ausstiegspunkt (14.08.2026), wo drei Fassungen an einem Tag
  an genau diesem Fehler scheiterten.
- Die Schranke gilt **nur den Wegen**. Ortschaften haben keine: dass die nächste
  Stadt 35 Meilen entfernt ist, IST die Antwort.

💣 **Ein Weg ohne echten Namen wird nur mit seiner Art genannt** — „Pfad · 2,5
Meilen", nicht „Pfad-5401 · 2,5 Meilen". Eine laufende Nummer ist keine Auskunft;
dieselbe Regel sortiert im Konfliktzentrum 2.448 von 3.721 automatisch benannten
Wegen aus. Erkannt am Muster `<Wegart>-<Zahl>`.

⚠️ Ein Wegname steht an **vielen** Teilstücken — „Der Große Fluss" an 38. Gezählt
wird der Abstand zum nächsten Teilstück, gezeigt der Name einmal.

### Das Pfeilchen

Statt „N / NO / W" dreht sich eine Nadel um die **echte Peilung**. Am Landpunkt
stehen drei Zeilen auf „W" — sie liegen bei **259,1°**, **283,8°** und **284,2°**.
Das Wort wirft 25° weg, der Pfeil nicht.

- 💣 **Die Peilung ist `atan2(dx, dy)`, nicht das übliche `atan2(dy, dx)`.** Die
  Argumente sind vertauscht, damit 0° Norden ist und im Uhrzeigersinn gezählt
  wird — dieselbe Zählweise wie ein Kompass und wie `rotate()`. Mit der
  gewohnten Reihenfolge zeigt jeder Pfeil an der Diagonale gespiegelt, und das
  fällt bei genau N/O/S/W **nicht auf**.
- ⚠️ **Es gilt nur, weil y auf dieser Karte nach Norden wächst** (geprüft: Riva
  y=790 im Norden, Al'Anfa y=152 im Süden). Die Kachelnamen `map_x_-y` tragen ein
  **negatives** y — wer von dort abliest, dreht jeden Pfeil auf den Kopf.
- 🔴 **Die Nadel zeigt unbehandelt nach Norden.** Ein Pfeil mit Ruhelage nach
  rechts bräuchte `rotate(peilung − 90deg)` — eine zweite Zahl im Kopf, die
  irgendwann jemand vergisst.
- ⭐ **Inline-SVG mit `fill: currentColor`, kein Unicode-Pfeil.** Ein Zeichen sähe
  auf jedem Gerät anders aus und reiste durch die i18n-Tabelle mit — dieselbe
  Begründung, mit der die Markierungs-Kacheln Bilder aus `img/menu/` tragen.
- ⚠️ **Das Wort bleibt, nur unsichtbar:** `aria-label` liest ein Screenreader vor
  („Nordost"), `title` zeigt es beim Zeigen samt Gradzahl („Nordost (52°)").
- ⚠️ Bei 11 px sind 25° rund 2 px Spitzenversatz — sichtbar, aber fein. Größer
  würde die Nadel in einer 16-px-Zeile zum Fremdkörper.

---

## 6 · Die Markierung — eine, nicht zwei

Der Owner-Entscheid „Verschmelzen" hat fünf Folgen:

| Heute | Künftig |
|---|---|
| `sharePinMenuMarkup()` — das Zwei-Kachel-Popup am Marker | **fällt weg**, seine Befehle stehen im Panel-Band |
| Klick auf die Markierung → Popup | → **Panel** (dieselbe Regel wie bei jedem anderen Feature) |
| `bindSharePinDragging` → `openPopup()` beim Loslassen | → Abfrage neu, Panel neu zeichnen |
| `readSharePinFromUrl` setzt nur den Punkt | öffnet zusätzlich das Panel |
| „Stelle markieren und teilen" | **bleibt** — setzt dieselbe Markierung, kopiert sofort, ohne Panel |
| „🔗 Link für diese Route kopieren" (nur bei aktiver Route sichtbar) | wird **„Was ist hier?"**, immer sichtbar |

- 💣 **Beim Ziehen NICHT `setSharePin` aufrufen.** Die Funktion wirft den Marker
  weg und baut einen neuen — also genau den, an dem Leaflet gerade seinen Drag
  abschließt (`TypeError` in `finishDrag`). Der Marker liegt nach dem Ziehen
  bereits richtig; zu tun bleibt, was nicht am Marker hängt: Koordinate, geteilter
  Link, Panel.
- 💣 **„Entfernen" muss das Panel mitschließen.** Das Infopanel wird nie leer
  gezeigt; die Markierung wegzunehmen und einen leeren Kasten stehen zu lassen
  wäre genau der Zustand, den es nicht gibt.
- 🔴 **Jeder bestehende `?pin=`-Link ändert sein Verhalten** — bisher ein Punkt,
  künftig ein Punkt *und* die Antwort. Das ist der eigentliche Gewinn, wirkt aber
  rückwirkend auf jeden schon geteilten Link.
- ⚠️ **Der freie Kartenpunkt aus „Hierher reisen" bleibt getrennt.** Er ist eine
  Wegpunkt-Zeile im Planer, kein Marker mit Zustand, und behält seine Kachel
  „Verschieben" — die gibt es dort, weil kein Marker zum Anfassen danebensteht.
- ⚠️ Der Routen-Link verschwindet damit aus dem Kartenmenü. Er bleibt als
  🔗-Knopf in der Reiseübersicht (`route-plan.js:1064`).

---

## 7 · Kosten

- **Eine Anfrage je Klick**, zwei bbox-indizierte SELECTs, danach Punkttests in
  PHP. Kein DDL, keine Sonde, kein N+1.
- ⚠️ **Was bleibt, ist das Dekodieren.** Am Landpunkt liegen rund 50
  Geometrie-Zeilen im bbox; ihr `geometry_geojson` muss der Server lesen, auch
  wenn er es nicht sendet. Gespart werden die 388 KB **Antwort**, nicht die
  Decode-Zeit. Vor dem Live-Gang wird sie einmal gemessen (Abnahme, Schritt 8).
  ✅ **GEMESSEN 15.08.2026, live gegen STRATO:** Landpunkt mit vier Gebietsstufen und fünf
  Landschaftsflächen **0,127 s** (2147 Bytes), Seepunkt ohne Herrschaft **0,092–0,100 s** in zwei
  Läufen. Zum Vergleich: `map-features.php` braucht für dieselbe Datenbank 2,4 s bei 2,89 MB, und
  der Politik-Layer allein hätte für diesen einen Punkt 388 KB geschickt.
  ⚠️ Die Zahl gilt für den Stand **nach** der Schlussprüfung: bis dahin lud der Wappen-Riegel
  über `avesmapsLoadSettlementCoatGateInputs` **zwei Tabellen ganz** — je Rechtsklick, obwohl der
  Lader für einen Aufruf je 2,9-MB-Payload gebaut war. Seit der geschlüsselten Variante
  (`WHERE wiki_key IN (…)`, beide Tabellen haben den UNIQUE-Schlüssel) ist es ein Indexzugriff.
- **STRATO:** eine Anfrage je Klick, nie im Zyklus. Kein Dauerlauf, kein Polling.
- Cache: keiner in Fassung 1. Die Antwort ist klein und punktabhängig; ein ETag
  je Koordinate träfe praktisch nie.

---

## 8 · Was nicht dazugehört

Alles hier ist möglich und nichts davon in Fassung 1:

- **Höhe über NN.** Die Raster liegen bbox-indiziert in `ecosystem_area_heightmap`
  und `avesmapsHeightmapSampleSum` liest punktuell. 💣 Der Leser muss **summieren**
  — jedes Raster trägt nur das Feld seiner eigenen Fläche.
- **Querfeldein-Tempo der Landschaft** (`terrain_speed_factor` am Regionstyp).
- **Literatur, Stadtkarten, Quellen** des tiefsten Gebiets.
- **Ansprüche / umstrittene Gebiete** (`political_territory_claim`).
- **Reisezeit** zur nächsten Ortschaft.
- Ein `spezies`-Zeile (siehe §4).

---

## 9 · Abnahme — Handgriffe, keine Maßtabelle

💣 Eine Prüfseite, die Rechtecke misst, belegt nicht, dass etwas funktioniert.
Vor „fertig" werden diese Schritte ausgeführt und benannt:

1. Rechtsklick auf freies Land → **„Was ist hier?"** steht im Menü, „🔗 Link für
   diese Route kopieren" nicht mehr.
2. Klicken → Markierung erscheint **und** das Panel geht auf, mit Kette,
   Landschaft, Klimazone.
3. Warten, bis Natur & Waren nachlädt → die Deckel „Waren / Fauna / Flora"
   erscheinen; einen aufklappen.
4. Eine Stufe der „Liegt in"-Treppe anklicken → die Karte fliegt dorthin.
5. Einen Nachbarn in „In der Nähe" anklicken → seine echte Infobox öffnet sich.
6. Die Markierung **ziehen** → Panel rechnet neu, Kette und Landschaft ändern
   sich, kein `TypeError` in der Konsole.
7. `+ Reiseziel hinzufügen` → die Stelle steht als Wegpunkt im Planer.
   `Entfernen` → Marker weg **und** Panel zu.
8. Denselben Punkt auf **See** anfahren (`?pin=300.000,640.000`) → keine „Liegt
   in"-Treppe, keine Vegetation, keine Lore-Zeilen, und trotzdem eine lesbare
   Auskunft.
9. Einen geteilten `?pin=`-Link in einem frischen Tab öffnen → Markierung **und**
   Panel.
10. Die Serverzeit des Endpunkts einmal messen und hier eintragen.
11. Das **ganze** Testfeld laufen lassen, nicht nur die eigenen Tests
    (AGENTS §9) — ein roter Test lädt nichts hoch.

⚠️ Was ein Emulator nicht beantworten kann — Touch-Verhalten des Ziehens am
Telefon, Bildschirmtastatur — wird als offene Frage gemeldet, nicht als bestanden.

---

## 10 · Offene Entscheidungen

- 🔧 **Kachelbeschriftung.** „Reiseziel hinzufügen" bricht in der 81-px-Spalte auf
  drei Zeilen um. Das ist die Beschriftung und das Raster, die die
  Siedlungs-Infobox heute schon benutzt — also kein neuer Fehler. Lassen, oder auf
  „Reiseziel" kürzen?
- 🔧 **Zähler.** „In der Nähe (7)" zählt die **gezeigten** Zeilen, nicht alles in
  der Umgebung. Richtig so, oder soll die Zahl weg?
- 🔧 **Deep-Link.** Soll `?pin=` das Panel **immer** öffnen, oder nur, wenn ein
  zusätzlicher Parameter das sagt? Fassung 1 öffnet immer (§6).

---

## Belege

Alles unter §1 stammt aus Live-Abfragen vom 15.08.2026:

| Was | Aufruf |
|---|---|
| Landschaften | `GET /api/app/ecosystem-areas.php?bbox=490.9,515.9,491.2,516.2` |
| Herrschaft | `GET /api/app/political-territories.php?action=layer&bbox=…&zoom=5` |
| Gebietsdetail | `GET /api/app/territory-detail.php?territory=b006076c-…` |
| Natur & Waren | `GET /api/app/lore.php?place=grafenmark-ferdok&area=…` |
| Lore-Umfang | `GET /api/app/lore.php?stats=1` → 5.104 Einträge, „Aventurien" 1.167 |
| Nachbarschaft | lokal aus `GET /api/app/map-features.php` gerechnet |

Umrechnung: `DISTANCE_SCALING_FACTOR = 3` (`js/config.js:20`) — **1 Karteneinheit
= 3 Meilen**, und 1 Meile = 1 km laut Tempo-Erklärung.
