# Prüfauftrag: das Eigenwiderstandsmodell für Steigung und Transportmittel

> **Auftrag an eine prüfende Session. Selbsttragend — du brauchst keinen Kontext aus der
> Vorsession.** Stand: 2026-08-01. Gegenstand: ein **Vorschlag**, der das heutige Steigungsmodell
> von Avesmaps ersetzen soll. Er ist **noch nicht gebaut** und soll in dieser Sitzung auch **nicht
> gebaut werden**.
>
> 🔴 **DU SOLLST NICHTS UMSETZEN.** Kein Code, kein Commit, keine Datenbank. Deine Abgabe ist ein
> Urteil mit Belegen. Wer hier anfängt zu bauen, hat den Auftrag verfehlt.
>
> 🔴 **SEI FEINDLICH.** Der Vorschlag wurde von einem Agenten erstellt, der ihn plausibel fand.
> Genau das ist das Problem. Deine Aufgabe ist nicht, ihn zu bestätigen, sondern ihn **zu
> widerlegen zu versuchen** und zu berichten, wo es dir gelungen ist. Ein Bericht ohne einen
> einzigen Einwand ist ein Hinweis darauf, dass du nicht genau genug hingesehen hast — sag dann
> ausdrücklich, was du versucht hast und warum es gehalten hat.

---

## 0. Warum es diesen Auftrag gibt

Avesmaps ist ein Routenplaner für Aventurien (DSA). Am 30.07.2026 hat ein Spieler das damalige
Steigungsmodell öffentlich auseinandergenommen — zu Recht. Es wurde am selben Tag durch den
**Leistungskilometer** ersetzt. Am Tag darauf haben zwei weitere Spieler die *Beschreibung* des
neuen Modells auseinandergenommen — ebenfalls zu Recht.

Das Muster ist eindeutig: **dieses Projekt hat ein Publikum, das nachrechnet.** Was hier ausgeliefert
wird, muss einer öffentlichen Zerlegung standhalten. Der Vorschlag unten ist der dritte Anlauf. Er
soll geprüft werden, **bevor** er live geht, nicht danach.

Die strukturelle Ursache der bisherigen Fehler: die Zahlen waren durch Tests gedeckt, die
**Begründungen durch nichts**. „DIN 33466" stand jahrelang im Dialog, ohne dass irgendetwas rot
wurde. Dieser Auftrag prüft deshalb ausdrücklich **Herkunft und Begründung**, nicht nur Arithmetik.

---

## 1. Der Vorschlag, vollständig

### 1.1 Einheiten (die bekannte Falle dieses Projekts)

```
1 Karteneinheit = 3.000 Schritt = 3 Meilen
1 Meile         = 1.000 Schritt = 1 km
1 Schritt       = 1 m
```

💣 Diese Umrechnung hat schon einmal einen öffentlichen Fehler verursacht: eine Karteneinheit als
eine Meile zu lesen übertreibt jede Steigung um den **Faktor 3**. Rechne jede Zahl mit
ausgeschriebenen Einheiten nach.

`g` ist die dimensionslose Neigung **in Fahrtrichtung**: positiv = Steigung, negativ = Gefälle.
`a = |g|` beim Gefälle.

### 1.2 Die zwei Gleichungen

```
bergauf   (g ≥ 0):   f = min(FCAP,  1 + g / c)              falls g   ≤ gmax_auf, sonst GESPERRT
bergab    (a > 0):   f = min(FCAP,  1 + max(0, a − g₀) / c_ab)   falls a ≤ gmax_ab,  sonst GESPERRT

Reisegeschwindigkeit = v_eben(Transportmittel, Wegtyp) / f
FCAP = 4,0
```

„GESPERRT" heißt: dieses Transportmittel kann diesen Wegabschnitt **gar nicht** benutzen — die Kante
entsteht für dieses Transportmittel nicht, wie es der Planer heute schon bei Wasserwegen und bei
`allowed_transports` tut.

`c` ist der **Eigenwiderstand**: diejenige Steigung, bei der sich die Reisezeit verdoppelt.
Kleineres `c` = empfindlicher gegen Steigung.

### 1.3 Die Konstanten

