# Kurvenbeschriftung für Landschaftsflächen

> Entwurf, 22.08.2026. Ersetzt die von Hand gesetzte Labeldrehung der Landschafts- und
> Topographieflächen durch eine berechnete Beschriftungskurve nach dem Verfahren von
> [EOX, „Curved Labels"](https://eox.at/2015/12/curved-labels/) ↗.
>
> **Prototyp: `docs/kurvenlabel-mockup.html`** (Messdaten `docs/kurvenlabel-referenzdaten.js`).
> Er ist am 22.08.2026 vom Owner abgenommen worden und ist die Referenz für jede Frage, die dieser
> Text offen lässt — er enthält das vollständige Verfahren in lauffähigem JavaScript.

---

## §0 Kurzfassung — was sich ändert

Heute dreht ein Editor jedes Landschafts- und Gebirgslabel von Hand (`properties.rotation`, ein
Zahlenfeld plus Regler im Beschriftungsdialog). Das Ergebnis ist eine **Gerade in einem beliebigen
Winkel**, die mit der Form der Fläche nichts zu tun hat: bei den Drachensteinen 326°, bei den
Koschbergen 75°, bei der Schwarzen Sichel 297°.

Künftig läuft der Name auf der **Mittelachse der Fläche**. Der Editor stellt nur noch zwei Dinge ein,
**je Fläche**:

* **Kurvenbeschriftung** (an/aus)
* **Maximale Anzahl der Labels**

Alles andere — Glättung, Passung, Leserichtung, Sperrung, Kollisionsabbau — ist eine
Darstellungseinstellung, die **ein Admin zentral pflegt** und ein Editor ansehen kann (§6).

🔴 **Betroffen sind nur Labels, die an einer Landschaftsfläche hängen.** Am Livebestand gemessen
(22.08.2026): von **922** Karten-Labels tragen **657** eine `ecosystem_region_public_id`
(Topographie 369, Vegetation 205, Derographisch 83). Die übrigen 265 — Meere, Kontinente, Inseln,
Berggipfel, Seen — behalten ihr heutiges Verhalten unverändert. Sie haben keine Fläche, aus der sich
eine Achse rechnen liesse.

---

## §1 Warum

Eine Landschaftsfläche ist fast nie ein Klecks. Sie ist ein Gebirgszug, ein Hangwald, eine Sichel —
lang, gebogen, oft in mehrere Lappen zerfallen. Eine Gerade darüberzulegen ist eine Näherung, die der
Editor jedes Mal von Hand neu treffen muss und die bei jeder Geometrieänderung veraltet.

Der zweite Grund ist die Wiederholung. „Östlicher Hangwald des Raschtulswalls" trägt heute **zwei**
Labels — beide mit derselben Drehung 300° und nur 16 Karteneinheiten auseinander. Sie liegen
übereinander am Südende des Waldgürtels, weil zwei von Hand gesetzte Punkte nun einmal keine
Verteilung ergeben. Auf einer Kurve verteilen sich dieselben zwei Namen über den ganzen Gürtel.

⚠️ **Der Mehrfachfall ist selten und das ist eine Entwurfsgrundlage, kein Nebensatz.** Von 644
Regionen mit Label tragen **10** mehr als eines (7 mit zwei, 3 mit drei); das Maximum ist 3. Die
Vorgabe für „Maximale Anzahl" ist also praktisch überall **1**, und die Verteillogik ist ein
Sonderfall, der sich nicht in den Normalpfad drängen darf.

---

## §2 Was der Editor sieht

Genau zwei Bedienelemente, im Beschriftungsdialog der Fläche:

| Bedienelement | Typ | Vorgabe |
|---|---|---|
| Kurvenbeschriftung | Haken | siehe §8.1 — der Auslieferungszustand ist eine offene Owner-Entscheidung |
| Maximale Anzahl der Labels | Zahl 1–6 | Anzahl der heute vorhandenen Labels der Fläche (praktisch überall 1) |

🔴 **Mehr nicht.** Owner-Entscheid vom 22.08.2026: *„später will ich, dass die editoren nur 2 optionen
haben"*. Ein Regler, der beim Finden der richtigen Werte gebraucht wurde, gehört deshalb nicht in den
Editor — sechs Editoren stellten sonst sechs verschiedene Werte ein und die Karte hätte kein
einheitliches Bild mehr. Er gehört in die Darstellungseinstellung (§6).

🔴 **Das Feld „Rotation" bleibt im Dialog, wird aber inert, solange die Kurvenbeschriftung an ist** —
und sagt das auch. Ein sichtbares Bedienelement, das nichts tut, ist schlimmer als ein fehlendes.

---

## §3 Das Verfahren

Sieben Schritte, alle im Prototyp lauffähig:

1. **Segmentieren** — den Rand jeder Teilfläche auf gleichmäßige Stützpunkte bringen
   (`densifyRing`).
2. **Vereinfachen** — Douglas-Peucker, auf einem geschlossenen Ring über zwei gegenüberliegende
   Anker in zwei Hälften (`simplifyRing`).
3. **Triangulieren** — Delaunay nach Bowyer-Watson über die Randpunkte (`delaunay`). Eigene
   Implementierung, rund 40 Zeilen; keine neue Abhängigkeit.
4. **Innendreiecke wählen** — Schwerpunkt *und* die drei Kantenmitten müssen im Polygon liegen
   (Löcher zählen als aussen).
5. **Mittelachse** — Chordal Axis: Knoten sind die Mittelpunkte der inneren Kanten. Ein Dreieck mit
   drei inneren Kanten ist eine Verzweigung (Stern über den Schwerpunkt), mit zwei ein Durchgang, mit
   einer eine Spitze (bis zur gegenüberliegenden Ecke).
6. **Beste Linie** — längster gewichteter Pfad im Achsengraph (zweimal Dijkstra).
7. **Glätten** — Polynomfit im Hauptachsen-Frame. Ergebnis ist von Bauart her **eine** weiche
   Biegung, kein geglätteter Zickzack. Schrift auf einem Zickzack ist unlesbar, lange bevor die
   Kurve „falsch" wäre.

Gemessene Rechenzeit an den sechs Referenzflächen: **26–104 ms** je Fläche, einmal je Geometrie.

### §3.1 Mehrteilige Flächen

💣 **Ein Gebirge ist selten EINE Fläche.** Die Koschberge liegen in zwei Lappen (59 % / 41 %); die
Mittelachse des größeren allein endet mitten in der Kette und das Label beschriftet die halbe Kette.

Deshalb werden die Mittelachsen **aller wesentlichen Teile als eine Punktwolke** genommen und **ein**
Polynom hindurchgelegt (`polyFitSpanning`). Die Lücke zwischen zwei Lappen überbrückt die Kurve von
selbst, weil sie über die Hauptachse parametrisiert ist und nicht über die Fläche läuft.

⚠️ Das ist bewusst nur für die **Beschriftung** richtig, nicht als Geometrie: die Kurve verlässt
zwischen zwei Lappen die Fläche. Genau das tut eine Kartenbeschriftung auch.

⚠️ „Wesentlich" heißt: die größte immer, dazu jede ab **2 %** der Gesamtfläche. Ohne diese Schwelle
zieht bei „Östlicher Hangwald des Raschtulswalls" eine von **26** Streuinseln die gemeinsame Kurve
schief (die größte hält 73 %, wesentlich sind 4).

🔴 **„Jede Teilfläche einzeln beschriften" fällt raus.** Es ist die Einstellung, unter der die
Koschberge zwei gegenläufige Labels bekamen: die Lappen haben verschiedene eigene Achsen, der
Nordlappen läuft nach unten-rechts, der Südlappen nach oben-rechts — beide für sich lesbar und
trotzdem widersprüchlich. Verbunden gibt es nur eine Achse und damit nur eine Leserichtung.

---

## §4 Die vier Regeln des Owners

### §4.1 Der erste Buchstabe steht weiter links als der letzte

🔴 Die ganze Leserichtungsregel, in einem prüfbaren Satz. Owner, wörtlich: *„kannst du nicht
überprüfen ob der 1. buchstabe weiter links ist wie der letzte?"* Also `dx > 0`.

🪤 **Zwei Anläufe davor waren falsch, und der zweite ist die eigentliche Lehre.**

Der erste entschied die Leserichtung **einmal für die ganze Kurve** und liess die Stücke erben. Bei
der Schwarzen Sichel biegt die obere Hälfte zurück, erbte die Richtung der unteren und stand damit
auf dem Kopf.

Der zweite entschied pro Label, aber nach drei Regeln — Gleichlauf, „nie kopfüber", und **ein Band von
15° um die Senkrechte**, in dem von unten nach oben gelesen wurde. 💣 **Ein Toleranzband um die
verbotene Stellung herum erlaubt die verbotene Stellung.** Gemessen an der Schwarzen Sichel: eine
Sehne von **−34 px auf 161 px Länge**, also **−102°** — zwölf Grad hinter dem Kopfstand, und genau so
sah es aus. Gefunden hat es der Owner, kein Test.

⭐ **Und die Probe entscheidet, sie prüft nicht nur.** Die Sehne der *Grundlinie* und die Sehne der
*Buchstabenreihe* sind nicht dasselbe — der Name sitzt mittig auf einem etwas längeren Bogen, und bei
einer fast senkrechten Kurve entscheidet genau diese Differenz. Bei den Koschbergen sagte die
Grundlinie „passt", während die Buchstaben exakt senkrecht standen. Nach dem Zeichnen wird deshalb
`getStartPositionOfChar(0)` gegen `getEndPositionOfChar(letzter)` gemessen; stimmt es nicht, wird die
Grundlinie umgedreht und noch einmal gemessen.

⚠️ Die verbleibende Toleranz ist **ein Pixel** — das ist Rundung, keine Stellung. Innerhalb davon
gilt die kartografische Gewohnheit „von unten nach oben".

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

Kollidieren zwei Namen — typisch beim Herauszoomen —, wird **einer weniger** gezeigt. Und zwar durch
**Neuverteilen**, nicht durch Weglassen: der verbleibende Name säße sonst auf seiner halben Kurve
statt auf der ganzen. Der Ablauf ist eine Schleife von `max` abwärts bis 1; die erste kollisionsfreie
Belegung gewinnt.

Gemessen an der Schwarzen Sichel: bei Zoom 3 stehen zwei Namen 172 px auseinander, bei Zoom 1 bleibt
einer übrig.

⚠️ Geprüft wird die Kollision **innerhalb einer Fläche**. Gegen fremde Labels gilt die bestehende
Kollisionsauflösung — siehe §7.2, das ist der schwierigste Teil des Einbaus.

### §4.3 Ohne Kurvenbeschriftung ist der Name eine ganz normale Gerade

Waagerecht, mittig, an derselben Stelle, an der sonst die Kurve läge — **nicht** die heutige
Handdrehung, die soll ja gerade wegfallen. Die Verteilung mehrerer Namen bleibt dieselbe, nur die
Grundlinie ist gerade. Eine Gerade kann beliebig lang werden; hier kann also nie etwas abgeschnitten
werden.

### §4.4 Kein Umbruch, kein abgeschnittener Buchstabe

💣 **Ein `textPath` bricht nicht um und staucht nicht — er lässt Buchstaben einfach weg.** Genau so
entstand im Prototyp „CHWARZE SICHE": die Beruhigung kürzt den Bogen zur Sehne hin, und der Text war
danach ein paar Pixel zu lang. Ein fehlender erster Buchstabe sieht aus wie ein Schriftproblem und
ist ein Längenproblem.

Ist der Name länger als die Kurve, greifen drei Mittel in dieser Reihenfolge — alle vom Owner
benannt:

1. **Kurve verlängern**, tangential an beiden Enden, gedeckelt auf +30 % der Bogenlänge.
2. **Schrift verkleinern**, Untergrenze 8 px.
3. Reicht beides nicht: **doch weiter verlängern.** Abgeschnitten wird nie.

**Mittig** steht der Name immer (`startOffset="50%"` + `text-anchor="middle"`).

Vorbeugend wird das Fenster von vornherein **15 % größer** angefordert, als der Name braucht, und die
Passung rechnet mit einem Sicherheitsrand von 4 %. Ohne diesen Vorhalt liefe jedes Label ins
Verlängern — und die Meldung „Kurve verlängert" wäre kein Befund mehr, sondern Grundrauschen.

---

## §5 Zwei weitere Regeln, die aus dem Bauen kamen

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

🪤 Wer das für eine Kollision hält und die Kollisionsschwelle nachzieht, hat den Fehler zementiert
und schluckt künftig stumm Labels.

### §5.2 Die Sperrung

⭐ Die Kurve erlaubt etwas, das die feste Drehung nie konnte: die **Sperrung über die Fläche ziehen**,
so dass der Name das Objekt aufspannt — die kartografische Gewohnheit bei Gebirgen und Wäldern. Bei
den Drachensteinen belegt der Name ungesperrt 13 % der Kette; gesperrt beschriftet er sie.

Nur **Sperren** (`lengthAdjust="spacing"`), nie die Glyphen strecken.

🔴 **Höchstens 50 %** (Owner-Entscheid). 💣 Und der Anteil allein genügt nicht: bei Zoom 7 ist die
Drachenstein-Kurve **11 246 px** lang und der Name 197 px — 20 % davon sind Buchstaben mit 50 px
Abstand, die als Wort nicht mehr lesbar sind. Gedeckelt wird zusätzlich der **Zusatz je Lücke**,
gemessen in Schriftgrößen; das ist die Zahl, die man am Schirm sieht.

---

## §6 Die Darstellungseinstellung — Kachel „Darstellung"

🔴 Owner-Entscheid 22.08.2026: die allgemeinen Kurveneinstellungen werden **nicht** einbetoniert,
sondern liegen unter einer Kachel **„Darstellung"** im Kachelband des Editors — **für Admins
editierbar, für Editoren ansehbar.**

⭐ **Das ist Zeile für Zeile das Muster der „Zoombänder"** (AGENTS.md §11) und wird davon abgeschrieben,
nicht neu erfunden:

* Ablage in **einem** `app_setting`-Schlüssel (plus `_stamp`).
* Schreiben mit Fähigkeit `admin`, Ansehen mit `edit`.
* Öffentlicher Leser fällt **offen** aus: jeder Fehler ⇒ Vorgabe, **kein DDL** im Lesepfad.
* 💣 Der Schreibvorgang **liest zurück** — dieselbe stille MySQL-Kürzung, an der der Speichern-Knopf
  der Tempowerte wochenlang nichts tat (AGENTS.md §10).
* **Zurücksetzen löscht die Zeile**, statt eine Kopie der Vorgabe zu hinterlassen (die veraltete
  sonst).
* Die **Vorgabewerte stehen an genau einer Stelle** im Frontend-Modul und werden von Karte und
  Fenster geteilt.

### §6.1 Die einstellbaren Werte

| Wert | Vorgabe | Wirkung |
|---|---|---|
| Glättung | Polynom Grad 3 | Form der Kurve |
| Begradigung | 0 % | Mischung Kurve ↔ Sehne |
| Randvereinfachung | 1,55 | Douglas-Peucker-Toleranz in Karteneinheiten |
| Stützpunktabstand | 0,30 | Segmentierung des Randes |
| Teilfläche zählt ab | 2 % der Gesamtfläche | welche Lappen die Kurve mitbestimmen |
| max. Verdrehung gegen die Sehne | 30° | Beruhigung |
| Kurve verlängern höchstens | 30 % | Passung, Mittel 1 |
| Sperrung über die Fläche | 20 % | Deckel 50 % (§5.2) |
| Sperrung höchstens je Lücke | 0,6 Schriftgrößen | absoluter Deckel |
| Mindestabstand zweier Namen | 2,0 Schriftgrößen | Kollisionsabbau (§4.2) |
| Schrift verkleinern bis es passt | an | Passung, Mittel 2 |

⚠️ **Der Mindestabstand ist der unsicherste Wert im ganzen Entwurf.** Er entscheidet, wann beim
Herauszoomen ein Name verschwindet, und er ist an sechs Flächen geraten, nicht an 644 gemessen. Er
gehört genau deshalb in die einstellbare Tafel und nicht in eine Konstante.

### §6.2 Zwei Rückfragen zur Kachel

🔧 **Wo hängt die Kachel?** Das `btn2`-Kachelband gibt es heute nur im **Ortseditor**
(`html/wiki-sync-settlement-editor.html`) — dort sitzt auch „Zoombänder", obwohl es eine globale
Darstellungseinstellung ist. Der Landschaften-Editor hat kein solches Band. Der Entwurf nimmt an:
**neue Kachel „Darstellung" neben „Zoombänder", im selben Band.** Soll sie stattdessen in den
Landschaften-Editor, kostet das dort erst ein Kachelband.

🔧 **Wird „Darstellung" der Sammelplatz?** Der Name legt nahe, dass dort mit der Zeit auch andere
globale Darstellungswerte einziehen (die Zoombänder wären der erste Kandidat). Dieser Entwurf baut
nur die Kurveneinstellungen ein und nimmt nichts vorweg.

---

## §7 Einbau in die Karte

### §7.1 Die Kurve kommt vom SERVER

🔴 **Das ist die tragende Architekturentscheidung, und sie ist nicht frei.** Die Flächengeometrie
liegt beim normalen Besucher **nicht** im Browser: `api/app/ecosystem-areas.php` wird nur geladen,
*„wenn jemand die Landschaftsebene betritt"* (so steht es wörtlich in
`js/map-features/map-features-ecosystem-loader.js`). Gemessen sind das **1,6 MB** für Vegetation und
**1,4 MB** für Topographie — die Kurve im Browser zu rechnen hiesse, diese Nutzlast jedem Besucher
aufzuladen, nur um sechs Wörter zu drehen.

