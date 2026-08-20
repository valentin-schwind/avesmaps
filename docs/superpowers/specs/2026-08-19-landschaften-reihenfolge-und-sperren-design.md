# Landschaften: Reihenfolge und Sperren

**Stand:** Entwurf, 19.08.2026 · **Mockup:** `docs/landschaften-sperren-mockup.html`

## 1. Anlass

Owner, wörtlich: „manche regionen im landschaftseditor sind zu groß verdecken alles, zwei
ideen: sortieren oder sperren. ich würde gerne beides anbieten … und gleichzeitig ‚Element
sperren' zur Option stellen, dass der Mauscursor diese nicht abfängt. tooltips sollen
erhalten bleiben. es geht nur um die klicks. Zum Entsperren braucht es einen weiteren
Menüpunkt der Liste (autosuche) beinhaltet."

Der Befund dahinter: die Ebene ist inzwischen fast lückenlos gezeichnet. Eine große Fläche
liegt zwar nach der heutigen Größenregel unten im Stapel, **fängt aber überall dort den
Klick ab, wo keine kleinere über ihr liegt** — und das ist der größte Teil der Karte. Die
Folge ist nicht nur „ich erwische die falsche Fläche", sondern „es gibt keine freie Karte
mehr": kein Kartenmenü, kein „Hier hinzufügen", kein „Hierher reisen".

Dasselbe Motiv hat schon einmal etwas gekostet — die Kommentar-Begründung des
Flächenmenüs (2026-07-29) nennt genau diesen Grund dafür, dass die vier Anlege-Einträge
zusätzlich ins Flächenmenü mussten. Damals war die Antwort, das Menü zu verdoppeln. Jetzt
ist die Antwort, die Fläche durchlässig zu machen.

## 2. Owner-Entscheide

Alle vom 19.08.2026, im Gespräch getroffen:

