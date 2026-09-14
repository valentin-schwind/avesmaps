# Übergabe — Garetien-Passpunkte: der systematische Fehler

> Stand 14.09.2026, `master`. Gebaut, getestet, ausgeliefert — **und am selben Tag gegen die
> echte Datenbank gemessen (§8). Die Antwort ist nein:** eine oder vier affine Abbildungen aus
> den genannten Orten machen den Import an allen anderen Orten schlechter.

---

## 1. Die Frage

Garetien ist auf Grundlage einer **verschobenen Karte** gezeichnet worden, mit individuellen
Anpassungen. Es gibt also einen **systematischen Fehler** und **Rauschen**. Gesucht ist nur der
systematische: am Ende soll **eine oder vier affine Abbildungen** (je Quadrant) auf alles aus
Garetien laufen, kalibriert an den Ortspaaren, die die Editoren genannt haben.

Owner wörtlich: *„vor und danach beschreibt eine Summe an Distanzen für den Rest der Orte, und
ich will wissen, ob sie Distanzen und Varianzen sogar reduziert haben, wenn wir auf die
genannten kalibrieren."*

Die genannten Orte (Discord, 12.–13.09.2026): Hesindelburg (Süd), Waldrast (Nord), Koschtal
(kein), Rockenwald (kein), Greifenfurt (Südost), Perricum (Nordost), Eslamsroden (kein), Drift
(kein), Fürstenhort (kein), Gareth, Rhondur. Dazu: *„je weiter Westen, desto weiter Süden"* und
*„im Osten nach rechts oben"* — zusammen die Signatur einer **Drehung**.

---

## 2. 💣 Was dabei über den bestehenden Entwurf herauskam

`2026-08-26-garetien-kartenimport-design.md` §2.2 verbietet das Warpen und stützt das auf zwei
Belege. **Der erste ist zirkulär.**

Dort stand: *„die Residuen korrelieren null mit der Position (0,014 / 0,003 / −0,003 / −0,001)"*.
Das ist eine **algebraische Identität**: Residuen kleinster Quadrate stehen auf jeder Spalte
ihrer Entwurfsmatrix senkrecht, und die Spalten *sind* `gx`, `gy` und die Eins. Nachgemessen:
eine absichtlich eingebaute quadratische Verzerrung von **36 Meilen Amplitude** ergibt dieselben
vier Nullen auf fünf Stellen (`garetien-passpunkte-test.php` §D).

⭐ Die **andere** Hälfte trägt weiter: die Kreuzvalidierung gegen den Thin-Plate-Spline (2,30
gegen 1,24 Meilen, out-of-sample). §2.2 ist entsprechend korrigiert, der alte Wortlaut steht
zitiert daneben.

**Folge:** die Frage der Editoren war offen, nicht beantwortet. ➡️ Beantwortet in §8.

---

## 3. 🚩 Was die fünf echten Passpunkte des Repos sagen

Mehr gibt es lokal nicht — der Fit vom 26.08.2026 lief gegen die Live-Datenbank, nur die sechs
Matrixzahlen haben überlebt. Residuen gegen die **ausgelieferte** Matrix:

| Ort | x (Ost) | dx | dy | Betrag | Richtung |
|---|---|---|---|---|---|
| Ferdok | 493 | −0,05 | −0,90 | 0,90 | Süd |
| Greifenfurt | 508 | +1,32 | −1,06 | 1,69 | **Südost** |
| Zwerch | 589 | +0,36 | −0,28 | 0,45 | kein |
| Rommilys | 597 | +0,02 | −0,56 | 0,56 | Süd |
| Beilunk | 678 | −0,72 | −3,08 | 3,17 | Süd |

*(dx > 0 = Import liegt östlich von uns, dy > 0 = nördlich.)*

1. ✅ **Greifenfurt weist nach Südost — wörtlich wie gemeldet.** Der Blick der Editoren ist
   kalibriert.
2. 🚩 **Alle fünf liegen südlich**, Mittel **−1,18 Meilen**. Bei Zufall 1 zu 32.
3. 🚩 Die zwei mittennächsten (Zwerch 0,45, Rommilys 0,56) haben die **kleinsten** Fehler, die
   drei Randpunkte die größten — die Form eines echten systematischen Fehlers.
4. ❌ **„Je weiter Westen, desto weiter Süden" stützen sie NICHT**: Neigung −0,30 Meilen/100,
   p = 0,33, und der östlichste Punkt (Beilunk) ist der südlichste Ausreißer.
5. ❌ **Keine saubere Drehung**: der tangentiale Anteil wechselt zwischen West und Ost das
   Vorzeichen. Das ist die Signatur einer gleichmäßigen **Süd-Verschiebung**, nicht einer Drehung.

