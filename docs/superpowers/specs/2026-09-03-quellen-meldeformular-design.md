# Quellen im Meldeformular der Community — der Link ist die Quelle, der Korpus bleibt bei uns

**Stand:** Entwurf 03.09.2026 abends, nach dem Abschluss der Schritte 1–5 des Quellen-Umbaus.
**Owner-Auftrag (03.09.2026):** „das meldeformular der community! … das müssen wir als erstes
nachziehen und an das neue system anpassen. sowohl änderungen als auch neue vorschläge müssen das mit
dem link machen. ich will allerdings nicht, dass externe nutzer was am korpus machen — die sollen
einfach den link pasten. erst wir im backend sollen sehen, ob der korpus passt oder ein neuer erkannt
wurde."
**Mockup:** `docs/quellen-meldeformular-mockup.html` (VERTRAG bindet die neuen Regeln in
`css/components/location-report-dialog.css`).

---

## 1 · Der Befund, gemessen

### 1.1 Was der Melder heute ausfüllt

Das Meldeformular (`#location-report-form` in `index.html`, Logik in `js/review/review-locations.js`,
Absenden in `js/review/review-report-flow.js`) trägt seit dem 11.07.2026 (Teilprojekt 3 des
Mehrquellen-Systems) eine **eigene** Quellenliste — gebaut, bevor es das eine Quellen-Bauteil gab.
Je Quelle **sechs Eingaben**:

