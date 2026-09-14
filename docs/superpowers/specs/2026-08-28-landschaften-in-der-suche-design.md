# Landschaften in der Suche — Entwurf

**Stand:** 2026-09-14 · **Status:** entschieden und gebaut — §3: **B**, §4a: **nach Identität**, GO
(Owner, 14.09.2026). Gemessen und gebaut am Bestand vom 14.09.2026.
**Anlass:** Owner, wörtlich: „Ceälan die inselfläche wird nicht in der spotlightsuche gelistet.
die fläche hat kein label, sollte aber eigentlich in der suche auftauchen."
**Erste Fassung:** 2026-08-28. Was sich seitdem geändert hat, steht in §9.

---

## 1. Der Befund

Eine Landschaft (`ecosystem_region`) ist **nirgends** ein Suchobjekt.

- **Client:** `buildSpotlightSearchEntries` (`js/ui/spotlight-search.js`) baut aus
  `locationMarkers`, `labelMarkers`, `regionPolygons` (Herrschaftsgebiete), Wegen und
  Kraftlinien. Keine Landschaft.
- **Server:** `api/app/map-search.php` führt seine Quellen — Siedlung, Label, Herrschaftsgebiet,
  Kraftlinie, Weg, Innerorts, Karte, Literatur, Vorkommen, „nicht auf der Karte". Das Wort
  `ecosystem` kommt in der Datei **nicht vor**.

Gefunden wird eine Landschaft deshalb ausschließlich über **ihre Beschriftung**. Ceälan hat
keine — der eine Treffer, der kommt, ist das gleichnamige Vulkan-*Label*, ein anderes Objekt
an einer anderen Stelle.

🪤 **Und eine Kleinigkeit, die täuscht:** `ecosystem_region.label_public_id` ist bei Ceälan
**nicht leer** — es zeigt auf ein Label, das im Kartenbestand nicht mehr existiert. Live sind es
weiterhin **3** Regionen: Almada, Weiden (beide derographisch, beide tragen trotzdem eine
Beschriftung über den Zeiger der Beschriftung selbst) und Ceälan. Eigener Aufräumpunkt, §8.

---

## 2. Was gemessen wurde (live, 14.09.2026)

Gemessen mit je **einer** Anfrage an `GET /api/app/ecosystem-areas.php` und
`GET /api/app/map-features.php`. Die Zahlen vom 28.08. (1308 Regionen, 20 Treffer) sind überholt —
der Bestand hat sich seither um die Hälfte vergrößert.

| | Anzahl |
|---|---|
| Landschaftsregionen mit mindestens einer Fläche | **1980** (1981 Flächen) |
| davon ohne jede Beschriftung | 1110 |
| davon Auto-Name nach der Browser-Regel (`<Art>-<Zahl>`) | 1112 |
| davon **zusätzlich** `Fläche-048`-artig, obwohl sie inzwischen eine Art haben | **12** |
| echt benannt und ohne jede Beschriftung | 89 |
| **davon ohne Klimazonen, Name auf keiner EIGENEN Beschriftung** | **81 Regionen** |
| … abzüglich der 3 `Fläche-0xx` (Urwald) aus der vierten Zeile | **78 Regionen → 73 Treffer** |

Die 78 Regionen werden zu **73 Treffern**, weil Regionen gleichen Namens, gleicher Ebene und
gleicher Art EIN Treffer sind (§6): „Archipel der Perlen" ist 5 Regionen, „Gorische Wüste" 2 (mit
identischer Hüllbox — eine Dublette im Bestand, §8). „Große Öde" bleibt zwei Treffer, weil es sie
einmal als Tiefebene (Topographie) und einmal als Steppe (Vegetation) gibt.

Beispiele: Tannwald · Mistelwald · Reiherforst · Schwefeltal · Wirrniswald · Königstann ·
Seneb-See · Archipel der Perlen · Oase Keft · Terra Ferma · Mittelaventurien · **Ceälan** ·
Finsterkamm (Derographie) · Nebelmoor (Derographie). 44 der 81 Regionen tragen einen Wiki-Artikel.