➡️ **An 168 echten Paaren gemessen (§8): Punkt 2 und 3 verallgemeinern nicht.** Der mittlere
Süd-Versatz ist −0,27 Meilen, ein Fünftel des Medians.

---

## 4. Die Antwort auf „wieviel %" — simuliert

148 Punkte, Rauschen auf die dokumentierten 1,24 Meilen kalibriert, 11 Kalibrierorte auf dem
Kompass, **gemessen an den 137 anderen**:

| systematischer Fehler | **1 Abbildung** Summe / Varianz | **4 Quadranten** Summe / Varianz |
|---|---|---|
| Drehung 0,22° + 1 mi Süd | **+20,8 % / +20,6 %** | −2,7 % / −23,2 % |
| nur 1,2 mi Süd | **+15,9 % / +7,3 %** | −15,6 % / −66,9 % |
| Skalenfehler 0,5 % | **+8,6 % / +14,2 %** | −29,7 % / −58,5 % |
| *keiner* | −8,4 % / −52,3 % | −49,0 % / −174 % |

⚠️ **Vorzeichen dieser Tabelle: Gewinn, + = sinkt.** §8 schreibt die Änderung (+ = steigt).

🔴 **Vier Quadranten fallen mit 11 Punkten immer aus.** Eine affine Abbildung hat sechs
Parameter; drei Punkte legen sie exakt fest und lassen keinen Freiheitsgrad. Auf vier Felder
verteilt erreicht keines acht Punkte, jedes fällt auf eine Verschiebung zurück, eines wird aus
**einem einzigen** Ort geschätzt. **Für vier echte Quadranten-Matrizen braucht es ≥ 32 sichere
Paare, acht je Feld.**

🔴 **Die Varianz ist der Unterscheider.** Sinken Summe und Varianz gemeinsam → systematischer
Fehler getroffen. Sinkt die Summe, während die Varianz explodiert → Rauschen angepasst. Im
Rauschfall: Summe −8 %, Varianz −52 %.

⭐ **Alriks Punkt (Städte raus, nur Dörfer) ist der größte Hebel**: aus +31 % werden +60 %. Grund:
Gareth und Perricum sind so groß, dass ihre Mitte 2–3 Meilen Spielraum hat, und dieses Rauschen
geht ungewichtet in die Anpassung ein.
❌ **Gemessen das Gegenteil (§8):** mit `--ohne=metropole,stadt` bleiben fünf Kalibrierorte, und
die Summe steigt um 22,6 bzw. 49,1 %.

---

## 5. Was gebaut ist

| Datei | Rolle |
|---|---|
| `api/_internal/import/garetien-passpunkte.php` | Rechner: Residuen, robuster Fit, Nachbarprobe, Trend, globaler Versatz, **Kalibrierprobe**, Urteil. Rein, keine DB. |
| `api/_internal/import/garetien-passpunkte-lesen.php` | DB-Tür: paart beide Karten, Selbstprüfung. |
| `api/edit/map/garetien-import.php` → `action=passpunkte` | Messlauf, rein lesend, für Editoren. **Live.** |
| `sql/garetien-passpunkte-ziehen.sql` | Die Paare per phpMyAdmin ziehen. |
| `tools/garetien/passpunkte-auswerten.php` | Rechnet aus der SQL-Ausgabe alles. `--ohne=metropole,stadt`. |
| `tools/garetien/passpunkte-messen.js` | Messlauf zum Einfügen in die Browserkonsole. |
| `docs/garetien-passpunkte-mockup.html` | Ist der Versatz überhaupt korrigierbar? Zwei Vergleichsbilder. |
| `docs/garetien-kalibrierung-mockup.html` | Kalibrieren an wenigen, messen an allen anderen. Quadrantenkarte. |
| `docs/superpowers/specs/2026-09-13-garetien-passpunkte-design.md` | Der Entwurf. §3.1 ist der Messbericht. |

Tests: 90 + 29 + 28 + 178 Zusicherungen, gegen 28 Mutationen gefahren, alle gefangen.

---

## 6. 💣 Die Fallen, jede einmal bezahlt

