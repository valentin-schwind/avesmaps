# Der Garetien Importer mit Import-Stage — Entwurf

**Stand:** 2026-09-06 · **Auftraggeber:** Owner · **Mockup:** `docs/garetien-importer-stage-mockup.html`
**Vorgänger:** `docs/superpowers/specs/2026-08-27-garetien-importer-fenster-auftrag.md` (das Fenster),
`…/2026-08-29-garetien-importer-sichtwerkzeug-design.md` (Anzeige-Menge, Sicht-Tafel).
**Abbau-Vertrag gilt unverändert:** alles hier lebt in `js/review/review-garetien-*.js`,
`css/components/garetien-importer.css`, `api/_internal/import/` und dem `garetien`-Zweig von
`api/edit/wiki/sync-plan.php` — nichts außerhalb lernt die Staging-Tabellen kennen.

## 0 · Owner-Entscheide vom 06.09.2026

1. **Stage-Semantik:** Zeile anklicken ist Vorschau; erst „Auf die Stage" legt fest. ✅
2. **Stätte in einer Stadt** und **„Nur Quelle + Artikel"** sind FORMEN in der Auswahl „Wird
   importiert als", keine eigenen Knöpfe. ✅
3. **Zwei Radien bei Punkten:** gleicher Name deckt sich bis 6 Meilen (2,0 Einheiten); **anderer
   Name nur bei 0 Meilen** (dieselbe Koordinate), sonst „neu". ✅
4. **Endkreuzungen bleiben AN**, auch an Bächen. ✅ (Der Expertenvorschlag „bei Bächen aus" ist
   verworfen.)
5. **Stadtviertel** wird zugeordnet, die fünf Ortsarten (Burg, Gasthaus, Pfalz, Magierturm,
   Stadtviertel) kommen in den Katalog, **Reichsstadt und Königsstadt werden `stadt`**. ✅
6. **Reihenfolge:** Paket 1 (dieser Entwurf) vor Paket 2 (Abgleich-Schwellen der Linien,
   Wortanfang-Vergleich, Küste, Berg-Flächen, Strömungsquelle — §12). ✅
