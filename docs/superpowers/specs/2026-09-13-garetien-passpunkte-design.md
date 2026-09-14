# Passpunkte für den Garetien-Import — trägt eine Korrektur aus Fixpunkten?

> Stand: 14.09.2026. Entwurf **und** Messbericht. Der Bauteil-Teil ist gebaut und getestet;
> der Mess-Teil ist **gelaufen** (Lauf 20 gegen die Live-Datenbank, §3.1): **keine**
> Korrekturmatrix — die ausgelieferte hat den systematischen Fehler schon aufgenommen.

## 1. Der Auftrag

Der Owner, sinngemäß: der Garetien-Importer braucht für seine importierte Geometrie eine
Transformation — eine Scher-/Skalierungsmatrix, die leichte Drifts korrigiert. Dafür sollen
**Fixpunkte** bestimmt werden, die auf beiden Karten vorkommen. *„bevor wir das machen sind
umfangreiche tests erforderlich"*, und die konkrete Aufgabe: *„rausfinden ob die genannten
verschiebungen andere kanonische orte auf beiden karten korrigieren würden."*

Die Editoren haben im Gespräch genannt:

| Ort | gemeldet |
|---|---|
| Hesindelburg | nach Süden versetzt |
| Waldrast | nach Norden versetzt |
| Koschtal, Rockenwald | kein nennenswerter Versatz |
| Greifenfurt | leichte Abweichung nach **Südost** |
| Perricum | leichte Abweichung nach Nordost |
| Eslamsroden, Drift, Fürstenhort | keine Abweichung |
| Rhondur | als Beispiel „links unten" genannt |

Dazu zwei Beobachtungen, die einander widersprechen und deshalb beide in der Messung stehen
müssen: *„bei den Inseln im Osten war die Abweichung ziemlich stark"* — und, als Bauchgefühl,
*„Je weiter es nach Westen geht, desto stärker verschiebt GGP nach Süden."*

🔴 **Die eigentliche Frage ist nicht, ob es Versätze gibt — sondern ob sie ZUSAMMENHÄNGEN.**
Ein gemessener Versatz an Greifenfurt hilft dem nächsten Dorf nur dann, wenn benachbarte Orte
in dieselbe Richtung abweichen. Tun sie es nicht, ist der Versatz die Zeichendifferenz zweier
von Hand gemalter Fankarten — und wer ihn wegrechnet, **verschiebt die Orte, die heute richtig
liegen**. Genau das beantwortet die Nachbarprobe in §4.

---

## 2. 💣 Der Befund, der alles Weitere erst nötig macht

Der bestehende Entwurf (`2026-08-26-garetien-kartenimport-design.md` §2.2) verbietet das
Warpen und stützt das auf zwei Belege. **Der erste ist zirkulär.**

Dort steht, die Residuen korrelierten „null mit der Position (0,014 / 0,003 / −0,003 /
−0,001)", es gebe also keine systematische Verzerrung. Diese vier Zahlen sind aber eine
**algebraische Identität**: die Residuen einer Kleinste-Quadrate-Anpassung stehen auf jeder
Spalte ihrer Entwurfsmatrix senkrecht, und die Spalten *sind* `gx`, `gy` und die Eins. Die vier
Korrelationen **müssen** null sein — sonst hat der Löser nicht konvergiert.

Nachgemessen am 13.09.2026: ein Datensatz mit einer absichtlich eingebauten **quadratischen
Verzerrung von 36 Meilen Amplitude** (Residuenstreuung 10,7 bzw. 8,0 Meilen) liefert dieselben
vier Nullen — auf fünf Stellen. Ein solcher Test kann eine Verzerrung nicht finden, so groß sie
auch ist. Festgehalten in `garetien-passpunkte-test.php` §D.

⭐ **Was §2.2 wirklich trägt, ist die andere Hälfte**: die Kreuzvalidierung gegen den
Thin-Plate-Spline (2,30 gegen 1,24 Meilen Median, out-of-sample). Die ist gültig und bleibt
stehen. Der Satz *„Wer später doch warpt, muss diese Messung zuerst widerlegen"* zeigt aber auf
die falsche Hälfte — und deshalb ist die Frage der Editoren **offen**, nicht beantwortet.

