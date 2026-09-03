# Quellen am Weg — das EINE Bauteil für Kartendialog, Wege-Editor und Weg-Ebene

**Stand:** 03.09.2026 · **Schritt 3 von 4** des Quellen-Umbaus (nach Herrschaftsgebieten; vor Altquellen
und Landschaften) · **Betrifft:** Kartendialog „Weg bearbeiten" (`#path-edit-dialog`, `js/review/review-paths.js`),
Wege-Editor (`html/wege-editor.html`, `js/pages/wege-editor.js`, `-model.js`) mit Abschnitts- und Weg-Ebene,
Endpunkt `api/edit/map/feature-sources.php` + `api/_internal/app/feature-sources.php`, Listen-Endpunkt
`api/edit/map/paths-editor.php`
**Anlass:** Owner — „WEGE. Dialog + Wege-Editor, samt der Weg-Ebene („gilt für alle 8 Abschnitte"). Quellen
hängen am ABSCHNITT, nie am Gruppenschlüssel — die Gruppe ist ein Verteiler, keine Ablage. „Andere Quelle"
fällt auch hier weg."
**Mockup:** `docs/quellen-wege-mockup.html` (trägt den Vertrag, §5)

---

## 1 · Befund — gemessen an der Live-Nutzlast vom 03.09.2026

| Was | Zahl |
|---|---|
| Wegabschnitte (`feature_type = path`) | 6.043 |
| Wege (Gruppen nach `wpGroupWays`-Schlüssel) · davon mehrteilig | 4.136 · 470 |
| Abschnitte mit Quellen · Verweise | 2.175 · 29.137 |
| Mehrteilige Wege mit Quellen · Quellen darin | 277 · 2.511 |
| … davon an ALLEN Abschnitten · nur an einigen | **2.347** · 164 |
| Wege mit Teilmengen-Quellen | **12** — alle mit `name:`-Schlüssel (Rathilstieg 12 Abschnitte, Waldstraße, Pfad-5371 …), und KEINER trägt daneben eine Quelle an allen Abschnitten: das sind gleichnamige, nicht zusammenhängende Wegstücke, keine halb belegten Wege |
| Abschnitte mit Altquelle `properties.other_source` (`os:`-Zeilen in der Nutzlast) | 116 |
| Die längsten Wege | Reichsstraße 2 (56), Seneb-Horas-Straße (56), Reichsstraße 3 (53) |

**Die Leseseite ist da, die Schreibseite fehlt.** `path` steht in beiden Whitelists, die Infobox zeichnet
Wegquellen aus `feature_sources["path:<public_id>"]`. Eintragen kann man nur „Andere Quelle" — ein Paar
`url/label` in `properties.other_source`, an DREI Stellen: Kartendialog (`path-edit-other-source-section`),
Wege-Editor Abschnitt (`#wpSourceUrl`), Weg-Ebene (`#wpGroupSourceUrl`, Feld `other_source` in
`AVESMAPS_PATH_GROUP_FIELDS`). Dazu klassifiziert der Filter „Quelle" des Wege-Editors (Wiki / Andere /
Keine) über genau dieses Feld (`sourceCategory`, `wege-editor.js:201`).

**Der Schlüssel ist instabil — deshalb hängt nichts an ihm.** Der Gruppenschlüssel ist `wiki:<key>`, und
`name:<Wegart>:<Name>` als Rückfall (`wpGroupWays`, `avesmapsWegGruppenSchluessel`). Eine Quelle an einem
Namensschlüssel wanderte beim Umbenennen mit; beim Schattenbachpass bilden zwei von sieben Abschnitten
ohne Wiki-Zuweisung schon heute eine eigene Gruppe. Owner (03.09.2026): „perfekt, das ist ganz wichtig".

---

## 2 · Die Regeln

1. **Quellen hängen am ABSCHNITT**: `entity_type = path`, `entity_public_id = map_features.public_id` — die
   Zeilen, die die Karte heute schon liest. Es gibt keine Ablage am Weg.