7. **Fenster breiter, Knöpfe zweizeilig in EINER Reihe** (Owner: „kannst du das fenster breiter
   machen, die buttons mehrzeilig damit sie einzeilig angeordnet werden können"). ✅

## 1 · Ziel

Ein Weg, ein Vokabular, eine Rückmeldung:

- **Ein Weg:** Offen → Stage → „Stage importieren" → Übernommen. Jede Zeile hat je Zustand genau
  EINEN Vorwärtsknopf.
- **Ein Vokabular:** „Auswahl" (das Häkchen, mehrfach, schreibt nichts) und „Stage" (was auf der
  Karte liegt und importiert wird). Die Wörter „markieren", „anzeigen/angezeigt", „anhaken",
  „vormerken" verschwinden aus der Oberfläche.
- **Eine Rückmeldung:** eine Statuszeile unter dem Menüband sagt nach jeder Handlung, was
  geschehen ist, mit Zahlen und Gründen. Fehler ersetzen die Liste nicht mehr.

Dazu die fünf am 06.09.2026 am Code bestätigten Fehler (Gedächtnis `garetien-import-projekt`,
Abschnitt 06.09.): die Übernahme meldet nichts · veraltete Item-Nummern nach einem neuen Lauf ·
Bach nicht wählbar · Massenübernahme ohne Handeingaben · Vorschau ohne Einstellungen.

**Nicht-Ziel:** Abgleich-Schwellen der Linien, Wortanfang-Vergleich, Küste, Berg-Flächen und die
Strömungsquelle (§12, Paket 2). Kein neuer Endpunkt, keine neue Tabelle.

## 2 · Begriffe und Zustände

| Begriff | Was es ist | Wo es lebt |
|---|---|---|
| **Auswahl** | das Zeilenhäkchen; mehrfach; schreibt nichts | `zustand.auswahl` (heute `markiert`), Client |
| **Stage** | die Menge, die auf der Karte liegt und importiert wird; je Objekt seine Einstellungen | `zustand.stage` (heute `anzeige`, `Map` Schlüssel → Objekt) + `_garetienEingabenZustand`/`_garetienZielWahl` je Schlüssel (gibt es schon) |
| **geöffnet** | die Zeile rechts; auf der Karte durchgezogen gezeichnet, auch ohne Stage | `zustand.detailKey` (unverändert) |
| **Vormerkung** | `sync_plan_item.selected` am Server | wird für den Editor UNSICHTBAR: setzt nur noch der Import selbst, im selben Zug wie `apply` (wie heute „Neu einfügen") |

🔴 **Die Stage IST die heutige Anzeige-Menge, umbenannt.** Kein zweiter Speicher. Die
Einstellungen je Objekt gibt es schon (`garetienEingabenZustandZu`, `garetienZielWahlZu`, beide
nach Objektschlüssel) — neu ist nur, dass sie den Import erreichen (§7) und den Zeichner (§6).

💣 **Das ✦ („leuchtet") und der Filter „nur ungehakte" fallen weg.** Beide zeigen die
Server-Vormerkung, und die hat der Editor nicht mehr in der Hand. Ein Merkmal, das der Benutzer
nicht setzen und nicht lesen kann, ist eine Störung, keine Auskunft.

💣 **Die Abschnittshäkchen werden Client-Zustand.** Heute schreibt jedes Häkchen an einem
Abschnitt sofort `select` an den Server und holt die Liste neu. Künftig gehören sie zu den
Einstellungen des Stage-Objekts (`abschnitte: { public_id: true/false }`, Vorgabe alle an) und
entscheiden erst beim Import, welche Quelle-Items geschrieben werden. Keine Serverrunde je Klick.

## 3 · Die vier Zonen

Werkzeugfenster (`.avm-fenster--werkzeug`), **1000 px** breit (bisher 855; die Zahl steht in
`garetien-importer.css` an ZWEI Stellen, offener und eingeklappter Planer, und
`garetien-freischalten.test.js` zählt beide).

| Zone | Inhalt |
|---|---|
| Kopfleiste | Titel · Zusatz „Lauf 05.09. 14:02 · 8 213 Objekte" · − · ✕ (unverändert) |
| Menüband | Holen & Rechnen · Ebenen ▾ · Angezeigte Zeilen (unverändert) |
| **Statuszeile** (neu, §8) | `.avm-status` aus `editor-page.css`: in Ruhe die Bilanz des Laufs, nach einer Handlung ihr Ergebnis; ersetzt die `.gi-runline` |
| Liste links | Reiter **Offen · Stage · Übernommen · Abgelehnt** · Suche + Filter · Listenkopf mit Häkchen „alle n" · Zeilen · **Auswahlleiste** (nur bei Auswahl) |
| Einzelansicht rechts | Kopf · Sicht-Knöpfe · Abschnitte · Grund · **„Wird importiert als"** · Quellen · **Knopfleiste** · **Nähe-Zeile** |
| Fußleiste | Stage leeren · Alle zentrieren · **Stage importieren (n)** |

🔴 **Zweizeilige Knöpfe, eine Reihe (Owner-Entscheid 7).** Auswahlleiste, Knopfleiste und
Fußleiste tragen Knöpfe in der Bauform der Menüband-Kachel — `.avm-tile` mit `.t1` (Handlung) und
`.t2` (Zahl oder Zustand), 48 px, in einer Reihe ohne Umbruch (`flex-wrap: nowrap`, jeder Knopf
`flex: 1 1 0; min-width: 0`, die Texte ellipsieren). **Keine neue Rezeptur:** die Kachel des
Menübands ist die Rezeptur, die Reihen tragen `--avm-ribbon-pad` (10/14), weil das senkrechte
Polster der Bedienhöhe folgt (`docs/design-language.md`, Fenster). ⚠️ Die Fußleiste weicht damit
von der 32-px-Regel der Fußleisten ab — bewusst, Owner-Entscheid, und im Mockup so gezeigt.

## 4 · Liste, Reiter, Auswahlleiste

**Reiter:** Offen (Server) · Stage (Client) · Übernommen (Server) · Abgelehnt (Server). Die
Reihenfolge ist der Weg; „Abgelehnt" ist der Seitenausgang und steht zuletzt.

**Reiter Stage:** Suche (Name) und der Filterabschnitt „Objekttyp" wirken client-seitig auf die
Stage-Menge (`garetienAnzeigenAntwortBauen` filtert, Facetten aus der Stage). Ebene · Urteil · Wiki
bleiben dort gesperrt, mit dem sichtbaren Satz wie heute.

**Listenzeile:** Häkchen = Auswahl. Rechts eine **Stage-Marke** aus der gewählten Form und Art:
„→ Weg · Bach", „→ Fläche · See", „→ Stätte in „Wandleth"", „→ nur Quelle + Artikel". Ein Objekt
ohne Vorschlag trägt „nur Ansicht". Auf dem Reiter Offen trägt die Marke nur, was schon auf der
Stage liegt. Das ✦ entfällt (§2).

**Listenkopf** (Hausform `--avm-status-pad`): links ein Häkchen „alle n" (wählt die GERENDERTEN
Zeilen, wie heute „Alle markieren"), rechts der Zähler („7 auf der Stage · 5 mit Vorschlag").

**Auswahlleiste:** erscheint unter der Liste, sobald ≥ 1 Zeile ausgewählt ist; Knöpfe je Reiter,
alle zweizeilig (Zeile 2 = die Zahl):

| Reiter | Knöpfe |
|---|---|
| Offen | **Auf die Stage** (zählt nur Objekte mit Vorschlag; ohne Vorschlag kommen sie als „nur Ansicht" mit) · Ablehnen (rot) · Auswahl aufheben |
| Stage | Von der Stage nehmen · Ablehnen (rot) · Auswahl aufheben |
| Übernommen | Zurücknehmen (rot) · Zurück nach Offen · Auswahl aufheben |
| Abgelehnt | Wieder vorschlagen · Auswahl aufheben |

„Auf die Stage" wechselt auf den Reiter Stage (Owner 30.08.: wer eine Menge dorthin legt, will sie
sehen). Ablehnen und Zurücknehmen fragen wie heute nach (Menge, Folge). Die Auswahl überlebt einen
Reiterwechsel nicht mehr — sie gehört zur Ansicht, nicht zum Objekt; das nimmt die Falle „auf
Offen ausgewählt, auf Übernommen zurückgenommen".

💣 **Ein Stage-Objekt ohne Vorschlag bleibt auf der Stage liegen.** Es wird gezeichnet, nie
importiert, und der Fußknopf zählt es nicht. Heute steht dieser Fall im Hinweis als „Stufen" —
das Wort verschwindet.

## 5 · Die Einzelansicht

Kopf, Metazeile, „✦ Zentrieren", die zwei Sicht-Knöpfe, „Was bei uns an derselben Stelle liegt",
„Der Grund", „Wiki und Quellen", „Wiki-Landschaft": unverändert, mit drei Textkorrekturen:

- Abschnittszeile: „nichts zu ersetzen" → **„bleibt unberührt"**; „⚠ Name weicht ab" → **„anderer
  Name"**. Der Pfeil „→ „Name"" bleibt an `felder.name` gebunden und kommt damit nie mehr.
- Der Kasten heißt **„Wird importiert als"** (bisher „Eingefügt wird") und trägt die Zeile
  „Vorschau auf der Karte folgt jeder Änderung".

### 5.1 „Wird importiert als" — Form und Art

Die Form-Auswahl bietet, was Geometrie und Befund hergeben:

| Form | wann | Art darunter | Items beim Import |
|---|---|---|---|
| Fläche | ≥ 3 Punkte | Flächenarten aus `flaechen_arten` | `new`-Items (wie heute) |
| Beschriftung | immer | freie Label-Arten (Differenz) | `new` |
| Ort | immer | `LOCATION_TYPE_VISIBILITY_ORDER` | `new` |
| Weg | ≥ 2 Punkte | `PATH_SUBTYPE_KEYS` **plus „Bach (nicht befahrbar)"** | `new` |
| **Stätte in „X"** | nur mit Innerorts-Befund | keine | `new`, mit `innerorts: true` (wie heute „Innerorts einfügen") |
| **Nur Quelle + Artikel an X** | nur mit Quelle-Items | keine; darunter die Abschnittshäkchen | die `quelle`-Items der angehakten Abschnitte |

