# Kulturlandschaft — die elfte Vegetationsart

**Anlass:** Idee #77 (smyrrn, 16.08.2026, Discord): „Einführung einer neuen Vegetations-Kategorie zum
Hervorheben von Regionen, die stark landwirtschaftlich genutzt werden/von Menschen (anderen
Kulturschaffenden) geprägt worden sind."

**Owner-Entscheide 16.08.2026:**
- Der Name ist **„Kulturlandschaft"** (aus smyrrns drei Vorschlägen; „Agrarfläche" klingt nach
  Behörde, „Ackerland" schlösse die Wingerte aus, die im selben Gespräch genannt wurden).
- **Kein Reisenachteil.** Wörtlich: „normal, querfeldein is immer bisschen langsamer … nur nicht so
  wie wald oder dschungel, passt."

---

## 1. Was gebaut wird

Eine neue Zeile im Artenvokabular: Ebene `vegetation`, Schlüssel `kulturlandschaft`, Beschriftung
„Kulturlandschaft", `sort_order` 110. Alles Weitere ist die Folge davon — die Art muss überall
auftauchen, wo die zehn bestehenden Vegetationsarten auftauchen.

🪤 **Sie startet leer.** Wie `inselgruppe` (2026-07-30) wird kein Bestand umgeschlüsselt; die Flächen
zeichnen die Editoren danach von Hand. Das Wiki kennt keine passende „Art" (geprüft gegen das
Art-Verzeichnis in `api/_internal/wiki/regions.php`: kein Acker-, Agrar-, Feld-, Weide- oder
Weinbegriff), es kommt also auch über den Abgleich nichts herein.

## 2. Das Reisen — und warum dafür KEINE Zeile Code nötig ist

`terrain_speed_factor` bleibt **NULL**, und NULL heißt an dieser Spalte ausdrücklich „keine eigene
Aussage". `avesmapsOffroadLoadFactorPlane` (`api/_internal/routing/offroad-data.php:116-123`) lädt nur
Arten mit `terrain_speed_factor IS NOT NULL AND > 0 AND < :base` — eine Art ohne Wert legt also gar
keine Bremsebene an, und die Zelle bleibt auf offenem Boden (0,75 gegen die Straße). Das IST das
gewünschte „normal".

💣 **Nicht in die GA-Tafel eintragen.** `avesmapsTravelValuesSourceTable()['landscapes']`
(`travel-values.php`) zitiert die Geographia Aventurica S. 120–123. Die Quelle kennt keine
Kulturlandschaft; eine 0,75 dort behauptete eine Quellenzeile, die es nicht gibt — genau der Grund,
aus dem Küste und Flussland dort fehlen (`travel-values.php:552-554`).

⚠️ **Im Fenster „Tempowerte" erscheint die Art von selbst**, mit „—" in der Quellenspalte:
`avesmapsTravelValuesReadLandscapes` liest alle aktiven Arten der Geländeebenen aus der Datenbank.
Wer ihr später doch einen eigenen Wert geben will, tippt ihn dort ein — ohne Code.

⚠️ Die einmalige Migration `avesmapsTravelValuesMigrateOnce` ist längst gelaufen (Riegel
`app_setting['travel_values_v1']`) und rührt die neue Zeile nicht mehr an. `offroad_factor` (die
ungelesene V11-Spalte) bleibt auf ihrer Vorgabe 1,00.

🪤 **Und der Widerspruch, der auffallen wird:** der Seed-Kommentar begründet die Abwesenheit von
`ebene` damit, dass „kein Reisefaktor sie von ‚normal' unterscheidet". Nach diesem Satz dürfte die
Kulturlandschaft nicht kommen. Der Satz war zu eng: er beschreibt, warum eine Art **ohne jede eigene
Aussage** keine Zeile bekommt. Die Kulturlandschaft hat eine — sie sagt, dass Menschen dieses Land
geprägt haben, und das ist Auskunft für Infobox, „Was ist hier?", die Lebensräume der Vorkommen und
das Kartenbild. Der Kommentar bei `ebene` wird entsprechend nachgezogen.

## 3. Das Aussehen

| Wo | Wert | Warum |
|---|---|---|
| Fläche | `--color-ecosystem-vegetation-kulturlandschaft: #a9a14c` | Mattes Oliv-Gold (reifes Getreide). Deutlich dunkler und stumpfer als die Wüste `#e0c74e`, damit die beiden auf der Karte nie verschwimmen, und wärmer als Steppe `#a8bd8a` und Graslandschaft `#8fbf6a`. |
| Beschriftung | `.map-label--kulturlandschaft span { color: #d9d18d }` | Heller Ton im Stil der Nachbarn, eine Spur tiefer und wärmer als das Strohgelb der Steppe `#e3e2a4`. |
| Label-Stil | `{ size: 16, minZoom: 3 }` | Zwischen Wald (15 / Zoom 4) und Steppe (18 / Zoom 2): ein Ackergürtel schmiegt sich an Siedlungen und Flüsse, er zieht sich nicht über eine Steppenweite, ist aber mehr als ein Waldstück. |

