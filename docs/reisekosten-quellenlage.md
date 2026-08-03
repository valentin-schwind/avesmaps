# Reisekosten im Routenplaner — Quellenlage und Machbarkeit

**Stand:** 2026-08-03 · **Status:** Analyse, noch keine Entscheidung
**Geprüft:** *Geographia Aventurica* (PDF-S. 113–141) über `AVENTURISCHES_REISEHANDBUCH.md`,
gegengelesen im Rohtext der Quelle; *DSA5 Regelwerk, 3. Auflage* S. 382; *DSA5 Kodex der
Helden* S. 474–476; *DSA4.1 Wege des Entdeckers* S. 72–79, 125; Live-Daten von avesmaps.de
(Herrschaftsgebiete, Ortsarten, zwei echte Routen).

> ⚠️ **Preistabellen aus diesen PDFs nie per `pdftotext` übernehmen.** Die zweispaltigen
> Tabellen verrutschen beim Textauszug zeilenweise — im Kodex landete die Kopfzeile
> „Übernachtung pro Tag" auf dem ersten Preis und verschob die ganze Spalte, sodass ein
> Bett im Gemeinschaftszimmer 5 Silbertaler statt 6 Heller kostete (Faktor 8). Jede Zahl
> in diesem Dokument ist am gerenderten Seitenbild geprüft.

Die Frage war: kann der Routenplaner Reisekosten ausweisen — Tavernen, Übernachtung,
Zölle beim Grenzübertritt, und was sonst noch anfällt?

Kurz: **Zölle ja, und zwar rechnerisch sauber. Tavernen ja, aber nicht aus der Geographia.**
Zwei Befunde stehen dem im Weg, beide lösbar, beide muss man vorher kennen.

Zwei Dinge, die man erwarten würde, gibt es dagegen **gar nicht**: eine Brücke oder Fähre
auf der Karte (§3.3) und ein Merkmal für Unterbringung (§6). Beides ist nachrüstbar, und
beides gehört an ein Objekt, das die Route ohnehin berührt — nicht in eine neue Tabelle.

---

## 1. Die zwei unangenehmen Befunde

### 1.1 Die Geographia kennt keinen einzigen Übernachtungspreis

Das ist keine Lücke im Reisehandbuch, sondern in der Quelle. Die Geographia sagt es selbst
(zusammengefasst in Abschnitt 27 des Reisehandbuchs):

> Unterkunft, Stall, Futter, Mietpferd, Wagenmiete, Führer, Träger, Lotse, Reparatur,
> Hafen-, Anker-, Liege-, Kanal- und Schleusengebühren besitzen **keine allgemeinen Preise**.

Sie beschreibt Herbergen ausführlich — alle 15 Meilen ein Landgasthaus an der Reichsstraße,
alle 20 Meilen eine Herberge an der Reichsland-/Kronstraße — nennt aber nie, was eine Nacht
dort kostet. Wer Tavernenkosten will, braucht eine **zweite Quelle**.

Die naheliegende ist das **DSA5-Regelwerk, S. 382, „Das aventurische Gasthaus"**. Dort steht
die vollständige Preisliste (siehe §2.2). Sie ist ausdrücklich als *Beispiel* für ein
„typisches, mittelreichisches Gasthaus" ausgewiesen — also eine Hausnummer, kein Tarif.
Der **Kodex der Helden druckt dieselbe Tabelle auf S. 476 wortgleich nach** — Zahl für Zahl
identisch. Es gibt für Übernachtungen also genau *eine* Quelle, nicht zwei.

Die übrigen Lücken der Geographia — **Futter, Proviant, Hufpflege** — schließen Kodex und
*Wege des Entdeckers* dagegen wirklich (§2.3).

### 1.2 Beide Quellen widersprechen sich bei Passagepreisen — um den Faktor 3 bis 10

Wo beide Bücher denselben Posten beziffern, sind sie sich nicht einig:

| Leistung, je 100 Meilen und Person | Geographia S. 119/129/131 | Regelwerk S. 382 | Faktor |
|---|---:|---:|---:|
| Postkutsche / Reisekutsche | 4 D = 40 S | 12 S | **3,3×** |
| Flusskahn stromab | 1 D = 10 S | 1 S | **10×** |
| Flusskahn stromauf | 3 D = 30 S | 8 S | **3,8×** |
| Seereise, Hängematte | ~4 D für Havena–Kuslik | 8 S | nicht direkt vergleichbar |
| Seereise, Kabine | ~25 D für Havena–Kuslik | 150 S = 15 D | — |

Das ist kein Rundungsproblem. Eine Kutschfahrt Gareth–Fasar kostet nach Geographia
rund 25 Dukaten, nach Regelwerk rund 7,6. **Der Planer muss sich für eine Quelle
entscheiden und das sichtbar dazuschreiben** — sonst rechnet er eine Zahl aus, die
die Hälfte der Runden am Tisch nicht wiedererkennt.

Empfehlung: **Geographia führt, Regelwerk füllt die Lücken.** Der Planer rechnet ohnehin
schon mit den Geschwindigkeiten der Geographia (`SPEED_TABLE`, Reisehandbuch), und ein
Mischpreis aus zwei Systemen wäre schlimmer als jede Einzelentscheidung. Das Regelwerk
liefert dann genau das, wozu die Geographia schweigt: Bett, Essen, Stall.

### 1.3 Und ein drittes Preisgefüge aus einer anderen Regeledition

*Wege des Entdeckers* ist **DSA4.1**, die anderen drei Bücher sind DSA5. Das Preisniveau
ist zufällig verträglich (Zugpferd 50–120 D dort gegen Pferd 75 D im Kodex), aber es ist
ein eigenes System. Nur dort steht die **Tagesmiete für Fahrzeuge samt Zugtieren und
Lenker** — der einzige Preis in allen vier Büchern, der schon in der Einheit vorliegt,
die der Planer ohnehin ausrechnet (Tage). Wer ihn nimmt, mischt Editionen; wer ihn
weglässt, verzichtet auf den einzigen fertig passenden Posten. Das ist eine
Owner-Entscheidung, keine technische.

---

## 2. Was die Quellen hergeben

### 2.1 Zölle und Gebühren — Geographia S. 113–115

Alles hier ist beziffert und regional begründet.

