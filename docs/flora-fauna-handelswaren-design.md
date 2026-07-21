# Flora, Fauna & Handelswaren — Design

**Stand:** 2026-07-21 · **Status:** spezifiziert, noch nicht gebaut

Ziel: Wer auf der Karte eine **Region** (Weiden), eine **Siedlung** (Trallop)
oder ein **Herrschaftsgebiet** (Grafschaft Heldentrutz) anklickt, sieht im
Infopanel, welche Pflanzen und Tiere dort vorkommen und welche Waren dort
gehandelt werden — jeweils mit Wiki-Link und Quellenangabe.

Vorbild in Aufbau und Ablauf ist das **Abenteuer-Feature**
(`docs/abenteuer-feature-design.md`): Dump-Phase → Staging → owner-getriggerter
Reconcile → Katalog + Verknüpfungstabelle → Infopanel-Sektion → Editor.

---

## 1. Datenlage (am Dump verifiziert, 2026-07-21)

💣 **Die Wiki-Unterseiten `X/FloraFauna` und `X/Handelsware` sind LEER.** Ihr
kompletter Wikitext ist `{{Liste FloraFauna}}` bzw. `{{Liste Handelsware}}` —
DPL-Abfragen, die das Wiki bei jedem Seitenaufruf live rechnet. Im Dump steht
dort nichts. Sie zu parsen liefert 268 × nichts.

Die Daten stehen in den **Einzelartikeln**, in vier Infoboxen:

| Infobox | Ortsfeld(er) | kind |
|---|---|---|
| `Infobox Tierart` | Verbreitung | `fauna` |
| `Infobox Pflanzenart` | Verbreitung | `flora` |
| `Infobox Spezies` | Regionen | `spezies` |
| `Infobox Gegenstandsgruppe` | Herkunft, Verbreitung | `ware` |

Die Orte stehen dort als echte Wikilinks, also maschinenlesbar:

```
|Verbreitung=[[Mittelaventurien]]s, vor allem [[Streitende Königreiche]],
             [[Nord-Gratenfels]], [[Albernia]], [[Weiden|Weiden]], …
```

**Prototyp-Ergebnis** (voller Dump-Scan, 202.897 Seiten in ns 0):

| kind | Einträge | mit Ortsangabe | Quellen | ohne Quelle |
|---|---:|---:|---:|---:|
| fauna | 1.382 | 1.202 | 9.928 | 4 |
| flora | 1.004 | 880 | 5.510 | 2 |
| spezies | 187 | 175 | 4.847 | 0 |
| ware | 2.531 | 1.285 | 14.648 | 4 |
| **Σ** | **5.104** | **7.746 Verknüpfungen** | **34.933** | **10** |

**Abnahmetest:** Für Weiden liefert der Scan 19 Fauna (namentlich dieselben wie
das Wiki), 10 Flora, 4 Spezies. Die Wiki-Seite nennt „14 Artikel, 10 angezeigt"
bzw. „7 Artikel, 4 angezeigt" — DPL zählt alle Artikel mit `linksto`, zeigt aber
nur die mit Treffer im Verbreitungsfeld (`includematch`). Wir bilden die
angezeigte Menge nach, und das ist die richtige.

---

## 2. Datenmodell

Drei Tabellen, inline-DDL wie im Rest des Projekts.

### `lore_entry` — der Katalog (eine Zeile je Wiki-Artikel)

| Feld | Zweck |
|---|---|
| `wiki_key` UNIQUE | Join-Schlüssel (Slug des Titels) |
| `wiki_title`, `wiki_url` | Rücklink ins Wiki |
| `name`, `match_key` | Anzeige + Suche |
| `kind` | fauna \| flora \| spezies \| ware |
| `gruppe` | Feld *Art* (`Hirsch`, `Gras`, `profan`) |
| `typ` | Feld *Gegenstandstyp* (nur Ware) |
| `lebensraum` | Feld *Vorkommen* — Lebensraum, **kein Ort** |
| `synonyme` | *Weitere Namen* / *Beinamen* |
| `merkmale_json` | typspezifischer Rest (Größe, Auftreten, Blütezeit, Erzeugnisse, Material, …) |
| `image_url`, `image_license_status`, `image_author`, `image_attribution` | Bild + Lizenz |
| `origin`, `status` | wiki \| manual · active \| suppressed |
| `raw_json`, `synced_at`, `created_at`, `updated_at` | |

Typspezifische Felder gehen bewusst nach `merkmale_json`: Blütezeit gibt es nur
bei Pflanzen, Waffengruppe nur bei Waren. Als Spalten wäre das eine Tabelle mit
90 % NULL.

### `lore_place` — Eintrag ↔ Ort

| Feld | Zweck |
|---|---|
| `entry_wiki_key` | → `lore_entry` |
| `place_wiki_key`, `place_title`, `place_wiki_url` | das Linkziel |
| `place_kind` | region \| settlement \| territory \| kontinent \| landschaftstyp \| unknown |
| `relation` | verbreitung \| vorkommen \| herkunft \| regionen |
| `origin`, `status` | Handkorrekturen überleben den Re-Sync |

