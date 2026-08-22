# Kurvenbeschriftung für Landschaftsflächen

> Entwurf, 22.08.2026. Ersetzt die von Hand gesetzte Labeldrehung der Landschafts- und
> Topographieflächen durch eine berechnete Beschriftungskurve nach dem Verfahren von
> [EOX, „Curved Labels"](https://eox.at/2015/12/curved-labels/) ↗.
>
> **Prototyp: `docs/kurvenlabel-mockup.html`** (Messdaten `docs/kurvenlabel-referenzdaten.js`).
> Am 22.08.2026 vom Owner abgenommen. Er ist die Referenz für jede Frage, die dieser Text offen
> lässt — er enthält das vollständige Verfahren in lauffähigem JavaScript.
>
> 🔴 **§0 überschreibt Teile des Restes.** Alle Owner-Entscheide vom 22.08.2026 sind eingearbeitet;
> wo dieser Text eine ältere Fassung nennt, steht sie als 🪤 daneben, damit die Begründung nicht
> verloren geht.

---

## §0 Kurzfassung

Heute dreht ein Editor jedes Landschafts- und Gebirgslabel von Hand (`properties.rotation`, ein
Zahlenfeld plus Regler in der Gruppe „Darstellung" des Beschriftungsdialogs). Das Ergebnis ist eine
**Gerade in einem beliebigen Winkel**, die mit der Form der Fläche nichts zu tun hat: Drachensteine
326°, Koschberge 75°, Schwarze Sichel 297°.

Künftig läuft der Name auf der **Mittelachse der Fläche**. Zwei Einstellungen, und beide gehören der
**Region**:

* **Kurvenbeschriftung** (an/aus)
* **Maximale Anzahl der Labels** (1–3)

🔴 **Sie ersetzen das Feld „Rotation" im Beschriftungsdialog** (Owner-Entscheid, im Screenshot
markiert). Die gespeicherte Rotation bleibt in der Datenbank stehen, wird aber nicht mehr benutzt.

🔴 **Alle drei Landschaftsebenen bekommen das Feature** (Owner 22.08.2026): **Vegetation,
Derographie, Topographie.** Keine Sonderbehandlung, keine Ebene zuerst.

⭐ Und das sind genau die drei, die es brauchen können — gemessen, nicht angenommen: von **922**
Karten-Labels tragen **657** eine `ecosystem_region_public_id`, und sie verteilen sich auf
Topographie 369, Vegetation 205, Derographisch 83. **Die vierte Ebene, Klima, trägt null Labels** und
ist damit kein Sonderfall, den man abfangen müsste: ein Klimaband ist abgeleitet und darf nie als
Polygon bearbeitet werden (`avesmapsClimateAssertNotDerived`, AGENTS.md §11).

Die übrigen **265** Labels — Meere, Kontinente, Inseln, Berggipfel, Seen — behalten ihr heutiges
Verhalten; bei ihnen ist die Option **deaktiviert**, denn ohne Fläche gibt es keine Achse.

⚠️ Die 56 Flächen, die am Umstelltag eine Kurve bekommen (§8.2), sind der ANFANG, nicht das Ziel.
Owner: *„es gibt noch mehr gebiete, die das feature benötigen."* Der Haken ist dafür da, dass Editoren
ihn setzen.

---

## §1 Warum

Eine Landschaftsfläche ist fast nie ein Klecks. Sie ist ein Gebirgszug, ein Hangwald, eine Sichel —
lang, gebogen, oft in mehrere Lappen zerfallen. Eine Gerade darüberzulegen ist eine Näherung, die der
Editor jedes Mal von Hand treffen muss und die bei jeder Geometrieänderung veraltet.

Der zweite Grund ist die Wiederholung. „Östlicher Hangwald des Raschtulswalls" trägt heute **zwei**
Labels — beide mit Drehung 300° und nur 16 Karteneinheiten auseinander. Sie liegen übereinander am
Südende, weil zwei von Hand gesetzte Punkte keine Verteilung ergeben. Auf einer Kurve verteilen sich
dieselben zwei Namen über den ganzen Gürtel.

⚠️ **Der Mehrfachfall ist selten, und das ist Entwurfsgrundlage.** Von 644 Regionen mit Label tragen
**10** mehr als eines (7 mit zwei, 3 mit drei); das Maximum ist 3 — daher auch der Deckel 3 bei der
Anzahl. Die Vorgabe ist praktisch überall 1, und die Verteillogik darf sich nicht in den Normalpfad
drängen.

---

## §2 Die zwei Einstellungen

| Einstellung | Typ | Vorgabe |
|---|---|---|
| Kurvenbeschriftung | Haken | aus, ausser der Altbestand sagt anders (§8.2) |
| Maximale Anzahl der Labels | Zahl 1–3 | 1 |

🔴 **Sie gehören der REGION, nicht dem Label und nicht der Fläche** (Owner 22.08.2026: *„Ändern sich
in der Fläche oder in den Labels die (Kurvenbeschriftung + Anzahl) tut es das für alle Labels und
Flächen der Region."*). Eine Region trägt N Labels und M Flächen; der Wert existiert genau einmal.

Er erscheint an **zwei** Oberflächen und ist an beiden derselbe:

1. **Beschriftungsdialog** („Topographie-Label bearbeiten") — in der Gruppe **Darstellung**, **anstelle
   von „Rotation"**.
2. **Flächendialog** („Topographie-Fläche bearbeiten") — dieselbe Gruppe, dieselben zwei
   Bedienelemente.

💣 **Ein Wert an zwei Oberflächen: das Feld darf nur mitreisen, wenn es angefasst wurde.** Steht der
Flächendialog offen, während jemand die Einstellung am Label ändert, nimmt sein Speichern die
Änderung sonst wortlos zurück. Dieselbe Regel wie beim dritten Wiki-Zustand (AGENTS.md §11,
Wiki-Zuweisung) — und derselbe Fehler wie bei `avesmapsUpsertGameLiterature`, das jedes
MITGESCHICKTE Feld schrieb statt jedes GEÄNDERTEN (AGENTS.md §11, Wiki-Override).

⚠️ **Ohne Landschaftsfläche sind beide Bedienelemente deaktiviert** und sagen warum. Ein Meer hat
keine Fläche, aus der sich eine Achse rechnen liesse.

---

## §3 Das Verfahren

Sieben Schritte, alle im Prototyp lauffähig:

1. **Segmentieren** — den Rand jeder Teilfläche auf gleichmäßige Stützpunkte bringen.
2. **Vereinfachen** — Douglas-Peucker; auf einem geschlossenen Ring über zwei gegenüberliegende
   Anker in zwei Hälften.
3. **Triangulieren** — Delaunay nach Bowyer-Watson über die Randpunkte. Eigene Implementierung,
   rund 40 Zeilen, keine neue Abhängigkeit.
4. **Innendreiecke wählen** — Schwerpunkt *und* die drei Kantenmitten müssen im Polygon liegen
   (Löcher zählen als aussen).
5. **Mittelachse** — Chordal Axis: Knoten sind die Mittelpunkte der inneren Kanten. Ein Dreieck mit
   drei inneren Kanten ist eine Verzweigung (Stern über den Schwerpunkt), mit zwei ein Durchgang,
   mit einer eine Spitze (bis zur gegenüberliegenden Ecke).
6. **Beste Linie** — längster gewichteter Pfad im Achsengraph (zweimal Dijkstra).
7. **Glätten** — Polynomfit im Hauptachsen-Frame. Ergebnis ist von Bauart her **eine** weiche
   Biegung, kein geglätteter Zickzack. Schrift auf einem Zickzack ist unlesbar, lange bevor die
   Kurve „falsch" wäre.

Gemessene Rechenzeit an den sechs Referenzflächen: **26–104 ms** je Fläche, einmal je Geometrie.

### §3.1 Mehrteilige Flächen

💣 **Ein Gebirge ist selten EINE Fläche.** Die Koschberge liegen in zwei Lappen (59 % / 41 %); die
Mittelachse des größeren allein endet mitten in der Kette und das Label beschriftet die halbe Kette.

Deshalb werden die Mittelachsen **aller wesentlichen Teile als eine Punktwolke** genommen und **ein**
Polynom hindurchgelegt. Die Lücke zwischen zwei Lappen überbrückt die Kurve von selbst, weil sie über
die Hauptachse parametrisiert ist und nicht über die Fläche läuft.

⚠️ Das ist nur für die **Beschriftung** richtig, nicht als Geometrie: die Kurve verlässt zwischen
zwei Lappen die Fläche. Genau das tut eine Kartenbeschriftung auch.

⚠️ „Wesentlich" heißt: die größte immer, dazu jede ab **2 %** der Gesamtfläche. Ohne diese Schwelle
zieht bei „Östlicher Hangwald des Raschtulswalls" eine von **26** Streuinseln die Kurve schief (die
größte hält 73 %, wesentlich sind 4).

🔴 **„Jede Teilfläche einzeln beschriften" gibt es nicht.** Es ist die Einstellung, unter der die
Koschberge zwei gegenläufige Labels bekamen: die Lappen haben verschiedene eigene Achsen, der
Nordlappen läuft nach unten-rechts, der Südlappen nach oben-rechts — beide für sich lesbar und
trotzdem widersprüchlich. Verbunden gibt es nur eine Achse und damit eine Leserichtung.

---

## §4 Die Regeln des Owners

### §4.1 Der erste Buchstabe steht weiter links als der letzte

🔴 Die ganze Leserichtungsregel, in einem prüfbaren Satz. Owner, wörtlich: *„kannst du nicht
überprüfen ob der 1. buchstabe weiter links ist wie der letzte?"* Also `dx > 0`.

🪤 **Zwei Anläufe davor waren falsch, und der zweite ist die eigentliche Lehre.**

Der erste entschied die Leserichtung **einmal für die ganze Kurve** und liess die Stücke erben. Bei
der Schwarzen Sichel biegt die obere Hälfte zurück, erbte die Richtung der unteren und stand damit
auf dem Kopf.

Der zweite entschied pro Label, aber nach drei Regeln — Gleichlauf, „nie kopfüber", und **ein Band
von 15° um die Senkrechte**, in dem von unten nach oben gelesen wurde. 💣 **Ein Toleranzband um die
verbotene Stellung herum erlaubt die verbotene Stellung.** Gemessen an der Schwarzen Sichel: eine
Sehne von **−34 px auf 161 px Länge**, also **−102°** — zwölf Grad hinter dem Kopfstand, und genau so
sah es aus. Gefunden hat es der Owner, kein Test.

⭐ **Die Probe entscheidet, sie prüft nicht nur.** Die Sehne der *Grundlinie* und die Sehne der
*Buchstabenreihe* sind nicht dasselbe — der Name sitzt mittig auf einem etwas längeren Bogen, und bei
einer fast senkrechten Kurve entscheidet genau diese Differenz. Bei den Koschbergen sagte die
Grundlinie „passt", während die Buchstaben exakt senkrecht standen. Stimmt die Messung nicht, wird die
Grundlinie umgedreht und noch einmal gemessen.

⚠️ Die verbleibende Toleranz ist **ein Pixel** — Rundung, keine Stellung. Innerhalb davon gilt die
kartografische Gewohnheit „von unten nach oben".

Gegenprobe über alle sechs Referenzflächen, am gerenderten Text gemessen:

| Fläche | dx (px) | kopfüber |
|---|---:|---|
| Drachensteine | +159 | 0 |
| Koschberge | 0 (senkrecht, liest aufwärts) | 0 |
| Schwarze Sichel | +38 / +72 | 0 |
| Östl. Hangwald des Raschtulswalls | +75 | 0 |
| Östl. Hangwald des Finsterkamms | +213 | 0 |
| Westl. Hangwald des Raschtulswalls | +102 | 0 |

### §4.2 Die Zahl ist ein Höchstwert, kein Sollwert

Kollidieren zwei Namen derselben Region — typisch beim Herauszoomen —, wird **einer weniger** gezeigt.
Und zwar durch **Neuverteilen**, nicht durch Weglassen: der verbleibende Name säße sonst auf seiner
halben Kurve statt auf der ganzen. Der Ablauf ist eine Schleife von der eingestellten Anzahl abwärts
bis 1; die erste kollisionsfreie Belegung gewinnt.

Gemessen an der Schwarzen Sichel: bei Zoom 3 stehen zwei Namen 172 px auseinander, bei Zoom 1 bleibt
einer übrig.

### §4.3 Ohne Kurvenbeschriftung ist der Name eine ganz normale Gerade

Waagerecht, mittig, an derselben Stelle, an der sonst die Kurve läge — **nicht** die alte
Handdrehung. Die Verteilung mehrerer Namen bleibt dieselbe, nur die Grundlinie ist gerade. Eine
Gerade kann beliebig lang werden; hier kann nie etwas abgeschnitten werden.

### §4.4 Kein Umbruch, kein abgeschnittener Buchstabe

💣 **Ein `textPath` bricht nicht um und staucht nicht — er lässt Buchstaben einfach weg.** Genau so
entstand im Prototyp „CHWARZE SICHE": die Beruhigung kürzt den Bogen zur Sehne hin, und der Text war
danach ein paar Pixel zu lang. Ein fehlender erster Buchstabe sieht aus wie ein Schriftproblem und
ist ein Längenproblem.

Ist der Name länger als die Kurve, greifen drei Mittel in dieser Reihenfolge:

1. **Kurve verlängern**, tangential an beiden Enden, gedeckelt auf +30 % der Bogenlänge.
2. **Schrift verkleinern**, Untergrenze 8 px.
3. Reicht beides nicht: **doch weiter verlängern.** Abgeschnitten wird nie.

**Mittig** steht der Name immer (`startOffset="50%"` + `text-anchor="middle"`).

Vorbeugend wird das Fenster **15 % größer** angefordert, als der Name braucht, und die Passung rechnet
mit 4 % Sicherheitsrand. Ohne diesen Vorhalt liefe jedes Label ins Verlängern — und die Meldung
„Kurve verlängert" wäre kein Befund mehr, sondern Grundrauschen.

---

## §5 Zwei Regeln, die aus dem Bauen kamen

### §5.1 Das ruhigste Stück

💣 **Ein Label darf nicht dort sitzen, wo die Kurve am stärksten dreht.** Das erzeugte den verdrehten
Anfang an der Spitze der Sichel. Jeder Name sucht sich das ruhigste Stück seines Bogens (Summe der
Richtungsänderungen im Fenster) und wird danach zu seiner Sehne hin **beruhigt**, bis kein Stück mehr
als **30°** abweicht. Im Extremfall wird daraus eine Gerade — was ein Kartograf bei einem stark
geknickten Objekt auch tut.

💣 **Der Zuschlag für den Abstand zur Mitte muss stark und auf die freie Strecke normiert sein.** Mit
einem schwachen Zuschlag gewinnt bei einer gebogenen Fläche immer die Krümmung: bei der Schwarzen
Sichel liegt die ruhigste Stelle **beider** Hälften an der gemeinsamen Naht, und beide Namen
rutschten dorthin — gemessen **4 px** Abstand zwischen zwei Grundlinien, die 566 px Platz gehabt
hätten. Das sah wie eine Kollision aus und war die Fenstersuche. Mit normiertem Zuschlag: 172 px.

🪤 Wer das für eine Kollision hält und die Kollisionsschwelle nachzieht, zementiert den Fehler und
schluckt künftig stumm Labels.

### §5.2 Die Sperrung

⭐ Die Kurve erlaubt etwas, das die feste Drehung nie konnte: die **Sperrung über die Fläche ziehen**,
so dass der Name das Objekt aufspannt — die kartografische Gewohnheit bei Gebirgen und Wäldern. Bei
den Drachensteinen belegt der Name ungesperrt 13 % der Kette; gesperrt beschriftet er sie.

Nur **Sperren** (`lengthAdjust="spacing"`), nie die Glyphen strecken.

🔴 **Höchstens 50 %.** 💣 Und der Anteil allein genügt nicht: bei Zoom 7 ist die Drachenstein-Kurve
**11 246 px** lang und der Name 197 px — 20 % davon sind Buchstaben mit 50 px Abstand, die als Wort
nicht mehr lesbar sind. Gedeckelt wird zusätzlich der **Zusatz je Lücke** in Schriftgrößen; das ist
die Zahl, die man am Schirm sieht.

---

## §6 Die Kachel „Darstellung"

🔴 Owner-Entscheid 22.08.2026: die allgemeinen Kurveneinstellungen werden **nicht** einbetoniert. Sie
liegen hinter einer **neuen** Kachel **„Darstellung"** — **für Admins editierbar, für Editoren nur
lesbar.**

🔴 **Ganz rechts im Menüband von „Regionen"**, also als **siebte** Kachel in `.avm-ribbon` von
`html/landschaften-editor.html` (heute sechs: Syncen · Zugehörigkeit rechnen · Wiki zuweisen ·
Höhenraster rechnen · Wegprofile rechnen · Geländeabhängiges Reisen).

⚠️ `.avm-ribbon` ist ein Grid mit `grid-auto-columns: minmax(0, 1fr)`: eine siebte Kachel macht alle
sieben schmaler, und `.t1`/`.t2` kürzen dann mit Ellipse. Der ganze Satz gehört ins `title`.

🔴 **Kein Umzug.** Die Zoombänder bleiben, wo sie sind; „Darstellung" ist ein **neues** Fenster mit
eigenem Inhalt. Der bestehende Knopf **„Zoombänder" unter „Orte" wird künftig ebenfalls „Darstellung"
heißen** — gleiche Beschriftung, gleiches Rechtemodell, zwei getrennte Fenster für zwei
Gegenstandsbereiche.

⚠️ Damit heissen zwei Kacheln gleich und zeigen Verschiedenes. Das ist gewollt: der Ort sagt, worum
es geht (unter „Orte" die Orte, unter „Regionen" die Regionen). Die `title`-Zeile muss es trotzdem
aussprechen, sonst ist es eine Falle für den Editor.

🔧 **„Darstellung" ist der Sammelplatz** (Owner): weitere Einstellungen zur Darstellung von Regionen
kommen dazu. Eine spätere Regulierung der Zoombänder ist absehbar, aber erst *„wenn die Editoren
irgendwann fertig werden und halbwegs absehbar ist, wie die Labeldichte sein wird"* — dieser Entwurf
nimmt davon nichts vorweg.

⭐ **Das Rechte- und Ablagemuster wird von den „Zoombändern" abgeschrieben, nicht neu erfunden**
(AGENTS.md §11):

* Ablage in **einem** `app_setting`-Schlüssel (plus `_stamp`).
* Schreiben mit Fähigkeit `admin`, Ansehen mit `edit`.
* Öffentlicher Leser fällt **offen** aus: jeder Fehler ⇒ Vorgabe, **kein DDL** im Lesepfad.
* 💣 Der Schreibvorgang **liest zurück** — dieselbe stille MySQL-Kürzung, an der der Speichern-Knopf
  der Tempowerte wochenlang nichts tat (AGENTS.md §10).
* **Zurücksetzen löscht die Zeile**, statt eine Kopie der Vorgabe zu hinterlassen (die veraltete
  sonst).
* Die **Vorgabewerte stehen an genau einer Stelle** im Frontend-Modul, geteilt von Karte und Fenster.

### §6.1 Die einstellbaren Werte

| Wert | Vorgabe | Wirkung |
|---|---|---|
| Glättung | Polynom Grad 3 | Form der Kurve |
| Begradigung | 0 % | Mischung Kurve ↔ Sehne |
| Randvereinfachung | 1,55 | Douglas-Peucker-Toleranz in Karteneinheiten |
| Stützpunktabstand | 0,30 | Segmentierung des Randes |
| Teilfläche zählt ab | 2 % der Gesamtfläche | welche Lappen die Kurve mitbestimmen |
| max. Verdrehung gegen die Sehne | 30° | Beruhigung (§5.1) |
| Kurve verlängern höchstens | 30 % | Passung, Mittel 1 (§4.4) |
| Sperrung über die Fläche | 20 % | Deckel 50 % (§5.2) |
| Sperrung höchstens je Lücke | 0,6 Schriftgrößen | absoluter Deckel |
| Mindestabstand zweier Namen | 2,0 Schriftgrößen | Kollisionsabbau (§4.2) |
| Ausweichweg eines Kurvenlabels | 6 px | Kollisionsvermeidung (§7.2) |
| Schrift verkleinern bis es passt | an | Passung, Mittel 2 |

⚠️ **Mindestabstand und Ausweichweg sind an sechs Flächen geraten, nicht an 644 gemessen.** Genau
deshalb stehen sie in der einstellbaren Tafel und nicht in einer Konstante. 🔴 **Sie werden nach dem
Bau gemeinsam nachgesehen** (Owner 22.08.2026: *„wir können auch nochmal alle anschauen, wenn du
implementiert hast"*) — an allen Flächen, nicht an den sechs. Das ist Teil der Abnahme, nicht eine
Absicht für später.

---

## §7 Einbau in die Karte

### §7.1 Die Kurve kommt vom SERVER

🔴 **Die tragende Architekturentscheidung, und sie ist nicht frei.** Die Flächengeometrie liegt beim
normalen Besucher **nicht** im Browser: `api/app/ecosystem-areas.php` wird nur geladen, *„wenn jemand
die Landschaftsebene betritt"* (so steht es wörtlich in
`js/map-features/map-features-ecosystem-loader.js`). Gemessen: **1,6 MB** Vegetation und **1,4 MB**
Topographie. Die Kurve im Browser zu rechnen hiesse, diese Last jedem Besucher aufzuladen, um sechs
Wörter zu drehen.

Also rechnet der **Server**, einmal je Flächengeometrie; die fertige Kurve reist im
`map-features`-Payload am Label mit.

* **Kosten:** eine Kurve mit 32 Punkten ist rund **433 Byte** JSON; ×657 = **278 KB roh**, vor gzip.
  Koordinaten auf drei Nachkommastellen runden — die Quelle hat nicht mehr Aussagekraft.
  ⭐ Tatsächlich fällt weniger an: nur Regionen mit eingeschalteter Kurvenbeschriftung brauchen eine,
  am Umstelltag also **56** (§8.2).
* **Zwischenspeicher:** die Kurve hängt an der Geometrie, nicht am Zoom. Ablage an der Fläche,
  gebunden an `geometry_revision`; ändert sich die Fläche, verfällt sie.
* 💣 **`AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION` muss hoch.** Der ETag ist revisionsbasiert; ohne Bump
  behält ein warmer Client den alten Rumpf über 304 und sieht nie eine Kurve.
* ⚠️ **Nicht in einem Lauf über alle Regionen im Lesepfad.** STRATO, AGENTS.md §9. Die Berechnung
  gehört in den Schreibpfad (beim Speichern der Geometrie) plus einen Owner-ausgelösten Sammellauf.

⚠️ **Damit gibt es das Verfahren zweimal**: in PHP für die Auslieferung und im Prototyp in
JavaScript. Der Prototyp ist ein Dokument, kein Produktionspfad — **der Bauplan muss die PHP-Fassung
an den sechs Referenzflächen gegen die gemessenen Zahlen dieses Entwurfs prüfen.**

### §7.2 Kollision mit fremden Labels

Heute misst `resolveLabelCollisions` je Label **ein** Rechteck (`getBoundingClientRect()` des
Canvas-`<img>`), reicht es an den reinen Rechtenlöser `avesmapsResolveLabelPlacements`
(`label-placement.js`) und verschiebt das Label per `--label-offset-x/y` auf einen von zwölf
Kandidaten — oder blendet es aus (`is-colliding`).

Für eine Kurve passt davon nichts: ein gebogenes Label hat **kein** Rechteck, und es auf einen der
zwölf Kandidaten zu schieben widerspricht seinem Sinn.

🔴 **Ein Kurvenlabel belegt — und darf dabei ein paar Pixel ausweichen** (Owner 22.08.2026: *„versuch
die kurven verschiebung bis zu ein paar einheiten/pixel in die kollisionsvermeidung aufzunehmen"*).
Konkret:

1. Es geht als **mehrere kleine Rechtecke entlang seiner Grundlinie** in die Belegung ein — nicht als
   eine Hüllbox. Dafür gibt es den vorhandenen Weg: `resolveLabelCollisions(regionLabelRects)` nimmt
   schon heute Vorbelegungen entgegen, und die Endlage landet anschliessend in
   `map-features-label-occupancy.js` für die Weg- und Flussnamen. **Es wird kein zweites
   Kollisionssystem gebaut.**
2. Es bekommt einen **kleinen Ausweichweg**: Verschieben **entlang der eigenen Kurve** um bis zu
   `Ausweichweg` (Vorgabe 6 px), in kleinen Schritten, plus wahlweise denselben Betrag quer. Entlang
   der Kurve zuerst — dort bleibt der Name auf seiner Fläche und behält Krümmung und Leserichtung.
   Quer verlässt er die Achse und ist die zweite Wahl.
3. Bringt das nichts, **weicht das Kurvenlabel nicht weiter aus.** Es sitzt auf seiner Fläche; das
   fremde Label muss ausweichen oder verschwinden — wie heute bei den Gebietsnamen.

⭐ Nebenbei ist Punkt 1 **besser als heute**: ein um 297° gedrehtes `<img>` liefert
`getBoundingClientRect()` schon jetzt eine stark aufgeblähte achsenparallele Hülle. Mehrere kleine
Rechtecke entlang der Schrift sind die genauere Aussage.

🔴 **Die Ordnung wird gemessen und dann vermutlich gelassen** (Owner 22.08.2026). Kurvenlabels sind
am Ende unverdrängbar und drängen damit Ortsnamen weg, die heute gewinnen könnten — wie oft das
vorkommt, gehört gemessen, bevor jemand daran dreht. ⚠️ **An der Prioritätenordnung wird in diesem
Vorhaben nichts geändert:** eine globale Prioritäten-Entscheidung kommt mit der vollständigen
Überarbeitung der Kollisionen, und sie hier vorwegzunehmen hiesse, dieselbe Frage zweimal und
verschieden zu beantworten.

### §7.3 Zeichnen

🔴 **Canvas** (Owner-Entscheid 22.08.2026). Die Karte zeichnet Labels als Canvas-Bild in einem
`L.divIcon` (`renderMapLabelToImage`), damit die Schrift „in die gemalte Karte einsinkt"; zwei
Schriftbilder nebeneinander würden auffallen. Der Prototyp zeichnet SVG-`<textPath>` — das ist eine
Eigenschaft des Prototyps, kein Vorschlag.

Damit ist Glyphe für Glyphe zu setzen: Position aus der Bogenlänge, Drehung aus der Tangente,
Sperrung als Zuschlag je Lücke. Halo und Kapitälchen kommen unverändert aus `renderMapLabelToImage`.

💣 **Und die Leserichtungsprobe aus §4.1 muss dann selbst gerechnet werden.** Im Prototyp liefert sie
der Browser (`getStartPositionOfChar`); auf dem Canvas gibt es niemanden, der antwortet. Sie ist
genau die Zusicherung, die zweimal danebengegangen ist — sie darf nicht mit dem Zeichenweg verloren
gehen, sondern wird über die gesetzten Glyphenpositionen gerechnet: **die x-Lage der ersten Glyphe
gegen die x-Lage der letzten.** ⭐ Das ist auf dem Canvas sogar leichter als im SVG, weil die
Positionen ohnehin selbst berechnet werden — sie müssen nur verglichen werden.

### §7.4 Bearbeiten-Modus

Ein Label ist heute mit der Maus verschiebbar (`body.edit-mode .map-label`).

🔴 **Ein Kurvenlabel richtet sich neu aus, sobald die Bearbeitung abgeschlossen ist** (Owner
22.08.2026). Es bleibt also nicht liegen, wo man es hinzieht: mit dem Ende der Bearbeitung wird die
Kurve aus der Fläche neu abgeleitet und der Name darauf neu gesetzt.

Das gilt für **beide** Bearbeitungen, und das ist der Punkt:

* nach einem **Zug am Label** — die gezogene Lage wird nicht gespeichert;
* nach einer **Änderung der Flächengeometrie** — die Kurve ist danach eine andere, also auch die Lage
  des Namens.

⚠️ Neu ausgerichtet wird am **Ende**, nicht während des Ziehens. Ein Label, das unter dem Zeiger
zurückspringt, sieht kaputt aus; eines, das sich beim Loslassen setzt, sieht nach Regel aus.

⚠️ Der Zeiger muss es vorher sagen: kein `cursor: move` an einem Kurvenlabel.

---

## §8 Datenmodell

🔴 **Kein DDL, keine Migration, nichts wird gelöscht.**

| Was | Wo | Bemerkung |
|---|---|---|
| Kurvenbeschriftung an/aus | `ecosystem_region.properties_json` | ⭐ die Spalte **gibt es bereits** |
| Maximale Anzahl der Labels (1–3) | dieselbe Spalte | ein Wert je Region |
| Darstellungseinstellung | `app_setting` (§6) | wie `location_zoom_bands` |
| Berechnete Kurve | an der Fläche, gebunden an `geometry_revision` | Zwischenspeicher, neu rechenbar |

⭐ **`ecosystem_region` trägt schon ein `properties_json JSON NULL`** (`api/_internal/app/ecosystem.php`).
Die Einstellung braucht damit weder eine neue Tabelle noch eine neue Spalte — und sie liegt genau
dort, wo die Owner-Regel sie verlangt: an der Region, für alle ihre Labels und Flächen zugleich.

💣 **`properties.rotation` bleibt stehen und wird nicht angefasst — sie ist NICHT der Rückweg des
Hakens.** „Kurvenbeschriftung aus" heisst *gerade*, nicht *alte Drehung* (§4.3); der gespeicherte
Winkel hat keine Wirkung mehr. Erhalten bleibt er, weil der Rückbau des ganzen Features ihn sonst
nicht wiederherstellen könnte und der Deploy nie löscht (AGENTS.md §10). ⚠️ Wer ihn „aufräumt", nimmt
dem Feature seinen einzigen Rückweg.

### §8.1 Die zusätzlichen Labelzeilen

💣 **Sie werden NICHT gelöscht.** Die zehn Regionen mit mehr als einem Label behalten ihre Zeilen.
Solange die Kurvenbeschriftung an ist, zeichnet die Karte die eingestellte Anzahl und nimmt Text,
Größe, Zoomband, Priorität und Wiki-Zuweisung vom **primären** Label
(`ecosystem_region.label_public_id`). Eine gelöschte Zeile nähme eine Wiki-Zuweisung mit, und das
wäre unumkehrbar.

⚠️ **`show_name`, `min_zoom`/`max_zoom`, `priority` und die Wiki-Zuweisung bleiben unverändert
wirksam.** Ein Label, das heute erst ab Zoom 4 erscheint, erscheint auch künftig erst ab Zoom 4.

### §8.2 Der Umstellzustand — aus den Daten, nicht geraten

🔴 Owner-Entscheid: *„Alle Flächen, die jetzt über eine Rotation != 0 verfügen sollen automatisch ein
(also Anzahl = 1) Kurvenlabel erhalten."*

Am Livebestand gemessen (22.08.2026):

| | Labels |
|---|---:|
| an einer Landschaftsfläche | 657 |
| davon **Rotation ≠ 0** → Kurve an | **56** (Topographie 40, Vegetation 15, Derographisch 1) |
| davon Rotation = 0 → unverändert | 601 |

⭐ **Die Regel ist widerspruchsfrei.** Von den 10 Regionen mit mehreren Labels ist **keine einzige**
gemischt gedreht — es gibt keine Region, in der ein Label gedreht und ein anderes ungedreht wäre. Die
Zuordnung „Region ⇒ Kurve an" ist damit eindeutig, obwohl der Wert an der Region hängt und die
Drehung am Label.

⭐ Und der Rest bewegt sich nicht: ein Label mit Rotation 0 zeigt heute eine waagerechte Gerade — und
genau die zeigt es mit ausgeschalteter Kurvenbeschriftung weiterhin (§4.3). **601 Labels ändern sich
am Umstelltag nicht um ein Pixel.**

💣 **Der Winkel muss modulo 360 geprüft werden, nicht auf „ungleich 0".** Von den 83 derographischen
Labels ist genau **eines** gedreht: „Weiden" mit **360°** — sichtbar identisch mit 0°, numerisch
verschieden. Roh geprüft schaltet die Regel dort eine Kurve ein, wo heute nichts gedreht ist und
niemand etwas gedreht haben wollte. Also: `((r % 360) + 360) % 360 !== 0`. ⚠️ Dieselbe Normalisierung
benutzt der Zeichner heute schon (`createLabelIcon`) — die Umstellregel muss sie mitbenutzen, sonst
widersprechen sich zwei Stellen über denselben Wert.

⚠️ **Damit bekommt die Derographie am Umstelltag null Kurven** (55 statt 56 Labels). Das ist kein
Fehler und kein Widerspruch zu „alle drei Ebenen bekommen das Feature": die Ebene *hat* es, es hat
dort nur noch niemand eingeschaltet. Ihre Namen — „Streitende Königreiche", „Albernia",
„Nordmarken" — sind Herrschaftsräume, keine gebogenen Ketten; ob sie eine Kurve wollen, entscheidet
ein Editor, nicht der Altbestand.

🔴 **Anzahl 1 — ausser bei fünf Regionen, die heute zwei Labels tragen: dort 2** (Owner-Entscheid
22.08.2026). Es sind Finsterkamm (317°/325°), Raschtulswall (304°/304°), Regengebirge (304°/290°),
Große Olochtai (310°/355°) und Östlicher Hangwald des Raschtulswalls (300°/300°). Auf 1 gesetzt
verlören sie einen Namen; auf 2 verteilen sich die beiden endlich über die Fläche (§1).

⚠️ Die Regel für den Einmal-Lauf lautet damit nicht „Anzahl = 1", sondern **„Anzahl = Zahl der
vorhandenen Labels dieser Region, gedeckelt auf 3"**. Für 51 der 56 ergibt das 1, für die fünf 2 —
und sie kommt ohne eine Liste von fünf Namen im Code aus, die beim nächsten neuen Label falsch wäre.

---

## §9 Abnahme

Nicht Maße, sondern Handgriffe (AGENTS.md §9):

1. Auf der **Live-Karte** die sechs Referenzflächen anfahren und die Namen ansehen — Zoom 2, 4, 7.
2. **Herauszoomen**, bis bei „Östlicher Hangwald des Raschtulswalls" der zweite Name verschwindet;
   prüfen, dass der verbleibende auf der **ganzen** Kurve sitzt und nicht auf seiner Hälfte.
3. Im **Beschriftungsdialog** einer Fläche den Haken ausschalten → der Name wird eine Gerade; wieder
   einschalten → er ist zurück auf der Kurve. Das Feld „Rotation" ist weg.
4. Denselben Wert im **Flächendialog** öffnen: er zeigt denselben Stand. Dort ändern, Beschriftungs­
   dialog öffnen — der Stand ist mitgewandert.
5. 💣 **Beide Dialoge gleichzeitig offen:** in einem ändern und speichern, dann den anderen
   **unverändert** speichern. Die Änderung muss stehen bleiben (§2).
6. Die **maximale Anzahl** von 1 auf 3 stellen und zurück.
7. Ein Label **ohne** Fläche öffnen (ein Meer, ein Berggipfel): beide Bedienelemente deaktiviert, mit
   Begründung.
8. 🪤 Eine **derographische** Fläche anfassen — unter den sechs Referenzflächen ist keine, sie decken
   nur Topographie und Vegetation ab. „Albernia" oder „Nordmarken" nehmen, Haken setzen, ansehen.
   Eine Ebene, die im Entwurf nur als Zahl vorkommt, ist nicht abgenommen.
9. Im Bearbeiten-Modus **an einem Kurvenlabel ziehen** und loslassen: es richtet sich neu aus, die
   gezogene Lage wird nicht gespeichert — und es springt erst beim Loslassen, nicht unter dem Zeiger
   (§7.4).
10. Die **Flächengeometrie ändern** und speichern: die Kurve ist danach eine andere, der Name sitzt
    neu (§7.4).
11. Als **Editor** (nicht Admin) die Kachel „Darstellung" öffnen: Werte sichtbar, Speichern gesperrt.
12. Als **Admin** einen Wert ändern, speichern, neu laden, **zurücklesen** — steht er wirklich da?
13. Prüfen, dass an **keinem** der Namen ein Buchstabe fehlt und keiner kopfsteht.
14. **Mindestabstand und Ausweichweg an allen Flächen nachsehen**, nicht an den sechs (§6.1) — der
    Owner sieht sie gemeinsam mit durch.

Automatisch zu wachen:

* Leserichtung: für jedes gerenderte Kurvenlabel `dx > −1 px`.
* Passung: `Textbreite ≤ Bogenlänge` — kein abgeschnittener Buchstabe.
* Die PHP-Kurve gegen die sechs gemessenen Bogenlängen dieses Entwurfs.
* Die Region-Synchronität: ein Schreibweg, der die Einstellung setzt, setzt sie für **alle** Labels
  und Flächen der Region — und ein Schreibweg, der sie nicht anfasst, ändert sie nicht.
* 🪤 Die Fixture muss die **gemischten** Fälle enthalten: eine einteilige Fläche (Drachensteine), eine
  zweilappige (Koschberge), eine mit 26 Teilen (Raschtulswall) und eine Region mit zwei Labels. Eine
  homogene Fixture fängt den gemischten Fall nie.

---

## §10 Nicht in dieser Fassung

* Weitere Regionen-Darstellungswerte in der Kachel „Darstellung" (§6) — sie kommen, aber später.
* Regulierung der Zoombänder durch dieselbe Kachel (Owner: erst, wenn die Labeldichte absehbar ist).
* Kurvenbeschriftung für Labels ohne Landschaftsfläche — die Option ist dort deaktiviert (§2).
* Eine Verteilung „so oft wie der Name passt": die maximale Anzahl ist ein Editorwert mit Deckel 3, kein
  Rechenergebnis.

---

## §11 Bauteile (erwartet)

| Datei | Rolle |
|---|---|
| `api/_internal/app/curve-labels.php` | das Verfahren §3, serverseitig |
| `api/app/map-features.php` | Kurve am Label ausliefern, `PAYLOAD_VERSION` hoch |
| `api/_internal/app/ecosystem.php` | die zwei Werte in `ecosystem_region.properties_json` |
| `api/_internal/app/curve-label-settings.php` | Lesen/Schreiben der Darstellungseinstellung |
| `api/app/curve-label-settings.php` | öffentlicher Leser, fällt offen aus |
| `api/edit/map/curve-label-settings.php` | Schreiben, Fähigkeit `admin` |
| `js/map-features/curve-label-defaults.js` | die **einzige** Quelle der Vorgabewerte |
| `js/map-features/map-features-labels.js` | Zeichnen (§7.3), Leserichtungsprobe, Passung |
| `js/map-features/map-features-label-collisions.js` | Belegung + Ausweichweg (§7.2) |
| `html/landschaften-editor.html` | siebte Kachel „Darstellung" + Fenster (§6) |
| `html/wiki-sync-settlement-editor.html` | Knopf „Zoombänder" heisst künftig „Darstellung" |
| `index.html` | Beschriftungsdialog: „Rotation" raus, zwei Bedienelemente rein |
| `js/review/review-labels.js` | Schreibweg des Beschriftungsdialogs |
| `js/map-features/map-features-ecosystem-properties.js` | dieselben zwei Bedienelemente im Flächendialog |
| `docs/kurvenlabel-mockup.html` | der abgenommene Prototyp — bleibt als Referenz stehen |

---

## §12 Entschieden am 22.08.2026

Der Entwurf hat keine offenen Entscheidungen mehr. Die fünf, die er hatte, sind beantwortet:

1. **Zeichnen: Canvas** (§7.3) — mit der Auflage, die Leserichtungsprobe selbst zu rechnen.
2. **Die fünf gedrehten Regionen mit zwei Labels bekommen 2** (§8.2) — als Regel „so viele Labels wie
   vorhanden, höchstens 3", nicht als Namensliste im Code.
3. **Ordnung der Kollision: messen, vermutlich lassen** (§7.2). Die globale
   Prioritäten-Entscheidung gehört zur vollständigen Überarbeitung der Kollisionen und wird hier
   nicht vorweggenommen.
4. **Bearbeiten-Modus: neu ausrichten, sobald die Bearbeitung abgeschlossen ist** (§7.4).
5. **Mindestabstand und Ausweichweg werden nach dem Bau an allen Flächen nachgesehen** (§6.1), nicht
   an den sechs Referenzflächen. Das ist Teil der Abnahme.

Was bleibt, sind **Messungen**, keine Fragen:

* die Ordnung der Kollision am Livebestand (§7.2),
* die zwei geratenen Werte an allen Flächen (§6.1),
* die PHP-Kurve gegen die sechs gemessenen Bogenlängen (§9).
