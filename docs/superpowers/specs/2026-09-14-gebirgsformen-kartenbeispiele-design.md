# Gebirgsformen: Beispiele von der Karte statt irdischer Vorbilder — Entwurf

**Stand:** 14.09.2026 · **Status:** entschieden (Owner-GO 14.09.2026: „go, B und V1, schlag Kandidaten aus
dem Wiki vor") · **Mockup:** `docs/gebirgsformen-beispiele-mockup.html`

## 1. Anlass

Owner 14.09.2026, wörtlich: „Der Editor soll bei den Gebirgsformen keine Musterbeispiele sondern richtige
Beispiele aus der karte anzeigen".

Ausgelöst hat es die Handbuch-Routine vom 13.09.2026: Das Auswahlfeld **Morphologie** im Dialog
„Landschaft bearbeiten" (Reiter Fläche, Kasten „Gebirgseinstellungen", `index.html`) zeigte nur die zehn
Namen aus `ECOSYSTEM_HYDRO_MORPHOLOGIEN` (`js/map-features/map-features-ecosystem-hydrologie.js`). Die
irdischen Vorbilder standen als Code-Kommentar an der Tabelle, und das Handbuch nennt sie selbst.

## 2. Messung (live, 14.09.2026)

Eine Abfrage `GET /api/app/ecosystem-areas.php?kind=topographie`, Revision 58501.

| Frage | Ergebnis |
|---|---|
| Gebirgsflächen (`topographie` + `gebirge`) | **71** in 71 Regionen |
| mit gemerkter Vorlage (`terrain_preset_morph`) | **9**: Karst 8, Kuppengebirge 1 |
| Formen mit mindestens einem Gebirge | **2 von 10** |
| nur die vier alten Regler (Körnung, Feinheit, Erosion, Kammhöhe) | 56 |
| keine Formregler | 6 |
| alle zehn Formregler | 3 (dazu Rorwhed mit neun) |
| Regionskennungen in kleingeschriebener UUID-Form | 790 von 790 |

**Gegenproben:**
- *Eiszinnen* und *Raschtulswall* tragen „Karst", aber keinen einzigen eigenen Formwert.
- *Schwarze Sichel* trägt „Karst"; ihre zehn Zahlen liegen am nächsten am Rumpfgebirge (0,28, dann
  Kettengebirge 0,35), Karst ist nicht unter den zwei nächsten.
- *Gorische Wüste* trägt keine Vorlage, ihre Zahlen sind aber exakt die des Plateaugebirges.

**Schluss:** Die gemerkte Vorlage ist eine **Herkunftsangabe**, keine Einordnung. Und die gespeicherten
Zahlen reichen nur bei 4 von 71 Gebirgen für „welcher Form ähnelt es".

## 3. Entscheidungen

1. **Quelle: B, eine gepflegte Zuordnung als Daten.** Verworfen wurden A (aus der gemerkten Vorlage,
   auch als „Daten zuerst") und D (aus den Zahlen gerechnet) wegen §2, und C (eine eigene Einordnung je
   Fläche) wegen der Verwechslung mit dem Aktionsfeld.
2. **Ort: V1, im Auswahlfeld:** „Kettengebirge — wie Ehernes Schwert, Raschtulswall". Nicht klickbar.
3. **Irdische Vorbilder im Code-Kommentar: stehen lassen.** Sie sind die Messgrundlage der zehn mal zehn
   Zahlen (AGENTS.md §11). Vom Owner nicht ausdrücklich beantwortet, gebaut nach der Empfehlung.
4. **Pflegen: nur Administratoren**, wie der Rest der Darstellungstafel. Ebenfalls nach der Empfehlung.
5. **Erstbefüllung:** Kandidaten aus den Wiki-Aventurica-Artikeln der 71 Gebirge werden vorgeschlagen; der
   Owner hakt sie im Fenster ab. Im Code steht keine Zuordnung.

## 4. Bau

**Daten.** Abschnitt `gebirgsformen` der Darstellungstafel (`app_setting` `ecosystem_display`):
`{ "<formKey>": ["<region_public_id>", …] }`.
- Je Form höchstens `AVESMAPS_ECOSYSTEM_DISPLAY_GEBIRGSFORM_MAX` = **3** Regionen.
- Die Zahl steht in `js/map-features/ecosystem-display.js` **und** in
  `api/_internal/app/ecosystem-display.php`; `gebirgsform-beispiele.test.js` hält beide gegeneinander.
- Gespeichert wird die Region, nie ein Name — eine Umbenennung wandert mit.

**Server** (`avesmapsEcosystemDisplayValidate`):
- Geprüft wird die FORM:
  - Schlüssel `^[a-z]{1,40}$`
  - eine echte Liste
  - höchstens drei Einträge
  - kleingeschriebene UUIDs
  - keine Dublette
- 🔴 Keine Formenliste im Server: die zehn Formen stehen im Browser.
- Kein neuer Endpunkt. Der öffentliche Leser gibt den Abschnitt mit der Tafel heraus — ein paar hundert
  Byte, nur Kennungen.