| Transportmittel | `c` | `gmax_auf` | `g₀` | `c_ab` | `gmax_ab` |
|---|---|---|---|---|---|
| Pferdekutsche | 0,050 | 15 % | 0,03 | 0,035 | **12 %** |
| Karawane | 0,090 | 25 % | 0,16 | 0,130 | 25 % |
| Reisegruppe zu Pferd | 0,079 | 30 % | 0,20 | 0,0618 | 30 % |
| Reiter, leichtes Gepäck | 0,079 | 35 % | 0,22 | 0,0616 | 35 % |
| Reisegruppe zu Fuß | 0,100 | 40 % | 0,20 | 0,150 | 40 % |
| Zu Fuß, leichtes Gepäck | 0,100 | 45 % | 0,20 | 0,150 | 45 % |

Die Grundgeschwindigkeiten in der Ebene bleiben **unverändert** — sie stehen in `js/config.js` als
`SPEED_TABLE` und sind nicht Gegenstand dieses Vorschlags. Bei `g = 0` liefert jede Kurve exakt
`f = 1,0`; „Gelände aus" bleibt bit-identisch mit heute.

### 1.4 Was heute gilt (die Vergleichsbasis)

```
bergauf   f = min(4,0 ; 1 + 10·g)                     — für ALLE Transportmittel gleich
bergab    f = 1,0                       für a ≤ 0,20
          f = min(4,0 ; 1 + a / 0,15)   für a > 0,20  — auf den VOLLBETRAG, nicht den Überschuss
```

Zwei Eigenschaften des Ist-Zustands, die der Vorschlag ändern will:

1. **Kein Transportmittelunterschied.** Fußgänger und Kutsche bekommen bei 30 % Steigung denselben
   Faktor 4,0. Eine Kutsche kommt einen 30-%-Hang real nicht hinauf.
2. **Ein Sprung bei 20 % Gefälle.** Bei 20,00 % kostet ein Gefälle nichts, bei 20,01 % kostet es das
   **2,33-fache**, weil der *ganze* Abstieg des Abtastschritts gezählt wird, nicht nur der Anteil
   über der Schwelle. Kein publiziertes Modell hat dort eine Unstetigkeit.

---

## 2. Herkunft jedes einzelnen Parameters

🔴 **Die Spalte „Güte" ist der Kern dieses Auftrags.** Prüfe sie einzeln. Ein als „gemessen"
ausgewiesener Parameter, der in Wahrheit geschätzt ist, ist ein schwerer Befund.

| Parameter | Wert | Güte | Herkunft |
|---|---|---|---|
| `c` zu Fuß | 0,100 | **gemessen** | Minetti 2002, siehe §2.1 |
| `c` beritten | 0,079 | **gemessen** | Schroter 2002, siehe §2.2 |
| `c` Kutsche | 0,050 | **hergeleitet** | Rollreibung + Zugtiergewicht, §2.3 |
| `c` Karawane | 0,090 | **geschätzt** | interpoliert zwischen 0,079 und 0,100 |
| `g₀` zu Fuß / Karawane / beritten | 0,20 / 0,16 / 0,20–0,22 | **teilbelegt** | Langmuir 1984: 12° = 21,3 %, §2.4 |
| `c_ab` zu Fuß | 0,150 | **teilbelegt** | Leistungskilometer-Konvention, gegen Langmuir geprüft, §2.4 |
| `g₀` Kutsche | 0,03 | **hergeleitet** | Rollreibungsschwelle, §2.5 |
| `c_ab` Kutsche | 0,035 | **kalibriert** | auf Schrittempo bei 10 % (Hemmschuh), §2.5 |
| `c_ab` beritten | 0,0618 / 0,0616 | **rückgerechnet** | aus der Konvergenzbedingung, §2.6 |
| alle `gmax` | 12–45 % | **geschätzt** | nur qualitative historische Belege, §2.7 |
| `FCAP` | 4,0 | **Setzung** | Owner-Entscheid 2026-07-30, §2.8 |

### 2.1 `c` zu Fuß = 0,10 — Minetti 2002

**Quelle:** Minetti, Moia, Roi, Susta, Ferretti (2002), *Energy cost of walking and running at extreme
uphill and downhill slopes*, Journal of Applied Physiology 93(3):1039–1046.
https://journals.physiology.org/doi/full/10.1152/japplphysiol.01177.2001

Gemessen wurden die Stoffwechselkosten des Gehens auf dem Laufband von **−45 % bis +45 %**. Das
gängig zitierte Polynom für die Gehkosten in J·kg⁻¹·m⁻¹:

