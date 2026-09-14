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