- **Die Marke `2000000 2000000`** („existiert, aber noch nicht platziert", ~360 Zeilen) ist kein
  Ort. EINE durchgelassene Zeile macht Mittelwert und Varianz zu Unsinn — **und der Median zeigt
  es nicht** (gemessen: Median 1,6, Mittel 22,0, Streuung 242). Riegel:
  `avesmapsGaretienPasspunktIstPlatziert`, geteilt von beiden Lesern.
- **Mehrdeutige Namen**: 70 von 219 namensgleichen Orten waren verschiedene Orte. Ein Name, der
  auf **einer** Karte doppelt vorkommt, ist als Passpunkt unbrauchbar.
- 💣 **Und ein Name, der auf JEDER Karte nur einmal vorkommt, ist trotzdem kein Beleg** (14.09.2026):
  37 von 204 Paaren des echten Laufs waren gleichnamige, aber verschiedene Orte, 31 davon über
  200 Meilen daneben. Der Mehrdeutigkeitsfilter sieht sie nicht. Ungefiltert meldete der Endpunkt
  einen West-Süd-Trend von −40,9 Meilen/100 bei **p = 0,0005**, der nach dem Schnitt verschwindet.
  ✅ **Riegel seit 14.09.2026**: `avesmapsGaretienPasspunkteFalschpaareAbtrennen` (25 Meilen gegen
  die eingefrorene Matrix), gefragt von Tür, Auswertungswerkzeug und Kalibrierprobe, jedes
  abgetrennte Paar mit Namen berichtet.
- 💣 **Die Selbstprüfung sah nur den Median** und meldete bei genau diesem Lauf „ok" (Median
  1,99) — bei p90 = 382 Meilen. ✅ Seit 14.09.2026 prüft sie auch die Schranke, den Rand
  (Mittel ≤ 3 × Median) und ob der Riegel mehr abgetrennt als behalten hat. Eine rohe Antwort von
  vor diesem Tag bleibt verdächtig.
- ⚠️ **Der Mehrdeutigkeitsfilter verwarf auch Gutartiges**: Eslamsroden steht bei Garetien als
  Burg UND als Reichsstadt, 0,85 Meilen auseinander — ein genannter Kalibrierort weniger.
  ✅ Seit 14.09.2026 gilt eine Siedlung mit Bauwerken desselben Namens innerhalb 0,3 Einheiten als
  ein Ort (`avesmapsGaretienPasspunktDoppelungAufloesen`).
- ⚠️ **`action=liste` liefert die Geometrie schon umgerechnet** (Karteneinheiten, `[x, y]`), nicht
  roh in Wagenhalt. Für einen Passpunkt zurück über die Inverse der ausgelieferten Matrix.
- **Kalibrierpunkte müssen aus der Prüfmenge raus.** Eine Anpassung trifft ihre eigenen
  Stützpunkte immer.
- **Achsen**: GeoJSON `coordinates` ist `[x, y]`. Vertauscht liefert das lauter große,
  gleichgerichtete Residuen — sieht aus wie ein perfekt korrigierbarer Versatz. Dagegen
  `avesmapsGaretienPasspunkteSelbstpruefung`: Median muss bei ~1,24 Meilen liegen.
- **`JSON_EXTRACT` gibt `"Point"` MIT Anführungszeichen.** `= 'Point'` ist nie wahr → null
  Zeilen, ohne Fehlermeldung. Darum `JSON_UNQUOTE`, bei Zahlen `+ 0`.
- **phpMyAdmin**: die Abfrage braucht einen Datenbank-Kontext, sonst `#1046`.
- 🔴 **Nachbarprobe ≠ Kalibrierprobe.** Jene misst **örtliche** Verzerrung, diese eine **globale**
  Matrix. Ein globaler Fehler ist für die Nachbarprobe fast unsichtbar. Für „eine oder vier
  affine Abbildungen" gilt **nur** die Kalibrierprobe.
- ⚠️ **Vorzeichen**: das Werkzeug druckt den *Gewinn* (+ = sinkt). „Summe −19,5 %" in seiner
  Ausgabe heißt: die Summe **steigt** um 19,5 %.

---

## 7. 🔧 Was offen ist

- ✅ ~~Der Messlauf gegen die echte Datenbank.~~ **Gelaufen am 14.09.2026 (§8).**
- ✅ ~~Ein Riegel gegen Falschpaare im Endpunkt und im Auswertungswerkzeug, samt einer
  Selbstprüfung, die auch Mittel/p90 ansieht.~~ **Gebaut am 14.09.2026** (§6). Für §8 war der
  Schnitt ≤ 25 Meilen noch von Hand vorgeschaltet; eine rohe Antwort von vor diesem Tag bleibt
  wertlos.