| Feld | Pflicht | Wem das Feld eigentlich gehört |
|---|---|---|
| Quellenname (mit Katalog-Vorschlägen, 5a) | ja | dem Katalog (`sources.label`) |
| Seite(n) | nein | dieser Fundstelle ✓ |
| Art (8 Werte, Vorgabe „Sonstiges") | — | dem **Korpus** |
| Link | nein | der Identität der Quelle (`url_hash`) |
| Abdeckung (ausführlich / ergänzend / Erwähnung) | nein | der Redaktion |
| ☐ offiziell | — | dem **Korpus** / dem Kanon |

Vier der sechs Felder sind seit dem 01./02.09.2026 Eigenschaften des Korpus oder eine
redaktionelle Einstufung. Der Melder entscheidet damit heute Dinge, die der Owner ausdrücklich bei
uns halten will — und er entscheidet sie ohne Wissen: die Art steht auf „Sonstiges", der Haken
„offiziell" ist eine Meinung.

### 1.2 Wo es hinführt (Livebestand, 03.09.2026, `GET api/edit/reports/locations.php?filter=alle`)

| | |
|---|---|
| offene Meldungen | **8** (6 Änderungswünsche, 2 neue Vorschläge) |
| davon mit Quellen | **2** |
| Quellenzeilen | 2 — **beide ohne Link, beide vom Melder als „offiziell" markiert** („Von Eigenen Gnaden", Sonstiges · „Der Grüne Zug (2016)", Abenteuer) |

Zwei Zeilen sind keine Statistik, aber sie zeigen den Fall exakt: ohne Link kann keine Zeile in den
Katalog (Identität ist `url_hash`), und der Haken „offiziell" würde beim Anlegen einer NEUEN
Katalogzeile durchgeschrieben (`avesmapsSourceOfficialWriteAllowed`: neue Zeile → ja).

### 1.3 Der Annahmeweg heute

- **Ort / Beschriftung** (Client, `review-editor-submit.js` → `linkCommunityReportSource`,
  `review-feature-sources.js`): jede gemeldete Quelle **mit Link** geht als `add` an
  `POST api/edit/map/feature-sources.php` — mit `source_type` und `is_official` **aus dem
  Meldeformular**; ein gepickter Katalogtreffer (`source_id`) als `add_existing`. Link-lose Zeilen
  fallen in die Beschreibung („Quelle: X, S. Y") und sind damit keine Quelle mehr.
- **Stadtkarte** (Server, `avesmapsCreateCitymapFromReport` in `api/edit/reports/locations.php`):
  dasselbe über `avesmapsAddFeatureSource(…, $type, $official, …)`, Art und offiziell aus der
  Meldung.
- Der Korpus spielt an **keiner** dieser Stellen mit: die Korpuswerte (Art, Lizenz, Nennung,
  offiziell) kommen heute nur über die Eingabezeile des Editors in eine neue Zeile — dort füllt der
  Client sie aus der Auskunft `inspect_url` vor. Eine aus einer Meldung angelegte Zeile eines
  bekannten Wirts (z. B. `garetien.de`) stünde als „Sonstiges, inoffiziell, ohne Lizenz" im Katalog.
- Die Review-Karte (`review-panels.js`) zeigt die Quellen als **eine Textzeile**
  („Name (S. 12); Name2 · gemeldet von X") — ohne Link, ohne Katalog- oder Korpusstand.

### 1.4 Zwei Formulare, ein Eingang

| Formular | Datei | Quellenfelder |
|---|---|---|
| „Karteneintrag melden" (neu) und „Änderung vorschlagen" (Änderung) | `index.html` + `review-locations.js` | die sechs oben, Liste mit „+ Quelle hinzufügen" |
| „Karte vorschlagen" (Stadtkarten) | `js/map-features/map-features-citymaps-suggest.js` | Quelle (Pflicht, Name), Link, Seite(n), Art, ☐ offiziell — **genau eine** Quelle |

Beide gehen durch `api/app/report-location.php` (`avesmapsNormalizeReportSources`) in
`map_reports.sources_json` (bzw. `location_reports`). „Fundort melden" trägt Karten-Links, keine
Quellen, und bleibt draußen.

### 1.5 Nebenbefund: acht Beschriftungen des Formulars haben keinen englischen Text

`report.sectionSources`, `report.sourcesLabel`, `report.sourceNamePlaceholder`,
`report.pagesPlaceholder`, `report.sourceUrlPlaceholder`, `report.sourceOfficialLabel`,
`report.sourceAdd`, `report.sectionMore` stehen als `data-i18n` im Markup und fehlen in
`js/app/i18n-en.js`. Unter `?lang=en` bleibt der Block deutsch. Der Umbau tauscht die Zeilen ohnehin
aus — die neuen Schlüssel kommen in die Tabelle (AGENTS.md §8).

---

## 2 · Die Regeln

1. 🔴 **Der Link IST die Quelle.** Je Quelle gibt der Melder den **Link** an (Pflicht) und die
   **Seite(n)** (optional). Sonst nichts: kein Name, keine Art, keine Abdeckung, kein „offiziell".
   Was die Adresse ist, entscheidet der Katalog; wem sie gehört, der Korpus; wie sie zählt, die
   Redaktion.
2. 🔴 **Externe fassen den Korpus nicht an — und sehen ihn nicht.** Das Formular kennt keinen
   Korpus: keine Vorbelegung, kein Name, keine Anlage. Der Melder sieht höchstens, dass wir eine
   Adresse **schon kennen** (Katalogtreffer) — das steht ohnehin öffentlich in der Kartennutzlast.
3. 🔴 **Die Erkennung passiert bei uns, beim Sichten.** Der Review-Endpunkt hängt an jede gemeldete
   Quelle eine `pruefung`: Katalogstand (bekannt/neu), Korpus (bekannt: Name · neu: Wirt) — lokal
   gerechnet, ohne Abruf nach draußen.
4. 🔴 **Die Annahme legt neue Katalogzeilen mit den Korpuswerten an.** Ist der Wirt ein bekannter
   Korpus, bekommt eine NEUE Zeile Art, Lizenz, Nennung und Kanon vom Korpus — serverseitig, für
   JEDEN Aufrufer des Eintrage-Wegs. Ist er unbekannt, entsteht eine Zeile ohne Korpuswerte, und die
   Review-Karte sagt es („neuer Wirt"): das Anlegen eines Korpus bleibt eine bewusste Handlung des
   Editors über die vorhandene Eingabezeile.
5. **Ein Werk ohne Adresse bleibt erreichbar** — über die Vorschlagsliste des Katalogs (5a): wer
   „Die Flusslande" tippt und den Treffer nimmt, meldet die Katalogzeile (`source_id`). Das ist der
   einzige Weg, auf dem ein Name ohne Link noch eine Quelle sein kann; alles andere ohne Link wird
   nicht angenommen.
6. **Beide Formulare, ein Eingang, eine Regel.** Das Meldeformular (neu und Änderung) und der
   Kartenvorschlag bekommen dieselbe Zeile; `avesmapsNormalizeReportSources` verlangt Link ODER
   `source_id` und verwirft, was der neue Client gar nicht mehr schickt (`official`, `type`,
   `reference_kind`) — auch von einem alten, zwischengespeicherten Client.

---

## 3 · Die Fläche des Melders

### 3.1 Die Zeile

```
Ich habe folgende Quellen
┌──────────────────────────────────────────────────────────┬──────────┐
│ Link einfügen — oder Titel tippen und aus dem Katalog    │ Seite(n) │  [+ Quelle hinzufügen]
│ wählen                                                    │          │
└──────────────────────────────────────────────────────────┴──────────┘
✓ Kennen wir schon: „Geographia Aventurica"          ← nur bei Katalogtreffer
```

- **EIN Textfeld** (`#report-source-ref`), kein `type="url"`: es nimmt eine Adresse **oder** einen
  Titel. Beginnt der Wert mit `http`, ist es ein Link; sonst läuft die Vorschlagsliste des Katalogs
  (`attachSourceAutocomplete`, unverändert), und ein Treffer wird zur Zeile mit `source_id`.
  ⚠️ Ein Titel **ohne** Treffer ist keine Quelle: „+ Quelle hinzufügen" lehnt ab, mit dem Satz
  „Bitte den Link zur Quelle einfügen — oder einen Titel aus der Liste wählen."
- **Seite(n)** wie heute (`#report-source-pages`, 120 Zeichen).
- **Die Erkennung unter dem Feld** (`.report-sources__state`): beim Einfügen einer Adresse schlägt
  der Client in `window.__sourceCatalog` nach (öffentlich, reist mit der Kartennutzlast, 1.080 von
  1.438 Zeilen tragen eine Adresse). Treffer → „✓ Kennen wir schon: „Titel"". Kein Treffer → kein
  Satz. 💣 **Kein Korpus, kein Wirtname, keine Lizenz** — auch nicht als Hinweis. Der Satz sagt nur,
  dass die Seite bekannt ist.
- **Die Liste** der hinzugefügten Quellen zeigt je Zeile: Link (ellipsiert, ↗) oder den gepickten
  Titel, Seiten, ✕. Kein Sternchen mehr, kein Typ, keine Abdeckungs-Pille.
- **Pflicht** wie heute: mindestens eine Quelle bei einem neuen Vorschlag (außer Kommentar/Fundort);
  im Änderungsmodus **optional** — ein korrigierter Tippfehler braucht keine. 🔧 Owner-Frage in §8.
- Die Beschriftung des Abschnitts wird ehrlich: „Quellen * — Link zur Seite, in der es steht
  (Wiki-Artikel, F-Shop, Fanwiki)".

### 3.2 Der Kartenvorschlag

Dieselbe Zeile ersetzt die vier Felder „Quelle / Link / Art / offiziell": **ein** Feld „Link zur
Quelle (oder Titel aus dem Katalog)" (Pflicht) + „Seite(n)". Der Erklärsatz „Wo die Karte erschienen
ist — nicht, wer sie gezeichnet hat" bleibt, weil er eine andere Verwechslung abfängt. Es bleibt bei
genau einer Quelle je Kartenvorschlag.

### 3.3 Was reist

`sources[]` je Zeile: `{ url, pages, source_id, label }` — `label` nur aus einem Katalogtreffer
(damit die Review-Karte den Titel zeigen kann, ohne nachzuschlagen), sonst leer. `type`, `official`,
`reference_kind` schickt der neue Client nicht mehr.

---

## 4 · Der Eingang (`api/app/report-location.php`)

`avesmapsNormalizeReportSources` ändert drei Dinge:

- Eine Zeile braucht **`url` oder `source_id > 0`**; sonst fällt sie (statt wie heute „Name reicht").
- `official`, `type` und `reference_kind` werden **nicht mehr übernommen** — die Zeile wird mit
  `official = false`, `type = ''`, `reference_kind = ''` gespeichert, was auch immer der Client schickt.
  🔴 Das ist der Riegel gegen den alten Client: ein gecachter `index.html` schickt weiter sechs
  Felder, und keines davon darf noch eine Aussage sein.
- Der Rückfall „`source` als einzelner Freitext" (Altform) bleibt für ganz alte Clients, wird aber
  als **link-lose Zeile** gespeichert, die die Annahme nicht mehr verknüpft (wie heute).

Die Spalte `sources_json` und ihr Format bleiben; kein DDL.

---

## 5 · Die Erkennung beim Sichten

### 5.1 Der Endpunkt (`GET api/edit/reports/locations.php`)

`avesmapsListLocationReportsForReview` hängt an jede Quelle eines Reports ein Feld `pruefung`:

```
{ "stand": "bekannt" | "neu" | "katalog" | "ohne_link",
  "label": "Geographia Aventurica",            // Katalogtitel bei bekannt/katalog
  "source_id": 812,                            // bei bekannt/katalog
  "korpus": { "known": true, "label": "Garetien-Wiki", "corpus_key": "garetien.de" }
          | { "known": false, "label": "example.org", "corpus_key": "example.org" }
          | null }                              // ohne Adresse
```

- `bekannt`: die Adresse steht im Katalog (`url_hash`). `katalog`: der Melder hat eine Zeile gepickt
  (`source_id`). `neu`: Adresse, die wir nicht kennen. `ohne_link`: Altform, nicht verknüpfbar.
- Der Korpus kommt aus `avesmapsSourceCorpusForUrl(avesmapsSourceCorpusReadAll($pdo), $url)` —
  dieselbe Rechnung wie in der Eingabezeile, **einmal** je Liste gelesen.
- 💣 **Kein `avesmapsSourceInspectUrl` hier.** Die Auskunft rechnet je Aufruf die Reichweite des
  Korpus (`avesmapsSourceCorpusUsage`, ein Volltabellenlauf über `sources`) und greift bei `fetch`
  nach draußen. Die Review-Liste lädt im Bearbeiten-Modus alle **45 s** (`review-api-metrics.js`);
  ein Volltabellenlauf je Quelle je 45 s ist genau die Last, vor der CLAUDE.md warnt. Eine eigene,
  kleine Funktion `avesmapsReportSourceRecognition(PDO, array $source, array $korpora): array` —
  eine Katalogabfrage per `url_hash` (indiziert) und eine In-Memory-Rechnung.

### 5.2 Die Review-Karte

Statt der einen Textzeile eine Zeile **je Quelle** (`.review-report__quelle`):

```
↗ wiki.punin.de/Baronie_Bitterbusch · kennen wir: „Baronie Bitterbusch" · Almada Wiki
↗ example.org/seite.html               · neu · neuer Wirt example.org
  „Die Flusslande" (aus dem Katalog) · S. 12
```

Reihenfolge der Marken: Katalog zuerst (bekannt / neu / aus dem Katalog), dann der Korpus (Name,
oder „neuer Wirt <host>"). Farben: Text in `--color-text-muted`, „neuer Wirt" in
`--color-warning-text` — das ist der eine Fall, in dem der Editor nach der Annahme etwas tun muss.
Kein Rot: es ist kein Fehler, es ist Arbeit.

### 5.3 Die Vorschlagszeilen im Annahme-Dialog

`renderProposedFeatureSourceRow` (`review-feature-sources.js`) zeigt heute Link + „Vorschlag
(Meldung)" + Seiten. Sie bekommt dieselben zwei Marken wie die Karte (aus `pruefung`, die mit dem
Report reist). Die Gruppe heißt weiter „Aus der Meldung (wird beim Speichern übernommen)".

---

## 6 · Die Annahme

### 6.1 Ort und Beschriftung (Client)

`linkCommunityReportSource` schickt:

- `add_existing` mit `source_id`, wenn `pruefung.stand` `bekannt` oder `katalog` ist — die Zeile
  gibt es, es wird nur verknüpft (Seiten mit).
- sonst `add` mit `url`, `pages`, `label` — **ohne** `source_type`, **ohne** `is_official`, ohne
  `_chosen`-Schlüssel. Der Titel: `pruefung.label` (leer bei neu) → dann **einmal** `inspect_url`
  mit `fetch: true` für den Seitentitel (`gelesen`) → sonst der Wirt als Notname und die Meldung
  „Titel fehlt — bitte im Quellenkasten nachtragen" (✎ gibt es).
- ⚠️ `reference_kind` bleibt leer. Die Einstufung (ausführlich / ergänzend / Erwähnung) ist
  redaktionell; wer sie setzen will, tut es nach dem Speichern im Kasten — wie bei jeder Quelle, die
  ein Editor selbst einträgt.

### 6.2 Stadtkarte (Server)

`avesmapsCreateCitymapFromReport` ruft `avesmapsAddFeatureSource` weiter — mit `$type = ''`,
`$official = false`, und bekommt die Korpuswerte über §6.3. Titel: aus der Meldung nur bei
Katalogtreffer, sonst wie in 6.1 über den Seitentitel (`avesmapsSourceInspectUrl` mit `fetch`, hier
serverseitig, einmal je Annahme, nicht je Liste).

### 6.3 Die Korpuswerte für eine NEUE Katalogzeile (Server, für alle)

🔴 **Die Regel gehört in den Eintrage-Weg, nicht in den Annahmeweg.** In `avesmapsFeatureSourceUpsert`
(oder davor in `avesmapsAddFeatureSource`, wo die Adresse schon normalisiert ist): entsteht eine NEUE
Zeile und ist der Wirt ein bekannter Korpus, dann

| Feld | Regel |
|---|---|
| `source_type` | leer → vom Korpus; ausdrücklich gewählt (`source_type_chosen`) → bleibt |
| `license`, `attribution` | leer → vom Korpus |
| `is_official` | nicht gewählt (`is_official_chosen` false) → vom Korpus; gewählt → bleibt |

Eine BESTEHENDE Zeile bleibt unberührt — das ist die Regel vom 29.08./03.09. (`retype`,
`avesmapsSourceOfficialWriteAllowed`), und sie ändert sich nicht. `own_fields` bleibt leer, weil
nichts abweicht. ⭐ Damit verhält sich die Annahme wie die Eingabezeile des Editors, in der der
Client heute dieselben Werte vorbelegt: **eine** Rechnung, zwei Aufrufer, gleiches Ergebnis.
💣 Das gilt auch für den Wiki-Publikationsabgleich und die Importe, die `avesmapsFeatureSourceUpsert`
rufen — die bringen aber alle einen eigenen `source_type` und `is_official` mit, und `license`
kommt bei ihnen aus derselben Quelle wie die Korpuszeile. Eine Änderung des Bilds ist dort nicht
zu erwarten; der Test hält es fest (§7).

---

## 7 · Die Fallen

1. 💣 **Der alte Client.** Eine gecachte `index.html` schickt die alte Sechs-Felder-Zeile noch
   wochenlang. Der Eingang behandelt `official`/`type`/`reference_kind` als **nicht vorhanden**, nie
   als Aussage — sonst hinge der Riegel an der Ladefrist einer Datei.
2. 💣 **Ein Titel ohne Treffer ist keine Quelle.** Das Textfeld nimmt Titel für die Vorschlagsliste;
   ohne Pick gibt es keine `source_id`, und ohne Link keine Identität. Der Knopf muss ablehnen —
   sonst entsteht genau die link-lose Zeile, die §1.2 zeigt.
3. 💣 **`window.__sourceCatalog` ist nicht immer da** (die Karte lädt es beim Start; im Fehlerfall
   ist es `{}`) und trägt nur Zeilen **mit** Adresse. Der Client-Treffer ist Komfort; die Wahrheit
   rechnet der Server beim Sichten. Ohne Katalog: kein Satz, kein Fehler.
4. 💣 **Die Erkennung ist lokal.** Kein Abruf nach draußen in der Review-Liste (§5.1). Der Seitentitel
   wird erst bei der Annahme geholt, einmal je Zeile.
5. 💣 **Die Korpuswerte gelten nur der NEUEN Zeile.** `avesmapsSourceOfficialWriteAllowed` und
   `retype` bleiben, wie sie sind; §6.3 setzt nur Vorgaben, wo heute Leere stünde.
6. 💣 **Der Kartenvorschlag ist ein zweites Formular mit eigener Absende-Funktion**
   (`map-features-citymaps-suggest.js:441/700`) — beide Absender werden umgestellt, nicht einer.
7. 💣 **Die Abdeckung fällt aus dem Formular, nicht aus dem Datenmodell.** `reference_kind` bleibt
   Spalte, Endpunktfeld und ✎-Feld; nur der Melder setzt sie nicht mehr.
8. ⚠️ **`type` ist im Formular des Kartenvorschlags heute Pflichtfeld „Quelle" (Name).** Nach dem
   Umbau ist der Link Pflicht — ein Melder, der den Namen kennt und den Link nicht, muss den Titel
   aus dem Katalog picken. Steht das Werk nicht im Katalog, kann er es nicht melden. Das ist der
   Preis der Regel und gewollt (Owner: „einfach den link pasten").
9. 🪤 **Enter im Feld:** an `#report-source-label` hängt in `js/app/bootstrap.js` ein Enter-Handler
   („Enter legt die Quelle an"), und die Vorschlagsliste muss VOR ihm registriert sein
   (`stopImmediatePropagation`, Memory `quellen-autocomplete-5a`). Das neue Feld erbt beides — die
   Kennung wechselt, die Verdrahtung zieht mit.

---

## 8 · Offene Fragen an den Owner

1. **Änderungswunsch ohne Quelle?** Heute optional (ein Tippfehler braucht keine). Vorschlag: bleibt
   optional — aber wenn eine dabei ist, dann als Link. Alternativ: Pflicht, wenn Name oder Art
   geändert werden.
2. **Der Satz „Kennen wir schon: „Titel"" beim Melder** — zeigen oder weglassen? Er verrät nichts
   über Korpus oder Lizenz, nur dass die Seite im Katalog ist. Vorschlag: zeigen.
3. **Die Abdeckung** (ausführlich / ergänzend / Erwähnung) fällt für den Melder weg und wird vom
   Editor nach der Annahme gesetzt. Einverstanden?

---

## 9 · Abnahmeliste (Ablauf, nicht Maß)

- [ ] Meldeformular „Karteneintrag melden": Link einfügen → Zeile steht mit ↗; Titel tippen →
      Vorschlag picken → Zeile mit Titel; Titel ohne Pick → Ablehnung mit Satz; bekannte Adresse
      → „Kennen wir schon".
- [ ] „Änderung vorschlagen": dieselbe Zeile, Quelle optional.
- [ ] „Karte vorschlagen": Link Pflicht, Seite optional, kein Art-Feld, kein Haken.
- [ ] Review-Liste: je Quelle Link + Katalogstand + Korpus / „neuer Wirt".
- [ ] Annahme Ort: bekannte Adresse → `add_existing`; neue Adresse eines bekannten Korpus → Zeile mit
      Korpuswerten (Art, Lizenz, Nennung, Kanon), Titel von der Seite; unbekannter Wirt → Zeile ohne
      Korpuswerte + Hinweis in der Karte.
- [ ] Annahme Stadtkarte: dasselbe serverseitig.
- [ ] Alter Client (Rumpf mit `official: true`, `type: abenteuer`): gespeichert wird beides nicht.
- [ ] `?lang=en`: alle Beschriftungen des Blocks englisch.
- [ ] Testfeld über beide Workflow-Muster grün; neue Zusicherungen gegen Mutationen.
