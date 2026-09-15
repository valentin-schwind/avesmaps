# Wege: weitere Wiki-Zuweisungen · Klick auf Straße oder Abschnitt · „Weg als Route"

**Stand:** 14.09.2026 · **Anlass:** Idee #116 (Discord, „Vorgefertigte Routen": Pilgerpfade,
Karawanenrouten, Schifffahrtswege) · **Mockup:** `docs/wege-mehrfachzuweisung-mockup.html`
(Owner am Mockup: „perfekt das wollen wir"; Zustände per Anker `#rs`, `#rs7`, `#bp`, `-route`).

Der Owner hat #116 bewusst **anders** zugeschnitten als vorgeschlagen: keine kuratierte Routenliste,
sondern (1) ein Wegabschnitt darf mehrere Wiki-Artikel tragen, (2) die Karte unterscheidet beim
Bearbeiten zwischen ganzer Straße und Abschnitt, (3) jeder Weg lässt sich als Route in den
Routenplaner setzen.

---

## 0. Owner-Entscheide (14.09.2026)

| # | Entscheid | Wortlaut / Anlass |
|---|---|---|
| E1 | **Haupt + weitere.** Die erste Zuweisung bleibt die Identität des Wegs; weitere kommen zusätzlich dazu. | Auswahl „Haupt + weitere" |
| E2 | **Der Wegname bleibt.** Weitere Zuweisungen benennen nie um. Regel R1 (`path-naming.php`) bleibt unverändert. | „der wegname bleibt … die editoren bestimmen über ‚Wegname' weiterhin" |
| E3 | **Kein Stationen-Werkzeug.** Weitere Zuweisungen werden am Abschnitt bzw. an der markierten Straße gesetzt, nicht über eingetippte Stationen. | „du machst was glaub zu kompliziert" |
| E4 | **1. Klick = ganze Straße, 2. Klick = Abschnitt**, einfacher Klick, kein Doppelklick. „Bearbeiten" bearbeitet das Markierte. „Ganze Straße" ist die Gruppe des Wege-Editors. | „der 1. klick markiert alles zusammenhängende gleichen namens (wie im wege editor), der 2. nur das segment" |
| E5 | **Ein Abschnitt heißt „von wo bis wo".** Kreuzungen ohne Nummer. | „es geht nur darum, dass der besucher den kontext versteht" |
| E6 | **Markierungszeile kurz, ohne Kasten**, direkt unter der Wegart: „Ganze Straße: Perz – Helmdahl" / „Abschnitt: Silkwiesen – Wieha". | „das ding braucht keine box einfach unter ‚Reichsstraße'" |
| E7 | **Die Linie selbst wird gelb**, keine Umrandung. | „du kannst den pfad einfach gelb markieren" |
| E8 | **Kachel „Weg als Route"** in der Infobox des Wegs. | Idee des Owners, im Mockup abgenommen |

---

## 1. Messungen am Livebestand (14.09.2026, `GET /api/app/map-features.php`, ein Abruf)

- **409** Straßen tragen eine Wiki-Zuweisung; **21** davon sind Routen (20 Karawanenrouten, der
  Bärenpfad als einziger Pilgerweg). Alle 21 wurden **von Hand** zugewiesen (`source = editor`).
- **0** deckungsgleich doppelt gezeichnete Linien. Die Routen haben sich Abschnitte **geteilt**:
  „Punin → Kannemünde" und „Keft → Achan" greifen an 6 Stellen ineinander, „Keft → Kannemünde" steckt
  an 4 Stellen in „Punin → Kannemünde". Jeder dieser Abschnitte musste sich für EINE Route entscheiden.
- Pilgerwege der Wiki-Liste über bestehende Straßen (Geronsgang, Viergötterwallfahrt, Zwölfergang,
  Schwanenweg) fehlen ganz — zuweisen ginge heute nur, indem man der Straße den Namen nimmt. Der
  Geronsgang (Brig-Lo → Arivor → Neetha) läge grob auf **43** Abschnitten von **11** Wegen; sein
  Artikel hat keinen Verlauf.
- **107 von 409** Straßen haben Lücken (Belen-Horas-Straße 4 Stücke, Reichslandstraße
  Havena–Abilacht 8). „Ganze Straße" darf deshalb **nicht** „zusammenhängend" heißen, sondern die
  Gruppe (E4).
- Der **Doppelklick** auf einen Weg ist im Bearbeiten-Modus belegt: „Verlauf bearbeiten"
  (`handleEditablePathDoubleClick`, setzt einen Stützpunkt).
- **Abschnittsenden** (4.878 Abschnitte ohne Seeweg): 1.745 mit Ort an beiden Enden, 1.997 an einem,
  1.136 an keinem; 3.356 Enden an Kreuzungen, 913 lose.
- **„Weg als Route"** über 580 Straßen mit echtem Namen: Median **1** Ort, p90 **8**, p99 **23**,
  Maximum **43** (Silem-Horas- und Seneb-Horas-Straße; Reichsstraße 2: 40). **23** Straßen haben mehr
  als 12 Orte, **5** mehr als 25.
- Der Routenplaner fragt **jede Etappe einzeln und nacheinander** an
  (`buildRouteResultFromSelectedLocationsServer`, `js/routing/route-engine.js`); jede Anfrage baut
  auf dem Server den Graphen neu. Der Server kann Zwischenstationen längst in EINER Anfrage (`via`,
  höchstens 10, `api/README.md`).

---

## 2. Teil A — Datenmodell: weitere Zuweisungen

### 2.1 Form

- `properties.wiki_path` bleibt **unverändert** die Identität des Abschnitts: Name (R1), Gruppe,
  Verlauf-Abgleich, Fließrichtung, Zeitfenster-Weitergabe, Kanon-Etikett.
- Neu: `properties.wiki_path_weitere` — eine Liste, je Eintrag
  `{ wiki_key, name, wiki_url, art, kind }`. Keine Tabelle, keine Migration, kein Einmal-Lauf.
- 💣 **Warum kein Array aus `wiki_path` selbst:** rund 45 Leser greifen auf `wiki_path.wiki_key`,
  `.name`, `.wiki_url` zu (etwa 30 Dateien). Ein Array ließe jeden davon still `undefined` lesen —
  nichts wirft, die Wege sähen einfach unzugewiesen aus. Mit einer zweiten Liste bleibt jeder
  bisherige Leser richtig, und nur die Stellen aus §2.3 müssen die Liste lernen.

### 2.2 Invarianten (Server)

1. Eine weitere Zuweisung setzt eine Hauptzuweisung voraus. Ohne `wiki_path` wird abgelehnt.
2. Kein Eintrag gleicht dem Hauptschlüssel; keine Dubletten (Vergleich über `wiki_key`).
3. Nur Artikel aus dem **Wege-Katalog** (dieselbe Quelle wie die Suche von „Ändern"). Ein Orts- oder
   Gebietsartikel ist keine weitere Weg-Zuweisung.
4. Eine weitere Zuweisung ändert **nichts** außer der Liste: kein Name, keine Gruppe, keine Art.
5. Wird die Hauptzuweisung entfernt, **bleiben** die weiteren stehen (E1 verlangt sie nur zum
   Hinzufügen).
6. 💣 **Jeder bestehende Schreiber von `wiki_path` muss die Liste erhalten** — `assign`, `assign_to`,
   `assign_all`, `clear_assign` (`api/_internal/wiki/paths.php`), der Details-Save
   (`api/_internal/map/features.php`), der Verlauf-Abgleich und die Garetien-Übernahme. Ein Schreiber,
   der `properties` neu zusammensetzt statt zu ändern, löscht sie still. Der Bauplan zählt die
   Schreiber zur Laufzeit, nicht per Grep.

### 2.3 Schreibweg

- Neue Aktionen in `api/edit/wiki/paths.php`: **`add_weitere`** und **`remove_weitere`**, Fähigkeit
  `edit`, Rumpf `{ wiki_key, public_ids: [...] }`. Die Liste der Abschnitte schickt der Client
  (dieselbe Regel wie `update_path_group_details`: der Server bildet die Gruppe NICHT nach), Deckel
  `AVESMAPS_PATH_GROUP_MAX_SEGMENTS` (250).
- Sofort wirksam, ohne „Speichern" (wie der Wiki-Kasten heute). Ein Audit-Eintrag **je Abschnitt**,
  ein `map_revision`-Bump am Ende. Geschrieben wird nur an Abschnitten, deren Liste sich wirklich
  ändert.
- `remove_weitere` nimmt den Eintrag von **allen** genannten Abschnitten, die ihn tragen.

### 2.4 Wer die Liste lernen muss

| Stelle | Was sich ändert |
|---|---|
| Infobox des Wegs (`map-features-path-rendering.js`) | Zeile **„Auch Teil von: Bärenpfad ↗"** (Abschnitt) bzw. mit Abschnittsname in Klammern (ganze Straße); beim Artikel der weiteren Zuweisung Zeile **„Verläuft auch über: Reichsstraße 2 ↗ (Abschnitt 7: Silkwiesen – Wieha)"**. Klick hebt den Weg hervor. |
| Suche, Browser (`spotlight-search.js`) | Ein Abschnitt kommt in die Gruppe seiner Hauptzuweisung **und** jeder weiteren; ein Treffer „Bärenpfad" hebt auch den Reichsstraßen-Abschnitt hervor. |
| Suche, Server (`api/app/map-search.php`) | Ein Treffer je Artikel, weitere Zuweisungen eingeschlossen. ⚠️ Server und Browser müssen dieselbe Menge kennen, sonst fällt ein Servertreffer beim Auflösen still weg (§11, Spiegelungsregel der Wegnamen). |
| „Anzeigen" und `?strasse=`/`?fluss=` (`wiki-deeplink.js`) | Abschnitte, deren Haupt- **oder** weitere Zuweisung den Artikel trägt. |
| Verlauf-Abgleich (`path-verlauf.php`, Regel „foreign") | Ein Abschnitt, der den Artikel als weitere Zuweisung trägt, zählt als dazugehörig: nicht „fremd", nicht hinzufügen, nicht entfernen. |
| Wege-Editor Liste (`wege-editor.js`, `paths-editor.php`) | `wiki_path_weitere` reist in der Liste mit; Abschnittszeile trägt **„Weitere Zuweisungen: Bärenpfad"**; die Suche im Wege-Editor findet den Abschnitt auch über den weiteren Namen; einsortiert bleibt er unter der Hauptzuweisung. |
| Wege-Editor Detail und Dialog „Weg bearbeiten" | Wiki-Kasten mit Zuweisungsliste und Suchfeld „Weitere Wiki-Zuweisung für …" (§3.5). |
| „Weg als Route" | Sammelt Abschnitte mit Haupt- **oder** weiterer Zuweisung (§5). |

### 2.5 Bewusst unverändert

Wegname und Kartenbeschriftung · Gruppen im Wege-Editor · Kanon-Etikett (folgt der Hauptzuweisung)
· Quellen und Publikationsabgleich · Literatur und Stadtkarten · Konfliktzentrum (eine weitere
Zuweisung ist kein Anspruch; §2.2 Nr. 3 hält Nicht-Wege-Artikel ohnehin fern) · Zeitfenster-Weitergabe
und Fließrichtung (beide über den Hauptschlüssel).

---

## 3. Teil B — Klick auf der Karte (nur Bearbeiten-Modus)

### 3.1 Zustand

Ein Modulzustand `{ gruppe, publicId | null }`, die Übergänge in einer **reinen** Funktion (kein DOM,
kein Leaflet), damit sie ausgeführt statt gelesen getestet wird:

| Klick | Ergebnis |
|---|---|
| auf einen Weg, nichts markiert oder andere Straße | ganze Straße |
| auf die markierte ganze Straße | der angeklickte Abschnitt |
| auf einen anderen Abschnitt derselben Straße | dieser Abschnitt |
| auf den markierten Abschnitt | wieder die ganze Straße |
| daneben (Karte) | Markierung weg |

- **Besucher klicken wie heute** (E4 gilt dem Bearbeiten).
- Der Doppelklick bleibt „Verlauf bearbeiten". ⚠️ Ein Doppelklick feuert vorher zwei `click`: die
  Markierung darf dabei wechseln, der Verlauf-Editor startet trotzdem am richtigen Abschnitt.
- Der Klick-Schiedsrichter (Ort auf dem Weg gewinnt) bleibt unberührt.

### 3.2 Gruppe

- Dieselbe Regel wie `wpGroupKeyOf` / `wpGroupWays` (`js/pages/wege-editor-model.js`, auf der Karte
  schon geladen): `wiki:<Hauptschlüssel>`, sonst `name:<Wegart>:<Name>` — über Lücken hinweg.
- 💣 **`name` heißt im Browser etwas anderes als im Wege-Editor.** `normalizeRoutePathFeature`
  schreibt beim Laden den Maschinennamen `<Art>-<n>` in `properties.name` und legt den echten nach
  `original_name`. Wer `wpGroupKeyOf` mit den Browser-Eigenschaften füttert, gruppiert alle
  unzugewiesenen Wege nach Maschinennamen — genau die Falle, die den Prüfhaken „Keine
  Wiki-Zuweisung" am 01.09.2026 gekostet hat. Der Adapter reicht den Namen herein, wie es dort
  `getPathTitleName` tut; ein Test fährt ihn mit einer echten normalisierten Nutzlast.

### 3.3 Markierung auf der Karte (E7)

- Die markierten Abschnitte zeichnen ihre **Linie selbst** in der Farbe von
  `SPOTLIGHT_PATH_HIGHLIGHT_STYLE.color` (`#ffd72e`, `js/ui/spotlight-search.js`), in der Breite der
  Linie — keine Umrandung. Die Farbe wird aus der Konstante gelesen, nicht abgeschrieben.
- Ist die ganze Straße eines Artikels markiert, der an fremden Abschnitten als **weitere** Zuweisung
  hängt, erscheinen diese **gestrichelt**: angezeigt, nicht mitbearbeitet.

### 3.4 Infobox (E6)

- Unter der Wegart eine Zeile ohne Kasten: **„Ganze Straße: A – B"** oder
  **„Abschnitt: A – B"** (Enden nach §4, im Kurzformat ohne Nummer).
- Editorband: „Bearbeiten" öffnet den Dialog für das Markierte; **„Verlauf bearbeiten" nur am
  Abschnitt** — eine Linienänderung über eine ganze Straße gibt es nicht.

### 3.5 Dialog „Weg bearbeiten"

- Oben dieselbe kurze Zeile wie in der Infobox.
- **Ganze Straße:** die Felder der **Weg-Ebene des Wege-Editors**, über
  `update_path_group_details` — Wegname, „Weg anzeigen", Wegtyp, Transportmittel. Geschrieben wird
  **nur, was angefasst wurde**; ein uneiniges Feld zeigt „— gemischt lassen —" bzw. einen halben
  Haken „teils · 7 von 10". Der Speicherknopf nennt die Zahl: „Speichern für 10 Abschnitte".
  Zeitfenster wirken wie heute über den Hauptschlüssel ohnehin für alle Abschnitte. Bach-Haken und
  Strömung bleiben am Abschnitt. Quellen im festen Verteiler-Modus („An allen N Abschnitten").
- **Abschnitt:** der Dialog wie heute.
- **Wiki-Kasten** in beiden Fällen: Kopf „Wiki-Weg" mit Ändern · Sync · Entfernen, darunter die
  Zuweisungsliste — links, von wo bis wo sie gilt („ganze Straße · Perz – Helmdahl" bzw.
  „Abschnitt 7: Silkwiesen – Wieha"), dann Artikel ↗ und Schlüssel, rechts „Hauptzuweisung" bzw.
  „weitere" mit ✕ — und das Suchfeld **„Weitere Wiki-Zuweisung für die ganze Straße"** bzw.
  **„… für Abschnitt 7: Silkwiesen – Wieha"**. Hinweis: „Eine weitere Zuweisung ändert den Wegnamen
  nie."

---

## 4. Teil C — Wie ein Abschnitt heißt (E5)

- **Langform** (Listen, Wiki-Kasten): `Abschnitt N: <Ende> – <Ende>`; ein Weg aus nur einem
  Abschnitt ohne Nummer.
- **Kurzform** (Markierungszeile): `Abschnitt: <Ende> – <Ende>` bzw.
  `Ganze Straße: <Ende> – <Ende>`.
- **Ende:** Ortsname, wenn ein Ort höchstens `LOCATION_ENDPOINT_EXACT_HIT` (0,01, `js/config.js`,
  Zwilling `AVESMAPS_ROUTE_CLIENT_ENDPOINT_EXACT_HIT`) entfernt liegt — dieselbe Toleranz, mit der
  der Router ein Wegende an einen Ort hängt; sonst **„Kreuzung"** (ohne Nummer), wenn dort ein
  Kreuzungspunkt liegt (Punktart `crossing` oder `junction` der Nutzlast, gemessen 746 und 1.409);
  sonst **„Wegende"**.
- **Ein verborgener Ort heißt wie der Ort** (Owner 14.09.2026: „verborgener ort heißt wie der
  verborgene ort") — keine Sonderregel in der Benennung.
- **Ganze Straße:** die beiden äußeren Enden der längsten Kette (`wpChainSegments`); fehlt dort ein
  Ortsname, steht nur „Ganze Straße".
- **Nummer N:** die Nummer des Wege-Editors. 💣 Sie muss aus **einer** Funktion kommen, die Karte
  und Wege-Editor beide rufen. Heute sortiert `wpGroupWays` nach der Hüllbox, die
  `paths-editor.php` aus den **gespeicherten** Spalten `min_x…max_y` liest; die Karte muss sie aus
  der Geometrie rechnen. **Gemessen am Dump vom 08.09.2026:** bei allen **6.065** aktiven Wegen
  stimmen die Spalten mit der Geometrie überein (Abweichung ≤ 0,001) — aber **4 von 477**
  mehrteiligen Straßen sortieren trotzdem verschieden, weil Rundungsrauschen einen Gleichstand kippt.
  Deshalb sortiert `wpGroupWays` künftig nach den auf **zwei Nachkommastellen gerundeten** Werten
  (x, dann y) und bei Gleichstand nach `public_id`; die Karte ruft dieselbe Funktion mit der aus der
  Geometrie gerechneten Hüllbox. Preis: in diesen 4 Straßen ändert sich im Wege-Editor die Nummer
  einmalig.
- Ein reines Modul (kein DOM), geladen von `index.html` und der Wege-Editor-Seite.

---

## 5. Teil D — „Weg als Route" (E8)

### 5.1 Kachel

- In der Infobox des Wegs nach „Änderungen vorschlagen", Symbol `img/menu/waypoint-end.webp` (die
  Ziel-Nadel des Routenplaners). Sichtbar, wo „Anzeigen" sichtbar ist (Wiki-Artikel vorhanden, kein
  Seeweg).
- **Besucher:** immer die ganze Straße. **Editoren:** das Markierte (ganze Straße oder Abschnitt).

### 5.2 Welche Orte, in welcher Reihenfolge

- Abschnitte: alle mit dem Artikel als Haupt- **oder** weiterer Zuweisung (am Abschnitt: nur er).
- Reihenfolge: die Ketten aus `wpChainSegments`; mehrere Stücke (Lücken) werden vom Anfang der
  längsten Kette aus nach dem jeweils nächsten Ende aneinandergehängt.
- Orte an den Enden in dieser Reihenfolge; Kreuzungen und verborgene Orte übersprungen,
  aufeinanderfolgende Dopplungen entfernt.
- Die Orte **ersetzen** die Wegpunkte des Routenplaners (`resetWaypointInputs`, danach
  `updateMapView`).

### 5.3 Last auf STRATO — Pflicht, nicht Kür

- 💣 Mit einer Anfrage je Etappe hieße die Reichsstraße 2 **39** schwere Anfragen am Stück.
  `buildRouteResultFromSelectedLocationsServer` bündelt deshalb aufeinanderfolgende Wegpunkte in
  Anfragen mit `via` (höchstens 10 Zwischenstationen, also 12 Orte je Anfrage): Reichsstraße 2 →
  **4** Anfragen.
- Ein angeklickter Kartenpunkt („Hierher reisen") kann nicht in `via` stehen; er ist immer
  Bündelgrenze.
- ⚠️ Das gilt für **jede** Route mit mehreren Wegpunkten, nicht nur für „Weg als Route". Der Bauplan
  prüft an echten Routen, dass Etappenliste und Knotennamen gebündelt und einzeln gleich
  herauskommen.
- ⚠️ Scheitert eine Etappe, antwortet der Server für die ganze Anfrage `found: false`; die Meldung
  nennt dann Anfang und Ende des Bündels statt der Etappe.

### 5.4 Grenze

Der Router wird nicht gezwungen: zwischen zwei benachbarten Orten kann er eine günstigere
Parallelstraße nehmen. Mit jedem Ort der Straße als Wegpunkt ist das selten, ausgeschlossen ist es
nicht.

---

## 6. Tests

- **A:** `add_weitere`/`remove_weitere` gegen SQLite gefahren (Invarianten §2.2 einzeln); die
  Schreiber aus §2.2 Nr. 6 zur Laufzeit gezählt und je gegen eine Nutzlast mit Liste gefahren;
  Verlauf-Abgleich mit einem Abschnitt, der den Artikel als weitere Zuweisung trägt.
- **B:** die Zustandsfunktion ausgeführt (alle Zeilen aus §3.1, dazu Doppelklick); der
  Gruppen-Adapter mit einer **normalisierten** Browser-Nutzlast.
- **C:** Benennung an Ort / Kreuzung / Wegende / Einzelabschnitt; dieselbe Nummer auf Karte und im
  Wege-Editor.
- **D:** Reihenfolge an einer Straße mit Lücke und einer mit weiterer Zuweisung (Bärenpfad-Fall);
  Bündelung: 40 Wegpunkte → 4 Anfragen, Ergebnis gleich der Einzelfahrt.
- Jede Teillieferung: das ganze Testfeld nach dem Muster des Workflows (AGENTS §9), und als Besucher
  die Live-Konsole lesen.

---

## 7. Auslieferung

Vier Teile, **einzeln live**, der Owner sieht jeden (AGENTS §9):

1. **A + Wege-Editor-Anzeige** — Liste, Schreibweg, Wege-Editor-Zeile und Wiki-Kasten im Wege-Editor.
2. **C** — Abschnittsbenennung in Wege-Editor und Wiki-Kasten.
3. **B** — Klickfolge, Markierung, Infobox-Zeilen, Dialog im Gruppenmodus.
4. **D** — Bündelung mit `via` zuerst (unsichtbar, eigene Messung), dann die Kachel.

---

## 8. Offene Punkte

- **Geteilter Link:** `MAX_SHARED_WAYPOINTS = 25` (`js/config.js`) kappt eine geteilte Route; 5
  Straßen liefern mehr Orte. Bleibt vorerst so.
- **„Weg als Route" für Wege ohne Wiki-Artikel:** vorerst nicht (dieselbe Sichtbarkeit wie
  „Anzeigen").

---

## 9. Nachtrag 15.09.2026 — ein Kasten „Wiki-Weg“, Namensklick, Auswahl in Gold

**Stand:** 15.09.2026 · **Anlass:** Schlussprüfung der Lieferungen 1–7 und Owner-Durchsicht am Mockup ·
**Bauplan:** `docs/superpowers/plans/2026-09-15-wege-wiki-kasten-namensklick.md`

Dieser Nachtrag entscheidet, was §3.3, §3.5 und §4 offen ließen oder anders beschrieben haben, und korrigiert §2.3.
🔴 Wo er einer früheren Stelle dieses Entwurfs widerspricht, gilt der Nachtrag.

### 9.0 Owner-Entscheide (15.09.2026)

| # | Entscheid | Wortlaut / Anlass |
|---|---|---|
| E9 | **Ein Kasten „Wiki-Weg“ mit Liste**, wie im Mockup, statt zwei gestapelter Kästen — und die **Weg-Ebene** (ganze Straße) bekommt einen eigenen Kasten „Wiki-Weg“. | sinngemäß aus der Freigabe; löst „🔧 Owner offen: … gebaut sind zwei gestapelte Kästen“ (AGENTS.md §11) |
| E10 | **Im Bearbeiten-Modus markiert ein Klick auf die Namensschrift die Straße**, wie ein Klick auf die Linie. | löst „🔧 Offen: ob ein reiner Namensklick im Bearbeiten-Modus die Straße markieren soll“ |
| E11 | **Die Auswahl** (Straße oder Abschnitt markiert) **bekommt die Farbe markierter Orte**; „Anzeigen“ aus der Suche bleibt gelb. | löst „🔧 beide Markierungen … farblich nicht zu unterscheiden“ |
| E12 | **Rechte bleiben:** `api/edit/wiki/paths.php` verlangt weiter `review`. | §2.3 sagte `edit` — korrigiert wird der Entwurf, nicht der Code |
| E13 | `MAX_SHARED_WAYPOINTS = 25` und „Weg als Route nur mit Wiki-Artikel“ **bleiben**. | §8 bleibt, wie es steht |
| E14 | **Befund 6:** eine leer gewordene Liste bleibt als `[]` stehen, statt gelöscht zu werden. | freigegebene Lösung der Schlussprüfung |
| E15 | **Befund 7:** „Ganze Straße: Kreuzung – Wegende“ darf es nicht geben. | freigegeben; Auslegung von §4 in §9.3 |

### 9.1 Auswahl in Gold (E11) — ersetzt den ersten Punkt von §3.3

> 🔴 **Überholt am 15.09.2026 abends** (Owner mit Bild: „kannst du bei den wegen wo die kontur anders ist als der
> pfad auch gelb für die markierung nehmen. außerdem wärs schön dieses gelb zu haben (dasselbe gelb wie bei der
> spotlight suche)"). Die Auswahl liest jetzt `SPOTLIGHT_PATH_HIGHLIGHT_STYLE.color` und färbt **Kontur und Mitte**;
> ein fremder Träger behält die eigene Farbe seiner Mitte mit Strich über gelber Kontur (ohne sichtbare Kontur: gelber
> Strich wie bisher). Die Punkte unten beschreiben den Stand davor; die Regel „erst die Mitgliedschaft" gilt weiter.
> Das Mockup zeigt noch Gold.

- 🔴 Die Mittellinie markierter Abschnitte (durchgezogen) und fremder Träger (gestrichelt) liest das Token
  `--color-marker-active` (`css/base/tokens.css`, `#f0b429`, in hell und dunkel gleich) — die Farbe, die ein
  angeklickter Ort trägt. Gelesen über `getLocationMarkerActiveColor`
  (`js/map-features/map-features-location-canvas-layer.js`): normales Skript, für Besucher und Editoren geladen, in
  `index.html` vor `map-features-weg-auswahl.js`. Kein neuer Farbwert im JS; der vorhandene Rückfall `#f0b429` in
  jener Funktion ist Bestand und nur die Notbremse ohne Token.
- 🔴 `SPOTLIGHT_PATH_HIGHLIGHT_STYLE` (`js/ui/spotlight-search.js`, `#ffd72e`) bleibt unverändert — „Anzeigen“
  zeichnet damit weiter seine gelbe Linie.
- 💣 **Erst die Mitgliedschaft, dann die Farbe.** `avesmapsWegAuswahlStilNachziehen` läuft am Ende von
  `updatePathLayerStyle`, und `syncPathRendering` ruft das bei jedem Zoomschritt für alle rund 6.000 Wege. Heute
  liest die Funktion die Farbe vor der Probe, ob der Weg überhaupt markiert ist — mit einer Konstante kostete das
  nichts, mit `getComputedStyle` wäre es ein neuer Zoom-Hänger. Ohne Markierung wird die Farbe gar nicht gelesen.
- ⚠️ **Farbabstand, gemessen** (RGB-euklidisch aus den Hex-Werten, dazu die Farbtondifferenz; Information, kein Veto —
  der Owner hat die Farbe gewählt):

  | Nachbarton auf der Karte | Wert | Abstand | Δ Farbton |
  |---|---|---:|---:|
  | „Anzeigen“ (Suche) | `#ffd72e` | 38,4 | 6,6° |
  | Ring „offenes Wegende“ | `#e8850c` | 55,8 | 8,9° |
  | Wegpunkt-Ring | `#dcb877` | 80,6 | 3,3° |
  | Mittellinie Wüstenpfad | `#bea470` | 88,3 | 1,9° |
  | Import-Hover | `#b4651a` | 100,3 | 12,7° |
  | Mittellinie Gebirgspass / Pfad | `#a8695c` / `#9b755a` | 115,8 / 116,6 | 31,6° / 17,0° |
  | Wegpunkt rot / Ortsmarker | `#e33b35` / `#cc2f2a` | 122,3 / 137,8 | 39,8° / 40,1° |
  | Mittellinie Weg / Straße | `#cec4ae` / `#8b8b8b` | 138,2 / 146,6 | 0,7° / — |
  | Saum „Keine Wiki-Zuweisung“ | `#a01029` | 182,5 | 52,3° |
  | Mittellinie Reichsstraße | `#ffffff` | 227,3 | — |
  | Flussweg / Seeweg | `#4c89c6` / `#2f7dd3` | 231,1 / 263,0 | 168° / 170° |

  Zwei Stellen sind knapp. **„Anzeigen“ (38,4):** vorher waren beide Markierungen dieselbe Farbe, jetzt sind sie auf
  verschiedenen Wegen auseinanderzuhalten — liegt beides auf DEMSELBEN Weg, deckt die 12-px-Linie von „Anzeigen“
  (`routePane`) die Mittellinie ohnehin zu. **Wüstenpfad (88,3 bei 1,9°):** ein markierter Wüstenpfad unterscheidet
  sich von seinem eigenen Strich vor allem in der Helligkeit; das alte Gelb lag dort bei 105,7.
- 🔴 Dass die Auswahl dieselbe Farbe trägt wie ein angeklickter Ort, ist gewollt: „markiert“ heißt auf der Karte
  überall Gold.

### 9.2 Entfernen erreicht den Live-Abgleich (Befund 6, E14)

- **Befund.** `avesmapsWikiPathWeitereEntfernen` (`api/_internal/wiki/path-weitere.php`) löscht eine leer gewordene
  Liste per `unset`. Der Live-Abgleich anderer Editoren (`pollLiveMapUpdates`, `js/routing/routing.js`, nur im
  Bearbeiten-Modus) legt das Delta per Spread über den alten Stand:
  `path.properties = { ...path.properties, ...feature.properties, … }` (`applyPathFeatureResponse`,
  `js/map-features/map-features-path-lifecycle.js`). Ein fehlender Schlüssel überschreibt dort nichts — der zuletzt
  entfernte Artikel stünde bis zum Neuladen weiter am Abschnitt: „Auch Teil von“, gestrichelter Träger, Suche,
  „Weg als Route“.
- 🔴 **Regel: eine leer gewordene Liste bleibt als `[]` stehen.** `avesmapsWikiPathWeitereOhneHaupt` erbt das, weil es
  `…Entfernen` ruft. Die sofortige lokale Übernahme im Kartendialog (`pathWikiWeitereUebernehmen`,
  `js/review/review-paths.js`) setzt ebenfalls `[]` statt `delete` — der eigene und der fremde Browser halten
  denselben Stand.
- ⭐ **Warum nicht im Client:** den Spread für diesen einen Schlüssel „ersetzen statt mischen“ zu lassen, erreichte
  zwar jeden Schreiber — aber derselbe Merger trägt Antworten aller Schreibwege, und ein Schreibweg, dessen Antwort
  nicht alle Eigenschaften mitschickt, ließe die Liste dann fälschlich verschwinden. `[]` am Server ist die sichere
  Richtung: schlimmstenfalls steht ein leeres Feld mehr in `properties_json`.
- **Leser, die `[]` als „keine“ lesen müssen — geprüft am Stand 15.09.2026:**

  | Leser | warum `[]` dort „keine“ heißt |
  |---|---|
  | `avesmapsWikiPathWeitereLesen` | `is_array`, dann Schleife |
  | `avesmapsWikiPathWeitereOhneHaupt` | `array_key_exists` ist wahr, `…Lesen` liefert `[]`, der Hauptschlüssel steht nicht darin → unverändert zurück |
  | `avesmapsBuildSearchWeitereEntries` (`api/app/map-search.php`) | ⚠️ das Vorfilter `str_contains(properties_json, 'wiki_path_weitere')` trifft `[]` jetzt ebenfalls; danach dekodieren und eine leere Schleife — kein Treffer, nur ein Dekodieren mehr je solcher Zeile |
  | Verlauf-Abgleich (`api/_internal/wiki/path-verlauf.php`) | `foreach` über `is_array(…) ? … : []` |
  | Wege-Editor-Liste (`api/edit/map/paths-editor.php`) | über `avesmapsWikiPathWeitereLesen` |
  | `wpWeitereNamen`, `wpWegPasstZurSuche` (`js/pages/wege-editor-model.js`) | `Array.isArray`, dann `map`/`filter` |
  | `avesmapsWegTraegtWeiteren` (`js/map-features/weg-auswahl.js`) | `Array.isArray`, `some` |
  | `avesmapsWegAlsWay`, `avesmapsWegTraegerIndex`, `avesmapsWegWeitereZeilenMarkup` | `Array.isArray`, Schleife |
  | `avesmapsWikiWeitereZuordnungen` (`js/ui/wiki-weitere-kasten.js`) | `Array.isArray`, Schleife |
  | Suche (`js/ui/spotlight-search.js`) | `if (!weitere.length) return` |
  | Deeplink (`js/app/wiki-deeplink.js`, drei Stellen) | `Array.isArray(…) ? … : []`, dann `find`/`some` |
  | SQL | keine Abfrage filtert per `LIKE` auf den Schlüssel (gesucht über `api/`, `tools/`, `js/`); das einzige Textfilter ist das `str_contains` oben |

- ⚠️ **Bewusst offen: „Rückgängig“.** `avesmapsUndoAuditChange` (`api/_internal/map/features.php`) schreibt den
  Vorher-Schnappschuss zurück. Nimmt ein Undo die ERSTE weitere Zuweisung eines Abschnitts zurück, fehlt der Schlüssel
  im Schnappschuss — derselbe Spread-Fall, bei fremden Editoren bis zum Neuladen. Die Behebung gehört zur
  Merger-Frage oben, nicht in diesen Nachtrag.

### 9.3 „Ganze Straße“ nennt Enden nur, wenn beide Orte sind (Befund 7, E15) — Auslegung von §4

- §4 wörtlich: „**Ganze Straße:** die beiden äußeren Enden der längsten Kette (`wpChainSegments`); fehlt dort ein
  Ortsname, steht nur ‚Ganze Straße‘.“
- 🔴 **Festgelegt: „fehlt dort EIN Ortsname“ heißt: ist auch nur eines der beiden äußeren Enden kein Ort** („Kreuzung“
  oder „Wegende“), steht nur „Ganze Straße“. „Ganze Straße: Perz – Helmdahl“ nur, wenn BEIDE Enden Orte sind.
  Begründung: (1) der Wortlaut sagt „ein“, nicht „beide“; (2) die Zeile soll sagen, von wo bis wo die Straße geht
  (E5) — „Perz – Kreuzung“ über vierzig Abschnitte liest sich wie eine vollständige Angabe und ist keine; (3) am
  Abschnitt bleiben „Kreuzung“ und „Wegende“ erlaubt, weil ein Abschnitt dort wirklich endet.
- 🔴 **Eine Regel, alle Leser:** sie steht in `wpGanzeStrecke` (`js/pages/wege-editor-model.js`) und gilt damit
  zugleich für die Markierungszeile der Infobox, die Zeile oben im Dialog „Weg bearbeiten“, „ganze Straße · …“ im
  Kasten der weiteren Zuweisungen und den Gruppenkopf der Wege-Editor-Liste („N Abschnitte · Perz – Helmdahl · …“).
- ⚠️ Erkannt wird an den Wörtern „Kreuzung“ und „Wegende“ — dieselben Zeichenketten wie
  `AVESMAPS_WEG_ENDE_KREUZUNG`/`…_OFFEN` im JS/PHP-Zwilling. Das Modell läuft im Editorfenster ohne
  `js/map-features/weg-abschnitte.js`, trägt deshalb eigene Konstanten, und ein Test hält sie gegen beide Zwillinge.
  Ein Ort, der wörtlich „Kreuzung“ oder „Wegende“ hieße, würde wie ein Nicht-Ort behandelt — nicht gemessen.

### 9.4 Namensklick im Bearbeiten-Modus (E10)

- 🔴 Ein Klick auf die Schrift eines **Wiki-Wegs** (Kanal A des Wegnamen-Overlays) wirkt wie ein Klick auf die Linie:
  derselbe Linien-Zuhörer aus `createPathLayer` läuft — Wiki-Ziel-Pick, Klick-Schiedsrichter,
  `avesmapsWegAuswahlKlick`, Infopanel. ⭐ **Kein zweiter Code-Pfad:** das Karten-Klick-Ereignis wird als `click` an der
  Mittellinie des getroffenen Abschnitts ausgelöst (`path._pathLines[1].fire("click", …)`).
- **Welcher Abschnitt:** der Abschnitt der Gruppe `wiki:<wiki_key>` des getroffenen Namens, der dem Klickpunkt am
  nächsten liegt — Abstand Punkt zu Polylinie in Karteneinheiten, reine Funktion `avesmapsWegNaechsterAbschnitt`
  (`js/map-features/weg-auswahl.js`), bei Gleichstand der erste in der Nummernfolge. Das Register der Namen trägt
  keine `public_id` und wird dafür nicht erweitert.
- 🔴 Der Klick-Schiedsrichter des Overlays (`map.on("click")` in
  `js/map-features/map-features-path-label-canvas-overlay.js`) bleibt im Bearbeiten-Modus stumm: **Kurvenlabels bleiben
  dort nicht klickbar**, Besucher klicken wie bisher. Das Overlay liefert nur noch den Registertreffer nach außen
  (`window.avesmapsWegNamenTreffer`); welche Regel gilt, entscheidet die Wege-Auswahl.
- 💣 **EIN Zuhörer für beides.** Derselbe Karten-Klick hob bisher die Auswahl auf (`avesmapsWegAuswahlAufheben`,
  verdrahtet in `js/routing/routing.js`). Zwei getrennte Zuhörer hingen an ihrer Registrierungsreihenfolge: erst
  markieren, dann aufheben — die Markierung verschwände im selben Klick; erst aufheben, dann markieren — der zweite
  Klick fiele immer wieder auf „ganze Straße“. `avesmapsWegKartenKlick` entscheidet deshalb in einem Zuge:
  Namenstreffer → Linien-Klick auslösen; sonst → aufheben. Die Reihenfolge anderer Karten-Zuhörer spielt dafür keine
  Rolle.
- 🔴 **Riegel — kein Namensklick, solange:** ein Werkzeug läuft (`window.avesmapsKeyboardShortcuts.toolActive()`:
  dieselbe `TOOL_CLASSES`-Liste samt Anklick-Modi der Panes, jetzt nach außen gegeben — keine zweite Liste) · der
  Wiki-Ziel-Pick läuft (`window.__pathAssignPending`) · der Verlauf-Editor eines Wegs läuft (`activePathGeometryEdit`)
  · das Kontextmenü offen ist (`#map-context-menu` ohne `hidden`) · die CSS-Zoom-Animation läuft oder `?waylabels=0`
  gesetzt ist (Register veraltet bzw. leer).
  ⚠️ Fehlt `js/app/keyboard-shortcuts.js`, fällt der Riegel **geschlossen** aus: ein stummer Name ist der alte
  Zustand, ein Namensklick mitten in einem Werkzeug wäre ein neuer Fehler.
- 🔴 **Hand-Zeiger:** im Bearbeiten-Modus zeigt der Name eines Wiki-Wegs den Hand-Zeiger (Kurvenlabels nicht), nie
  während eines Werkzeugs. 💣 Ein stehengebliebener Inline-`cursor: pointer` schlüge die Klasse des Werkzeugs
  (`path-creation-cursor`, `leaflet-crosshair`) — er wird beim Werkzeugstart zurückgenommen. Begründung steht im Overlay
  selbst: ein anklickbarer Name, der aussieht wie unbeweglicher Text, ist eine halbe Reparatur.
- ⚠️ **Einschränkungen (bewusst):** nur Namen von Wiki-Wegen sind klickbar (nur sie stehen im Register) · trifft der
  Klick zugleich eine interaktive Fläche (Region, Landschaft im Bearbeiten), gewinnt die Fläche, weil ihr Zuhörer den
  Karten-Klick stoppt · ein Doppelklick auf den Namen sind zwei Klicks (ganze Straße → Abschnitt), kein „Verlauf
  bearbeiten“ — das bleibt der Linie.

### 9.5 Ein Kasten „Wiki-Weg“ (E9) — ersetzt den Punkt „Wiki-Kasten“ in §3.5

- 🔴 **Die Einhängestelle.** Das geteilte Bauteil `js/ui/wiki-assign.js` bekommt die OPTIONALE Angabe `anhang` (ein
  DOM-Element des Wirts). Ist sie gesetzt, zeichnet das Bauteil in den Ruhezuständen („offen“, „zugewiesen“) einen
  leeren Platz `<div data-wa-anhang></div>` direkt über der Schreibzeile und hängt das Element nach jedem vollen
  Neuzeichnen dort ein. In „Suche“ und „Sync-Vorschau“ steht der Platz nicht — ein zweites Suchfeld unter einer
  Trefferliste läse sich wie ein Teil davon.
- 💣 **Für die sieben anderen Objektarten bleibt das Markup Zeichen für Zeichen gleich:** ohne `anhang` entsteht kein
  Platz. Festgenagelt per Golden-Master über alle acht Erklärungen × beide Hüllen × fünf Zustände, erzeugt VOR der
  Änderung. Der Platz trägt keine Klasse — eine neue Hüllenrolle bräuchte in beiden Hüllen einen Namen und eine Regel.
- 💣 **Die Zuhörer des Bauteils hängen am Behälter, und Ereignisse aus dem Anhang blubbern dorthin.** Jeder der fünf
  Zuhörer (`click`, `mousedown`, `input`, `change`, `keydown`) steigt aus, wenn das Ziel in `[data-wa-anhang]` liegt —
  geprüft über `closest`, nicht über `contains` (die Attrappen der bestehenden Tests antworten auf `contains` immer
  mit „ja“ und ließen damit jeden Klick verschwinden).
- ⚠️ **Fokus:** das Bauteil zeichnet nur bei eigenen Ereignissen neu (Laden, Moduswechsel, Zuweisen). Tippen im
  Suchfeld des Anhangs löst kein Neuzeichnen aus; das Element wird beim Umhängen nicht neu gebaut, seine Eingabe und
  seine Zuhörer überleben.
- 🔴 **Der Kasten „Weitere Wiki-Zuweisungen“ hat danach nur noch die eingebettete Form** (`js/ui/wiki-weitere-kasten.js`):
  keine eigene Überschrift, **keine Zeile „Hauptzuweisung“** — die zeigt das Bauteil darüber samt Sync-Feldliste —,
  dann die Zeilen der weiteren Zuweisungen mit ✕, „Weitere Wiki-Zuweisung für …“, Suchfeld, Hinweis „Eine weitere
  Zuweisung ändert den Wegnamen nie.“ Den Satz „Zuweisen und Entfernen wirken sofort“ sagt die Schreibzeile des
  Bauteils darunter EINMAL für den ganzen Kasten.
  - ⚠️ **Bewusste Abweichung vom Mockup** (Zeilen 218–223 und 285–290): dort steht die Hauptzuweisung als erste
    Tabellenzeile. Hier steht sie als Feldliste darüber — dieselbe Aussage, ohne das Bauteil für eine Objektart
    umzubauen.
  - ⚠️ **Abweichung vom freigegebenen Entwurf „eingebetteter Modus“:** es gibt keinen zweiten, alleinstehenden Modus
    mehr, weil nach Lieferung C keine Stelle ihn nutzt — eine unbenutzte zweite Form läuft beim nächsten Feld
    auseinander. Mit ihr fallen `opts.haupt`, `hauptWo`, die eigene Überschrift und der zweite Selektor
    `.wiki-weitere-kasten > .dt-grp:first-child` in `css/components/editor-page.css`. Die Trennlinie zur
    Hauptzuweisung trägt `.wiki-weitere-kasten` selbst (`--color-divider`, dieselbe Linie wie zwischen den
    Tabellenzeilen des Mockups).
  - 🔴 **Die weiteren Zuweisungen stehen auch OHNE Hauptzuweisung da** (mit ✕). §2.2 Nr. 5 lässt sie stehen, wenn die
    Hauptzuweisung geht — bisher verschwanden sie dann aus dem Kasten und waren nicht mehr zu entfernen. Das Suchfeld
    bleibt ohne Hauptzuweisung weg (§2.2 Nr. 1).
- **Montagestellen:**
  - Wege-Editor, Abschnitt: `#wpWikiAssign` trägt den Anhang; `#wpWikiWeitere` entfällt.
  - Wege-Editor, Weg-Ebene: NEU `#wpGroupWikiAssign` an der Stelle von `#wpGroupWikiWeitere` (nach den
    Transportmitteln, vor den Quellen), mit Anhang.
  - Kartendialog „Weg bearbeiten“: `#path-wiki-assign-host` trägt den Anhang; `#path-wiki-weitere-host` (samt
    `label-edit-section`) entfällt aus `index.html`. 🔴 **Alle drei Befüller** (`populatePathEditForm`,
    `populatePathEditFormGruppe`, `populatePathEditFormFromLastSettings`) montieren weiter — in EIN Anhang-Element, das
    für die Lebenszeit der Seite dasselbe bleibt.
- 🔴 **Weg-Ebene und Gruppendialog: Zuweisen und Entfernen gelten der ganzen Straße** (§9.6). Die Rückfrage „nur dieser
  Abschnitt oder der ganze Weg“ entfällt dort; stattdessen EINE Bestätigung, die die Folge beim Namen nennt („… die
  Straße zerfällt in einzelne Wege“). Die Owner-Regel vom 05.07.2026 („Entfernen darf nie ungefragt den ganzen Weg
  abräumen“) bleibt damit erfüllt. 💣 Ungespeicherte Eingaben der Weg-Ebene gehen beim Neuwählen der Gruppe verloren —
  das wird vorher gefragt, nicht still getan.
- 🔴 **Sync auf der Weg-Ebene** füllt den Entwurf („— gemischt lassen —“ → Wegtyp aus dem Wiki) und merkt sich die
  Übernahme; das Sammel-Speichern schickt `wiki_uebernommen` mit. Der Server liest es dort seit jeher
  (`avesmapsFieldOriginsAusWikiLesen` in `avesmapsUpdatePathGroupDetails`), `wpGroupRumpf` hat es nie geschickt —
  auch der Gruppendialog der Karte nicht. Beide schicken es jetzt; ohne das stempelte der Server die Übernahme als
  „von uns“ (AGENTS.md §11, Wiki-Override).

### 9.6 Die Weg-Ebene schreibt auf genau ihre Abschnitte (`public_ids`)

- **Befund.** `assign_to` ohne `single_segment` trifft alle aktiven Wege mit demselben Namens-Match-Key wie das Ziel
  (`avesmapsWikiPathAssignTo`, `api/_internal/wiki/paths.php`) — auch gleichnamige FREMDE Wege. `clear_assign` wählt
  Namens-Key ∪ `wiki_key`. „Ganze Straße“ ist aber die Gruppe des Wege-Editors (E4), nicht die Namens-Menge des Servers.
- 🔴 **`assign_to` und `clear_assign` nehmen optional `public_ids`.** Gesetzt, sind die Ziele GENAU diese aktiven Wege;
  der Anker `public_id` muss darunter sein; Normalisierung und Deckel wie `avesmapsWikiPathWeitereIds` (Liste,
  getrimmt, ohne Dubletten, nicht leer, höchstens 250 = `AVESMAPS_PATH_GROUP_MAX_SEGMENTS`). Nicht gesetzt: Verhalten
  unverändert. Der Endpunkt liest die Angabe über EINE Funktion (`avesmapsWikiPathGruppenIdsAusRumpf`) für beide
  Aktionen.
- 🔴 Der Client schickt die Kennungen, der Server bildet die Gruppe nicht nach — dieselbe Regel wie bei
  `update_path_group_details` und `add_weitere`.
- 💣 `single_segment` und `public_ids` schließen sich aus: beides zugleich wird abgelehnt (400), statt eines still zu
  überhören.
- 💣 **Typriegel:** mit `public_ids` wird JEDER Zielweg geprüft (Fluss ↔ Straße/Weg), nicht nur der Anker; passt einer
  nicht, wird nichts geschrieben (`type_ok: false`). Ohne `public_ids` bleibt es bei der Ankerprüfung.
- Der Riegel `avesmapsWikiPathWeitereOhneHaupt` gilt in beiden Zweigen unverändert.
- ⚠️ **Folgen nach dem Schreiben:** Zuweisen benennt alle Abschnitte nach R1 um, der Gruppenschlüssel wird
  `wiki:<key>` — der Wege-Editor wählt danach diese Gruppe neu. Entfernen gibt JEDEM Abschnitt einen eigenen
  generischen Namen (R2) — die Straße zerfällt; der Wege-Editor wählt danach den Ankerabschnitt. 💣 Der Gruppendialog
  der Karte rechnet seinen Vergleichsstand neu: sonst stünde nach „Entfernen“ der alte gemeinsame Name als Stand da,
  und das nächste „Speichern für N Abschnitte“ schriebe einen Namen auf alle, die gerade eigene bekommen haben.
  Danach stößt er den Live-Abgleich an, weil Gruppen und Träger-Index an der Kartenrevision hängen.
- Der Verlauf-Abgleich (`api/_internal/wiki/path-verlauf-faelle.php`) ruft `assign_to` positionsweise mit
  `single_segment` — der neue Parameter steht hinten und bleibt dort ungenutzt.

### 9.7 Korrekturen an früheren Abschnitten

- **§2.3:** „Fähigkeit `edit`“ → **`review`** (E12). `api/edit/wiki/paths.php` ruft
  `avesmapsRequireUserWithCapability('review')` für alle Aktionen, `add_weitere` und `remove_weitere` eingeschlossen.
- **§3.3:** Farbe `SPOTLIGHT_PATH_HIGHLIGHT_STYLE.color` → `--color-marker-active` (§9.1). Das Mockup trägt seither
  `--proto-markierung: var(--color-marker-active)`.
- **§3.5, „Wiki-Kasten“:** ein Kasten mit Einhängestelle, ohne Hauptzeile in der Liste (§9.5).
- **§4, „Ganze Straße“:** Auslegung in §9.3.
- **§8:** bleibt (E13).

### 9.8 Auslieferung

Drei Teile, **einzeln live**, der Owner sieht jeden (AGENTS.md §9):

1. **A „Markierung“** — `[]` statt `unset`, Auswahl in Gold, „Ganze Straße“ nur mit Orten.
2. **B „Namensklick“** — nächster Abschnitt, Werkzeug-Riegel, Namensklick samt Hand-Zeiger.
3. **C „Ein Kasten Wiki-Weg“** — Server `public_ids`, Einhängestelle, eingebetteter Weitere-Kasten, Wege-Editor
   (Abschnitt und Weg-Ebene), Kartendialog (alle drei Befüller und Gruppendialog).

Danach AGENTS.md §11 nachziehen.

### 9.9 Offene Punkte

- „Rückgängig“ und die leere Liste (§9.2 ⚠️).
- „Anzeigen“ und Auswahl liegen farblich nah (38,4) — auf verschiedenen Wegen zu trennen, auf demselben nicht nötig.
- Ein Ort namens „Kreuzung“ oder „Wegende“ (§9.3 ⚠️).
- **Keine offene Entscheidung.** Die Stoppregel ist geprüft: die Einhängestelle geht opt-in ohne Markup-Änderung für die
  anderen Objektarten; `public_ids` ist ein hinterer optionaler Parameter, den kein bestehender Aufrufer setzt; der
  Namensklick weicht jedem Werkzeug über die vorhandene Klassenliste aus.