2. **Der Weg ist ein VERTEILER beim Schreiben.** Der Client schickt die `public_ids` seiner Gruppe
   (`entity_public_ids`); der Server bildet die Gruppe NICHT nach — dieselbe Regel wie
   `update_path_group_details`. Deckel: `AVESMAPS_PATH_GROUP_MAX_SEGMENTS` (250).
3. **Vorgabe ist der ganze Weg.** 2.347 von 2.511 Quellen an mehrteiligen Wegen hängen bereits an allen
   Abschnitten; wer am Abschnitt eine Quelle einträgt, meint fast immer den Weg. Umstellbar auf „nur dieser
   Abschnitt".
4. **Entfernen und Bearbeiten (✕, ✎) gelten dort, wo die Zeile steht:** am Abschnitt nur dem Abschnitt, auf
   der Weg-Ebene allen Abschnitten. Die Wahl im Eingabeformular betrifft das EINTRAGEN — ein ✕ darf nicht an
   einer Auswahl hängen, die in einer zugeklappten Falte steht.
5. **Quellen stehen unten** (Owner 03.09.2026): im Kartendialog nach der Strömung vor der Knopfleiste, im
   Wege-Editor als letzter Block vor der Speicherleiste — auf beiden Ebenen.
6. **„Andere Quelle" fällt an allen drei Stellen**, ohne Migration hier: die 116 Altwerte bleiben in
   `properties.other_source`, die Nutzlast zeigt sie weiter als `os:`-Zeilen, und der Takeover beim Öffnen
   eines Abschnitts (`avesmapsFeatureSourcesTakeoverOtherSource`, läuft bei `list`) holt sie in den Katalog —
   der Rest ist Schritt 4.

---

## 3 · Was gebaut wird

### 3.1 Endpunkt: `entity_public_ids` — der Verteiler

`api/edit/map/feature-sources.php` nimmt neben `entity_public_id` (dem ANKER, weiter Pflicht) eine
optionale Liste `entity_public_ids` (Zeichenketten, ≤ 250, muss den Anker enthalten; gleicher
`entity_type`) für `list`, `add`, `add_existing`, `update`, `remove`:

- **`list`** mit Liste: Takeover je Kennung; EINE Abfrage `entity_public_id IN (…)`, gruppiert nach
  `source_id`; je Zeile zusätzlich `segments` (an wie vielen Kennungen sie hängt) und `segments_of` (N);
  dazu `by_entity: { "<id>": [source_id, …] }` — damit der Kartenspeicher (`syncFeatureSourcesToClientCache`)
  jede Kennung richtig nachzieht, nicht alle mit der Vereinigung. `wiki_url` = die des Ankers, `revision`
  null (mehrere Zeilen, kein einzelner Sperrtoken).
- **`add` / `add_existing` / `update` / `remove`** mit Liste: dieselbe Bibliotheksfunktion je Kennung in
  einer Schleife (`avesmapsAddFeatureSource`, `avesmapsLinkExistingFeatureSource`,
  `avesmapsUpdateFeatureSource`, `avesmapsRemoveFeatureSource`), danach die Vereinigungsliste. Bei `update`
  gilt `confirm_catalog` wie bisher; der Katalogteil wird ohnehin nur einmal geschrieben (dieselbe `sources`-
  Zeile), der Verknüpfungsteil je Kennung.
- Der Zeilen-Mapper von `avesmapsListFeatureSourcesForEdit` wird in `avesmapsFeatureSourceEditorRows(…)`
  ausgelagert und von beiden Listen benutzt — **keine zweite Fassung** der 60 Zeilen.
- 💣 `map_revision` bumpt je Kennung wie bisher — bei 56 Abschnitten 56 Bumps; das ist ein Zähler, kein
  Kostenfaktor, und eine Sonderbehandlung wäre ein zweiter Pfad.

`api/edit/map/paths-editor.php` liefert je Weg `source_count` (eine Aggregatabfrage über
`feature_sources`, wie `sourceCounts` im Territorienbaum) und verliert `other_source`.

### 3.2 Bauteil: `opts.gruppe`

