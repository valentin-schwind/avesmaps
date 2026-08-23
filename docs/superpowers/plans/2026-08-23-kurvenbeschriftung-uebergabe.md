# Übergabe: Kurvenbeschriftung fertigstellen

**Für die nächste Sitzung.** Die vorige hat den Zeichenweg gebaut und dabei zwei Live-Störungen
verursacht. Lies §1 zuerst — dort steht, was du **nicht** tun darfst.

---

## §1 Zwei Störungen, die diese Sitzung verursacht hat — und die Regeln daraus

### 1.1 STRATO überlastet
Die Sitzung baute einen „Abnahme-Server" (Node), der die eigenen Dateien auslieferte und `/api/`,
`/tiles/`, `/uploads/` an **avesmaps.de** durchreichte — **ungecacht**, und mit
`accept-encoding: identity`, also unkomprimiert.

Gemessen: `map-features.php` = **19,97 MB, 105 Sekunden** pro Seitenladung (statt ~3 MB gzip). Bei
rund **acht** Neuladungen der Abnahmeseite hat das die PHP-Arbeiter gesättigt.

Das Werkzeug ist wieder entfernt (`96d02a71`).

### 1.2 Wiki Aventurica hat die Ausgangs-IP gesperrt
Jede dieser Kartenladungen holt Wappen über `api/app/coat.php`, und der Endpunkt lädt sie von
**STRATOs Ausgangs-IP** (`81.169.144.135`) bei Wiki Aventurica. Acht volle Kartenladungen in kurzer
Folge sehen von dort aus wie ein Crawler. Die Sperre äußert sich als sofortiges `Connection refused`
bzw. **502** an `coat.php`.

🔴 **Und ein Befund, der bleibt:** der Schalter **„Wappen: Aus"** wirkt laut eigener Beschriftung
**nur im Frontend**. Die Editor-Seite `wiki-sync-settlement-editor` ruft `coat.php` trotzdem weiter
für ihre Listen — mit gesetztem Schalter, live beobachtet, hunderte 502er. **Wer die Sperre
aussitzen will, muss diese Editorseite schliessen**, der Schalter genügt nicht. 🔧 Ob der Schalter
den Editor mit abdecken sollte, ist eine offene Frage an den Owner.

### 🔴 Die Regeln, die daraus folgen — sie sind nicht verhandelbar

1. **Baue KEINEN Proxy auf die Produktion.** Kein lokaler Server, der `/api/` an avesmaps.de
   weiterreicht. Das war der Auslöser für beide Störungen.
2. **Lade den Kartenpayload NICHT wiederholt.** `map-features.php` ist ~20 MB. AGENTS.md sagt es
   schon: *„probe with a single request"*. Eine Messung, die eine Seite achtmal neu lädt, ist keine
   Messung, sondern ein Lasttest gegen die Produktion.
3. **Sichtprüfung findet auf der LIVE-Seite statt, nach dem Deploy, EINMAL** — oder der Owner sieht
   selbst nach. Es gibt lokal kein `api/config.local.php`, also keine lokale Datenbank; das ist eine
   Einschränkung, mit der man lebt, kein Problem, das man mit Infrastruktur löst.
4. **Frag den Owner, bevor du irgendetwas gegen avesmaps.de laufen lässt**, solange die
   Wiki-Sperre steht.

---

## §2 Wo die Sache steht

**Auf `master`, gepusht und deployt:** bis `b0cbe60a`.
**Arbeitsbaum:** `.claude/worktrees/kurvenlabel-zeichnen`, Zweig `worktree-kurvenlabel-zeichnen`
(inhaltsgleich mit `master`).

| Dokument | Pfad |
|---|---|
| Entwurf (maßgeblich) | `docs/superpowers/specs/2026-08-22-kurvenbeschriftung-design.md` |
| Plan 1 — die Kurve (Server), **live** | `docs/superpowers/plans/2026-08-22-kurvenbeschriftung-1-die-kurve.md` |
| Plan 2 — das Zeichnen, **live** | `docs/superpowers/plans/2026-08-22-kurvenbeschriftung-2-das-zeichnen.md` |
| Ledger + Aufgabenberichte | `.superpowers/sdd/2026-08-22-kurvenbeschriftung-2-das-zeichnen/` ⚠️ **gitignored**, liegt nur im obigen Arbeitsbaum |

### Was gebaut ist

* `api/_internal/app/curve-labels.php` + `-store.php` — der Server rechnet die Kurve je Fläche,
  Zwischenspeicher, Sammellauf `api/edit/map/curve-labels-run.php` (Fähigkeit `admin`).
* `js/map-features/curved-label-layout.js` — **neu.** Zwölf reine Rechenfunktionen, aus der IIFE von
  `map-features-path-label-canvas-overlay.js` herausgelöst und erstmals getestet.
* `js/map-features/curve-label-fit.js` — **neu.** Passung: Verteilung mehrerer Namen, ruhigstes
  Stück, Beruhigung, Sperrung, Verlängern, Verkleinern. Enthält `AVESMAPS_CURVE_LABEL_DEFAULTS`,
  **die einzige Stelle** mit den zwölf Werten aus Entwurf §6.1.