| Abgabe | Anlass | Höhe | Für uns auslösbar durch |
|---|---|---|---|
| **Reisendenzoll** | Landesgrenze | 1 H (Tagelöhner) · 5 H (Schustergeselle) · 1 D (Söldner) · bis 5 D (Apotheker, Magier, Drucker, Goldschmied) | Wechsel des souveränen Gebiets |
| **symbolischer Obolus** | Provinzgrenze | ~1 H | Wechsel der Provinz im selben Reich |
| **Einfuhrzoll** | Landesgrenze | 5–10 % Warenwert | nur mit Handelsware |
| **Binnenzoll** | Provinzgrenze | 3–5 % Warenwert | nur mit Handelsware |
| **Brückenzoll** | Brücke | 1 K/Bein + 1 H/Rad | Brücke auf der Route |
| **Wegzoll** | Pass, Serpentine, Knüppeldamm, Tunnel | „im Rahmen des Brückenzolls" | Etappe vom Subtyp `Gebirgspass` |
| **Fährgeld** | Überfahrt | 1–8 H/Bein + 3–30 H/Rad, bis 10× bei nicht voller Fähre | Fährstation auf der Route |
| Ausfuhr-, Fluss-, Hafenzoll | — | **nicht beziffert** | — |

Zwei Regeln sind mechanisch wertvoll, weil avesmaps sie schon weiß:

- **Auf der Reichsstraße wird nur an den Außengrenzen des Reiches Zoll erhoben** — „quasi
  beim Betreten der Straße", innerhalb fällt nichts weiter an. Der Planer kennt den Subtyp
  jeder Etappe. Eine Reichsstraßen-Route durchs Mittelreich ist damit **zollfrei bis zur
  Reichsgrenze** — das ist genau der Grund, warum Reichsstraßen sich lohnen, und der Planer
  könnte es zum ersten Mal zeigen.
- **Zwölfgöttergeweihte passieren die meisten Grenzen zollfrei**, sofern sie nicht als
  Händler auftreten.

### 2.2 Übernachtung, Essen, Stall — DSA5-Regelwerk S. 382

| Übernachtung, pro Nacht | Preis |
|---|---:|
| Strohsack im Schlafsaal | 2 H |
| Bett im Gemeinschaftszimmer | 6 H |
| Einzelzimmer | 3 S |
| Doppelzimmer | 5 S |
| Suite | 100 S |
| **Pferd im Stall mit Futter** | 6 H |

Essen (Auswahl): Grütze 1 H · Pfannkuchen mit Kompott 2 H · Gemüseeintopf 3 H ·
Brotmahlzeit 5 H · Fisch- oder Fleischgericht 7 H.
Trinken: Wasser (Krug) 6 K · Bier (Krug) 16 K · Wein (Becher) 3 H.

**Übernachtung im Freien kostet keine Miete** — in keiner Quelle. Sie hat einen Preis in
*Regeneration*, und *Wege des Entdeckers* S. 125 beziffert ihn, wo die Geographia nur
qualitativ blieb:

> Üblich sind 1W6 LeP und AsP je Nacht. **Ungestört in einem weichen Bett bis zu +2.**
> Unter freiem Himmel, unterbrochen von Nachtwachen, deutlich weniger. Nicht regengeschützt:
> −1 bei Nieselregen, −2 bei Regen. Schlafplatz voller Krabbeltiere: −1.
> Sechs Stunden Schlaf reichen normal; nach einer ganztägigen Wanderung sind sieben bis acht
> angebracht.

Damit ist „im Freien" kein Gratis-Häkchen mehr, sondern ein Tausch: Geld gegen bis zu
4 Punkte Regeneration pro Nacht. Das gehört in die Anzeige, sonst sieht die Wildnis nach
der schlauen Wahl aus.

### 2.3 Futter, Proviant, Hufpflege — die Lücken der Geographia, geschlossen

Das sind die vier Zahlen, die diese Runde wirklich gebracht hat. Alle am Seitenbild geprüft.

| Posten | Preis | Quelle |
|---|---:|---|
| **Pferdefutter** | 0,5 S **pro Woche** | Kodex S. 475 |
| Ponyfutter · Hundefutter | 0,3 S · 0,2 S pro Woche | Kodex S. 475 |
| **Proviant, einfach** | **4 H pro Person und Tag** | Wege des Entdeckers S. 72 |
| Proviant, edel · Notration | 4 S und mehr · 6 H je Ration | Wege des Entdeckers S. 72 |
| Proviant für drei Tage (0,2 Stein) | 0,8 S ≈ 2,7 H/Tag | Kodex S. 471 |
| **Pferd beschlagen** | 0,5 S **pro Huf** | Kodex S. 475 |

Zwei davon greifen direkt in Regeln der Geographia:

- Die Geographia sagt, Pferde brauchen unterwegs Futter, und nennt keinen Preis. Jetzt gibt
  es einen — und er ist **pro Woche**, also unmittelbar aus der Reisedauer zu rechnen.
- Die Geographia setzt an jedes Reichsstraßen-Landgasthaus (alle 15 Meilen) einen Hufschmied.
  Vier Hufe zu 0,5 S sind 2 S je Pferd — die Hufpflege einer berittenen Gruppe ist damit
  teurer als sämtliche Zölle der Strecke.

Beim Proviant nennen zwei Bücher zwei Zahlen (4 H gegen 2,7 H pro Tag). Das ist nah genug
beieinander, um es eine Spanne zu nennen statt einen Widerspruch — und beides liegt deutlich
unter dem, was zwei Mahlzeiten im Gasthaus kosten (6–14 H). Genau dieser Abstand ist die
Aussage: selbst kochen ist etwa halb so teuer wie einkehren.

### 2.4 Fahrzeug mieten statt Passage kaufen — nur in DSA4.1

*Wege des Entdeckers* S. 77, **Mietpreis pro Tag, mit Zugtieren und Lenker**:

| Fahrzeug | pro Tag |
|---|---:|
| Hundeschlitten · Dachsschlitten | 15 S · 16 S |
| Pferdeschlitten, zweispännig | 30 S |
| **Lastenkutsche, zweispännig** | **33 S** |
| Norbardischer Kastenwagen | 55 S |
| Stoerrebrandter, vierspännig · Kaleschka, dreispännig | 7 D · 11 D |
| Steppenschivone, sechsspännig | 22 D |

Das ist die einzige Preisform in allen vier Büchern, die **pro Tag** rechnet — die Einheit,
die der Planer schon hat. Zum Vergleich an Gareth→Fasar (634 Meilen, 18 Tage): Lastenkutsche
zur Tagesmiete 594 S ≈ 59 D, gegen 25 D nach Geographia und 7,6 D nach Regelwerk. Drei
Bücher, drei Antworten, Faktor 8 zwischen der höchsten und der niedrigsten.

Einmalige Anschaffungen (Pferd 750 S, Kutsche 2.000 S, Reisepakete 38 S bis 22,5 D) gehören
zur Heldenerschaffung, nicht in einen Routenplaner. Sie sind hier nur der Vollständigkeit
halber erwähnt.

