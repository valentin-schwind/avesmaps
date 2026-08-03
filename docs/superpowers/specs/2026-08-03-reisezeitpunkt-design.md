# Reisezeitpunkt — Entwurf

**Stand:** 2026-08-03 · Owner-Auftrag vom 2026-08-03 · Vorgänger: die einklappbaren
Einstellgruppen (`ce489c2c` … `bdd4c353`), die den Platz für eine dritte Zeile erst geschaffen haben.

Ein **Reisebeginn** (Tag + aventurischer Monat) im Routenplaner. Er wirkt zweifach:

1. **auf die Reisezeit** — die Jahreszeit verschlechtert den Bewegungsfaktor je Etappe;
2. **auf die Wegwahl** — saisonal gesperrte Wege fallen für den betroffenen Zeitraum aus dem
   Graphen.

Der Kalender **läuft entlang der Route mit**: eine Reise dauert Tage bis Wochen, wer im Firun
aufbricht, kommt womöglich im Tsa an. Die Jahreszeit hängt deshalb an der **Etappe**, nicht an
der Reise.

---

## 1. Quellenlage

Beide Quellen liegen dem Owner vor:
`~/Dropbox/DSA/Regeln/AVENTURISCHES_REISEHANDBUCH.md` (Auszug mit PDF-Seitenbezügen) und
`~/Dropbox/DSA/Regeln/601849275-DSA-G00-Geographia-Aventurica.pdf` (254 Seiten; die Textebene ist
brauchbar, Umlaute sind teils zerschossen — beim Greppen ASCII-tolerant vorgehen).

### 1.1 Der Zeitfaktor ist eine SUBTRAKTION, kein Prozentaufschlag

💣 **Das ist die wichtigste Korrektur gegenüber dem Mockup vom 2026-08-03.** Dort standen
erfundene Prozentwerte („Winter +25 %"). Die Quelle rechnet anders:

> | Wetter/Jahreszeit | Faktor/Fußreise |
> |---|---|
> | aufgeweichter Boden / leichter Schnee | **−0,1 vom Bewegungsfaktor** |
> | stark aufgeweicht / Tiefschnee / Eis | **−0,2 vom Bewegungsfaktor** |
>
> — Reisehandbuch §21, Geographia PDF-S. 122–123

Dazu die Untergrenze: „Die Bodenabzüge von 0,1 bzw. 0,2 werden vom Bewegungsmultiplikator
abgezogen; **durch Boden kann der Gesamtwert nicht unter 0,05 sinken**" (Reisehandbuch §11,
PDF-S. 123).

Und eine Ausnahme: „aufgeweichter Boden … **Straße ausgenommen bei Nässe**" (§21). Schnee und Eis
treffen die Straße sehr wohl — nur der aufgeweichte Boden nicht.

**Warum das wichtig ist:** eine Subtraktion trifft schwaches Gelände viel härter als starkes,
und zwar von selbst. Mit den Wegtyp-Faktoren aus dem Reisehandbuch (§13):

| Wegart | Faktor | −0,2 ergibt | Zeit |
|---|---:|---:|---:|
| Reichsstraße | 1,1 | 0,9 | **+22 %** |
| Straße | 1,0 | 0,8 | **+25 %** |
| Gebirgspfad | 0,3 | 0,1 | **+200 %** |
| Passstrecke | 0,4 | 0,2 | **+100 %** |

Genau das „Straßen werden geräumt, Querfeldein nicht", das im Mockup noch von Hand als
Anteilstabelle (⅓ / ½ / 1/1) modelliert war — hier fällt es aus der Quelle heraus. **Die
Anteilstabelle aus dem Mockup entfällt ersatzlos.**

### 1.2 Was die Quelle NICHT liefert

Es gibt **keine** Tabelle „Monat × Region → Bodenzustand". Die Quelle nennt nur:

- die Bodenzustände und ihre Abzüge (oben),
- „Im Winter sind Schneeschuhe und Schlitten praktisch die einzigen Fortbewegungsmittel" für den
  Hohen Norden und die Eisgebiete (§22, PDF-S. 121),