* `map-features-path-label-canvas-overlay.js` — Kanal C: malt die Kurvenlabels, Klickregister.
* `map-features-labels.js` — `curveLine`/`curveMax` am Label, Kandidatenleser, Marker-Riegel.
* `map-features-label-collisions.js` — Kurvenlabels werden **vor** den Ortsnamen platziert.
* Sechs Testdateien, JS-Testfeld 0 rot, PHP nur der vorbestehende `link-url-test.php`.

---

## §3 🔴 Der offene Fehler: „DRACHENSTEINE" steht ZWEIMAL

Live sichtbar (Owner-Screenshot, 23.08.2026): der Name erscheint doppelt. Nur **eine** Fläche hat
die Kurvenbeschriftung eingeschaltet (die Drachensteine), es dürfte also genau **ein** Name stehen.

Der Mechanismus dagegen ist vorhanden und wird gerufen:
`avesmapsSyncKurvenlabelMarker()` (`map-features-labels.js:953`), aufgerufen aus
`map-features-label-collisions.js:35`, meldet den alten Marker ab, sobald sein Kurvenlabel wirklich
gemalt wurde.

**Zwei Verdächtige, in dieser Reihenfolge prüfen:**

1. 🪤 **Der `?v=`-Stempel.** Plan 2 hat **zwei neue Dateien** in `index.html` eingehängt
   (`curved-label-layout.js`, `curve-label-fit.js`). Schlägt ein Deploy fehl oder wird er von einem
   zweiten Push abgebrochen, lädt live die alte Hälfte, und der Marker verschwindet nie. AGENTS.md
   §9 beschreibt genau das. **Diagnose zuerst hier**, mit EINEM Abruf je Datei, nicht mit einer
   Kartenladung:
   ```
   curl -s -o /dev/null -w "%{http_code} %{size_download}\n" "https://avesmaps.de/js/map-features/curve-label-fit.js"
   ```
   und gegen `wc -c` derselben Datei im Repo halten. Heilen lässt sich das nur durch eine
   **Inhaltsänderung**, nicht durch einen leeren Commit.
