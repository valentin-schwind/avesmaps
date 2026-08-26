# Generische Landschaftsnamen erscheinen nicht auf der Karte

**Stand:** 25.08.2026 · **Anlass:** Owner-Befund — acht Vegetationsflächen tragen auf der
Karte die Beschriftung `Fläche-101` … `Fläche-108`. Owner wörtlich: „landschaften die einen
generischen namen haben, sollten nicht angezeigt werden dürfen. die option ‚Regionname
anzeigen‘ darf nicht aktiviert sein, wenn autoname aktiv ist."

---

## §0 Die Messung — und was sie am Auftrag geändert hat

Einmal gelesen gegen `GET /api/app/ecosystem-areas.php` (25.08.2026, Revision 32918):
1027 Flächen, 1026 Regionen. Namen, die auf `-<Zahl>` enden:

| Name | Regionen | davon mit `label_public_id` | Ebene |
|---|---:|---:|---|
| `See-NNN` | 214 | 46 | Topographie |
| `Insel-NNN` | 132 | 0 | Topographie |
| `Fläche-NNN` | 37 | 22 | alle drei |
| `Wald-NNN` | 24 | 24 | Vegetation |
| `Flussland/Flusstal-NNN` | 13 | 13 | Vegetation |
| `Gebirge-NNN` | 3 | 3 | Topographie |
| **Summe** | **423** | **108** | |

🪤 **Der Auslöser fällt durch die heutige Erkennung.** `isEcosystemRegionAutoName` prüft
`^<Art-Label>-<Zahl>$` — beidseitig verankert, damit „Nebelwald-001" ein echter Name bleibt.
Von den 37 `Fläche-NNN` tragen aber **36 inzwischen eine Art** (18× wald, 10× see,
7× wuestenoase, 1× flussland_flusstal). Bei Art „Wald" passt `Fläche-101` **nicht** auf
`^Wald-\d+$` — der Auto-Name-Haken steht dort heute **leer**. Ein Riegel, der nur an diesem
Haken hängt, hätte genau die acht gemeldeten Flächen **nicht** geheilt.

Wie der Zustand entsteht: die frisch gezeichnete Fläche heißt `Fläche-101` (Art noch leer,
Fallback-Präfix). Wird die Art später auf einem Weg gesetzt, der nicht durch
`syncPropertiesAutoName({regenerate:true})` läuft — Massenzuweisung, Teilung, Import —, bleibt
der Name stehen und ist ab da nach heutiger Regel ein „echter" Name.

⚠️ **Es verschwinden nicht acht Beschriftungen, sondern bis zu 108** — auch 46 `See-NNN` und
24 `Wald-NNN` stehen heute beschriftet auf der Karte. Vom Owner am 25.08.2026 gesehen und
gewollt. Die 108 sind eine **Untergrenze für den Aufwand und eine Obergrenze für die Wirkung**:
gezählt ist nur `label_public_id`; ein Label kann auch über seinen eigenen Rückzeiger an einer
Region hängen. Wie viele der 108 tatsächlich `show_name = 1` tragen, ist ungemessen (die
Vorgabe ist `true`, also vermutlich fast alle).

---

## §1 Die Regel: der Fallback-Präfix ist immer generisch

🔴 **`Fläche-<Zahl>` gilt als Auto-Name, unabhängig von der Art.** `isEcosystemRegionAutoName`
besteht künftig, wenn der Name auf `^<Art-Label>-<Zahl>$` **oder** auf
`^<ECOSYSTEM_AUTO_NAME_FALLBACK>-<Zahl>$` passt.

Begründung: `Fläche` ist kein Art-Label, sondern der Fallback-Präfix des Auto-Namens
selbst (`ECOSYSTEM_AUTO_NAME_FALLBACK`). Ein Name `Fläche-101` kann **nie** ein echter
Landschaftsname sein — er entsteht ausschließlich im Generator. Die beidseitige Verankerung
bleibt unberührt: `Nebelwald-001`, `Wald der Wälder-2` und `Farindel` bleiben echte Namen.

Nebenwirkung, gewollt: die 36 betroffenen Regionen öffnen im Dialog künftig mit **gesetztem**
Auto-Name-Haken und schreibgeschütztem Feld. Das nächste Speichern regeneriert sie zu
`Wald-025` und räumt damit den Altbestand beiläufig auf — dort, wo jemand die Region ohnehin
anfasst.

⚠️ Der Fallback wird **nicht** zusätzlich hartkodiert. Er ist die vorhandene Konstante; wer sie
umbenennt, bewegt beide Hälften der Regel zugleich.

---

## §2 Wo der Riegel steht — und wo er ausdrücklich NICHT steht

🔴 **Die Wahrheit über das Zeichnen bleibt `show_name` am Label.** Gebunden werden die
**Schreibwege**, nicht der Zeichenpfad.