```
Cw(i) = 280,5·i⁵ − 58,7·i⁴ − 76,8·i³ + 51,9·i² + 19,6·i + 2,5      gültig |i| ≤ 0,45
```

**Die Brückenannahme — und sie ist der angreifbarste Punkt des ganzen Vorschlags:**

> Zeitfaktor = Kostenverhältnis, weil ein Reisender auf einer Mehrtagesreise **Leistung** hält,
> nicht Tempo. Wer täglich zwölf Stunden geht, geht am Rand des Nachhaltigen; wird der Weg doppelt
> so teuer, wird er doppelt so langsam.

Daraus `f(g) = Cw(g)/Cw(0)`. Die lineare Näherung `1 + 10g` trifft das:

| Steigung | Minetti | `1 + 10g` | Abweichung |
|---|---|---|---|
| 5 % | 1,44 | 1,50 | +4,2 % |
| 10 % | 1,96 | 2,00 | +2,0 % |
| 15 % | 2,54 | 2,50 | −1,6 % |
| 20 % | 3,15 | 3,00 | −4,8 % |
| 30 % | 4,47 | 4,00 (Deckel) | −10,5 % |
| 40 % | 6,04 | 4,00 (Deckel) | −33,8 % |

### 2.2 `c` beritten = 0,079 — Schroter 2002

**Quelle:** Schroter, Marlin, Jeffcott (2002), *Modelling the oxygen cost of transport in competitions
over ground of variable slope*, Equine Veterinary Journal 34(S34):397–401.
https://beva.onlinelibrary.wiley.com/doi/abs/10.1111/j.2042-3306.2002.tb05455.x

Angegebene Transportkosten, gültig von −0,3 bis +0,3:

```
bergauf/eben:  COT = 0,123 + 1,561·g
bergab:        COT = 0,123 + 1,591·g + 9,762·g² + 14,0·g³        (g negativ)
```

Verhältnis bergauf: `COT(g)/COT(0) = 1 + (1,561/0,123)·g = 1 + 12,69·g`, also `c = 0,123/1,561 =
0,0788`.

⭐ **Das Pferd ist steigungs*empfindlicher* als der Mensch** (0,079 gegen 0,100). Es ist in der Ebene
nur schneller. Diese Aussage ist gemessen und kontraintuitiv — prüfe sie besonders.

### 2.3 `c` Kutsche = 0,05 — hergeleitet

Kein Fundstück mit Zahl. Hergeleitet aus dem Widerstandsansatz: der Hang addiert seine Neigung auf
*jede* Masse, die hinaufmuss — Tier **und** Wagen.

```
c ≈ (m_Tier·0,10 + m_Wagen·0,03) / (m_Tier + m_Wagen)
```

Mit Rollreibung Wagen ≈ **0,03** und Wagen+Last ≈ **3×** Zugtiermasse:
`(1·0,10 + 3·0,03)/4 = 0,0475 ≈ 0,05`.

⚠️ **Beide Eingangsgrößen sind Schätzungen.** Die Rollreibung eisenbereifter Wagen auf historischen
Straßenbelägen und das Massenverhältnis sind nicht belegt. Ein früherer Entwurf setzte `c = 0,035`
(nur Wagenrollreibung, ohne Zugtier) — damit fiel die Kutsche schon bei 2 % Steigung hinter
Fußgänger zurück, was unplausibel wirkte. Der jetzige Wert ist also **auch durch Plausibilität
mitbestimmt**, nicht allein durch Herleitung. Das ist offenzulegen und zu prüfen.

### 2.4 `g₀` = 0,20 und `c_ab` = 0,15 zu Fuß — Langmuir 1984

**Quelle:** Langmuirs Korrektur zu Naismiths Regel, zusammengefasst unter
https://en.wikipedia.org/wiki/Naismith%27s_rule — Primärquelle: Eric Langmuir, *Mountaincraft and
Leadership* (1984).

Wortlaut: für Gefälle **zwischen 5° und 12°** zehn Minuten je 300 m Abstieg **abziehen**, für Gefälle
**über 12°** zehn Minuten je 300 m **addieren**. `tan(12°) = 0,2126`.

⭐ **Damit hat die 20-%-Schwelle einen echten Stammbaum — aber einen anderen, als im Live-Dialog
steht.** Dort steht „DIN 33466, Marschzeitrechnung der Alpenvereine". Das sind **drei verschiedene
Verfahren**: der Leistungskilometer schlägt auf die *Strecke* auf (das ist implementiert), DIN 33466
und die SAC-Methode sind *Zeit*formeln mit Halbierungsregel (nicht implementiert). Diese
Fehletikettierung ist **live und unkorrigiert**.

