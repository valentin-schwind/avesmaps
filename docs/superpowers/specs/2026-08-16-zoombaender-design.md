# Zoombänder — Entwurf

**Stand:** 16.08.2026 · **Owner-Entscheide:** Schriftgrößen UND Markergrößen UND die beiden
Erscheinungsstufen sind einstellbar · die Tabelle reicht bis z7 · das Fenster zeigt eine
Bandgrafik über der Zahlentabelle · Editoren sehen die Kachel und dürfen lesen, speichern darf
nur ein Admin.

## 1. Was heute passiert, und warum das eine Einstellung braucht

Wann eine Ortsklasse auf der Karte auftaucht, wie groß ihr Punkt ist und ab wann ihr Name
dazukommt, steht heute an **vier** Stellen fest im Code:

| Was | Wo |
|---|---|
| Erscheinungsstufe des Markers | `minZoomByType`, if-Kette in `js/map-features/map-features-location-marker-rendering.js:311` |
| Markergröße (Kurve) | `LOCATION_MARKER_RADIUS_SPEC`, `…-marker-rendering.js:60` |
| Erscheinungsstufe des Namens | `LOCATION_NAME_LABEL_CONFIG[*].minZoom`, `js/config.js:641` |
| Schriftgröße des Namens | `LOCATION_NAME_LABEL_SIZE_BY_ZOOM`, `js/map-features/map-features-location-name-labels.js:8` |

💣 **Die erste und die zweite Stelle tragen dieselbe Zahl.** `minZoomByType` sagt 0/0/0/1/2/3, und
`LOCATION_MARKER_RADIUS_SPEC[*].from` sagt 0/0/0/1/2/3. Laufen sie auseinander, erscheint ein
Marker mit einem Radius, der für seine Zoomstufe gar nicht gerechnet ist — ein gekoppelter Wert
in zwei Zeilen, den nichts zusammenhält. Dieser Umbau löst ihn auf (§3).

