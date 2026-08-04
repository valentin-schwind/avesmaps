# Reisegeschwindigkeiten und Wegtypen — die Quellenlage

> ## ✅ STAND 2026-08-03 — die Abweichungen aus §7.2 sind gebaut
>
> Dieses Dokument hatte zwei Fassungen: die erste hielt Fluss **und** Meer für zu schnell, die
> zweite (2026-08-02) nahm das fürs Meer zurück. Beide beschrieben einen Zustand, den es seit
> `3dc64753` und `d9d7ab39` nicht mehr gibt. **§7.2 ist deshalb keine Mängelliste mehr, sondern
> ein Vorher-Nachher.**
>
> | Paket | Commit | Wirkung |
> |---|---|---|
> | P1 Fluss | `3dc64753` | 12-Stunden-Reisetag statt 24; Kahn 100,8 → 40,3 Meilen/Tag |
> | P2 Strömung | `3dc64753` | Vorgabe 1,5 → **2,0**, wie die Quelle sie durchgehend nennt |
> | P3 Kutsche | `3dc64753` | halbe Geschwindigkeit auf `Weg` und `Gebirgspass` (S. 123) |
> | Niveau, Land + See | `d9d7ab39` | **jedes** Reisemittel trägt seine eigene Tagesleistung aus der Quelle |
> | Galeere | `4c417814` | 100 statt 70 — unsere Zeile ist die mit 12 Ruderstunden, nicht die mit 8 |
> | Pass | `aa7ac68d` | die Steigung bremst einen Gebirgspass nicht mehr ein zweites Mal |
>
> ⭐ **Die See blieb dabei richtig** — die Korrektur vom 02.08. gilt unverändert: pro Stunde waren
> wir dort nie zu schnell. Was `d9d7ab39` an der See änderte, ist etwas anderes: die Nachtfahrt
> gehört einem **Schiff**, nicht dem Wegtyp. Nur der Schnellsegler fährt durch, Lastensegler und
> Galeere ankern und rasten wie an Land.
>
> ⚠️ **Was hier steht, ist gemessen, nicht erinnert** — und genau deshalb muss es mitwandern. Am
> 2026-08-03 wurde der behobene Fehler ein zweites Mal gemeldet, weil dieses Dokument noch die
> alten Zahlen trug. Wer die `SPEED_TABLE` anfasst, zieht §7.2 mit.

> **Stand:** 2026-08-03. **Quelle:** *Geographia Aventurica*, Fanpro/Fantasy Productions 2003,
> ISBN 3-89064-291-8, Kapitel „Weg und Steg in Aventurien", **S. 113–132**. Alle Seitenangaben
> beziehen sich auf diese Ausgabe.
>
> Dieses Dokument hält fest, **was die Regelquelle tatsächlich sagt** — Werte, Definitionen und
> Bedingungen — und stellt dem gegenüber, **was Avesmaps tut**. Es trifft keine Entscheidungen.
>
> 🔴 **Warum es existiert.** Über einen Monat stand „DIN 33466" im Geschwindigkeits-Dialog, ohne
> dass irgendwo vermerkt war, woher die Angabe stammte. Zwei Spieler haben es gefunden, nicht wir.
> Dieselbe Lücke betraf die Wegtyp-Faktoren: sie stimmen fast exakt mit der Quelle überein, aber
> niemand hatte aufgeschrieben, dass sie von dort kommen. Was hier steht, ist nachgeschlagen, nicht
> erinnert.

---

## 1. Was ein Wegtyp ist — die Definitionen (S. 113 f.)

**Reichsstraße:** mindestens vier Schritt Breite, mit Granitplatten oder Basaltblöcken auf tragendem
Untergrund gepflastert, zu den Seiten gewölbt, damit Regenwasser in die Straßengräben abläuft. Der
Verlauf ist so gewählt, dass Flüsse ohne Umweg über steinerne Brücken, Fähren oder ausgewählte
Furten überquert werden. Alle 15 Meilen ein häufig befestigtes Landgasthaus mit Mietstall,
Botenstation und oft Hufschmied.

