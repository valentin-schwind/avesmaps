# Eigene Uploads für die Kartensammlung — Vorschaubild als WebP, ganze Karte unverändert

**Datum:** 2026-08-01
**Auslöser:** Discord (Nottel): Autoget scheitert bei DeviantArt mit 403, „manuell weiss ich nicht, wie
ich das hochladen kann". Owner-Auftrag: eigene Vorschaubilder und eigene Karten hochladbar machen,
Vorschau nach WebP skalieren, ohne Lizenz keine Anzeige.

## 1. Ausgangslage (gemessen, nicht vermutet)

`POST /api/edit/map/citymap-image.php` (Capability `edit`) kann beide Slots **bereits**:

| | `slot=thumb` | `slot=map` |
|---|---|---|
| Upload | PNG/JPG/WebP/GIF, max 12 MB, SVG abgelehnt | dito |
| Verkleinern | längste Kante 400 px, **Format bleibt** | längste Kante 4000 px, **Format bleibt** |
| Lizenzgate (Anzeige) | `thumb_license` | `map_license` — getrennte Spalten |
| Entfernen | ja (`mode=delete`) | ja |

Das Anzeige-Gate steht serverseitig in `avesmapsCitymapPublicThumbUrl` / `avesmapsCitymapPublicMapLocalUrl`
(`api/_internal/app/citymaps.php:837-851`): nicht-freie Lizenz → leerer String, die Zeile verlässt den
Server nie. Frei ist heute `public_domain · cc0 · ai_generated · permission_granted`; Default
`unknown_other` ist **nicht** frei.

**Was fehlt, ist also nicht der Upload, sondern (a) die WebP-Umwandlung und (b) eine bedienbare
Reihenfolge.** Der Autoget-403 bei DeviantArt ist dieselbe TLS-Fingerprint-Sperre wie bei Ulisses
(siehe `citymaps-feature-task-c`) und nicht zu umgehen — der manuelle Upload *ist* die Antwort darauf.

## 2. Owner-Entscheidungen (2026-08-01, wörtlich bindend)

1. **„geschützte bilder dürfen nicht bei uns landen, es sei denn sie sind gemeinfrei, cc0, genehmigt
   oder von uns."** → Der Upload-Riegel **bleibt**. Ein zuvor erwogener Vorschlag (hochladen immer
   erlauben, nur die Anzeige sperren) ist damit **abgelehnt** und darf nicht als „Verbesserung"
   zurückkommen. Die Bytes dürfen die Platte nicht berühren, wenn die Lizenz nicht frei ist.
2. **„Vorschaubild (slot=thumb) -> soll zu webp 400px"**
3. **„Ganze Karte (slot=map) -> soll nicht verändert werden"** → die heutige 4000-px-Begrenzung für
   `map` **entfällt**; die Datei wird gespeichert, wie sie ankommt.

## 3. Entwurf

### 3.1 `slot=thumb`: nach WebP, längste Kante 400 px

Neue reine Funktion `avesmapsCitymapEncodeThumbBytes(string $bytes, string $ext): array`
→ `['bytes' => …, 'ext' => 'webp'|<original>]`.

- Skaliert auf längste Kante 400 (Seitenverhältnis und Alpha bleiben) und kodiert **immer** nach WebP
  (Qualität 82), auch wenn das Bild bereits klein genug ist — „passendes WebP-Format" ist der Auftrag,
  nicht „nur wenn es sich lohnt".
- **GIF bleibt GIF.** Umwandeln würde eine Animation auf ein Standbild reduzieren; der bestehende
  Skalierer lässt GIF aus demselben Grund unangetastet.
