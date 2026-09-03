# Quellen im Meldeformular der Community — der Link ist die Quelle, der Korpus bleibt bei uns

**Stand:** Entwurf 03.09.2026 abends, zweite Fassung nach dem Owner-Blick („da wollen wir natürlich
alle felder und das ganz normale formular sehen"), nach dem Abschluss der Schritte 1–5 des
Quellen-Umbaus.
**Owner-Auftrag (03.09.2026):** „das meldeformular der community! … das müssen wir als erstes
nachziehen und an das neue system anpassen. sowohl änderungen als auch neue vorschläge müssen das mit
dem link machen. ich will allerdings nicht, dass externe nutzer was am korpus machen — die sollen
einfach den link pasten. erst wir im backend sollen sehen, ob der korpus passt oder ein neuer erkannt
wurde." — und zur Backend-Sicht: „da wollen wir natürlich alle felder und das ganz normale formular
sehen."
**Mockup:** `docs/quellen-meldeformular-mockup.html` — bis zum GO als
`docs/quellen-meldeformular-mockup.entwurf.html` abgelegt, weil sein VERTRAG (drei Blöcke:
`css/components/location-report-dialog.css`, `css/features/feature-sources.css`,
`css/features/review-panel.css`) bis zum Bau rot wäre und der Vertragstest jedes `*-mockup.html`
liest. Abschnitt 1 ist die Sicht des Melders, 2 und 3 die Backend-Sicht (Review-Karte, Annahme-Dialog).

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
  `review-feature-sources.js`): jede gemeldete Quelle **mit Link** geht beim Speichern als `add` an
  `POST api/edit/map/feature-sources.php` — mit `source_type` und `is_official` **aus dem
  Meldeformular**, ohne dass der Editor etwas davon sieht oder ändern kann; ein gepickter
  Katalogtreffer (`source_id`) als `add_existing`. Link-lose Zeilen fallen in die Beschreibung
  („Quelle: X, S. Y") und sind damit keine Quelle mehr. Im Annahme-Dialog stehen die Zeilen als
  schreibgeschützte Gruppe „Aus der Meldung" (`renderProposedFeatureSourceRow`): Link, Pille
  „Vorschlag (Meldung)", Stern vom Haken des Melders, Seiten. Mehr nicht.
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

### 1.5 Der Knopf „+ Quelle hinzufügen" tut nichts, wenn nur der Link ausgefüllt ist

Owner 03.09.2026: „beachte, dass der button ‚Quelle hinzufügen' derzeit nicht funktioniert." Live
nachgemessen (avesmaps.de, Besucheransicht): mit ausgefülltem **Namen** legt der Knopf eine Zeile an;
mit ausgefülltem **Link und leerem Namen** passiert nichts — keine Zeile, keine Meldung
(`addLocationReportSourceFromInputs` verlangt `label` und kehrt still mit `false` zurück). Der Name
ist heute das Pflichtfeld, der Link optional. Das ist genau verkehrt herum, und §3 dreht es um: der
Link wird Pflicht, der Name fällt. 🔴 Und eine Ablehnung ist künftig **hörbar** (§3.1) — ein Knopf,
der still nichts tut, sieht aus wie ein kaputter Knopf.

### 1.6 Nebenbefund beim Messen: die Besucherkarte lud seit Schritt 5 keine Beschriftungen

Beim Nachmessen des Knopfs stand in der Konsole der Live-Seite ein `ReferenceError` aus Schritt 5
(`quellenSchluessel` in `buildRegionLabelViewPopupHtml`, nur in der Datenbox-Funktion definiert):
das Laden der Kartendaten brach für Besucher ab, zwei Stunden lang, während Bearbeiten-Modus,
Quelltext-Tests und 14 Mutationen grün waren. Behoben als Hotfix `34aeeba23` (Helfer für beide
Popup-Bauer, Test führt das Ansichts-Popup aus). Lehre in AGENTS.md §11 und Memory
`quelltexttest-sieht-keinen-geltungsbereich`.

### 1.7 Nebenbefund: acht Beschriftungen des Formulars haben keinen englischen Text

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
3. 🔴 **Im Backend steht die gemeldete Quelle im GANZ NORMALEN Formular, mit allen Feldern** — der
   dreiteiligen Eingabezeile des Quellenkastens (Quelle → Korpus → dieses Objekt), vorausgefüllt vom
   Server aus der Adresse, genau so, als hätte ein Editor sie eingefügt: Katalog geprüft (bekannt /
   neu), Korpus erkannt (Name, Art, Lizenz, Nennung, offiziell „· vom Korpus") oder als neuer Wirt
   benannt, Seite(n) vom Melder. Beim **Sichten** schreibgeschützt (Review-Karte), bei der
   **Annahme** zum Schreiben (Annahme-Dialog). Kein Sonderformat, keine Kurzmarken, kein zweiter
   Zeilenbauer — die Eingabezeile gibt es einmal.
4. 🔴 **Die Annahme ist ein Speichern im normalen Formular.** Der Editor sieht jede gemeldete
   Quelle, ergänzt Titel oder Abdeckung, korrigiert, und drückt „Speichern" — damit gelten
   ausnahmslos die Regeln der Eingabezeile: Korpuswerte für eine neue Zeile, „offiziell" und Art
   nur bei ausdrücklicher Wahl, Korpus anlegen bei neuer Domain, Rückfrage ab zehn Objekten,
   Abweichungen nur an dieser Quelle. „Überspringen" nimmt eine Quelle nicht. Nichts wird mehr
   **still** aus dem Meldeformular in den Katalog geschrieben.
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

## 5 · Das Backend: das normale Formular, vorausgefüllt

### 5.1 Die Vorbelegung (`GET api/edit/reports/locations.php`)

`avesmapsListLocationReportsForReview` hängt an jede Quelle eines Reports ein Feld `vorbelegung` —
genau die Werte, die die Eingabezeile des Quellenkastens nach dem Einfügen einer Adresse zeigt:

```
{ "stand": "bekannt" | "neu" | "katalog" | "ohne_link",
  "existing": { "source_id": 812, "label": "…", "type": "…", "official": true, "license": "…", "attribution": "…" } | null,
  "korpus":   { "known": true,  "corpus_key": "garetien.de", "label": "Garetien-Wiki", "form": "belegstelle",
                "source_type": "briefspiel", "license": "cc-by-nc-sa-3.0", "attribution": "VolkoV / garetien.de",
                "is_official": false, "sources": 45, "objects": 161 }
            | { "known": false, "corpus_key": "example.org", "label": "example.org", … leer … }
            | null }                                                     // ohne Adresse
```

- `bekannt`: die Adresse steht im Katalog (`url_hash`). `katalog`: der Melder hat eine Zeile gepickt
  (`source_id`). `neu`: Adresse, die wir nicht kennen. `ohne_link`: Altform, nicht verknüpfbar.
- Das ist **dieselbe Auskunft wie `inspect_url` ohne Abruf** (`avesmapsSourceInspectUrl(…, fetch:
  false)` liefert `existing` und `corpus`) — aber nicht dieselbe Funktion: die rechnet je Aufruf die
  Reichweite des Korpus über einen Volltabellenlauf (`avesmapsSourceCorpusUsage`), und die
  Review-Liste lädt im Bearbeiten-Modus alle **45 s** (`review-api-metrics.js`). Deshalb eine kleine
  Funktion `avesmapsReportSourceVorbelegung(PDO, array $source, array $korpora, array $usage): array`
  — Katalogabfrage per `url_hash` (indiziert), Korpus aus `avesmapsSourceCorpusReadAll` (einmal je
  Liste), Reichweite aus `avesmapsSourceCorpusUsageAll` (einmal je Liste, existiert bereits).
- 💣 **Kein Abruf nach draußen in der Liste.** Der Seitentitel für eine neue Adresse kommt erst im
  Annahme-Dialog — über den vorhandenen ⟳-Knopf der Eingabezeile oder beim Speichern (§6).

### 5.2 Die Review-Karte beim Sichten — schreibgeschützt, alle Felder

Die Karte bekommt statt der Textzeile eine Falte **„n Quellen aus der Meldung"**
(`details.review-report__quellen`, nativ wie „n weitere Quellen"; zu, bis man sie öffnet). Darin
je gemeldete Quelle **die normale Eingabezeile** (`renderFeatureSourceAddRow`), vorausgefüllt aus
`vorbelegung` und **schreibgeschützt** (`disabled` an allen Feldern — die Rezeptur
`.fs-scope input[disabled]` gibt es seit dem 02.09.): alle drei Rahmen, alle Felder, die Marker
„· vom Korpus", die Reichweite des Korpus im Rahmentitel, „bestehende Quelle" bei Katalogtreffer,
Seite(n) vom Melder. Über jedem Formular eine Zeile `.fs-add-queue`: „Quelle 1 von 2 · vom Server
geprüft: bekannter Korpus, neue Seite" / „… unbekannter Wirt — ein neuer Korpus, wenn du ihn
anlegst" / „… steht schon im Katalog". Der Editor sieht damit beim Sichten **exakt, was die Annahme
anlegen würde** — nichts, was er im Annahme-Dialog nicht auch sähe.

⚠️ Das Formular ist groß (drei Rahmen, bis zu zwölf Felder). Deshalb die Falte, und deshalb kein
zweites, kompaktes Format: eine kompakte Zusammenfassung wäre der zweite Zeilenbauer, den der
Owner ausdrücklich nicht will. Mockup §2.

### 5.3 Der Annahme-Dialog — dasselbe Formular, zum Schreiben, eine Quelle nach der anderen

Im Quellenkasten des Annahme-Dialogs (Ort anlegen / Ort bearbeiten aus der Meldung) steht die
gemeldete Quelle **in der Eingabezeile selbst**, vorausgefüllt wie in §5.2, aber schreibbar. Die
Falte „Neue Quelle einfügen" ist dabei **offen** — die einzige Ausnahme von „immer zu" (Owner
03.09.2026), solange Quellen aus der Meldung warten. Über dem Formular die Warteschlangen-Zeile:
„Aus der Meldung: Quelle 1 von 2 · bekannter Korpus, neue Seite — prüfen, ergänzen, Speichern."
Die Knöpfe heißen **Speichern** (der normale Weg der Eingabezeile) und **Überspringen** (statt
„Abbrechen": die Quelle wird nicht genommen, die nächste rückt nach). Nach dem Speichern meldet die
Zeile unter dem Kasten wie immer „Hinzugefügt: „X"." und die nächste gemeldete Quelle steht im
Formular; nach der letzten klappt die Falte zu.

🔴 **Ein Formular, nacheinander — nicht n Formulare untereinander.** Das Bauteil hat EINE
Eingabezeile (`[data-fs-add]`, `.fs-add-*`), an der Vorschlagsliste, Adressprüfung, Korpusanlage,
Abweichungen und die Rückfragen hängen. Ein zweiter Bauer für „mehrere Formulare" wäre die zweite
Fassung genau dieser Regeln. Live sind es ohnehin höchstens zehn Quellen je Meldung, im Bestand
zwei.

🔴 **Die Vorschlagsgruppe „Aus der Meldung (wird beim Speichern übernommen)" fällt**, samt
`renderProposedFeatureSourceRow`, `appendProposedFeatureSources` und dem stillen Verknüpfen in
`review-editor-submit.js` (`linkCommunityReportSource`-Schleife). Was der Editor nicht gespeichert
hat, wird nicht angelegt. ⚠️ `linkCommunityReportSource` bleibt für den **Katalogtreffer**
(`add_existing` per `source_id`) — auch der läuft künftig über das Formular („bestehende Quelle",
Katalogfelder gesperrt, nur Seite und Abdeckung offen, Knopf „Speichern"), also über denselben
Weg wie ein von Hand gepickter Treffer.

💣 **Bei einem NEUEN Ort gibt es beim Speichern der Quelle noch keine Kennung.** Das Bauteil kennt
den Fall: beim Anlegen von Hand puffert `locationEditPendingSourceStore` (Bug #41) die Quellen
und spielt sie nach dem Anlegen über denselben Add-Weg ein. Die gemeldeten Quellen gehen durch
genau diesen Puffer — kein zweiter.

💣 **Der Seitentitel.** Ist die Adresse neu, steht der Titel leer, mit Platzhalter „wird beim
Speichern von der Seite gelesen"; der ⟳-Knopf holt ihn auf Wunsch sofort (`inspect_url`,
`fetch: true`, ein Handgriff, wie heute). Beim Speichern ohne Titel holt die Eingabezeile ihn
**einmal** selbst (derselbe Aufruf); bleibt er leer (`erreichbar` ohne Überschrift), steht der Wirt
als Notname und die Meldung sagt es — ✎ gibt es.

### 5.4 Stadtkarte (Server)

Der Kartenvorschlag wird serverseitig angenommen (`avesmapsCreateCitymapFromReport`), ohne Dialog
mit Quellenkasten. Dort bleibt der programmatische Weg über `avesmapsAddFeatureSource` — mit
`$type = ''`, `$official = false`, und die Korpuswerte über §6.3. Damit ist die Stadtkarte die
eine Stelle, an der der Editor die Quelle nicht im Formular sieht, bevor sie entsteht.
🔧 Owner-Frage in §8: reicht das für eine Quelle je Karte, oder soll auch die Karten-Annahme
durch einen Dialog mit Quellenkasten?

---

## 6 · Die Annahme, technisch

### 6.1 Ort und Beschriftung (Client)

Die Eingabezeile des Kastens wird aus `report.sources[i]` + `vorbelegung` befüllt
(`setzeAddZeile(vorbelegung)`: Adresse, Titel aus `existing`, `uebernehmeKorpus(korpus)` für die
Korpusfelder samt Marker, Seite(n), „bestehende Quelle" bei Katalogtreffer, Katalogfelder gesperrt
wie im Zustand 3 der Adresse). Der Rest ist die Eingabezeile, wie sie ist: `add` / `add_existing`
mit `source_type_chosen`/`is_official_chosen` nur bei ausdrücklicher Wahl, Korpusanlage, Abweichungen,
Rückfragen. Nach `Speichern` oder `Überspringen` die nächste Quelle; die Warteschlange lebt im
Bauteil (`state.meldung = { quellen, index }`), nicht im Aufrufer.

### 6.2 Stadtkarte (Server)

`avesmapsCreateCitymapFromReport` ruft `avesmapsAddFeatureSource` weiter — mit `$type = ''`,
`$official = false`, und bekommt die Korpuswerte über §6.3. Titel: aus der Meldung nur bei
Katalogtreffer, sonst über den Seitentitel (`avesmapsSourceInspectUrl` mit `fetch`, hier
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
nichts abweicht. ⭐ Damit verhält sich der serverseitige Weg (Stadtkarte) wie die Eingabezeile, in
der der Client dieselben Werte vorbelegt: **eine** Rechnung, zwei Aufrufer, gleiches Ergebnis.
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
4. 💣 **Die Vorbelegung ist lokal.** Kein Abruf nach draußen in der Review-Liste (§5.1). Der
   Seitentitel wird erst im Annahme-Dialog geholt, einmal je Zeile.
5. 💣 **Die Korpuswerte gelten nur der NEUEN Zeile.** `avesmapsSourceOfficialWriteAllowed` und
   `retype` bleiben, wie sie sind; §6.3 setzt nur Vorgaben, wo heute Leere stünde.
6. 💣 **Der Kartenvorschlag ist ein zweites Formular mit eigener Absende-Funktion**
   (`map-features-citymaps-suggest.js:441/700`) — beide Absender werden umgestellt, nicht einer.
7. 💣 **Die Abdeckung fällt aus dem Meldeformular, nicht aus dem Datenmodell.** Sie bleibt Spalte,
   Endpunktfeld und Feld der Eingabezeile — der Editor setzt sie im Annahme-Dialog, der Melder nicht.
8. ⚠️ **„Quelle" ist im Kartenvorschlag heute Pflichtfeld „Name".** Nach dem Umbau ist der Link
   Pflicht — ein Melder, der den Namen kennt und den Link nicht, muss den Titel aus dem Katalog
   picken. Steht das Werk nicht im Katalog, kann er es nicht melden. Das ist der Preis der Regel und
   gewollt (Owner: „einfach den link pasten").
9. 🪤 **Enter im Feld:** an `#report-source-label` hängt in `js/app/bootstrap.js` ein Enter-Handler
   („Enter legt die Quelle an"), und die Vorschlagsliste muss VOR ihm registriert sein
   (`stopImmediatePropagation`, Memory `quellen-autocomplete-5a`). Das neue Feld erbt beides — die
   Kennung wechselt, die Verdrahtung zieht mit.
10. 💣 **Die offene Falte ist eine Ausnahme mit Ende.** „Immer zu" (Owner 03.09.2026) gilt weiter;
    offen ist sie nur, solange `state.meldung` Quellen hält, und der Bauer setzt `open` genau aus
    diesem Zustand — kein zweiter Merker. Nach der letzten Quelle zeichnet das Bauteil wie immer
    aus der Serverantwort neu, und die Falte ist zu.
11. 💣 **Schreibgeschützt heißt `disabled`, nicht „weggelassen".** Die Karte zeigt ALLE Felder
    (Owner). Ein Feld, das nur im Annahme-Dialog erscheint, wäre eine Abweichung zwischen Sichten
    und Annehmen — der Editor sähe beim Sichten weniger, als die Annahme anlegt.
12. 💣 **Ein Formular je Meldung in der Liste, nicht je Karte gleichzeitig offen.** Die Falte ist
    zu; wer sie öffnet, sieht bis zu zehn Formulare. Die Karte wird beim Live-Poll (45 s) neu
    gezeichnet — eine offene Falte muss den Poll überleben (Merker am `details`-Element vor dem
    Neuzeichnen lesen, wie die Auswahl der Zoombänder-Tafel).

---

## 8 · Offene Fragen an den Owner

1. **Änderungswunsch ohne Quelle?** Heute optional (ein Tippfehler braucht keine). Vorschlag: bleibt
   optional — aber wenn eine dabei ist, dann als Link. Alternativ: Pflicht, wenn Name oder Art
   geändert werden.
2. **Der Satz „Kennen wir schon: „Titel"" beim Melder** — zeigen oder weglassen? Er verrät nichts
   über Korpus oder Lizenz, nur dass die Seite im Katalog ist. Vorschlag: zeigen.
3. **Die Abdeckung** (ausführlich / ergänzend / Erwähnung) setzt der Editor im Annahme-Dialog, der
   Melder nicht mehr. Einverstanden?
4. **Der Kartenvorschlag** wird serverseitig ohne Dialog angenommen (§5.4). Reicht dort der
   programmatische Weg mit Korpuswerten, oder soll auch die Karten-Annahme durch das Formular?

---

## 9 · Abnahmeliste (Ablauf, nicht Maß)

- [ ] Meldeformular „Karteneintrag melden": Link einfügen → Zeile steht mit ↗; Titel tippen →
      Vorschlag picken → Zeile mit Titel; Titel ohne Pick → Ablehnung mit Satz; bekannte Adresse
      → „Kennen wir schon".
- [ ] „Änderung vorschlagen": dieselbe Zeile, Quelle optional.
- [ ] „Karte vorschlagen": Link Pflicht, Seite optional, kein Art-Feld, kein Haken.
- [ ] Review-Liste: Falte „n Quellen aus der Meldung", darin je Quelle das normale Formular,
      schreibgeschützt, alle Felder, mit „· vom Korpus" bei bekanntem Wirt und der Korpusreichweite
      im Rahmentitel; die Falte überlebt den 45-s-Poll.
- [ ] Annahme Ort (neu und Änderung): die Eingabezeile zeigt „Quelle 1 von n", vorausgefüllt;
      Speichern legt an (bekannte Adresse → verknüpft; neue Adresse eines bekannten Korpus → Zeile
      mit Korpuswerten, Titel von der Seite; neue Domain → Korpus anlegen im selben Formular);
      Überspringen nimmt nicht; nach der letzten Quelle ist die Falte zu. Beim neuen Ort wird
      gepuffert, bis die Kennung da ist.
- [ ] Annahme Stadtkarte: serverseitig mit Korpuswerten.
- [ ] Alter Client (Rumpf mit `official: true`, `type: abenteuer`): gespeichert wird beides nicht.
- [ ] `?lang=en`: alle Beschriftungen des Blocks englisch.
- [ ] Testfeld über beide Workflow-Muster grün; neue Zusicherungen gegen Mutationen.