**Reichslandstraße / Kronstraße:** geringere Qualität, aber zwei Fuhrwerke breit, Flussquerungen an
geeigneten Stellen, mindestens alle 20 Meilen eine Herberge.

**Alles darunter:** festgestampfter Lehm, teils mit Schotter aufgefüllt, am Rand mit Knüppeln
befestigt; die schlechteren — *„also fast alle ‚Straßen' Aventuriens"* — sind von tiefen Furchen
durchzogene Karrenwege, in den Wald gehauene Pfade oder häufig genutzte Wildwechsel.

⭐ **Alle drei Definitionen beschreiben ausschließlich den Ausbauzustand** — Breite, Belag,
Entwässerung, Brücken, Herbergsdichte. **Kein Wort über Neigung.** Das ist der Textbefund, auf dem
die Entscheidung in `docs/steigung-gebirgspass-entscheidung.md` beruht.

---

## 2. Basisgeschwindigkeiten (S. 123, Tabelle)

| Fortbewegungsart | Meilen/Tag |
|---|---|
| Reisegruppe zu Fuß | 30 |
| Wanderer mit leichtem Gepäck | 40 |
| Reisegruppe zu Pferd | 35 |
| Einzelreiter mit leichtem Gepäck | 50 |
| Kamelkarawane | 30 |
| Karren | 25 ¹ |
| Fuhrwerk | 30 ¹ |
| Kutsche | 50 ² |
| Schlitten | 50 ³ |

¹ nur im offenen Gelände oder lichtem Wald querfeldein; **nicht auf Pfaden, in Wüste oder Eisgebieten**
² **nicht auf Pfaden oder querfeldein, nicht in Wüste oder Eisgebieten**; auf Karrenwegen und Pässen **nur halbe Geschwindigkeit**
³ nur auf verschneiten oder vereisten Flächen

Ergänzend S. 118: eine Reisegruppe zu Fuß mit schwerem Gepäck, Rüstung, zwei bis drei Waffen und
mehreren Tagen Proviant liegt bei etwa 30 Meilen; leicht bepackte Einzelwanderer bei etwa 40.
Botenreiter mit Pferdewechsel schaffen ~180 Meilen/Tag, eine Eilkutsche auf einer Reichsstraße 120
(S. 119).

⛔ **Die Wechselstations-Modi werden bewusst NICHT modelliert** (Owner, 2026-08-04). Botenreiter
und Eilkutsche sind keine durchgehende Reise: wer die Tiere wechselt, wechselt an der Station in
aller Regel auch den Reiter. Das ist eine **Staffette mehrerer Personen** über Teilstrecken, und
der Routenplaner rechnet die Reise **einer** Gruppe von A nach B. Beide Zahlen stehen hier als
Quellenbefund, nicht als Rückstand — sie sind kein Kandidat für ein Reisemittel.

💣 **Und sie sind der Grund, warum „die Kutsche ist zu langsam" immer wieder auftaucht.** Die 120
der Eilkutsche verlockt dazu, die gewöhnliche Kutsche anzuheben. Sie gilt aber nur *mit*
Pferdewechsel und nur auf einer Reichsstraße — ohne Wechsel deckelt S. 123 jede Kutsche bei
×1,25. Siehe §7.1.

---

## 3. Die Geländearten-Multiplikatoren (S. 123, Tabelle)

🔴 **Das ist EINE Achse, nicht zwei.** Ausbauzustand und Gelände stehen in derselben Liste; man
wählt **einen** Eintrag und multipliziert die Tagesleistung damit.