- 🔧 **Der Befund gehört noch in §2.2 des Kartenimport-Entwurfs** — mit der Zahl, dass die
  ausgelieferte Matrix das affine Optimum ist (Entwurf §6, „trägt nicht").
- **Die Datenbank steht auf `127.0.0.1`** (STRATO-Shared-Hosting) — von außen für niemanden
  erreichbar. Nur zwei Türen: der PHP-Endpunkt (braucht Editor-Sitzung) oder phpMyAdmin.
- **Drei der elf genannten Orte ließen sich nicht paaren**: Rockenwald und Rhondur gibt es auf
  unserer Karte unter diesem Namen nicht, Fürstenhort hat bei Garetien keinen platzierten Punkt.
  🚩 Eine kuratierte Passpunktliste änderte am Ergebnis nichts — selbst ~84 Kalibrierorte schlagen
  die ausgelieferte Matrix nicht.
- **Nur Ortspunkte.** Wege, Flüsse und Flächen tragen eigene Versätze.
- **Der Osten**: *„bei den Inseln im Osten war die Abweichung ziemlich stark"* — Beilunk zeigt
  3,17 Meilen, der größte der fünf Repo-Punkte. Küstenlinien, nicht Ortspunkte — mit diesem
  Messlauf nicht geprüft.
- 🔎 **Fünf Orte südlich von Greifenfurt** (Gramstein, Dohlentrutz, Nimmerwacht, Orkentrutz,
  Herdalsruh) liegen gemeinsam 15–20 Meilen nordwestlich — die einzige gleichgerichtete Gruppe
  über dem Rauschen. Radulfshausen mitten dazwischen liegt aber unter 4 Meilen; das sieht eher
  nach einzeln verschobenen Orten aus als nach einer verschobenen Fläche. Kandidat für die
  Handkorrektur, nicht für eine Matrix.

---

## 8. ✅ Der Messlauf vom 14.09.2026 — die Antwort ist nein

Gefahren in der Editor-Sitzung des Owners: EIN Aufruf `action=passpunkte` gegen Lauf 20, danach
das **unveränderte** `passpunkte-auswerten.php`. Alle Tabellen und Gegenproben: **Entwurf §3.1**.
Die Rohpaare liegen **nicht** im Repo.

**Selbstprüfung zuerst — und sie war verdächtig.** 204 Paare, Median 1,99 Meilen, aber **Mittel
77,2 und p90 382,7**. Ursache: 37 Paare über 25 Meilen, gleichnamige, aber verschiedene Orte
(§6). Die Verteilung hat eine Lücke zwischen 21,6 und 33,9 Meilen → Schnitt bei 25. Danach
**168 Paare, Median 1,33, Mittel 2,97** — plausibel gegen 1,24.

**Kalibrierorte: 8 von 11** (Eslamsroden von Hand gepaart; Fürstenhort, Rockenwald, Rhondur
fehlen, §7).

⚠️ **Vorzeichen hier: Änderung, + = steigt (schlechter).**

| an den genannten kalibriert, an den übrigen gemessen | Summe | Varianz |
|---|---|---|
| **1 Feld** (8 Orte → affin) | 478,8 → 571,9 mi, **+19,5 %** | **+3,4 %** |
| **4 Felder** (8 Orte → Verschiebungen 4 / – / 2 / 2) | 478,8 → 543,9 mi, **+13,6 %** | **+4,0 %** |
| 1 Feld, `--ohne=metropole,stadt` (5 Orte → Verschiebung) | 459,1 → 562,8 mi, **+22,6 %** | −4,8 % |
| 4 Felder, `--ohne=metropole,stadt` (5 Orte → Verschiebungen) | 459,1 → 684,3 mi, **+49,1 %** | **+7,9 %** |

🔴 **Summe und Varianz sinken in keinem Lauf gemeinsam — die Summe steigt immer.** Das hängt nicht
am Schnitt: bei 10 / 25 / 50 Meilen steigt sie für 1 Feld um 32,0 / 19,5 / 17,9 %.
❌ **`--ohne=metropole,stadt` ist der größte Schaden, nicht der größte Hebel**: es nimmt drei der
acht Kalibrierorte weg, und unter acht fällt jede Abbildung auf eine Verschiebung zurück.

**Warum — die ausgelieferte Matrix hat den systematischen Fehler schon.** Kalibriert an einer
zufälligen Hälfte aller Paare (~84 Orte), gemessen an der anderen, 200 Läufe: die Summe steigt
auch dann (kleinste Quadrate +10,4 %, robust +1,8 %). Ein robuster Fit über alle 167, in-sample
und damit geschönt, bewegt den Median nur von 1,320 auf 1,297 Meilen. Der Süd-Versatz verallgemeinert
nicht (dy −0,27 Meilen), der West-Süd-Trend ist +0,05 Meilen/100 bei p = 0,78.

✅ **Die Editoren sehen richtig** — Waldrast, Hesindelburg, Perricum und Greifenfurt weisen genau
wie gemeldet. Aber in **vier verschiedene** Richtungen: einzelne Versätze, keine gemeinsame
Abbildung. Und genannt wurde, was auffiel (Median der acht 1,64 gegen 1,25 Meilen) — wer daran
kalibriert, holt sich ihr Einzelrauschen.

**Folge:** keine Korrekturmatrix, weder eine noch vier. Einzelne Versätze werden von Hand an der
Karte korrigiert (Entwurf §6, „trägt nicht").
