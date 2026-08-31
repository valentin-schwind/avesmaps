# Landschaftsnamen weichen einander aus

**Stand:** 31.08.2026 · **Mockup:** `docs/landschaften-label-kollision-mockup.html`
**Anlass:** Owner-Meldung mit Bild — drei Landschaftsnamen vollständig übereinander
(„kann man bei landschaften verhindern dass labels übereinander stehen? orientier dich bei der
kollisionsvermeidung an dem ansatz bei den ortschaften und trag die einstellungen in ‚Darstellung'
im Regioneneditor ein.")

---

## 1 · Der Befund

Der gemeldete Fall sind **drei verschiedene Landschaften auf demselben Punkt** (live gemessen,
Zoomstufe 5, Abstand der Anker 0,15 Karteneinheiten):

| Name | Art | Fläche | Bildmaß |
|---|---|---|---|
| Grüne Zwillinge O | `berggipfel` | — | 187 × 60 |
| Grüne Zwillinge W | `huegelland` | ✓ | 202 × 40 |
| Wald an den Grünen Zwillingen | `urwald` | ✓ | 304 × 38 |

Sie gehören **drei verschiedenen Flächen**; die Ausnahme „Labels derselben Fläche dürfen einander
überlappen" greift hier also gar nicht. Zwei Ursachen, beide im Code:

**(1) Neun winzige Ausweichstellen.** `getLabelOffsetCandidates()`
(`js/map-features/map-features-label-collisions.js`) bietet freien Kartenlabels höchstens **±12 px
waagerecht und ±8 px senkrecht**. Bei 187–304 px Namensbreite bewegt das nichts. Ortsnamen haben
dagegen zwölf echte Stellen rund um ihren Punkt samt Deckel
(`avesmapsLabelCandidatePlacements`, `js/map-features/label-placement.js`).

**(2) Ein Label mit Fläche wird nie ausgeblendet.** In `avesmapsResolveLabelPlacements` entscheidet
`const gesetzt = gruppe !== ""`; ist es wahr, bleibt der Name an seinem Platz liegen und überlappt.
Owner-Entscheid vom 28.07.2026, begründet mit: das Label ist der einzige garantierte **Anfasser**
seiner Fläche.

> 🚩 **Live gegengemessen:** von den drei Namen wird genau der ohne Fläche (`Grüne Zwillinge O`)
> korrekt ausgeblendet. Die zwei mit Fläche bleiben aufeinander liegen — das ist das Bild.

---

## 2 · Die Owner-Entscheide

**(a) Ein Landschaftsname darf verschwinden — wie ein Ortsname.**
Der Grund für die Nie-Ausblenden-Regel ist entfallen: seit dem 23.08.2026 trägt ein Label im
Bearbeiten-Modus ohnehin **keinen Marker mehr**, und der Weg zu ihm führt über das Kontextmenü der
**Fläche** („Beschriftung bearbeiten", `map-features-ecosystem-context-action.js`). Das Label ist
damit nicht mehr der einzige Anfasser, und die Owner-Regel von den verwaisten Außenhüllen
(„es darf keine Elemente geben, über die ich keine Kontrolle mehr habe") bleibt gewahrt.

**(b) Drei eigene Regler statt geerbter Werte:** Repel · Versatz · Drift.

**(c) Dicht am Punkt.** Ein Landschaftsname wurde von einem Editor bewusst platziert; er soll dort
stehen, nicht wandern. Gewählt: **Deckel 72 px** (siehe §4) — ein Fünftel dessen, was die Ortsnamen
dürfen (150).

---

## 3 · Die Regel

Ein freies Kartenlabel bekommt einen **Ring von Ausweichstellen** um seinen Punkt:
Schrittweite `versatz`, gewachsen bis `drift`, **senkrecht zuerst**.

```
mitte · oben · unten · oben-rechts · oben-links · unten-rechts · unten-links · rechts · links
```

Die Reihenfolge ist begründet und steht in dieser Form schon an den Territoriumsnamen: *breite Namen
überlappen stark waagerecht und nur wenig senkrecht, der kürzeste Ausweg ist also nach oben oder
unten.* Jede Stelle trägt ihren `drift` (Luftlinie zur Normalstellung); was darüber liegt, wird gar
nicht erst probiert. Bleibt nichts frei, **verschwindet der Name**.

### 💣 Der Kern: `gruppe` trägt heute ZWEI Bedeutungen

| Bedeutung | bleibt? |
|---|---|
| „darf mit Namen **derselben Fläche** überlappen" (Finsterkamm, Owner 28.07.2026) | ✅ **bleibt** |
| „wird **nie ausgeblendet**" | ❌ **fällt** (Entscheid 2a) |

Beide hängen an derselben Zeile (`const gesetzt = gruppe !== ""`). Wer sie nicht trennt, reißt beim
Umsetzen von (2a) die Finsterkamm-Regel mit — und das fällt nicht auf, weil ein Gebirge seinen Namen
dann einfach nur noch einmal statt zweimal trägt.

### 🔴 Kein dritter Löser

Es gibt heute **zwei** Durchgänge — `resolveRegionLabelCollisions` (Territoriumsnamen, eigener Pass)
und `resolveLabelCollisions` (Orts- **und** freie Labels). Der Landschaftsname bleibt im zweiten. Er
bekommt einen ordentlichen Kandidatenbauer, keinen eigenen Pass. Ein dritter wäre die
Listenzeilen-Falle eine Etage höher.

### 💣 Der Deckel gilt JE EINTRAG, nicht je Aufruf

Orts- und Landschaftsnamen liegen in **einem** Durchgang (`resolveLabelCollisions` ruft den Löser
einmal mit beiden Familien). `maxDrift` ist heute eine Option des Aufrufs — ein gemeinsamer Wert für
zwei Familien mit verschiedenen Reglern ist nicht baubar. Also: `eintrag.maxDrift` schlägt die
Aufrufoption; fehlt er, gilt wie bisher die Option.

### 💣 Eine Stelle OHNE `drift` bleibt ungedeckelt

Der Riegel lautet heute `if (relativ && typeof kandidat.drift === "number" && …)`. Das `relativ &&`
fällt weg — nicht aber die Typprüfung. Ein Aufrufer, der schlichte `{dx, dy}` ohne `drift` übergibt,
wird damit weiterhin nie beschnitten. Das ist die sichere Richtung: der schlimmste Fall ist „ein
Name weicht weiter aus als gedacht", nicht „alle Namen verschwinden".

### ⚠️ Was NICHT angefasst wird

- die **Rangfolge**: freie Namen (Priorität 1000+) gehen weiterhin vor Ortsnamen; bei Gleichstand
  entscheidet die Erscheinungsstufe.
- der **Territoriumspass** und seine `REGION_LABEL_MAX_TENSION`.
- die **Kurvenlabels**: sie reisen weiter als Vorbelegung in den Durchgang und werden nicht bewegt.

---

## 4 · Die Zahlen

Gemessen am Livebestand (~900 Beschriftungen, Repel 2, Versatz 8), im **laufenden Browser** gegen
die echte Kartennutzlast. „verschwinden" heißt ausgeblendet, „überlappen" heißt: bleibt liegen und
deckt einen fremden Namen zu.

| Zoom | sichtbar | heute überlappen | heute weg | Deckel 56 | Deckel 64 | **Deckel 72** |
|---|---|---|---|---|---|---|
| z3 | 447 | 21 | 6 | 1 | 0 | **0** |
| z4 | 710 | 29 | 37 | 17 | 11 | **8** |
| z5 | 809 | 13 | 26 | 9 | 7 | **3** |
| z6 | 831 | 5 | 7 | 3 | 2 | **0** |

🔴 **Es verschwinden WENIGER Namen als heute, nicht mehr** — und keine Überlappung bleibt übrig.
Der Grund ist (1): weil die neun winzigen Stellen so gut wie nie helfen, fallen heute die Namen
*ohne* Fläche reihenweise ganz weg; mit echtem Ausweichraum finden sie einen Platz.

**Warum 72.** Am gemeldeten Fall im laufenden Browser nachgefahren: bei 40 steht einer der drei
Namen, bei 56 zwei, **ab 64 alle drei** — der Waldname weicht 48 px nach oben aus, der Gipfelname
64 px nach unten. Die Vorgabe steht auf 72, weil 64 den Fall auf den Pixel genau löst: eine
Schriftmetrik, die sich um zwei Pixel ändert, kippte ihn zurück.

An den vier gemessenen Ballungen (Zahl der Namen, die verschwinden):

| Ballung | Namen | heute | Deckel 72 |
|---|---|---|---|
| Grüne Zwillinge (der gemeldete Fall) | 3 | 2 weg | **0** |
| Mhanadi-Delta (die größte) | 7 | 3 weg | **0** |
| Firnhang (5 Gipfel auf 60 px) | 5 | 3 weg | **0** |
| Gipfelkette | 4 | 2 weg | **0** |

⚠️ Die Bestandszahlen lassen die Vorbelegung außen vor (Gebietsnamen, Kurvenlabels, Wegenamen); die
echten Zahlen liegen etwas höher. Die vier Ballungen sind dagegen im echten Durchgang gefahren.

### 🪤 Die Messfalle, die zwei Stunden gekostet hat — und um 16 px danebenlag

Die erste Fassung dieses Entwurfs nannte **56**, und dieser Wert war falsch: er stammte aus einer
Simulation, die das Bildmaß über einen blanken `renderMapLabelToImage`-Aufruf holte.
**`createLabelIcon` rendert aber MIT Halo** (`getLabelHaloParams`), und das Bild ist dadurch 6 px
breiter und 6 px höher. Bei einem 40 px hohen Namen sind das 15 %.

Der Effekt ist heimtückisch, weil er in die *gefällige* Richtung zeigt: die Simulation meldete
„alle drei Namen stehen bei 56", der Browser verlor einen. Beide Zahlen sahen wie eine Messung aus.

⭐ **Die Gegenprobe kostet nichts und hat es sofort gefunden:** das gerechnete Bildmaß gegen die
`width`/`height` des `<img>` im DOM halten, bevor irgendetwas darauf aufgebaut wird. Alle zehn
sichtbaren Namen wichen um denselben Betrag ab — ein systematischer Versatz, kein Rauschen, und
damit sofort als Pfadfehler erkennbar.

## 5 · Die Regler

Neuer Abschnitt **„Namen — Abstände"** im Fenster *Darstellung* des Landschaften-Editors
(`html/landschaften-editor.html`, Kachel `#ecoDisplay`), unter dem Größenplot.

| Regler | Vorgabe | Grenzen | Bedeutung |
|---|---|---|---|
| Repel | 2 px | 0 … 20 | Luft um jeden Namen vor der Prüfung |
| Versatz | 8 px | 2 … 24 | Schrittweite eines Ausweichschritts |
| Drift | 72 px | 0 … 150 | weiter weg heißt: der Name verschwindet |

**Global über alle Arten**, nicht je Art: für 28 Landschaftsarten hat nie jemand einen Unterschied
entschieden, und eine geratene Vorgabe sähe aus wie eine getroffene (dieselbe Begründung wie bei den
uniformen Vorgaben in `ecosystem-display.js`).

Gespeichert als Abschnitt `abstaende` in **derselben Tafel** wie Farbe, Größe und Zoomband
(`app_setting`-Schlüssel der Landschafts-Darstellung, gelesen über
`avesmapsEcosystemDisplayTeil("abstaende")`). Ansehen darf `edit`, speichern nur `admin` — wie der
Rest des Fensters. Zurücksetzen **löscht** den Abschnitt, statt eine Kopie der Vorgabe zu
hinterlassen.

### 🪤 Die versteckte Kopplung, die dabei fällt

`measureLabelCollisionRect(element, padding = avesmapsLocationLabelSpacing("repel"))` gibt allen
Elementen des Durchgangs den **Repel der ORTSCHAFTEN** — auch den Landschaftsnamen. Wer heute im
Fenster „Orte → Darstellung" an Repel dreht, verschiebt also längst auch Landschaftsnamen, ohne dass
das irgendwo steht. Mit dem eigenen Regler liest jede Familie ihren eigenen Wert.

---

## 6 · Was angefasst wird

| Datei | Änderung |
|---|---|
| `js/map-features/label-placement.js` | neuer reiner Kandidatenbauer `avesmapsFreeLabelCandidatePlacements`; Deckel je Eintrag; `gruppe` verliert die Nie-Ausblenden-Bedeutung |
| `js/map-features/map-features-label-collisions.js` | Repel je Familie; die neun festen Stellen weichen dem Kandidatenbauer; `maxDrift` je Eintrag |
| `js/map-features/ecosystem-display.js` | Vorgaben + Leser `avesmapsEcosystemDisplayAbstand` |
| `api/_internal/app/ecosystem-display.php` | Prüfung des Abschnitts `abstaende` samt Schranken |
| `html/landschaften-editor.html` | der Abschnitt im Fenster, Verdrahtung, Speichern, Zurücksetzen |
| `AGENTS.md` | die umgedrehte Regel von 2026-07-28 festhalten |

**Tests:** der Kandidatenbauer und die Trennung von `gruppe` in
`js/map-features/__tests__/label-placement.test.js`; die Verdrahtung der Karte in einem eigenen
Test; Leser und Vorgaben in `js/map-features/__tests__/`; die Server-Prüfung in
`api/_internal/app/__tests__/`.

⚠️ **Zwei bestehende Zusicherungen kehren sich um** (Abschnitte D und F in
`label-placement.test.js`): „ein Flächen-Label wird NIE ausgeblendet" und „ein freies Kartenlabel
wird vom Deckel nicht angefasst". Beide werden nicht gelöscht, sondern **umgedreht und mit dem
Datum des Entscheids versehen** — sonst liest der nächste Leser die Lücke als Versehen.

---

## 7 · Abnahme

1. Der gemeldete Fall im Browser: drei Namen an den Grünen Zwillingen, kein Stapel.
2. Die Zahlen aus §4 im **echten** Durchgang statt in der Simulation.
3. Das Fenster: Werte verstellen, speichern, neu laden, Wirkung auf der Karte.
4. Das ganze Testfeld (AGENTS.md §9), nicht nur die eigenen Tests.

## 8 · Offen

- 🔧 Das Fenster bekommt **keine Vorschau** wie die Zoombänder. Die drei Zahlen wirken auf der Karte
  und sind dort zu beurteilen; eine Vorschau, die eine einzelne Ballung zeigt, wäre eine zweite
  Fläche, die gepflegt werden will. Das Mockup bleibt als Werkzeug liegen.
- 🔧 Die **Priorität** eines Namens (`label.priority`, 1–5) entscheidet mit, wer bei Gedränge
  weichen muss. Sie ist je Beschriftung einstellbar und wird hier nicht angefasst — ob eine Art
  grundsätzlich Vorrang haben soll (ein Gebirge vor einem Hügelland), ist eine eigene Frage.
- 🔧 Die Bestandszahlen in §4 sind **simuliert** (die Vorbelegung fehlt). Im echten Durchgang
  gemessen sind nur die vier Ballungen; eine vollständige Zählung über alle Zoomstufen bräuchte
  einen Lauf über die ganze Karte und ist die Mühe nicht wert, solange die Richtung so eindeutig ist.