- die Sperrzeiträume einzelner Pässe, Seegebiete und Flüsse (unten, §2).

Die Zuordnung **Monat + Breitengrad + Gelände → Bodenzustand** ist daher unsere Setzung und
gehört vor dem Bauen vom Owner bestätigt. Vorschlag in §3.

---

## 2. Saisonale Sperrungen — die Quelle nennt DREI Wegarten, nicht eine

Der Owner-Auftrag ging von Gebirgspässen aus und bat, andere Fälle zu melden. Es gibt sie.

### 2.1 Gebirgspässe (Geographia PDF-S. 115–116)

| Pass | Fenster laut Quelle |
|---|---|
| Greifenpass | **gesperrt** Mitte Hesinde – Mitte Phex (sonst Reichsstraßenstandard bis ~1.600 Schritt) |
| Roterzpass | gangbar Anfang Peraine – Ende Boron |
| Eisenwalder Passstraße | gangbar Anfang Peraine – Ende Boron |
| Arvepass | kaum passierbar Firun – Mitte Phex |
| Rabenpass (Gelbe Sichel) | passierbar Peraine – Travia |
| Sattel Thasch/Finsterkamm | gangbar Mitte Peraine – Ende Efferd |
| Saljethstieg | gangbar Mitte Peraine – Ende Efferd |
| Schattenpass | nur im Sommer, nur für Fußgänger |
| Hjaldorberge | gangbar Ingerimm – Efferd |
| Raschtulsweg | schneefrei Ingerimm – Rondra; nicht für Karren |
| Kabashpforte | ganzjährig |
| Raulsjoch | kein Fenster genannt; nicht für Karren/Kutschen |
| Sichelstieg, Schattengrundpass | genannt, **kein** Fenster in der Quelle |

⚠️ **Widerspruch, der beim Einpflegen zu klären ist:** das Reisehandbuch schreibt „Roter Pass …
Peraine–Travia", die Geographia (PDF-S. 116) schreibt dieses Fenster dem **Rabenpass** über die
Gelbe Sichel zu. Nicht stillschweigend entscheiden — beide Namen existieren.

### 2.2 Seewege (Geographia PDF-S. 131)

> „Nördlich von Thorwal wird die Seefahrt **von Travia bis Peraine** meist gänzlich eingestellt,
> im nördlichen Perlenmeer und zwischen Grangor und Thorwal ruht sie meist **von Ende Boron bis
> Anfang Phex**; sonst ganzjährig."

Zwei verschiedene Fenster, beide regional. Da unsere Seewege geografisch liegen, lassen sie sich
auf die betroffenen Segmente eintragen.

### 2.3 Flusswege (Geographia PDF-S. 130)

> „Zudem kann es bei vielen Flüssen Nordaventuriens geschehen, dass sie während einiger Wochen
> oder gar Monate **im Winter zufrieren** oder zumindest durch starken **Eisgang** jegliche
> Schiffahrt unterbinden."

Namentlich mit Eisgang im Winter: **Born**, **Walsach**, **Bodir**. Und ein umgekehrter Fall:
**Szinto ab Machsiz „außer Hochsommer"** (Niedrigwasser) — die Sperrung ist also nicht immer
winterlich, das Datenmodell darf kein „Wintermonat" hart annehmen.

### 2.4 Folgerung für den Auftrag

Die Sperrfelder gehören an **`Gebirgspass`, `Seeweg` und `Flussweg`** — nicht nur an den Pass.
Technisch ist das dieselbe Datenstruktur; nur die Sichtbarkeit im Editor entscheidet, wo sie
angeboten wird. Für die übrigen Wegarten (`Reichsstrasse`, `Strasse`, `Weg`, `Pfad`,
`Wuestenpfad`) nennt die Quelle keine saisonalen Sperrungen; dort bleiben die Felder verborgen.

---

## 3. Vorschlag: Monat + Lage → Bodenzustand

