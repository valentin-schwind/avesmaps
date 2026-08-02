# Steigung auf Gebirgspässen — Quelle, Regelableitung, Setzung

> **Stand:** 2026-08-02. **Status:** Quellenlage geklärt, mathematische Definition festgelegt,
> Wirkungsgrad `α` noch nicht entschieden.
>
> Dieses Dokument trennt drei Dinge, die zuvor vermischt waren und genau dadurch einen öffentlichen
> Fehler erzeugt haben: **was die Quelle sagt**, **was wir daraus regelgetreu ableiten**, und **was
> wir darüber hinaus setzen**. „DIN 33466" stand über einen Monat im Geschwindigkeits-Dialog, ohne
> dass irgendwo vermerkt war, welcher der drei Kategorien diese Angabe angehörte. Zwei Spieler haben
> es gefunden, nicht wir.

---

## 1. Die Quelle

**Geographia Aventurica**, Fanpro/Fantasy Productions 2003, ISBN 3-89064-291-8, **Seite 123**,
Abschnitt „Geländeformation":

> „Da für Gebirgslandschaften bereits die Beeinträchtigungen durch Anstiege und Gefälle
> berücksichtigt sind, ist die Tagesleistung nicht noch einmal zu modifizieren."

Derselbe Absatz gibt für **nicht**-gebirgiges Gelände sehr wohl einen eigenen
Steigungsmodifikator an — Ebenen ×1, Hügel ×0,75, einzelne Berge ×0,5 — und stellt ihm den Satz
voran, es sei „schwierig, absolute Modifikatoren anzugeben"; der Spielleiter solle Mittelwerte
verwenden.

### 1.1 Geltungsbereich

Der Satz betrifft **Gebirgslandschaften**. Die Tabelle auf S. 123 führt als Gebirgskategorien:
Gebirge/Passstrecke, Gebirge/Pfad, Gebirge (kein Klettern), Hochgebirge (Klettern). Für
Reichsstraße, Straße, Weg und Pfad enthält die Quelle **keine** entsprechende Aussage.

⚠️ **Was der Satz NICHT sagt.** Er ist eine Verbotsnorm („nicht noch einmal modifizieren"), keine
Erlaubnisnorm. Er sagt insbesondere **nicht**, dass eine Steigungsfunktion auf Gebirgspässen
mittelwertnormalisiert werden *soll*. Alles in §4 ist Setzung, nicht Ableitung.

⚠️ **Was NICHT aus der Tabellenstruktur folgt.** Ein früherer Entwurf leitete dieselbe Aussage aus
dem Abstand zwischen „Pfad 0,8" und „Gebirge, Pfad 0,3" ab. Das trägt nicht: die Quelle nennt für
Gebirge mehrere Merkmale nebeneinander — Anstiege und Gefälle, steiniger Boden, karger Bewuchs,
dünne Luft (S. 120) —, der Abstand isoliert die Steigung also nicht. Tragfähig ist allein der
zitierte Satz.

### 1.2 Zuordnung auf unsere Subtypen

| Subtyp | DSA-Entsprechung | Steigung bereits enthalten? |
|---|---|---|
| Reichsstraße | Reichsstraße 1,1 | nein |
| Straße | Straße 1,0 | nein |
| Weg | Weg 0,8 | nein |
| Pfad | Offenes Gelände, Pfad 0,8 | nein |
| **Gebirgspass** | **Gebirge, Passstrecke 0,4** | **ja** |
| Wüstenpfad | Sand-/Geröllwüste 0,5 | nein — keine Gebirgskategorie |
| Flussweg, Seeweg | — | entfällt; Gelände gilt auf Wasser ohnehin nicht |

Gebirgspfad, Gebirge ohne Weg und Hochgebirge haben bei uns **keinen Subtyp**. Von vier
Gebirgskategorien der Quelle trifft genau **eine** auf unsere Daten zu.

💣 **Querfeldein ist landschaftsabhängig und darf nicht pauschal behandelt werden.** In der Quelle
zerfällt es je nach Umgebung: „Offenes Gelände 0,75" ist keine Gebirgskategorie, „Gebirge (kein
Klettern) 0,2" sehr wohl. Wir können die Fälle heute nicht unterscheiden. Praktisch ist das derzeit
folgenlos: synthetische Querfeldein-Kanten tragen gar keinen Geländefaktor, weil
`avesmapsRouteAttachTerrain` eine `public_id` mit passender `path_terrain`-Zeile verlangt. ⚠️ Für
die V14-Offroad-Etappen ist das **nicht geprüft**.