🔴 **Keine einzige** echt benannte Region trägt eine Beschriftung mit ANDEREM Namen. „Name auf keiner
eigenen Beschriftung" und „gar keine Beschriftung" sind heute dieselbe Menge — die Regel in §4 fragt
trotzdem nach der eigenen Beschriftung, weil das die Aussage ist, die gemeint ist.

---

## 3. ✅ ENTSCHIEDEN: B (Owner, 14.09.2026)

**Jede echt benannte Landschaft kommt in die Suche** — nicht nur die mit Wiki-Artikel (A), und
**nicht** die acht Klimazonen (C). Ein Treffer fliegt zur Fläche.

| | Menge (14.09.) | |
|---|---|---|
| A — nur mit Wiki-Artikel | 44 Regionen | verworfen |
| **B — jede echt benannte Landschaft** | **78 Regionen / 73 Treffer** | **gewählt** |
| C — B plus die Klimabänder | + 8 | verworfen |

---

## 4. Wo es gebaut wird

🔴 **Serverseitig in `api/app/map-search.php`** — nicht im Client. Der Grund ist unverändert:
Landschaftsflächen reisen **nicht** in der Kartennutzlast, sie liegen hinter
`api/app/ecosystem-areas.php` und werden nur in der Landschaften-Ansicht geladen, Ausschnitt für
Ausschnitt. Ein Client-Bauer fände sie je nach Ansicht mal und mal nicht.

- Reiner Kern in einer eigenen Datei **`api/_internal/app/landscape-search.php`** (Vorbild
  `offmap-search.php`): Riegel, Eintragsbauer und Gruppierung ohne Datenbank prüfbar, dazu EIN Leser.
- **EINE Abfrage:** `ecosystem_region` ⋈ `ecosystem_area` mit `MIN/MAX` der bbox-Spalten je Region,
  `is_active` auf beiden Seiten, `kind <> 'klima'`, gruppiert je Region; dazu die ~30 Zeilen von
  `ecosystem_region_type`. Keine Geometrie wird gelesen. Eigenes `try/catch` — fehlt die Tabelle,
  fällt nur diese Quelle aus.
- 💣 **Welche Beschriftung zu welcher Region gehört, kommt aus dem EINEN Leser beider Richtungen**
  (`avesmapsEcosystemLabelRegionMap`, `ecosystem-label-link.php`) — gefüttert aus den
  `map_features`-Zeilen, die der Endpunkt **ohnehin schon geladen hat**. Keine zweite Abfrage auf
  `map_features`, kein zweites Regelwerk für die 1:N-Bindung. Der Tote-Zeiger-Schutz ist damit
  geschenkt: ein Zeiger auf eine gelöschte Beschriftung zählt nicht (Ceälan).
- ⚠️ **Kein DDL** im Suchpfad — die Datei lädt `ecosystem.php` NICHT (dessen Ensure ist die Last aus
  §10), sondern nur `ecosystem-label-link.php` (reine Funktionen plus ein Leser).

### 4a. ✅ Entschieden (Owner 14.09.2026): Doppelt-Filter nach IDENTITÄT, nicht nach NAMEN

Die Messung vom 14.09. (56 Regionen) hat zusätzlich alle Regionen herausgenommen, **deren Name
irgendwo als Beschriftung existiert**. Der Entwurf vom 28.08. (§7) nahm nur heraus, was auf
**einer ihrer eigenen** Beschriftungen steht. Am Bestand sind das **23 Regionen** Unterschied, in
zwei Sorten:

- **Das Label gehört einer anderen Ebene** (9): Finsterkamm, Nebelmoor, Obergorien, Fenn, Ebene von
  Hardorp, Ebene der 1000 Pferde, Honinger Land, Gorische Wüste ×2 — z. B. derographischer
  „Finsterkamm" ohne Label, das Label hängt am topographischen.
- **Ein FREIES Label gleichen Namens** (13): Blentforst, Bodarowald, Ogerwald, Silberbuchenwald,
  Wutzenwald, … — und **Ceälan**, dessen gleichnamiges Label ein *Vulkan* an anderer Stelle ist.
  (Dazu Falkenforst: das Label hängt an einer zweiten Vegetationsregion desselben Namens.)