- **Harter Rückfall, der Upload darf nie an der Umwandlung scheitern:** fehlt `imagewebp` (GD ohne
  WebP-Unterstützung — auf STRATO nicht vorab messbar, `api/diagnostics/` ist `.htaccess`-gesperrt),
  schlägt `imagecreatefromstring` fehl oder liefert die Kodierung leere Bytes, bleibt es beim heutigen
  Verhalten: Original-Format, auf 400 px begrenzt. Gleiche Philosophie wie
  `avesmapsWikiSyncMonitorDownscaleCoatBytes` („im Zweifel das Original behalten").
- Anders als der Wappen-Skalierer wird **nicht** auf „nur wenn kleiner" geprüft: ein WebP, das
  ausnahmsweise größer als das Original ist, bleibt trotzdem das gespeicherte Format — sonst hinge das
  Dateiformat vom Zufall des Kompressionsergebnisses ab.

> 💣 **Erst kodieren, dann den Dateinamen festlegen.** Heute steht der Name in
> `citymap-image.php:184` **vor** dem Skalieren fest, und die Datei wird danach an Ort und Stelle
> überschrieben (`:198`). Genau so entsteht eine `.png`, die WebP-Bytes enthält — der Reader bekommt
> einen falschen Content-Type. Reihenfolge im Umbau: Bytes lesen → kodieren → Endung aus dem
> **Ergebnis** bestimmen → Zieldatei schreiben. (Verwandte Falle: `python-wb-open-truncates-before-encode`.)

### 3.2 `slot=map`: unverändert speichern

Die Verkleinerung entfällt für diesen Slot ersatzlos — die ganze Karte ist das Stück, in das man
hineinzoomt; Neukomprimieren zerstört genau ihren Zweck. Es bleiben: 12-MB-Obergrenze,
MIME-Sniffing per `finfo`, SVG-Ablehnung.

- `width_px` / `height_px` werden weiterhin an der **gespeicherten** Datei gemessen — die ist jetzt das
  Original, die Werte werden dadurch ehrlicher, nicht falscher.
- ⚠️ **Bewusste Folge:** eine 12-MB-Karte bleibt 12 MB, im Speicher und in der Leitung des Lesers.
  Owner-Entscheidung, hier festgehalten, damit sie nicht später als Bug „repariert" wird.

### 3.3 Lizenz reist MIT dem Upload (löst Nottels Problem ohne den Riegel zu lockern)

Heute: Lizenz setzen → **speichern** → dann erscheint der Upload. Diese Reihenfolge ist der Grund für
„manuell weiss ich nicht, wie ich das hochladen kann" — man soll ein Bild klassifizieren, das noch
nicht existiert.

Neu: Die Upload-Aktion nimmt ein optionales Feld `license` entgegen. Es adressiert **die Lizenzspalte
des jeweiligen Slots** — `thumb` → `thumb_license`, `map` → `map_license`; die beiden bleiben
unabhängig (eine Quelle darf ein freies Cover und eine geschützte Karte haben). Der Server bestimmt die
**wirksame** Lizenz als `license ?? <gespeicherter Wert des Slots>`, normalisiert sie durch
`avesmapsCitymapNormalizeLicense` (ein unbekannter String fällt damit auf `unknown_other` und wird
abgelehnt — nie umgekehrt) und bricht mit `403 license_not_free` ab, **bevor** `move_uploaded_file`
läuft. Ist sie frei, werden Datei und Lizenzspalte in einem Zug geschrieben.

Das ist strikt so streng wie heute — nicht-freie Bytes landen weiterhin nie auf der Platte — aber es
ist eine Geste statt drei. Im Editor: Datei wählen → Lizenzabfrage → fertig.

### 3.4 `own_work` als freie Lizenz

Wer die Karte selbst gezeichnet hat, findet im Menü heute nichts Passendes; `permission_granted`
(„Genehmigung") liest sich falsch für „ist von mir". Neuer Wert `own_work`, Label **„Eigene Kreation"**,
in `AVESMAPS_CITYMAP_LICENSES` **und** `AVESMAPS_CITYMAP_LICENSES_FREE`. Deckt das „oder von uns" aus
der Owner-Vorgabe wörtlich ab.

### 3.5 Der 403 zeigt künftig auf den Upload

Die Autoget-Fehlermeldung endet heute in einer Sackgasse („Bitte eins hochladen." ohne Weg dorthin).
Sie benennt künftig den Upload-Knopf als nächsten Schritt.

## 4. Was NICHT gebaut wird

- **Kein Nachrüsten bestehender Bilder.** Nur neue Uploads werden WebP; ein Massenlauf über den
  Bestand ist nicht bestellt und würde Originale unwiederbringlich neu komprimieren.
- **Kein zweiter Upload-Weg.** Alles hängt am bestehenden `citymap-image.php`; ein `citymap_upload`-
  Nebenpfad wäre die gleiche Sorte Fehler wie die eigene `lore_source`-Tabelle (AGENTS.md §5).
- **Keine Autoget-Umgehung für DeviantArt.** TLS-Fingerprint-Sperren sind nicht zu umgehen.

## 5. Tests

- **Kodierung** (rein, ohne DB): PNG → WebP mit längster Kante 400 · Alpha überlebt · bereits kleines
  PNG wird trotzdem WebP · **GIF bleibt GIF** · fehlendes `imagewebp` → Original-Format, 400 px begrenzt.
- **Endung folgt den Bytes:** das Ergebnis heißt `.webp`, wenn WebP drinsteht — der Regressionstest
  gegen die Falle aus §3.1.
- **`map` unverändert:** hochgeladene Bytes == gespeicherte Bytes, auch über 4000 px.
- **Gate:** `unknown_other` → Upload abgelehnt, **keine Datei auf der Platte**; `own_work` → akzeptiert;
  `own_work` ist in der öffentlichen Ausgabe frei, `unknown_other` liefert weiterhin `''`.

## 6. Offen — braucht ein Owner-Wort

**`ai_generated` stand nicht in der Aufzählung** („gemeinfrei, cc0, genehmigt oder von uns"), ist heute
aber frei und öffentlich. Ich habe es **nicht** angefasst: es zu streichen würde bereits sichtbare
Bilder rückwirkend verbergen, und „von uns erzeugt" ist eine plausible Lesart von „von uns". Wenn das
anders gemeint war, ist es eine Zeile — plus eine bewusste Entscheidung über den Bestand.

Siehe `citymaps-feature-task-c`, `citymaps-redesign-datenlage`, `citymaps-killswitch-silent-outage`.