| Eintrag | Faktor | | Eintrag | Faktor |
|---|---|---|---|---|
| Reichsstraße | 1,1 | | Gebirge, Passstrecke | 0,4 |
| Straße | 1,0 | | Gebirge, Pfad | 0,3 * |
| Weg | 0,8 | | Gebirge (kein Klettern) | 0,2 * |
| Offenes Gelände, Pfad | 0,8 | | Hochgebirge (Klettern) | 0,1 |
| Offenes Gelände | 0,75 | | Regenwald, Pfad | 0,4 * |
| Lichter Wald, Pfad | 0,75 | | Regenwald | 0,2 * |
| Lichter Wald | 0,6 | | Regenwald/Gebirge | 0,1 * |
| Wald, Pfad | 0,6 | | Sumpf, Weg/Knüppeldamm | 0,5 |
| Wald | 0,5 | | Sumpf, Pfad | 0,3 * |
| Dichter Wald, Pfad | 0,5 | | Sumpf | 0,1 * |
| Dichter Wald | 0,2 * | | Eisgebiete, freie Fläche | 0,7 |
| Geröllwüste | 0,5 | | Eisgebiete, Tiefschnee | 0,4 * |
| Sandwüste | 0,5 | | Eisgebiete, Eisflächen | 0,2 * |
| | | | Eisgebirge/Gletscher | 0,1 * |

\* **Reittiere müssen geführt oder im Schritttempo geritten werden; die Tagesleistung sinkt auf die
einer Reisegruppe zu Fuß.** ⭐ „Gebirge, Passstrecke" trägt den Stern **nicht** — auf einem Pass darf
geritten werden.

---

## 4. Die drei Zusatzmodifikatoren (S. 122 f.)

Alle Modifikatoren werden **miteinander multipliziert** und dann auf die Tagesleistung angewandt.

**Bodenqualität** (additiv auf den Multiplikator): aufgeweichter Boden / leicht verschneit **−0,1**;
stark aufgeweicht, Tiefschnee, vereist **−0,2**. Der Gesamtmodifikator kann dadurch nie unter
**0,05** sinken. Reichsstraßen und Landstraßen sind von aufgeweichtem Boden **nicht betroffen**.

**Geländeformation:** Ebenen **×1**, Hügel **×0,75**, einzelne Berge **×0,5**. Die Quelle stellt dem
voran, es sei *„schwierig, absolute Modifikatoren anzugeben"*, und weist an, Mittelwerte zu
verwenden. ⚠️ **Weder „Hügel" noch „Berg" wird definiert** — beide Begriffe kommen ausschließlich in
diesem einen Absatz vor und sind keine Geländeart der Liste in §3.

🔴 **Und die Ausnahme, die alles trägt** (S. 123, wörtlich):

> „Da für Gebirgslandschaften bereits die Beeinträchtigungen durch Anstiege und Gefälle
> berücksichtigt sind, ist die Tagesleistung nicht noch einmal zu modifizieren."

**Wetter:** Nieselregen, Schnee, Frost, leichter Nebel, steife Brise ×0,9 · große Hitze im Wald ×0,9
· große Hitze in sonstigem Gelände ×0,8 · Dauerregen oder Sturm ×0,7 · heftiger Schauer oder dichter
Nebel ×0,5 · Orkan ×0,3.

**Eilmarsch** (S. 123): Tagesleistung ×1,5 bei Wanderern und Ritten, Fuhrwerke/Karren/Kutschen
maximal ×1,25. Nur auf befestigten Wegen, für Wanderer auch auf Trampelpfaden; sonst
Wildnisleben-Probe +5. **In Gebirgen, Sümpfen und im Dschungel schlichtweg unmöglich.**

---

## 5. Wasserwege

**Fluss (S. 129):** Flusskahn stromauf **20**, stromab **40** Meilen/Tag. Flusssegler bei gutem Wind
stromauf bis **30**, stromab **60**. Flussgaleere **35 bzw. 75**. Ruderboot über einen See **25**.