UNIQUE(`entry_wiki_key`, `place_wiki_key`, `relation`).

`relation` ist nicht kosmetisch: Bei Waren heißt *Herkunft* „stammt von dort",
*Verbreitung* „wird dort gehandelt". Das gehört in der Anzeige getrennt.

### `lore_source` — Eintrag ↔ Publikation

Felder `entry_wiki_key`, `publikation`, `publikation_wiki_url`,
`reference_kind` (ausfuehrlich \| ergaenzend \| erwaehnung), `pages`, `note`.

Der Parser ist **nicht neu zu schreiben**:
`avesmapsWikiParsePublicationsSection()` (`publication-parsing.php:75`) leistet
genau das. Damit passen die Daten ohne Umweg ins bestehende
`sources`/`feature_sources`-System mit `origin='wiki_publication'`.

---

## 3. Sync

Zweistufig, exakt wie Abenteuer und Kartensammlung:

1. **Dump-Phase `lore_entries`** im Hybrid-Treiber
   (`dump-hybrid-driver.php`), Handler in `dump-entity-scan.php`. Schreibt
   **nur Staging**. Erkennung ausschließlich über den Infobox-Namen
   (Invariante **O4**).
2. **Owner-Aktion `sync_lore`** — reconciled Staging → Produktion,
   override-safe: schreibt und löscht ausschließlich `origin='wiki'`;
   manuelle und suppressed Einträge bleiben unangetastet; idempotent.

🪤 **Niemals nach dem Feld `Art` filtern.** Bei den Abenteuern hat genau so eine
Weiche ~430 Einträge verschluckt (siehe `wiki-art-gate-missing-adventures`). Hier
ist sie überflüssig, weil jeder der vier Typen seine **eigene** Infobox hat.

---

## 4. Auflösung: Region, Siedlung, Herrschaftsgebiet

Die Ortsfelder im Wiki mischen **zwei Achsen**, und beide werden gebraucht. Beim
Amazonensäbel stehen nebeneinander `[[Albernia]]`, `[[Weiden]]` (derographische
Regionen) und `[[Horasreich]]`, `[[Kalifat]]`, `[[Tulamidenlande]]` (politische
Gebilde). Wer nur eine Achse auswertet, verliert die andere.

### Achse A — derographisch (Region)

Jede Entität nennt ihre Region selbst, kein Raten, keine Geometrie:

| Entität | Infobox | Feld |
|---|---|---|
| Region Weiden | `Infobox Region` | ist selbst das Ziel |
| Siedlung Trallop | `Infobox Siedlung` | `\|Region=[[Weiden]]` |
| Grafschaft Heldentrutz | `Infobox Staat` | `\|Region=[[Weiden]]` |

Das ist wesentlich, weil Karten-Regionen nur **Label-Punkte ohne Fläche** sind —
ein geometrisches „liegt in" gäbe es gar nicht.

**Zu tun:** Territorien parsen das Feld bereits (als `Geographisch`,
`sync-monitor-parsing.php:531`). **Siedlungen nicht** — dort muss `Region` ins
Staging ergänzt werden.

### Achse B — politisch (Territorienkette per Raycast)

Der Weg, den das Abenteuer-Feature bereits geht (`adventure-resolve.php:288`ff):

1. Eine Siedlung trägt in `map_features.properties_json` ein
   **`territory_wiki_key`** — das Ergebnis des Point-in-Polygon-Laufs
   (`map-features-settlement-territory-assign.js`, tiefstes Territorium).
2. Von dort die Ahnenkette hoch: Stadtmark Trallop → Herzogtum Weiden →
   Mittelreich.
3. Für jedes Glied der Kette Lore-Einträge einsammeln und vereinigen.

Ein Herrschaftsgebiet startet direkt bei sich selbst; die Region-Zeile aus
Achse A kommt hinzu.

⚠️ **KERN-INVARIANTE:** Die Ahnenkette läuft **ausschließlich über
`parent_wiki_key`** (aus `wiki_territory_model`), **niemals über
`affiliation_path`**. Das ist im Projekt bereits mehrfach schiefgegangen.

### Tiefe: nicht alles einsammeln, sondern nach Ebene gruppieren

Läuft die Kette ungebremst hoch, erbt Trallop irgendwann alles vom Mittelreich —
und über die Regionsachse alles von `[[Aventurien]]` (1.166 Einträge). Deshalb:

- **Kontinente werden verworfen** (`Aventurien`, `Myranor`, `Uthuria`,
  `Rakshazar`) — `place_kind='kontinent'`.
- Die Ergebnisse werden **nach Ebene gruppiert** ausgegeben, nie zu einer Liste
  vermengt: „in Weiden" zuerst, „im Herzogtum Weiden" und „in Mittelaventurien"
  darunter, eingeklappt. So bleibt sichtbar, wie spezifisch eine Angabe ist.