Unsere Setzung, weil die Quelle sie nicht liefert. Drei Breitenbänder nach der y-Koordinate der
Etappe (Leaflet-y, `0..1024`, kleiner Wert = weiter im Norden — **beim Bauen an echten Daten
prüfen, nicht annehmen**):

| Band | Winter (Firun·Tsa·Phex) | Frühling (Peraine·Ingerimm·Rahja) | Sommer (Praios·Rondra·Efferd) | Herbst (Travia·Boron·Hesinde) |
|---|---|---|---|---|
| **Norden** | Tiefschnee/Eis (**−0,2**) | aufgeweicht (**−0,1**) | — | aufgeweicht (**−0,1**) |
| **Mitte** | leichter Schnee (**−0,1**) | aufgeweicht (**−0,1**) | — | aufgeweicht (**−0,1**) |
| **Süden** | — | — | — | — |

- Die **Straßenausnahme** gilt nur beim aufgeweichten Boden, nicht bei Schnee/Eis (§1.1).
- **Wasser** (`Flussweg`, `Seeweg`) bekommt keinen Bodenabzug — Wasser hat keinen Boden. Für
  Wasser wirkt die Jahreszeit ausschließlich über die Sperrung (§2.2/2.3). Das ersetzt den
  „Wasser ⅕"-Anteil aus dem Mockup.
- Der **Süden** trägt in dieser Fassung keinen Aufschlag. Die große Hitze ist in der Quelle ein
  **Wetter**-Faktor (0,9 bzw. 0,8), kein Jahreszeit-Faktor, und Wetter wählt der Planer nicht.
  ⚠️ Das ist bewusst so und weicht vom Mockup ab, das dem Süden einen Sommeraufschlag gab.

**Diese Tabelle ist der offene Punkt Nummer 1.** Sie ist plausibel, nicht kanonisch.

---

## 4. Oberfläche

### 4.1 Routenoptionen, dritte Zeile

```
Schnellste Route    Kürzeste Route
Umsteigen minimieren
Reisestunden pro Tag: [ 12,0 ]
Reisebeginn: [ 25 ] [ Firun (Winter) ▾ ]
```

Owner-Vorgabe 2026-08-03: **Beschriftung zuerst, dann der Wert.** Damit ändert sich auch die
bestehende Stundenzeile von „`[12,0]` Reisestunden pro Tag" auf „Reisestunden pro Tag: `[12,0]`" —
die beiden Zeilen müssen dieselbe Grammatik sprechen.

Voreinstellung ist **„Ohne Jahreszeit — kein Einfluss"**. Das ist Pflicht, nicht Bequemlichkeit:
`POST /api/route/` ist der stabile öffentliche Vertrag, und ein geteilter Link muss beim Empfänger
dieselbe Zahl zeigen wie beim Absender.

Eingeklappt liest die Kopfzeile: `Routenoptionen  Schnellste Route · 12,0 h/Tag · ab 25. Firun`.

### 4.2 Infodialog

Die Routenoptionen bekommen einen **ⓘ-Knopf wie die Transportmittel** und darin die
Erklärungsübersicht: Bodenabzüge und ihre Herkunft, die Bänder-Tabelle, was der mitlaufende
Kalender bedeutet, welche Wegarten gesperrt werden können — und die Quellenangaben mit
PDF-Seiten. Muster: `js/routing/transport-speed-info.js` (195 Z.) +
`css/features/transport-speed-info.css`, Overlay-Klasse `.tsi-overlay`.

### 4.3 Reiseplan

Der Gewinn steht in der Ausgabe, nicht in der Einstellung:

- Zusammenfassung: `Reisebeginn 25. Firun`, `Ankunft 10. Tsa (über Firun, Tsa)`,
  `Jahreszeit Winter +19 % Reisezeit`.
