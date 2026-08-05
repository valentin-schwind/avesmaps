# Agent 8 — Schnelldurchlauf eines DSA-Fans durch avesmaps.de

## Kern

- **Auffallend gesund.** ~90 Minuten Bedienung, vier Routenberechnungen, alle sechs
  Ansichten, Fenster, Teilen — **kein einziger JS-Fehler**. Laden 1,3 s, 11 486 Features.
- **Die Reisezahlen stimmen bis auf die Nachkommastelle:** Etappensumme = Gesamtstrecke
  (998,06 / 998,1 Meilen), Rastzeit folgt „Stunden pro Tag" (8 h → 303,3 h Rast),
  Winterboden exakt +10 % (151,7 → 166,8 h), Ankunftsdatum passt, Kosten auf den Heller.
- **AKUT — der Sprachumschalter DE/EN lädt die Seite neu und wirft die fertige Route weg**,
  ohne Warnung und ohne Wiederherstellung (B1, reproduziert).
- **Die ↗-Regel (§12) ist teils gar nicht umgesetzt:** 15 von 15 externen Links im
  Hinweise-Fenster ohne Pfeil, 120 von 296 in der Ortsinfobox; derselbe Link-Bauer
  schreibt ihn in EINER Datei zweimal mit und zweimal ohne (B2).
- **Sechs Ansichten, fünf Tasten:** nur „Landschaften" hat keinen Tastenbefehl und fehlt in
  den Bedienhilfen (B3). Alle übrigen 20 Zeilen der Tabelle stimmen mit der Wirkung überein.
- **Als Fan gestolpert:** „Großer Fluss" findet den Fluss nicht (er heißt „Der Große Fluss",
  keine Deklination, B4); Klimazonen zeigen im Ausschnitt Farbe ohne jeden Namen (B6).

---

### B1 Der Sprachumschalter DE/EN lädt die Seite neu und verwirft die geplante Route ersatzlos
- **Kategorie:** AKUT
- **Fundstelle:** js/app/lang-toggle.js:48 (`window.location.reload()`), zusammen mit
  js/map-features/map-features-layer-state.js:375-387 (`syncPlannerStateToUrl` speichert
  ausserhalb des Editiermodus **nichts**)
- **Beobachtung:** Ein Klick auf „EN" (oder zurück auf „DE") lädt das Dokument neu. Weil der
  Planer-Zustand seit dem Owner-Entscheid 2026-07-06 weder in der Adresszeile noch im
  Speicher liegt, ist danach alles weg: Wegpunkte, Transportmittel, Reiseoptionen,
  Reisebeginn, der ganze Reiseplan. Es gibt keine Rückfrage und keinen Hinweis. Wer eine
  Reise über vier Stationen zusammengestellt hat und dann neugierig auf die englische
  Fassung klickt, fängt von vorn an.