Also: **`avesmapsCurveLabelBaseline()` rechnet serverseitig**, einmal je Flächengeometrie, und die
fertige Kurve reist im `map-features`-Payload am Label mit.

* **Kosten:** eine Kurve mit 32 Punkten ist rund **433 Byte** JSON; ×657 Labels = **278 KB roh**, vor
  gzip und vor Rundung der Koordinaten. Das ist verglichen mit den 21 MB der heutigen Nutzlast
  vertretbar, aber nicht nichts — die Koordinaten werden auf drei Nachkommastellen gerundet (die
  Quelle hat nicht mehr Aussagekraft).
* **Zwischenspeicher:** die Kurve hängt an der Geometrie, nicht am Zoom. Sie wird an der Fläche
  abgelegt und an `geometry_revision` gebunden; ändert sich die Fläche, verfällt sie.
* 💣 **`AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION` muss hoch.** Der ETag ist revisionsbasiert; ohne den
  Bump behält ein warmer Client den alten Rumpf über 304 und sieht nie eine Kurve.
* ⚠️ **Nicht in einem Lauf über alle 644 Regionen beim ersten Request.** STRATO — AGENTS.md §9. Die
  Berechnung gehört in einen Schreibpfad (beim Speichern der Geometrie) plus einen
  Owner-ausgelösten Sammellauf, nicht in den Lesepfad.