🔴 **„Bach" ist eine ART unter Weg, kein Subtyp.** Gewählt wird `subtyp: "Flussweg"` plus
`is_bach: true`; der Rumpf trägt beides, der Server legt es auf den Vorschlag (§9.2). Die Vorbelegung
kommt vom Server: `objekt.is_bach === true` → Art „Bach". Wechselt jemand von Bach auf eine andere
Wegart, fällt `is_bach`; wechselt er auf Bach, sperrt der Kasten die Verkehrsmittel und zeigt den
Satz „Ein Bach ist nicht befahrbar" (beides gibt es schon, nur an `objekt.is_bach` gebunden — es
hängt künftig an der WAHL, `garetienZielWahlZu`).

⚠️ Bei „Stätte" und „Nur Quelle + Artikel" ist der Art-Kasten leer; der Kopf sagt, wohin es geht
(„als Stätte in „Wandleth"", „an „Natter" (Flussweg-4471)").

### 5.2 Die Knopfleiste — ein Vorwärtsknopf je Zustand

| Zustand | Knöpfe (zweizeilig, Zeile 2 in Klammern) |
|---|---|
| Offen, nicht auf der Stage, mit Vorschlag | **Auf die Stage** (als Weg · Bach) · Ablehnen (rot) |
| Offen, ohne Vorschlag | Auf die Stage (nur Ansicht) · Ablehnen gesperrt mit Grund (wie heute) |
| auf der Stage | Von der Stage nehmen (liegt als …) · Ablehnen (rot) |
| Übernommen | Zurücknehmen (rot, „löscht von der Karte") · **Zurücknehmen + ablehnen** (rot) · Zurück nach Offen (bleibt auf der Karte) — je nach Items, sonst der Grund statt des Knopfs (wie heute) |
| Abgelehnt | Wieder vorschlagen |

Weg fallen: „Neu einfügen", „Innerorts einfügen (Stadt)", „Bei X Quelle + Artikel einfügen (n)".
Die Tooltips bleiben (sie nennen die Folge), die Texte werden nachgezogen (§8.3).

🔴 „Auf die Stage" trägt den Akzentrahmen (`--color-accent`), nicht Grün: Grün heißt in diesem
Fenster „legt auf der Karte an", und die Stage legt nichts an. Rot bleibt bei „Ablehnen" und
„Zurücknehmen". Die eine gefüllte Handlung ist „Stage importieren" im Fuß (AGENTS.md §12).

### 5.3 Die Nähe-Zeile

„In der Nähe: [gleicher Typ · Fluss (3) ▾] [Auf die Stage (3 Nachbarn · 6 Meilen)]".

- Die Umkreissuche bleibt am Server (`action: naehe`, Ausdehnung + `AVESMAPS_GARETIEN_NAEHE_ZUSCHLAG`);
  die Antwort bringt volle Objekte mit `typ`.
- Der Filter läuft **im Browser** über `gefunden`: Vorgabe „gleicher Typ · <Typ> (n)", dann jeder
  gefundene Typ mit Zahl, zuletzt „alle Typen (n)". Die Zahl im Knopf folgt der Auswahl.
- Gestagt wird in der **Vorschlagsform** des Abgleichs (die Zielwahl je Objekt bleibt bei der
  Vorbelegung), ohne die Nachbarn zu öffnen. Die „nur ihre Seite"-Marke bleibt wie heute.
- Reiterwechsel auf Stage wie bei jedem „Auf die Stage".

## 6 · Die Stage auf der Karte

Der Zeichner (`review-garetien-karte.js`) bekommt wie heute die Stage-Menge plus das geöffnete
Objekt (`avesmapsGaretienAufDerKarte`). Neu reisen je Objekt die **Einstellungen** mit — als
gestempelte Kopie, wie `flowDir` und `endkreuzungen` heute (Stempel in `garetienGewaehltStempeln`
bzw. ein neuer Stempel über die ganze Menge, `garetienEinstellungenStempeln`).

- **Bach:** `--color-path-bach`, Breite 2. Das Token (tokens.css) hat heute keinen Leser.
- **Name als Vorschau:** ein `divIcon` in der IHRE-Pane, gebaut mit `renderMapLabelToImage(text,
  size, getMapLabelTypeStyle(art))` (die Hausrasterung, mit Bildspeicher), Rückfall ein `<span>`.
  Position: Flächenmittelpunkt (Fläche/Beschriftung, dieselbe Mittelpunktformel wie der Server),
  der Punkt (Ort), die Mitte der Linie (Weg). Gezeigt nur, wenn `showName`/`showLabel` an ist UND
  der aktuelle Zoom im Zoomband liegt: Fläche/Beschriftung `minZoom ≤ z ≤ maxZoom`; Ort
  `avesmapsLocationZoomBandValue("label", klasse, z) !== null`; Weg `z ≥ PATH_LABEL_MIN_ZOOM`.
- **Zoomen:** der Zeichner hängt EINMAL einen `zoomend`-Zuhörer an die Karte und zeichnet die
  Stage neu (nur solange das Fenster offen ist; `avesmapsGaretienKarteAus` nimmt ihn ab).
- **Ändern:** jedes `input`/`change` im Kasten stempelt neu und ruft `avesmapsGaretienKarteZeigen`
  (entprellt, 150 ms). Heute tut das nur die Strömung.

💣 **Der Zeichner rechnet nichts nach.** Größe, Band, Name kommen aus den Einstellungen; ob sie
gültig sind, prüft weiterhin nur der Server beim Anlegen. Ein ungültiges Band (bis < ab) zeigt die
Vorschau als „nie sichtbar", und die Statuszeile sagt es beim Import.

💣 **Ein Objekt ohne Vorschlag (nur Ansicht) bekommt KEINE Namensvorschau** — es hat keine
Zielform, also keine Größe und kein Band. Es wird wie heute neutral gezeichnet.

## 7 · Der Import

„Stage importieren (n)" — n = Stage-Objekte mit mindestens einem Item, das ihre gewählte Form
schreibt (`new`-Items bei Fläche/Beschriftung/Ort/Weg/Stätte; angehakte `quelle`-Items bei „Nur
Quelle + Artikel"). Zeile 2 des Knopfs schlüsselt auf: „3 Wege (2 Bäche) · 1 Fläche · 1 Stätte ·
2 nur Ansicht".

1. **Rückfrage** mit derselben Aufschlüsselung und dem Satz „Neu angelegte Objekte lassen sich mit
   „Zurücknehmen" wieder entfernen, eine eingetragene Quelle ebenfalls." Der alte Satz über Name
   und Geometrie fällt.
2. **Häppchen zu 200** wie heute: erst `select` der Item-Nummern, dann `apply` mit `ids` und
   **`einstellungen_je_item`** (`{ "<item_id>": { ziel, subtyp, kind, is_bach, … } }`), aus den
   Einstellungen je Objekt gebaut (`garetienEingabenFuerServer`, für jedes Item des Objekts
   derselbe Rumpf). Fortschritt im Knopf („Importiert … 12 von 37"), wie heute.
3. **Danach:** die Stage wird per Schlüssel nachgeschlagen (§9.3); was `uebernommen` ist,
   verlässt sie; was gescheitert ist, bleibt liegen und trägt in der Zeile „nicht importiert: <Grund>"
   (aus `apply_note`, das die Liste je Item schon mitschickt). Die Statuszeile nennt Summe und
   Gründe (§8). Die Nummern der angelegten `new`-Items merkt sich das Fenster für **„Rückgängig"**
   (§8.2) — bis zur nächsten Handlung.

🔴 **Die Reihenfolge der Übernahme bleibt `ORDER BY id`.** Ein Einrasten der Wegenden an frisch
angelegte Orte gibt es heute nicht; es gehört in Paket 2 (§12).

💣 **`einstellungen_je_item` ist der EINE Weg, auch für den Einzelfall.** Es gibt keinen Einzelknopf
mehr, der ein anderes Feld schickt — wer nur ein Objekt importieren will, legt es allein auf die
Stage. Das ist die Regel gegen die zwei Semantiken von heute.

## 8 · Die Statuszeile

`.avm-status` unter dem Menüband (`#garetien-status`, Text in `.avm-status__text`, Töne `ok`/`bad`),
gesetzt von EINER Funktion `garetienStatusSetzen(text, ton, link)`. Sie ersetzt `.gi-runline`.

### 8.1 Ruhe

„Lauf 05.09. 14:02 · 8 213 Objekte · 3 917 mit Vorschlag · 7 auf der Stage". Die Aufräum-Zahlen der
Lauf-Kachel bleiben in der Kachel.

### 8.2 Nach einer Handlung

- Import: „✓ 5 Objekte importiert — 3 Wege (2 Bäche), 1 Fläche, 1 Stätte · Quellen an allen 5"
  + Link **„Rückgängig"** (Rücknahme genau dieser Items über `action: ruecknahme`, mit Rückfrage).
- Teilerfolg: „✕ 1 von 5 nicht importiert: „Ostrand" — aus 1 Punkt lässt sich kein Weg bauen.
  Wähle rechts eine andere Form." + Link „Zur Zeile".
- Stage: „7 auf der Stage (3 dazu)" · „Stage geleert" · Nähe: „3 Nachbarn auf die Stage gelegt".
- Ablehnen / Wieder vorschlagen / Zurücknehmen / Zurück nach Offen: je ein Satz mit Objektname.
- Nach „Holen & Rechnen": „Lauf 06.09. 09:10 · 8 213 Objekte · Stage nachgeschlagen: 7 stehen
  wieder, 1 gibt es im neuen Lauf nicht mehr („Alte Mühle")".
- Fehler einer Anfrage: „✕ <Fehlersatz des Servers> — die Liste ist unverändert." Die Liste bleibt
  stehen; `garetienListeFehlerZeigen` schreibt nicht mehr in `#garetien-list`.

### 8.3 Texte, die mitwandern

Tooltip des Öffnungsknopfs (`index.html`), die drei Rückfragen (`garetienZusatzRueckfrageText`,
`garetienEinfuegenRueckfrageText`, Geometrie-Rückfrage entfällt), Fußhinweise („Stufen"), die
Handlungs-Tooltips für die neuen Knöpfe. Kein Text nennt mehr „Angehakte übernehmen", „vorgemerkt",
„markiert" oder „angezeigt".

## 9 · Serveränderungen

Alle in `api/_internal/import/` bzw. im `garetien`-Zweig von `sync-plan.php`.

1. **`apply` je Item:** `avesmapsGaretienEinstellungenJeItemAusRumpf($payload)` liest
   `einstellungen_je_item` (Schlüssel = Item-Nummer, Werte wie heute `einstellungen`); Rückfall
   auf das bisherige `einstellungen` für alle. `avesmapsGaretienUebernehmen` bekommt die Zuordnung
   und nimmt je Zeile ihren Rumpf. Die Antwort trägt **`fehler: [{item, grund}]`** (das Ergebnis hat
   sie schon, `avesmapsGaretienApplyStep` reicht sie durch) und **`angelegt_je_form`**
   (`path`, `bach`, `region`, `label`, `location`, `settlement_place`, `quelle`).
2. **Bach:** `avesmapsGaretienZielUebersteuern` setzt `is_bach` aus den Einstellungen, wenn
   `subtyp === 'Flussweg'`, und löscht es bei jeder anderen Wegart. `avesmapsGaretienNachIstBach`
   bleibt der eine Leser. ⚠️ Der Vergleich „Wahl == Vorschlag → unverändert" muss `is_bach`
   mitvergleichen, sonst wird Fluss → Bach ohne Artwechsel verschluckt.
3. **`liste` mit `keys`:** ein Filter `keys: string[]` (Objektschlüssel, Deckel
   `AVESMAPS_GARETIEN_LISTE_MAX`) liefert genau diese Objekte über **alle Stände** (`stand: ""`).
   Der Browser ruft ihn nach jedem `plan` und nach jedem Import (`garetienStageNachschlagen`);
   fehlende Schlüssel fallen aus der Stage und werden genannt. Damit sterben die veralteten
   Item-Nummern. ⚠️ `avesmapsGaretienAnzeigeNachEinfuegenBereinigen` (Stand `uebernommen`, ohne
   Filter) entfällt zugunsten dieses einen Weges.
4. **Zuordnung (Owner-Entscheid 5):** `'Stadtviertel' => location/stadtviertel` mit
   Innerorts-Befund wie bei Bauwerken (raus aus `AVESMAPS_GARETIEN_OHNE_GEGENSTUECK`);
   `Reichsstadt`/`Koenigsstadt` → `stadt` (Suchfamilie bleibt); die fünf Ortsarten in
   `api/_internal/wiki/place-kinds.php`; `place_kind` wird beim Ort **aus dem Quelltyp vorbelegt**,
   wenn der Typ im Katalog steht (Tempel, Kloster, Gutshof, Burg, Gasthaus, Pfalz, Magierturm,
   Stadtviertel) — heute geht der Typ beim Kartenimport verloren, und ein getippter Wert außerhalb
   des Katalogs wurde still verworfen. ⚠️ Der Kasten zeigt den vorbelegten Wert; ein Wert, den
   `avesmapsNormalizePlaceKind` verwirft, wird in der Statuszeile genannt.
5. **Punktregel (Owner-Entscheid 3):** `avesmapsGaretienTrefferSchwelle` bekommt den Namensbefund:
   Punktziel + gleicher Name → 2,0 Einheiten; Punktziel + anderer Name → **0,0** (nur dieselbe
   Koordinate zählt). Der Kandidatensuchraum für Punkte muss 2,0 abdecken. Im Grund steht weiter
   der nächste Nachbar („0,9 Meilen von „Valpolust" · anderer Name").
   💣 **Folge, gemessen am 31.08.:** das 10. Perzentil des Nachbarabstands ist 0,000 — Burg und Dorf
   auf DERSELBEN Koordinate gelten mit anderem Namen weiter als Treffer („deckt sich", Quelle ans
   Dorf, Zusatz-Item). Das ist die wörtliche Lesart von „0 Meilen" und steht hier, damit es beim
   Bau nicht still anders entschieden wird.
6. Keine Änderung an Endkreuzungen (Owner-Entscheid 4) und an der Strömungsquelle (§12).

## 10 · Tests

JS (`js/review/__tests__/`): `garetien-stage-auswahl.test.js` (Auswahl vs. Stage, Reiterwechsel,
Auswahlleiste je Reiter, Kopf-Häkchen) · `garetien-stage-import-rumpf.test.js`
(`einstellungen_je_item` je Item aus den Objekt-Einstellungen, Bach → `is_bach`, Stätte, Quelle
mit Abschnittshäkchen, „nur Ansicht" nicht dabei) · `garetien-stage-nachschlagen.test.js` (nach
`plan` und nach Import: `keys`-Ruf, Verschwundene genannt, `uebernommen` verlässt die Stage) ·
`garetien-statuszeile.test.js` (Ruhe, Erfolg, Teilerfolg, Fehler lässt die Liste stehen,
„Rückgängig" sendet die gemerkten Nummern) · `garetien-zielwahl-bach.test.js` (Art „Bach" nur unter
Weg, Verkehrsmittel gesperrt, Wechsel löscht `is_bach`) · `garetien-naehe-typfilter.test.js`
(Gruppen aus `gefunden`, Vorgabe gleicher Typ, Zahl im Knopf) · `garetien-karte-vorschau.test.js`
(Name nur im Band, Bach-Token, `zoomend` einmal, Stempel über die ganze Menge) ·
`garetien-knopfreihe.test.js` (alle drei Reihen `.avm-tile`, `nowrap`, Fensterbreite 1000 an
beiden Stellen). Bestehende Tests, die alte Beschriftungen festhalten (rund 20 von 34), werden
nachgezogen, nicht gelöscht.

PHP (`api/_internal/import/__tests__/`): `garetien-einstellungen-je-item-test.php` (zwei Items,
zwei Rümpfe, Rückfall, `fehler` und `angelegt_je_form` in der Antwort) · `garetien-bach-wahl-test.php`
(Fluss → Bach ohne Artwechsel; Bach → Straße löscht) · `garetien-liste-keys-test.php` (alle Stände,
Deckel, unbekannter Schlüssel) · `garetien-punktregel-test.php` (gleicher Name 1,9 Einheiten =
deckt sich; anderer Name 0,1 = neu; anderer Name 0,0 = Treffer) · `garetien-stadtviertel-ortsarten-test.php`
(Zuordnung, Katalog, Vorbelegung `place_kind`, Reichsstadt = stadt).

Mutationsproben je Test (mindestens: Stempel weg, `is_bach` nicht verglichen, `keys` ohne Stand,
Statuszeile ohne `bad`, Rückfrage ohne Zahl). Danach das GANZE Feld (AGENTS.md §9, Workflow-Muster).

## 11 · Abnahmeliste (💣/⚠️/🔴 dieses Entwurfs)

- 🔴 Stage = umbenannte Anzeige-Menge, kein zweiter Speicher (§2)
- 💣 ✦ und „nur ungehakte" entfallen; Abschnittshäkchen ohne Serverrunde (§2)
- 💣 Objekt ohne Vorschlag bleibt auf der Stage, zählt nicht, „Stufen" verschwindet (§4)
- 🔴 Bach = Art unter Weg, `subtyp Flussweg + is_bach`; Wahl treibt Sperre der Verkehrsmittel (§5.1)
- 🔴 Ein Vorwärtsknopf je Zustand; Akzentrahmen, nicht Grün (§5.2)
- 🔴 Nähe-Filter im Browser, Vorgabe gleicher Typ, Vorschlagsform (§5.3)
- 💣 Zeichner rechnet nichts nach; nur Ansicht ohne Namensvorschau; `zoomend` einmal (§6)
- 🔴 `ORDER BY id` bleibt; `einstellungen_je_item` der eine Weg (§7)
- 🔴 Statuszeile ersetzt runline UND Fehler-in-der-Liste; „Rückgängig" nur bis zur nächsten Handlung (§8)
- ⚠️ `is_bach` im Gleichheitsvergleich (§9.2) · `keys` über alle Stände (§9.3) · 💣 „0 Meilen" wörtlich (§9.5)
- 🔴 1000 px an beiden Stellen; drei Reihen `.avm-tile`, `nowrap` (§3)
- 🔴 Vor dem Push `usability-konsistenz` (Entwurf gegen Diff) und `usability-design` (Mockup gegen Bau, hell UND dunkel); sichtbare Schritte EINZELN live (AGENTS.md §9)

## 12 · Paket 2 — Abgleich (nicht Teil dieses Entwurfs)

Aus dem Expertenbericht vom 06.09.2026, alle am Code nachgelesen, keine Owner-Entscheide dazu:

- Wortanfang-Vergleich (`avesmapsGaretienNamenAehnlich`: „Natterbach" deckt sich mit „Natter") —
  vor einer Änderung zählen, wie viele heutige `deckt_sich` daran hängen.
- Linien-Schwelle 2,0 Einheiten und die Wegefamilie (Pfad neben Reichsstraße) — messen, dann
  Schwelle je Familie.
- `Kueste` (20 Linien) wird als Polygon angelegt.
- Berg-Polygone (78 von 79) können nie Fläche werden, weil die Liste nur den Mittelpunkt trägt.
- Strömung ohne Handeingabe wird als `source: editor` gespeichert und fällt aus „Flussrichtung
  unbekannt".
- Innerorts-Befund fehlt beim häufigsten Fall (Bauwerk mit exakt dem Namen der Siedlung → deckt
  sich).
- Einrasten der Wegenden an vorhandene Orte/Kreuzungen; Reihenfolge Flächen vor Wegen.
- LOD-Spanne als Vorschlag fürs Zoomband; Wiki-Zuweisung für Orte.