### 2.5 Was diese drei Bücher NICHT liefern

- **Keinen einzigen Zollpreis.** Die Geographia bleibt die alleinige Quelle für Zölle;
  *Wege des Entdeckers* erwähnt Zölle genau einmal, als Beiwerk über Handelswege, die
  Grenzen umgehen.
- **Keine Löhne.** Weder Träger, Führer, Lotsen noch Söldner haben in einem der drei
  Bücher einen Tagessatz — obwohl *Wege des Entdeckers* seine ganze Expeditionsmechanik
  auf angeheuerte Begleiter stützt. Es behandelt sie über abstrakte Werte (Qualität,
  Moral, Ausrüstung von 1 bis 7), nicht über Geld. Der einzige bezahlte Helfer mit Preis
  ist der Lenker, und der steckt in der Fahrzeugmiete.
- **Keine zweite Übernachtungstabelle.** Der Kodex druckt die des Regelwerks nach.

### 2.6 Was sonst noch anfällt — und im Auftrag nicht genannt war

Drei Posten, die größer sind als die Zölle:

1. **Die Passage selbst.** Sobald man im Planer Kutsche, Flusssegler oder Handelsschiff
   wählt, reist man nicht selbst, sondern **kauft eine Fahrt**. Gareth→Fasar zu Pferd
   kostet Futter; dieselbe Strecke per Kutsche kostet 25 Dukaten. Der Planer kennt das
   Transportmittel bereits pro Etappe (`transports.land/river/sea`) — das ist der
   *teuerste* und zugleich am leichtesten zu rechnende Posten.
2. **Der Stall.** Wer beritten reist, zahlt jede Nacht 6 H pro Pferd — auf Gareth→Fasar
   (8 Herbergsnächte, vier Pferde) 19,2 Silbertaler. Ein spürbarer, aber kein führender
   Posten; die tatsächliche Rangfolge steht in §8.2.
3. **Verpflegung.** Zwei Mahlzeiten am Tag zu je ~4 H sind über zehn Reisetage 8 S pro Person.

Nicht empfohlen fürs erste Ausbaustück: Warenzölle (5–10 %) und die Handelsaufschläge
je Grenze (+40 % Land / +20 % See, Geographia S. 133–135). Die brauchen einen Warenwert,
den der Planer nicht hat — das ist ein Händler-Werkzeug, kein Reiseplaner-Feature.

---

## 3. Was avesmaps heute schon kann — an echten Routen geprüft

### 3.1 Grenzübertritte: funktioniert, exakt, ohne neue Daten

Die Herrschaftsgebiete liegen als Polygone im selben Koordinatensystem wie die Route.
Live abgerufen (`GET /api/app/political-territories.php?zoom=6`): **962 Gebiete mit
Geometrie**, davon 904 mit `parent_public_id` und **58 souveräne Wurzelgebiete**
(ohne Elternteil). Ein Grenzübertritt ist der Schnitt der Etappen-Geometrie mit dem
Rand eines Wurzelgebiets.

Zwei echte Routen über `POST /api/route/`, je Etappe geschnitten:

| Route | Länge | Staatsgrenz-Schnitte | Streckenanteil je Staat |
|---|---:|---:|---|
| **Gareth → Fasar** (zu Pferd) | 634 Meilen | 6 | Mittelreich 354,2 · Aranien 251,8 · Kalifat 24,4 · Fasar 3,8 |
| **Gareth → Al'Anfa** | 2.244 Meilen | 3 | Mittelreich 334,6 · Al'Anfa 5,2 — der Rest ist Seeweg |

Die Anteile von Gareth→Fasar summieren sich auf **634,3 von 634 Meilen**: die Polygone
kacheln entlang dieser Route lückenlos und ohne Überlappung. Die Rechnung ist nicht
geschätzt, sie ist exakt.

Bei Gareth→Al'Anfa liegen 1.900 Meilen in keinem Gebiet. Das ist richtig so: es ist offene
See. Passenderweise heißt das auch regeltechnisch, dass unterwegs keine Landzölle anfallen —
dafür Hafenzoll, den die Geographia nicht beziffert.

### 3.1a 💣 Die Schnittzahl ist NICHT die Zahl der Übertritte

Eine Straße, die sechsmal an einer Grenze hin- und herpendelt, erzeugt sechs
Geometrieschnitte — aber der Reisende zahlt einmal. Wer die Schnitte zählt, zählt die
Zacken des Grenzverlaufs, nicht die Zollhäuschen.

Richtig ist die **Lauflänge**: die Route in festen Schritten abtasten (1,2 Meilen), je
Punkt das kleinste umschließende Gebiet bestimmen, gleiche Nachbarn zusammenfassen und
Läufe unter 5 Meilen als Rauschen in den Vorlauf schlucken. Aus denselben Routen wird damit:

| Route | Staatsgrenzen | Provinzgrenzen | davon innerhalb desselben Staates |
|---|---:|---:|---:|
| Gareth → Fasar | **4** | 7 | 3 |
| Gareth → Al'Anfa | **1** | 2 | 1 |

Der Verlauf von Gareth→Fasar liest sich dann so: Mittelreich 342 Meilen → Aranien 21 →
Mittelreich 12 → Aranien 229 → Kalifat 30. Der kurze Wiedereintritt ins Mittelreich ist
**echt**, kein Rauschen — die Straße taucht dort tatsächlich zurück über die Grenze.
Genau solche Fälle würde ein zu grober Filter verschlucken und ein zu feiner vervierfachen.

### 3.1b Welche Ebene ist eine Zollgrenze?

Die Hierarchie ist fünf Ebenen tief. Live gezählt (962 Gebiete mit Geometrie), und daneben,
wie oft Gareth→Fasar sie schneidet:

| Ebene | Gebiete | Vorherrschende Arten | Rohe Schnitte |
|---:|---:|---|---:|
| **0** | 64 | Bergkönigreich 10 · Königreich 8 · Herrschaftsgebiet 6 · Reich 5 | **6** |
| **1** | 177 | Herrschaftsgebiet 37 · Grafschaft 24 · Sultanat 15 · Freiherrschaft 13 | 39 |
| 2 | 328 | **Baronie 212** · Grafschaft 25 · Einokratie 12 · Stadtmark 12 | 89 |
| 3 | 378 | **Baronie 227** · Beyrounat 47 · Gräfliche Baronie 20 | 45 |
| 4 | 15 | Edlengut | 2 |

**Die Geographia kennt genau zwei Zollgrenzen, und sie liegen auf Ebene 0 und 1:**