⚠️ Zu ergänzen ist §2.2 dort, wo es steht — dieser Entwurf ersetzt ihn nicht.

---

## 3. 🚩 Was die fünf echten Passpunkte des Repos schon sagen

Der Fit vom 26.08.2026 lief gegen die Live-Datenbank; **nur die sechs Zahlen der Matrix haben
überlebt**, die 148 Passpunkte nicht. Im Repo stehen fünf echte Ortspaare, als Fixtures in
`garetien-koordinaten-test.php`. Ihre Residuen gegen die **ausgelieferte** Matrix:

| Ort | x (Ost) | dx | dy | Betrag | Richtung |
|---|---|---|---|---|---|
| Ferdok | 493 | −0,05 | −0,90 | 0,90 | Süd |
| Greifenfurt | 508 | +1,32 | −1,06 | 1,69 | **Südost** |
| Zwerch | 589 | +0,36 | −0,28 | 0,45 | kein |
| Rommilys | 597 | +0,02 | −0,56 | 0,56 | Süd |
| Beilunk | 678 | −0,72 | −3,08 | 3,17 | Süd |

*(dx > 0 = der Import legt den Ort östlich von unserem ab, dy > 0 = nördlich.)*

Drei Dinge stehen darin:

1. ✅ **Greifenfurt weist nach Südost — wörtlich wie gemeldet.** Das ist der einzige Punkt, an
   dem sich eine Editoren-Meldung und die Rechnung im Repo begegnen, und sie sind sich einig.
   Der Blick der Editoren ist also kalibriert; ihre Meldungen sind belastbare Beobachtungen.
2. 🚩 **Alle fünf liegen südlich**, im Mittel 1,18 Meilen. Fünf Punkte können das bei reinem
   Zufall in einem von 32 Fällen — ein **Hinweis, kein Befund**. Aber die Editoren melden
   unabhängig davon dieselbe Richtung, und ein globaler Süd-Versatz wäre die billigste aller
   Korrekturen.
