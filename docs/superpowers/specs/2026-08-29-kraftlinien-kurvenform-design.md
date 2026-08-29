# Kraftlinien: die Kurvenform

**Stand:** 29.08.2026 · **Zustand:** Entwurf, abgenommen, noch nicht gebaut
**Mockup:** `docs/kraftlinien-kurvenform-mockup.html` (rechnet die echte Strang-Formel)

---

## 1. Anlass

Owner, 29.08.2026: *„Kraftlinien sollen eine Kurvenform bekommen können. Gib ihnen die
Eigenschaft ‚Kurvenform‘ mit einem Parameter, der aus der Linie eine um den Parameter gekrümmte
Linie macht, die wabernden leuchtenden Strukturen sollen daran ausgerichtet werden und die Kurve
darstellen."* Dazu ein Bild des **Torwegs**: die Kraftlinie liegt schnurgerade über dem Gelände,
daneben der von Hand eingezeichnete Bogen, den sie beschreiben soll.

Nachtrag desselben Tages: *„ja negative werte sollen die kurve in die andere richtung drehen."*

---

## 2. Der Befund: der Zeichner KANN heute nichts anderes als eine Strecke

`createPowerlineStrandLatLngs` (`js/map-features/map-features-powerlines.js:63`) nimmt aus der
Geometrie **nur den ersten und den letzten Punkt** und interpoliert linear:

```js
const start = latLngs[0];
const end   = latLngs[latLngs.length - 1];
…
start.lat + dy * t + ny * normalOffset + ty * (…)
```

Alles dazwischen — Wellen, Zittern, Störung — ist ein Sinus **quer zu dieser Geraden**, gebändigt
von der Hüllkurve `sin(πt)`, die an beiden Enden auf null geht. Eine Kraftlinie ist damit
strukturell eine Strecke; zwischenliegende Stützpunkte der gespeicherten Geometrie werden
**verworfen**. Das ist keine Einstellung, die falsch steht, sondern die Bauform.

⭐ **Und genau deshalb ist die Kurve billig:** sie ist derselbe Normalenversatz wie das Wabern, nur
ohne Zeit. Ein Summand, kein Umbau.

---

## 3. Die vier Entscheidungen (Owner, 29.08.2026)

| Frage | Entscheidung |
|---|---|
| Reichweite | **Je Linie ein Wert, jedes Segment einzeln gebogen.** Die Nodices bleiben exakt auf der Linie. |
| Bedienung | **Schieber mit Live-Vorschau auf der echten Karte** — der Editor blendet sich weg. |
| Kurvenart | **Parabel** `4h·t(1−t)`. |
| Vorzeichen | **Negativ dreht die Kurve auf die andere Seite.** |

🔴 **Die verworfene Variante „ganze Kette als EIN Bogen" bleibt verworfen** und der Grund gehört
hierher: dabei lägen die Nodices dazwischen (Gareth, Schlund) **nicht mehr auf der gezeichneten
Linie** — die Linie schwänge an ihnen vorbei. Ein Nodix ist ein Ort; eine Kraftlinie, die ihren
eigenen Knoten verfehlt, ist falsch, nicht hübsch. Dazu hätten verzweigte Linien (6 Stück) und der
Ring (Hexenband) gar keine zwei Enden, über die sich ein Bogen spannen ließe.

🔴 **NACHTRAG 29.08.2026, SPÄTER AM TAG: „je Segment" kommt DOCH — siehe §13.** Hier stand, ein Wert
je Segment sei verworfen, weil die Nodices-Spalte Nodices liste und keine Segmente, es gäbe also
keine Bedienfläche. **Die Begründung war zur Hälfte falsch, und die falsche Hälfte trug die
Entscheidung.** Bei einer verzweigten Linie und beim Ring rendert der Editor längst eine
**Kantenliste** — eine `.pl-edge`-Zeile je Segment (`renderNodes`,
`html/wiki-sync-powerline-editor.html`). Beim Strang liegt zwischen zwei Nodices ein
`.pl-conn`-Element, das optisch genau das Segment ist. Die Fläche war die ganze Zeit da; ich hatte
nur den Strang-Fall angesehen. Der zweite Einwand (die Basiliuslinie hätte 16 Regler) bleibt gültig
und wird in §13 beantwortet, statt die Sache zu verhindern.

