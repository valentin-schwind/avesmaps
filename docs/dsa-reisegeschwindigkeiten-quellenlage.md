# Reisegeschwindigkeiten und Wegtypen — die Quellenlage

> ## 🔴 KORREKTUR 2026-08-02 — §7.2 war bei den Wasserwegen falsch
>
> Dieses Dokument behauptete, wir seien auf Flüssen **und Meeren** 1,7- bis 2,5-fach zu schnell.
> Das trifft nur auf Flüsse zu. Die Rechnung verglich unsere 24-Stunden-Fahrt mit den
> 12-Stunden-Tagesleistungen der Quelle und maß damit die Tageslänge, nicht das Tempo.
>
> **Sauber getrennt, pro Stunde:**
>
> | | Quelle | Avesmaps | |
> |---|---|---|---|
> | Lastensegler | 10,0 M/h (120 ÷ 12 h) | **8,4** | wir sind 16 % **langsamer** |
> | Flusskahn stromab | 3,33 M/h (40 ÷ 12 h) | **4,2** | wir sind 26 % **schneller** |
>
> **See: kein Fehler.** Die Quelle nennt zwar 12 Stunden als Grundlage der 120/140 Meilen, schreibt
> das nächtliche Ankern aber ausdrücklich der *Küstennähe* zu und nennt für durchgefahrene
> Schnellsegler 250 Meilen. Ein generelles Nachtfahrverbot für Seeschiffe steht dort **nicht**.
> Unsere höhere Tagesleistung kommt allein vom Durchfahren, und das ist gedeckt.
>
> **Fluss: Fehler bestätigt, doppelt.** Pro Stunde 26 % zu schnell, und wir fahren nachts, was die
> Quelle wörtlich ausschließt (S. 129: der 12-Stunden-Reisetag, und nur Piraten oder Kurierboote
> ziehen nachts stromab).
>
> Damit ist auch die Aussage über `seaNote` zurückzunehmen: der Dialogsatz widerspricht der Quelle
> nicht. Für Flüsse gilt der Einwand unverändert.

> **Stand:** 2026-08-02. **Quelle:** *Geographia Aventurica*, Fanpro/Fantasy Productions 2003,
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

**Die Wegtyp-Verhältnisse.** Gemessen über alle sechs Landtransportmittel, normiert auf Straße = 1,0:

| | Avesmaps | Quelle |
|---|---|---|
| Reichsstraße | 1,100 | 1,1 |
| Straße | 1,000 | 1,0 |
| Weg | 0,862 | 0,8 |
| Pfad | 0,709 | 0,8 |
| Gebirgspass | 0,388 | 0,4 |

Die `SPEED_TABLE` ist damit erkennbar aus dieser Tabelle gebaut — was bis 2026-08-01 nirgends
dokumentiert war.

**Die Kutschenverbote.** „Nicht auf Pfaden oder querfeldein, nicht in Wüste oder Eisgebieten" ist
seit `b4e43404` abgebildet und durch die Quelle wörtlich gedeckt.

### 7.2 Was abweicht

| Befund | Quelle | Avesmaps | Verhältnis |
|---|---|---|---|
| Reisegruppe zu Fuß, Straße | 30 M/Tag | 40,3 | **1,34×** |
| Wanderer leicht | 40 | 50,4 | 1,26× |
| Reisegruppe beritten | 35 | 65,5 | **1,87×** |
| Einzelreiter leicht | 50 | 80,7 | 1,61× |
| Karawane | 30 | 35,3 | 1,18× |
| Kutsche | 50 | 55,5 | 1,11× |
| Flusskahn stromab | 40 | 100,8 | **2,52×** |
| Flusssegler stromab | 60 | 151,3 | **2,52×** |
| Lastensegler | 120 | 201,7 | 1,68× |
| Schnellsegler | 140 | 242,0 | 1,73× |

*(Avesmaps-Werte: `SPEED_TABLE` ÷ `TIME_SCALE_FACTOR` 1,19 × 12 Reisestunden an Land bzw. 24 auf
dem Wasser.)*

💣 **Die Wasserwerte sind rekonstruierbar falsch skaliert.** Die rohen Tabellenwerte treffen die
Quelle exakt, wenn man sie mit der Stundenzahl der Quelle multipliziert: Flusskahn 5,0 × **8 h** =
40 ✓ · Flusssegler 7,5 × **8 h** = 60 ✓ · Lastensegler 10,0 × **12 h** = 120 ✓ · Schnellsegler 12,0
× 12 h = 144 ≈ 140 ✓. Die Tabelle wurde also aus den Tagesleistungen der Quelle abgeleitet — und
dann lässt der Router auf dem Wasser **24 Stunden** fahren, weil dort keine Rast anfällt. Damit
verdoppelt bis verdreifacht sich, was einmal richtig war.

💣 **Der Strömungsfaktor ist zu milde.** Unser Vorgabewert ist **1,5** (geklemmt auf 1,0…3,0), die
Quelle liefert durchgehend **2,0** bis 2,14.

💣 **Und `seaNote` widerspricht der Quelle.** Der Dialog sagt: *„Auf offener See wird Tag und Nacht
durchgesegelt — hier fällt keine Rastzeit an."* Die Quelle nennt 12 Stunden als Reisetag, behandelt
24-Stunden-Fahrt als Sonderfall mit Bedingungen und schreibt, dass Schiffe üblicherweise nachts vor
Anker gehen.

### 7.3 Was uns ganz fehlt

Kutsche auf Karrenwegen und Pässen nur halbe Geschwindigkeit · „Reittiere müssen geführt werden" auf
den mit \* markierten Geländearten · Wetter- und Bodenmodifikatoren · Eilmarsch · saisonale
Passsperrung · die Untergrenze 0,05 für den Gesamtmodifikator · Reichs- und Landstraßen sind von
aufgeweichtem Boden ausgenommen.

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