1. 🔴 **Beides wandert in die Datenbank und gilt für jeden Editor** („wandert in die
   Datenbank, gilt für jeden Editor"). Kein `localStorage`, keine Arbeitshilfe je Browser.
2. 🔴 **Die Reihenfolge wird eine Karteneigenschaft** („die sortierung muss eine
   karteneigenschaft werden"). Sie ist es heute **nicht** — sie wird bei jedem Laden im
   Browser aus der Flächengröße gerechnet.
3. 🔴 **Die Größenregel wird zur Startaufstellung und danach aufgelöst** („dann nimm das
   als grundlage für die initiale sortierung und lös die regel danach auf").
4. 🔴 **Gesperrt wird alles, was zur angeklickten Region gehört** („genau alles was ich
   anklick wird gesperrt. auch multipolys oder mehrere zusammenhängenden flächen einer
   region").
5. 🔴 **Die Sperre steht auch im Eigenschaften-Dialog** („du kannst die eigenschaft auch
   hier anbieten"), als vierter Haken neben Auto-Name / Regionname anzeigen / Nodix.
6. 🔴 **Das Menü wird vorher aufgeräumt** („genau so" auf den Vorschlag, drei Familien in
   Untermenüs zu schieben und das als eigenen Schritt live zu geben).

## 3. Was gebaut wird — zwei Schritte, zwei Deploys

💣 **Sie gehen EINZELN live** (AGENTS.md §9). Schritt A ist eine sichtbare Änderung an
einer viel benutzten Editor-Oberfläche und darf nicht mit einem neuen Feature im selben
Aufschlag stehen: klemmt danach etwas, weiß niemand, ob es am Umbau oder am Neuen lag.

### Schritt A — das Flächenmenü aufräumen (nichts Neues, nichts weg)

Heute trägt das Flächenmenü **17** Einträge plus das Untermenü „Neue Fläche". Drei
Familien wandern in Untermenüs:

| Untermenü | Einträge | von → auf |
|---|---|---|
| **Form ändern ▸** | Verschieben · Fläche zerschneiden · Fläche malen · Fläche radieren · Fläche vereinfachen | 5 → 1 |
| **Mit anderer Fläche ▸** | Mit anderer vereinigen · Von anderer ausschneiden · Von anderer ausschneiden und andere beibehalten · Neue von anderer ausschneiden | 4 → 1 |
| **Unterflächen ▸** | Alle Unterflächen vereinigen · Unterfläche herauslösen · Unterfläche löschen | 3 → 1 |

Danach stehen oben: Neue Fläche ▸ · Fläche bearbeiten · Form ändern ▸ · Mit anderer
Fläche ▸ · Unterflächen ▸ · Eigenschaften … · Kopieren … · Fläche löschen — **8 statt 17**,
und mit dem Untermenü aus Schritt B **9**.

- 🔴 **„Fläche bearbeiten" bleibt oben.** Es ist der sichtbare Zwilling des Doppelklicks
  und wurde 2026-08-07 genau deshalb eingeführt („eine Geste, die man kennen muss, ist für
  den, der sie nicht kennt, keine"). In ein Untermenü geschoben, wäre es das wieder.
- ⭐ **Die vier Verrechnungen sind der eigentliche Gewinn**, doppelt: sie sind eine echte
  Familie (alle vier starten dieselbe Geste — `setLayerPicking(true)` und „jetzt die zweite
  Fläche anklicken"), und sie sind die vier **längsten** Beschriftungen. Sie bestimmen
  heute die Breite des ganzen Kastens; im Mockup gemessen 344 px → 236 px.
- ⚠️ **„Unterfläche löschen" verliert seinen roten Sonderplatz ganz unten.** Es steht
  künftig rot im Untermenü „Unterflächen". Die Einfügeregel von `addEntry` („jeder
  nicht-gefährliche Eintrag vor den ersten gefährlichen") sortiert dann nur noch das
  oberste Menü.
- 💣 **Dieselben drei Untermenüs im Herrschaftsgebiete-Menü** (`#region-context-menu`,
  `index.html`, 11 Einträge → 7). Der Wortlaut der vier Verrechnungen wurde dort
  **absichtlich abgeschrieben** (Kommentar in `map-features-ecosystem-geometry-ops.js`:
  „zwei Vokabulare für dieselbe Geste wäre die eigentliche Zumutung"). Nur eines der beiden
  Menüs umzubauen ließe sie in der FORM auseinanderlaufen, während die WORTE gleich
  bleiben — die unangenehmste Sorte Divergenz, weil sie sich nicht vorlesen lässt.
- 💣 **Kein `action`-Wert ändert sich.** `data-ecosystem-area-action` ist gleichzeitig der
  Schlüssel des Handlers (`areaMenuEntryHandlers`) **und** der Selektor der Glyphe
  (`css/components/map-context-menu.css`, ~20 Regeln). Ein umbenannter Eintrag verliert
  lautlos seine Glyphe — und ohne `content` entsteht das `::before` gar nicht, die
  Beschriftung wird zum ersten Rasterelement und beginnt bei 12 statt 41 px. Genau das ist
  in diesem Menü schon dreimal passiert und steht dreimal als Warnung im CSS.
- ⭐ **Der Gruppenmechanismus existiert schon**: `addEntry({ group: "new-area" })` hängt
  einen Eintrag ins Untermenü statt in die flache Liste (`ensureAreaMenuGroup`). Er wird
  von „aus Territoriumsgrenze" benutzt und muss nur von *einer* festen Gruppe auf mehrere
  verallgemeinert werden — keine zweite Bauform, kein zweites Untermenü-Aussehen im Haus.

### Schritt B — Reihenfolge und Sperre

Drei Oberflächen, ein Datenmodell:

1. **Untermenü „Reihenfolge und Sperren ▸"** im Flächenmenü: *Region in den Vordergrund* ·
   *Region in den Hintergrund* · *Region sperren* (Umschalter) · *Alle Regionen …*
2. **Haken „Für Klicks gesperrt"** im Eigenschaften-Dialog, als vierter unter den drei
   bestehenden, mit einer Erklärzeile darunter. Derselbe Schalter, zweiter Weg dorthin.
3. **Fenster „Reihenfolge und Sperren"**: Ebenen-Chips · Suchfeld · die Regionen dieser
   Ebene in ihrer Stapelreihenfolge (oben = vorn), je Zeile ⤒ / ⤓ / Schloss.
4. **Zähler „🔒 3"** in der Landschaften-Leiste — zugleich der zweite Weg ins Fenster.

## 4. Datenmodell

Zwei Spalten auf **`ecosystem_region`** (nicht auf `ecosystem_area`):

```
stack_order  INT NOT NULL DEFAULT 0     -- höher = weiter vorn, je Ebene (`kind`) eigener Zahlenraum
is_locked    TINYINT(1) NOT NULL DEFAULT 0
```

🔴 **Warum die Region und nicht die Teilfläche** — drei Gründe, die alle in dieselbe
Richtung zeigen:

1. Owner-Entscheid 4: gesperrt wird alles, was zum angeklickten Ding gehört.
2. **Nur Regionen haben einen Namen.** Eine `ecosystem_area` hat keinen; der Schwebezettel
   zeigt `region_name`. Ein Fenster mit Autosuche über namenlose Zeilen ist keins.
3. Die Verschachtelung, für die es die Reihenfolge überhaupt gibt — Kontinent ⊃ Insel ⊃
   Provinz — sind **Regionen**. Zwei Teilflächen derselben Region überlappen einander
   nicht sinnvoll; ihre relative Ordnung ist bedeutungslos.

🔴 **Korrigiert beim Bau (19.08.2026): BEIDE werden protokolliert.** Der Entwurf sagte hier
„kein Audit-Eintrag — `ecosystem_geometry_audit_log` protokolliert Geometrie". Beim Bauen
stellte sich das als bereits überholt heraus: die Sperre läuft über `update_region`, und das
schreibt seit jeher eine Audit-Zeile. Sie herauszunehmen wäre Arbeit gewesen, um eine
Auskunft zu verlieren; `set_region_stack` schreibt seine deshalb genauso. Beide Zeilen sind
klein und die Tabelle wird gestutzt (`audit-prune.php`).

### Die DDL

Über den vorhandenen `information_schema`-Weg in `avesmapsEcosystemEnsureTables`
(`api/_internal/app/ecosystem.php`) — dieselbe Bauform wie `terrain_grain` und Nachbarn.
`CREATE TABLE IF NOT EXISTS` ist auf einer bestehenden Tabelle ein No-op; das steht dort
seit dem ersten Tag als Kommentar.

💣 **Der Lesepfad ist hier ausnahmsweise sicher — und das ist eine Zusicherung, keine
Beobachtung.** `api/app/ecosystem-areas.php:102` ruft `avesmapsEcosystemEnsureTables($pdo)`
**vor** `avesmapsEcosystemReadAreas`. Deshalb existieren die neuen Spalten, wenn der Leser
sie liest, und es braucht keinen `'' AS spalte`-Rückfall wie bei
`wiki_sync_pages.deity` (15.08.2026, zehn Minuten stiller Ausfall live). ⚠️ Wer diesen
Aufruf je aus Leistungsgründen entfernt, nimmt genau diese Zusicherung weg — dann muss der
Rückfall zuerst gebaut werden.

## 5. Die Startaufstellung — die Regel läuft genau einmal

Heute rechnet `ecosystemStackingOrder` (`map-features-ecosystem-rendering.js:550`) die
Reihenfolge bei jedem Laden im Browser: nach `ecosystemGeometryArea`, groß unten, klein
oben, bei Gleichstand stabil nach Eingangsreihenfolge. `applyEcosystemStackingOrder` (:567)
setzt sie mit `bringToFront` durch, je `kind` getrennt.

**Nach dem Umbau:**

- Ein **einmaliger Server-Lauf** rechnet je Region die Summe der Flächeninhalte ihrer
  aktiven `ecosystem_area`-Zeilen und vergibt `stack_order` je `kind` absteigend nach
  Größe — die größte bekommt die kleinste Zahl. Lücken zwischen den Zahlen (Schritt 10),
  damit „nach vorn"/„nach hinten" ohne Neunummerierung auskommt.
- 🔴 **Danach gibt es die Regel nicht mehr.** `ecosystemStackingOrder` und
  `applyEcosystemStackingOrder` werden **gelöscht**, nicht stillgelegt. Der Client sortiert
  nur noch nach dem, was im Payload steht. Eine schlafende zweite Ordnung wäre genau die
  Divergenz, die dieser Umbau abschafft.
- ⚠️ `ecosystemGeometryArea` selbst **bleibt** — sie trägt die Plausibilitätsprüfung der
  booleschen Operationen (`map-features-ecosystem-boolean.js`) und die Höhenkombination
  (`map-features-ecosystem-height-combine.js`). Gelöscht wird die Stapelregel, nicht die
  Flächenrechnung.
- 🔴 **Eine neue Region kommt ganz nach vorn** (`max(stack_order) + 10` ihrer Ebene). Ohne
  Regel gibt es keinen automatischen Platz mehr, und „das Neueste liegt obenauf" ist
  vorhersagbar. Sie nach Größe einzusortieren hieße, die Regel lebte halb weiter — und
  beim nächsten Mal wüsste niemand mehr, welche Ordnung gerade gilt.

### Die Flächenrechnung wandert nach PHP

Der Seed und die Geburt einer neuen Region laufen serverseitig, also braucht PHP dieselbe
Rechnung. Sie ist die Gauß'sche Trapezformel mit abgezogenen Löchern — `ecosystemGeometryArea`
ist genau das, zwanzig Zeilen.

⚠️ **Das ist keine zweite Wahrheit, sondern ein Umzug**: die JS-Fassung der *Stapelregel*
verschwindet im selben Schritt. Nach dem Umbau gibt es die Rechnung für die Reihenfolge nur
noch einmal, in PHP.

💣 **Der Seed läuft im ALTER-Zweig**, also in genau der einen Anfrage, die die Spalte
anlegt — und nicht als `WHERE stack_order = 0`-Nachlauf bei jedem Aufruf. `0` ist ein
gültiger Wert, sobald jemand von Hand sortiert hat; ein Nachlauf würde eine von Hand nach
ganz hinten geschobene Region beim nächsten Aufruf wieder einsortieren. Gegen zwei
gleichzeitige Anfragen sichert die Reihenfolge „ALTER, dann seed" plus eine
`SELECT … FOR UPDATE`-freie Prüfung „gibt es schon einen von 0 verschiedenen Wert in dieser
Ebene" — bei ~850 Flächen ist der Seed ein Lauf von Millisekunden.

## 6. Der Klick-Durchlass

**Die Anforderung ist ungewöhnlich präzise und muss es bleiben:** *„tooltips sollen erhalten
bleiben. es geht nur um die klicks."*

💣 **Deshalb ist `pointer-events: none` die falsche Antwort — obwohl es die
naheliegende ist.** Der Schwebezettel hängt an `layer.bindTooltip(…, { sticky: true })`
(`map-features-ecosystem-rendering.js:668`) und öffnet auf `mouseover` der Fläche. Ohne
Zeigerereignisse gibt es kein `mouseover`, also keinen Zettel. Wer die Sperre über CSS
baut, erfüllt die halbe Anforderung und merkt es nicht, weil beim Testen niemand wartet, ob
ein Zettel kommt.

**Stattdessen:** die gesperrte Fläche nimmt Zeigerereignisse weiter an (Zettel, Hover,
Kontur bleiben unverändert), und der **Klick wird weitergereicht**:

1. Die Pfade aller gesperrten Flächen kurz auf `pointer-events: none` stellen.
2. `document.elementFromPoint(clientX, clientY)` — das liefert, was darunter liegt.
3. Zurückstellen.
4. Das gefundene Element bedienen: gehört es zu einer Ecosystem-Fläche (Abgleich gegen
   `ecosystemLayers`), läuft derselbe Handler für diese Fläche; ist es die Karte selbst,
   wird ohne `stopPropagation` ausgestiegen — dann feuert Leaflets Kartenklick von allein.

⚠️ **Rekursionsriegel** auf dem weitergereichten Ereignis: liegen zwei gesperrte Flächen
übereinander, sind in Schritt 1 **beide** durchlässig, das Verfahren läuft also genau
einmal und nicht je Schicht.

💣 **DIE SPERRE MUSS AN JEDEM EINGANG STEHEN, NICHT AN EINEM.** Das ist die Falle vom
14.08.2026 (Verkehrsmittel-Sperre in zwei von vier Erzeugern) und vom 15.08.2026
(Ausstiegsregel in einem von drei), beide in AGENTS.md protokolliert. Die Eingänge sind:

| Eingang | wo |
|---|---|
| Linksklick (Auswahl, Infopanel) | `layer.on("click")`, `map-features-ecosystem-rendering.js` |
| Rechtsklick (Flächenmenü) | `layer.on("contextmenu")`, dieselbe Datei |
| Doppelklick (Eckpunkt-Editor) | `layer.on("dblclick")`, dieselbe Datei |
| Zielwahl der Zwei-Flächen-Gesten | `AvesmapsEcosystemGeometryOps.handleAreaClick` |

⚠️ **In den Kommentar gehört KEINE Zahl.** „Eingang 1 von 4" liest sich wie eine
vollständige Liste, und genau daran ist es am 14.08. gescheitert — es suchte niemand
weiter. Stattdessen: eine gemeinsame Weiche, durch die alle vier gehen.

🔴 **Nur im Bearbeiten-Modus.** Riegel ist `canOperateEcosystemLayers()` — dieselbe Frage,
an der schon `isEcosystemReaderClick()` hängt. Für einen Besucher wäre eine gesperrte
Region eine Region ohne Infopanel: ein Funktionsverlust, den er nicht erklären und nicht
rückgängig machen kann. Der Besucher merkt von der Sperre **nichts**; die Reihenfolge
dagegen gilt für ihn wie für alle, sie ist ja jetzt eine Karteneigenschaft.

## 7. Die Reihenfolge auf der Karte

- Der Client sortiert die geladenen Flächen je `kind` nach `stack_order` aufsteigend und
  ruft `bringToFront` in dieser Reihenfolge — die vorderste zuletzt. Bauform und Aufrufer
  (`map-features-ecosystem-loader.js:247`) bleiben, nur die Quelle der Ordnung wechselt.
- ⭐ Das verträgt sich besser mit dem Nachladen als die alte Regel: der Loader lädt nach
  bbox, und eine gespeicherte Zahl ordnet auch eine Teilmenge richtig, während eine
  Größenregel über eine Teilmenge nur zufällig dasselbe Ergebnis hat.
- ⚠️ **Wirkt nur innerhalb einer Ebene.** Die vier Ebenen liegen in Leaflet-Panes mit
  festem z-index (derographisch 250 · Vegetation 251 · Topographie 252 · Klima 253,
  `js/app/bootstrap.js`). Eine Vegetation lässt sich nicht über eine Topographie heben.
  Das ist dieselbe Feststellung wie bei Bug #69 — „die Pane-Leiter IST die Priorität und
  ist nicht einstellbar" — und der Grund, warum es dort ein anderes Trefferfeld
  (`pointer-events: stroke`) statt einer zweiten Reihenfolge wurde.
- ⚠️ **Klimazonen bleiben draußen**, bei Reihenfolge wie Sperre. Die Ebene wird abgeleitet,
  nicht gezeichnet (`avesmapsClimateAssertNotDerived`), und ihre Bänder decken die Karte
  ohnehin in voller Breite.

## 8. Endpunkte

- **Lesen:** `GET /api/app/ecosystem-areas.php` trägt `stack_order` und `is_locked` je
  Fläche mit (aus der Region gejoint, wie `region_name` und `kind` es schon tun).
- **Schreiben, die Sperre:** über das vorhandene `update_region`, Fähigkeit `edit`. Es nimmt
  **genau die Felder, die mitgeschickt werden** — dieselbe Regel wie beim Sammel-Speichern der
  Wege-Gruppe (19.08.2026) und aus demselben Grund: ein Schreibvorgang, der alle Felder setzt,
  macht jede gewollte Ausnahme platt. 💣 Gelesen wird mit `array_key_exists`, nicht `isset` —
  sonst wäre ein ausdrückliches `is_locked: false` lautlos wirkungslos.
- 🔴 **Schreiben, die Reihenfolge: `set_region_stack`, eine eigene Aktion.** Der Entwurf sah
  hier zunächst „kein neuer Endpunkt, `stack_order` reiht sich in `update_region` ein" vor.
  Das ist beim Bauen **widerlegt** worden: „ganz nach vorn" heisst *höchster Rang der Ebene
  + Schritt*, und diesen Rang kennt der Browser nicht — der Loader lädt nach bbox, er sieht
  also nur den Bildausschnitt. Eine dort gerechnete Zahl schöbe die Region hinter jede
  gerade nicht geladene, und zwei gleichzeitig drückende Editoren bekämen denselben Rang.
  Die Aktion nimmt `{public_id, position: "front"|"back"}` und rechnet in einer Transaktion.
  ⚠️ `stack_order` ist deshalb in `avesmapsEcosystemReadRegionFields` **kein** Feld: ein
  zweiter Weg zur selben Spalte wäre genau die Einladung, ihn doch im Browser zu rechnen.
- ⚠️ Der Eigenschaften-Dialog schreibt die Sperre über **seinen** vorhandenen Speicherweg
  mit (er speichert Name, Anzeige, Nodix, Art ohnehin in einem Zug). Kein zweiter Aufruf
  neben „Speichern", sonst ist „Abbrechen" für einen der beiden Werte wirkungslos.

## 9. Das Fenster

Gebaut nach `ecosystem-import-dialog` („Grenze aus Territorien") — dieselbe Hülle, dasselbe
Suchfeld, dieselbe Listenform. Kein neues Fensteraussehen.

- Ebenen-Chips für die drei bearbeitbaren Ebenen; die Liste zeigt die aktive.
- Zeile: Position · Name · Art und Flächenzahl · ⤒ ganz nach vorn · ⤓ ganz nach hinten ·
  Schloss auf/zu.
- 🔴 **„Vorn"/„hinten" heißt immer *ganz*** — im Menü wie im Fenster. Eine Stufe im einen
  und „ganz" im anderen wären zwei Bedeutungen für dasselbe Wort. Jede Ordnung lässt sich
  durch wiederholtes Nach-vorn-holen herstellen.
- 🔴 **Warum es mehr ist als die vom Owner bestellte Entsperr-Liste:** was nach hinten
  geschoben wurde, ist unter Umständen per Rechtsklick nicht mehr erreichbar. Es braucht
  also ohnehin eine Stelle, an der **alle** Regionen stehen — die Entsperr-Liste ist darin
  enthalten.

## 10. Der Zähler in der Leiste

„🔒 3" neben dem Ebenen-Umschalter, zählt die gesperrten Regionen der **aktiven** Ebene,
öffnet dasselbe Fenster.

🔴 **Er ist der einzige Ort, an dem eine Sperre sichtbar wird.** Auf der Karte sieht eine
gesperrte Region **unverändert** aus — sie soll aussehen wie immer und nur den Klick nicht
abfangen. Ohne den Zähler sucht in zwei Wochen jemand eine Fläche, die nicht mehr reagiert,
und findet den Grund nicht. (Dieselbe Überlegung wie beim Prüfhaken-Grundsatz „ein Prüfhaken
zeigt seine Funde".)

## 11. Sprache und Beschriftung

- 🔴 Die Einträge sagen **„Region …"**, die Nachbarn **„Fläche …"**. Der Unterschied ist
  echt — „Fläche löschen" trifft eine Teilfläche, „Region sperren" das ganze Gebilde — und
  gehört ins Wort, nicht in eine Fußnote.
- Beschriftungen über `tr()`, nicht `data-i18n`: die Einträge werden injiziert, und der
  `data-i18n`-Lauf geht einmal über das Dokument, das er vorfindet. Bestehende Regel dieser
  Datei.
- Kennungen bleiben englisch und unverändert (`stack_order`, `is_locked`) — dieselbe
  Trennung wie „Neuigkeiten"/`changelog`.
- 💣 **„Sperre" heißt im Haus schon etwas anderes.** `map_feature_locks`
  (`api/_internal/map/features.php`) ist die **Bearbeitungssperre**: „dieses Objekt hat
  gerade jemand anderes offen", zeitlich befristet, mit `user_id` und `locked_until`. Unsere
  Sperre ist dauerhaft, gilt für alle und betrifft nur den Zeiger. `is_locked` ist noch
  nirgends vergeben (geprüft), aber `git grep lock` findet beide — deshalb steht der
  Unterschied als Kommentar an der Schreibstelle. Dieselbe Lehre wie bei `is_hidden`, das
  „von der Moderation verborgen" (`map_reviews`) und „verborgener Ort"
  (`properties.is_hidden`) gleichzeitig heißt.

## 12. Tests

| Test | sichert |
|---|---|
| `ecosystem-stapelreihenfolge.test.js` | Client sortiert nach `stack_order`, nicht nach Größe; stabil bei Gleichstand; die abgeschaffte Regel ist wirklich weg |
| `ecosystem-sperre-durchlass.test.js` | die reine Frage: gesperrt **und** Bearbeiten-Modus; alles Fehlende zählt als „nicht gesperrt" |
| `ecosystem-sperre-eingaenge.test.js` | jede Zeigergeste fragt die Weiche und steigt danach aus — zur **Laufzeit** gezählt, nicht per Grep (Vorbild `field-origins-test.php`). Gegen die entfernte Weiche gegengeprüft |
| `ecosystem-properties-sperre.test.js` | der Namensvertrag zwischen `index.html` und dem Dialog; genau EIN `update_region`-Aufruf im Fenster |
| `ecosystem-menue-struktur.test.js` | jede Gruppe steht in **beiden** Registern und hat eine Glyphenregel; die Zielreihenfolge stimmt |
| `ecosystem-flaeche-test.php` | PHP-Flächenrechnung == `ecosystemGeometryArea`, Löcher und MultiPolygon inbegriffen |
| `ecosystem-startaufstellung-test.php` | der Seed reproduziert die alte Ordnung — mit der abgeschafften Regel als **Zeugen** in der Fixture (Vorbild `zoombaender-vorgabe.test.js`); ein zweiter Lauf rührt nichts an |
| `ecosystem-stapel-schreiben-test.php` | Partialität; `is_locked: false` kommt durch; `stack_order` ist in `update_region` **kein** Feld |

⭐ **Was kein Unit-Test beantworten kann, haben Prüfseiten im echten Browser gemessen**
(untracked, `.gitignore: verify-*`): `verify-sperre-durchlass.html` fährt echtes Leaflet mit
zwei gestapelten Flächen und misst mit `elementFromPoint`, dass der Klick durchfällt, die
Karte zurückkommt, **der Zettel gebunden bleibt** und der Zeiger-Stil danach wieder auf dem
alten Wert steht. `verify-stapel-fenster.html` nimmt das echte Markup aus `index.html` und
das echte Modul und prüft Liste, Suche, Bilanz, Zähler und beide Schreibwege.

⚠️ Vor dem Push das **ganze** Testfeld, JS und PHP, samt der 21 `tools/wikidump/test-*.php`
(AGENTS.md §9).

## 13. Was die Weiche wirklich bindet

Der Entwurf zählte hier vier Eingänge auf und verlangte eine gemeinsame Weiche. Gebaut sind es
**drei** Zeigergesten der Fläche (`click`, `dblclick`, `contextmenu`) — und die Zielwahl der
Zwei-Flächen-Gesten braucht **keinen** eigenen Riegel:

⭐ `AvesmapsEcosystemGeometryOps.handleAreaClick` hängt am Klickhandler und bekommt den Klick
erst, **nachdem** die Weiche ihn durchgelassen hat. Bei einer gesperrten Region läuft der
Handler der Fläche darunter, und die wird zum Ziel — was genau die gewollte Antwort ist.
Ein zweiter Riegel dort wäre eine zweite Regel für dieselbe Frage.

⚠️ Damit steht im Code **keine Zahl** — die Falle vom 14.08.2026 war nicht die fehlende
Sperre, sondern der Kommentar „ERZEUGER 1 VON 2", der sich wie eine vollständige Liste las.
Gezählt wird stattdessen zur Laufzeit (`ecosystem-sperre-eingaenge.test.js`), und der Test ist
gegen die entfernte Weiche gegengeprüft.

## 14. Offen

- 🔧 **Der echte Ablauf mit angemeldeter Sitzung** — Sperren, Neuladen, Entsperren gegen die
  Produktivdatenbank. Kein Test ersetzt ihn (AGENTS.md §9: „Abnahme heißt ABLAUF, nicht Maß").
- 🔧 **Der Zähler in der Leiste** ist mein Zusatz, nicht bestellt. Fällt er weg, fällt mit
  ihm die einzige Sichtbarkeit der Sperre.
- ⚠️ **Ziehen statt Knöpfe** im Fenster wäre die natürlichere Geste für eine Reihenfolge.
  Bewusst nicht in dieser Fassung: „ganz nach vorn / ganz nach hinten" löst den gemeldeten
  Fall vollständig, und Ziehen ist am Telefon eine eigene Baustelle.