Umrechnung von Langmuirs Zeitregel in einen Faktor, Grundtempo Naismith 5 km/h: 10 min entsprechen
0,833 km, also 1 Zusatzkilometer je **360 m** Abstieg — nicht je 150. Als Faktor auf den Vollbetrag:
`f = 1 + a·1000/360 = 1 + 2,78·a`.

Vergleich der Bergab-Formen:

| Gefälle | heute (Vollbetrag /150) | Vorschlag (Überschuss /150) | Langmuir | Minetti (Kraft) |
|---|---|---|---|---|
| 20 % | 1,00 | 1,00 | 1,00 | 0,43 |
| 21 % | **2,40** | 1,07 | 1,00 | 0,46 |
| 25 % | 2,67 | 1,33 | 1,69 | 0,62 |
| 30 % | 3,00 | 1,67 | 1,83 | 0,88 |
| 40 % | 3,67 | 2,33 | 2,11 | 1,40 |

Die Überschussform hält den Koeffizienten 150 bei, entfernt aber die Unstetigkeit und trifft Langmuir
über den ganzen Bereich innerhalb von rund 20 %.

⚠️ **Langmuir gibt bei 5°–12° einen BONUS, Minetti sogar einen großen** (bei 10–15 % Gefälle die
niedrigsten Kosten überhaupt, unter der Ebene). Der Vorschlag gibt **keinen Bonus** — Owner-Entscheid
2026-07-30, nachdem Bergab-Boni öffentlich Feuer gefangen hatten. Das ist eine **bewusste Abweichung
von den Quellen** in Richtung konservativ. Prüfe, ob sie als solche vertretbar ist oder ob sie das
Modell an anderer Stelle verzerrt.

### 2.5 Kutsche bergab: `g₀ = 0,03`, `c_ab = 0,035`

`g₀ = 0,03`: die Neigung, bei der die Hangabtriebskraft den Rollwiderstand des Wagens übersteigt —
darunter ziehen die Tiere, darüber schiebt die Last und muss gehalten werden. Folgt aus derselben
geschätzten Rollreibung 0,03 wie in §2.3.

`c_ab = 0,035`: kalibriert, damit die Kutsche bei **10 % Gefälle** auf Schrittgeschwindigkeit fällt.
Begründung ist historisch, aber **qualitativ**: auf steilen Abfahrten wurden Hemmschuhe eingesetzt —
Stahlschlitten unter den Hinterrädern, mit Kette gesichert, sodass die Räder blockierten und der
Wagen schlitterte; darüber blieb nur Abseilen oder Ausspannen.
https://ranchridecarriagedrive.com/2022/08/08/drag-shoes-the-nitty-gritty/ ·
http://wheelsthatwonthewest.blogspot.com/2012/07/wagon-brakes.html ·
https://smallfarmersjournal.com/the-anatomy-of-the-farm-wagon-brake-system/

⭐ Bergab ist für Fuhrwerke die **schwierigere** Richtung (`gmax_ab` 12 % gegen `gmax_auf` 15 %), weil
bergauf Kraft fehlt — die sich hinzufügen lässt (Doppelbespannung) — und bergab Kontrolle, die sich
nicht hinzufügen lässt. Bei rund 11 % kostet der Abstieg mehr als der Aufstieg.

### 2.6 `c_ab` beritten = 0,062 — rückgerechnet

**Keine Quelle.** Gesetzt über eine Konstruktionsbedingung:

> Im steilen Gefälle steigt der Reiter ab und führt. Also soll die berittene Kurve **an ihrer
> Gefällegrenze genau auf dem eigenen Fußtempo landen**.

Allgemein: `c_ab = (gmax_ab − g₀) / (v_beritten / v_Fußtempo(gmax_ab) − 1)`.