💣 **Ohne das Farbtoken fällt `ecosystemAreaColor()` auf den Ebenenton `--color-ecosystem-vegetation`
zurück** — jede Kulturlandschaft sähe dann aus wie eine namenlose Vegetationsfläche.

## 4. Die Stellen

| # | Datei | Was | Wenn sie fehlt |
|---|---|---|---|
| 1 | `api/_internal/app/ecosystem.php` | Seed-Zeile | Die Art existiert nicht |
| 2 | `api/_internal/map/features.php` | `$allowedSubtypes` | 400 beim Speichern des Labels — die Fläche trüge die Art, ihr Name dürfte sie nicht tragen |
| 3 | `css/base/tokens.css` | Flächenfarbe | Fällt auf den Ebenenton zurück |
| 4 | `css/features/map-labels.css` | Beschriftungsfarbe | Erbt den Standardton |
| 5 | `js/map-features/map-features-ecosystem-draw.js` | Label-Stil | Fällt auf 18 / Zoom 2 zurück (wie „Region") |
| 6 | `index.html` | `<option>` im Label-Editor (alphabetisch zwischen Kontinent und Küste) | Ein Editor kann die Art am Label nicht wählen |
| 7 | `api/app/report-location.php` | `AVESMAPS_REPORT_TYPES` | Eine Meldung dieser Art wird abgewiesen |
| 8 | `js/app/i18n-en.js` | `spotlight.labelType.kulturlandschaft` = „Farmland" | `?lang=en` zeigt den Schlüssel |
| 9 | `js/ui/spotlight-search.js` | Trefferbeschriftung | Die Suche sagt „Label" statt „Kulturlandschaft" |
| 10 | `js/review/review-panels.js` | Beschriftung im Meldungs-Reiter | Zeigt den rohen Schlüssel |

**Bewusst NICHT dabei:**
- Die dritte Auswahlstufe des SVG-Exports (`edit/svg-export.php`) — 🪤 die Liste ist eine **am
  Livebestand gemessene Momentaufnahme** und führt nur Arten, die es dort wirklich gibt (Dschungel und
  Tundra fehlen aus genau diesem Grund, absteigend nach Flächenzahl sortiert). Eine Art mit null
  Flächen gehörte als „0" hinein und behauptete etwas Exportierbares.
  🔧 **Sobald die ersten Kulturlandschaften gezeichnet sind**, gehört sie dort hinzu — zusammen mit
  den anderen Zahlen, die dann ohnehin nachgemessen werden müssen.
- Der Melde-Dialog der Besucher (`#location-report-type` in `index.html`) — seine Liste ist kurz
  gehalten und kennt auch Dschungel, Wüstenoase und Flussdelta nicht. Dieselbe Entscheidung wie bei
  den letzten drei Arten.
- `INFO_HEADER_IMAGE_BY_ART` (`js/ui/popups.js`) — die Kopfbilder sind Owner-Grafiken, und für eine
  Kulturlandschaft gibt es keine. Ohne Eintrag bleibt der Kopf einfach bildlos.
  🔧 **Owner:** wenn irgendwann eine Grafik da ist, ist das eine Zeile.
- `api/_internal/wiki/regions.php` — siehe §1, das Wiki kennt die Art nicht.
- `api/_internal/routing/travel-values.php` — siehe §2, und die Datei gehört gerade einer anderen
  Sitzung.

## 5. Prüfung

- `api/_internal/app/__tests__/ecosystem-geometry-test.php`: Saatzahl 34 → **35**, Vegetation 10 →
  **11**. Die Zahl soll wandern, wenn eine Art absichtlich dazukommt — sie wacht dagegen, dass eine
  verschwindet.
- Dieselbe Datei prüft schon von sich aus, dass jeder Saat-Schlüssel ein echter Label-Subtyp ist
  (`avesmapsReadLabelSubtype($typeKey) === $typeKey`) — sie fängt Stelle 2, wenn man sie vergisst.
- Neue Zusicherung: die Kulturlandschaft steht in der Vegetation und **nicht** in einer der drei
  anderen Ebenen.
- `terrain-speed-factor-test.php` baut seine eigene Artenliste und bleibt unberührt. Seine Zusicherung
  `count($plan['factors']) === 20` ist ausdrücklich „die Stelle, an der jemand über den Wert einer
  neuen Art nachdenkt" — hier nachgedacht und in §2 begründet: kein Wert.
- Vor dem Push das **ganze** Testfeld in der CI-Fassung (AGENTS.md §9 plus `tools/wikidump/test-*.php`).