3. ❌ **Das Bauchgefühl „je weiter Westen, desto weiter Süden" wird von diesen fünf NICHT
   gestützt** — die gemessene Neigung ist mit −0,30 Meilen/100 sogar leicht gegenläufig
   (p = 0,33, also nichts). Der am weitesten *östliche* Punkt, Beilunk, ist mit 3,08 Meilen der
   südlichste Ausreißer. Das passt zur *anderen* Beobachtung desselben Gesprächs („bei den
   Inseln im Osten war die Abweichung ziemlich stark") und widerspricht dem Bauchgefühl.

⚠️ **Fünf Punkte sind kein Beleg**, und das Werkzeug sagt das auch: unter 20 Passpunkten gibt
`avesmapsGaretienPasspunktUrteil` grundsätzlich *kein* Urteil ab.

### 3.1 🚩 Der Messlauf vom 14.09.2026 — 205 echte Paare, und die Antwort ist nein

Gefahren in der Editor-Sitzung des Owners: EIN Aufruf `action=passpunkte` gegen **Lauf 20**
(Handgriff §6), danach das **unveränderte** `tools/garetien/passpunkte-auswerten.php`. Die
Rohpaare liegen bewusst **nicht** im Repo (`docs/repository-data-policy.md`) — hier stehen nur
Kennzahlen.

Bericht des Endpunkts: 1.990 ihrer und 3.011 unserer Ortspunkte, **204 Paare**, 36 Namen als
mehrdeutig verworfen, 1.750 nur bei ihnen.

🔴 **Vorzeichen in diesem Abschnitt: Änderung, + = steigt (schlechter).** Das Werkzeug druckt
umgekehrt den *Gewinn* `(vorher − nachher) / vorher`, ebenso die Simulationstabelle der Übergabe
(§4 dort) — dort heißt ein Minus „wird schlechter".

#### Zuerst die Selbstprüfung — und sie hat NICHT gereicht

| | Median | Mittel | p90 | Summe | größtes Residuum |
|---|---|---|---|---|---|
| alle 204 Paare | 1,99 mi | **77,2 mi** | **382,7 mi** | 15.753 mi | 1.468 mi |
| nach dem Schnitt ≤ 25 mi (168 Paare) | **1,33 mi** | 2,97 mi | 8,03 mi | 498 mi | 21,6 mi |

💣 **Die Selbstprüfung des Endpunkts meldete „ok"** — sie prüft nur den Median, und der lag mit
1,99 Meilen unauffällig. Das Mittel lag **39-mal** darüber. Ursache waren nicht die Achsen (die
echten Paare liegen im Meilenbereich, Greifenfurt trifft die Tabelle oben auf die Hundertstel),
sondern **37 Paare über 25 Meilen**, 31 davon über 200: gleichnamige, aber verschiedene Orte, die
auf jeder Karte nur EINMAL vorkommen und darum am Mehrdeutigkeitsfilter vorbeikommen. Beispiele:
„Dreiwegen" liegt bei uns im hohen Norden, „Weidensee" und „Waldheim" Hunderte Meilen im Osten,
und „Weißenstein" wie „Burg Weißenstein" hängen bei Garetien an derselben Koordinate, bei uns an
zwei verschiedenen Stellen. ⚠️ Die sechs zwischen 34 und 153 Meilen sind nicht einzeln geprüft.
⭐ **Die Verteilung trennt sie sauber:** das größte Residuum darunter liegt bei **21,6 Meilen**,
das nächste bei **33,9**. Geschnitten wird deshalb bei 25 Meilen gegen die eingefrorene Matrix.
Das kann keinen systematischen Fehler wegschneiden — jeder in der Übergabe simulierte macht über
Garetien höchstens ein paar Meilen aus —, und die Schlussfolgerung hängt nicht am Schnitt
(Tabelle unten, 10 und 50 Meilen). Der Median danach, 1,33, passt zu den 1,24 aus §2.1.
🚩 **Ohne den Schnitt wäre das Ergebnis Unsinn gewesen, und zwar überzeugender Unsinn.** Der
Endpunkt meldete einen West-Süd-Trend von **−40,9 Meilen je 100 Meilen bei p = 0,0005** und einen
globalen Versatz von dx −11,7 / dy −22,8 Meilen — beides allein aus den Falschpaaren. Die
Kalibrierprobe über alle 204 Paare lag bei ±0,5 %, weil 15.000 Meilen Falschpaar-Summe jede
Korrektur verschlucken. Der Median zeigt von alldem nichts.

#### Die Kalibrierorte

**8 der 11** genannten sind dabei. **Eslamsroden** fiel beim Endpunkt als mehrdeutig heraus:
Garetien führt es als Burg UND als Reichsstadt, 0,85 Meilen auseinander, also derselbe Ort. Die
Reichsstadt wurde von Hand gepaart (Lage aus `action=liste`, über die exakte Inverse der
ausgelieferten Matrix auf Wagenhalt zurückgerechnet, Rundlauf 0). **Fürstenhort** hat bei
Garetien keinen platzierten Ortspunkt (nur Grenzen und einen Tempel ohne Koordinate).
**Rockenwald** und **Rhondur** gibt es auf unserer Karte unter diesem Namen nicht.

| Ort | gemeldet | dx | dy | Betrag (mi) | gemessen |
|---|---|---|---|---|---|
| Waldrast | Nord | +3,53 | +3,89 | 5,25 | Nordost |
| Hesindelburg | Süd | +0,04 | −3,78 | 3,78 | Süd |
| Perricum | Nordost | +2,75 | +2,08 | 3,45 | Nordost |
| Greifenfurt | Südost | +1,32 | −1,06 | 1,69 | Südost |
| Eslamsroden | kein | +0,73 | −1,41 | 1,59 | Südost |
| Koschtal | kein | −0,56 | −1,25 | 1,38 | Südwest |
| Gareth | — | −1,04 | −0,76 | 1,29 | Südwest |
| Drift | kein | −0,07 | +0,92 | 0,92 | Nord |

✅ **Die Editoren sehen richtig** — alle vier genannten Richtungen stimmen, und die drei „kein"
liegen unter 1,6 Meilen. 🚩 **Aber die vier Richtungen zeigen in vier verschiedene
Himmelsrichtungen.** Das ist die Signatur einzelner Versätze, nicht einer gemeinsamen Abbildung.
⚠️ Und die Auswahl ist nicht neutral: genannt wurde, was auffiel. Median der acht **1,64 Meilen**
gegen **1,25** bei den übrigen — wer an ihnen kalibriert, holt sich genau ihr Einzelrauschen.

#### Das Experiment: kalibrieren an den genannten, messen an allen anderen

168 Paare ≤ 25 Meilen (einschließlich Eslamsroden). Die Prüfmenge enthält keinen Kalibrierort.

| Lauf | kalibriert → Korrektur | gemessen | Summe | Varianz | Median | besser |
|---|---|---|---|---|---|---|
| **1 Feld** | 8 → affin | 160 | 478,8 → 571,9 mi, **+19,5 %** | 19,01 → 19,66, **+3,4 %** | 1,25 → 2,01 | 31 % |
| **4 Felder** | 8 → Verschiebung 4 / – / 2 / 2 | 160 | 478,8 → 543,9 mi, **+13,6 %** | 19,01 → 19,77, **+4,0 %** | 1,25 → 1,69 | 23 % |
| 1 Feld, `--ohne=metropole,stadt` | 5 → Verschiebung | 144 | 459,1 → 562,8 mi, **+22,6 %** | 20,38 → 19,41, −4,8 % | 1,35 → 2,17 | 22 % |
| 4 Felder, `--ohne=metropole,stadt` | 5 → Verschiebung 2 / 1 / 1 / 1 | 144 | 459,1 → 684,3 mi, **+49,1 %** | 20,38 → 21,99, **+7,9 %** | 1,35 → 3,36 | 22 % |

🔴 **Summe und Varianz sinken in KEINEM Lauf gemeinsam.** Die Summe steigt immer, zwischen
13,6 und 49,1 %; die Varianz bewegt sich um ±8 %. Nach der Regel der Übergabe (§4 dort) ist damit
kein systematischer Fehler getroffen.
❌ **`--ohne=metropole,stadt` ist nicht der größte Hebel, sondern der größte Schaden** — simuliert
war „aus +31 % werden +60 %". Der Grund ist banal: der Schalter nimmt Gareth, Koschtal und
Eslamsroden aus der Kalibrierung, fünf Orte bleiben, und unter acht fällt jede Abbildung auf eine
Verschiebung zurück. Streng „nur Dörfer und Bauwerke" (alle vier Stadtklassen raus) bleiben zwei
Kalibrierorte: Summe +26,2 % (1 Feld) bzw. +32,3 % (4 Felder).
⚠️ `--ohne=metropole,stadt` lässt die `grossstadt` drin — Greifenfurt und Perricum kalibrieren
weiter mit. „Städte raus" meint mehr, als dieser Schalter tut.

**Der Schnitt ändert das Bild nicht** (Änderung Summe / Varianz):

| Schnitt | Paare | 1 Feld | 4 Felder |
|---|---|---|---|
| ≤ 10 mi | 154 | +32,0 % / +3,3 % | +21,8 % / +3,6 % |
| ≤ 25 mi | 168 | +19,5 % / +3,4 % | +13,6 % / +4,0 % |
| ≤ 50 mi | 169 | +17,9 % / −0,4 % | +12,4 % / +0,3 % |

#### Warum: die ausgelieferte Matrix HAT den systematischen Fehler schon

Ob es an den acht Orten liegt oder ob gar nichts mehr zu holen ist, beantwortet eine
**Obergrenze**: an einer zufälligen HÄLFTE aller Paare kalibrieren (~84 Orte, genug für vier
echte Quadranten-Matrizen), an der anderen Hälfte messen, 200 Läufe. Median über die Läufe, in
Klammern das 10.–90. Perzentil:

| Obergrenze (≤ 25 mi) | Summe | Varianz |
|---|---|---|
| 1 Feld, kleinste Quadrate | +10,4 % [+3,4 … +26,4] | −10,7 % [−16,4 … −2,7] |
| 4 Felder, kleinste Quadrate | +18,2 % [+7,1 … +39,2] | −16,0 % [−25,8 … +14,2] |
| 1 Feld, **robust** (wie der Fit vom 26.08.) | +1,8 % [−0,4 … +5,2] | +1,1 % [−1,3 … +4,8] |
| 4 Felder, **robust** | +4,6 % [+0,1 … +21,7] | −5,2 % [−8,9 … +2,9] |

*(Die robusten Zeilen auf 167 Paaren ohne Eslamsroden, `avesmapsGaretienPasspunktRobustFit`.)*

Selbst mit 84 Kalibrierorten sinkt die Summe nicht nennenswert — im besten Zehntel der Läufe um
höchstens 0,4 %. Ein robuster Fit über **alle** 167 Paare, also in-sample und damit geschönt,
bewegt den Median nur von 1,320 auf 1,297 Meilen und die Summe von 496,5 auf 500,0. **Die
ausgelieferte Matrix ist bereits das affine Optimum dieser Daten**; der Fit vom 26.08.2026 über
148 Paare hat den systematischen Anteil aufgenommen. Übrig ist Rauschen.
⚠️ Kleinste Quadrate zeigen das Spiegelbild des Rauschmusters — Summe steigt, Varianz sinkt: sie
ziehen die großen Einzelversätze heran und bezahlen es an den vielen kleinen.

**Die übrigen Behauptungen, nach dem Schnitt (168 Paare):**

- ❌ **„Alle liegen südlich" (§3, Punkt 2) verallgemeinert nicht:** mittlerer Versatz dx −0,38 /
  dy **−0,27 Meilen**, ein Fünftel des Medians. Kreuzvalidiert abgezogen wird der Median
  schlechter (1,33 → 1,51).
- ❌ **„Je weiter Westen, desto weiter Süden":** +0,05 Meilen je 100 Meilen, **p = 0,78**.
- ❌ **Örtliche Struktur** (Nachbarprobe k = 5 — eine andere Frage, §4): 1,33 → 2,16 Meilen,
  Einigkeit 0,14.

🔴 **Ergebnis:** eine oder vier affine Abbildungen aus den genannten Orten **verschlechtern** den
Import an allen anderen Orten. Die Versätze, die die Editoren sehen, sind echt und richtig
beobachtet, aber einzeln — sie werden **von Hand an der Karte** korrigiert (§6, „trägt nicht").

---

## 4. Die Messung — die Nachbarprobe

🔴 **Sie beantwortet die Owner-Frage nicht argumentierend, sondern fahrend.** Jeder Passpunkt
wird der Reihe nach so behandelt, als kenne man ihn nicht: seine Korrektur wird **allein aus
seinen k nächsten Nachbarn** geschätzt (abstandsgewichtet), und danach wird nachgesehen, ob sein
Fehler kleiner geworden ist. Das ist genau der Handgriff, den die Editoren vorhaben — *„der
offset den wir dann für die referenzen haben wird dann überall drauf gerechnet"* — nur auf
Punkten, an denen sich das Ergebnis nachprüfen lässt.

- **nachher < vorher** → das Feld hängt zusammen. Fixpunkte tragen auch dorthin, wo keiner
  liegt. Eine Korrektur lohnt, und die Zahl sagt, wie viel sie bringt.
- **nachher ≥ vorher** → die Versätze sind unabhängiges Zeichenrauschen. Keine Matrix hilft.

💣 **Der Punkt ist nie sein eigener Nachbar.** Ohne diesen Ausschluss sähe auch reines Rauschen
wie ein perfekt korrigierbares Feld aus — der Punkt sagte sich selbst voraus. Das ist die
Überanpassung, gegen die die ganze Messung gebaut ist.
💣 **Die Nachbarn werden auf UNSERER Karte gesucht**, nicht auf ihrer — gefragt ist „welcher Ort
liegt neben dem, den ich korrigieren will", und das ist die Stelle, auf die gerechnet wird.

Daneben laufen zwei kleinere Prüfungen, beide ebenfalls kreuzvalidiert: ein **globaler Versatz**
(bringt ein einziger konstanter Schub etwas?) und der **West-Süd-Trend** als Permutationstest,
damit das Bauchgefühl der Editoren eine eigene Zahl bekommt statt eines Eindrucks.

🔴 **Beide nur gegen die eingefrorene Matrix.** Gegen einen frischen Fit sind sie per
Konstruktion null — das ist dieselbe Falle wie §2.

### Das Urteil

Zwei Schranken, **beide** müssen fallen: der Gewinn trägt mindestens ein Viertel des
Ausgangsfehlers, **und** die Nachbarn sind sich über die Richtung einig (Kosinus > 0,4).
⚠️ Die zweite ist die wichtigere: ein Gewinn lässt sich mit genügend Nachbarn fast immer
herbeimitteln, eine gemeinsame Richtung nicht.

---

## 5. Die Bauteile

| Datei | Rolle |
|---|---|
| `api/_internal/import/garetien-passpunkte.php` | Rechnung. Rein, keine Datenbank. 80 Zusicherungen, 12 Mutationen. |
| `api/_internal/import/garetien-passpunkte-lesen.php` | Die Tür. Liest beide Karten, paart, prüft sich selbst. 29 Zusicherungen, 8 Mutationen. |
| `api/edit/map/garetien-import.php` → `action=passpunkte` | Der Messlauf. **Rein lesend**, außerhalb der Admin-Liste. |
| `docs/garetien-passpunkte-mockup.html` | Das Bild samt zwei Vergleichsmaßstäben. |
| `tools/garetien/passpunkte-mockup-daten.php` | Erzeugt die Mockup-Daten mit der echten Bibliothek. |
| `tools/garetien/passpunkte-messen.js` | Der Messlauf zum Einfügen in die Browserkonsole. Gegen fünf Antwortformen im Browser gefahren. |

🔴 **Der Abgleich wird nicht nachgebaut** — Namensnormalisierung und Typtabelle kommen aus
`garetien-abgleich.php`.
🔴 **Mehrdeutige Namen fliegen raus, bevor gerechnet wird.** Entwurf §2.4: 70 von 219
namensgleichen Orten waren verschiedene Orte. Der robuste Filter fängt sie hinterher an ihrem
Abstand — aber nur, wenn sie weit genug auseinanderliegen; zwei „Waldheim" 20 Meilen entfernt
rutschen durch und ziehen die Matrix leise schief. Ein Name, der auf **einer** Karte doppelt
vorkommt, ist als Passpunkt unbrauchbar. Das verwirft auch echte Paare: ein Passpunkt zu wenig
kostet Genauigkeit, ein falscher kostet die Aussage.

💣 **Die Selbstprüfung ist kein Komfort.** Eine vertauschte Achse liefert lauter große,
gleichgerichtete Residuen — das sieht aus wie ein gewaltiger, wunderbar zusammenhängender
Versatz, also genau wie das Ergebnis, das jemanden dazu brächte, eine Korrekturmatrix dagegen
zu bauen. Dieselbe Falle hat der Import bei `avesmapsGaretienGeoJsonNachHausvertrag` schon
einmal bezahlt. Der Median **muss** in der Größenordnung aus §2.1 liegen (1,24 Meilen); tut er
es nicht, reist die Warnung in der Antwort mit.

---

## 6. Der Handgriff — so wird gemessen

0. 💣 **Der Zweig muss AUSGELIEFERT sein.** Die Aktion `passpunkte` lebt auf dem Server, und
   der Deploy läuft ausschließlich auf `master` (`deploy-avesmaps-strato.yml`) — ein
   Feature-Branch ändert am Server nichts. Steht sie nicht live, antwortet der Endpunkt mit
   **HTTP 400 `invalid_action` / „Unbekannte Aktion."**, und das sieht wie ein Tippfehler im
   eigenen Aufruf aus. 🚩 Genau so am 14.09.2026 passiert: dieser Abschnitt nannte die
   Voraussetzung nicht, der Owner hat den Handgriff gegen den alten Server gefahren. Das
   Messskript sagt den Grund seither selbst.
1. Im Garetien-Importer muss ein **Lauf im Staging liegen** („Dump holen" bzw. „Holen &
   Rechnen"). Gemessen wird ohne Angabe der jüngste.
2. Auf avesmaps.de **als angemeldeter Editor** die Konsole öffnen (F12) und
   **`tools/garetien/passpunkte-messen.js` ganz hineinkopieren**. Das Skript fährt den einen
   Aufruf, liest die Antwort vor und legt sie in die Zwischenablage.

   Wer es lieber von Hand tut:
   ```js
   await (await fetch("/api/edit/map/garetien-import.php", {
     method: "POST", headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ action: "passpunkte" })
   })).json()
   ```
3. **Zuerst `selbstpruefung` lesen.** Steht dort eine Warnung, ist die Lesart verdächtig und
   nicht die Karte — dann nichts deuten, sondern §5 prüfen. 💣 Das Skript **hält das Urteil in
   diesem Fall zurück**: die erste Fassung warnte oben und setzte darunter trotzdem ein
   sattgrünes „TRÄGT", und ein Banner schlägt eine Warnzeile drei Zeilen höher. Genau so
   entstünde der Fehler, gegen den die Selbstprüfung gebaut ist.
4. `bericht` sagt, wie viele Paare zustande kamen und wie viele Namen als mehrdeutig gefallen
   sind. Unter 20 Paaren gibt es kein Urteil.
5. Die Antwort in `docs/garetien-passpunkte-mockup.html` unten einfügen → das Bild erscheint
   neben den zwei Vergleichsmaßstäben.

⚠️ **Wenn nichts kommt, ist der Rohtext die Auskunft, nicht der JSON-Fehler.** Ein PHP-Fatal
antwortet mit HTTP 200 und leerem Rumpf; `response.json()` wirft dann „Unexpected end of JSON
input", und das liest sich wie ein Netzfehler. Das Skript zeigt deshalb immer erst den Rohtext.
Der Zweig selbst wird von `garetien-passpunkte-endpunkt-test.php` wirklich ausgeführt (gegen
eine SQLite-Attrappe), damit dieser Fall gar nicht erst eintritt.

⚠️ **Der Lauf ist teuer** (ein Durchgang über alle aktiven Ortspunkte). CLAUDE.md: auf STRATO
nie einen schweren Endpunkt in der Schleife fahren — eine Anfrage, dann lesen.

### Was danach zu tun ist

- **Urteil „trägt nicht"** → die Sache ist entschieden, und zwar gegen die Korrekturmatrix. Der
  Befund gehört dann in §2.2 des Kartenimport-Entwurfs, mitsamt der Zahl. Die Versätze, die die
  Editoren sehen, sind echt, aber einzeln — sie werden **von Hand an der Karte** korrigiert,
  wie es bei Wäldern und Inseln ohnehin geschieht.
- **Urteil „trägt"** → dann, und erst dann, lohnt der Bau. Die Reihenfolge ist: erst der
  **globale Versatz** (billigst, zwei Zahlen, kein Warp — und die fünf Punkte in §3 legen
  genau ihn nahe), dann eine affine Nachkorrektur, und **nur wenn beides messbar zu wenig
  bringt**, ein lokales Verfahren. Jede Stufe wird gegen dieselbe Nachbarprobe gemessen.
- **Urteil „zu wenig"** → die Paarung ist das Problem, nicht die Karte. Dann bringt eine
  **kuratierte** Liste mehr als Automatik: die Orte, die die Editoren ohnehin von Hand
  bestätigen, sind die wertvollsten Passpunkte, die es gibt (§7).

---

## 7. 🔧 Offen — was diese Sitzung NICHT konnte

- ✅ **Die Messung ist gelaufen** — am 14.09.2026, Lauf 20, in der Editor-Sitzung des Owners
  über den Browser (§6). Ergebnis in §3.1. Die Rohpaare liegen nur im Scratchpad der messenden
  Sitzung, nicht im Repo.
  *(Bis dahin stand hier, warum die Cloud-Sitzung vom 13.09.2026 sie nicht fahren konnte: kein
  Netz — `CONNECT` auf `avesmaps.de:443` mit 403 abgewiesen — und keine Editor-Sitzung.)*
- ✅ **Der Riegel gegen Falschpaare steht** (14.09.2026, nach §3.1). Bis dahin rechneten
  `action=passpunkte`, seine Selbstprüfung und `tools/garetien/passpunkte-auswerten.php` alle Paare
  mit, und die Selbstprüfung meldete „ok" bei p90 = 382 Meilen. Jetzt schneidet
  `avesmapsGaretienPasspunkteFalschpaareAbtrennen` bei 25 Meilen gegen die **eingefrorene** Matrix —
  nicht gegen einen Fit und nicht über den robusten Fit, dessen Schranke echtes Zeichenrauschen von
  5–20 Meilen mit abschnitte — und nennt jedes abgetrennte Paar mit Namen, Betrag und Richtung. Es
  fragen ihn die Tür (also `action=passpunkte`), das Auswertungswerkzeug und die Kalibrierprobe.
  Die Selbstprüfung liegt jetzt in der Bibliothek, gilt beiden Lesern und prüft neben dem Median:
  kein Residuum über der Schranke, Mittel ≤ 3 × Median, und dass der Riegel eine **Minderheit**
  abgetrennt hat — nimmt er die Mehrheit, sind es vertauschte Achsen oder der falsche Lauf.
  ⚠️ Eine vor diesem Tag gespeicherte rohe Antwort bleibt ungeschnitten und damit wertlos: neu
  messen, nicht nachdeuten.
- 🔧 **Drei der elf gemeldeten Orte ließen sich nicht paaren**: Rockenwald und Rhondur gibt es auf
  unserer Karte unter diesem Namen nicht, Fürstenhort hat bei Garetien keinen platzierten
  Ortspunkt. Und der Mehrdeutigkeitsfilter verwarf gutartige Doppelungen — Eslamsroden steht
  dort als Burg und als Reichsstadt 0,85 Meilen auseinander und musste von Hand gepaart werden.
  ✅ Seit 14.09.2026 paart die Tür einen solchen Namen über die Siedlung
  (`avesmapsGaretienPasspunktDoppelungAufloesen`): genau eine Siedlung, alle übrigen Vorkommen
  Bauwerke innerhalb der Punkt-Trefferschwelle des Importers (0,3 Einheiten = 0,9 Meilen) — und
  berichtet es als `doppelungen_aufgeloest`. ⚠️ Gemessen ist das an genau einem Fall, und
  Eslamsroden liegt knapp unter der Schwelle. 🔧 `sql/garetien-passpunkte-ziehen.sql` kennt die
  Ausnahme nicht; dort bleibt jeder doppelte Name draußen.
  🚩 **Eine kuratierte Passpunktliste änderte am Ergebnis nichts**: selbst ~84 Kalibrierorte
  schlagen die ausgelieferte Matrix nicht (§3.1, Obergrenze).
- 🔧 **Der Befund gehört noch in §2.2 des Kartenimport-Entwurfs** (§6, „trägt nicht") — mit der
  Zahl, dass die ausgelieferte Matrix das affine Optimum dieser Daten ist.
- 🔎 **Fünf Orte südlich von Greifenfurt** (Gramstein, Dohlentrutz, Nimmerwacht, Orkentrutz,
  Herdalsruh) liegen gemeinsam 15–20 Meilen nordwestlich — die einzige gleichgerichtete Gruppe
  über dem Rauschen. Radulfshausen mitten dazwischen liegt aber unter 4 Meilen; das sieht eher
  nach einzeln verschobenen Orten aus als nach einer verschobenen Fläche. Kandidat für die
  Handkorrektur, nicht für eine Matrix.
- **Nur Ortspunkte.** Wege, Flüsse und Flächen tragen ihre eigenen Versätze; die Nachbarprobe
  könnte sie mitnehmen, tut es aber nicht.
- **Der Vorschlag „Kanonorte nehmen" ist ungeprüft.** Ob kanonische Orte systematisch genauer
  übereinstimmen als beliebige, ließe sich mit demselben Werkzeug messen (zwei Gruppen, zwei
  Mediane) — dafür braucht es ein Merkmal „kanonisch" an unseren Orten, und das gibt es nicht.