- **Ebene 0 = Landesgrenze.** Kein Elternteil, also souverän. Hier greift der Reisendenzoll
  (1 H bis 5 D nach Profession) und für Händler der Einfuhrzoll (5–10 %).
- **Ebene 1 = Provinzgrenze.** Die Quelle sagt dazu ausdrücklich „eigentlich nur die
  Provinzen des Mittelreichs und des Horasreichs", und für gewöhnliche Reisende nur
  „ein symbolischer Obulus von etwa einem Heller".
- **Ebene 2 bis 4 sind KEINE Zollgrenzen.** Das sind die 439 Baronien. Die Geographia
  erhebt an ihnen nichts, und die Zahlen zeigen, warum das auch spielpraktisch stimmt:
  89 Schnitte auf 634 Meilen wäre alle sieben Meilen ein Schlagbaum.

Für die Anzeige heißt das: **vier Grenzen auf 634 Meilen, nicht neunundachtzig.** Und die
drei Provinzübertritte innerhalb des Mittelreichs kosten zusammen 3 Heller je Person —
sie gehören in die Aufzählung, aber nicht in die Summe.

Dazu kommt die Reichsstraßen-Regel: 45 % dieser Route laufen auf Reichsstraße, und dort
wird laut Geographia **innerhalb des Reiches gar kein Zoll erhoben**.

**Drei Fallen bei der Umsetzung:**

- **Nicht die Etappen aneinanderhängen.** Die Segment-Geometrie liegt in *Speicherfolge*
  vor, nicht in Reisefolge. Ein naives Concat erzeugt Sprunglinien quer über die Karte —
  mein erster Durchlauf meldete dadurch 1.235 Meilen auf einer 634-Meilen-Route. Jede
  Etappe einzeln schneiden.
- **Nicht auf Baronie-Ebene zählen.** Ein Punkt-für-Punkt-Test über *alle* 962 Gebiete
  meldete für Gareth→Al'Anfa **49 Gebietswechsel** — Gluckenhang ↔ Gnitzenkuhl ↔
  Wasserburg im Wechsel, weil der Fluss die Grenze *ist*. Die Geographia kennt nur zwei
  Zollgrenzen: Land und Provinz. Baronien sind keine.
- **Das Feld `status` ist verschmutzt.** Live: 745× „abhängige Provinz", aber auch 10×
  „abhänige Provinz" (Tippfehler), 2× „unabhängiug", 91× leer. Als Weiche taugt es nicht.
  **Der verlässliche Test ist `parent_public_id` bzw. die Wurzel der Kette** — hat ein
  Gebiet keinen Elternteil, ist es souverän.

### 3.2 Übernachtung: funktioniert, aber über den Straßentyp, nicht über Orte

