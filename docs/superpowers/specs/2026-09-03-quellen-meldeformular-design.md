# Quellen im Meldeformular der Community — der Link ist die Quelle, der Korpus bleibt bei uns

**Stand:** Entwurf 03.09.2026 abends, dritte Fassung nach zwei Owner-Blicken.
**Owner-Auftrag (03.09.2026):** „das meldeformular der community! … das müssen wir als erstes
nachziehen und an das neue system anpassen. sowohl änderungen als auch neue vorschläge müssen das mit
dem link machen. ich will allerdings nicht, dass externe nutzer was am korpus machen — die sollen
einfach den link pasten. erst wir im backend sollen sehen, ob der korpus passt oder ein neuer erkannt
wurde." — zur Backend-Sicht: „da wollen wir natürlich alle felder und das ganz normale formular
sehen." — zu den Fragen: der Satz „Kennen wir schon" beim Melder **„nein, verwirrt nur"**; die
Abdeckung **„kann man dem melder anbieten (optional, genau wie seite, lizenz und …)"**.
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
| Abdeckung (ausführlich / ergänzend / Erwähnung) | nein | dieser Fundstelle ✓ |
| ☐ offiziell | — | dem **Korpus** / dem Kanon |

Zwei der sechs Felder sind seit dem 01./02.09.2026 Eigenschaften des Korpus (Art, offiziell), und
der Melder entscheidet sie heute ohne Wissen: die Art steht auf „Sonstiges", der Haken „offiziell"
ist eine Meinung. Der Name ist Pflicht, obwohl er ohne Link keine Identität trägt; der Link ist
optional, obwohl er die Identität IST.

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
Link wird Pflicht, der Name wird optional. 🔴 Und eine Ablehnung ist künftig **hörbar** (§3.1) —
ein Knopf, der still nichts tut, sieht aus wie ein kaputter Knopf.

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

