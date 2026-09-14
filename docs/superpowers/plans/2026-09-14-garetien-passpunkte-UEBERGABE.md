# Übergabe — Garetien-Passpunkte: der systematische Fehler

> Stand 14.09.2026, `master`. Gebaut, getestet, ausgeliefert. **Offen ist nur der Messlauf
> gegen die echte Datenbank** — die bauende Sitzung lief in der Cloud ohne Netzzugang.

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

**Folge:** die Frage der Editoren ist offen, nicht beantwortet.

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
| `docs/superpowers/specs/2026-09-13-garetien-passpunkte-design.md` | Der Entwurf. |

Tests: 90 + 29 + 28 + 178 Zusicherungen, gegen 28 Mutationen gefahren, alle gefangen.

---

## 6. 💣 Die Fallen, jede einmal bezahlt

- **Die Marke `2000000 2000000`** („existiert, aber noch nicht platziert", ~360 Zeilen) ist kein
  Ort. EINE durchgelassene Zeile macht Mittelwert und Varianz zu Unsinn — **und der Median zeigt
  es nicht** (gemessen: Median 1,6, Mittel 22,0, Streuung 242). Riegel:
  `avesmapsGaretienPasspunktIstPlatziert`, geteilt von beiden Lesern.
- **Mehrdeutige Namen**: 70 von 219 namensgleichen Orten waren verschiedene Orte. Ein Name, der
  auf **einer** Karte doppelt vorkommt, ist als Passpunkt unbrauchbar.
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

---

## 7. 🔧 Was offen ist

- **Der Messlauf gegen die echte Datenbank.** Alles in §4 ist **simuliert**; die echten Prozente
  stehen aus.
- **Die Datenbank steht auf `127.0.0.1`** (STRATO-Shared-Hosting) — von außen für niemanden
  erreichbar. Nur zwei Türen: der PHP-Endpunkt (braucht Editor-Sitzung) oder phpMyAdmin.
- **Neun der elf genannten Orte** stehen mit Koordinaten nirgends im Repo.
- **Eine kuratierte Passpunktliste** gibt es nicht. Die von Editoren bestätigten Paare wären der
  belastbarste Datensatz und haben heute keine Ablage.
- **Nur Ortspunkte.** Wege, Flüsse und Flächen tragen eigene Versätze.
- **Der Osten**: *„bei den Inseln im Osten war die Abweichung ziemlich stark"* — Beilunk zeigt
  3,17 Meilen, der größte der fünf. Küstenlinien, nicht Ortspunkte. Die einzige Beobachtung über
  dem Rauschen.