⭐ Daraus folgt ein Aufwärtsfaktor von **2,0** (Kahn und Segler) bis **2,14** (Galeere).

**See (S. 131):** 🔴 *„Ausgehend von günstigem Wind und einem **Reisetag von 12 Stunden**"* erzielt
ein langsamer Lastensegler **120**, ein üblicher Schnellsegler **140** Meilen/Tag. Schnellsegler,
die bei bekannter Strecke und gutem Wind **24 Stunden durchfahren**, erreichen **250**. Galeeren mit
8 Stunden Ruderzeit **70**, eilgerudert (12 h) **100**, Kurier-Dromonen (24 h, Wechselschichten)
**200**.

⭐ **Die Quelle nennt hier ausdrücklich eine Stundenzahl** — 12 Stunden als Reisetag — und behandelt
das Durchfahren rund um die Uhr als **Sonderfall** mit Bedingungen. Ergänzend: *„Üblicherweise gehen
die Schiffe nachts vor Anker … oder versuchen einen Hafen anzulaufen."*

---

## 6. Pässe (S. 115)

Aventurische Straßen und Haupthandelswege werden **um Gebirge herumgelegt**, auch um den Preis
großer Umwege: Gebirgsstraßen sind teuer, unsicher wegen Wetterwechseln und Steinschlag, im Winter
meist gar nicht gangbar, und für Ochsenkarren oder Pferdekutschen nur sehr langsam zu überwinden.