`mountFeatureSourceEditor(container, "path", getter, { gruppe })` mit
`gruppe = { publicIds: () => string[], fest: boolean }` (die Liste wird bei JEDER Anfrage gelesen):

- **Dritter Rahmen des Eingabeformulars** bei N > 1: Titel „An diesem Weg"; darunter eine Wahlzeile
  (`.fs-scope__choice`): **(•) alle N Abschnitte dieses Weges** (Vorgabe) · ( ) nur dieser Abschnitt. Bei
  `fest` (Weg-Ebene) kein Radio, Titel „An allen N Abschnitten dieses Weges". Bei N = 1 unverändert „Nur
  an diesem Objekt".
- **Anfragen:** `fest` → jede Aktion trägt `entity_public_ids`; sonst nur `add`/`add_existing`, und nur, wenn
  „alle" gewählt ist. `list` am Abschnitt bleibt die Liste des Abschnitts.
- **Zeile:** hängt eine Quelle nur an einigen Abschnitten (`segments < segments_of`), trägt der Titel eine
  Marke `.fs-row__segments` „12 von 56 Abschnitten" (11px, `title` mit Satz). An allen: nichts — das ist der
  Normalfall, und eine Marke, die fast immer da ist, sagt nichts.
- **Kartenspeicher:** kommt `by_entity`, wird je Kennung nachgezogen; sonst wie bisher der Anker.
- Die Falte „Neue Quelle einfügen" bleibt, wie sie ist.

### 3.3 Kartendialog „Weg bearbeiten" (`index.html`, `js/review/review-paths.js`)

Kasten wie im Orts- und Herrschaftsgebiets-Dialog (`.label-edit-section` „Quellen", Hinweiszeile, Host
`#path-edit-feature-sources`) **nach der Strömung, vor der Knopfleiste**. Mount in `populatePathEditForm`
(Klon-Ersatz, `__fsDetachAutocomplete`), Getter liest `#path-edit-public-id` bei jeder Anfrage; `gruppe.publicIds`
= alle Abschnitte aus `pathData` (`js/app/runtime-state.js`) mit demselben `avesmapsWegGruppenSchluessel`,
`fest: false`. `path-edit-other-source-section` fällt, ebenso `writeOtherSourceToForm("path-edit")`,
`readOtherSourceFromForm("path-edit")` und `other_source` im Rumpf.

### 3.4 Wege-Editor (`js/pages/wege-editor.js`, `-model.js`, `html/wege-editor.html`)

- **Abschnitt:** `<div class="dt-grp">Quellen</div><div id="wpFeatureSources"></div>` als letzter Block vor
  der Speicherleiste (nach der Wiki-Zuweisung, wo „Andere Quelle" stand); Mount in `wireDetail` mit Getter
  `state.selected`, `gruppe.publicIds` = Segmente der Gruppe aus `findGroup(avesmapsWegGruppenSchluessel)`
  (der Editor hat `wpGroupWays`), `fest: false`.
- **Weg-Ebene:** `<div class="dt-grp">Quellen</div><div id="wpGroupFeatureSources"></div>` vor der
  Speicherleiste; Mount mit Getter = erstes Segment (Anker), `gruppe.publicIds` = alle Segmente,
  `fest: true`.
- **Filter „Quelle":** `sourceCategory` liest `source_count` statt `other_source` („Andere" = Quellen ohne
  Wiki-Zuweisung).
- „Andere Quelle" fällt: Render (476–482, 1251–1259), `wireDetail`/`wireGroupDetail`, `state.draft.other_source`,
  Rumpf von `update_path_details`, `groupDraft.other_source`, `wpGroupFieldStates`/`wpGroupChangedFields`
  (`other_source` aus der Feldliste des Modells), Rumpf von `update_path_group_details`.
- Die Seite lädt `css/features/feature-sources.css` und die drei Modulskripte vor `wege-editor.js`.

### 3.5 Server: `other_source` an Wegen