⚠️ **Damit gibt es das Verfahren zweimal**: in PHP für die Auslieferung und im Prototyp in JavaScript.
Das ist die Divergenz, die AGENTS.md §5 verbietet („Sources live in ONE place"). Der Entwurf akzeptiert
sie bewusst — der Prototyp ist ein Dokument, kein Produktionspfad — **und der Bauplan muss die
PHP-Fassung an den sechs Referenzflächen gegen die gemessenen Zahlen dieses Entwurfs prüfen.**

### §7.2 Kollision mit fremden Labels — der schwierigste Teil

Heute misst `resolveLabelCollisions` (`js/map-features/map-features-label-collisions.js`) je Label
**ein** Rechteck (`getBoundingClientRect()` des Canvas-`<img>`), reicht es an den reinen Rechtenlöser
`avesmapsResolveLabelPlacements` (`label-placement.js`) und verschiebt das Label per
`--label-offset-x/y` auf einen von zwölf Kandidaten — oder blendet es aus (`is-colliding`).

Für eine Kurve passt davon nichts:

* Ein gebogenes Label hat **kein** Rechteck. Seine Hüllbox ist ein Vielfaches der Schrift.
* Es **auszuweichen** widerspricht seinem Sinn: es sitzt auf seiner Fläche, nicht irgendwo.

🔴 **Vorschlag: ein Kurvenlabel weicht nicht aus, es belegt.** Es wird **vor** dem Löser platziert und
geht als **mehrere kleine Rechtecke entlang seiner Grundlinie** in die Belegung ein — genau dort, wo
heute schon die Gebietsnamen als `seedRects` hineingehen (`resolveLabelCollisions(regionLabelRects)`)
und wo die Endlage anschliessend in `map-features-label-occupancy.js` für die Weg- und Flussnamen
landet. Es wird also **kein zweites Kollisionssystem gebaut**, sondern der vorhandene Vorbelegungsweg
benutzt.

⭐ Nebenbei ist das **besser als heute**: ein um 297° gedrehtes `<img>` liefert `getBoundingClientRect()`
schon jetzt eine stark aufgeblähte achsenparallele Hülle. Mehrere kleine Rechtecke entlang der
Schrift sind die genauere Aussage.

🔧 **Ungeprüft:** ob die Ordnung dadurch kippt (Kurvenlabels sind unverdrängbar und drängen damit
Ortsnamen weg, die heute gewinnen könnten). Das ist am Livebestand zu messen, nicht zu behaupten.

### §7.3 Zeichnen

Der Prototyp zeichnet SVG-`<textPath>`. Die Karte zeichnet Labels heute als **Canvas-Bild** in einem
`L.divIcon` (`renderMapLabelToImage`), damit die Schrift „in die gemalte Karte einsinkt".

🔧 **Offene Entscheidung.** Zwei Wege:

* **SVG-Overlay** — kurz zu bauen, `textPath` kann Sperrung und Kurve von Haus aus, und die
  Leserichtungsprobe aus §4.1 gibt es fertig (`getStartPositionOfChar`). Aber: andere Schriftanmutung
  als der Rest der Karte, und der Halo muss nachgebaut werden.
* **Canvas, Glyphe für Glyphe** — passt zur bestehenden Anmutung und zum Halo, kostet aber die
  Buchstabenplatzierung, die Sperrung und die Messung selbst.

Der Entwurf empfiehlt **Canvas**, weil die Anmutung der Karte eine getroffene Entscheidung ist und
zwei Schriftbilder nebeneinander auffallen. ⚠️ Dann ist die Leserichtungsprobe aus §4.1 selbst zu
rechnen statt vom Browser zu bekommen — und sie ist die Zusicherung, die zweimal danebengegangen ist.

### §7.4 Bearbeiten-Modus

Ein Label ist heute mit der Maus drehbar und verschiebbar (`body.edit-mode .map-label`).

🔧 **Offen:** was ein Zug an einem Kurvenlabel tun soll. Naheliegend: **nichts** — die Lage folgt der
Fläche. Dann muss der Zeiger das auch sagen (kein `cursor: move`).

---

## §8 Datenmodell

🔴 **Keine neue Tabelle, keine Migration, nichts wird gelöscht.**

| Was | Wo | Bemerkung |
|---|---|---|
| Kurvenbeschriftung an/aus | `properties.curve_label` am **primären** Label der Region | fehlt der Schlüssel ⇒ Vorgabe (siehe unten) |
| Maximale Anzahl | `properties.curve_label_max` am selben Label | fehlt ⇒ Anzahl der Labelzeilen der Region |
| Darstellungseinstellung | `app_setting`-Schlüssel (§6) | wie `location_zoom_bands` |
| Berechnete Kurve | an der Fläche, gebunden an `geometry_revision` | Zwischenspeicher, jederzeit neu rechenbar |

💣 **`properties.rotation` bleibt stehen und wird nicht angefasst — aber sie ist NICHT der Rückweg des
Hakens.** „Kurvenbeschriftung aus" heisst *gerade*, nicht *alte Drehung* (§4.3); der gespeicherte
Winkel hat damit keine Wirkung mehr. Erhalten bleibt er trotzdem, weil ein Rückbau des ganzen Features
ihn sonst nicht wiederherstellen könnte und der Deploy nie löscht (AGENTS.md §10). ⚠️ Wer ihn „aufräumt",
nimmt dem Feature seinen einzigen Rückweg.

💣 **Die zusätzlichen Labelzeilen einer Region werden NICHT gelöscht.** Die zehn Regionen mit mehr als
einem Label behalten ihre Zeilen; solange die Kurvenbeschriftung an ist, zeichnet die Karte nur die
Anzahl aus `curve_label_max` und nimmt Text, Größe, Zoomband, Priorität und Wiki-Zuweisung vom
primären Label. Eine gelöschte Zeile nähme eine Wiki-Zuweisung mit, und das wäre unumkehrbar.

⚠️ **`show_name`, `min_zoom`/`max_zoom`, `priority` und die Wiki-Zuweisung bleiben unverändert
wirksam.** Ein Label, das heute erst ab Zoom 4 erscheint, erscheint auch künftig erst ab Zoom 4.

### §8.1 Die Vorgabe beim Ausliefern

🔧 **Owner-Entscheidung nötig.** Zwei Möglichkeiten, und sie sind nicht gleichwertig:

* **`curve_label` fehlt ⇒ AN.** Alle 657 Labels wechseln am Deploy-Tag ihr Aussehen. Das ist der
  Sinn der Sache, aber es ist eine sichtbare Änderung an 657 Stellen auf einmal — gegen AGENTS.md §9
  („sichtbare Änderungen gehen EINZELN live").
* **`curve_label` fehlt ⇒ AUS.** Nichts ändert sich, bis ein Editor den Haken setzt. Sicher, aber das
  Feature bleibt praktisch unsichtbar, und der Owner sieht nie das Gesamtbild.

Der Entwurf empfiehlt **AUS als Auslieferungszustand plus einen Admin-Schalter in der Kachel
„Darstellung", der es global anschaltet.** Dann ist der Umschalttag eine bewusste Handlung mit einem
Rückweg, und der Owner sieht das Gesamtbild in einem Blick — nicht 657 Einzelentscheidungen.

---

## §9 Abnahme

Nicht Maße, sondern Handgriffe (AGENTS.md §9):

1. Auf der **Live-Karte** die sechs Referenzflächen anfahren und die Namen ansehen — bei Zoom 2, 4
   und 7.
2. **Herauszoomen**, bis bei „Östlicher Hangwald des Raschtulswalls" der zweite Name verschwindet;
   prüfen, dass der verbleibende auf der **ganzen** Kurve sitzt und nicht auf seiner Hälfte.
3. Im Editor an einer Fläche den **Haken ausschalten** → der Name wird eine Gerade; wieder
   einschalten → er ist zurück auf der Kurve.
4. Die **maximale Anzahl** von 1 auf 3 stellen und zurück.
5. Als **Editor** (nicht Admin) die Kachel „Darstellung" öffnen: Werte sichtbar, Speichern gesperrt.
6. Als **Admin** einen Wert ändern, speichern, neu laden, **zurücklesen** — steht er wirklich da?
7. Prüfen, dass an **keinem** der sechs Namen ein Buchstabe fehlt und keiner kopfsteht.
8. Ein Label **ohne** Landschaftsfläche (ein Meer, ein Berggipfel) ansehen: unverändert.

Automatisch zu wachen:

* Leserichtung: für jedes gerenderte Kurvenlabel `dx > −1 px`.
* Passung: für jedes Label `Textbreite ≤ Bogenlänge` — kein abgeschnittener Buchstabe.
* Die PHP-Kurve gegen die sechs gemessenen Bogenlängen dieses Entwurfs (§4.1-Tabelle als Fixture).
* 🪤 Die Fixture muss die **gemischten** Fälle enthalten: eine einteilige Fläche (Drachensteine), eine
  zweilappige (Koschberge), eine mit 26 Teilen (Raschtulswall) und eine mit zwei Labels. Eine
  homogene Fixture fängt den gemischten Fall nie.

---

## §10 Nicht in dieser Fassung

* Kollision **zwischen** Kurvenlabels verschiedener Flächen jenseits der Vorbelegung (§7.2).
* Kurvenbeschriftung für Labels **ohne** Landschaftsfläche (Meere, Kontinente, Inseln) — sie haben
  keine Fläche, aus der sich eine Achse rechnen liesse. Für Meere wäre es sinnvoll, braucht aber eine
  andere Geometriequelle.
* Wiederholung des Namens „so oft wie er passt" (im Prototyp gebaut, im Produkt nicht vorgesehen) —
  die Verteilung über `curve_label_max` genügt, solange 634 von 644 Regionen genau ein Label tragen.
* Die Zoombänder in die Kachel „Darstellung" umziehen (§6.2).

---

## §11 Bauteile (erwartet)

| Datei | Rolle |
|---|---|
| `api/_internal/app/curve-labels.php` | das Verfahren §3, serverseitig |
| `api/app/map-features.php` | Kurve am Label ausliefern, `PAYLOAD_VERSION` hoch |
| `api/_internal/app/curve-label-settings.php` | Lesen/Schreiben der Darstellungseinstellung |
| `api/app/curve-label-settings.php` | öffentlicher Leser, fällt offen aus |
| `api/edit/map/curve-label-settings.php` | Schreiben, Fähigkeit `admin` |
| `js/map-features/curve-label-defaults.js` | die **einzige** Quelle der Vorgabewerte |
| `js/map-features/map-features-labels.js` | Zeichnen (§7.3), Leserichtungsprobe, Passung |
| `js/map-features/map-features-label-collisions.js` | Kurvenlabels als Vorbelegung (§7.2) |
| `html/wiki-sync-settlement-editor.html` | Kachel „Darstellung" + Fenster (§6) |
| `index.html` | zwei Bedienelemente im Beschriftungsdialog, Rotationsfeld inert |
| `docs/kurvenlabel-mockup.html` | der abgenommene Prototyp — bleibt als Referenz stehen |

---

## §12 Die offenen Punkte auf einen Blick

1. 🔧 **Auslieferungszustand** — AN oder AUS als Vorgabe (§8.1). Empfehlung: AUS plus globaler
   Admin-Schalter.
2. 🔧 **Zeichnen** — SVG oder Canvas (§7.3). Empfehlung: Canvas.
3. 🔧 **Wo hängt die Kachel „Darstellung"** (§6.2).
4. 🔧 **Ordnung der Kollision** — verdrängen Kurvenlabels künftig Ortsnamen, die heute gewinnen? Am
   Livebestand zu messen (§7.2).
5. 🔧 **Bearbeiten-Modus** — was tut ein Zug an einem Kurvenlabel (§7.4).
6. ⚠️ **Mindestabstand 2,0 Schriftgrößen** ist an sechs Flächen geraten, nicht an 644 gemessen (§6.1).