Die Quelle nennt Pässe mit **Höhenangaben** — Greifenpass ~1.600 Schritt, Roter Pass ~800 Schritt am
Sattel, Raschtulsweg ~2.500 Schritt — und jeweils **Gangbarkeitszeiträume** („gangbar von Anfang
Peraine bis Ende Boron"). ⚠️ Saisonale Sperrung modelliert Avesmaps überhaupt nicht.

---

## 7. Abgleich mit Avesmaps

### 7.1 Was übereinstimmt

**Die Wegtyp-Verhältnisse.** Gemessen am 2026-08-03 über die fünf Landtransportmittel **ohne die
Kutsche**, normiert auf Straße = 1,0:

| | Avesmaps | Quelle |
|---|---|---|
| Reichsstraße | 1,102 | 1,1 |
| Straße | 1,000 | 1,0 |
| Weg | 0,871 | 0,8 |
| Pfad | 0,741 | 0,8 |
| Gebirgspass | 0,393 | 0,4 |

Die `SPEED_TABLE` ist damit erkennbar aus dieser Tabelle gebaut — was bis 2026-08-01 nirgends
dokumentiert war. `d9d7ab39` hat jede Zeile **als Ganzes** skaliert, die Verhältnisse also nicht
angetastet.

⚠️ **Die Kutsche ist bewusst ausgenommen.** Seit `3dc64753` trägt sie auf `Weg` und `Gebirgspass`
die Halbierung von S. 123 — dort steht eine **Regel** über ein Fahrzeug, keine Eigenschaft des
Wegtyps. Mittelt man sie mit ein, sinken die beiden Werte auf 0,794 und 0,358, und die Tabelle
scheint von der Quelle abzuweichen, obwohl sie ihr genauer folgt als vorher.

**Die Kutschenregeln, vollständig.** „Nicht auf Pfaden oder querfeldein, nicht in Wüste oder
Eisgebieten" ist seit `b4e43404` abgebildet, die Halbierung „auf Karrenwegen und Pässen" seit
`3dc64753`. Gemessen gegen die Straße ergibt das 0,409 auf `Weg` und 0,182 auf `Gebirgspass` —
die Wegtyp-Faktoren 0,8 und 0,4 der Quelle, jeweils halbiert.

**Die Tagesleistungen.** Seit `d9d7ab39` trägt jedes Reisemittel seine eigene Zahl aus S. 123 /
129 / 131 statt einer gemeinsamen Skalierung — siehe die Tabelle in §7.2.

⭐ **Die Kutsche fährt 50, und das ist die LEICHTE Kutsche** — geprüft an der Primärquelle am
2026-08-04, nachdem der Verdacht aufkam, wir modellierten eine schwere Handelskutsche. S. 119
nennt die drei Landfahrzeuge in einem Satz: Ochsenkarren ~25, gewöhnliches Pferdefuhrwerk ~30,
„eine Reise- oder Postkutsche 50 Meilen". Die 50 gilt also **ausdrücklich der Reisekutsche**.

Die schwere Handelskutsche ist in der Quelle gar keine Kutsche: `Stoerrebrandter` und
`Steppenschivone` (S. 127) sind „schwerer Transportwagen für Handelsgüter" mit Geschwindigkeit
*gering bis mittel* — das ist die Tabellenzeile **Fuhrwerk 30**, nicht **Kutsche 50**. Und in der
qualitativen Skala (S. 127 f.) stehen Postkutsche und herrschaftliche Karosse bei *mittel bis
hoch*; darüber liegt nur der Streit- und Rennwagen (*hoch bis sehr hoch*), der „Last: keine"
trägt und kein Reisefahrzeug ist. **Oberhalb der Reisekutsche kennt die GA kein Reisefahrzeug auf
Rädern.**

⚠️ Dass die Kutsche damit **genauso schnell ist wie der Einzelreiter** (beide 50, dieselbe Tabelle
S. 123), ist kein Modellierungsfehler, sondern die Quelle. Plausibel ist es auch: Zugpferde
ziehen Last, ein Reitpferd trägt nur den Reiter. Wer die Kutsche höher setzt, trifft eine eigene
Entscheidung gegen zwei übereinstimmende Quellenstellen — dieselbe Lage wie bei den 35 der
berittenen Gruppe (§7.2).

### 7.2 Was abwich — und was heute dasteht

Gemessen am 2026-08-03 gegen den ausgelieferten Stand. Die Landwerte gelten auf **ebener**
Straße: sie tragen den Faktor `mean_G` = 1,032, der unsere eigene Steigungsebene herausrechnet —
über echte Straßen bringt das Gelände sie auf den Wert der Quelle zurück. Die Quelle hat keine
Steigung je Weg, ihr Straßenfaktor ist glatt 1,0.

| Reisemittel | Quelle | vorher | heute |
|---|---|---|---|
| Reisegruppe zu Fuß | 30 M/Tag | 40,3 | **31,0** |
| Wanderer leicht | 40 | 50,4 | **41,2** |
| Reisegruppe beritten | 35 | 65,5 | **36,1** |
| Einzelreiter leicht | 50 | 80,7 | **51,6** |
| Karawane | 30 | 35,3 | **31,0** |
| Kutsche | 50 | 55,5 | **51,6** |
| Flusskahn stromab | 40 | 100,8 | **40,3** |
| Flusssegler stromab | 60 | 151,3 | **60,5** |
| Lastensegler | 120 | 201,7 | **120,0** |
| Galeere, 12 h | 100 | 181,5 | **100,0** |
| Schnellsegler, 24 h | 250 | 242,0 | **250,1** |

💣 **Jeder Wert der `SPEED_TABLE` ist eine verkleidete Tagesleistung.** Das ist die ganze
Konstruktion:

```
Wert = Tagesleistung der Quelle × mean_G × TIME_SCALE_FACTOR ÷ Reisestunden
```

Wer dort eine Zahl anfasst, ohne diese Gleichung mitzurechnen, verschiebt eine Regelgröße.

💣 **Die Reisestunden sind nicht einheitlich.** Land, Fluss, Lastensegler und Galeere rechnen mit
12 h, der Schnellsegler als einziger mit 24. Die Ausnahme hängt am **Reisemittel**, nicht am
Wegtyp (`js/routing/route-result.js`) — eine Galeere fährt Seeweg und ankert trotzdem. Solange
die Regel am Wegtyp hing, bekamen alle drei Seeschiffe den 24-Stunden-Tag; dass der
Schnellsegler dabei zufällig richtig lag (242 gegen 250), ist der Grund, warum es niemandem
auffiel.

⭐ **Jedes Schiff nimmt die Quellenzeile, deren Stunden unsere sind.** Die Galeere steht auf
S. 131 dreimal — 70 bei 8 Ruderstunden, 100 bei 12, 200 bei 24 mit Wechselschichten. Unser
Reisetag hat 12, also gilt die mittlere Zeile. Sie stand am 2026-08-03 für ein paar Stunden auf
70; das war die 8-Stunden-Zeile über einen 12-Stunden-Tag gestreckt und ging schief, sobald
jemand die Stunden verstellte.

⚠️ **„Reisegruppe zu Pferd" folgt der Tabelle S. 123 (35), nicht dem Fließtext S. 118** („kaum
mehr als 40"). Die Quelle widerspricht sich hier und löst es nie auf; eine Regelrechnung folgt
dem tabellierten Wert, wie es die Rechenbeispiele der Quelle auch tun. Beritten ist dadurch nur
16 % schneller als zu Fuß. Das ist das Regelwerk, kein Fehler — und eine Änderung auf 40 wäre
**unsere** Entscheidung, nicht die der Quelle.

Gesichert durch `js/routing/__tests__/speed-table-and-rest-rule.test.js`: der Test bindet alle
elf Reisemittel an die Zahlen der Quelle und die drei Spiegel der Tabelle aneinander (`js/config.js`,
`api/_internal/routing/client-graph.php`, `js/pages/wege-editor-model.js`).

### 7.3 Was uns ganz fehlt

„Reittiere müssen geführt werden" auf den mit \* markierten Geländearten · Wetter- und
Bodenmodifikatoren · Eilmarsch · die Untergrenze 0,05 für den Gesamtmodifikator · Reichs- und
Landstraßen sind von aufgeweichtem Boden ausgenommen.

⭐ Die **saisonale Passsperrung** hat seit `b3310d83` ihre Mechanik: jeder Haken „erlaubt" trägt
ein optionales Zeitfenster, in der Formulierung der Quelle („gangbar von — bis"). ⚠️ Gepflegt ist
noch keines — alle Wege tragen heute kein Fenster und gelten damit als ganzjährig gangbar. Die
Gangbarkeitszeiträume von S. 115 stehen also bereit, sind aber noch nicht eingetragen.

---

## 8. Was die Quelle **nicht** sagt

- **Keine Gehstunden pro Tag an Land.** Die 12-Stunden-Angabe steht ausschließlich bei der Seereise.
  Für Fußmärsche und Ritte gibt es keine Stundenzahl — die Tagesleistung ist die Einheit.
- **Keine kontinuierliche Steigungsfunktion.** Nur die drei Stufen aus §4, ausdrücklich als schwer
  angebbar gekennzeichnet.
- **Keine Definition von „Hügel" und „Berg"** in messbaren Größen.
- **Keine Aussage über Streuung innerhalb einer Kategorie** — weder erlaubend noch verbietend.
- **Keine Werte für unsere Transportmittel** *leichter Wanderer beritten*, *Reisegruppe beritten* in
  der Feinheit unserer Tabelle; wir führen sechs Landtransportmittel, die Quelle neun Zeilen mit
  teils anderem Zuschnitt.

---

## 9. Verwandte Dokumente

- `docs/steigung-gebirgspass-entscheidung.md` — die Entscheidung, die auf §4 dieses Dokuments beruht.
- `api/_internal/routing/__tests__/terrain-text-claims-test.php` — bindet die Zahlen des
  Geschwindigkeits-Dialogs an den Rechenkern und sperrt die Fehletikettierung „DIN 33466".