⭐ **Empfehlung: nach IDENTITÄT** (78 Regionen / 73 Treffer). Ein Name ist kein Schlüssel — und die
Namensregel schlösse **ausgerechnet Ceälan** aus, den Fall, der diesen Entwurf ausgelöst hat.
Der Preis: bei rund 20 Namen stehen zwei Zeilen gleichen Namens in der Liste. Sie sind
unterscheidbar, weil die Landschaftszeile ihre Ebene trägt (§6: „Blentforst · Wald · Vegetation"
neben dem Label „Blentforst · Wald"), und die freien Labels darunter sind ohnehin Kandidaten fürs
Binden an ihre Fläche.

---

## 5. 💣 Der Auto-Namen-Riegel

Der Server muss wissen, ob ein Name automatisch vergeben wurde. Der Merker ist **dreiwertig**:

| `properties_json.auto_name` | Bedeutung | wer liest es |
|---|---|---|
| `true` | ausdrücklich automatisch | `avesmapsEcosystemRegionAutoName` (PHP) |
| `false` | ausdrücklich von Hand | dieselbe Funktion |
| fehlt | nie entschieden → am Namen ablesen | `isEcosystemRegionAutoName` (JS, nur im Browser) |

🔴 **Nicht abschreiben — ableiten.** Die JS-Regel prüft „Name == `<Artbezeichnung>-<Ziffern>`" mit
dem Rückfall-Griff „Fläche" für eine Region ohne Art. Die Artbezeichnungen stehen dem Server in
`ecosystem_region_type.label` zur Verfügung — der Riegel ist eine Regel über **vorhandene Daten**,
keine importierte Wortliste.

💣 **Und die Suche fragt STRENGER als der Haken — mit Absicht.** Der Haken beantwortet „ist dieser
Name automatisch vergeben?", die Suche „würde ein Leser nach diesem Namen suchen?". Gemessen: 12
Regionen heißen `Fläche-019` … `Fläche-064`, haben aber inzwischen eine Art (See, Urwald). Die
Browser-Regel prüft nur gegen die AKTUELLE Art und hält sie für echte Namen — die Suche würde
„Fläche-048 · Urwald" anbieten. Deshalb gilt in der Suche:

```
verborgen  :=  auto_name === true
           ||  name ~ '^(' || <Rückfall-Griff „Fläche"> || '|' || <IRGENDEINE Artbezeichnung> || ')-[0-9]+$'
```

- **Irgendeine** Artbezeichnung, nicht nur die aktuelle: eine Region, die als „Wald-003" angelegt
  und später zu „Urwald" wurde, trägt ihren alten Griff weiter.
- **Der Name schlägt hier auch `auto_name === false`:** eine Region, deren Haken jemand abgenommen
  hat, die aber noch „Wald-001" heißt, hat noch keinen Namen, nach dem jemand sucht.
- ⚠️ **Die sichere Richtung ist „lieber verstecken":** ein fehlender Treffer ist ärgerlich,
  1112 Zeilen `Wald-001` machen die Suche unbenutzbar.

⚠️ **Ein Test hält beide Seiten gegeneinander** — über eine gemeinsame Fallliste
(`api/_internal/app/__tests__/fixtures/landschaft-autonamen.json`), die der PHP-Test gegen den
Riegel und der JS-Test gegen `isEcosystemRegionAutoName` fährt: **was der Browser für automatisch
hält, verbirgt der Server immer** (Server ⊇ Browser). Beide Tests prüfen außerdem den Rückfall-Griff
„Fläche" gegen die Konstante der jeweils anderen Seite.

🔧 **Bekannte Grenze:** eine Artbezeichnung, die im Typkatalog UMBENANNT wurde, verliert ihren alten
Griff. Heute ohne Fall; der Test würde es nicht sehen.

---

## 6. Was ein Treffer ist und was er tut

**Der Treffer ist ein KARTENOBJEKT, kein Abschnitt** (Abweichung von der ersten Fassung, §9). Die
vier Abschnitte (Kartensammlung, Literatur, Vorkommen, „Nicht auf der Karte") sind Dinge *neben* der
Karte, mit eigener Überschrift und eigenem Deckel von 5. Eine Landschaft liegt *auf* der Karte und
fliegt an — sie steht zwischen den übrigen Kartenobjekten, nach Punktestand, direkt hinter den
Beschriftungen (`avesmapsSearchKindOrder`: `landscape` nach `label`). Einen eigenen Deckel braucht sie
nicht: es gibt 73 davon.

**Die Zeile:** `Tannwald` · `Wald · Vegetation`. Art und Ebene, jedes Wort nur einmal und keines, das
schon im Namen steht — **dieselbe Regel, nach der das Infopanel einer Fläche seinen Untertitel baut**
(`ecosystemAreaInfoMarkup`). Sie wird dafür als reine Funktion herausgelöst und von beiden benutzt; eine
zweite Fassung wäre der Untertitel, der in der Liste anders heißt als im Panel. Das Kanon-Etikett folgt
wie bei Wegen über `spotlightEinigerKanonRef("ecosystem", …)`.

**Gruppierung:** Ebene + Art + normalisierter Name → EIN Treffer mit allen Regionskennungen und der
Hüllbox **aller** Flächen aller dieser Regionen (Archipel der Perlen: 5 Regionen, 5 Inseln, ein
Rahmen). Dieselbe Bauart wie die Wegegruppen im selben Endpunkt.

**Der Klick** (`focusSpotlightLandscape`):

1. **Ansicht Landschaften** (`setSelectedMapLayerMode("ecosystem")`). Steht die Karte in „Alle", ist
   jede der drei Ebenen sichtbar und es bleibt dabei; steht sie auf einer anderen einzelnen Ebene,
   wird auf die Ebene des Treffers gewechselt — sonst fliegt die Karte an eine Stelle, an der nichts
   zu sehen ist.
2. **Hinfliegen** auf die Hüllbox aus dem Treffer (`focusSpotlightBounds`) — sofort, ohne auf ein
   Netz zu warten; die bbox kommt vom Server.
3. **Infopanel sofort**: dasselbe Panel, das ein Klick auf die Fläche öffnet
   (`showEcosystemAreaInfopanel`). Es braucht nur Name, Art, Ebene und keinen Label-Zeiger — genau
   das, was der Treffer trägt.
4. **Umrisse nachladen** über den vorhandenen `?regions=`-Filter
   (`fetchSpotlightLandscapeAreasByRegion`) und in derselben Hervorhebung zeichnen, die die
   Vorkommen benutzen (`highlightSpotlightPlaces`, ohne Punkt-Rückfall). Hat der Nutzer inzwischen
   etwas anderes gewählt, wird nicht übermalt.

---

## 7. 💣 Weitere Fallen

- **Die Beschriftung bleibt ihr eigener Treffer.** Label und Region sind zwei Objekte; wer sie
  zusammenlegt, verliert die Stelle, an der die Beschriftung steht.
- **`label_public_id` allein ist keine Beschriftung** — drei Regionen zeigen ins Leere (§1). Deshalb
  kommt die Bindung aus `avesmapsEcosystemLabelRegionMap`, nie aus dem Zeiger allein.
- **Kein Namensvergleich mit Klammerzusätzen.** Die Frage lautet „heißt die Region so?".
- **`resolveBackendSpotlightEntries` verwirft STILL, was es nicht kennt.** Ein Server, der
  `kind: "landscape"` liefert, ohne dass der Client einen Bauer dafür hat, sähe im Endpunkt richtig
  aus und erschiene nie im Fenster. Deshalb fährt der Client-Test die Auflösung mit einem echten
  Serverergebnis, nicht nur den Bauer.
- **Der Klick braucht einen Zweig in `selectSpotlightSearchEntry`** — ohne ihn fällt er durch alle
  Fälle und tut nichts, bei einer Zeile, die vollkommen richtig aussieht (dieselbe Falle, die dort
  für „offmap" schon kommentiert ist).
- **Kein neuer Wert im Payload der Karte**, also kein Stempel zu heben. Die Suche hat kein ETag.

---

## 8. 🚩 Nebenbefunde

1. **`focusSpotlightLabel` öffnet das Infopanel nur mit Wiki-Zuweisung** (`labelHasWikiRegion`).
   Beide Kartenklick-Wege haben dieses Tor seit Spec §5.2 nicht mehr (`map-features-labels.js`, Lese-
   UND Bearbeiten-Zweig, jeweils ausdrücklich kommentiert). Am 14.09. nachgelesen: weiter so. Der
   Suchtreffer „Ceälan · Vulkan" fliegt hin und lässt das Panel auf dem vorigen Inhalt stehen.
   → **Eigener, kleiner Schritt nach diesem**, eigener Commit, eigener Blick.
2. **Drei tote Label-Zeiger** (Almada, Weiden, Ceälan). Datenpflege, kein Code — die Suche ist
   dagegen gebaut (§7).
3. **12 Regionen mit `Fläche-0xx`-Namen und inzwischen gesetzter Art** zeigen diesen Griff auch
   öffentlich (Tooltip/Infopanel, `ecosystemRegionDisplayName` prüft nur gegen die aktuelle Art).
   Die Suche ist dagegen gebaut (§5); die Anzeige nicht. Eigener Befund.
4. **Doppelte Regionen:** „Gorische Wüste" (Topographie, Gebirge) zweimal mit identischer Hüllbox;
   „Falkenforst" (Vegetation, Wald) zweimal, eine davon mit Beschriftung. Die Gruppierung (§6) macht
   aus der ersten Dublette EINEN Treffer; die zweite erscheint als Label + Landschaft.

---

## 9. Was sich gegenüber dem 28.08.2026 geändert hat

| | 28.08. | 14.09. |
|---|---|---|
| Entscheidung | offen, Empfehlung B | **B entschieden** |
| Menge | 20 Landschaften | **78 Regionen / 73 Treffer** |
| Auto-Namen-Riegel | nur gegen die aktuelle Art | gegen **jede** Art + „Fläche", Name schlägt `false` (12 `Fläche-0xx` gemessen) |
| Doppelt-Filter | eigene Beschriftung | eigene Beschriftung — gegen die Namensregel der Messung verteidigt (§4a) |
| Form | eigener Abschnitt, Deckel 5 | **Kartenobjekt** hinter den Beschriftungen, ohne Deckel |
| Mehrere Regionen gleichen Namens | nicht bedacht | EIN Treffer, Hüllbox aller Flächen |
| Ebene beim Klick | „Landschaften" | Landschaften + passende Einzelebene, „Alle" bleibt |
| Infopanel | „sollte" | sofort, aus dem Treffer, derselbe Bauer wie der Flächenklick |
| Zeile | offen | „Name · Art · Ebene", Untertitel-Regel des Panels geteilt |

---

## 10. Abnahme (Ablauf, nicht Maß)

Auf https://avesmaps.de als **Besucher** (kein `edit=1`), Konsole offen:

1. Suche „Tannwald" → Zeile „Tannwald · Wald · Vegetation" erscheint → anklicken → Ansicht springt auf
   Landschaften, Karte fliegt hin, der Wald ist gelb umrandet, Infopanel zeigt „Tannwald".
2. Suche „Archipel der Perlen" → EINE Zeile → anklicken → alle fünf Inseln im Rahmen und umrandet.
3. Suche „Ceälan" → zwei Zeilen: Vulkan (Label) und Insel (Landschaft) → die Insel anklicken.
4. Aus der Ansicht „Topographie" nach „Mistelwald" (Vegetation) suchen → Ebene wechselt.
5. Aus „Alle" nach „Mistelwald" suchen → bleibt „Alle".
6. Suche „Wald-001" → keine Landschaftszeile. Suche „Polare Zone" → keine Landschaftszeile.
7. Konsole ohne Fehler; Antwortzeit der Suche gegen die Basismessung vom 14.09. (1,67–1,82 s).

---

## 11. Nachtrag 14.09.2026: unsichtbare Beschriftungen im Frontend

**Anlass (Owner):** Auto-Namen wie „See-318", „Wald-028", „Fläche-026" standen in der Suche. **Die Editoren:**
im Editormodus sollen sie auffindbar bleiben.

**Gemessen** (14.09.2026, je eine Anfrage an `map-features.php` und `ecosystem-areas.php`): 100 Beschriftungen
mit Auto-Namen — **alle** `show_name: false` (auf der Karte längst unsichtbar), alle an ihrer Fläche, Text =
Regionsname, jede die einzige Beschriftung ihrer Fläche. Insgesamt gibt es 127 unsichtbare Beschriftungen: die
100 plus 27 echte Namen (Oase Tarfui, Tursolanisee, Der große Fluss, Südaventurien …), alle gebunden.

**Entschieden: Variante B, nur Beschriftungen.** Im **Frontend** ist eine unsichtbare Beschriftung einer
Landschaft kein eigener Treffer — die Landschaft vertritt sie. Die 100 Auto-Namen verschwinden ganz (ihre Region
verbirgt §5), die 27 echten Namen kommen als Landschaftstreffer (§6) und fliegen auf die Fläche statt auf einen
unsichtbaren Punkt. Im **Editormodus** bleibt alles wie vorher.

Verworfen wurde **A** (die Beschriftung erbt das Auto-Namen-Urteil ihrer Region): der Browser kennt
Regionsname, Haken und Artkatalog nicht, A hätte also ein neues Feld in der öffentlichen Kartennutzlast samt
Versionssprung gebraucht — und eine zweite Stelle, die Auto-Namen erkennt. Ein Datenlauf taugt nicht: ein
geleerter Text kommt beim nächsten Speichern der Fläche zurück, und „Auto-Name anhaken, speichern" löscht die
Beschriftung.

- 🔴 **„Unsichtbar" ist nur ein ausdrückliches `show_name === false`** — genau so liest die Karte das Feld.
- 💣 **Im Frontend zählt der Name einer unsichtbaren Beschriftung NICHT als eigene Beschriftung (§4a)** — sonst
  verlöre die Landschaft ihren Treffer gleich mit. `avesmapsLandscapeSearchLabelBindung` beantwortet beide Fragen
  in einem Durchgang und läuft nur, wenn eine Landschaft oder eine unsichtbare Beschriftung trifft.
- 💣 **Der Modus reist an JEDEM Aufrufer der Suche** als `edit_mode=1` (dieselbe Schreibweise wie die
  Kartennutzlast): Spotlight und die zwei Deeplinks (`spotlightKartensucheModusSetzen`), dazu die drei
  Ortsvorschlags-Abrufe der Editorseiten Kartensammlung und Literatur. Ohne Parameter gilt das Frontend.
- 🔴 **Der Modus hängt an der ANMELDUNG, nicht am Parameter:** der Endpunkt filtert die Anfrage zuerst durch
  `avesmapsEditModeNurFuerEditoren` — die Hausregel für jeden Leser von `edit_mode`, erzwungen von
  `api/_internal/__tests__/edit-mode-riegel-test.php`. Ein Besucher mit `?edit_mode=1` bekommt das Frontend;
  ohne `edit_mode` wird die Sitzung gar nicht angesehen.
- ⚠️ Ohne Landschaftstabellen bleibt jede Beschriftung ein Treffer. Kann die Landschaft selbst kein Treffer sein
  (Klimazone, keine aktive Fläche), ist ihre unsichtbare Beschriftung im Frontend nicht zu finden — die Suche
  folgt der Karte.
- ⭐ EINE Fallliste für Server und Browser: `api/_internal/app/__tests__/fixtures/unsichtbare-beschriftungen.json`.
- 🚩 **Nebenbefund, eigener Schritt:** die Ortsvorschläge der Editorseiten Kartensammlung und Literatur kennen
  `kind: "landscape"` nicht (`mapSearchKind` fällt auf den Namensweg zurück; im Literatur-Ortsfilter setzt ein
  Landschaftstreffer eine Regions-ID, zu der kein Ort passt).

**Abnahme:** als Besucher „See-318" → keine Zeile; „Oase Tarfui" → Landschaftszeile, keine Beschriftung; mit
`?edit=1` „See-318" → Beschriftung, „Oase Tarfui" → Beschriftung ohne Landschaft daneben.