---

## 4. Das Datenmodell

**`properties.curve`** — Zahl, **Prozent der Sehnenlänge**, Bereich `−45 … +45`, `0` = gerade.
Kein DDL, keine Migration, keine neue Spalte: das Feld liegt in `properties_json`, wie
`show_label`, `description` und `wiki_url`.

💣 **PROZENT DER SEHNE, NICHT KARTENEINHEITEN — und das ist keine Geschmacksfrage.** Das Wabern
rechnet in **absoluten Karteneinheiten**: `normalWave` × `normalScale` ergibt zusammen mit Zittern
und Störung eine Amplitude von rund **1,0 Einheit**, unabhängig davon, wie lang das Segment ist.
Ein absoluter Kurvenwert stünde damit in zwei unvereinbaren Verhältnissen: auf einem 4-Einheiten-
Segment wäre er ein Kringel, den das Wabern verschluckt, auf einem 60-Einheiten-Segment unsichtbar.
Relativ zur Sehne sieht dieselbe Zahl auf jeder Linie gleich stark gebogen aus. (Im Mockup ist der
Regler „Segmentlänge" genau dafür da — er zeigt beide Enden dieses Widerspruchs.)

**Drei Stellen tragen das Feld, und die dritte ist die, die man vergisst:**

1. **Schreiber** — `avesmapsUpdatePowerlineLine` (`api/_internal/map/features.php:2046`) schreibt es
   wie `show_label` auf **alle** Segmente der Namensgruppe, in derselben Transaktion, mit demselben
   Audit-Eintrag.
2. **Lesefeed** — `api/edit/map/powerlines.php` projiziert es in die Segmentliste des Editors.
   ⚠️ Diese Projektion ist ausdrücklich: fehlt sie, sähe der Editor immer `0`, der Schieber käme
   nach dem Neuladen auf null zurück, und weil das Speichern den Wert immer mitschickt, löschte der
   **nächste** Speichervorgang die Kurve — auch eine reine Beschreibungsänderung. Das ist Zeichen
   für Zeichen die Falle, die `wiki_no_article` in derselben Datei schon einmal gekostet hat.
3. **Vererbung** — `avesmapsPowerlineInheritedLineFields`. Ein später angehängter Nodix erzeugt ein
   **neues Segment**; ohne Eintrag hier läge es kerzengerade zwischen zwei gebogenen. 💣 Diese Liste
   stand einmal zweimal abgeschrieben nebeneinander (Nodix anhängen / Umsortieren) und in beiden
   Kopien fehlte ein Feld; seit 15.08.2026 gibt es nur noch eine, und
   `powerline-inherit-test.php` ist der Grund, warum sie eine bleibt. `curve` ist **ein Eintrag**.

⭐ **Kein Eingriff in `api/app/map-features.php`.** Der Payload-Bau reicht `properties_json`
ungefiltert durch (`map-features.php:638`, keine Whitelist) — `curve` kommt beim Kartenleser an,
ohne dass dort eine Zeile fällt.

⭐ **Und kein eigener Stempel.** Die Kurve steht in einem **Kartenobjekt**; der Schreibweg hebt
über `avesmapsNextMapRevision` die `map_revision`, an der das ETag der Kartennutzlast hängt. Ein
warmer Browser revalidiert also von selbst. Der Kontrast, der zeigt, warum das erwähnenswert ist:
die **Tempowerte** ändern kein Kartenobjekt und brauchten deshalb einen eigenen Stempel, sonst
hätte jeder warme Browser unbegrenzt mit alten Werten weitergerechnet.

---

## 5. Das Zeichnen: ein Summand, drei Erzeuger

Die Rechnung selbst ist eine Zeile im bestehenden Punkt-Aufbau:

```js
const kurve = 4 * h * t * (1 - t);          // h = (curve / 100) × Sehnenlänge
const normalOffset = (normalWave + tremorWave + interference + waveOffset * envelope) * normalScale
                   + kurve;
```

🔴 **Die Kurve liegt AUF derselben Normalen wie das Wabern und wird NICHT mit `normalScale`
multipliziert.** `normalScale` (0,125) ist der Dämpfer der Wabern-Amplituden; die Kurve ist bereits
in Karteneinheiten ausgerechnet. Wer sie versehentlich mitdämpft, bekommt ein Achtel Bogen und
sucht den Fehler in der Formel.

💣 **DIE KURVE HAT DREI ERZEUGER, UND NUR EINER IST DER SICHTBARE.** Eine Regel, die einen von drei
bindet, ist keine Regel:

| Erzeuger | heute | mit Kurve |
|---|---|---|
| die 9 Strang-Polylinien | `createPowerlineStrandLatLngs` | Summand oben |
| die **unsichtbare Klick-Linie** (`powerline--hit`, 22 px) | `L.polyline(latLngs)` roh | muss der Kurve folgen |
| die **Label-Linie** (Textpfad des Namens) | `getReadablePowerlineLabelLatLngCoordinates(latLngs)` | muss der Kurve folgen |

Bliebe die Klick-Linie gerade, läge das Klickziel bei starker Krümmung **im leeren Gelände** neben
der Linie — und die Kernstränge sind 1,5 px breit und wabern, sind also ohnehin kaum treffbar; die
Hit-Linie gibt es genau deshalb (Forum-Rückmeldung). Bliebe die Label-Linie gerade, stünde der Name
der Kraftlinie quer neben ihr.

⭐ **Deshalb ein eigener reiner Helfer**, den alle drei rufen — Vorschlag
`avesmapsPowerlineCurvedLatLngs(latLngs, curve, stuetzpunkte)` in
`js/map-features/powerline-topology.js` (die Datei ist bereits die geteilte reine Wahrheit für
Karte **und** Editor und hat keine Abhängigkeiten). Die Live-Vorschau des Editors braucht dieselbe
Rechnung — ohne geteilten Helfer wäre sie die vierte Abschrift.

⚠️ `refreshPowerlineLayers` setzt die Geometrie aller drei Ebenen pro Frame neu; die Kurve gehört
in **beide** Pfade (`createPowerlineLayer` beim Anlegen, `refreshPowerlineLayers` beim Takt), sonst
springt die Linie beim ersten Frame von gerade auf gebogen.

---

## 6. Die Stützpunkte: der Preis, den nur gekrümmte Linien zahlen

`POWERLINE_RENDER_CONFIG.segmentCount` steht auf **8**. Für eine Gerade ist das richtig — die acht
Punkte tragen nur das Wabern. **Ein Bogen über 8 Punkte ist ein sichtbares Polygon** (im Mockup:
Regler „Stützpunkte" auf 8 lassen und die Kurve hochziehen — der Knick in der Mitte ist der
Befund, nicht ein Artefakt der Darstellung).

Gerechnet, was das kostet — **165 Segmente / 62 Linien**, abgelesen an der Statuszeile des
Kraftlinien-Editors im Owner-Bild vom 29.08.2026:

| Zustand | Punkte je Frame | Rechnung |
|---|---|---|
| heute (alle gerade, 8) | **13 365** | 165 Segmente × 9 Polylinien × 9 Punkte |
| alle Linien pauschal auf 24 | **37 125** | ×2,8 — bezahlt von 62 Linien, die alle gerade sind |
| **Stützpunkte aus \|curve\| abgeleitet** | **≈ 13 400** | gerade Linien bleiben exakt bei 8 |

🔴 **`segmentCount` wird abgeleitet, nicht erhöht.** `curve === 0` ⇒ exakt 8, unverändert; von dort
linear bis 24 bei `|curve| = 45`. Bei 30 fps × 62 Linien ist das kein akademischer Punkt: die
Kraftlinien-Ansicht ist die einzige Fläche des Projekts mit einer Dauer­animation.

---

## 7. Die Seite: warum das Vorzeichen NICHT an `from → to` hängt

Der Owner-Satz *„negative werte sollen die kurve in die andere richtung drehen"* legt fest, **dass**
das Vorzeichen die Seite ist. Woran sich „die Seite" bemisst, ist die eigentliche Entscheidung.

🔴 **Die Normale wird aus einer KANONISCHEN Segmentrichtung gebildet** — West → Ost, bei gleichem x
Süd → Nord — und **nicht** aus der Speicherrichtung `from_public_id → to_public_id`.

💣 **Der Grund ist eine stille Umkehr.** Die Nodices lassen sich im Editor mit ▲▼ umsortieren
(`avesmapsReorderPowerlineLine`), und dabei können Segmente ihre Speicherrichtung tauschen. An
`from → to` gebunden klappte **jeder Bogen dieser Linie auf die andere Seite**, ohne dass jemand
die Kurve angefasst hätte — und bei einer Linie außerhalb des Blickfelds fällt das nie auf. Die
kanonische Richtung ist von der Speicherreihenfolge unabhängig, also passiert beim Umsortieren
nichts.

⚠️ **Der Preis, benannt statt versteckt:** bei einer Kette, die ihre Ost-West-Richtung wechselt,
liegen die Bögen benachbarter Segmente auf gegenüberliegenden Seiten. Das trifft lange verzweigte
Linien (Basiliuslinie, 16 Segmente). Für die einsegmentigen Linien — den Fall, aus dem der Auftrag
kommt — ist es wirkungslos. ⚠️ Die einzige Zählung der Linienformen, die es gibt, stammt vom
**22.07.2026** (Kommentar in `map-features-powerlines.js`: 162 Segmente / 61 Namen → **54 Stränge,
6 verzweigt, 1 Ring**) und ist damit einen Monat und drei Segmente alt — sie taugt als
Größenordnung, nicht als aktueller Bestand. Wer die Verteilung braucht, zählt neu.
Wer die Regel je ändern will, ändert sie an **einer** Stelle: im Helfer aus §5.

⚠️ **Kein zweites Bedienelement für die Richtung.** Ein Schieber mit Vorzeichen ist ein Regler; ein
Schieber plus ein Umschalter „andere Seite" wären zwei, und der zweite wäre aus dem ersten
ableitbar.

---

## 8. Der Editor

**Der Schieber** steht **im Identität-Block**, direkt unter dem Häkchen „Name auf der Karte
anzeigen" — dort, wo der Owner im Bild hingezeigt hat.

⚠️ **Ausdrücklich KEIN eigener `dt-grp`-Abschnitt.** `js/pages/__tests__/editor-abschnittsreihenfolge.test.js`
führt die Abschnittsfolge dieses Fensters als feste Liste (Identität → Beschreibung →
Wiki-Zuweisung → Quellen → Speicherleiste). Ein neuer Kopf hieße: eine sechste Zeile in einer
Liste, die der Owner am 16.08.2026 bewusst festgelegt hat — für **ein** Feld, das eine
Darstellungsentscheidung ist wie das Häkchen darüber.

**Der Knopf „Kurve auf der Karte einstellen"** daneben:

1. Das Editor-Overlay **blendet sich weg** (`hidden`), es wird **nicht geschlossen**.
   💣 `closeHub()`-Muster: Schließen setzt Auswahl und ungespeicherte Felder zurück — ein halb
   geschriebener Stand käme als leerer neuer zurück. Das Wegblenden statt Schließen ist das
   Hausmuster aus dem Social-Hub (Kartenausschnitt ziehen).
2. Die gewählte Linie steht frei auf der Karte, ein schwebender Schieber biegt sie **in Echtzeit** —
   die Stränge wabern schon um die neue Kurve, weil die Vorschau denselben Helfer benutzt.
3. „Fertig" holt den Editor zurück. **Gespeichert wird weiterhin mit „Speichern"** — die Vorschau
   schreibt nichts.

🪤 **Der Weg dorthin existiert nur zur Hälfte.** Karte → Editor gibt es (`postMessage`
`avesmapsPowerlineSelect`, der „Bearbeiten"-Knopf im Kartenpopup). Editor → Karte gibt es **nicht**:
`plMapFilter` („Nur Auswahl auf Karte") togglet heute eine CSS-Klasse und sonst nichts —
`// Live map filter is a parent-window concern; wired when the parent exposes it`
(`html/wiki-sync-powerline-editor.html:900`). Die Live-Vorschau baut diese Richtung als erste auf.
🔴 **Der tote Knopf wird hier nicht mitrepariert** — er gehört zu einem anderen Vorhaben, und ihn
im Vorbeigehen zu beleben hieße, zwei Kartenkopplungen in einem Zug zu bauen. Er wird nur
**benannt**, damit ihn niemand für kaputt gegangen hält.

⚠️ Die Vorschau setzt voraus, dass die Karte darunter im Ansichtsmodus **„Kraftlinien"** steht —
`syncPowerlineVisibility` fügt die Ebenen nur dort hinzu und lässt die Animation nur dort laufen.
Steht sie anders, schaltet der Vorschau-Modus sie um und danach zurück.

---

## 9. Der SVG-Abzug

`svgxPowerlineLayer` (`js/pages/svg-export-build.js:941`) zeichnet die **rohe**
`f.geometry.coordinates` als schlichte Linie — keine Stränge, kein Wabern.

🪤 **Und es bekommt `smooth` und `tension` übergeben, ohne sie je zu lesen** (`svg-export-build.js:1303`).
Wer nur den Aufruf liest, hält den Abzug für geglättet; er ist es nicht. Die Kurve muss dort
**aktiv** angewandt werden — derselbe Helfer, auf `f.geometry.coordinates` statt auf LatLngs.

🔴 **Der Abzug bekommt die Kurve, nicht das Wabern.** Er ist ein Standbild für Weiterverarbeitung;
eine eingefrorene Zufallsphase des Zitterns wäre Rauschen in einer Datei, die jemand als Vorlage
benutzt. Die Kurve dagegen ist die **Form** der Linie und gehört hinein.

---

## 10. Was bewusst NICHT gebaut wird

- **Keine Kurve aus dem Wiki-Abgleich.** `curve` ist ein reines Handfeld. Der Kraftlinien-Sync
  schreibt in `properties.wiki_powerline`; die Kurve ist eine Darstellungsentscheidung unseres
  Kartenbilds, über die das Wiki nichts sagt.
- **Keine Wiki-Override-Kennzeichnung** (§ Wiki-Override, AGENTS.md §11): die gilt Feldern, die aus
  dem Wiki kommen können. Dieses kann es nicht.
- **Keine Kurve für Wege, Flüsse oder Grenzen.** Deren Geometrie trägt echte Stützpunkte; sie
  brauchen keinen Ersatz für eine Form, die sie zeichnen können.
- **Kein Regler für Kurvenart oder Stützpunktzahl im Editor.** Beides ist hier entschieden. Ein
  Regler wandert nur dann in den Editor, wenn seine Antwort je Objekt verschieden ist.
- **Keine Reparatur von `plMapFilter`** (§8).

---

## 11. Tests

| Datei | Was sie festnagelt |
|---|---|
| `js/map-features/__tests__/kraftlinie-kurvenform.test.js` | Die Rechnung: `curve = 0` ⇒ **bitweise dieselben** Punkte wie heute (die Nicht-Regression für 62 gerade Linien) · Scheitelhöhe bei `t = 0,5` ist exakt `curve/100 × Sehne` · **`−x` spiegelt `+x` exakt** (der Owner-Satz als Zusicherung) · die kanonische Richtung: dasselbe Segment mit vertauschtem `from`/`to` ergibt **dieselben** Punkte |
| dieselbe | Stützpunkte: `curve = 0` ⇒ genau 8; `|curve| = 45` ⇒ 24; monoton dazwischen |
| `js/map-features/__tests__/kraftlinie-kurve-alle-erzeuger.test.js` | Zur **Laufzeit** per Spion: Strangbauer, Klick-Linie und Label-Linie rufen alle drei den geteilten Helfer. „Die Datei ist eingebunden" ist erfüllt, auch wenn niemand sie ruft |
| `api/_internal/map/__tests__/powerline-inherit-test.php` | (bestehend, erweitert) `curve` steht in der **einen** Erb-Liste |
| `api/_internal/map/__tests__/kraftlinie-kurve-schreiben-test.php` | Der Schreibweg: auf **alle** Segmente der Namensgruppe · Bereich `−45…45` wird geklemmt, nicht abgelehnt · ein fehlender Schlüssel bedeutet `0` (das Formular schickt ihn immer) |
| `js/pages/__tests__/editor-abschnittsreihenfolge.test.js` | (bestehend, unverändert) muss **grün bleiben** — der Beweis, dass kein neuer Abschnittskopf entstand |

⚠️ **Vor dem Push das ganze Testfeld**, nicht die eigenen Tests — mit dem Muster des Workflows und
der Gegenprobe auf die Dateizahl (AGENTS.md §9).

---

## 12. Offene Punkte

- 🔧 **Der Ablauf im Browser mit angemeldeter Sitzung.** Schieber, Wegblenden, Live-Vorschau und
  Rückkehr sind gegen die echte Karte abzunehmen — die Handgriffe einzeln ausgeführt und benannt,
  nicht eine Maßtabelle.
- 🔧 **Wie stark ist „stark genug"?** Der Bereich `±45 %` ist am Torweg-Bild grob abgegriffen, nicht
  nachgemessen. Falls sich beim Einstellen zeigt, dass er zu eng oder zu weit ist, ist er **eine**
  Konstante.
- 🔧 **Verzweigte Linien und der Ring** (7 von 61 Namen, Stand 22.07.2026) bekommen die Kurve wie
  alle anderen; ob das Bild dort taugt, ist ungeprüft — siehe den benannten Preis in §7.

---

## 13. Nachtrag: die Kurve je Segment (29.08.2026, nach dem ersten Live-Gang)

Owner, nach dem Blick auf den Editor: *„macht es vielleicht sinn die kurvenform pro segment
einzustellen"* — gesagt vor der Linie **„Fächer der Macht"** (4 Enden, 4 Segmente, alle von
Kreuzung-4 zu Nadoret / Mendena / Riva / Festum).

🔴 **Das ist genau der Fall, den §7 als Preis benannt und in Kauf genommen hat.** Vier Kanten
strahlen sternförmig weg, sie zeigen in vier verschiedene Richtungen, und die kanonische Regel
(West→Ost) legt ihre Bögen deshalb auf willkürlich verschiedene Seiten. Ein gemeinsamer Wert kann
dort nicht richtig sein — der Preis ist zu hoch, und die Entscheidung kippt.

⭐ **Der Bau ist zur Hälfte schon da.** `curve` liegt in `properties_json` **je Segment**, und
`getPowerlineCurve` bekommt ein Segment übergeben — die Karte kann verschiedene Werte längst
zeichnen. Der Linien-Schreibweg schreibt heute bloß überall denselben Wert. Es ist **keine
Migration**, nur ein zweiter Schreibpfad und eine Bedienfläche.

### 13.1 Die Regel: Linie UND Segment, nach dem Muster der Weg-Ebene

Das Hausmuster steht schon (AGENTS.md §11, „Die WEG-EBENE des Wege-Editors", live 19.08.2026):
ein Weg liegt in Abschnitten, die Weg-Zeile gilt für alle, ein uneiniges Feld steht auf
„gemischt", und **geschrieben wird nur, was jemand angefasst hat**.

- Der **Linien-Schieber bleibt** und setzt alle Segmente auf einmal. Ohne ihn wäre die
  Basiliuslinie mit 16 Segmenten unbedienbar — das ist der gültige Teil des alten Einwands.
- **Jede Kante bekommt ihren eigenen Schieber**: in der Kantenliste (verzweigt / Ring) je
  `.pl-edge`, beim Strang an der Verbindung zwischen zwei Nodices.
- Sind die Segmente **uneinig**, steht der Linien-Schieber auf **„gemischt"** und schreibt nur,
  wenn jemand ihn anfasst.

💣 **DIE TRAGENDE REGEL, und sie kehrt das heutige Verhalten um: ABWESENHEIT heißt „nicht
geändert".** Der Server liest `curve` heute als `$payload['curve'] ?? 0` und schreibt ihn bei jedem
Speichern auf alle Segmente. Sobald der Editor ihn nur noch bei Anfassen mitschickt, machte genau
dieses `?? 0` **jede** gewollte Ausnahme lautlos platt — und zwar auch bei einer reinen
Beschreibungsänderung. Das ist Zeichen für Zeichen die `wiki_no_article`-Falle aus derselben Datei,
und die Antwort ist dieselbe: `array_key_exists('curve', $payload)`.
⚠️ Die zwei Hälften gehören zusammen und dürfen nicht einzeln zurückgedreht werden: wer im Server
`?? 0` wiederherstellt, braucht im selben Zug einen Editor, der den Wert immer sendet.

### 13.2 Der Schreibweg

`update_powerline_line` nimmt zwei neue, **unabhängige** Angaben entgegen:

| Feld | Bedeutung | wann geschickt |
|---|---|---|
| `curve` | „setze **alle** Segmente auf diesen Wert" | nur wenn der Linien-Schieber angefasst wurde |
| `curves` | `{ "<public_id>": <zahl>, … }` — einzelne Segmente | nur die angefassten Kanten |

🔴 **`curves` gewinnt über `curve`**, wenn beide für dasselbe Segment etwas sagen: der speziellere
Griff ist der jüngere Wille. Fehlt beides, bleibt jedes Segment, wie es war.
⚠️ Eine `public_id` in `curves`, die nicht zur Namensgruppe gehört, wird **ignoriert**, nicht
abgelehnt — sonst kann ein veralteter Editor-Stand eine ganze Speicherung scheitern lassen.

### 13.3 Auf der Karte

🔴 **Ein Klick wählt das Segment** (Owner 29.08.2026). Im Einstell-Modus hebt sich das angeklickte
Stück hervor, der Regler nennt es (`Kreuzung-4 — Nadoret`) und biegt nur dieses; ein Knopf „alle"
setzt weiterhin die ganze Linie. Das ist der Grund, überhaupt auf der Karte einzustellen: dort
sieht man, welches Stück am Berg vorbei soll.

💣 **Die Vorschau hängt heute am Linien-NAMEN** (`avesmapsPowerlineCurveVorschau.name`) und muss auf
eine **Segment-Kennung** umgestellt werden. Der Name bleibt als zweiter Fall bestehen — er ist
genau der „alle"-Griff.

### 13.4 Was NICHT geändert wird

- **Die kanonische Richtung bleibt** (§7). Sie trägt weiterhin das Umsortieren; dass man die Seite
  jetzt je Segment sehen und einstellen kann, macht sie nicht überflüssig — ein umsortiertes
  Segment würde sonst weiterhin still umklappen.
- **Kein neues Feld, keine Migration.** `properties.curve` steht schon je Segment.
- **Die Kurvenart bleibt die Parabel**, die Stützpunktzahl bleibt abgeleitet.