2. **Zwei Label-Zeilen für dieselbe Fläche.** Eine Fläche kann mehrere Beschriftungen tragen
   (AGENTS.md §11, „EINE Fläche, VIELE Labels"). `avesmapsCurveApplyToFeatures` hängt **dieselbe**
   Kurve an **jedes** Label der Region — zwei Label-Zeilen ergäben dann zwei Namen auf derselben
   Kurve. Ob die Drachensteine zwei Zeilen haben, sagt eine einzige SQL-Abfrage oder ein Blick in
   den Editor; **keine** Kartenladung.

⚠️ Der Owner liest das doppelte Label als „du hast ein Label hinzugefügt". Es ist keines — aber die
Wirkung ist dieselbe, und sie muss weg, bevor irgendetwas anderes passiert.

---

## §4 🔴 Was der Owner eigentlich will — und was diese Sitzung falsch priorisiert hat

Wörtlich: *„anstatt neue labels reinzusetzen hättest du die die curved machen sollen, die derzeit
eine rotation != 0 haben"* — und im Screenshot des Beschriftungsdialogs ist markiert, dass dort
immer noch **„Rotation"** steht statt der zwei neuen Bedienelemente.

Das ist **Plan 3**, und die vorige Sitzung hat ihn vertagt. Das war die falsche Entscheidung. Er ist
das Nächste, und er besteht aus:

1. **Die zwei Bedienelemente** im Beschriftungsdialog (`index.html`) **und** im Flächendialog
   (`js/map-features/map-features-ecosystem-properties.js`): „Kurvenbeschriftung an/aus" und
   „Maximale Anzahl der Labels" (1…3).
   🔴 Sie **ersetzen „Rotation" vollständig** (Owner, Entwurf §2). Der Rotationswert darf im
   Hintergrund gespeichert bleiben, wird aber nicht mehr verwendet.
2. **Region-Synchronität:** eine Fläche kann mehrere Labels haben. Ändert sich der Wert an einem
   Label oder an der Fläche, gilt er für **alle** Labels und Flächen der Region.
   💣 Entwurf §9.5: beide Dialoge gleichzeitig offen, in einem ändern und speichern, dann den
   anderen **unverändert** speichern — die Änderung muss stehen bleiben.
3. **Der Umstelllauf:** jede Fläche, die heute `Rotation != 0` hat, bekommt automatisch
   Kurvenbeschriftung **an** mit Anzahl 1 — bzw. **2**, wenn die Region zwei Labels hat
   (Entwurf §8.2, §12.2: „so viele Labels wie vorhanden, höchstens 3"). Rund **56** Flächen.
4. **§4.3** — ohne Kurvenbeschriftung ist der Name eine ganz normale **Gerade**, nicht die alte
   Handdrehung. 🔴 **Gehört in denselben Zug wie der Umstelllauf**: davor ausgeliefert richtet es 56
   Namen gerade, die noch niemand eingeschaltet hat.
5. **§7.4** — ein Kurvenlabel richtet sich nach dem Ziehen und nach einer Geometrieänderung neu aus.
   Hängt an Punkt 6.
6. ⚠️ **Zwischenstand, der aufzulösen ist:** im **Bearbeiten-Modus** bleibt der alte Marker
   absichtlich stehen (Klick, Popup, Ziehgriff), der Name steht dort also doppelt. Begründung steht
   im Code bei `avesmapsLabelWirdAlsKurveGemalt`. Mit §7.4 wird daraus die endgültige Regel.

---

## §5 Was sonst offen ist

* 🔧 **Die Sperrung spannt die Fläche nicht auf.** Entwurf §5.2 behauptete: *„gesperrt beschriftet
  er sie."* Nachgemessen belegt der Name **konstant 133,9 px**, unabhängig von der Kurvenlänge —
  13,4 % bei 1000 px, **1,2 %** bei den 11 246 px von Zoom 7. Die Portierung ist **treu** (der
  Prototyp bemisst sein Fenster nach dem Namen, nicht nach der Fläche); der Entwurf war falsch und
  ist korrigiert (`3e308eed`). Selbst mit ganzem Bogen deckelt ab ~1000 px der Zusatz je Lücke
  (0,6 Schriftgrößen) bei 21,6 % bzw. 1,9 %. **Owner-Entscheidung an den Referenzflächen**, nicht
  am Zahlenblatt.
* 🔧 **Plan 4:** die Kachel „Darstellung" — ein Fenster für die zwölf Werte aus §6.1. Heute stehen
  sie als Konstanten in `curve-label-fit.js`. Der Knopf „Zoombänder" unter „Orte" soll künftig
  „Darstellung" heissen; Speichern nur `admin`, Ansehen `edit`.
* 🔧 **Abnahme an den Referenzflächen** (Entwurf §9): sechs Flächen plus eine **derographische**
  (z. B. Albernia — unter den sechs ist keine). Braucht Schreibzugriff auf die Live-Datenbank, also
  den Owner.
* 🔧 **Die Messung aus §7.2/§12.3** („verdrängt ein Kurvenlabel Ortsnamen?") ist offen: die
  Drachensteine liegen in menschenleerem Gebirge, bei Zoom 7 stehen dort **null** Ortsnamen.
  Sinnvoll erst nach dem Umstelllauf.
* ⚠️ Der quere Ausweichweg (§7.2 Punkt 2, „wahlweise") ist bewusst nicht gebaut.

---

## §6 Fallen, die in dieser Sitzung Geld gekostet haben

* 💣 **Beim Herauslösen aus einer IIFE zählt nicht nur ZUSTAND, sondern auch der Aufruf einer
  Geschwisterfunktion.** `findFreePlacement` wurde global und rief `pathLabelBendSettings`, das
  drüben blieb → `ReferenceError` bei jedem Aufruf → live wären **sämtliche** Weg-, Fluss- und
  Kraftlinien-Namen verschwunden. Das Testfeld war grün, weil kein Test das Overlay lädt. Gewacht
  von `js/map-features/__tests__/curved-label-layout-eigenstaendig.test.js`.
* 💣 **`shouldShowLabelMarker` → `false` MELDET DEN MARKER AB** (`map.removeLayer`), es versteckt ihn
  nicht. Mit ihm gehen Klick, Popup und Ziehgriff. Deshalb gibt es das Klickregister in Kanal C.
* 💣 **Ein Testblock im Bauplan kann fast wirkungslos sein:** von 15 Mutationen des Passungs-Moduls
  überlebten **11** den mitgelieferten Test. Mutiere jede Zusicherung einzeln.
* 💣 **`map.setView(...)` und sofort `redraw()`** misst eine Belegungskarte der ALTEN Ansicht — das
  ergab 197 statt 160 Glyphen und sah wie eine echte Abweichung aus. Erst
  `scheduleLabelCollisionResolution()`, dann einen Aufruf später messen.
* 💣 **Ein selbstgebauter Server mit `process.cwd()` als Wurzel** lieferte klaglos den 150 Commits
  alten Hauptbaum statt des Arbeitsbaums. Jede Messung galt dem falschen Code, und es sah plausibel
  aus.

---

## §7 Wie du anfängst

1. **Frag den Owner**, ob die Wiki-Sperre noch steht und ob du die Seite anfassen darfst.
2. **§3 zuerst** — das doppelte Label. Diagnose über einzelne Dateiabrufe, nicht über Kartenladungen.
3. **Dann §4** — Plan 3, in der dort genannten Reihenfolge. Das ist, was der Owner sehen will.
4. Sichtbare Änderungen gehen **einzeln** live, und der Owner sieht jede (AGENTS.md §9). Nach jedem
   Push den Deploy-Lauf **abwarten**, bevor der nächste geht.