Reiter leicht (7,0 auf „Weg", Grenze 35 %, Fußäquivalent „zu Fuß leicht" 4,5):
Fußtempo bei 35 % = `4,5/(1+(0,35−0,20)/0,15) = 2,25`. Also `f(0,35) = 7,0/2,25 = 3,1111`, und mit
`g₀ = 0,22` folgt `c_ab = 0,13/2,1111 = **0,061579**`.
Reisegruppe zu Pferd (5,5, Grenze 30 %, Fußäquivalent „Gruppe zu Fuß" 3,5): `c_ab = **0,061765**`.

🔴 **BEKANNTER DEFEKT — beim Schreiben dieses Auftrags selbst gefunden, nicht repariert.**

Die Bedingung hängt am Verhältnis der Grundgeschwindigkeiten, und das ist **je Wegtyp verschieden**.
Über alle sieben Wegtypen ausgewertet:

| Wegtyp | `c_ab` Gruppe beritten | `c_ab` Reiter leicht |
|---|---|---|
| Reichsstraße | 0,0628 | 0,0622 |
| Straße | 0,0585 | 0,0591 |
| Weg | 0,0618 | 0,0616 |
| Pfad | 0,0667 | 0,0650 |
| Gebirgspass | 0,0563 | 0,0650 |
| **Wüstenpfad** | **0,1000** | **0,1011** |
| Querfeldein | 0,0556 | 0,0670 |

Spanne: **Faktor 1,8**. Der Ausreißer Wüstenpfad kommt daher, dass dort beritten und zu Fuß fast
gleich schnell sind (3,0 gegen 2,5) — die Kurve hat also kaum Abstand zu überbrücken.

**`c_ab` ist damit keine Konstante des Transportmittels.** Entweder werden es 42 Konstanten
(Transportmittel × Wegtyp) statt sechs, oder die Konvergenzbedingung fällt.

Gemessen, wenn man sie fallen lässt und **eine** feste Konstante 0,062 nimmt: an der Gefällegrenze
ist beritten dann im schlimmsten Fall **7,2 % schneller** als zu Fuß (Querfeldein), im günstigsten
26 % langsamer (Wüstenpfad). Der Regelverstoß ist also klein.

⚠️ **Deine Aufgabe hier ist zu entscheiden, nicht zu bestätigen:** 42 Konstanten, eine Konstante mit
7 % Verstoß, oder ein ganz anderer Mechanismus für „im steilen Gefälle steigt man ab". Ein vierter
Weg wäre eine Klemme auf das Fußtempo — die erzeugt aber genau den Sprung an der Schwelle, den der
Vorschlag beim Gefälle gerade beseitigen will. Prüfe auch das nach, statt es zu glauben.

⚠️ Eine frühere Fassung wollte dasselbe über ein `min()` gegen das Fußtempo erreichen. Das erzeugte
einen **Sprung an der Schwelle** — genau der Fehler, den der Vorschlag beim Gefälle beseitigen will.
Die Rückrechnung vermeidet ihn. Prüfe, ob sie ihn wirklich vermeidet.

### 2.7 Die Grenzen `gmax` — geschätzt

**Für keine dieser Zahlen wurde eine Quelle mit Prozentangabe gefunden.** Belegt ist nur qualitativ,
dass steile Anstiege Doppel- oder Dreifachbespannung und steile Abfahrten Abseilen erforderten
(https://en.wikipedia.org/wiki/Wagonway und die Hemmschuh-Quellen oben). Ein Aufsatz *The Grade of
Wagon Roads* (JSTOR 44709413) wäre einschlägig, war aber nicht zugänglich (HTTP 403) — **wer ihn
beschaffen kann, sollte es tun.**

Die Werte sind Ermessen und ausdrücklich als Stellschrauben gedacht.

### 2.8 `FCAP = 4,0` — Setzung

Owner-Entscheid 2026-07-30. Gemessen kappte er 20 von 4.080 Land-Wegstückrichtungen (0,49 %), und
diese 20 sind Artefakte des Platzhalter-Geländes. **Minetti sagt bei 40 % Steigung 6,04** — oberhalb
30 % ist der Deckel die Hauptabweichung des Modells von den Messungen. Zu prüfen, ob das gewollt ist.

---

## 3. Was du konkret tun sollst

Arbeite die Aufgaben ab und gib zu **jeder** ein Urteil: **bestätigt / widerlegt / nicht prüfbar**,
jeweils mit Zahl oder Quelle. Kein „wirkt plausibel".

### T1 — Rechne Minetti nach
Werte das Polynom aus §2.1 selbst aus und vergleiche mit `1 + 10g`. Melde die maximale Abweichung in
0–20 %, 0–30 % und 0–45 %. **Prüfe ausdrücklich, ob das zitierte Polynom das der Publikation ist** —
das Papier nennt an anderer Stelle ein Kostenminimum von 1,64 J·kg⁻¹·m⁻¹, das Polynom liefert bei
i = 0 den Wert 2,5. Kläre, ob das ein Widerspruch ist oder zwei verschiedene Größen.

### T2 — Prüfe die Brückenannahme
Der ganze Aufstiegsteil steht und fällt mit „Zeitfaktor = Kostenverhältnis" (§2.1). Suche
Gegenbelege: Modelle, die Geschwindigkeit *direkt* messen (Tobler; Irmischer & Clarke 2018,
https://findingspress.org/article/28107-hiking-with-tobler-tracking-movement-and-calibrating-a-cost-function-for-personalized-3d-accessibility)
liefern deutlich flachere Kurven — Irmischer & Clarke nur Faktor 1,27 bei 20 % Steigung, wo Minetti
3,15 sagt. **Das ist ein Faktor 2,5 Unterschied und der größte offene Streit im ganzen Vorschlag.**
Arbeite heraus, welche Kurve für eine mehrtägige Reise mit Gepäck die richtige ist und warum. Ist die
Antwort „Irmischer", fällt der Vorschlag in sich zusammen.

### T3 — Prüfe `c` beritten
Beschaffe Schroter 2002 oder eine Sekundärquelle und verifiziere die Koeffizienten 0,123 und 1,561
sowie den Gültigkeitsbereich. Prüfe, ob Transportkosten eines Pferdes überhaupt in denselben
Zeitfaktor übersetzt werden dürfen wie beim Menschen (dasselbe Argument aus T2, andere Spezies).

### T4 — Beschaffe echte Fuhrwerkszahlen
Die schwächste Stelle. Suche belastbare Angaben zu: Rollwiderstandsbeiwert eisenbereifter
Wagenräder auf Makadam / Schotter / unbefestigt; historische Regelsteigungen im Straßenbau für
Fuhrwerke; Grenzsteigungen mit und ohne Doppelbespannung. Melde Spannen mit Belegstelle. Falls du
nichts findest: **sag das ausdrücklich**, statt zu interpolieren.

### T5 — Prüfe die Bergab-Umrechnung
Rechne Langmuirs „10 min je 300 m" selbst in einen Faktor um und vergleiche mit §2.4. Prüfe die
Behauptung, dass die 150-Schritt-Konstante ein **Anstrengungs**maß ist, das hier als **Zeit**maß
verwendet wird.

### T6 — Prüfe die innere Stimmigkeit
Werte alle sechs Kurven auf beiden Seiten von −45 % bis +45 % aus und prüfe:
- Springt irgendwo etwas? (Es darf nirgends springen.)
- Landen die berittenen Modi an ihrer Gefällegrenze tatsächlich auf ihrem Fußtempo? (Sollte per
  Konstruktion exakt aufgehen — rechne es nach, nicht nur die Absicht.)
- Überholt irgendein Transportmittel ein anderes an einer unplausiblen Stelle?
- Wo erreicht jede Kurve `FCAP`, und liegt das vor oder hinter ihrer Sperre?
- Auf „Weg" fällt die Kutsche laut Vorschlag bei **4 % Steigung** hinter die Reisegruppe zu Fuß
  zurück, auf Reichsstraße bei 5 %. Prüfe das nach und beurteile, ob es plausibel ist.

### T7 — Prüfe gegen die Spielwelt
Avesmaps ist ein DSA-Fanprojekt. **Prüfe, ob das offizielle DSA-Regelwerk eigene Aussagen zu
Reisegeschwindigkeit im Gebirge, zu Fuhrwerken oder zu Geländeaufschlägen macht**, und ob der
Vorschlag ihnen widerspricht. Ein Modell, das der Physik folgt und dem Regelwerk widerspricht, ist
für dieses Publikum möglicherweise das falsche Modell. Diese Frage wurde bisher **von niemandem
gestellt**.

### T8 — Prüfe die Datenlage im Code
Lies `api/_internal/app/terrain-store.php` (Profillauf) und `api/_internal/routing/terrain-factor.php`
sowie `terrain-read.php` und `client-graph.php`. Beantworte:
- Was speichert `profile_json` genau, und **kann daraus eine transportmittelabhängige Schwelle
  überhaupt beantwortet werden?** (Die Behauptung des Vorschlags lautet: nein — gespeichert sind vier
  Zahlen je Wegstück, darunter die Summen oberhalb einer **fest verdrahteten** 20-%-Schwelle. Eine
  3-%-Schwelle für die Kutsche lässt sich daraus nicht rekonstruieren.)
- Trifft es zu, dass Hin- und Rückrichtung bereits getrennt bepreist werden?
- Was würde ein Histogramm je Wegstück (Abstiegssumme in ~8 Neigungsbändern) kosten, und löst es das
  Problem wirklich für *jede* künftige Schwelle?

### T9 — Suche die Nebenwirkungen
- Sperren können Routen unauffindbar machen („keine Route gefunden" für die Kutsche). Ist das
  vertretbar? Der Planer macht es bei Wasserwegen bereits so.
- Der Faktor liegt heute **auf der Graphkante** und wird von allen Transportmitteln geteilt. Was
  bricht, wenn er transportmittelabhängig wird — Wegpunkt-Anker, Reiseplan-Etappen,
  Geschwindigkeitspfeile, Zwischenspeicher?
- Verändert der Vorschlag die Bepreisung (`ascent_schritt`) oder nur die Zeit?

### T10 — Nenne, was fehlt
Was hat der Vorschlag gar nicht bedacht? Kandidaten, die mir eingefallen sind und die ich **nicht**
abgedeckt habe: Wetter und Untergrundzustand, Kurvenradien (ein Fuhrwerk scheitert auch an engen
Kehren, nicht nur an der Neigung), Tageslänge im Gebirge, das Gewicht der Ladung als eigener
Parameter statt als Teil des Transportmittels, Höhenlage (dünne Luft). Ergänze.

---

## 4. Handwerkliches

**💣 Der lokale Arbeitsbaum hinkt hinterher.** Immer zuerst:

```bash
git fetch origin master && git log --oneline -3 origin/master
```

Dann einen **eigenen** Worktree — **nie den geteilten Baum umstellen**, mehrere Sessions arbeiten
darin, teils mit unfertigen Änderungen:

```bash
git worktree add --detach <scratchpad>/pruef origin/master
```

Danach `git worktree remove --force`. **Nie `git add -A`.**

**Tests, die grün sein müssen** (aus der Wurzel des Worktrees):

```bash
node js/routing/__tests__/route-terrain-summary.test.js
node js/routing/__tests__/route-entry-terrain.test.js
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/terrain-factor-test.php
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/terrain-read-test.php
```

⚠️ **Ohne `-d zend.assertions=1` prüft `assert()` NICHTS** und der Test meldet falsch grün.

**Live-Daten:** Browserzugriff auf `avesmaps.de` ist in Agent-Sessions gesperrt, also `curl`.
💣 **STRATO: EINE Anfrage, nie in einer Schleife** — ein Loop über teure Endpunkte sättigt die
PHP-Worker und sieht aus wie ein Datenbankausfall.

```bash
curl -s --max-time 90 -X POST "https://avesmaps.de/api/route/" -H "Content-Type: application/json" \
  -d '{"from":"Lowangen","to":"Greifenfurt","enabled_transports":{"land":true,"river":false,"sea":false},"include_geometry":false}'
```

Das Segmentfeld heißt **`distance_units`** (Karteneinheiten, × 3 = Meilen), nicht `distance`.

---

## 5. Kontrollzahlen

Wenn deine Rechnung diese Werte nicht reproduziert, hat einer von uns einen Fehler — melde es.
Alle mit `FCAP = 4,0`, Wegtyp „Weg".

**Faktoren, Vorschlag:**

| | Kutsche | Karawane | Gr. beritten | Reiter | Gr. zu Fuß | Fuß leicht |
|---|---|---|---|---|---|---|
| 10 % Steigung | 3,000 | 2,111 | 2,266 | 2,266 | 2,000 | 2,000 |
| 20 % Steigung | gesperrt | 3,222 | 3,532 | 3,532 | 3,000 | 3,000 |
| 10 % Gefälle | 3,000 | 1,000 | 1,000 | 1,000 | 1,000 | 1,000 |
| 30 % Gefälle | gesperrt | gesperrt | 2,618 | 2,299 | 1,667 | 1,667 |

**Meilen/h auf „Weg" (Ebene: 4,5 / 3,0 / 5,5 / 7,0 / 3,5 / 4,5):**

| | Kutsche | Karawane | Gr. beritten | Reiter | Gr. zu Fuß | Fuß leicht |
|---|---|---|---|---|---|---|
| Ebene | 4,50 | 3,00 | 5,50 | 7,00 | 3,50 | 4,50 |
| 10 % Steigung | 1,50 | 1,42 | 2,43 | 3,09 | 1,75 | 2,25 |
| 20 % Steigung | — | 0,93 | 1,56 | 1,98 | 1,17 | 1,50 |
| 10 % Gefälle | 1,50 | 3,00 | 5,50 | 7,00 | 3,50 | 4,50 |
| 30 % Gefälle | — | — | **2,10** | 3,05 | **2,10** | 2,70 |

Die beiden fett gesetzten 2,10 sind die Konvergenzbedingung aus §2.6 (exakt 2,1007 gegen 2,1000 —
der Rest ist die Rundung von `c_ab` auf vier Stellen). ⚠️ Sie gilt **nur auf dem Wegtyp „Weg"**;
siehe den bekannten Defekt in §2.6.

**Ist-Zustand zum Vergleich** (alle Transportmittel gleich): 10 % Steigung → 2,000 · 20 % Steigung →
3,000 · 20,00 % Gefälle → 1,000 · 20,01 % Gefälle → **2,334** · 30 % Gefälle → 3,000.

**Koschberge-Anker, live gemessen:** 668,98 Schritt Aufstieg auf 2,799 Meilen = 23,90 % Steigung.
Ist-Modell: Faktor 3,3901, aus 4,5 Meilen/h werden 1,327.

### 5.1 Referenzimplementierung — schreib das Modell nicht ab, führ es aus

`docs/assets/steigungsmodell-referenz.php` enthält den **vollständigen Vorschlag, den Ist-Zustand und
die drei Vergleichsmodelle** als lauffähiges PHP ohne Abhängigkeit vom Repo:

```bash
php docs/assets/steigungsmodell-referenz.php
```

Es druckt neun Blöcke A–I: die beiden Kontrolltabellen oben, den Ist-Zustand, den Aufstieg gegen
Minetti und Schroter, den Abstieg gegen Langmuir und Minetti, den Defekt aus §2.6 über alle sieben
Wegtypen, den gemessenen Regelverstoß bei fester Konstante, die Kutschen-Überholpunkte und einen
Stetigkeitstest.

⚠️ **Das Skript ist Teil des Prüfgegenstands, nicht Beweismittel.** Es implementiert denselben
Vorschlag von derselben Hand — wenn die Herleitung falsch ist, ist es auch das Skript. Nutze es, um
Abschreibfehler auszuschließen, und rechne die Herkunft trotzdem unabhängig nach.

Zwei Ergebnisse daraus, die im Text oben nicht stehen:

**Block I — Stetigkeit.** In 0,1-%-Schritten von −45 % bis +45 % ist der größte Sprung im Vorschlag
**0,0286** (reine Abtastauflösung, kein Sprung), im Ist-Zustand **1,3400 bei genau −20,0 %**. Das ist
die Kante, quantifiziert. Prüfe sie mit feinerer Schrittweite nach — der Vorschlag darf auch bei
0,001-%-Schritten nirgends springen.

**Block H — die Kutsche auf dem Pfad.** Sie fällt dort schon bei **0,00 %** hinter die Reisegruppe zu
Fuß zurück, weil beide in der Ebene mit 3,0 Meilen/h geführt werden. Das ist keine Eigenschaft des
Vorschlags, sondern der bestehenden `SPEED_TABLE` — beurteile, ob das ein Datenfehler ist, der
unabhängig von diesem Vorschlag repariert gehört.

---

## 6. Abgabe

1. Ein Urteil je Aufgabe T1–T10: **bestätigt / widerlegt / nicht prüfbar**, mit Zahl oder Quelle.
2. Eine überarbeitete Fassung der Gütetabelle aus §2 — **deine** Einstufung, nicht meine.
3. Die Liste der Parameter, die du für **nicht haltbar** hältst, mit Gegenvorschlag oder mit der
   Feststellung, dass es keine belastbare Zahl gibt.
4. Deine Antwort auf T7 (DSA-Regelwerk) — falls dort etwas steht, ist es möglicherweise wichtiger
   als alles andere in diesem Dokument.
5. **Ein Satz am Anfang:** taugt der Vorschlag als Grundlage für den Umbau, ja oder nein.

Nichts bauen. Nichts committen außer diesem Bericht, falls dich jemand ausdrücklich darum bittet.