---

## 2. Variante A — strenge Regelumsetzung

```
F_Gebirgspass(s) = 1     für jede Steigung s
```

Wörtlich regelgetreu. Jeder Pass reist gleich schnell, unabhängig von seinem Profil.

**Gemessene Wirkung** (Route Lowangen→Greifenfurt, 2026-08-01): der streckengewichtete
Gesamtfaktor fällt von 1,1299 auf 1,0155. A entfernt damit **88 % der gesamten Geländewirkung**,
weil diese auf heutigem Datenstand fast vollständig auf Gebirgspass sitzt (Straße trug auf
derselben Route exakt 1,0000).

---

## 3. Variante B — kalibrierte kontinuierliche Erweiterung

```
F̃(s) = F(s) / mean_pass(F)
```

Die Steigung wirkt **innerhalb** der Kategorie, ihr Mittel über den Passbestand ist exakt 1.

🔴 **Das ist eine Modellverfeinerung, keine DSA-Regel.** Die Quelle erlaubt sie nicht und verbietet
sie nicht; sie äußert sich zur Streuung innerhalb einer Kategorie überhaupt nicht. Wer dieses
Dokument später liest: B steht auf unserer Entscheidung, nicht auf S. 123.

---

## 4. Mathematische Definition

Mit dem Wirkungsgrad `α`:

```
F_α(s) = 1 + α · ( F(s) / mean_pass(F) − 1 )

α = 0  →  F_α ≡ 1                      (Variante A)
α = 1  →  F_α = F(s) / mean_pass(F)     (Variante B)
```

`F(s)` ist der unnormierte Zeitfaktor aus `api/_internal/routing/terrain-factor.php`.
`mean_pass(F)` ist das **längengewichtete** Mittel über alle Gebirgspass-Wegrichtungen des
Kalibrierungsbestands (§5).

**Zwei Präzisierungen, die beim Schreiben dieses Dokuments korrigiert werden mussten:**

💣 **A und B unterscheiden sich NICHT durch eine Konstante.** A ist die konstante Funktion 1, B eine
variable Funktion der Steigung. Nur B und die unnormierte Ausgangskurve `F` unterscheiden sich um
den globalen Faktor `mean_pass(F)`. Der stetige Übergang zwischen A und B ist `α`, nicht ein Faktor.

💣 **Die globale Normierung garantiert die Hin-und-Rück-Eigenschaft NICHT.** Sie garantiert allein
das Mittel über den **gesamten Passbestand**. Eine Hin- und Rückquerung *eines bestimmten* Passes
ergibt nur dann wieder den Kategorienwert, wenn dessen eigenes Zweirichtungsmittel zufällig dem
Bestandsmittel entspricht. Wollte man diese Eigenschaft, müsste **je Pass** oder über symmetrisch
gewichtete gerichtete Kanten normiert werden — das ist ein anderes Modell und ausdrücklich nicht
das hier festgelegte.

### 4.1 Drei Eigenschaften von B, die dokumentiert bleiben müssen

**Das Mittel gilt über den Bestand, nicht über eine Reise.** `mean_pass(F̃) = 1` heißt: der
durchschnittliche Pass der Karte behält seinen DSA-Wert. Eine konkrete Reise über einen konkreten
Pass behält ihn nicht — wer den steilsten Pass Aventuriens überquert, ist langsamer als DSA. Das
ist gewollt und wird trotzdem regelmäßig als Fehler gemeldet werden.

💣 **Die Geschwindigkeit eines Passes hängt an den anderen Pässen.** Der Nenner ist ein
Bestandsmittel. Wird ein neuer, sehr steiler Pass eingetragen, wird jeder bestehende Pass dadurch
geringfügig **schneller**, ohne dass an ihm etwas geändert wurde. Unter A kann das nicht passieren.
Dies ist der Preis von B und der Grund für die Festschreibung in §5.

