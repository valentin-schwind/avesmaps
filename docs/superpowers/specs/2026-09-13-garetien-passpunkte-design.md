# Passpunkte für den Garetien-Import — trägt eine Korrektur aus Fixpunkten?

> Stand: 13.09.2026. Entwurf **und** Messbericht. Der Bauteil-Teil ist gebaut und getestet;
> der Mess-Teil ist **offen**, weil die Sitzung keinen Zugang zu avesmaps.de hatte (§7).

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

1. Im Garetien-Importer muss ein **Lauf im Staging liegen** („Dump holen" bzw. „Holen &
   Rechnen"). Gemessen wird ohne Angabe der jüngste.
2. Als angemeldeter Editor gegen die Live-Seite:

   ```js
   await (await fetch("/api/edit/map/garetien-import.php", {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ action: "passpunkte" })
   })).json()
   ```
3. **Zuerst `selbstpruefung` lesen.** Steht dort eine Warnung, ist die Lesart verdächtig und
   nicht die Karte — dann nichts deuten, sondern §5 prüfen.
4. `bericht` sagt, wie viele Paare zustande kamen und wie viele Namen als mehrdeutig gefallen
   sind. Unter 20 Paaren gibt es kein Urteil.
5. Die Antwort in `docs/garetien-passpunkte-mockup.html` unten einfügen → das Bild erscheint
   neben den zwei Vergleichsmaßstäben.

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

- **Die Messung selbst ist nicht gelaufen.** Diese Sitzung hatte keinen Zugang zu avesmaps.de
  (Netzregel der Umgebung: `CONNECT` auf `avesmaps.de:443` wird mit 403 abgewiesen) und auch
  nicht zu garetien.de/koschwiki.de. Alles in §5 ist gegen SQLite-Attrappen und im Browser
  gefahren, nichts gegen die echte Datenbank. **Die Zahlen in §3 stammen aus fünf Fixtures im
  Repo, sonst nichts.**
- **Neun der elf gemeldeten Orte lassen sich hier gar nicht nachrechnen** — Hesindelburg,
  Waldrast, Koschtal, Rockenwald, Perricum, Eslamsroden, Drift, Fürstenhort, Rhondur stehen mit
  Koordinaten nirgends im Repo. Genau dafür ist der Handgriff in §6 da.
- **Eine kuratierte Passpunktliste gibt es nicht.** Die von den Editoren bestätigten Paare sind
  die einzigen, bei denen ein Mensch „das ist derselbe Ort" gesagt hat — sie wären der
  belastbarste Datensatz überhaupt und haben heute keine Ablage. Wenn die automatische Paarung
  in §6 zu dünn ausfällt, ist das der nächste Schritt.
- **Nur Ortspunkte.** Wege, Flüsse und Flächen tragen ihre eigenen Versätze; die Nachbarprobe
  könnte sie mitnehmen, tut es aber nicht.
- **Der Vorschlag „Kanonorte nehmen" ist ungeprüft.** Ob kanonische Orte systematisch genauer
  übereinstimmen als beliebige, ließe sich mit demselben Werkzeug messen (zwei Gruppen, zwei
  Mediane) — dafür braucht es ein Merkmal „kanonisch" an unseren Orten, und das gibt es nicht.