- **Erwartet:** Entweder überlebt der Planer-Zustand den Neuladen (Kurzlink-Mechanik oder
  `sessionStorage`, beides existiert im Haus schon), oder der Umschalter fragt vorher nach
  („Die geplante Reise geht dabei verloren"). Ideal wäre eine Umschaltung ohne Neuladen —
  der Kopfkommentar der Datei nennt genau das als fehlend („There is no live re-render path").
- **Beleg:** Live reproduziert. Route Gareth→Ferdok gebaut, Zustand vorher per
  `JSON.stringify({felder:[...document.querySelectorAll('.waypoint-input')].map(i=>i.value),
  etappen:currentRoutePlanEntries.length})` → `{"felder":["Gareth","Ferdok"],"etappen":9}`.
  Danach `document.querySelector('.lang-toggle__opt[data-lang=en]').click()`, 10 s gewartet,
  dieselbe Messung → `{"navType":"reload","seitLadenMs":11168,"felder":[""],"etappen":0,
  "sprache":"en","url":"/"}`. Der Verlust trat im Lauf **zweimal unbeabsichtigt** ein, bevor
  ich ihn gezielt nachgestellt habe.
- **Sicherheit:** BELEGT
- **Aufwand:** klein (Rückfrage/Warnung) bis mittel (Zustand über den Reload retten)

### B2 Die ↗-Regel für externe Links (§12) ist nur an einem Teil der Oberfläche umgesetzt
- **Kategorie:** KANN
- **Fundstelle:** index.html:2157, 2220, 2229, 2262 (Hinweise-Fenster);
  js/map-features/map-features-lore.js:256 und :276 gegen :136 und :546;
  js/map-features/map-features-place-extras.js:705 gegen :755
- **Beobachtung:** AGENTS.md §12 sagt: „**external links** (off-site) always get a trailing
  `↗`". Gemessen im laufenden Betrieb:
  - **Hinweise-Fenster: 15 von 15 externen Links ohne Pfeil** (Discord, avespfade.de, Wiki
    Aventurica, DereGlobus, Orkenspalter, Ulisses-Fanrichtlinie, Leaflet, jQuery, jQuery UI,
    polygon-clipping, polylabel, DB-IP, GitHub …). Kein einziger hat ihn.
  - **Ortsinfobox Gareth: 120 von 296 externen Links ohne Pfeil.** Nach Klasse:
    `avesmaps-lore__name` 11 (die Waren-/Fauna-Zeile), `avesmaps-adv__title` 52
    (Abenteuertitel), Rest sind Cover-Bilder und Kartensammlungs-Kacheln.
  - Am aussagekräftigsten: **dieselbe Datei baut denselben Linktyp einmal mit und einmal
    ohne.** `map-features-lore.js` schreibt `name + " ↗"` in Zeile 136 (Listeneintrag) und
    546 (Dialog), aber blankes `name` in 256 und 276 (die kommagetrennte Infobox-Zeile) —
    ohne Kommentar, der die Auslassung begründen würde. `map-features-place-extras.js`
    kommentiert in Zeile 731 ausdrücklich „Every one of these is off-site, hence the ↗ (§12)"
    und lässt ihn 26 Zeilen weiter oben (:705, Abenteuertitel) weg.
- **Erwartet:** Entweder überall (dann ist §12 die Regel) oder die Ausnahme steht als Regel
  in §12 („in Fliesstext-Aufzählungen ohne Pfeil"). Heute weiß der Leser nicht, ob ein Link
  ihn von der Seite trägt.
- **Beleg:** Im Browser gezählt über
  `[...panel.querySelectorAll('a')].filter(a=>new URL(a.href).hostname!=='avesmaps.de'
  && !/↗/.test(a.textContent))`, gruppiert nach `className` — Ergebnis oben. Für das
  Hinweise-Fenster dieselbe Zählung: `{gesamt:17, extern:15, ohnePfeil:15, mitPfeil:0}`.
  Quellstellen mit `grep -n "avesmaps-lore__name" js/map-features/map-features-lore.js`.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B3 Es gibt sechs Kartenansichten, aber nur fünf Tastenbefehle — „Landschaften" fehlt
- **Kategorie:** KANN
- **Fundstelle:** js/app/keyboard-shortcuts.js:69-78 (fünf `mode`-Zeilen) gegen
  index.html:1897-1902 (sechs `<option>`)
- **Beobachtung:** Der Ansichtswähler bietet `none | original | political | deregraphic |
  powerlines | **ecosystem**`. Die Tastenliste kennt O, P, K, L, I — für `ecosystem`
  („Landschaften") gibt es keine Taste, und weil die Bedienhilfen-Tabelle aus derselben
  Liste gebaut wird, wird die sechste Ansicht dort auch nicht erwähnt. Das war einmal
  stimmig: die Ebene war Admin-Sache. Seit 2026-08-04 darf sie **jeder ansehen**
  (js/app/session.js:66: „ANSEHEN darf sie seit 2026-08-04 jeder";
  map-features-ecosystem-layer-switch.js:53: „Es gibt hier nichts mehr zu verriegeln"), und
  im Menü steht sie ohne `disabled` neben den anderen fünf.
- **Erwartet:** Eine sechste Zeile in `SHORTCUTS` (die Tabelle in den Hinweisen erbt sie
  dann von selbst) — oder eine Zeile in AGENTS.md §11, die sagt, warum genau diese Ansicht
  keine Taste bekommt.
- **Beleg:** Optionsliste live gelesen:
  `[...document.getElementById('mapLayerModeSelect').options].map(o=>o.value+'='+o.text+
  (o.disabled?' (gesperrt)':''))` → `["none=Nur Karte","original=Original","political=Politisch",
  "deregraphic=Standard","powerlines=Kraftlinien","ecosystem=Landschaften"]`, keine gesperrt.
  Umschalten per Klick im Menü funktionierte (`modus:"ecosystem"`). Die gerenderte
  Bedienhilfen-Tabelle (Hinweise → Bedienung) nennt genau fünf Ansichtszeilen.
- **Sicherheit:** BELEGT
- **Aufwand:** klein
- **Nebenbefund zur Tabelle selbst:** Ich habe **alle** anderen Zeilen gegen die tatsächliche
  Wirkung geprüft, und sie stimmen: F (Suche), R (neues Feld + Fokus), O/P/K/L/I (Modus
  wechselt), 1/3/3/6 (`X.....`, `XXX...`, `......`, `XXXXXX` — auch das „dieselbe Ziffer
  blendet alles aus"), Pos 1/Ende (`fastestPath`/`shortestPath` schalten um und die Route
  wird neu gerechnet), Bild ↓/↑ (`activeRoutePlanEntryIndex` 0→1→0), Esc (schliesst das
  oberste Fenster, dann das darunter). W/A/S/D, die Pfeile, Umschalt und +/− konnte ich
  wegen des verborgenen Tabs nicht optisch prüfen, wohl aber ihre Verdrahtung: mit einer
  Attrappe auf `map.panBy`/`zoomIn`/`zoomOut` ergaben synthetische Tastendrücke exakt
  `panBy 0,-80 / -80,0 / 0,80 / 80,0` für W/A/S/D **und** dieselben Werte für die vier
  Pfeiltasten, `panBy 0,-240` für Umschalt+W (dreifacher Schritt), `zoomIn 1` für „=" und
  „+", `zoomOut 1` für „−" und „_". Auch die beiden Riegel greifen: mit Fokus in einem
  Wegpunktfeld landete „p" als Text im Feld und der Modus blieb stehen; bei offenem
  Hinweise-Fenster tat „p" gar nichts.

### B4 Die Suche findet den bekanntesten Fluss Aventuriens nicht unter seinem geläufigen Namen
- **Kategorie:** KANN
- **Fundstelle:** https://avesmaps.de/ → Spotlight-Suche (Taste F), Eingabe „Großer Fluss"
- **Beobachtung:** „**Großer Fluss**" liefert *Grafschaft Großer Fluss* (Herrschaftsgebiet)
  und vier Vorkommen (Ferdoker Forelle, Großer Fluss Stahl, Hölleneisen, Plötze) — **den
  Fluss selbst nicht**. Er heisst in den Daten „Der Große Fluss", und die Suche verlangt
  jedes Wort als Zeichenkette: „Großer" steht in „Der Große Fluss" nicht. Tippt man
  „Große Fluss" (ohne r), steht er sofort an zweiter Stelle. Als Spieler tippt man den
  Nominativ, nicht den Genitiv-Stamm.
- **Erwartet:** Ein Treffer für die geläufige Namensform. Eine deutsche Endungs-Toleranz für
  die letzten ein bis zwei Buchstaben jedes Suchworts (er/e/en/es) würde diesen Fall und die
  ganze Adjektiv-Familie („Große/Großer/Großen") abdecken, ohne die Trefferliste zu fluten.
- **Beleg:** Beide Eingaben live nacheinander ausgeführt, Trefferlisten abfotografiert
  (Screenshots `ss_74552f7eq` = „Großer Fluss", `ss_237130uxg` = „Große Fluss"). Gegenprobe
  „Darpat" zeigt, dass Flüsse grundsätzlich suchbar sind (Treffer „Darpat — FLUSS",
  „Darpatfälle — FLUSS"), es liegt also nicht an der Objektart.
- **Sicherheit:** BELEGT
- **Aufwand:** klein bis mittel
- **Was die Suche sonst kann** (ausdrücklich zum Lob): sie findet Orte, Innerorts-Bauwerke,
  Wege, Flüsse, Regionen, Herrschaftsgebiete, Kraftlinien, Abenteuer, Kartensammlungen und
  Vorkommen (Fauna/Waren), gruppiert das in beschriftete Abschnitte, markiert Unerreichbares
  („kein Ort auf der Karte") und springt sauber ans Ziel.

### B5 Ein Suchtreffer öffnet sein Infofenster, lässt aber das alte Kartenpopup offen stehen
- **Kategorie:** KANN
- **Fundstelle:** js/ui/spotlight-search-focus.js:34-74 (`selectSpotlightSearchEntry`)
- **Beobachtung:** Ich habe „Gareth" gesucht (Popup + Infopanel „Gareth"), danach
  „Reichsstraße 1" und danach „Der Große Fluss". Nach jedem Wechsel zeigte das rechte
  Infopanel korrekt das neue Objekt — **das Leaflet-Popup auf der Karte stand die ganze Zeit
  weiter auf „Gareth"**, mitten im hervorgehobenen Flusslauf. Für einen Leser stehen damit
  zwei Beschriftungen zum selben Zeitpunkt auf dem Schirm, die verschiedene Dinge behaupten.
  Im Code ruft `selectSpotlightSearchEntry` `closeSpotlightSearch()` und
  `clearSpotlightSelection()` — es gibt keinen `map.closePopup()`.
- **Erwartet:** Ein neuer Treffer schliesst das offene Ortspopup (ausser der Treffer ist
  genau dieser Ort).
- **Beleg:** Screenshots `ss_34805pw8n` (Infopanel „Reichsstraße 1", Popup „Gareth") und
  `ss_7345p477k` (Infopanel „Der Große Fluss", Popup immer noch „Gareth"); Codestelle
  gelesen.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B6 In der Klimazonen-Ansicht steht der Zonenname nur am Kartenrand — im Ausschnitt sieht man Farbe ohne Bedeutung
- **Kategorie:** KANN
- **Fundstelle:** https://avesmaps.de/ → Ansicht „Landschaften" → Riegel „Klimazonen"
- **Beobachtung:** Auf Zoomstufe 1 (ganze Karte) stehen die acht Zonennamen als Grossbuchstaben
  am **linken und rechten Rand des Kartenbildes** — schön. Sobald man auf Arbeitszoom
  hineingeht, ist keiner mehr zu sehen: gemessen bei Zoom 3 auf Gareth liegen alle Namen bei
  `x = -3114` beziehungsweise `x ≈ 4860…4951`, bei einem Sichtfenster von 2560 px. Es
  bleiben farbige Bänder ohne Beschriftung, und eine Legende gibt es nicht. Zusatz: auf
  Zoomstufe 1 verdeckt der Routenplaner links zwei der Namen („BOREALE ZONE",
  „GEMÄSSIGTE ZONE" auf der Westseite), weil beide auf derselben x-Position liegen wie das
  Panel.
- **Erwartet:** Entweder wandert der Name mit dem Ausschnitt (wie es Landschafts- und
  Gebietsnamen tun), oder die Ansicht bekommt eine kleine Legende Nord→Süd. Die Zeile
  „Klimazone" in der Ortsinfobox gibt es ja bereits — die Ebene selbst schweigt.
- **Beleg:** `map.setView([532,551],3,{animate:false})`, danach alle Textknoten mit
  „ZONE|SUBTROPEN" samt `getBoundingClientRect()` ausgelesen: je Zone genau zwei Vorkommen,
  bei `x=-3114` und `x≈4900`, `innerWidth` 2560. Übersichtsbild `ss_1297s7z2e` (Zoom 1, Namen
  sichtbar, zwei links vom Panel angeschnitten), `ss_4921huzn6` (Zoom ~2,8, kein Name).
- **Sicherheit:** BELEGT
- **Aufwand:** mittel

### B7 Zwei Kommentare in der englischen Stringtabelle sind seit dem 4. August falsch
- **Kategorie:** KANN
- **Fundstelle:** js/app/i18n-en.js:258 und :261
- **Beobachtung:** Zeile 258 schreibt über `view.mode.ecosystem`: „**Admin-only mode**
  (js/app/session.js)". Das gilt nicht mehr — session.js:66 sagt seit 2026-08-04
  ausdrücklich „ANSEHEN darf sie seit 2026-08-04 jeder", und der Ansichtswähler bietet sie
  jedem an (siehe B3). Zeile 260 überschreibt den nächsten Block mit „Landschaften
  (**Erprobung**)"; die Erprobungs-Kennzeichnung ist inzwischen abgeschafft. Beide Kommentare
  stehen genau dort, wo der nächste Bearbeiter nachschlägt, ob er die Ebene anfassen darf.
- **Erwartet:** „Public since 2026-08-04; editing requires `edit`" statt „Admin-only", und
  „Erprobung" streichen.
- **Beleg:** `sed -n '245,262p' js/app/i18n-en.js` gegen `sed -n '55,110p' js/app/session.js`
  und `grep -n "verriegeln" js/map-features/map-features-ecosystem-layer-switch.js` (Zeile 53:
  „Es gibt hier nichts mehr zu verriegeln").
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B8 Die Kostenzeile nennt „18 Nächte", abgerechnet werden fünf — die anderen dreizehn erklärt niemand
- **Kategorie:** KANN
- **Fundstelle:** Reiseplaner → „REISEKOSTEN JE PERSON", Zeile „Übernachtung" gegen Zeile „Summe"
- **Beobachtung:** Für Gareth→Havena zu Fuss (schnellste Route, 19 Reisetage) steht da:
  Übernachtung **3 S** mit dem Zusatz „**5 ×** Gemeinschaftszimmer", und in der Summenzeile
  „15 D 7 S 7 H — **18 Nächte**, 19 Reisetage". Rechnerisch ist alles richtig (die 8
  Strassenetappen ergeben ~5,8 Reisetage → 5 Wirtshausnächte, die Flusspassage 13,1 → 13
  Nächte an Bord; 5 + 13 = 18), und die Summe stimmt auf den Heller: 30 + 152 + 600 + 795 H
  = 1577 H = 15 D 7 S 7 H. Nur sagt das niemand. Der Leser sieht „18 Nächte" und daneben
  fünf bezahlte Betten und hält es für einen Fehler.
- **Erwartet:** Eine Zeile oder ein Zusatz, der die Differenz benennt („13 Nächte an Bord,
  in der Flusspassage enthalten"). Dieselbe Aufschlüsselung, die die anderen Zeilen schon
  haben („19 Reisetage", „6 Landesgrenzen", „795,4 Meilen").
- **Beleg:** Screenshots `ss_...` des aufgeklappten Kostenblocks (im Lauf zweimal aufgenommen,
  zuletzt bei der Kürzeste-Route-Probe); Zahlen nachgerechnet mit 1 Dukat = 10 Silbertaler =
  100 Heller (die Fussnote des Blocks nennt genau diesen Kurs).
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B9 Ein Kurzlink lädt die Anwendung zweimal und verliert dabei seine eigene Adresse
- **Kategorie:** KANN
- **Fundstelle:** js/app/share-link.js:10-50 (`resolveShareCodeOnLoad`, Zeile 40:
  `window.location.replace(...)`) gegen den Kommentar in
  js/map-features/map-features-layer-state.js:366-368
- **Beobachtung:** `avesmaps.de/?s=HUGCPFhv` lädt die komplette Anwendung, holt danach die
  Langform vom Server und ersetzt die Adresse per `location.replace` durch
  `?route=Gareth&route=Ferdok&toggleMetropolen=1&…` — **die App lädt vollständig ein zweites
  Mal**. Zwei Folgen: (1) wer nach dem Öffnen die Adresszeile kopiert, gibt die lange URL
  weiter statt des Kurzlinks; (2) der Kommentar in `layer-state.js` führt „`?s=` short link"
  ausdrücklich in der Liste dessen auf, was in der Adresszeile **stehenbleiben** soll —
  genau das tut es nicht. Weil `replace` den Eintrag ersetzt, führt „Zurück" auch nicht zum
  Kurzlink zurück.
- **Erwartet:** Der Zustand wird aus der Antwort direkt angewandt (die Funktionen dafür gibt
  es: `applyPlannerStateFromUrl`), die Adresszeile behält `?s=<code>` — oder der Kommentar in
  `layer-state.js` wird korrigiert, damit die beiden Stellen dasselbe behaupten.
- **Beleg:** Kurzlink `HUGCPFhv` per Knopf 🔗 erzeugt (Toast: „Kurzlink kopiert:
  https://avesmaps.de/?s=HUGCPFhv", `POST /api/app/share-link.php` → 201), in einem frischen
  Tab geöffnet; danach `location.search` = die Langform, Route korrekt wiederhergestellt
  (`felder:["Gareth","Ferdok"], etappen:9`, Screenshot `ss_4724rhs8n`), `history.length` 2 und
  „Zurück" nicht möglich. Codestellen gelesen.
- **Sicherheit:** BELEGT
- **Aufwand:** mittel
- **Zum Ausgleich:** das Teilen selbst funktioniert tadellos — dieselbe Route, dieselben
  Zahlen (212,8 Meilen / 143,8 Stunden), derselbe Kartenausschnitt, sogar die Ortsklassen-Filter.

### B10 Eine einzelne Etappe von 795 Meilen neben acht Etappen von 13 bis 57 Meilen
- **Kategorie:** ZUKUNFT
- **Fundstelle:** Reiseplan Gareth→Havena, schnellste Route zu Fuss, letzte Etappe
  („Flussweg über Rakula, Der Große Fluss (795,35 Meilen flussabwärts) von Rakulbruck bis
  Havena in 157,7 Stunden")
- **Beobachtung:** Die Route besteht aus acht Strassenetappen zwischen 13,4 und 56,7 Meilen —
  und dann aus einem einzigen Block von 795,35 Meilen, also 80 % der Gesamtstrecke und
  13 Reisetagen am Stück. Für einen Spielleiter, der die Reise in Spieltage zerlegen will,
  ist genau dieser Block die Hälfte der Reise und die einzige Zeile ohne Zwischenhalt. Die
  Städte am Fluss (Elenvina, Ferdok, Nadoret …) kommen im Plan nicht vor, obwohl das Schiff
  an ihnen vorbeifährt.
- **Erwartet:** Lange Wasserstrecken an ihren Anlegern auftrennen — dieselbe Etappenlogik,
  die die Strasse an jedem Dorf trennt. Zumindest ein Vermerk „ohne Zwischenhalt".
- **Beleg:** `currentRoutePlanEntries` ausgelesen: neun Einträge, Summe 998,06 Meilen, der
  letzte `{"t":"Flussweg","von":"Rakulbruck","bis":"Havena","d":795.35,"tt":157…}`; die acht
  davor 13,37 / 13,91 / 28,01 / 17,50 / 23,50 / 56,66 / 15,56 / 34,20.
- **Sicherheit:** BELEGT
- **Aufwand:** mittel

### B11 „Hierher reisen" schreibt rohe Kartenkoordinaten in den Reiseplan
- **Kategorie:** ZUKUNFT
- **Fundstelle:** Rechtsklick auf die Karte → „Hierher reisen"; Wegpunktfeld und
  Reiseübersicht zeigen `Kartenpunkt (478.284, 531.750)`
- **Beobachtung:** Der Rechtsklick-Weg funktioniert einwandfrei (die Route wurde bis genau
  dorthin verlängert, 51 Etappen, Ankunft „7. Phex"). Nur heisst das Ziel danach
  „Kartenpunkt (478.284, 531.750)" — im Feld, in der Überschrift („Die Reise von Gareth über
  Ferdok über Havena nach Kartenpunkt (478.284, 531.750)") und in der Stationsleiste des
  Infopanels. Diese Zahlen sind interne Bildkoordinaten; für einen Spieler bedeuten sie nichts.
- **Erwartet:** Etwas, das der Leser wiedererkennt — „Kartenpunkt bei Frankfeld", „Punkt in
  der Grafschaft Ragath" oder schlicht „Kartenpunkt 1". Die Angabe, in welchem Gebiet der
  Punkt liegt, steht dem Server ohnehin zur Verfügung (die Zeile „Liegt in" der Infobox
  beantwortet dieselbe Frage für Orte).
- **Beleg:** Screenshot `ss_259181y0k`; Wegpunktfeld im DOM ausgelesen.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B12 Der Zurück-Knopf des Browsers verwirft die Reise, ohne dass sich die Adresse ändert
- **Kategorie:** ZUKUNFT
- **Fundstelle:** Browser-Zurück auf https://avesmaps.de/ ; Ursache in
  js/map-features/map-features-layer-state.js:366-387 (die App schreibt bewusst nichts in
  History/Adresszeile)
- **Beobachtung:** Nach Suche, Routenbau und Ansichtswechseln habe ich „Zurück" gedrückt. Die
  Adresse blieb `https://avesmaps.de/`, aber die Route war weg (`felder:[""]`, `etappen:0`,
  `navType:"back_forward"`). Aus Nutzersicht: „Ich bin auf derselben Seite, und trotzdem ist
  alles gelöscht." Zurück nimmt in dieser Anwendung nie eine Aktion zurück — es fällt auf
  einen älteren Ladezustand.
- **Erwartet:** Entweder macht Zurück etwas Sinnvolles (ein History-Eintrag je Routenbau,
  wie in Kartendiensten üblich), oder der Zustand überlebt das Zurückspringen. Beides ist
  dieselbe Baustelle wie B1 — der Planer-Zustand lebt ausschliesslich im Arbeitsspeicher.
- **Beleg:** `history.back()` im Tab ausgelöst, danach gemessen:
  `{"url":"https://avesmaps.de/","felder":[""],"etappen":0,"navType":"back_forward"}`.
  Zuvor stand dort `{"felder":["Gareth","Ferdok"],"etappen":9}`.
- **Sicherheit:** BELEGT
- **Aufwand:** mittel (History-Einträge) / klein (Zustand sichern)

---

## Was ausdrücklich gut lief (kein Befund, aber Teil des Berichts)

- **Konsole durchgehend sauber.** Über den ganzen Lauf — vier Routenberechnungen, sechs
  Ansichtswechsel, Suche, Fenster, Teilen, Sprachwechsel — kein einziger JS-Fehler
  (`read_console_messages{onlyErrors:true}` an acht Stellen abgefragt, immer leer). Die
  einzige Konsolenausgabe ist die Zeile „Avesmaps geladen: 11486 Features, Revision 56666".
- **Die Zahlen sind in sich stimmig.** Geprüft und bestanden: Etappensumme = Gesamtstrecke
  (998,06 gegen 998,1 angezeigt); kürzeste Route ist kürzer und langsamer als die schnellste
  (692,0 Meilen / 239,1 h gegen 998,1 / 227,7 h — genau richtig herum); Pferd statt zu Fuss
  senkt nur die Zeit, nicht die Strecke (239,1 → 151,7 h bei gleichen 692,0 Meilen);
  „Reisestunden pro Tag" von 12 auf 8 lässt die Reisezeit unberührt und verdoppelt die
  Rastzeit korrekt (151,7 / 303,3 / 455,0 h); der Winterboden schlägt exakt mit +10 %
  durch (151,7 → 166,8 h, Etappenvermerk „1. Tsa · leichter Schnee +10 %"); Abreise 1. Tsa
  + 13,9 Tage = Ankunft 14. Tsa; die Kostensumme stimmt auf den Heller.
- **Die Infobox eines Ortes ist beeindruckend vollständig.** Gareth liefert Bildergalerie,
  Wappen, Herrschaftskette (Reich → Königreich → Kaisermark → Baronie), Beschreibung,
  Oberhaupt, Einwohner, Verkehrswege, Handelszone, Waren, Fauna, Klimazone, Quellenzeile,
  Publikationen (95 offiziell / 156 erwähnt), Kartensammlung (7 Stadtpläne mit
  Spoiler-Riegel), Abenteuerliste mit Cover und Spoiler-Riegel, Bewertungen. Nichts davon
  wirkte langsam.
- **Das Fensterverhalten stimmt.** Der Änderungsverlauf öffnet **beim neuesten Eintrag oben**
  (`scrollTop` 0, erster Eintrag „3. August", letzter „22. April — Avesmaps geht online",
  42 Einträge). Fenster lassen sich am Kopf verschieben (Änderungsverlauf von 183/50 auf
  89/117 gezogen), und Esc schliesst sie einzeln von oben nach unten.
- Das Kontaktformular hat einen sauber gebauten Honigtopf (`aria-hidden`, `tabindex="-1"`,
  `autocomplete="off"`, ausserhalb des Bildes) — ich habe geprüft, ob er Screenreader-Nutzer
  in die Falle lockt, und er tut es nicht. Abgeschickt habe ich nichts.

## Kleinere Beobachtungen ohne eigenen Befund

- **Nachkommastellen springen:** die Etappen zeigen zwei Stellen („13,37 Meilen"), die
  Übersicht eine („998,1 Meilen"). In der Summenzeile fällt es auf: 227,7 + 227,7 ergibt
  455,4, angezeigt wird 455,3 (korrekt gerundet aus 227,66 + 227,66 = 455,32, aber der
  Leser rechnet nach).
- **Nach jedem grösseren Sprung stehen mehrere Sekunden weisse Kachelflächen** auf der Karte
  (nach dem Zoom auf die ganze Reichsstraße 1 gemessen: nach 4 s noch grosse leere Bereiche,
  nach 9 s vollständig). Kein Fehler, aber der erste Eindruck einer „halb geladenen" Karte.
- **Einen „Einstellungen"-Bereich habe ich nicht gefunden** — es gibt DE/EN und hell/dunkel
  als zwei kleine Symbole oben rechts im Panel und sonst nichts. Einen **Wappen-Schalter**
  gibt es in der öffentlichen Oberfläche ebenfalls nicht (die Anzeigehaken „Wege / Labels /
  Grenzen / Flüsse / Seewege" in index.html:1934-1938 stehen `hidden` und werden je nach
  Ansicht eingeblendet).
- **„Abenteuer in Der Große Fluss"** — die Überschrift setzt den Artikel unverändert hinter
  „in"; deutsch wäre „Abenteuer im Großen Fluss" oder „Abenteuer in „Der Große Fluss"".
- **„Reichsstraße über Reichsstraße 6"** liest sich in jeder Etappenzeile doppelt; gemeint
  ist „Wegart: Reichsstraße" plus „Name: Reichsstraße 6".
- **Der Änderungsverlauf endet am 3. August**, während die Tastaturbefehle vom 5. August
  schon live sind und in den Hinweisen erklärt werden. Laut AGENTS.md §11 pflegt eine
  Routine den Verlauf — das ist also erwartbarer Nachlauf und kein Fehler; ich erwähne es
  nur, weil ein Besucher am selben Tag beides sieht.
- Die Einwohnerzahl steht ohne Tausenderpunkt da („170000 (sowie 1000 Zwerge, 500 Elfen…)").
  Der Wert kommt wortwörtlich aus dem Wiki-Infoboxfeld (api/_internal/wiki/settlements.php:616
  schneidet nur die Länge ab) — ob das Wiki selbst so schreibt, habe ich **nicht** geprüft,
  deshalb kein Befund.

## Grenzen dieses Laufs (ehrlich benannt)

- Ab etwa der Hälfte war mein Browsertab nicht mehr der aktive
  (`document.visibilityState === "hidden"`). Dadurch (a) liefen Screenshots in 30-s-Timeouts,
  (b) schloss Leaflets animiertes `zoomIn`/`panBy` nie ab, (c) kamen MCP-Tastendrücke
  zeitweise gar nicht an (ein eigener `keydown`-Zähler stand auf 0). **Jeder scheinbare
  „Freeze" und jede scheinbar wirkungslose Taste in diesem Lauf ist so erklärt und wurde
  nachgeprüft — nichts davon ist ein Befund.** Details in
  `screenshots/8-HINWEIS.md`; dort steht auch, warum keine Bilddateien abgelegt sind
  (der Chrome-MCP schreibt keine).
- Nicht geprüft: mobile Ansicht, Mehrbenutzerfälle, alles hinter dem Editor.
- Angelegt habe ich nur zwei Kurzlink-Zeilen (`map_share_links`), beide im SPURENBUCH
  eingetragen; sonst nichts geschrieben, keine Massenläufe, keine Syncs.

## Serverzustand

Durchgehend gesund. Vier Routenberechnungen (jeweils < 10 s), ein Politik-Layer-Aufruf,
ein Landschaften-Aufruf, ein Kurzlink-POST (201), kein Timeout, kein 5xx, keine
Wiederholungsschleife. Der einzige Aufruf, der spürbar dauerte, war der erste Wechsel in die
Ansicht „Politisch" (~8 s bis alles stand) — im erwarteten Rahmen für diesen Endpunkt.