**Die Normierung wirkt über beide Richtungen** des Passbestands — bergauf langsamer, bergab
schneller. Siehe aber die zweite Präzisierung oben: daraus folgt keine Aussage über eine einzelne
Querung.

### 4.2 🔧 Offen: der Wert von α

Noch nicht entschieden. Argument für **α = 1**: die Geländeebene bleibt wirksam. Argument für
**α = 0 (vorerst)**: 15 der 16 Gebirge laufen auf Platzhalterhöhen, B verteilte also heute nach
prozeduralem Rauschen um statt nach Aventurien. Der Übergang ist ein Zahlenwert, kein Umbau.

---

## 5. Der Kalibrierungsbestand — und warum er festgeschrieben wird

🔴 **`mean_pass(F)` darf NIE implizit neu berechnet werden.** Weder beim Lesen einer Route, noch bei
einer Kartenänderung, noch beim Profillauf ohne ausdrückliche Auslösung. Andernfalls ändert sich
die Reisezeit der ganzen Karte, ohne dass jemand etwas angeklickt hat — und niemand könnte im
Nachhinein sagen, welcher Wert galt, als eine Route geteilt wurde.

Der gespeicherte Eichsatz führt deshalb mit:

| Feld | Zweck |
|---|---|
| `mean_pass_f` | der Normierungswert selbst |
| `alpha` | der Wirkungsgrad aus §4.2 |
| `map_revision` | Stand des Wegenetzes bei der Berechnung |
| `heightmap_stamp` | Stand der Höhenraster |
| `profile_run_token` | der Profillauf, aus dem die Summen stammen |
| `computed_at`, `computed_by` | wer und wann |

**Regeln dazu:**

1. Der Wert ändert sich **ausschließlich** durch die ausdrückliche Aktion „Wegprofile kalibrieren".
2. Hat sich `map_revision` oder `heightmap_stamp` seither bewegt, meldet das System **„Eichung
   veraltet"** — es rechnet **nicht** nach. Dasselbe Muster wie beim `heightmap_stamp` des
   Profillaufs, der als veraltet *gemeldet* und trotzdem *benutzt* wird.
3. Der Lauf schreibt nur beim `$done`. Eine abgebrochene Kalibrierung lässt den alten Wert stehen.
4. Alter und neuer Wert stehen im Ergebnisbericht der Aktion.

---

## 6. Was hiermit **nicht** entschieden ist

- **Die Kurvenform `F`** — Leistungskilometer, Tobler, Irmischer & Clarke oder ein anderes Modell.
  ⚠️ Die Faktoren ×0,75 und ×0,5 aus S. 123 taugen **nicht** als Prüfstein dafür: die Quelle
  kennzeichnet sie selbst als schwer angebbar, definiert weder „Hügel" noch „Berg", und ohne eine
  unabhängige Zuordnung von Landschaftsbegriff zu messbarer Steigung erfüllt jede stetige Kurve
  beide Stützwerte.
- **Die Kante bei 20 % Gefälle** (Sprung von 1,0 auf 2,33).
- **Das absolute Niveau** — wir liegen 11–87 % über den Tagesleistungen der Quelle.
- **Die Rastzeit**, die heute auf die Reisezeit addiert wird, obwohl DSAs Tagesleistung sie enthält.
- **Die Kutschenregel „auf Karrenwegen und Pässen nur halbe Geschwindigkeit"** (S. 123), die uns
  fehlt. Die übrigen Kutschenverbote — nicht auf Pfaden, nicht querfeldein, nicht in Wüste und
  Eisgebieten — sind seit `b4e43404` abgebildet und durch die Quelle wörtlich gedeckt.

---

## 7. Was ein Test sichern muss

- `F_α` mit `α = 0` liefert für jede Steigung exakt `1,0` auf Gebirgspass.
- `F_α` mit `α = 1` liefert über den gespeicherten Kalibrierungsbestand ein längengewichtetes
  Mittel von exakt `1,0`.
- Auf allen anderen Landsubtypen bleibt `F` **unnormiert**.
- Der Normierungswert wird beim Routen **gelesen**, nie berechnet.
- Ein veralteter Eichsatz führt zu einer Meldung, nicht zu einer Neuberechnung.