- Je Etappe ein leiser Vermerk mit **ihrem** Datum und **ihrem** Abzug.
- Fällt eine Route wegen einer Sperrung anders aus, muss der Plan das sagen
  („Greifenpass Mitte Hesinde–Mitte Phex gesperrt — Umweg über …"). **Ohne diese Zeile merkt
  niemand, dass die Jahreszeit gewirkt hat.**

### 4.4 Editoren

Sperrzeitraum je Weg, sichtbar nur bei `Gebirgspass`, `Seeweg`, `Flussweg`:

- **„Wege bearbeiten"** (Sync-Editor, `html/wege-editor.html` + `js/pages/wege-editor.js`) —
  neben `allowed_transports` in der Spalte „Eigenschaften".
- **„Weg bearbeiten"** (Karte, `js/review/review-paths.js`) — dieselben Felder.

Form: **von-Monat/-Tag bis-Monat/-Tag**, über den Jahreswechsel hinweg zulässig (Greifenpass:
Mitte Hesinde → Mitte Phex läuft über den Jahresanfang). Dazu ein Textfeld für die Quelle
(„Geographia PDF-S. 115") und ein Schalter „gesperrt / nur eingeschränkt".

---

## 5. Was daran hängt

| Ort | Änderung |
|---|---|
| `POST /api/route/` | Optionale Felder für den Reisebeginn. Fehlen sie, rechnet der Server wie bisher — der stabile Vertrag bleibt. |
| Teilen-Link | Der Reisebeginn muss mitreisen wie `pathType` (`js/map-features/map-features-layer-state.js:245`). |
| Zwei Engines | 💣 Server **und** Client müssen dieselbe Zahl liefern (`api/_internal/routing/`, `js/routing/`), sonst springt die Reisezeit beim Umschalten — siehe `routing-two-server-switches`. |
| Graph | Die Sperrung entfernt Kanten **datumsabhängig**. Da der Kalender entlang der Route läuft, ist das keine einfache Vorfilterung des Graphen. Siehe §6. |
| `map_features` | Sperrzeitraum in den `properties` des Wegs, analog `allowed_transports`. |

---

## 6. Der harte Teil: Sperrung × mitlaufender Kalender

Selbstbezüglich: welcher Tag an einer Kante gilt, hängt davon ab, wie lange die Route bis dorthin
gebraucht hat — und wie lange sie gebraucht hat, hängt davon ab, welche Kanten offen waren.

**Empfehlung: nicht auflösen, sondern entschärfen.** Dijkstra bekommt beim Aufbau der Kante das
Datum, das sich aus der bis dahin akkumulierten Zeit ergibt (die Kosten kennt der Algorithmus an
der Stelle ohnehin) — das ist exakt für den Zeitfaktor und für die Sperrung *fast* exakt. Der
Restfehler tritt nur auf, wenn eine Route genau am Rand eines Sperrfensters liegt; dann kann eine
Kante geöffnet werden, die bei genauerer Rechnung geschlossen gewesen wäre.

**Alternative, falls das zu teuer wird:** Sperrung gegen das **Aufbruchsdatum** prüfen (eine
Vorfilterung des Graphen, billig und vorhersagbar), Zeitfaktor weiterhin je Etappe. Dann ist die
Wegwahl grob, die Zeit fein.

⚠️ Diese Entscheidung gehört gemessen, nicht geraten — die Graphgröße steht in
`client_graph_statistics`, und `docs/superpowers/plans/2026-08-02-ausloeser-anker-und-x25-aufschlag.md`
beschreibt, wie teuer ein zusätzlicher Rechenschritt je Route wird.

---

## 7. Offene Punkte für den Owner

1. **Die Bänder-Tabelle aus §3** — plausibel, nicht kanonisch. Bestätigen oder korrigieren.
2. **Roter Pass vs. Rabenpass** (§2.1) — welcher Name trägt das Fenster Peraine–Travia?
3. **Süden ohne Sommeraufschlag** (§3) — bewusst, weil die Hitze in der Quelle Wetter ist und
   nicht Jahreszeit. Einverstanden?
4. **§6**: exakte Sperrprüfung je Kante oder grobe Prüfung gegen das Aufbruchsdatum?
5. Soll der Reisebeginn auch die **Reisestunden pro Tag** vorschlagen (im Firun ist es früher
   dunkel)? Empfehlung: nein — es überschriebe einen Wert, den der Nutzer gerade selbst gesetzt hat.