Dazu liegt totes Beiwerk herum, das beim Verstellen in die Irre führt: `locationZoomScale`,
`getVillageMarkerStyle`, `getBuildingMarkerStyle` und `isVillageMarkerStyleLocation`
(`…-marker-rendering.js:10–52`) werden **nirgends aufgerufen**; ebenso ungelesen sind
`radius`/`shape`/`borderWidth` in `LOCATION_TYPE_CONFIG` und `size` in
`LOCATION_NAME_LABEL_CONFIG`. Der Kommentar über dem Radius-Spec („jeder neu auftauchende Typ
startet bei 3 px") stimmt mit den heutigen Werten nicht mehr — es sind 1,33 px.

## 2. Die Kachel

Achte Kachel im Menüband des Ortseditors (`html/wiki-sync-settlement-editor.html`, `.controls`):

```
Zoombänder
Zoomlevelanzeige aller Orte
```

Weich/outline wie die übrigen Nebenkacheln — die Haupthandlung dieses Menübands heißt „Syncen".

⚠️ Das Menüband trägt danach **acht** Kacheln. Es ist ein Raster
(`grid-auto-columns:minmax(0,1fr)`), also keine `flex: 1 1 0`-Falle — aber die Beschriftungen
kürzen mit `text-overflow: ellipsis`, und bei acht Spalten ist auf schmalen Schirmen zu prüfen,
ob „Zoomlevelanzeige aller Orte" noch lesbar ankommt.

**Rechte:** die Kachel ist für `edit` sichtbar (Editoren dürfen die Bänder ansehen — sie erklären,
warum ein Ort beim Herauszoomen verschwindet). Speichern und Zurücksetzen darf nur `admin`. Der
Riegel steht **serverseitig im Endpunkt**, nicht nur am ausgegrauten Knopf.

## 3. Die Tabelle

Sechs Ortsklassen × acht Zoomstufen (z0–z7), **zwei** Zeilen je Klasse:

- **Marker** — Außendurchmesser in px. 🔴 Nicht der Kernradius: der Admin stellt ein, was er auf
  dem Schirm misst. Der Zeichner rechnet den Kern daraus zurück (Kern = Ø ÷ 2 ÷ 1,33), die weiße
  Kontur bleibt wie bisher 33 % des Kerns, mindestens 0,5 px.
- **Name** — Schriftgröße in pt (der Zeichner rechnet wie bisher × 4/3 in px).

### 3.1 Die erste gefüllte Zelle IST die Erscheinungsstufe

🔴 Eine leere Zelle heißt „hier gibt es das nicht". Damit gibt es die Untergrenze nicht mehr als
eigene Zahl — sie ist die **Form** der Tabelle. Die Doppelung aus §1 verschwindet baulich, nicht
durch Disziplin.

💣 **Löcher sind verboten.** Sobald eine Klasse erschienen ist, bleibt sie: ein Ort, der bei z3
sichtbar, bei z4 weg und bei z5 wieder da ist, sieht wie ein Fehler aus, egal wie er entstand.
Das Fenster lässt ein Loch gar nicht erst entstehen, und der Leser im Browser **füllt vorwärts** —
eine leere Zelle nach einer gefüllten erbt den letzten gefüllten Wert. Damit kann auch ein von
Hand verbogener Datenbankwert kein Loch erzeugen.

### 3.2 Die Vorgabewerte sind das heutige Bild, Ziffer für Ziffer

🔴 **Nichts ändert sich, bis ein Admin etwas ändert.** Die heutige geometrische Kurve wird
ausgerechnet und als Vorgabe eingetragen; z7 erbt z6, weil der Zeichner heute bei z6 klemmt.
Die Zahlen unten sind aus `LOCATION_MARKER_RADIUS_SPEC` bzw. `LOCATION_NAME_LABEL_SIZE_BY_ZOOM`
gerechnet und auf zwei Stellen gerundet — genau die Rundung, die `getLocationMarkerSize` heute
schon vornimmt.

**Marker, Außendurchmesser in px:**

| Klasse | z0 | z1 | z2 | z3 | z4 | z5 | z6 | z7 |
|---|---|---|---|---|---|---|---|---|
| metropole | 6,65 | 9,4 | 13,3 | 18,81 | 26,6 | 37,62 | 53,2 | 53,2 |
| grossstadt | 3,99 | 5,86 | 8,6 | 12,62 | 18,52 | 27,18 | 39,9 | 39,9 |
| stadt | 1,33 | 2,26 | 3,84 | 6,52 | 11,07 | 18,79 | 31,92 | 31,92 |
| kleinstadt | — | 1,33 | 2,39 | 4,29 | 7,7 | 13,82 | 24,82 | 24,82 |
| dorf | — | — | 1,33 | 2,54 | 4,86 | 9,28 | 17,74 | 17,74 |
| gebaeude | — | — | — | 1,33 | 2,8 | 5,9 | 12,42 | 12,42 |

**Name, Schriftgröße in pt:**

| Klasse | z0 | z1 | z2 | z3 | z4 | z5 | z6 | z7 |
|---|---|---|---|---|---|---|---|---|
| metropole | 8 | 9 | 11 | 13 | 17 | 19 | 19 | 19 |
| grossstadt | 8 | 8,5 | 10 | 12 | 15 | 17 | 17 | 17 |
| stadt | — | — | 9 | 11 | 13 | 15 | 15 | 15 |
| kleinstadt | — | — | — | 9,5 | 11 | 13 | 13 | 13 |
| dorf | — | — | — | — | 10 | 11 | 11 | 11 |
| gebaeude | — | — | — | — | 9 | 9 | 9 | 9 |

⚠️ Die leeren Zellen in der Namenstabelle sind **kein Verlust**. `LOCATION_NAME_LABEL_SIZE_BY_ZOOM`
führt dort heute Werte (Stadt z0/z1 = 8, Dorf z0–z3 = 8, …), die nie gelesen werden, weil
`shouldShowLocationNameLabel` vorher aussteigt. Sie verschwinden zusammen mit der Konstante, die
sie trug.

## 4. Wo die Wahrheit liegt

### 4.1 Vorgabe: im Browser, an genau einer Stelle

Neue Datei **`js/map-features/location-zoom-bands.js`** mit
`AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS` (die zwei Tabellen aus §3.2) und dem Leser, der Vorgabe
und Übersteuerung zusammenführt.

🔴 **Der Server kennt die Vorgabewerte NICHT.** Der Zeichner muss ohne Server auskommen — fällt der
Endpunkt aus, zeichnet die Karte wie heute. Läge dieselbe Tafel zusätzlich im Server (wie bei den
Tempowerten, wo der Rechner im Server sitzt und das richtig ist), gäbe es sie zweimal und sie
liefen auseinander.

Die Datei wird von **beiden** geladen: `index.html` (die Karte) und
`html/wiki-sync-settlement-editor.html` (das Fenster, das sie anzeigt und zurücksetzt). Damit
kennt auch das Fenster die Vorgabe, ohne sie vom Server zu erfragen.

⚠️ Ladereihenfolge in `index.html`: **vor** `js/map-features/map-features-location-marker-rendering.js`
und `…-location-name-labels.js`, denn diese lesen die Vorgabe beim Definieren ihrer Zeichner.

### 4.2 Übersteuerung: `app_setting`

Schlüssel **`location_zoom_bands`**, ein JSON-Wert von rund 1,5 kB. Dazu
`location_zoom_bands_stamp` (Unix-Zeit) für den ETag der öffentlichen Leseantwort.

```json
{
  "version": 1,
  "marker": {
    "metropole":  [6.65, 9.4, 13.3, 18.81, 26.6, 37.62, 53.2, 53.2],
    "kleinstadt": [null, 1.33, 2.39, 4.29, 7.7, 13.82, 24.82, 24.82]
  },
  "label": {
    "stadt": [null, null, 9, 11, 13, 15, 15, 15]
  }
}
```

💣 **`avesmapsAppSettingEnsureWideValue()` vor dem Schreiben, und RÜCKLESEN danach.**
`setting_value` war einmal `VARCHAR(255)`; der erste Schlüssel mit einem echten Wert wurde still
abgeschnitten, `json_decode` lieferte `NULL`, der Leser fiel auf seine Konstante zurück — und das
ist von „es wurde nie etwas gespeichert" nicht zu unterscheiden. Genau so hat der Speichern-Knopf
des Tempowerte-Fensters vom 14.08.2026 an nichts getan und nie geklagt. Ein Wert dieser Größe
gehört zu den Schreibern, für die `EnsureWideValue` gedacht ist (⚠️ und **nur** dort — die
`information_schema`-Sonde ist genau die Last, die AGENTS.md §10 aufführt).

### 4.3 „Auf Vorgabe zurücksetzen" LÖSCHT die Zeile

🔴 Der Rücksetzer schreibt **nichts** hin, er entfernt `location_zoom_bands`. Ein Rücksetzer, der
eine Kopie der Vorgabe hinterlässt, veraltet beim nächsten Mal, wenn jemand die Vorgabe im Code
ändert — und niemand merkt es, weil in der Datenbank etwas steht.

### 4.4 Zusammenführung im Browser: Zelle für Zelle

`avesmapsResolveLocationZoomBands(gespeichert)` gibt die wirksame Tabelle zurück:

1. Unbekannte Klasse im Gespeicherten → **ignoriert** (der Browser führt die Liste, nicht der Server).
2. Fehlende Klasse → vollständig Vorgabe.
3. Zelle `null` → **unsichtbar** (eine Aussage, kein Rückfall).
4. Zelle fehlt, ist keine endliche Zahl oder liegt außerhalb der Schranken (Marker 0,5–200 px,
   Schrift 4–96 pt) → **Vorgabe dieser Zelle**.
5. Danach vorwärts füllen (§3.1).

💣 Punkt 3 gegen Punkt 4 ist der Kern: `null` heißt „weg", `undefined` heißt „unverändert". Wer
beide gleich behandelt, macht entweder das Ausblenden unmöglich oder löscht bei jedem
Formatwechsel die halbe Karte.

⚠️ Ein kaputter Datenbankwert darf **nie** eine leere Karte erzeugen. Ist der gespeicherte Wert
kein Objekt, gilt er als nicht vorhanden.

## 5. Der Weg zum Besucher

### 5.1 Warum ein eigener Endpunkt

**`GET api/app/zoom-bands.php`** — öffentlich, winzig, beim Seitenstart geholt.

Verworfen: **Mitreisen in `map-features.php`.** Die Nutzlast hängt am ETag; ein zusätzlicher
Stempel im Seed (wie `avesmapsClimateReadStamp`) wäre technisch billig, aber jede Änderung an
einer einzelnen Schriftgröße ließe **jeden** Besucher einmalig **21 MB** neu laden. Bei Werten, an
denen man herumdreht, ist das der falsche Handel.

Verworfen: **Anhängen an `session.php`.** Die Anfrage gibt es zwar schon und sie läuft früh, aber
sie liest heute ausdrücklich **nur das Cookie, keine Datenbank**, und antwortet `no-store`. Ein
DB-Zugriff dort träfe jeden Besucher ungecacht — das Gegenteil dessen, was diese Anfrage ist.

⚠️ Der Preis ist eine **zusätzliche Anfrage beim Start** — und der Start dieser Karte hat mit
fetch-Fan-out schon bezahlt. Sie ist vertretbar, weil sie wenige hundert Byte groß, ETag-gecacht
und parallel ist, und weil sie lange vor der Kartennutzlast landet: Marker werden erst nach
`map-features.php` gezeichnet. **Eine zweite Anfrage dieser Art rechtfertigt dieser Entwurf nicht
mit** — wer die nächste Einstellung baut, hängt sie hier an, statt einen dritten Endpunkt zu
öffnen.

### 5.2 Der öffentliche Leser

```
GET api/app/zoom-bands.php
→ 200 { "ok": true, "bands": {…}|null, "stamp": "1755300000" }
→ 304 (bei unverändertem ETag)
```

- ETag `W/"zb-<stamp>"`, `Cache-Control: no-cache, must-revalidate`.
- 💣 **Kein DDL auf diesem Pfad.** `avesmapsAppSettingGetManyWithoutDdl` für beide Schlüssel in
  EINER Abfrage. `avesmapsAppSettingGet` legt bei jedem Aufruf die Tabelle an — im Editor richtig,
  vor einer öffentlichen Leseanfrage genau der Hotspot aus AGENTS.md §10.
- Fällt **offen** aus: jeder Fehler ergibt `bands: null`, nie ein 500. Ein Ausfall dieser Anfrage
  darf die Karte nicht aufhalten.

Im Browser: der Leser hängt an derselben Stelle wie `AvesmapsSession.load()` (sofort losschicken,
nicht erst beim Kartenaufbau). Trifft die Antwort **nach** dem ersten Zeichnen ein und weicht sie
von der Vorgabe ab, laufen `syncLocationMarkerVisibility()` und der Label-Sync **einmal** nach.

### 5.3 Der Editor-Endpunkt

**`POST api/edit/map/zoom-bands.php`** — Vorbild in Form und Reihenfolge:
`api/edit/map/travel-values.php`.

| Aktion | Fähigkeit | Wirkung |
|---|---|---|
| `get` | `edit` | `{ ok, bands, stamp, can_save }` — `can_save` = `admin` |
| `save` | **`admin`** | prüfen → `EnsureWideValue` → `Set` → **rücklesen** → Stempel → Protokoll |
| `reset` | **`admin`** | Zeile löschen → Stempel → Protokoll |

💣 `avesmapsCreatePdo($config['database'] ?? [])` — **der Teilbaum, nicht die ganze
Konfiguration.** `$config` ist auch ein Array, PHP beschwert sich also nicht; drinnen ist dann
alles leer, die Funktion wirft, und der `catch (Throwable)` macht daraus ein generisches 500.
Genau so hat das Tempowerte-Fenster vom Tag seiner Veröffentlichung an nie geladen. Bewacht von
`api/_internal/__tests__/create-pdo-argument-test.php`.

**Prüfung im Server — Form und Schranken, KEINE Klassenliste.** Die sechs Klassenschlüssel stehen
im Server heute schon zweimal (`api/edit/map/features.php:7`, `api/app/report-location.php:66`);
eine dritte Abschrift wäre genau die Divergenz, die dieser Entwurf an anderer Stelle abbaut. Der
Server prüft deshalb nur:

- höchstens 8 kB Rohtext
- ein Objekt mit den Schlüsseln `marker` und `label` (und `version`)
- deren Werte Objekte, Schlüssel `[a-z_]{1,32}`
- deren Werte Listen von höchstens 8 Einträgen, jeder `null` oder eine endliche Zahl in den
  Schranken aus §4.4

Unbekannte Klassennamen werden gespeichert und vom Browser ignoriert (§4.4 Punkt 1). Das Fenster
baut seine Schlüssel aus der Vorgabedatei, also entstehen sie im Betrieb gar nicht erst.

⚠️ **`map_revision` wird NICHT gehoben.** Es ändert kein Kartenobjekt, und ein Sprung ließe jeden
Client die 21-MB-Nutzlast neu laden — dieselbe Begründung wie bei den Tempowerten. Der Leser hat
seinen eigenen Stempel.

Eine Protokollzeile je Vorgang (`zoom_bands_save` / `zoom_bands_reset`), `feature_id = NULL`, mit
dem Stand davor und danach.

## 6. Drei Kopplungen, die beim Bauen wehtun

💣 **Die Dorf-Zeile ist nicht nur die Dorf-Zeile.** `getLocationNameLabelSize("dorf")` ist die
Grundgröße der **Wegenamen** (`map-features-path-labels.js:131`: +1, Flussnamen +3) und der
**Kraftlinien-Namen** (`map-features-powerlines.js:159`: +7, mindestens 18). Wer Dörfer kleiner
stellt, schrumpft die Straßenbeschriftung mit. Das steht als Hinweis **an der Zeile im Fenster**,
nicht versteckt in der Doku.

💣 **Der Deckel bei z5 ist geteilt.** `getVisualZoomLevel` klemmt auf 5, und `path-labels.js:40`
rechnet ausdrücklich mit demselben Index („Gleicher Zoom-Index wie die Basis"). Die Ausdehnung der
Ortsschrift auf z7 muss `getLocationNameLabelSize` von `getVisualZoomLevel` lösen (eigene Klemmung
auf 0–7), **ohne** die Wegenamen zu verschieben — die behalten ihren 0–5-Index, bis jemand
ausdrücklich etwas anderes entscheidet. ⚠️ Das ist die Stelle, an der ein unbedachter Handgriff
jede Straßenbeschriftung der Karte ändert.

⚠️ **Der Kollisionslöser liest die Erscheinungsstufe mit.** `map-features-label-collisions.js:279`
zieht `LOCATION_NAME_LABEL_CONFIG[…].minZoom` als zweites Sortierkriterium heran. Er muss die
**eingestellte** Stufe lesen, nicht die abgeschaffte Konstante — sonst weicht die Ausdünnung bei
verstellten Bändern der falschen Klasse aus.

⚠️ **Der Canvas-Marker-Versuch zieht mit.** `map-features-location-canvas-layer.js:141` ruft
`getLocationMarkerSize`/`getLocationMarkerCoreRadius` — er erbt die Einstellung von selbst, solange
niemand dort eine zweite Rechnung einbaut. (Er hängt an `?canvasmarkers=1` und ist im Frontend aus.)

## 7. Das Fenster

Überlagerung in `html/wiki-sync-settlement-editor.html`, Bauform wie das Tempowerte-Fenster in
`html/wege-editor.html`.

**Oben die Bandgrafik.** Acht Spalten z0–z7, je Ortsklasse eine Zeile. Der Balken beginnt dort, wo
der Marker erscheint, und wechselt dort in einen helleren Abschnitt, wo der Name dazukommt — die
Zoombänder im Wortsinn. Im Balken der **echte** Punkt (Durchmesser der Zelle) und ein Musterwort
im **echten** Schriftgrad, damit man sieht, was man einstellt.

**Darunter die zwei Tabellen** aus §3, je Zelle ein Zahlenfeld; leeren = unsichtbar (nur vor der
ersten gefüllten Zelle möglich, §3.1).

**Eine Änderung zeichnet die Grafik sofort neu; gespeichert ist erst, was der Knopf speichert.**
Eine Speicherleiste (ein gefüllter Knopf, die Meldung links daneben), Rücksetzer je Klasse und
einer für alles — weich/outline, denn eine Zeilenhandlung ist nie die Haupthandlung der Seite.

Für Editoren ohne `admin`: die Felder sind lesbar und gesperrt, die Speicherleiste trägt statt des
Knopfes den Satz, dass das Einstellen Admins vorbehalten ist.

⭐ **Mockup vor dem Bau:** `docs/zoombaender-mockup.html`, wie bei Tempowerten und WikiSync-Listen.

⚠️ **Nichts von Hand versionieren.** `ASSET_VERSION` gehört dem Territorien-Editor, nicht dieser
Seite. Der Öffner lädt das Iframe ohnehin mit `?v=" + Date.now()`
(`review-settlement-list.js:793`), die Seite selbst kommt also immer frisch; ihre verlinkten
Dateien stempelt der Deploy, weil sie unter `html/*.html` liegt (AGENTS.md §7).

## 8. Prüfung

**Ablauf, nicht Maß** (AGENTS.md §9): Kachel anklicken · eine Zahl ändern · Grafik zieht nach ·
speichern · Karte neu laden · **die Ortsklasse erscheint an der neuen Stufe** · zurücksetzen ·
altes Bild ist zurück. Diese sechs Handgriffe werden ausgeführt und benannt, bevor „fertig" fällt.

Tests:

| Datei | Zusichert |
|---|---|
| `js/map-features/__tests__/zoombaender-vorgabe.test.js` | Die Vorgabewerte reproduzieren das heutige Bild — Zelle für Zelle gegen die alte Kurve gerechnet. **Der Abnahmefall.** |
| `js/map-features/__tests__/zoombaender-zusammenfuehrung.test.js` | `null` ≠ fehlend (§4.4) · Schranken · unbekannte Klasse ignoriert · kein Loch nach dem Vorwärtsfüllen · kaputter Wert ⇒ reine Vorgabe |
| `js/map-features/__tests__/zoombaender-erscheinungsstufe.test.js` | Erste gefüllte Zelle steuert Marker **und** Name; die Sonderfälle aus §9 hebeln sie weiter aus |
| `api/edit/map/__tests__/zoom-bands-test.php` | Admin-Riegel für `save`/`reset` · Formprüfung · Rücklesen meldet einen unvollständigen Schreibvorgang · `reset` löscht die Zeile |

## 9. Was nicht dazugehört

Die Sonderfälle in `shouldShowLocationMarker` bleiben unangetastet und hebeln die Zoomgrenzen
weiter aus: Prüfhaken (Unverbunden / Kreuzungen mit 2 Wegen), verborgene Orte, Kreuzungen,
Kraftlinien-Nodices, Hauptstädte der angezeigten Gebiete im Politisch-Modus, der
Siedlungseditor-Filter und der per Suche angepinnte Marker.

Ebenfalls nicht dabei: die Klassen-Schalter des Auge-Menüs (die bleiben eine Besucherentscheidung),
die Kollisionsauflösung selbst, die Territoriums-Zoombänder (eine andere Sache mit demselben Wort)
und die Wegenamen-Schrift (§6).

✅ **Doch dabei, Owner-Entscheid 16.08.2026:** das tote Beiwerk aus §1 fliegt im selben Zug raus —
`locationZoomScale`, `getVillageMarkerStyle`, `getBuildingMarkerStyle`,
`isVillageMarkerStyleLocation` sowie die ungelesenen Felder `radius`/`shape`/`borderWidth` in
`LOCATION_TYPE_CONFIG` und `size` in `LOCATION_NAME_LABEL_CONFIG`. ⚠️ Vor dem Löschen jeweils
`git grep` gegen den ganzen Baum, **nicht nur gegen `js/`**: die Editorseiten sind eigenständige
HTML-Dateien mit eigenem `<script>`, und eine Testdatei kann eine Konstante bereitstellen, ohne sie
zu benutzen.