💣 **Ein Riegel in `shouldShowLabelMarker` wäre eine Regel für einen von zwei Betrachtern.**
Der Zeichenpfad kann „ist dieser Name generisch?" gar nicht beantworten: er bräuchte den
**Regionsnamen** und das **Art-Vokabular**, und beides liegt in `ecosystemRegionsByKind` /
`ecosystemRegionTypesByKind` — Listen, die **nachgeladen** werden und außerhalb des
Landschaftsmodus leer sind (dieselbe Falle, die `ecosystem-label-writeback.js:92` bereits mit
„lieber nichts tun" abfängt). Für den Editor mit geladenen Listen hätte der Riegel gegriffen,
für jeden anonymen Besucher nie — und genau dessen Kartenbild war der Anlass. Das ist die
Fehlerklasse, die AGENTS.md mehrfach nennt: eine Regel, die einen von mehreren Erzeugern
bindet, ist keine Regel.

⭐ Damit ist der Einmal-Lauf (§5) **nicht Kosmetik, sondern tragend** — er ist die einzige
Heilung für den Bestand, und er wirkt für jeden Besucher ohne Nachladen, weil
`shouldShowLabelMarker` `show_name === false` längst auswertet
(`map-features-labels.js:796`). Es entsteht keine zweite Wahrheit über die Sichtbarkeit.

---

## §3 Der Dialog: der Haken kann gar nicht mehr falsch stehen

Im Eigenschaften-Dialog der Landschaftsfläche (`syncPropertiesShowName`):

- **Auto-Name gesetzt** ⇒ „Regionname anzeigen" ist `disabled` und `checked = false`,
  mit `title` als Begründung — dasselbe Muster wie Nodix („Erst ‚Regionname anzeigen‘ — ein
  Nodix braucht das Label als Punkt."). Gesperrt statt bloß leer, damit die Sperre **sichtbar**
  ist; so hält es der Auto-Name-Haken selbst bei zugewiesener Wiki-Landschaft.
- 🔴 **Die Gegenrichtung ist Teil der Regel, nicht Zugabe:** geht der Auto-Name-Haken aus
  (die Fläche bekommt einen echten Namen), wird „Regionname anzeigen" **freigegeben und
  vorgehakt**. Ohne das wäre §5 eine stille Falle: der Einmal-Lauf hinterlässt
  `show_name = 0` in der Datenbank, und wer danach `Wald-025` in „Farindel" umbenennt,
  bekäme seinen Namen nicht zurück und fände keinen Hinweis darauf, warum.
- 💣 **Der Riegel gilt beiden Enden.** `syncPropertiesShowName` setzt den Haken beim Öffnen,
  `renameLinkedEcosystemLabel` liest ihn beim Speichern über
  `box && !box.disabled ? … : (label.showName !== false)`. Ein bloß **gesperrter** Haken
  hielte damit den ALTEN Wert fest, statt `false` zu schreiben. Die Speicherstelle muss den
  gesperrten Fall deshalb ausdrücklich als `false` lesen, nicht als „unverändert".
- ⚠️ **Der Haken muss weiter nachziehen, wenn sich die Art ändert** — `syncPropertiesAutoName`
  hängt bereits am `change` von `type` und `autoname`; beide rufen künftig auch
  `syncPropertiesShowName`. Sonst zeigt das Formular nach dem Umschalten einen Zustand, den
  das Speichern gleich widerlegt.

---

## §4 Die Neuanlage: ein Label entsteht unsichtbar

`map-features-ecosystem-draw.js:344` übergibt `createEcosystemRegionLabel(…, showName = false, …)`.

🔴 **Das Label entsteht weiter.** Ort (Point of Inaccessibility), Größe, Zoom-Band und Nodix
sollen beim späteren Einschalten schon dastehen — dieselbe Begründung, aus der der Haken
ausblendet statt zu löschen. Eine frisch gezeichnete Fläche trägt **immer** einen Auto-Namen;
es gibt keinen Fall, in dem `true` hier richtig wäre.

---

## §5 Der Einmal-Lauf über den Bestand

Ein Lauf setzt `show_name = 0` bei jedem Label, dessen Region einen generischen Namen trägt.

🔴 **Der BROWSER entscheidet, der Server führt aus.** Kein SQL-Skript und keine PHP-Fassung
der Regel:

- `show_name` liegt in `properties_json`, nicht als Spalte — ein `UPDATE` bräuchte `JSON_SET`.
- Schlimmer: es bräuchte die Auto-Namen-Regel in SQL oder PHP nachgebaut, samt Art-Vokabular
  je Ebene. Das ist die zweite Wahrheit aus AGENTS.md §5 — dieselbe Begründung, aus der beim
  Wiki-Override der Client sagen muss, was aus dem Wiki kam („die Abbildungen leben nur im
  Browser").
- ⚠️ Auf STRATO gibt es ohnehin kein PHP-CLI (`php85` ist CGI), ein Wartungsskript wäre also
  ein Endpunkt und kein Kommandozeilenlauf.

Also: ein Knopf im Landschaften-Editor. Er zählt mit **derselben** `isEcosystemRegionAutoName`
über die geladenen Regionen und Vokabellisten, zeigt die Zahl samt Aufschlüsselung nach Präfix
und Ebene, und schickt erst auf ausdrückliches Bestätigen die Liste der `label_public_id` an
einen Sammel-Endpunkt, der sie stumpf auf `show_name = false` setzt.

- **Trockenlauf ist der Normalzustand des Knopfes.** Er zeigt zuerst nur die Zahl; das Schreiben
  ist der zweite Klick.
- 💣 **Er muss ALLE Ebenen geladen haben, bevor er zählt** (`ECOSYSTEM_KINDS.map(loadEcosystemRegions)`,
  wie `ecosystem-label-writeback.js:86`). Zählt er auf halb geladenen Listen, meldet er eine zu
  kleine Zahl, und die sieht aus wie ein Ergebnis.
- 💣 **Geprüft wird gegen die Art DIESER Region**, nie gegen ein Muster `-<Zahl>` allein.
  `See-3` bei `region_type = insel` ist ein echter Name; die Messung in §0 hat genau deshalb
  Präfix **und** `region_type` nebeneinandergestellt.
- 💣 **Der Lauf schreibt `show_name`, sonst nichts** — nicht den Namen, nicht die Art, nicht
  den Zeiger. Das Umbenennen zu `Wald-025` (§1) passiert beiläufig im Dialog, nicht in einem
  Serienlauf über 423 Zeilen.
- ⚠️ Er ist **nicht unumkehrbar** im engeren Sinn (ein Haken holt die Anzeige zurück), aber
  er ist ein Massenschreibvorgang auf Livedaten. Deshalb: Zahl, Blick des Owners, dann scharf.

---

## §6 Die Schreibwege — gezählt, nicht geschätzt

`show_name` wird im Client an **vier** Stellen gesetzt, dazu eine Server-Vorgabe:

| # | Stelle | heute | künftig |
|---|---|---|---|
| 1 | `ecosystem-draw.js:490` — Neuanlage | `true` | **`false`** (§4) |
| 2 | `ecosystem-properties.js:1235` — `applyRegionToLabels` | reicht `label.showName` durch | unverändert |
| 3 | `ecosystem-properties.js:1341` — `renameLinkedEcosystemLabel` | liest den Haken | **gebunden** (§3) |
| 4 | `map-features-labels.js:1090` — „Label duplizieren" | erbt vom Original | unverändert |
| 5 | `api/_internal/map/features.php:3070` — `create_label` | `?? true`, wenn nichts mitkommt | unverändert |

💣 **Die Zahl in dieser Tabelle ist die Falle, nicht die Absicherung.** AGENTS.md hält
zweimal fest, dass eine Zahl im Kommentar sich wie eine vollständige Liste liest und deshalb
niemand weitersucht (die Vier-Erzeuger-Falle der Querfeldein-Kanten, 14.08.2026). Also wird
sie **zur Laufzeit geprüft**, nach dem Vorbild von `field-origins-test.php`: ein Test zählt die
Aufrufe, die `show_name: true` absenden, und schlägt an, wenn ein fünfter auftaucht.

⚠️ Stelle 5 ist der stille Weg: ein `create_label` **ohne** `show_name` schreibt `true`.
Deshalb ist Stelle 1 ein ausdrückliches `false` und kein Weglassen.

---

## §7 Tests

- `ecosystem-naming.test.js` — der Fallback-Präfix: `isEcosystemRegionAutoName("Fläche-101", "Wald")`
  ist **wahr**, `("Nebelwald-001", "Wald")` und `("Wald der Wälder-2", "Wald")` bleiben **falsch**.
  Der Fall `("Fläche-101", "")` (Art noch leer) bleibt wahr wie bisher.
- `ecosystem-properties-sperre.test.js` — beide Richtungen: Auto-Name an ⇒ Haken gesperrt und
  leer; Auto-Name aus ⇒ Haken frei und vorgehakt. Dazu die Speicherstelle: gesperrter Haken
  schreibt `false`, nicht „unverändert".
- Neu: der Schreibwege-Zähler aus §6.
- Ein Test für §4 (Neuanlage sendet `show_name: false`).
- Für den Sammel-Endpunkt aus §5: er schreibt ausschließlich `show_name` und rührt Name, Art
  und Zeiger nicht an — und er zählt auf halb geladenen Listen nicht.

---

## §8 Offen

- 🔧 **Wie viele der 108 tatsächlich `show_name = 1` tragen**, ist ungemessen — das beantwortet
  der Trockenlauf aus §5 als Erstes.
- 🔧 **Der Blick im Browser** auf Dialog und Karte nach dem Bau (Handgriffe, nicht Maßtabellen:
  Fläche zeichnen · Art setzen · umbenennen · Haken beobachten).
- ⚠️ **Labels über den eigenen Rückzeiger** (`ecosystem_region_public_id`) statt über
  `label_public_id` sind in §0 nicht mitgezählt. Der Trockenlauf muss sie einschließen, sonst
  bleiben Beschriftungen stehen, die niemand in der Zahl erwartet hat.