**Zusatzquelle:** `Infobox Staat` trägt ein eigenes Feld
`|Handelswaren=[[Schaf]]s[[wolle]], [[Salz]]`. Das ist präziser als die generische
Waren-Verbreitung und sollte mitgenommen werden — 💣 aber Vorsicht:
`[[Schaf]]s[[wolle]]` ist **ein** Wort aus **zwei** Links. Naive Linkextraktion
macht daraus „Schaf" und „wolle".

---

## 5. Anzeige (Infopanel)

Drei Sektionen, nur wenn nicht leer, jeder Eintrag mit Wiki-Link und `↗`:

```
Pflanzen in Weiden
  Wirselkraut · Roggen · Tanne …

Tiere in Weiden
  Kronenhirsch · Griswolf · Silberlöwe …

Handelswaren in Weiden
  Schwere Armbrust · Salz …
```

Regeln: Design-Sprache aus `docs/design-language.md` (Trenner statt Kästen,
`--color-link`, kein Blau). Bei sehr langen Listen einklappen. Quellen als
Fußnote wie im Mehrquellen-System. Einträge der **Oberregion** (Mittelaventurien
→ Weiden) getrennt ausweisen, nie untermischen — sonst erbt über
`Aventurien` jede Region alles.

---

## 6. Editoren

Drei Listen unter **Materialien**, aufgebaut wie der Abenteuer-Editor
(`docs/abenteuer-editor-ui-spec.md`): **Fauna**, **Flora**, **Waren**. Je Eintrag
die Ortsliste mit Hinzufügen/Entfernen, Ort-Autocomplete, Tombstones für
unterdrückte Wiki-Einträge, `origin`-Anzeige. Spezies laufen in der Fauna-Liste
mit (eigene `kind`-Spalte, kein vierter Editor).

---

## 7. Bauabschnitte

| # | Inhalt | Ergebnis |
|---|---|---|
| **1** | Schema + Dump-Phase + Reconcile | Daten in der DB, per Owner-Aktion aktualisierbar |
| **2** | Read-Endpoint + Client-Index + Infopanel | **sichtbar** — Klick auf Weiden zeigt Listen |
| **3** | Siedlung + Herrschaftsgebiet auflösen | Trallop und Heldentrutz zeigen dasselbe |
| **4** | Die drei Editoren | pflegbar |

Abschnitte 1–3 sind ein vertikaler Schnitt und ergeben zusammen das nutzbare
Feature; die Editoren sind ohne Daten wertlos und kommen deshalb zuletzt.

---

## 8. Fallen

- 💣 **DPL-Seiten sind leer** — siehe §1. Nie `X/FloraFauna` parsen.
- 💣 **`place_kind` ist Pflicht.** In den Ortsfeldern steht nicht nur, was man
  erwartet: `Ork` listet `[[Thorwal (Siedlung)]]` (eine Siedlung), `Kronenhirsch`
  hat als *Vorkommen* `[[Wald]]` (ein Landschaftstyp), und `[[Aventurien]]`
  (1.166 ×), `[[Myranor]]` (341 ×), `[[Uthuria]]` (66 ×) sind Kontinente. Nur ein
  Abgleich gegen die bekannten Regionen/Siedlungen trennt das.
- ⚠️ **Negationen gehen verloren.** `ganz [[Aventurien]] außer Ewiges Eis und
  Wüste` — die Ausnahme ist nicht verlinkt. Das Wiki hat denselben Fehler in
  seinen eigenen Listen; wir werden nicht schlechter als die Quelle, aber auch
  nicht besser.
- ⚠️ **`note` trägt Rohmarkup** (`{{R5}}`, `[[Firun wählt]]`) — identisch zum
  bestehenden PHP-Parser, muss vor der Anzeige gesäubert werden. `{{R5}}` benennt
  die Regeledition und wäre als eigenes Feld nützlich.
- ⚠️ **Bilder erst nach Lizenzklärung anzeigen.** Beim Kronenhirsch steht
  „inoffizielle Illustration" — dieselbe Frage wie bei den Wappen
  (`coat-public-domain-policy`). Spalten jetzt mitnehmen, Anzeige später.
- ⚠️ **Waren sind dünner, als die Zahl verspricht.** Von 2.531 tragen nur 883
  eine Verbreitung und 402 eine Herkunft — rund die Hälfte hat gar keinen Ort und
  taucht auf der Karte nie auf.
- ⚠️ **`Art` ist unzuverlässig als Klassifikation.** Nur 33 Pflanzen tragen
  `Art=Kraut`; Bingelkraut und Eisenkraut sind anders einsortiert. Für Filter
  taugt das Feld nur bedingt.

---

## 9. Prototyp

Der verifizierende Scan liegt außerhalb des Repos (Scratchpad, kein Dump im
Repo — `docs/repository-data-policy.md`). Er erzeugt `lore_entry.csv`,
`lore_place.csv`, `lore_source.csv` und portiert den Publikations-Parser 1:1 nach
Python. Er ist die Referenz für den späteren PHP-Handler: Parse-Regeln, DPL-Logik
und Abnahmezahlen sind daran an echten Daten geprüft.