Der naheliegende Weg — „welche Siedlung liegt am Ende des Reisetags?" — ist der schlechtere.
Der Planer kennt zwar alle Knotennamen der Route (43 bei Gareth→Al'Anfa), aber viele davon
sind `Kreuzung-…`, und ob ein Dorf eine Schankstube hat, steht nirgends.

Der bessere Weg steht in der Quelle selbst: **der Straßentyp sagt, ob es ein Bett gibt.**

| Etappentyp | Quelle | Nachtlager |
|---|---|---|
| Reichsstraße | alle 15 Meilen ein Landgasthaus (S. 113) | immer ein Bett erreichbar |
| Straße (Reichsland-/Kronstraße) | alle 20 Meilen eine Herberge (S. 114) | immer ein Bett erreichbar |
| Weg | „bisweilen ein Gasthaus" (S. 114) | unsicher |
| Pfad, Gebirgspass, Wüstenpfad, Querfeldein | — | im Freien |

Das braucht **keine neuen Daten**: der Subtyp jeder Etappe ist bekannt, die Reisezeit
je Etappe auch, und der Planer rechnet die Rastzeit schon heute (`rest_hours_per_day`,
Vorgabe 10 h). Aus Reisezeit und Rastzeit fallen die Nächte von selbst ab.

Der Straßentyp bleibt die **Grundversorgung**; das Merkmal am Ort (§6) trägt die Ausnahmen
nach. Beides ist kein Entweder-oder, sondern zwei Schichten.

### 3.3 Brücken und Fähren: es sind **null**, nicht vierzig

⚠️ **Korrektur einer früheren Fassung dieses Dokuments.** Dort stand „40 Brücken in den
Daten", gestützt auf `GET /api/app/place-kinds.php`. Das war falsch gelesen: dieser
Endpunkt summiert **zwei** Quellen — `wiki_sync_pages.building_type` (den Artikelbestand
von Wiki Aventurica) und `map_features.properties.place_kind` (die Karte). Die 40 kommen
vollständig aus der ersten.

Nachgezählt im echten Kartenbestand (`GET /api/app/map-features.php`, 11.434 Features):

| | |
|---|---:|
| Features mit `properties.place_kind` überhaupt | **7** (6 Festung, 1 Palast) |
| „Besondere Bauwerke/Stätten" (`settlement_class = gebaeude`) | 277 |
| davon mit `wiki_settlement.art` = Brücke / Fährstation / Furt / Karawanserei | **0** |

**Auf der Karte steht keine einzige Brücke und keine einzige Fährstation.** Wiki Aventurica
hat 40 Brückenartikel und einen Fährstationsartikel; keiner davon ist je auf der Karte
verortet worden. Die Vermutung des Owners — „haben wir nicht auf der Karte, aber würde
theoretisch gehen" — ist damit bestätigt, mit einer Zahl.

### 3.4 Und wenn man sie hätte? Zoll gehört an den WEG, nicht an einen Punkt daneben

Technisch wäre „durchquert die Route dieses Gebäude?" trivial: Linie gegen Punkt mit
Radius. Aber es ist die schlechtere Bauform, und zwar aus einem sachlichen Grund:

> **Eine Brücke ist ein Stück Weg, kein Haus daneben.** Eine Fähre ist eine Etappe, kein
> Gebäude am Ufer.

Ein Punkt-mit-Radius muss raten: 200 Schritt neben der Straße — gehört die Brücke zu
*dieser* Straße oder zur parallelen? Zwei Wege kreuzen den Fluss 300 Schritt
auseinander — welcher trägt die Brücke? Ein Merkmal **am Weg** kennt diese Frage nicht:
die Route läuft über den Weg, also zahlt sie, bauartbedingt.

Das ist dasselbe Muster wie bei der Unterbringung (§6): das Merkmal gehört an das Objekt,
das die Route ohnehin berührt. Konkret ein Feld am Weg-Feature — `toll` mit den Werten
`bruecke` / `faehre` / `wegzoll` / `keiner` —, das der Wege-Editor setzt. Kein Radius,
kein Beinahe-Treffer, keine neue Tabelle.

**Trotzdem: nach Betrag sortiert lohnt nur die Fähre.**

| Abgabe | Gruppe zu 4 Personen und 4 Pferden (24 Beine) | Bewertung |
|---|---:|---|
| **Brückenzoll** (1 K/Bein) | 24 K = 2,4 H je Brücke · über **50** Brücken 1,2 D | Rundungsfehler |
| **Wegzoll** (Pass, „im Rahmen des Brückenzolls") | dieselbe Größenordnung | Rundungsfehler |
| **Fährgeld** (1–8 H/Bein, bis 10× bei unvoller Fähre) | 24 bis 192 H = bis **2 D je Überfahrt** | so viel wie ein Staatszoll |

Der Brückenzoll ist selbst bei perfekter Datenlage kein Posten: 1,2 Dukaten neben rund
**34 Dukaten Gesamtkosten** für dieselbe Gruppe auf Gareth→Fasar (§9, Reisestil
„gewöhnlich", 4 Personen) — dreieinhalb Prozent, verteilt auf fünfzig Erfassungsvorgänge.
Das **Fährgeld** dagegen wäre ein echter Posten; es scheitert allein daran, dass keine
Fähre auf der Karte steht. Wer Fähren erfasst, bekommt eine sinnvolle Kostenposition;
wer Brücken erfasst, bekommt Nachkommastellen.

Der **Wegzoll** ist immerhin gratis zu haben: `Gebirgspass` ist ein bestehender
Etappen-Subtyp, also eine Regelzeile ohne neues Datum — er bleibt aber betragsmäßig
neben der Brücke.

---

## 4. Machbarkeit auf einen Blick

| Posten | Quelle | Auslöser in avesmaps | Bewertung |
|---|---|---|---|
| **Passage** (Kutsche, Kahn, Schiff) | Geographia S. 119/129/131 | Transportmittel je Etappe | ✅ vorhanden, größter Posten |
| **Übernachtung** | Regelwerk S. 382 = Kodex S. 476 | Straßentyp + Reisetage | ✅ vorhanden, zweite Quelle nötig |
| **Stall** (Nacht im Gasthaus) | Regelwerk S. 382 | berittener Transport + Nächte | ✅ vorhanden |
| **Pferdefutter** | Kodex S. 475 | berittener Transport + Reisewochen | ✅ neu, rechnet pro Woche |
| **Proviant** | Wege des Entdeckers S. 72 · Kodex S. 471 | Reisetage | ✅ neu, rechnet pro Tag |
| **Hufpflege** | Kodex S. 475 | Pferdezahl · Reichsstraßen-Gasthäuser | ✅ neu, teurer als alle Zölle |
| **Verpflegung im Gasthaus** | Regelwerk S. 382 | Reisetage | ✅ vorhanden |
| **Fahrzeug-Tagesmiete inkl. Lenker** | Wege des Entdeckers S. 77 | Transportmittel + Reisetage | ⚠️ DSA4.1, Editionsbruch |
| **Reisendenzoll** (Landesgrenze) | Geographia S. 115 | Wechsel des Wurzelgebiets | ✅ geprüft, exakt |
| **Binnenobolus** (Provinzgrenze) | Geographia S. 115 | Wechsel der Provinz | ✅ vorhanden |
| **Reichsstraßen-Zollfreiheit** | Geographia S. 113 | Subtyp `Reichsstrasse` | ✅ vorhanden, macht die Rechnung erst interessant |
| **Brückenzoll** | Geographia S. 115 | **0** auf der Karte · Merkmal am Weg möglich | ⛔ Betrag ist ein Rundungsfehler |
| **Fährgeld** | Geographia S. 115 | **0** auf der Karte · Merkmal am Weg möglich | ⚠️ lohnt sich, aber Daten fehlen ganz |
| **Wegzoll** (Pass) | Geographia S. 115 | Subtyp `Gebirgspass` | ⚠️ gratis zu haben, aber winziger Betrag |
| **Hafen-, Fluss-, Ausfuhrzoll** | — | — | ⛔ Quelle beziffert nicht |
| **Warenzölle** (5–10 %) | Geographia S. 115 | braucht Warenwert | ⛔ Händler-Werkzeug, nicht Reiseplaner |
| **Träger-, Führer-, Lotsenlohn** | — | — | ⛔ in keinem der vier Bücher beziffert |

---

## 5. Die Grundsatzfrage: Rechnung oder Spanne?

**Was ist eine Reisekosten-Zahl im Planer — eine Rechnung oder eine Spanne?**

Die Quellen erlauben beides, und die Wahl bestimmt das ganze Bild:

- **Eine Rechnung** braucht Annahmen, die der Planer heute nicht hat: wie viele Personen,
  wie viele Pferde, welche Profession (der Reisendenzoll schwankt zwischen 1 H und 5 D —
  Faktor 500), welche Zimmerkategorie. Das sind vier neue Eingabefelder für eine Zahl,
  die trotzdem eine Hausnummer bleibt.
- **Eine Spanne** („9 Nächte · 4 Grenzen · 3 D 4 S bis 38 D 4 S je Person") kommt ohne jede
  neue Eingabe aus und ist gegenüber der Quelle ehrlicher. Sie sagt dem Spielleiter, *woraus*
  sich die Reise zusammensetzt, und überlässt ihm den Rest. Die Zahlen sind gerechnet, nicht
  gesetzt — siehe §8.2.

Meine Empfehlung ist die Spanne mit *einem* Regler (Reisestil: sparsam / gewöhnlich /
standesgemäß), der Zimmerkategorie, Verpflegung und Zollveranlagung gemeinsam schaltet.
Das ist eine Bedienung statt vier — und es passt zu dem, was der Planer heute schon tut:
er zeigt Distanz, Zeit, Gelände und Landschaften, nicht die Kondition der einzelnen Helden.

---

## 6. Entwurf „Unterbringung" als eigenes Merkmal (Owner-Anstoß 2026-08-03)

Der Owner hat vorgeschlagen, in avesmaps eine Art *Unterbringung* zu führen. Das ist der
richtige Instinkt, denn heute gibt es dazu **nichts**: der Ortsarten-Katalog hat 83
Einträge, und weder „Herberge" noch „Gasthaus", „Taverne" oder „Wirtshaus" ist einer davon.
Das einzige Herbergsartige ist `Karawanserei` mit **4** Orten.

### 6.1 Es gehört an den Ort, nicht in eine neue Tabelle

`map_features.properties` trägt bereits `place_kind`. Die Unterbringung wird eine
Schwester davon: **`properties.lodging`**, ein Wert aus einer festen Liste. Kein
`CREATE TABLE lodging` — dieselbe Begründung wie bei den Quellen (AGENTS.md §5): ein
zweites System für ein Merkmal, das an einem bestehenden Objekt hängt, kostet später eine
Datenmigration und einen zweiten Abgleich.

### 6.2 Fünf Stufen, die auf die Preistabelle passen

Die Stufen sind nicht frei erfunden, sondern die Zeilen der DSA5-Tabelle, gebündelt:

| Stufe | Was der Reisende bekommt | Preisband je Nacht |
|---|---|---:|
| `keine` | nichts — Lager im Freien | 0 |
| `lager` | Strohsack im Schlafsaal | 2 H |
| `einfach` | + Bett im Gemeinschaftszimmer, Stall mit Futter | 2–6 H |
| `gewoehnlich` | + Einzel- oder Doppelzimmer | bis 5 S |
| `gehoben` | + Suite | bis 100 S |

### 6.3 💣 Der Punkt, an dem so ein Feld sonst stirbt: der Vorgabewert

4.653 Orte. **Niemand füllt 4.653 Auswahlfelder von Hand.** Ein Merkmal, das leer
beginnt, bleibt leer — und ein Planer, der auf ein leeres Feld schaut, kann keine Nacht
berechnen. Das Feld darf deshalb **nie die Datenquelle sein, sondern nur die Ausnahme.**

Die Vorgabe wird aus Daten abgeleitet, die es schon gibt, und deckt vom ersten Tag an
100 %:

| Woraus | Vorgabe | Begründung |
|---|---|---|
| Metropole, Großstadt | `gehoben` | Stadtgröße |
| Stadt, Kleinstadt | `gewoehnlich` | Stadtgröße |
| Dorf | `einfach` | Stadtgröße |
| `place_kind = Karawanserei` | `einfach` | ist per Definition eine Herberge |
| kein Ort, aber Etappe auf `Reichsstrasse` | `einfach` | Geographia S. 113: alle 15 Meilen ein Landgasthaus |
| kein Ort, aber Etappe auf `Strasse` | `einfach` | Geographia S. 114: alle 20 Meilen eine Herberge |
| alles Übrige (Weg, Pfad, Gebirgspass, Wüstenpfad, Querfeldein) | `keine` | Lager im Freien |

Der Editor setzt `properties.lodging` also **nur dort, wo er es besser weiß** — das
verrufene Dorf ohne Schankstube, die einsame Passherberge, das Kloster mit Pilgerlager.
Das ist genau das Muster, das das Projekt bei Wappen und Abenteuer-Covern schon fährt:
eigener Wert schlägt abgeleiteten, das Abgeleitete bleibt die Grundversorgung.

### 6.4 Was das dem Planer bringt

Erst mit diesem Feld wird aus einer Nächtezahl eine Aussage: **wo** ein Bett stand und wo
nicht. Eine Route über die Reichsstraße schläft jede Nacht im Landgasthaus; dieselbe
Strecke über den Gebirgspass schläft im Freien, spart das Geld und zahlt es nach *Wege des
Entdeckers* S. 125 in Regeneration zurück. Das ist der Vergleich, den ein Reiseplaner
zeigen soll — und er entsteht nicht aus der Preisliste, sondern aus diesem einen Merkmal.

### 6.5 Zusätzlich, aber nicht tragend

`Herberge` als neue **Ortsart** wäre sinnvoll für benannte Häuser aus Wiki Aventurica
(„Zum Fetten Ochsen"). Das ist additiv und hübsch — aber es trägt den Planer nicht: die
Abdeckung wäre so dünn wie bei `Brücke` (40) und `Fährstation` (1). Erst das Merkmal an
jedem Ort macht die Rechnung vollständig.

---

## 7. Den Reisetag an der Herberge enden lassen (Owner-Idee 2026-08-03)

Der Owner hat vorgeschlagen, den Herbergsabstand für alle Wegarten zu hinterlegen und den
Reisetag dann **auf die nächste Herberge zu runden** — solange man nicht querfeldein
unterwegs ist. Das ist die richtige Idee, und sie ist an der echten Route Gareth→Fasar
durchgerechnet. Sie zerfällt dabei in zwei Teile, von denen einer geschenkt ist und der
andere teurer, als er aussieht.

### 7.1 Der Abstand steht nur zweimal in der Quelle

| Wegart | Abstand | Herkunft |
|---|---:|---|
| `Reichsstrasse` | **15 Meilen** | Geographia S. 113, wörtlich |
| `Strasse` | **20 Meilen** | Geographia S. 114, wörtlich |
| `Weg` | — | „bisweilen ein Gasthaus" (S. 114), **keine Zahl** |
| `Wuestenpfad` | — | Karawansereien nur für *eine* namentliche Strecke (S. 114) |
| `Pfad`, `Gebirgspass` | — | S. 115: Gebirgsstrecken sind „unrentabel für die Herbergswirte" |
| `Flussweg`, `Seeweg` | entfällt | man schläft an Bord |
| `Querfeldein` | keine | im Freien |

Jede Zahl außer 15 und 20 wäre eine **avesmaps-Hausregel**. Das ist zulässig, muss aber so
dastehen — die Schlussregel des Reisehandbuchs lautet „Fehlende Zahl nicht schätzen".
Die Tabelle gehört deshalb neben `SPEED_TABLE` als Daten, mit einer Spalte, die sagt,
welche Zahl aus der Quelle stammt und welche wir gesetzt haben.

### 7.2 Die Verfügbarkeit ist geschenkt — dafür braucht es gar kein Raster

Auf einer Reichsstraße steht alle 15 Meilen ein Gasthaus, und ein Reisetag zu Pferd ist
35 bis 40 Meilen lang. Der Tag endet also **nie weiter als 7,5 Meilen von einer Herberge**.
Die Frage „Bett oder nicht?" beantwortet die Wegart am Tagesende allein — ohne eine
einzige Herberge zu verorten.

An Gareth→Fasar, 17 Reisetage: **12 Nächte Herberge, 3 an Bord, 2 im Freien** (davon eine
der 0,2-Meilen-Ankunftstag). Praktisch jede Landnacht ist eine Herbergsnacht — genau das
Bild, das die Geographia zeichnet.

### 7.3 💣 Das Raster muss über zusammenhängende Strecken laufen, nicht je Etappe

Mein erster Durchlauf setzte das Raster je Route-Etappe neu an. Ergebnis: 18 Herbergen
statt 28 — und **10 Nächte im Freien auf einer Reichsstraße**, was nach der Quelle
unmöglich ist.

Der Grund: **11 der 32 Etappen sind kürzer als 15 Meilen** (kürzeste 2,8, Median 22,7).
Eine Etappe unter einem Herbergsabstand bekommt im Etappenraster gar keine Herberge. In
Wirklichkeit besteht die Route aus nur **8 zusammenhängenden Strecken**:

```
Reichsstraße 141,8 → Weg 3,0 → Flussweg 82,1 → Straße 3,4
→ Reichsstraße 144,4 → Weg 2,9 → Flussweg 41,5 → Straße 215,2
```

Das Raster muss über diese Strecken laufen. Und es muss **am Weg verankert sein, nicht an
der Route** — sonst liegen die Herbergen derselben Straße anderswo, je nachdem wo man
aufgefahren ist, und die Rückreise findet andere Betten als die Hinreise.

### 7.4 💣 Runden ist nicht folgenlos — es schreibt die Reisedauer um

Mit korrektem Raster und „auf die nächste Herberge im Umkreis von 25 % der Tagesstrecke":

| | ohne Rundung | mit Rundung |
|---|---:|---:|
| Reisetage | 18 | **17** |
| typischer Straßentag | 37,7 Meilen | **45,0 Meilen** |

Die Rundung greift systematisch nach oben: bei Herbergen alle 15 Meilen und einem
37,7-Meilen-Tag liegt die Marke bei 45 um 7,3 Meilen entfernt, die bei 30 um 7,7 — die
nächste gewinnt. Ergebnis: ein Tag weniger, dafür **jeden Tag 20 % weiter**, dauerhaft
nahe an der Eilritt-Grenze von 52,5 Meilen.

Das ist keine Verfeinerung, das ist eine andere Reise. Und es trifft die auffälligste
Zahl des Planers: „Gesamte Reisezeit" würde sich ändern, nur weil jemand die
Kostenanzeige einschaltet.

### 7.5 Empfehlung: die Hälfte nehmen, die etwas ändert

- **Verfügbarkeit ja.** Wegart am Tagesende → Bett oder nicht. Quellengedeckt, kostet
  kein neues Datum, ändert die Reisezeit nicht, und sie ist es, die den Preis bestimmt.
- **Rundung nicht in die Zeitrechnung.** Der Gewinn ist ein Tagesende, das ±7,5 Meilen
  anders liegt; der Preis ist eine veränderte Reisedauer und ein erfundenes Herbergsraster.
- **Aber der nützliche Rest der Idee bleibt:** wo der Tag in einer herbergslosen Strecke
  endet, sagt der Planer, wie weit die nächste ist — „Tag 14 endet auf einem Pfad, 6 Meilen
  weiter beginnt die Straße". Das ist die Entscheidung, die ein Reisender wirklich trifft,
  und sie schreibt nichts still um.

---

## 8. Was das Mockup ergab — `verify-reisekosten.html`

Der Entwurf rechnet die echte Route, nicht Platzhalter. Drei Befunde daraus.

### 8.1 🔴 Der Planer reist doppelt so schnell wie die Quelle

Gareth→Fasar, Reisegruppe zu Pferd, mit den Vorgaben des Planers
(`DEFAULT_PLANNER_STATE.restHours = 12`, also 12 Reisestunden am Tag):

| | |
|---|---:|
| Distanz | 634,3 Meilen |
| Reisezeit | 109,6 h |
| Rastzeit | 109,6 h |
| **Gesamte Reisezeit** | **219,1 h = 9,13 Tage → 9 Nächte** |
| Tagesleistung | **69,5 Meilen/Tag** |
| Geographia, Gruppe zu Pferd | **35** (Tabelle), rund 40 (Fließtext) |

Das ist der bekannte offene Punkt aus `docs/reisemodell-ueberarbeitung-instruction.md`
(Owner-Entscheid 02.08., gemessene Tagesleistung ebene Straße `c` = 31,0) — aber er trifft
die Kostenanzeige unmittelbar, weil Übernachtung, Verpflegung und Stall an der Nächtezahl
hängen. Nach der Überarbeitung werden aus 9 Nächten etwa 18.

> ⭐ **Die Anzeige darf nie selbst eine Tagesleistung annehmen.** Sie liest die Nächte aus
> der „Gesamten Reisezeit", die im Planer direkt darüber steht. Dann stimmt sie vor der
> Überarbeitung und danach, ohne dass jemand sie anfasst.
>
> ⚠️ Die Zahlen in §7 (17/18 Tage) stammen aus einer Rechnung mit der **Quellen**-Tagesleistung
> von 35 Meilen und sind deshalb rund doppelt so hoch wie das, was der Planer heute anzeigt.
> Die dortigen Aussagen über Raster und Rundung bleiben davon unberührt.

### 8.2 ⭐ Das Bett ist nie der größte Posten — ich hatte das Gegenteil angenommen

Dieselbe Reise, je Person mit einem Pferd, nur der Reisestil wechselt:

| Posten | sparsam | gewöhnlich | standesgemäß |
|---|---:|---:|---:|
| Übernachtung | 1 S 6 H | 4 S 8 H | 2 D 4 S |
| Verpflegung | 4 S | 8 S | 1 D 7 S |
| Pferd (Stall/Futter + Hufe) | 2 S 7 H | 6 S 8 H | 6 S 8 H |
| **Zölle** | 7 H | **4 D 3 H** | **20 D 3 H** |
| **Flusspassage** | **2 D 4 S 7 H** | 2 D 4 S 7 H | **13 D 6 S** |
| **Summe** | **3 D 3 S 7 H** | **8 D 4 S 6 H** | **38 D 4 S 1 H** |

- Bei **sparsam** ist die **Passage** knapp drei Viertel der Summe.
- Bei **gewöhnlich** und **standesgemäß** sind es die **Zölle** — rund die Hälfte.
- Die **Übernachtung liegt in allen drei Fällen unter einem Achtel.**

Zwischen sparsam und standesgemäß liegt **Faktor 11**. Das ist das stärkste Argument für die
Spanne: eine einzelne Dukatenzahl behauptet eine Genauigkeit, die die Quelle nicht hergibt.

Die frühere Aussage dieses Dokuments, Übernachtungen kosteten „50 Dukaten", war falsch
geschätzt; sie ist in §3.4 korrigiert.

### 8.2a Wie es gebaut wurde: eine Eingabe, alles je Person

Owner-Entscheid 2026-08-03, nach dem Mockup: **es gibt genau eine neue Eingabe.**

- **„Unterbringung"** in den *Reiseoptionen* (vormals „Routenoptionen"): im Freien /
  Strohsack / Bett im Gemeinschaftszimmer / Einzelzimmer. Sie setzt Bett, Verpflegung und
  die Zollveranlagung gemeinsam.
- **Keine Gruppengröße.** Gerechnet wird immer **je Person**. Ein Feld dafür wäre eine
  Eingabe für eine Multiplikation, die der Spielleiter ohnehin im Kopf macht — und es zöge
  sofort die nächste nach sich (wie viele Reittiere? wie viele Räder fürs Fährgeld?).
- **Kein Reittier-Feld.** Das Tier folgt aus dem Landtransportmittel: „Reisegruppe zu
  Pferd" heißt ein Pferd je Person, zu Fuß keines.

Die Zahlen in §8.2 sind entsprechend je Person zu lesen.

### 8.3 Drei Annahmen, die noch entschieden gehören

1. **Die Flussetappe wird als gekaufte Passage gerechnet.** Der Planer wählt „Flusssegler";
   die Geographia beziffert eine *Kahnfahrt* (1 D je 100 Meilen stromab, Mitarbeit
   vorausgesetzt). Wer ein eigenes Boot fährt, zahlt nichts.
2. **24,8 der 123,6 Flussmeilen haben keine bekannte Strömungsrichtung** (`flow_state` =
   unbekannt) und sind zum Stromab-Preis gerechnet. Stromauf kostet das Dreifache.
3. **Die Reichsstraßen-Zollfreiheit ist noch nicht angewandt.** Sie beträfe hier nur die drei
   Provinzgrenzen, also 3 Heller — die Regel bleibt trotzdem richtig und gehört eingebaut.

### 8.4 Ist das Modell mit der Geographia konsistent?

Posten für Posten geprüft, am Rohtext der Quelle, nicht am Reisehandbuch.

| Posten im Modell | Deckung durch die GA |
|---|---|
| Reisendenzoll 1 H · 5 H · 1 D · 5 D je Landesgrenze | ✅ S. 115, wörtlich |
| Flusspassage 1 D stromab / 3 D stromauf / Kabine bis 10 D je 100 Meilen | ✅ S. 129 |
| Pferd auf dem Schiff kostet wie ein Passagier | ✅ S. 129/131 |
| Herbergsabstand 15 (Reichsstraße) / 20 (Straße) Meilen | ✅ S. 113/114 |
| Binnenobolus 1 H **nur in MR/HR und nicht auf Reichsstraßen** | ✅ S. 113/115 — **erst nach Korrektur** |
| Übernachtungspreise | ⚠️ **nicht GA** — Regelwerk S. 382 (GA schweigt) |
| Verpflegung | ⚠️ **nicht GA** — Regelwerk S. 382 + **DSA4.1** WdE S. 72 |
| Pferdefutter, Hufbeschlag | ⚠️ **nicht GA** — Kodex S. 475 |
| Zwölfgöttergeweihte passieren zollfrei | ⚠️ S. 115, nicht modelliert |
| Brückenzoll, Fährgeld | ⚠️ S. 115, bewusst weggelassen (keine Kartendaten, §3.3) |
| **Tagesleistung 69,5 Meilen** | ❌ **S. 118: „kaum mehr als 40 Meilen am Tag"** |

**Die grundsätzliche Antwort: nein, und das kann sie auch nicht sein — die GA enthält kein
Kostenmodell.** Sie beziffert vier Dinge: Zölle, Fährgeld, Passagepreise, Botendienste. Alles
andere schließt sie ausdrücklich aus (§1.1). Von den fünf Kostenzeilen des Entwurfs sind
**zwei GA-gedeckt und drei zugekauft** — eine davon aus einer anderen Regeledition.

Immerhin: **die zwei GA-gedeckten sind die großen.** Zölle und Passage machen den Löwenanteil
aus (§8.2); Bett, Essen und Futter, also der zugekaufte Teil, sind der kleinere.

**Zwei Abweichungen wurden im Entwurf repariert:**

Der Binnenobolus wurde ursprünglich auf jede Provinzgrenze gelegt. Die GA knüpft ihn an zwei
Bedingungen, und beide greifen hier. Auf Gareth→Fasar liegen **zehn** Provinzübertritte:

| | |
|---|---|
| 5 in Aranien | S. 115: „eigentlich nur die Provinzen des Mittelreichs und des Horasreichs" |
| 2 auf Reichsstraße | S. 113: dort Zoll „nur an den Außengrenzen des Reiches" |
| 3 auf dem Fluss | S. 129/130 beschreibt Zollwehre für **Handelsschiffe** und deren Fracht — kein Satz zu Passagieren, kein Betrag |

**Zahlbar bleiben null.** Ein winziger Betrag, aber die Regel ist jetzt die der Quelle statt
einer Vereinfachung.

**Ein Widerspruch bleibt offen: die Tagesleistung.** Er ist nicht dieses Feature, sondern
`docs/reisemodell-ueberarbeitung-instruction.md` — trifft aber jede Kostenzeile, die an der
Nächtezahl hängt. Die Bauregel dagegen steht in §8.1: die Anzeige nimmt nie selbst eine
Tagesleistung an.

---

## 9. Quellen

- *Geographia Aventurica*, PDF-S. 113–115 (Straßenrecht, Zölle, Fähren, Pässe),
  118–119 (Reisegeschwindigkeit, Übergänge), 129–131 (Fluss- und Seereise),
  133–135 (Handel), 141 (Maße, Geld) — zusammengefasst in
  `AVENTURISCHES_REISEHANDBUCH.md`, Abschnitte 10, 18, 19, 20, 26, 27.
- *DSA5 Regelwerk, 3. Auflage*, S. 382, „Das aventurische Gasthaus" (Preise am Seitenbild geprüft).
- *DSA5 Kodex der Helden*, S. 474–476 (Tiere, Futter, Tierbedarf, Fahrzeuge, Dienstleistungen,
  Reise und Transport, Gasthaus — letzteres wortgleich zum Regelwerk), S. 471 (Proviant).
- *DSA4.1 Wege des Entdeckers*, S. 72 (Proviant je Ration), S. 76–77 (Fahrzeuge, Tagesmiete,
  Reisepakete), S. 125 (Übernachten und Regeneration).
- Live-Abrufe avesmaps.de am 2026-08-03: `place-kinds.php`,
  `political-territories.php?zoom=6`, `POST /api/route/` (Gareth→Fasar, Gareth→Al'Anfa).
- Währung: 1 Dukat = 10 Silbertaler = 100 Heller = 1.000 Kreuzer.