1. 🔴 **Der Link IST die Quelle.** Je Quelle gibt der Melder den **Link** an (Pflicht). Dazu,
   **optional und eingeklappt**, was er weiß: Seite(n), Titel, Abdeckung, Lizenz, Namensnennung
   (Owner: „kann man dem melder anbieten, optional, genau wie seite, lizenz und …"). Das sind
   **Angebote an den Editor**, keine Aussagen: sie füllen im Backend Felder vor, sie schreiben nie
   selbst in den Katalog oder den Korpus. Nicht angeboten werden **Art** und **„offiziell"** — die
   eine ist die Einordnung des Korpus, das andere der Kanon, und beide haben den Katalog schon
   einmal beschädigt (#105, Geographia Aventurica).
2. 🔴 **Externe fassen den Korpus nicht an — und sehen ihn nicht.** Das Formular kennt keinen
   Korpus: keine Vorbelegung, kein Name, keine Anlage, kein Satz „diese Adresse kennen wir" (Owner:
   „verwirrt nur"). Der Melder tippt, was er weiß; ob wir es kennen, ist unsere Sache.
3. 🔴 **Im Backend steht die gemeldete Quelle im GANZ NORMALEN Formular, mit allen Feldern** — der
   dreiteiligen Eingabezeile des Quellenkastens (Quelle → Korpus → dieses Objekt), vorausgefüllt vom
   Server aus der Adresse, genau so, als hätte ein Editor sie eingefügt: Katalog geprüft (bekannt /
   neu), Korpus erkannt (Name, Art, Lizenz, Nennung, offiziell „· vom Korpus") oder als neuer Wirt
   benannt; dazu die Angebote des Melders „· vom Melder", wo der Korpus nichts vorgibt. Beim
   **Sichten** schreibgeschützt (Review-Karte), bei der **Annahme** zum Schreiben (Annahme-Dialog).
   Kein Sonderformat, keine Kurzmarken, kein zweiter Zeilenbauer — die Eingabezeile gibt es einmal.
4. 🔴 **Die Annahme ist ein Speichern im normalen Formular.** Der Editor sieht jede gemeldete
   Quelle, ergänzt, korrigiert, und drückt „Speichern" — damit gelten ausnahmslos die Regeln der
   Eingabezeile: Korpuswerte für eine neue Zeile, „offiziell" und Art nur bei ausdrücklicher Wahl,
   Korpus anlegen bei neuer Domain, Rückfrage ab zehn Objekten, Abweichungen nur an dieser Quelle.
   „Überspringen" nimmt eine Quelle nicht. Nichts wird mehr **still** aus dem Meldeformular in den
   Katalog geschrieben.
5. **Ein Werk ohne Adresse bleibt erreichbar** — über die Vorschlagsliste des Katalogs (5a): wer
   „Die Flusslande" tippt und den Treffer nimmt, meldet die Katalogzeile (`source_id`). Das ist der
   einzige Weg, auf dem ein Name ohne Link noch eine Quelle sein kann; alles andere ohne Link wird
   nicht angenommen.
6. **Beide Formulare, ein Eingang, eine Regel.** Das Meldeformular (neu und Änderung) und der
   Kartenvorschlag bekommen dieselbe Zeile; `avesmapsNormalizeReportSources` verlangt Link ODER
   `source_id` und verwirft `official` und `type` — auch von einem alten, zwischengespeicherten
   Client.
7. **Quellen bei einem Änderungswunsch bleiben optional** — ein korrigierter Tippfehler braucht
   keine. Wenn eine dabei ist, dann als Link wie überall.

---

## 3 · Die Fläche des Melders

### 3.1 Die Zeile

```
Ich habe folgende Quellen
┌──────────────────────────────────────────────────────────┬──────────┐
│ Link einfügen — oder Titel tippen und aus dem Katalog    │ Seite(n) │  [+ Quelle hinzufügen]
│ wählen                                                    │          │
└──────────────────────────────────────────────────────────┴──────────┘
▸ Mehr zur Quelle (optional): Titel · Abdeckung · Lizenz · Namensnennung
```

- **EIN Textfeld** (`#report-source-ref`), kein `type="url"`: es nimmt eine Adresse **oder** einen
  Titel. Beginnt der Wert mit `http`, ist es ein Link; sonst läuft die Vorschlagsliste des Katalogs
  (`attachSourceAutocomplete`, unverändert), und ein Treffer wird zur Zeile mit `source_id`.
  ⚠️ Ein Titel **ohne** Treffer ist keine Quelle: „+ Quelle hinzufügen" lehnt ab, mit dem Satz
  „Bitte den Link zur Quelle einfügen — oder einen Titel aus der Liste wählen."
- **Seite(n)** wie heute (`#report-source-pages`, 120 Zeichen), in der Zeile, weil es der häufigste
  Zusatz ist.
- **„Mehr zur Quelle (optional)"** — eine native Falte (`details.report-sources__mehr`, zu), darin:
  **Titel** (wie die Seite heißt; leer heißt „wird von der Seite gelesen"), **Abdeckung**
  (ausführlich / ergänzend / Erwähnung, Vorgabe leer), **Lizenz** (dieselbe Tafel wie im
  Quellenkasten, `featureSourceLicenseTable`, Vorgabe leer = „nicht erfasst"), **Namensnennung**
  (Freitext). Dieselbe Bauform wie „Mehr zur Quelle" im Kartenvorschlag, der sie seit dem 17.07.
  hat. 💣 **Alle vier sind Angebote:** sie reisen mit, sie füllen im Backend vor, und der Editor
  entscheidet — nichts davon schreibt an der Eingabezeile vorbei.
- **Kein Satz zur Erkennung.** Weder „Kennen wir schon" noch Korpus noch Wirt. Der erste Entwurf
  hatte den Satz; Owner: „nein, verwirrt nur".
- **Die Liste** der hinzugefügten Quellen zeigt je Zeile: Link (ellipsiert, ↗) oder den gepickten
  bzw. getippten Titel, Seiten, ✕. Kein Sternchen, kein Typ; die Angebote aus der Falte stehen
  nicht in der Zeile (sie sind im Backend zu sehen).
- **Pflicht** wie heute: mindestens eine Quelle bei einem neuen Vorschlag (außer Kommentar/Fundort);
  im Änderungsmodus **optional** (Regel 7).
- Die Beschriftung des Abschnitts wird ehrlich: „Quellen * — Link zur Seite, in der es steht
  (Wiki-Artikel, F-Shop, Fanwiki)".

### 3.2 Der Kartenvorschlag

Dieselbe Zeile ersetzt die Felder „Quelle / Link / Art / offiziell": **ein** Feld „Link zur Quelle
(oder Titel aus dem Katalog)" (Pflicht) + „Seite(n)"; die Falte „Mehr zur Quelle" trägt dort Titel,
Abdeckung, Lizenz, Namensnennung — das Art-Feld und der Haken fallen. Der Erklärsatz „Wo die Karte
erschienen ist — nicht, wer sie gezeichnet hat" bleibt, weil er eine andere Verwechslung abfängt. Es
bleibt bei genau einer Quelle je Kartenvorschlag.

### 3.3 Was reist

`sources[]` je Zeile: `{ url, source_id, label, pages, reference_kind, license, attribution }` —
`label` aus einem Katalogtreffer oder aus dem Titelfeld der Falte, sonst leer. `type` und
`official` schickt der neue Client nicht mehr.

---

## 4 · Der Eingang (`api/app/report-location.php`)

`avesmapsNormalizeReportSources` ändert vier Dinge:

- Eine Zeile braucht **`url` oder `source_id > 0`**; sonst fällt sie (statt wie heute „Name reicht").
- `official` und `type` werden **nicht mehr übernommen** — die Zeile wird mit `official = false`,
  `type = ''` gespeichert, was auch immer der Client schickt. 🔴 Das ist der Riegel gegen den alten
  Client: ein gecachter `index.html` schickt weiter sechs Felder, und keines davon darf noch eine
  Aussage über Korpus oder Kanon sein.
- `reference_kind` (Whitelist wie heute), `license` (`avesmapsNormalizeSourceLicense`, unbekannt →
  leer) und `attribution` (eine Zeile, 200 Zeichen) werden **als Angebote** gespeichert.
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

Die Angebote des Melders (`label`, `pages`, `reference_kind`, `license`, `attribution`) reisen
daneben in der Quelle selbst, wie bisher.

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

### 5.2 Die Rangfolge beim Vorbelegen

🔴 **Katalog vor Korpus vor Melder** — und jede Herkunft trägt ihren Marker:

| Feld | bekannte Seite (`existing`) | bekannter Korpus | unbekannter Wirt |
|---|---|---|---|
| Titel | Katalog (gesperrt) | Melder, sonst leer (⟳ liest die Seite) | Melder, sonst leer |
| Art, offiziell | Katalog (gesperrt) | Korpus „· vom Korpus" | leer — der Editor wählt |
| Lizenz, Namensnennung | Katalog (gesperrt) | Korpus „· vom Korpus"; ein abweichendes Melderangebot steht als Zeile darunter: „Melder: CC BY-SA 4.0" | Melder „· vom Melder", sonst leer |
| Seite(n), Abdeckung | Melder | Melder | Melder |

⚠️ Ein Melderangebot **überschreibt nie** einen Korpus- oder Katalogwert. Es füllt Leere, oder es
steht als Hinweis daneben. Das ist der Satz „externe Nutzer machen nichts am Korpus", in Feldern.

### 5.3 Die Review-Karte beim Sichten — schreibgeschützt, alle Felder

Die Karte bekommt statt der Textzeile eine Falte **„n Quellen aus der Meldung"**
(`details.review-report__quellen`, nativ wie „n weitere Quellen"; zu, bis man sie öffnet). Darin
je gemeldete Quelle **die normale Eingabezeile** (`renderFeatureSourceAddRow`), vorausgefüllt nach
§5.2 und **schreibgeschützt** (`disabled` an allen Feldern — die Rezeptur
`.fs-scope input[disabled]` gibt es seit dem 02.09.): alle drei Rahmen, alle Felder, die Marker
„· vom Korpus" und „· vom Melder", die Reichweite des Korpus im Rahmentitel, „bestehende Quelle" bei
Katalogtreffer. Über jedem Formular eine Zeile `.fs-add-queue`: „Quelle 1 von 2 · vom Server
geprüft: bekannter Korpus, neue Seite" / „… unbekannter Wirt — ein neuer Korpus, wenn du ihn
anlegst" / „… steht schon im Katalog". Der Editor sieht damit beim Sichten **exakt, was die Annahme
anlegen würde** — nichts, was er im Annahme-Dialog nicht auch sähe.

⚠️ Das Formular ist groß (drei Rahmen, bis zu zwölf Felder). Deshalb die Falte, und deshalb kein
zweites, kompaktes Format: eine kompakte Zusammenfassung wäre der zweite Zeilenbauer, den der
Owner ausdrücklich nicht will. Mockup §2.

### 5.4 Der Annahme-Dialog — dasselbe Formular, zum Schreiben, eine Quelle nach der anderen

Im Quellenkasten des Annahme-Dialogs (Ort anlegen / Ort bearbeiten aus der Meldung) steht die
gemeldete Quelle **in der Eingabezeile selbst**, vorausgefüllt nach §5.2, aber schreibbar. Die
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
hat, wird nicht angelegt. ⚠️ Der **Katalogtreffer** (`source_id`) läuft künftig ebenfalls über das
Formular („bestehende Quelle", Katalogfelder gesperrt, nur Seite und Abdeckung offen, Knopf
„Speichern") — derselbe Weg wie ein von Hand gepickter Treffer.

💣 **Bei einem NEUEN Ort gibt es beim Speichern der Quelle noch keine Kennung.** Das Bauteil kennt
den Fall: beim Anlegen von Hand puffert `locationEditPendingSourceStore` (Bug #41) die Quellen
und spielt sie nach dem Anlegen über denselben Add-Weg ein. Die gemeldeten Quellen gehen durch
genau diesen Puffer — kein zweiter.

💣 **Der Seitentitel.** Ist die Adresse neu und hat der Melder keinen Titel angeboten, steht das
Feld leer mit Platzhalter „wird beim Speichern von der Seite gelesen"; der ⟳-Knopf holt ihn auf
Wunsch sofort (`inspect_url`, `fetch: true`, ein Handgriff, wie heute). Beim Speichern ohne Titel
holt die Eingabezeile ihn **einmal** selbst (derselbe Aufruf); bleibt er leer (`erreichbar` ohne
Überschrift), steht der Wirt als Notname und die Meldung sagt es — ✎ gibt es.

### 5.5 Stadtkarte (Server) — 🔧 Owner-Frage in §8

Der Kartenvorschlag wird heute **serverseitig ohne Dialog** angenommen
(`avesmapsCreateCitymapFromReport`): der Knopf „Anlegen" in der Review-Karte legt die Karte samt
Quelle direkt an. Es gibt dort keinen Quellenkasten, in dem die Eingabezeile stehen könnte. Zwei
Wege:

- **(a) bleibt serverseitig:** `avesmapsAddFeatureSource` mit `$type = ''`, `$official = false`,
  Korpuswerte über §6.3, Melderangebote als Lizenz/Nennung nur bei unbekanntem Wirt, Titel per
  `avesmapsSourceInspectUrl` mit `fetch` (einmal je Annahme). Der Editor sieht die Quelle beim
  **Sichten** im schreibgeschützten Formular (§5.3), aber beim Anlegen kein Formular zum Schreiben;
  korrigieren kann er danach im Stadtkarten-Editor (Quellenkasten, ✎).
- **(b) durchs Formular:** „Anlegen" öffnet für eine Karte den **Stadtkarten-Editor** (er hat den
  Quellenkasten, `html/citymap-editor.html`) mit der angelegten Karte, und die gemeldete Quelle
  wartet dort in der Eingabezeile wie beim Ort (§5.4). Ein Weg mehr, ein Fenster mehr — dafür
  dieselbe Regel für alle drei Objektarten.

---

## 6 · Die Annahme, technisch

### 6.1 Ort und Beschriftung (Client)

Die Eingabezeile des Kastens wird aus `report.sources[i]` + `vorbelegung` befüllt
(`setzeAddZeile(quelle, vorbelegung)`: Adresse, Titel nach §5.2, `uebernehmeKorpus(korpus)` für
die Korpusfelder samt Marker, Melderangebote in leere Felder mit Marker „· vom Melder",
Seite(n), Abdeckung, „bestehende Quelle" bei Katalogtreffer mit gesperrten Katalogfeldern wie im
Zustand 3 der Adresse). Der Rest ist die Eingabezeile, wie sie ist: `add` / `add_existing` mit
`source_type_chosen`/`is_official_chosen` nur bei ausdrücklicher Wahl, Korpusanlage, Abweichungen,
Rückfragen. Nach `Speichern` oder `Überspringen` die nächste Quelle; die Warteschlange lebt im
Bauteil (`state.meldung = { quellen, index }`), nicht im Aufrufer.

### 6.2 Stadtkarte (Server)

Nach Owner-Entscheid (§5.5). Bei (a): `avesmapsCreateCitymapFromReport` ruft
`avesmapsAddFeatureSource` mit `$type = ''`, `$official = false`, Lizenz/Nennung aus dem
Melderangebot nur bei unbekanntem Wirt, und bekommt die Korpuswerte über §6.3.

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
   wochenlang. Der Eingang behandelt `official` und `type` als **nicht vorhanden**, nie als Aussage
   — sonst hinge der Riegel an der Ladefrist einer Datei.
2. 💣 **Ein Titel ohne Treffer ist keine Quelle.** Das Hauptfeld nimmt Titel für die Vorschlagsliste;
   ohne Pick gibt es keine `source_id`, und ohne Link keine Identität. Der Knopf muss ablehnen —
   sonst entsteht genau die link-lose Zeile, die §1.2 zeigt. ⚠️ Das Titelfeld in der Falte ist
   etwas anderes: es ergänzt einen LINK um einen Namen, es ersetzt ihn nicht.
3. 💣 **Melderangebote füllen Leere, sie überschreiben nichts** (§5.2). Eine Lizenz vom Melder, die
   dem Korpus widerspricht, steht als Hinweiszeile daneben — der Editor entscheidet, und ein
   Speichern ohne Anfassen nimmt den Korpuswert.
4. 💣 **Die Vorbelegung ist lokal.** Kein Abruf nach draußen in der Review-Liste (§5.1). Der
   Seitentitel wird erst im Annahme-Dialog geholt, einmal je Zeile.
5. 💣 **Die Korpuswerte gelten nur der NEUEN Zeile.** `avesmapsSourceOfficialWriteAllowed` und
   `retype` bleiben, wie sie sind; §6.3 setzt nur Vorgaben, wo heute Leere stünde.
6. 💣 **Der Kartenvorschlag ist ein zweites Formular mit eigener Absende-Funktion**
   (`map-features-citymaps-suggest.js:441/700`) — beide Absender werden umgestellt, nicht einer.
7. ⚠️ **„Quelle" ist im Kartenvorschlag heute Pflichtfeld „Name".** Nach dem Umbau ist der Link
   Pflicht — ein Melder, der den Namen kennt und den Link nicht, muss den Titel aus dem Katalog
   picken. Steht das Werk nicht im Katalog, kann er es nicht melden. Das ist der Preis der Regel und
   gewollt (Owner: „einfach den link pasten").
8. 🪤 **Enter im Feld:** an `#report-source-label` hängt in `js/app/bootstrap.js` ein Enter-Handler
   („Enter legt die Quelle an"), und die Vorschlagsliste muss VOR ihm registriert sein
   (`stopImmediatePropagation`, Memory `quellen-autocomplete-5a`). Das neue Feld erbt beides — die
   Kennung wechselt, die Verdrahtung zieht mit.
9. 💣 **Die offene Falte ist eine Ausnahme mit Ende.** „Immer zu" (Owner 03.09.2026) gilt weiter;
   offen ist sie nur, solange `state.meldung` Quellen hält, und der Bauer setzt `open` genau aus
   diesem Zustand — kein zweiter Merker. Nach der letzten Quelle zeichnet das Bauteil wie immer
   aus der Serverantwort neu, und die Falte ist zu.
10. 💣 **Schreibgeschützt heißt `disabled`, nicht „weggelassen".** Die Karte zeigt ALLE Felder
    (Owner). Ein Feld, das nur im Annahme-Dialog erscheint, wäre eine Abweichung zwischen Sichten
    und Annehmen — der Editor sähe beim Sichten weniger, als die Annahme anlegt.
11. 💣 **Die Falte in der Liste überlebt den Poll.** Die Karte wird beim Live-Poll (45 s) neu
    gezeichnet — eine offene Falte muss ihren Zustand vor dem Neuzeichnen retten (Merker am
    `details`-Element lesen, wie die Auswahl der Zoombänder-Tafel).
12. 💣 **Der Warnton auf dem Panel ist der WEICHE** (`--color-warning-soft-text`). `-strong-text` ist Text AUF einer
    Warnfläche (dunkel `#241d14`) und misst auf dem Panel 1,34:1 — im Browser gemessen am 03.09.2026, bevor es
    jemand las. Gilt der Absage beim Melder wie jedem Warnsatz im Backend.
13. 💣 **Die Lizenztafel gibt es EINMAL** (`featureSourceLicenseTable`, `feature-source-markup.js`).
    Das Meldeformular baut seine Auswahl daraus, nicht aus einer Kopie — die Falle der doppelten
    Liste, die dieses Haus bei der Seitenkürzung schon bezahlt hat.
14. 🪤 **Die Warteschlange reist MIT dem Öffnen-Aufruf, nicht über den Zustand danach** (nach dem Bau
    gefunden, 03.09.2026 abends). `mountLocationEditFeatureSources` läuft beim Öffnen und liest
    `opts.meldung` SYNCHRON; ein Öffner, der die Warteschlange erst nach `openLocationEditDialog()`
    in den Modulzustand schreibt, kommt zu spät — der Kasten steht dann leer, die Falte zu, und nichts
    meldet es. Die alte Vorschlagsgruppe hatte das nur überlebt, weil sie im `.then` NACH der
    Serverliste gelesen wurde: eine Zusage aus dem Timing. Deshalb `openLocationEditDialog({ …,
    meldungQuellen })` und die Zuweisung in `populateLocationEditForm` VOR dem Mount; ein Dialog
    ohne Option bekommt `[]`, damit die Meldung des vorigen Dialogs nicht klebt. Der Ablauf wird
    AUSGEFÜHRT (`meldung-warteschlange-erreicht-den-mount.test.js`) — der Regex „beide Öffner füllen
    die Warteschlange“ war grün, während der Kasten leer blieb.

---

## 8 · Offene Fragen an den Owner

1. ✅ **Die Karten-Annahme** (§5.5): Owner 03.09.2026 — „a erstmal lassen, wir schauen, was die
   editoren sagen". Also (a): serverseitig, die Quelle entsteht beim Klick auf „Anlegen" mit
   Korpuswerten, korrigierbar danach im Stadtkarten-Editor; (b) bleibt als späterer Schritt notiert.
2. **Die Falte „Mehr zur Quelle"** bietet Titel, Abdeckung, Lizenz, Namensnennung. Der Satz brach
   nach „seite, lizenz und" ab — sind **Titel** und **Namensnennung** gemeint, oder nur die
   Abdeckung und die Lizenz?

Beantwortet (03.09.2026): Quellen bei Änderungswünschen bleiben optional · kein Satz „Kennen wir
schon" beim Melder („verwirrt nur") · die Abdeckung wird dem Melder optional angeboten.

---

## 9 · Abnahmeliste (Ablauf, nicht Maß)

- [ ] Meldeformular „Karteneintrag melden": Link einfügen → Zeile steht mit ↗; Titel tippen →
      Vorschlag picken → Zeile mit Titel; Titel ohne Pick → Ablehnung mit Satz; die Falte „Mehr zur
      Quelle" nimmt Titel, Abdeckung, Lizenz, Namensnennung, und alle vier reisen mit; kein Satz
      zur Erkennung.
- [ ] „Änderung vorschlagen": dieselbe Zeile, Quelle optional.
- [ ] „Karte vorschlagen": Link Pflicht, Seite optional, Falte wie oben, kein Art-Feld, kein Haken.
- [ ] Review-Liste: Falte „n Quellen aus der Meldung", darin je Quelle das normale Formular,
      schreibgeschützt, alle Felder, „· vom Korpus" bei bekanntem Wirt, „· vom Melder" wo der
      Melder Leeres gefüllt hat, Melderhinweis neben einem abweichenden Korpuswert, Korpusreichweite
      im Rahmentitel; die Falte überlebt den 45-s-Poll.
- [ ] Annahme Ort (neu und Änderung): die Eingabezeile zeigt „Quelle 1 von n", vorausgefüllt nach
      §5.2; Speichern legt an (bekannte Adresse → verknüpft; neue Adresse eines bekannten Korpus →
      Zeile mit Korpuswerten, Titel vom Melder oder von der Seite; neue Domain → Korpus anlegen im
      selben Formular); Überspringen nimmt nicht; nach der letzten Quelle ist die Falte zu. Beim
      neuen Ort wird gepuffert, bis die Kennung da ist.
- [ ] Annahme Stadtkarte: nach Owner-Entscheid (a) oder (b).
- [ ] Alter Client (Rumpf mit `official: true`, `type: abenteuer`): gespeichert wird beides nicht.
- [ ] `?lang=en`: alle Beschriftungen des Blocks englisch.
- [ ] Testfeld über beide Workflow-Muster grün; neue Zusicherungen gegen Mutationen.