`update_path_details` (features.php, der Block um `avesmapsReadOptionalOtherSource`) und
`AVESMAPS_PATH_GROUP_FIELDS`/`avesmapsUpdatePathGroupDetails` (`$wantsSource`) verlieren `other_source`;
`avesmapsReadOptionalOtherSource` bleibt für Orte und Beschriftungen (Schritt 4). Der Takeover bei `list`
bleibt der Weg der 116 Altwerte in den Katalog.

---

## 4 · Was NICHT gebaut wird

- Keine Migration der 116 Altwerte in einem Lauf — das ist Schritt 4 (alle 314, samt Orten und
  Beschriftungen), und der `os:`-Erzeuger in `map-features.php` fällt erst dort.
- Keine Ablage am Gruppenschlüssel, kein „Weg-Objekt" in `feature_sources`.
- Keine Änderung an der Infobox; sie liest weiter je Abschnitt.
- Kein Nachziehen des Filters „Quelle" im Wege-Editor beim Eintragen — die Liste lädt beim nächsten
  Öffnen, wie bei jeder anderen Zeile dort.

---

## 5 · Was bindet

| Zusage | Wächter |
|---|---|
| `.fs-scope__choice`, `.fs-row__segments` zeichengleich | **VERTRAG** im Mockup → `css/features/feature-sources.css` |
| `entity_public_ids`: Deckel, Anker enthalten, gleicher Typ; Vereinigung mit `segments`/`segments_of`/`by_entity`; Aktion je Kennung; EIN Mapper | `api/_internal/app/__tests__/quellen-verteiler-test.php` (SQLite, ausgeführt) |
| Bauteil: Wahlzeile nur bei N>1, `fest` ohne Radio; Anfragen tragen die Liste genau nach Regel 4; Marke nur bei Teilmenge; Kartenspeicher je Kennung | `js/review/__tests__/quellen-verteiler.test.js` (Mount mit Attrappe ausgeführt) |
| Kartendialog: Kasten unten, Mount in `populatePathEditForm`, Gruppe aus `pathData`, kein `other_source` | `js/review/__tests__/quellen-im-wegedialog.test.js` |
| Wege-Editor: beide Hosts vor der Speicherleiste, Mounts, Filter über `source_count`, kein `other_source` | `js/pages/__tests__/quellen-im-wege-editor.test.js` |
| Server ohne `other_source` an Wegen, `source_count` in der Liste | `api/_internal/map/__tests__/wege-gruppe-schreiben-test.php` (angepasst), `api/edit/map/__tests__/…` |
| `andere-quelle-immer-sichtbar.test.js` verliert `path-edit`; `wege-gruppe-{felder,ablauf}.test.js` verlieren `other_source` | Anpassung mit Grund |

---

## 6 · Abnahmeliste

- 💣 **Der Anker muss in der Liste stehen**, sonst antwortet die Vereinigung für Kennungen, von denen die
  Oberfläche nichts zeigt; und die Liste ist gedeckelt, sonst schickt ein kaputter Client 6.000 Kennungen.
- 💣 **`by_entity` je Kennung nachziehen, nie die Vereinigung an alle** — sonst zeigt die Infobox eines
  Abschnitts Quellen, die an einem anderen hängen (die 164 Teilmengen).
- 💣 **✕ und ✎ am Abschnitt gelten dem Abschnitt** — die Wahlzeile steht in einer zugeklappten Falte.
- 💣 **Die Gruppe wird bei JEDER Anfrage neu gelesen** (`publicIds()` als Funktion): im Wege-Editor wechselt
  die Auswahl, ohne dass sich ein Dialog öffnet.
- ⚠️ **Der Getter der Weg-Ebene ist der erste Abschnitt** — ein Weg hat keine eigene Kennung, und die
  Antwort braucht einen Anker für `wiki_url`.
- ⚠️ Der Filter „Quelle" zählt Katalogquellen; ein Weg mit Wiki UND Quellen bleibt „Wiki" (wie bisher).
- 🔴 **Abnahme heißt Ablauf:** Abschnitt öffnen → Quelle mit „alle N" eintragen → Nachbarabschnitt öffnen: sie
  ist da → dort ✕: nur dort weg → Weg-Ebene: Marke „N−1 von N" → dort ✕: überall weg.
