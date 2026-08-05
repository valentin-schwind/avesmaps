# Agent 9 — Tiefendurchlauf: alle Funktionen auf allen Ansichten

## Kern

- **Der Reiseplaner redet in `alert()`** — jede Absage („keine Route", „kein Landweg", „Ort
  nicht gefunden") kommt als blockierendes Browserfenster, 11 Aufrufe im öffentlichen Pfad,
  obwohl im Panel dieselbe Zeile steht. Es legte mir zweimal den Tab lahm; ich hielt es für
  einen Freeze, bis ich `window.alert` abfing (B1).
- **Ein Rechtsklick aufs Meer zerstört den fertigen Reiseplan** und lässt den abgelehnten
  Punkt in der Liste — jede weitere Rechnung meldet erneut, bis man die Zeile löscht (B2).
- **Die Routenlinie ist reines Blau `#1452F7`** (`js/config.js:47`); §12 sagt „kein Blau",
  die drei erlaubten Ausnahmen nennen sie nicht (B3). Zweiter Einbruch: die Link-Hausfarbe
  trifft nur `a[target="_blank"]` — besuchte interne Links werden browser-lavendel (B4).
- **Der Ansichtswechsel wirft die Ortsklassen-Wahl weg** (111100 → Politisch → zurück =
  111111), während die Landschaften-Unterebene sauber überlebt (B5).
- **Ein Deep-Link auf einen Namen, den es nicht gibt, tut lautlos nichts** (B6) — für Links
  aus dem Wiki heißt das: umbenannte Seite = tote Stille.
- Gut: Konsole fehlerfrei, Transportfenster vorbildlich, leere Zustände sauber, Englisch
  vollständig und ohne abgeschnittene Beschriftungen, 375 px bedienbar — nach Zuklappen (B13).

---

### B1 Jede Routen-Absage kommt als blockierendes `alert()` — zusätzlich zur Meldung, die schon im Panel steht
- **Kategorie:** AKUT
- **Fundstelle:** js/routing/route-engine.js:467, 478, 511, 548, 573, 609, 631, 660;
  js/routing/routing.js:532, 1459, 1474 (11 `alert()` im öffentlichen Reisepfad)
- **Beobachtung:** Nimmt man den Haken „Land" heraus (die naheliegende Geste für „ich will
  nur per Schiff reisen"), erscheint ein **natives Browser-Fenster**: „Keine Route zwischen
  Gareth und Havena gefunden." Gleichzeitig steht im Panel bereits die Zeile
  **„Keine Route gefunden"**. Die Meldung ist also doppelt, und die zweite Fassung
  - blockiert den ganzen Tab, bis man sie wegklickt (kein Rendern, kein Skript, nichts),
  - trägt die Schrift und Farben des Browsers statt der Designsprache (§12),
  - lässt sich nicht verschieben, nicht mit Esc gestalten, nicht gestalten überhaupt.
  Schaltet man alle drei Haken nacheinander aus, erscheinen **drei** solche Fenster
  hintereinander, eines je Klick. Nebenbefund: die Meldung sagt nicht, *warum* — dass der
  Nutzer selbst gerade die Landwege abgeschaltet hat, steht nirgends.
- **Erwartet:** Die Absage gehört in dieselbe Zeile, die es schon gibt (`#overview`), oder
  in einen Toast im Hausstil. `alert()` ist in einer Anwendung mit eigener Fenster-Sprache
  (Hinweise, Änderungsverlauf, Kartensammlung — alle selbst gebaut) ein Fremdkörper.
- **Beleg:** Live reproduziert auf https://avesmaps.de/. Vorgehen: `window.alert` durch
  einen Rekorder ersetzt (`window.__alerts=[]; window.alert=m=>__alerts.push(String(m))`),
  Route Gareth→Havena gebaut (998,1 Meilen, 9 Etappen), dann
  `document.getElementById('allowLand').click()` → `__alerts` =
  `["Keine Route zwischen Gareth und Havena gefunden."]`, Panel-Ende = `"Keine Route gefunden"`.
  Alle drei Haken nacheinander → **vier** identische Einträge. Quellstellen mit
  `grep -rn "\balert(" js/ --include=*.js` (22 gesamt, 11 im Reisepfad) gelesen.
  ⚠️ **Ehrlich dazu:** ich habe dieses Verhalten zweimal als „Renderer eingefroren" erlebt
  (`Runtime.evaluate` lief >2 Minuten in den Timeout), bevor ich die Ursache fand — genau
  das passiert einem Nutzer mit einem Hintergrundtab auch.
- **Sicherheit:** BELEGT
- **Aufwand:** klein (die Zeile im Panel existiert bereits; es ist ein Löschen, kein Bauen)

### B2 Ein abgelehnter „Hierher reisen"-Punkt bleibt in der Liste stehen und löscht den fertigen Reiseplan
- **Kategorie:** AKUT
- **Fundstelle:** Rechtsklick auf Wasser → „Hierher reisen"; js/routing/route-engine.js:559–577
  (Absage), das Wegpunktfeld wird dabei nicht zurückgenommen
- **Beobachtung:** Bestehender, gerechneter Plan Gareth → Ferdok. Rechtsklick auf das offene
  Meer, „Hierher reisen". Es folgt:
  1. das Meldungsfenster „**Dorthin führt kein Landweg — bitte einen Punkt an Land wählen.**"
     (der Satz selbst ist gut und verständlich),
  2. der abgelehnte Punkt **steht trotzdem als dritter Wegpunkt in der Liste**:
     `["Gareth","Ferdok","Kartenpunkt (486.075, 338.252)"]`,
  3. der **vorher fertige Reiseplan ist weg** — das Panel zeigt wieder den Leerzustand
     „Wegpunkte und Dauer der Reise werden hier angezeigt.",
  4. **jede** weitere Berechnung meldet erneut dasselbe, bis man die dritte Zeile von Hand
     löscht. Wer den Zusammenhang nicht sieht, hält die Anwendung für kaputt.
  Der Preis für einen ungenauen Rechtsklick ist also die ganze zusammengestellte Reise.
- **Erwartet:** Eine abgelehnte Eingabe wird zurückgenommen (der Wegpunkt wird gar nicht
  erst gesetzt oder nach der Absage wieder entfernt), und der zuletzt gültige Plan bleibt
  stehen. Der Ort weiß ja, dass er ungültig ist — er meldet es gerade.
- **Beleg:** Live reproduziert. Nach dem Rechtsklick auf (300,420) im Meer und Klick auf
  „Hierher reisen": `__alerts` = `["Dorthin führt kein Landweg — bitte einen Punkt an Land
  wählen."]`, Felder wie oben. Danach `updateMapView()` erneut → wieder **eine** Meldung,
  Felder unverändert, `currentRoutePlanEntries.length === 0`, Panel-Ende =
  „Wegpunkte und Dauer der Reise werden hier angezeigt.".
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B3 Die Routenlinie — das Kernbild eines Routenplaners — ist reines Blau und hartkodiert
- **Kategorie:** KANN
- **Fundstelle:** js/config.js:47 — `const ROUTE_STYLE = { pane: "routePane", color: "#1452F7", … }`
- **Beobachtung:** Jede gezeichnete Route liegt als **`#1452F7`** auf der Karte, gemessen im
  laufenden Betrieb. AGENTS.md §12 sagt: „Warm browns + parchment + coat-of-arms gold.
  **No blue** (it reads as a foreign UI kit …)" und „**never hardcode a colour** — always use
  a token". `docs/design-language.md:169-177` zählt genau **drei** gewollte Blau-Ausnahmen
  auf — Bearbeitungsgriffe, die Diagrammpalette der Statistik, die Wassertöne der
  Landschaften-Ebene. Die Routenlinie ist keine davon. Zwei Beobachtungen dazu:
  - Es ist **derselbe Wert** wie `--color-edit-handle` (`css/base/tokens.css:156`), also die
    Farbe, die im Haus ausdrücklich „hier wird gerade bearbeitet" bedeutet — auf der
    öffentlichen Karte sagt sie das Falsche.
  - Die ausgewählte Etappe ist gleich daneben **gold** (`ROUTE_SELECTED_STYLE` `#ffd54a`,
    js/config.js:48). Innerhalb einer Linie stoßen also Hausfarbe und Fremdfarbe aneinander.
  - Dass das Problem bekannt ist, steht im Haus selbst: js/map-features/map-features-ecosystem-draw.js:17
    warnt beim Kopieren derselben Vorlage ausdrücklich „The template is blue: #1452F7 …
    Copied literally that would walk a foreign UI colour into this layer against AGENTS.md §12."
- **Erwartet:** Entweder ein Token (`--color-route`) in einem warmen Ton — oder ein
  vierter Absatz in `docs/design-language.md`, der die Route als bewusste Ausnahme führt.
  Heute widersprechen sich Code und Hausordnung.
- **Beleg:** Im Browser gemessen:
  `map.eachLayer(l => l.options.pane === "routePane" && l.options.color)` →
  `"routePane :: #1452F7 w7 op1"` (Gegenstück `"routeOutlinePane :: #FFFFFF w11"`).
  Screenshot der Route Gareth → Havena → Ferdok, die blaue Linie über die halbe Karte.
  Quellstellen mit `grep -rn "1452F7" js/ css/` gelesen, `docs/design-language.md:169-177` gelesen.
- **Sicherheit:** BELEGT (dass es blau und hartkodiert ist). Ob der Owner es warm *will*,
  ist seine Entscheidung — belegt ist nur, dass Code und Dokument auseinandergehen.
- **Aufwand:** klein

### B4 Die Link-Hausfarbe greift nur bei externen Links — ein besuchter interner Link wird browser-lavendel
- **Kategorie:** KANN
- **Fundstelle:** css/features/links.css:23 (`a[target="_blank"]:not(…)` — der Selektor der
  einheitlichen Linkfarbe); betroffen live: `.avesmaps-citymaps__card`
  (css/features/place-extras.css:35, setzt `text-decoration` aber **kein** `color`)
- **Beobachtung:** Die Regel, die allen Links das warme Gold-Braun gibt, ist an
  `a[target="_blank"]` gebunden. Alles, was **im selben Tab** öffnet, fällt damit auf die
  Browser-Vorgabe zurück — und die ist im dunklen Design hellblau, besucht **`#9E9EFF`**
  (Lavendel). In der Kartensammlung von Gareth ist das sofort sichtbar: von sieben Kacheln
  sind fünf gold (`rgb(215,195,139)`, alle mit `target="_blank"`, Ziel Ulisses/Wiki), und
  **zwei sind lavendel** (`rgb(158,158,255)`) — genau die beiden mit `host=avesmaps.de` und
  ohne `target`. Der Unterschied ist nicht „intern gegen extern" als Absicht, sondern
  schlicht: die Hausregel erreicht sie nicht. Der Effekt taucht erst auf, **nachdem** man
  einmal draufgeklickt hat — deshalb sieht ihn kein Schnelldurchlauf.
- **Erwartet:** Die einheitliche Linkfarbe hängt am Link, nicht an seinem Ziel-Fenster
  (`a:where(:link, :visited)` im Panel-Geltungsbereich). Das ↗ darf weiter an
  `a[target="_blank"]` hängen — das sagt etwas anderes und ist richtig so.
- **Beleg:** Im Browser gemessen, Infobox Gareth offen:
  `[...document.querySelectorAll('.avesmaps-citymaps__card[href]')].map(a =>
  getComputedStyle(a).color + ' | target=' + a.getAttribute('target') + ' | ' + new URL(a.href).hostname)`
  → 5 × `rgb(215,195,139) | target=_blank | ulisses-ebooks.de / linestyle-artwork.de /
  de.wiki-aventurica.de`, 2 × `rgb(158,158,255) | target=null | avesmaps.de`.
  Gesamtzählung im selben Zustand: 131 sichtbare `a[href]`, davon 6 ohne `_blank`
  (4 davon Leaflet-Bedienelemente, die eigene Farben haben). css/features/links.css:1-34 gelesen.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B5 Jeder Ansichtswechsel wirft die selbst gewählten Ortsklassen weg
- **Kategorie:** KANN
- **Fundstelle:** https://avesmaps.de/ → Ansichtswähler „Derographie" + die sechs
  Ortsklassen-Knöpfe (`.location-toggle`)
- **Beobachtung:** Ich habe in „Standard" die Dörfer und die besonderen Bauwerke
  ausgeblendet (Zustand `111100` — eine sehr normale Geste, wenn einem die Karte zu voll
  ist). Dann einmal nach „Politisch" und zurück: **`111111`** — beide Haken sind wieder da.
  Die Vorgabe der Ansicht überschreibt die Wahl des Nutzers bedingungslos, auch beim
  Zurückkommen. Die Einstellung ist auch nirgends gespeichert: in `localStorage` liegen 36
  Schlüssel (Theme, Sprache, Planer-Gruppen, `avesmaps.ecosystem.activeKind`,
  `avesmaps.ecosystem.showAllLayers` …) — **keiner** für die Ortsklassen.
  Der Widerspruch im selben Haus: die Landschaften-Unterebene **überlebt** den Rundweg
  sauber („Klimazonen" war vorher, nachher und dazwischen aktiv), weil sie einen
  `localStorage`-Schlüssel hat. Zwei Unterauswahlen derselben Leiste, zwei Verhalten.
- **Erwartet:** Entweder überleben beide (die Ansichtsvorgabe gilt nur beim **ersten**
  Betreten einer Ansicht), oder keine. Heute lernt der Nutzer, dass „die Karte seine
  Einstellung vergisst" — ohne zu erkennen, wann.
- **Beleg:** Live nacheinander ausgeführt und gemessen mit
  `[...document.querySelectorAll('.location-toggle')].map(x=>x.classList.contains('is-active')?1:0).join('')`
  → `nachHand:"111100"`, `inPolitisch:"000000"`, `zurückInStandard:"111111"`.
  Gegenprobe Landschaften: `{vorher:"Klimazonen", inStandard:"Klimazonen", zurück:"Klimazonen"}`.
  `Object.keys(localStorage)` gelesen (36 Schlüssel, keiner mit „toggle"/„location").
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B6 Ein Deep-Link auf einen Namen, den es nicht gibt, tut lautlos gar nichts
- **Kategorie:** KANN
- **Fundstelle:** https://avesmaps.de/?siedlung=Gibtsnichthausen ;
  js/app/wiki-deeplink.js:23-29 (die fünf Parameter `siedlung/staat/region/strasse/fluss`)
- **Beobachtung:** Die Anwendung lädt vollständig, zeigt die Startansicht, behält
  `?siedlung=Gibtsnichthausen` in der Adresszeile — und sagt **nichts**. Kein Hinweis, kein
  Toast, kein Popup, kein leeres Infofenster, nicht einmal eine Konsolenzeile (die Konsole
  enthält genau eine Zeile: „Avesmaps geladen: 11498 Features, Revision 56751."). Für einen
  Leser ist das nicht von „die Seite ist kaputt" oder „den Ort gibt es auf der Karte nicht"
  zu unterscheiden. Das wiegt schwerer als es klingt, weil diese Parameter laut
  js/app/wiki-deeplink.js:5-6 **aus Wiki-Aventurica-Seiten** kommen (`{{PAGENAMEE}}`):
  eine dort umbenannte Seite wird zu einem Link, der wortlos ins Leere führt.
- **Erwartet:** Eine kurze, ruhige Zeile — „*Gibtsnichthausen* ist auf der Karte nicht
  eingetragen." — am besten mit dem Angebot, danach zu suchen. Die Suche findet ja
  Ähnliches; hier steht sie nur nicht zur Verfügung.
- **Beleg:** Live aufgerufen, 6 s gewartet, danach gemessen: `location.search` =
  `"?siedlung=Gibtsnichthausen"`, `map.getCenter()` = `{lat:497.28,lng:520.5}` (die
  unveränderte Startmitte), Infopanel-Text = `[]`, kein Leaflet-Popup, kein `[role=status]`
  mit Inhalt. `read_console_messages` → 1 Meldung, die normale Ladezeile.
  Gegenprobe, dass die Parameter grundsätzlich funktionieren: `?siedlung=Gareth` springt
  sauber auf Gareth (Popup + Infopanel, Adresszeile bleibt), `?staat=F%C3%BCrstentum_Kosch`
  schaltet auf „Politisch" und öffnet das Gebiet — beide einwandfrei.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B7 Ein Kraftlinien-Treffer der Suche öffnet weder Infofenster noch Hervorhebung
- **Kategorie:** KANN
- **Fundstelle:** js/ui/spotlight-search-focus.js:674-680 (`focusSpotlightPowerline`) gegen
  :57 (`focusSpotlightPath` → `highlightSpotlightPaths`)
- **Beobachtung:** Die Suche findet Kraftlinien tadellos („Konzilslinie — Kraftlinie",
  „Yaquirlinie — Kraftlinie"). Wählt man einen dieser Treffer, schaltet die Karte auf die
  Kraftlinien-Ansicht — **und das war es**. Das Infofenster zeigt weiterhin das Objekt, das
  vorher offen war (bei mir hartnäckig „Gareth"), die gewählte Linie wird nicht
  hervorgehoben, und in der Ansicht liegen 1620 Linienpfade, unter denen man sie nun selbst
  suchen darf. Im Code ist das sichtbar: `focusSpotlightPowerline` setzt den Modus, ruft
  `syncPowerlineLabels()` und fliegt auf die Bounding-Box — es gibt **keinen** Aufruf, der
  das Infopanel öffnet, und **kein** Gegenstück zu `highlightSpotlightPaths`, das der
  Wege-Zweig direkt darüber benutzt.
  Dass die Infobox selbst existiert und gut ist, habe ich gegengeprüft: ein **Klick auf die
  Linie** auf der Karte öffnet sie sofort („Gareth - Reichsabtei St. Praiodan / Kraftlinie /
  Anzeigen / Änderungen vorschlagen / Verbindet: Gareth ↔ Reichsabtei St. Praiodan").
- **Erwartet:** Derselbe Abschluss wie beim Weg — Linie hervorheben und ihre Infobox öffnen.
- **Beleg:** Live: Karte auf `[700,300]` gesetzt, dann Suchtreffer „Yaquirlinie Kraftlinie"
  gewählt; danach `map.getCenter()` unverändert `{lat:700,lng:300}`, Infopanel-Kopf
  unverändert `["Gareth","Metropole · Hauptstadt von …"]`, kein Popup. Gegenprobe mit einem
  echten Mausklick auf einen Linienpfad → Panel wechselt korrekt auf die Kraftlinie.
  Quellstellen gelesen.
  ⚠️ **Ehrlich:** dass die Karte nicht flog, kann auch an meinem verborgenen Tab liegen —
  `focusSpotlightBounds` benutzt `map.flyToBounds` (animiert), und Animationen laufen in
  einem Hintergrundtab nicht zu Ende. Das **fehlende Infofenster und die fehlende
  Hervorhebung** hängen nicht daran: sie stehen so im Code.
- **Sicherheit:** BELEGT (Panel/Hervorhebung) · der Kameraflug PLAUSIBEL nicht geprüft
- **Aufwand:** klein
- **Nebenbefund, ausdrücklich KEIN Fehler:** dass die Kraftlinie kein „Link teilen" hat, ist
  in js/map-features/map-features-powerlines.js:360 begründet („für Kraftlinien gibt es
  keinen solchen Parameter — ein Knopf, der nichts Auflösbares erzeugt, wäre schlimmer als
  keiner"). Ich habe es geprüft, weil es wie eine Lücke aussah; es ist eine Entscheidung.

### B8 Bei Zoom 7 verschmelzen Ortsname und Wegname zu „Garethstraße 3"
- **Kategorie:** KANN
- **Fundstelle:** https://avesmaps.de/ → Ansicht „Standard", Zoom 7 über Gareth
  (`map.setView([532,551],7)`)
- **Beobachtung:** Auf der höchsten Zoomstufe legt sich die wiederholte Wegbeschriftung
  „Reichsstraße 3" so über das Ortslabel „Gareth", dass die Zeile als **„Garethstraße 3"**
  zu lesen ist — der Anfang des Wegnamens verschwindet exakt hinter dem Ortsnamen.
  Es trifft die bekannteste Stadt Aventuriens auf der Stufe, auf der man hinschaut, um
  Einzelheiten zu lesen. Auf Zoom 6 ist dieselbe Stelle sauber; der Fehler entsteht erst,
  wenn die Wegbeschriftung häufiger wiederholt wird und eine Wiederholung genau auf dem
  Ortslabel landet. Beide Beschriftungen kommen aus verschiedenen Zeichnern
  (`locationCanvasPane` gegen `avesmapsPathLabelCanvasPane`) — die Kollisionsprüfung, die
  Ortsnamen untereinander freihält, greift zwischen diesen beiden Ebenen offenbar nicht.
- **Erwartet:** Eine Wiederholung einer Wegbeschriftung wird ausgelassen, wenn sie ein
  Ortslabel überdeckt (dieselbe Regel, die Ortslabels untereinander schon anwenden).
- **Beleg:** Screenshot `ss_3630raz3v` (Gesamtbild Zoom 7) und die Ausschnittsvergrößerung
  `ss_…` des Bereichs (790,260)–(1010,330), auf der „Gareth" und „straße 3" ineinander
  stehen. Gegenprobe Zoom 6 (`ss_7496mcp5b`): dort steht „Gareth" frei und
  „Reichsstraße 2"/„Reichsstraße 3" laufen daneben.
- **Sicherheit:** BELEGT
- **Aufwand:** mittel

### B9 „1 Etappen" — die Etappenzahl hat keine Einzahl, in beiden Sprachen
- **Kategorie:** KANN
- **Fundstelle:** js/routing/route-plan.js:1046
  (`tr("planner.summary.legCount", "{n} Etappen", { n: planEntries.length })`);
  englische Entsprechung js/app/i18n-en.js:153 (`"planner.summary.legCount": "{n} legs"`)
- **Beobachtung:** Jede Reise, die aus einem einzigen Abschnitt besteht, meldet in der
  Übersicht „**1 Etappen**". Das ist keine Randerscheinung: jede reine Seefahrt ist genau
  eine Etappe. Havena → Thorwal zeigt „505,1 Meilen / **1 Etappen**". Auf Englisch derselbe
  Satz mit demselben Fehler: „505.1 miles / **1 legs**". Der Rest der Zeile ist sorgfältig
  gemacht — Tausenderpunkt („1.004,7 Meilen"), Dezimalkomma im Deutschen, Dezimalpunkt im
  Englischen —, was den harten Plural umso auffälliger macht.
- **Erwartet:** Eine Einzahl-/Mehrzahl-Form im Stringtabellen-Format (`{n} Etappe` /
  `{n} Etappen`), die die i18n-Schicht ohnehin bräuchte.
- **Beleg:** Live: `__setWp(['Havena','Thorwal']); updateMapView()` → Übersicht
  `["Distanz","505,1 Meilen","1 Etappen","Drachenflug","379,2 Meilen","2 Stationen",…]`.
  Dieselbe Route unter `?lang=en` → `["Distance","505.1 miles","1 legs","As the dragon flies",…]`.
  Beide Quellstellen gelesen.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B10 Der Reisebeginn nimmt einen Tag an, den es nicht gibt, und zeigt ihn danach an zwei Stellen verschieden
- **Kategorie:** KANN
- **Fundstelle:** Reiseplaner → „Reisebeginn:" (`#travelStartDay`, `min=1 max=30`) gegen die
  Kopfzeile der zugeklappten Gruppe „Reiseoptionen"
- **Beobachtung:** Sobald ein Monat gewählt ist, ist das Tagesfeld freigegeben. `max="30"`
  verhindert bei einem Zahlenfeld **nicht**, dass man 99 (oder das viel wahrscheinlichere
  31) hineinschreibt — es gibt kein Formular, das die Prüfung auslösen würde
  (`checkValidity()` ist `false`, aber niemand fragt). Danach stehen zwei verschiedene
  Wahrheiten auf demselben Bildschirm:
  - Kopfzeile „Reiseoptionen": „Schnellste Route · 12,0 h/Tag · **ab 99. Firun**"
  - Reiseübersicht: „Abreise **30. Firun** — Ankunft 6. Tsa"
  Gerechnet wird richtig (der Kalender klemmt auf 30), aber die Oberfläche behauptet
  zugleich ein Datum, das es im aventurischen Kalender nicht gibt.
- **Erwartet:** Der Wert wird beim Verlassen des Feldes auf 1–30 geklemmt (und das Feld
  zeigt dann auch die 30), oder die Kopfzeile nennt denselben Tag wie der Reiseplan.
- **Beleg:** Live: Monat „Firun (Winter)" gewählt, `#travelStartDay` auf `99` gesetzt,
  neu gerechnet. Gemessen: `travelStartDay.value === "99"`, `disabled === false`,
  `checkValidity() === false`; Panel-Zeilen `"Schnellste Route · 12,0 h/Tag · ab 99. Firun"`
  und `"Abreise" / "30. Firun" / "Ankunft" / "6. Tsa"`. Etappenvermerke korrekt
  „30. Firun · leichter Schnee +10 %".
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B11 Beim Herauszoomen liegt ein hellgrauer Leaflet-Rest um die Karte, auf dem der Maßstab unlesbar wird
- **Kategorie:** KANN
- **Fundstelle:** css/third-party/leaflet.css:261 (`.leaflet-container { background: #ddd; }`),
  nirgends überschrieben — css/layout/map-layout.css:6 setzt an `#map` nur `width`/`height`
- **Beobachtung:** Auf Zoomstufe 0 füllt Aventurien den Bildschirm nicht aus. Was daneben
  sichtbar wird, ist **`#ddd`** — die unveränderte Vorgabe der mitgelieferten Leaflet-CSS,
  also ein neutrales Hellgrau. Im **dunklen** Design (`data-theme="dark"`, das war meine
  Voreinstellung) sitzt damit eine helle Fläche um die Karte, gegen die alles andere warm
  und dunkel ist. Auf dieser Fläche liegt außerdem der Maßstab in weißer Schrift
  („100 Meilen") und ist praktisch nicht zu lesen. Nach §12 ist eine Farbe, die zweimal
  gebraucht wird, ein Token — hier ist es ein Fremdwert, der nie ersetzt wurde.
- **Erwartet:** `#map` bekommt einen Hintergrund aus `css/base/tokens.css` (warm und
  theme-abhängig, wie alles andere).
- **Beleg:** Live gemessen bei `map.setView([532,551],0)`:
  `getComputedStyle(document.getElementById('map')).backgroundColor` = `"rgb(221, 221, 221)"`,
  `document.documentElement.dataset.theme` = `"dark"`. Screenshot `ss_5585taxrp` (Zoom 0,
  helle Fläche rings um den Kontinent) und die Vergrößerung des Maßstabbereichs
  (700,705)–(900,744), auf der „100 Meilen" weiß auf Hellgrau steht.
  `grep -rn "background.*#ddd" css/` → genau ein Treffer, die Leaflet-Datei.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B12 Die große Suche hat keinen sichtbaren Knopf — nur die Taste F und den Rechtsklick
- **Kategorie:** KANN
- **Fundstelle:** js/app/keyboard-shortcuts.js:321 und js/routing/routing.js:689 — die
  **einzigen** beiden Aufrufer von `openSpotlightSearch()`
- **Beobachtung:** Die Spotlight-Suche ist die beste Funktion der Anwendung — sie findet
  Orte, Innerorts-Bauwerke, Wege, Flüsse, Regionen, Herrschaftsgebiete, Kraftlinien,
  Abenteuer, Kartensammlungen und Vorkommen, in beschriftete Abschnitte gruppiert. Sie hat
  **kein Symbol und keinen Knopf**. Ich habe alle 22 sichtbaren Schaltflächen der
  Startansicht ausgelesen: Zoom ±, Design, DE/EN, Ansichtswähler, sechs Ortsklassen,
  Wegpunkt-Griff, Wegpunkt löschen, „Ziel hinzufügen", zwei Gruppenköpfe, zwei
  Erklär-Knöpfe, drei Transportmittel-Auswahlen, „Hinweise" — **keine Lupe**. Das Feld
  „Suche Ort…" im Planer sieht wie die Suche aus, ist aber das Reiseziel-Feld und findet
  nur Orte, keine Regionen/Wege/Gebiete/Abenteuer.
  Erreichbar ist sie über **F** und über den Rechtsklick aufs Kartenbild („Suchen", das
  Menü hat sechs öffentliche Einträge). Beides muss man wissen. Auf einem Telefon hat man
  weder Tastatur noch Rechtsklick — dort bleibt bestenfalls das lange Drücken, das nirgends
  erklärt ist.
- **Erwartet:** Eine Lupe im Panelkopf (neben DE/EN und dem Design-Schalter), die
  `openSpotlightSearch()` ruft. Das ist eine Zeile Markup für die Funktion, die am meisten
  zu bieten hat.
- **Beleg:** Live ausgelesen: alle sichtbaren `button/a/[role=button]` mit Text, `title`
  und `aria-label` (22 Stück, Liste oben, keine Suche darunter).
  `grep -rn "openSpotlightSearch" js/ index.html` → 4 Treffer, davon 2 Aufrufer (Taste,
  Kontextmenü), 1 Definition, 1 Test. Kontextmenü live geöffnet:
  sichtbare Einträge = „Stelle markieren und teilen / Hier melden… / **Suchen** / Nächsten
  Ort finden / Hierher reisen / Entfernung messen".
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B13 Auf 375 px deckt der Reiseplaner die ganze Karte, und der einzige Weg daran vorbei ist ein 20 px breiter Rest am Bildrand
- **Kategorie:** KANN
- **Fundstelle:** css/layout/map-layout.css:11-15 (`#search { width: 350px; max-width:
  calc(100vw - 10px); max-height: 95vh }`) + der senkrechte Aufklapp-Reiter „Routenplaner"
- **Beobachtung:** Bei einer Fensterbreite von 370 px misst das Planer-Panel **350 × 766 px**
  — 95 % der Breite und 99 % der Höhe. Von der Karte ist beim Laden **nichts** zu sehen.
  Der einzige Schalter, der sie freigibt, ist der senkrechte Reiter „Routenplaner": er liegt
  bei `x = 350` und ist 30 px breit, also von 350 bis 380 — bei 370 px Sichtfeld ragen 10 px
  über den Rand hinaus und **20 px bleiben antippbar**. Das ist unterhalb jeder üblichen
  Mindestgröße für ein Tippziel und sieht nicht wie ein Bedienelement aus.
  Klappt man ihn zu, ist die Karte bei 375 px **sehr gut**: große, klar lesbare
  Beschriftungen, Zoomknöpfe und „Hinweise" gut erreichbar, der Reiter sitzt danach links
  am Rand und ist voll sichtbar. Auch die Bedienelemente im Panel selbst stapeln sich sauber
  (nichts überlappt, nichts läuft über). Das Problem ist allein der **Startzustand**.
- **Erwartet:** Unterhalb einer Schwelle startet der Planer zugeklappt (oder als
  Schublade von unten), damit das erste, was man sieht, die Karte ist.
- **Beleg:** Gemessen in einem 375-px-Rahmen derselben Anwendung
  (gleiche Herkunft, deshalb auslesbar): `innerWidth` 370, `#search` Rechteck
  `[0,10,350,766]`, Reiter-Rechteck `[350,30,30,140]`. Nach einem Klick auf den Reiter
  fährt das Panel auf `x = -350`, die Karte ist frei. Zwei Ausschnittsbilder
  (Panel-Startzustand / freigegebene Karte) aufgenommen.
  ⚠️ **Ehrlich zum Vorgehen:** `resize_window` auf diesem Browserfenster wurde mehrfach von
  anderen Sitzungen überschrieben (die Fensterbreite sprang während meines Laufs
  unaufgefordert zwischen 2560, 1045 und 397 px). Ich habe die Schmalansicht deshalb in
  einem eingebetteten 375-px-Rahmen geprüft — Media-Queries richten sich nach dessen
  Sichtfeld, die Maße oben sind echte Messwerte. Eine Prüfung mit echter
  Berührungseingabe (langes Drücken für das Kontextmenü) steht damit **aus**.
- **Sicherheit:** BELEGT (Maße, Verhalten) · Touch-Gesten PLAUSIBEL nicht geprüft
- **Aufwand:** klein bis mittel

### B14 Wegpunkte lassen sich nur mit der Maus umsortieren — die Anwendung wirbt aber mit Tastaturbedienung
- **Kategorie:** KANN
- **Fundstelle:** js/map-features/map-features-waypoints.js:545-570
  (`$waypoints.sortable({ handle: ".waypoint-drag-handle", … })`) und :402 (der Griff)
- **Beobachtung:** Seit dem 5. August erklären die Hinweise unter „Bedienhilfen", wie man
  die Karte mit der Tastatur bedient — Suche, Reiseziel, Verschieben, Zoomen, Ansichten,
  Ortsklassen, Route, Etappe. Das **Umsortieren der Wegpunkte** ist von der Tastatur aus
  nicht erreichbar: der Griff ist zwar ein `<button>` mit `aria-label="Zum Ändern der
  Reihenfolge ziehen"` und damit anfokussierbar, aber dahinter liegt ausschließlich
  jQuery-UI-`sortable`, das nur auf Maus und Berührung hört. In der ganzen Datei gibt es
  genau einen `keydown`-Hörer, und der sitzt am Suchfeld. Wer eine Reise über vier
  Stationen mit der Tastatur zusammenstellt, kann sie danach nicht mehr ordnen.
  Zum Ausgleich: **mit** der Maus funktioniert es tadellos — ich habe „Havena" von Platz 3
  auf Platz 2 gezogen, und die Route wurde sofort neu gerechnet.
- **Erwartet:** Zwei Tasten am fokussierten Griff (Pfeil hoch/runter verschiebt die Zeile),
  oder ein Paar ▲▼-Knöpfe wie im Abenteuer-Editor, den `docs/abenteuer-editor-ui-spec.md`
  ausdrücklich mit „manual ▲▼ reorder" beschreibt.
- **Beleg:** Quellstelle gelesen (`sortable`-Aufruf ohne jede Tastaturoption;
  `grep -n "keydown" js/map-features/map-features-waypoints.js` → nur :341, das Suchfeld).
  Griff live ausgelesen: `{tag:"BUTTON", tabindex:null, role:null,
  aria:"Zum Ändern der Reihenfolge ziehen"}`. Maus-Ziehen live geprüft:
  Felder vorher `["Gareth","Ferdok","Havena"]` (1.004,7 Meilen / 11 Etappen), nach dem Zug
  `["Gareth","Havena","Ferdok"]` (1.560,6 Meilen / 29 Etappen).
- **Sicherheit:** BELEGT
- **Aufwand:** mittel

### B15 „Abenteuer in Gareth (43)" — auf dem Schirm liegen 52 Karten
- **Kategorie:** KANN
- **Fundstelle:** js/map-features/map-features-place-extras.js:860
  (`var total = (opts.total != null) ? opts.total : (hasBeginnt ? beginnt.length : 0);`)
  und :864/:901 (die Zahl im Kopf)
- **Beobachtung:** Die Zahl im Abschnittskopf zählt **nur die Abenteuer, die hier
  beginnen**; der Streifen darunter zeigt zusätzlich alle, die hier *spielen* (die
  Spoiler-Karten). Für Gareth: Kopf „(43)", tatsächlich **52** Karten, davon 9 Spoiler —
  43 + 9 = 52. Für „Der Große Fluss": Kopf „(2)", 6 Karten, 4 Spoiler. Die Aufteilung ist
  eine bewusste Entscheidung (der Kommentar bei :861 nennt sie: „'Beginnt hier' schrumpft
  zur Zahl im Kopf", Owner 2026-07-18) — nur sagt die **Beschriftung** das nicht. Sie
  lautet „Abenteuer **in** Gareth (43)", und wer die Karten zählt, kommt auf eine andere
  Zahl und hält eine der beiden für falsch.
- **Erwartet:** Die Zahl bekommt ihr Substantiv („43 beginnen hier") oder einen `title`.
  Der Wert selbst darf bleiben, wie er ist.
- **Beleg:** Live gezählt, Infobox Gareth:
  `{head:"Abenteuer in Gareth (43)", karten:52, spoiler:9}`; Infobox „Der Große Fluss":
  `{head:"Abenteuer in Der Große Fluss (2)", karten:6, spoiler:4}`. Quellstellen gelesen.
- **Sicherheit:** BELEGT
- **Aufwand:** klein
- **Ausdrücklich geprüft und in Ordnung:** die Spoilersperre selbst ist dicht. Ich hatte
  den Verdacht, das Titelbild verrate das Abenteuer (die Dateinamen tun es:
  `niobaras-verm-chtnis.jpg`), aber die Kachel zeichnet das Bild **stark unscharf** und den
  Titel mit `visibility: hidden`. Kein Befund.

### B16 Die Wassertransporte nennen ihre Geschwindigkeit nicht, die Landtransporte schon
- **Kategorie:** KANN
- **Fundstelle:** Reiseplaner → die drei Auswahlfelder „Land / Fluss / Meer"
- **Beobachtung:** Die sechs Landmittel tragen ihr Tempo im Namen: „Karawane (3,1 Meilen/h)",
  „Zu Fuß mit leichtem Gepäck (4,1 Meilen/h)", „Pferdekutsche (5,1 Meilen/h)" … Die fünf
  Wassermittel nicht: „Flusssegler", „Flusskahn", „Lastensegler", „Schnellsegler",
  „Galeere" — ohne jede Zahl. Wer zwischen Lastensegler und Galeere wählt, hat in der Liste
  keinen Anhaltspunkt, obwohl der Unterschied erheblich ist (11,9 gegen 9,92 Meilen/h) und
  der Schnellsegler als einziger nachts durchfährt.
- **Erwartet:** Dieselbe Klammer wie bei den Landmitteln.
- **Beleg:** Optionslisten live ausgelesen (`[...select.options].map(o => o.text)`) — sechs
  Landeinträge mit Klammerwert, fünf Wassereinträge ohne. Die Zahlen stehen sehr wohl im
  Haus: das Fenster hinter dem ⓘ neben „Transportmittel" zeigt eine vollständige,
  farbcodierte Matrix Wegtyp × Transportmittel plus „Flussreise: Flusssegler 6 · Flusskahn 4"
  und „Meerreise: Lastensegler 11,9 · Schnellsegler 12,4 · Galeere 9,92" (Screenshot
  `ss_6583dlin2`).
- **Sicherheit:** BELEGT
- **Aufwand:** klein
- **Lob an derselben Stelle:** dieses Erklärfenster ist das beste Stück Dokumentation in der
  ganzen Anwendung — Matrix, Rastregeln, Querfeldein, das Steigungsmodell in Prosa und die
  Quelle („Geographia Aventurica S. 113–141"). Ich habe zwei seiner Aussagen gegengeprüft
  und beide stimmen: der Schnellsegler bringt die Rastzeit auf **0,0 Stunden**
  (Havena → Thorwal: 48,5 h Reise, 0,0 h Rast, gegen Lastensegler 50,5 / 50,5), und die
  Pass-Etappe über die Koschberge trägt ihren Steigungsvermerk mit Auf- und Abstieg.

### B17 phpMyAdmin liegt auf derselben Herkunft wie die öffentliche Karte — samt gespeicherter SQL-Entwürfe
- **Kategorie:** KANN
- **Fundstelle:** `localStorage` von `https://avesmaps.de` (36 Schlüssel); AGENTS.md §10
  führt `admin/phpMyAdmin` als „still load-bearing on the server & protected"
- **Beobachtung:** Im Speicher der öffentlichen Kartenseite liegen neben den erwarteten
  Avesmaps-Schlüsseln zwölf, die erkennbar von **phpMyAdmin** stammen:
  `autoSavedSql_dbs15599375.map_features`, `…​.political_territory_geometry`, `…​.sources`,
  `…​.lore_source`, `autoSavedSql_undefined`, `Console`, `Console/Mode`, `showThisQuery`,
  `NavigationWidth` und weitere. `autoSavedSql_*` sind **automatisch gesicherte
  SQL-Eingaben** des Administrators. Weil die Verwaltung unter derselben Herkunft läuft,
  teilt sie ihren Speicher mit jedem Skript, das auf der Kartenseite läuft.
  Ehrlich zur Tragweite: das betrifft nur den Browser, in dem der Owner phpMyAdmin benutzt
  hat, und es ist keine Lücke für sich. Es ist eine **fehlende Trennschicht**: ein einziger
  Skript-Einbruch auf der öffentlichen Seite (heute z. B. über eingebettete Fremdinhalte
  oder ein Editorfeld) könnte diese Entwürfe lesen. Nebenbei fällt auf, dass
  `autoSavedSql_dbs15599375.lore_source` noch die Tabelle nennt, die am 2026-07-22
  abgeschafft wurde — der Speicher altert nicht mit.
- **Erwartet:** Verwaltung auf eine eigene Unterdomain (`admin.avesmaps.de`) oder wenigstens
  ein Vermerk in AGENTS.md §10, dass die geteilte Herkunft bekannt und hingenommen ist.
- **Beleg:** `Object.keys(localStorage)` auf https://avesmaps.de/ ausgelesen — 36 Schlüssel,
  die zwölf oben genannten darunter. (Werte habe ich **nicht** gelesen.)
- **Sicherheit:** BELEGT (die Schlüssel existieren) · die Ausnutzbarkeit PLAUSIBEL, nicht gezeigt
- **Aufwand:** groß (Umzug) / klein (Vermerk)

### B18 Es gibt in der ganzen Anwendung keine einzige Legende — am schmerzlichsten in der politischen Ansicht
- **Kategorie:** ZUKUNFT
- **Fundstelle:** https://avesmaps.de/ → Ansicht „Politisch"
- **Beobachtung:** Die politische Ansicht zeichnet Flächenfarben je Reich, Wappen an den
  Hauptorten, gestrichelte Innengrenzen, durchgezogene Außengrenzen und eine **diagonale
  Schraffur** für umstrittene Gebiete. Nichts davon wird erklärt. Ich habe die laufende
  Seite nach Legendenelementen durchsucht (`[class*=legend], [id*=legend], [class*=legende]`)
  — **keine, in keiner Ansicht**. Für einen DSA-Spieler ist gerade die Schraffur die
  interessanteste Information auf der Karte („hier ist Streit"), und sie ist die einzige,
  die man nicht durch Anklicken herausbekommt. Dasselbe gilt für die braun/grün/grauen
  Flächen der Topographie und die Farbbänder der Klimazonen.
  Die Anwendung hat den Platz und die Bauteile dafür: die Landschaften-Ansicht trägt bereits
  ein Menüband am oberen Rand, die politische Ansicht dort eine Marke „Jahr 1049 BF".
- **Erwartet:** Ein kleiner, einklappbarer Legendenkasten je Ansicht — vier bis acht Zeilen,
  aus denselben Daten gespeist, die die Ebene ohnehin schon zeichnet.
- **Beleg:** Suche nach Legendenelementen in der laufenden Seite → 0 Treffer. Screenshot der
  politischen Ansicht (`ss_03592fwz2`) mit der Schraffur bei „Grafschaft Waldwacht" und
  fünf verschiedenen Flächenfarben, ohne jede Erklärung.
- **Sicherheit:** BELEGT
- **Aufwand:** mittel

### B19 Ein Fluss nennt seine Länge, eine Reichsstraße nicht
- **Kategorie:** ZUKUNFT
- **Fundstelle:** Infobox „Der Große Fluss" gegen Infobox „Reichsstraße 1"
- **Beobachtung:** Die Fluss-Infobox hat eine Zeile „**Länge — 1100 Meilen**". Die
  Straßen-Infobox hat sie nicht: „Reichsstraße 1" zeigt Lage, Verlauf (15 Stationen),
  Beschreibung, Führt durch, Klimazone, Quelle, Publikationen — keine Länge. Die runde Zahl
  beim Fluss legt nahe, dass sie aus dem Wiki stammt und für Straßen dort schlicht fehlt.
  Bemerkenswert ist es trotzdem, weil die Anwendung Streckenlängen **selbst rechnet** —
  jede Etappe im Reiseplan trägt ihre Meilen auf zwei Nachkommastellen. Ein Spieler, der
  wissen will „wie lang ist die Reichsstraße 1 eigentlich", bekommt vom Routenplaner eine
  Antwort und von der Infobox des Weges keine.
- **Erwartet:** Eine gerechnete Länge aus der Geometrie, erkennbar als solche
  („rund 620 Meilen, aus dem Verlauf gerechnet"), wo das Wiki nichts liefert.
- **Beleg:** Beide Infoboxen live über die Suche geöffnet und als Text ausgelesen:
  Fluss = `[…,"Länge","1100 Meilen","Verlauf",…]`, Straße = `["Reichsstraße 1","Straße",
  "Anzeigen","Link teilen","Änderungen vorschlagen","Lage",…,"Verlauf",…]` ohne Längenzeile.
- **Sicherheit:** BELEGT
- **Aufwand:** mittel

### B20 Ein Abenteuer oder Stadtplan aus der Suche landet beim Ort, ohne den Treffer zu zeigen
- **Kategorie:** ZUKUNFT
- **Fundstelle:** js/ui/spotlight-search-focus.js:60-63
  (`entry.kind === "citymap" || entry.kind === "adventure"` → `focusSpotlightPlaceEntry`)
- **Beobachtung:** Dass ein Abenteuer keinen eigenen Punkt auf der Karte hat und man deshalb
  beim zugehörigen Ort landet, ist richtig gedacht. Nur endet die Bewegung dort: der
  gesuchte Eintrag wird im Zielobjekt **nicht hervorgehoben und nicht angescrollt**.
  - Suche „Der Ruf des Berges" → Infobox „Der Große Fluss". Der Abschnitt „Abenteuer in Der
    Große Fluss" hat 6 Karten, **keine** trägt eine Auszeichnung. Bei zwei sichtbaren
    Karten findet man es; bei Gareth mit 52 Karten in einem waagerechten Streifen nicht.
  - Suche „Stadtplan von Retosgrund (Ritterburgen und Spelunken)" → Infobox „Retosgrund",
    Kartensammlung mit zwei Kacheln, **keine** hervorgehoben, **kein** Kartenfenster offen.
  Man hat also gesucht, gefunden, geklickt — und muss dann noch einmal suchen.
- **Erwartet:** Der Abschnitt wird aufgeklappt/angescrollt und die getroffene Karte kurz
  hervorgehoben; beim Stadtplan wäre auch das direkte Öffnen des Kartenfensters plausibel.
- **Beleg:** Beides live ausgeführt. Danach gemessen:
  `[...document.querySelectorAll('.avesmaps-adv__card')].filter(c => /is-active|is-highlight|
  is-focus|is-selected/.test(c.className)).length` → `0`; für die Stadtpläne
  `hervorgehobeneKarten: 0`, kein geöffnetes Kartenfenster.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

---

## Was ausdrücklich gut lief

- **Keine Konsolenfehler, über den ganzen Lauf.** Sechs Ansichten, alle vier
  Landschaften-Unterebenen, Zoom 0 bis 7, acht Routenberechnungen, fünf Deep-Links,
  Sprachwechsel, Schmalansicht — `read_console_messages{onlyErrors:true}` blieb leer.
  Die einzige Ausgabe ist die Ladezeile.
- **Kein Blau in der Bedienoberfläche.** Ich habe die laufende Seite systematisch nach
  blauen Farbwerten abgesucht (jedes sichtbare Element, `color`/`background`/Rahmen/
  `outline`/`fill`/`stroke`): Startansicht **0 Treffer**, das vollständig aufgeklappte
  Hinweise-Fenster **0 Treffer**. `color-scheme: dark` ist gesetzt, die Bildlaufleisten
  tragen Token-Farben, Kontrollkästchen sind mit `appearance: none` selbst gezeichnet
  (kein Chrome-Blau), und es gibt 112 `focus-visible`-Regeln in `css/`. Die beiden
  Ausreißer stehen oben als B3 und B4 — beides Stellen, die die Hausregel nie erreicht hat,
  nicht Schlamperei.
- **Die leeren Zustände sind sauber gebaut.** Das Dorf Retosgrund zeigt keine leeren
  Feldzeilen, sondern lässt sie weg; „Erwähnt (0)" fehlt statt dazustehen; die Bewertungen
  sagen „Noch keine Bewertungen – sei die erste Stimme!". Das ist besser gemacht als in den
  meisten Anwendungen dieser Größe.
- **Die englische Fassung ist vollständig und liebevoll.** „JOURNEY AT A GLANCE",
  „As the dragon flies" für Drachenflug, „9 legs", „Imperial road via **Reichsstraße 2**" —
  die Fachbegriffe und Namen bleiben richtigerweise deutsch, die Zahlen wechseln korrekt auf
  Dezimalpunkt (`12.0`, `998.1 miles`), der Maßstab auf „100 miles". Im Hinweise-Fenster
  mit allen acht aufgeklappten Abschnitten (92 Zeilen) blieb **kein** deutscher Rest.
  Automatische Prüfung auf abgeschnittene Beschriftungen (`scrollWidth > clientWidth` bei
  `overflow: hidden`) in der englischen Fassung: **1 Treffer**, und das ist der
  Kartencontainer selbst.
- **Die Ansichten sind in sich stimmig.** „Nur Karte" schaltet die Ortsklassen wirklich ab
  und liefert die reinen Kacheln (die Orte im Bild sind in die Kachel gemalt);
  „Original" wechselt auf die alten Kacheln (`old/…`) deckungsgleich zur stilisierten
  Fassung; „Kraftlinien" entsättigt den Untergrund, damit die Linien tragen; „Landschaften"
  bringt ein Menüband mit vier Ebenen, das barrierefrei ausgezeichnet ist (`role=tablist`,
  `role=tab`, `aria-selected`) — ebenso die Ortsklassen (`aria-pressed`).
- **Die Rechenmodelle stimmen dort, wo ich sie nachgeprüft habe.** Seefahrt Havena→Thorwal
  505,07 Meilen in 50,5 h; Wechsel auf Schnellsegler → Rastzeit 0,0 h, genau wie das
  Erklärfenster es ankündigt. Drei Wegpunkte ergeben 3 Stationen und 11 Etappen,
  Umsortieren rechnet sofort neu.
- **Deep-Links, die es gibt, funktionieren einwandfrei** (`?siedlung=`, `?staat=` mit
  Umlaut-Kodierung) und lassen die Adresszeile unangetastet, wie die URL-Policy es verlangt.

## Kleinere Beobachtungen ohne eigenen Befund

- **„Derographie" heißt zweierlei auf demselben Bildschirm:** links über dem Ansichtswähler
  („Derographie: Landschaften") und zugleich als eine der vier Landschaften-Unterebenen im
  Menüband oben. Zwei verschiedene Dinge, ein Wort, gleichzeitig sichtbar.
- **Die Marke „Jahr 1049 BF"** in der politischen Ansicht sieht wie ein Bedienelement aus
  (Kasten, Rahmen), ist aber `political-timeline--readonly`. Der Zeitregler
  (`#political-timeline-range`, `min=0 max=1049`) liegt im DOM, ist für Besucher aber
  verborgen. Wer eine Karte von 1020 BF sehen möchte, sieht den Knopf und kann ihn nicht
  drücken — dass die Zeitmaschine bewusst Editor-Sache ist, weiß er nicht.
- **„Auflösung: besteht"** in der Gebiets-Infobox liest sich wie ein Widerspruch; gemeint
  ist „nicht aufgelöst".
- **Eine Bewertung mit eigenen Anführungszeichen bekommt doppelte:**
  `„"Ich sag's euch, wie ein Keiler! …""` in der Infobox Gareth — der Rahmen setzt
  Anführungszeichen, der gespeicherte Text bringt schon welche mit.
- **Die Suche nach „Große Fluss"** liefert an erster Stelle „Der **große** Fluss — Tal"
  (kleines g) und den eigentlichen Fluss erst an dritter. Zwei Objekte, deren Namen sich nur
  in der Großschreibung unterscheiden, und das unbekanntere gewinnt. (Ergänzt B4 des
  Schnelldurchlaufs, der einen anderen Fall beschreibt.)
- **Nach `fitBounds` auf eine lange Route** steht die Karte kurz auf einer gebrochenen
  Zoomstufe (gemessen: 3,1478) und wirkt für ein bis zwei Sekunden halb ungezeichnet.
  Danach sind alle 116 Kacheln geladen und fehlerfrei — ein Übergang, kein Fehler.

## Grenzen dieses Laufs (ehrlich benannt)

- **Mein Tab war durchgehend `document.visibilityState === "hidden"`.** Folgen, die ich
  jeweils gegengeprüft habe: (a) Screenshots liefen mehrfach in 30-s-Zeitüberschreitungen,
  (b) animierte Kamerafahrten (`flyTo`/`flyToBounds`) laufen nicht zu Ende — deshalb ist in
  B7 nur das fehlende Infofenster ein Befund, nicht der ausbleibende Flug, (c) getippte
  Zeichen kamen unzuverlässig an; wo es darauf ankam, habe ich die Anwendung über ihre
  **eigenen** Einstiegspunkte gefahren (`updateMapView()`, die echten Klickpfade) und das
  Ergebnis an der Oberfläche nachgemessen. **Tastaturbefehle habe ich deshalb bewusst nicht
  geprüft** — Agent 8 hat sie belegt.
- **Das Browserfenster ist geteilt.** Seine Größe sprang während meines Laufs unaufgefordert
  zwischen 2560, 1045 und 397 px, und `resize_window` wurde mehrfach von anderen Sitzungen
  überschrieben. Die Schmalansicht (B13) habe ich deshalb im eingebetteten Rahmen gemessen;
  echte Berührungseingabe (langes Drücken) ist **nicht** geprüft.
- **Zwei Tabs musste ich schließen und neu öffnen**, weil ein `alert()` sie blockierte
  (das ist B1). Die Untersuchung lief danach in einem frischen Tab weiter.
- **Nicht geprüft:** alles hinter dem Editor, Mehrbenutzerfälle, das Kontaktformular,
  „Bewertung schreiben", „Karte vorschlagen", „Änderungen vorschlagen" (alles Schreibwege).
  Die schweren Läufe (Dump, Sync, Vorschauen, Backup, Linkchecker, Zugehörigkeit) habe ich
  **nicht angefasst**.
- **Nichts angelegt, nichts geändert, nichts gelöscht.** Kein Kurzlink, kein Bericht, keine
  Bewertung — das SPURENBUCH bleibt von mir unberührt.

## Serverzustand

Durchgehend gesund. Acht Routenberechnungen (jede unter 10 s), zwei Aufrufe der politischen
Ebene, mehrere Landschaften- und Klimazonen-Abrufe, fünf vollständige Anwendungsstarts,
ein zusätzlicher Start im eingebetteten Rahmen. Kein Timeout, kein 5xx, keine
Wiederholungsschleife, keine spürbare Verlangsamung gegen Ende. Die Feature-Zahl stieg
während meines Laufs von 11.486 (Revision 56666, Agent 8) auf 11.498 (Revision 56751) —
es wird parallel weitergearbeitet.