**Die Regel, EINMAL** (`js/map-features/ecosystem-display.js`):
- `avesmapsGebirgsformBeispielIds(teil, formKey, uebersetze)` liefert die Beispiele einer Form: in
  gepflegter Reihenfolge, ohne Dubletten, höchstens drei.
- Alte Schlüssel laufen über `avesmapsHydroMorphSchluessel`; der heutige Schlüssel kommt zuerst.
- `teil` kommt herein: die Karte fragt die geladene Tafel, das Fenster seine Arbeitstafel.
- `avesmapsGebirgsformZeilentext(name, namen)` baut die Zeile.

**Dialog** (`map-features-ecosystem-properties.js`):
- `fuelleVorlagenFeld` bekommt einen optionalen Beschrifter; der **Wert** bleibt der Schlüssel, und
  `wendeVorlageAn` liest nur ihn.
- Die Namen kommen aus der `list_regions`-Antwort, die der Dialog beim Öffnen ohnehin holt
  (`gebirgsformRegionNamen`). Das ist die Abweichung vom ersten Entwurf, der sie über den
  Editor-Endpunkt auflösen wollte: keine Serveränderung und keine zusätzliche Anfrage.
- Bis die Antwort da ist, zeigt das Feld die bloßen Formnamen, danach wird es einmal neu gefüllt.
- `list_regions` liefert nur aktive Regionen; ein gelöschtes Beispiel fällt still weg.

**Pflege** (`html/landschaften-editor.html`, Fenster „Darstellung", nur Ebene Topographie):
- Abschnitt „Gebirgsformen — Beispiele auf der Karte" mit **drei nativen Auswahlfeldern je Form**; „—"
  nimmt ein Beispiel heraus.
- Keine Chips: das Editor-Blatt kennt keine Chip-Rezeptur, eine neue wäre eine weitere Bauform. Das
  Mockup ist entsprechend nachgezogen.
- Zur Wahl stehen die Gebirge der Topographie aus `list_regions`, nach Namen. Gleichnamige tragen einen
  Unterscheider (die ersten acht Zeichen der Kennung).
- Ein nicht mehr vorhandenes Gebirge bleibt als „(nicht mehr auf der Karte)" stehen, bis jemand es
  herausnimmt.
- Die Seite lädt dafür `map-features-ecosystem-hydrologie.js` (Konstanten und Funktionen, beim Laden keine
  Rechnung). Gegen Namenskollisionen mit ihren übrigen Skripten wacht `darstellung-gebirgsformen.test.js`.
- „Auf Vorgabe zurücksetzen" löscht wie bisher die ganze Tafel. Sind Beispiele gepflegt, **nennt die
  Rückfrage sie beim Namen**.
- Wie beim Rest der Tafel zeigt die Karte eine Änderung erst nach dem nächsten Laden.

**Assets:** `index.html` und `html/landschaften-editor.html` stempelt der Deploy selbst (AGENTS.md §7);
`ASSET_VERSION` gilt nur dem Territorien-Inline-Host.

**Tests** (ausgeführt, nicht gegrept):
- `api/_internal/app/__tests__/ecosystem-display-test.php` §H3: Form, Deckel, Dublette, Name statt
  Kennung, Großbuchstaben, keine Liste, Rundlauf.
- `js/map-features/__tests__/gebirgsform-beispiele.test.js`: die Regel samt alter Schlüssel und Deckelpaar.
  Dazu das Auswahlfeld wirklich gefüllt, vor und nach der Regionsliste, und die Verdrahtung.
- `js/pages/__tests__/darstellung-gebirgsformen.test.js`: Abschnittsliste, Markup vor dem Skript,
  Kollisionsfreiheit, Auswahl, Setzen und Zeichnen mit Attrappen-DOM, Sendekörper, Rückfrage.

**Live, einzeln** (AGENTS.md §9):
1. Tafel + Pflege.
2. Die Beispiele im Auswahlfeld. Solange nichts gepflegt ist, zeigt es genau das Bild von vorher.

## 5. Abnahmeliste

- 💣 Die Vorlage bleibt eine Aktion: das Feld steht nach jedem Füllen auf „—". ✔ getestet.
- 💣 Der Wert jeder Option bleibt der Schlüssel. ✔ getestet.
- 💣 Kein zweites Vokabular der Formen im Server. ✔
- 💣 Zusammenstoßende Namen durch das zusätzliche Skript im Editor. ✔ getestet (25 Skripte, 0).
- ⚠️ Zurücksetzen verliert Beispiele nicht still. ✔ die Rückfrage nennt sie.
- ⚠️ Nach dem Push: die Live-Seite als Besucher laden und die Konsole lesen; den Editor öffnen und den
  Abschnitt sehen.

## 6. Offen

- Die Zuordnung selbst trifft der Owner. Die Wiki-Kandidaten sind nur ein Vorschlag.
- Nebenbefunde, nicht Teil dieses Auftrags: zwei Regionen heißen *Gorische Wüste*; drei „Gebirge"
  heißen *Steineichenwald*, *Nördlicher Steineichenwald*, *Phecanowald*, *Eisenwald*.
