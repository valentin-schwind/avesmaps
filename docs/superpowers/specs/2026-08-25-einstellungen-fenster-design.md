# Das Fenster „Einstellungen" — eine zentrale Schaltstelle für Admins

**Stand 25.08.2026.** Entwurf, mit dem Owner am 25.08.2026 abgestimmt.
Mockup: `docs/einstellungen-mockup.html`.

---

## §0 Kurzfassung

Avesmaps hat **keine Stelle, an der die Konfiguration des Projekts steht**. Elf globale
Notausschalter liegen verstreut über fünf Oberflächen, zwei sind überhaupt nicht bedienbar, die
zentralen Darstellungsentscheidungen stehen nur im Code, und „📥 Dump holen" — der Lauf, der die
ganze Datengrundlage erneuert — sitzt in einem Reiter des WikiSync-Panels.

Dieser Entwurf beschreibt **eine Seite**: `/edit/einstellungen.php`, erreichbar über das
Drei-Strich-Menü der Edit-Shell, **nur für Admins**, mit fünf Abschnitten.

🔴 **Am Betrieb ändert sich in Stufe 1 nichts** außer zweierlei: der Menüeintrag taucht für Admins
auf, und „Dump holen" steht künftig dort statt im Panel. Jeder neue Wert hat als Vorgabe genau das,
was heute im Code steht — Ziffer für Ziffer, wie bei den Zoombändern.

---

## §1 Der Befund — was heute wo geschaltet wird

Die Bestandsaufnahme vom 25.08.2026 (Grundlage der Auswahl unten).

### §1.1 Die elf Notausschalter

Alle in `app_setting`, Vorgabe AN, nur ein ausdrücklich gespeichertes `'0'` schaltet ab
(die Polarität ist Hauskonvention, siehe `api/_internal/app/app-setting.php`).

| Schlüssel | Wirkung | heute bedienbar in |
|---|---|---|
| `settlement_images_enabled` | Ortsbilder im Frontend | Ortseditor, Kachel `#seImagesToggle` |
| `settlement_coats_enabled` | Ortswappen im Frontend | Ortseditor, Kachel `#seCoatsToggle` |
| `territory_coats_enabled` | Gebietswappen im Frontend | WikiSync-Monitor, `#btnCoatsToggle` |
| `citymaps_enabled` | Kartensammlung | Kartensammlung-Editor |
| `citymap_previews_enabled` | Kartenvorschauen | Kartensammlung-Editor |
| `adventures_enabled` | Literatur | Literatur-Editor |
| `adventure_covers_enabled` | Literatur-Cover | Literatur-Editor |
| `lore_kind_flora_enabled` | Vorkommen: Flora | WikiSync-Panel |
| `lore_kind_fauna_enabled` | Vorkommen: Fauna | WikiSync-Panel |
| `lore_kind_spezies_enabled` | Vorkommen: Spezies | WikiSync-Panel |
| `terrain_travel_enabled` | Geländeabhängiges Reisen | Landschaften-Editor |
| `citymap_autoget_enabled` | Karten-Vorschauen automatisch holen | **nirgends** |
| `adventure_cover_autoget_enabled` | Literatur-Cover automatisch holen | **nirgends** |

⚠️ Es sind dreizehn Zeilen; „elf" meint die elf, die eine Bedienung haben. Die letzten zwei sind
der Grund, warum dieser Abschnitt überhaupt eine Tabelle braucht: sie existieren serverseitig,
werden gelesen, und **niemand kann sie umlegen**.

### §1.2 Die zwei Zahlentafeln

`location_zoom_bands` (Zoombänder samt Spalt/Repel/Versatz/Max. Drift) im Ortseditor und
`travel_values` (Tempowerte samt Querfeldein-Aufschlag) im Wege-Editor. Beide dürfen nur Admins
speichern, ansehen darf jeder Editor. **Beide bleiben, wo sie sind** — sie sind groß, thematisch
gebunden und haben eine gewachsene Oberfläche.

### §1.3 Die Betriebs-Handlungen

| Handlung | heute |
|---|---|
| „📥 Dump holen" | WikiSync-Panel in der Karte (`#wiki-sync-dump-read`) |
| Dump-Zugangsdaten | Dialog, der **nur** erscheint, wenn ein Lauf mit 401 scheitert |
| „💾 Datenbank-Backup" | Hamburger → `/edit/backup.php` |
| „Admin" (Benutzer) | Hamburger → `/admin/` |

### §1.4 Nur im Code

Zentrale Entscheidungen ohne jede Oberfläche:

* **Überblenden beim Zoomwechsel** — Marker faden per JS-Opacity (`100 ms ease-out` hinaus,
  `200 ms ease-in` herein, `map-features-location-canvas-layer.js:181/199`), Beschriftungen per
  Pane-Regel (`.leaflet-zoom-anim .map-labels-pane`, `css/features/map-labels.css:230`).
* **Startansicht** — `AVESMAPS_DEFAULT_MAP_CENTER = [497.28, 520.5]`,
  `AVESMAPS_DEFAULT_MAP_ZOOM = 3`, am Telefon eine Stufe weiter heraus
  (`js/app/bootstrap.js:23-41`).
* **Kartenstil** — `MAP_TILE_STYLES` in `js/config.js:562`, Vorgabe `stylized`.

---

## §2 Was in Stufe 1 hineinkommt — und was ausdrücklich nicht

🔴 **Owner-Entscheid 25.08.2026: die bestehenden Kacheln bleiben, wo sie sind.** Stufe 1 nimmt
nur, was heute **nirgends** bedienbar ist, plus Neues. Die elf Schalter aus §1.1 wandern in einer
späteren Stufe — oder nie.

Der Grund, warum das die richtige Reihenfolge ist: ein zweiter Bedienort für dieselbe Sache ist
in diesem Projekt mehrfach teuer geworden (die sieben Rezepturen der Listenzeile, die sechs
Fassungen der Wiki-Zuweisung). Ein Umzug ist sauber, ein Spiegel nicht — und ein Umzug von elf
Schaltern aus fünf Oberflächen ist ein eigenes Vorhaben, das nach AGENTS.md §9 einzeln live gehen
muss.

**Draußen, mit Begründung:**

* Ein Notaus für die Besucherzählung — gibt es heute nicht, wäre also **neues Verhalten**, und
  dieser Entwurf verspricht, dass sich nichts ändert.
* Die eingefrorenen Code-Flags (`AVESMAPS_ROUTE_OFFROAD_DETOUR_ENABLED`,
  `AVESMAPS_ECOSYSTEM_CASCADE_ENABLED`, `AVESMAPS_WIKI_SYNC_NO_AUTO_HANDLE`). Das ist Werkstatt:
  Werte, deren Antwort schon getroffen ist. Sie an einen Admin weiterzureichen lädt ihm eine
  Entscheidung auf, die niemand je wieder anders treffen wird
  (Owner-Regel vom 22.08.2026: „der Editor bekommt zwei Schalter, nicht die Werkstatt").
* Geheimnisse. `config.local.php` ist gitignored und bleibt die Ablage für Token, Salt und
  Zugangsdaten. **Einzige Ausnahme:** die Dump-Zugangsdaten liegen schon heute in der Datenbank
  (`avesmapsWikiDumpSetCredentials`), und ihr Schreibweg trägt bereits einen `admin`-Riegel.

---

## §3 Ort und Form

### §3.1 Eine eigene Seite, kein Overlay

🔴 **Der Hamburger sitzt in der äußeren Hülle, die Karte in einem `<iframe>`.**
`edit/index.php` ist die oberste Hülle; darin liegt `<iframe class="edit-shell__map"
src="../index.html">`. Ein Fenster, das aus diesem Menü aufgeht, kann deshalb **nicht** ein
Overlay der Karte sein, ohne durch den Rahmen hindurchzugreifen.

Seine drei Nachbarn lösen das alle gleich: Handbuch, Karte als SVG, Datenbank-Backup und Admin
sind **eigene Seiten in einem neuen Tab**. „Einstellungen" wird genauso gebaut:

```
/edit/einstellungen.php     target="_blank" rel="noopener"
```

⭐ Für „Dump holen" ist der eigene Tab sogar ein Gewinn: der Lauf dauert Minuten, und in einem
eigenen Tab bleibt die Karte daneben benutzbar. Genau dieselbe Überlegung trägt schon
`backup.php`.

### §3.2 Der Menüeintrag

In `edit/index.php`, Gruppe „Nur Admins", **als erster Eintrag** — über „Datenbank-Backup":

```html
<section class="edit-shell__menu-group">
    <p class="edit-shell__menu-title">Nur Admins</p>
    <a class="edit-shell__menu-item" href="/edit/einstellungen.php" target="_blank" rel="noopener">Einstellungen</a>
    <a class="edit-shell__menu-item" href="/edit/backup.php" target="_blank" rel="noopener">Datenbank-Backup</a>
    <a class="edit-shell__menu-item" href="/admin/" target="_blank" rel="noopener">Admin</a>
</section>
```

⚠️ Die Gruppenüberschrift „Nur Admins" trägt den Riegel bereits sichtbar; die Zeile braucht
keinen eigenen Zusatz.

### §3.3 Der Riegel — zweimal

* **Die Seite:** `avesmapsCurrentUser()` + `avesmapsUserCan($user, 'admin')`, mit Anmeldeformular
  bei fehlender Sitzung — das Muster von `edit/backup.php` Zeile für Zeile.
* **Jeder Endpunkt:** `avesmapsRequireUserWithCapability('admin')`.

🔴 **Beides, nicht eines.** Der Riegel der Seite hält die Oberfläche aus dem Weg; der Riegel des
Endpunkts ist der, der schützt. `edit/backup.php` sagt das in seinem eigenen Kopfkommentar, und
es gilt hier genauso.

### §3.4 Die Form innen

Die Fensterform der Zoombänder, aber als **Seite**: Kopfzeile mit Titel und Rückweg,
Erklärabsatz, Abschnitte mit Überschrift und Trennlinie, je Abschnitt eine eigene Speicherleiste.

🔴 **Speichern je Abschnitt, nicht einmal unten für alles.** Die fünf Abschnitte haben
verschiedene Ablagen (ein JSON-Schlüssel, zwei einzelne Schalter, gar keine) und verschiedene
Laufzeiten. Ein gemeinsamer Knopf müsste behaupten, all das sei ein Vorgang.

⚠️ **Gruppierung durch Trennlinie, nicht durch Kästen** (AGENTS.md §12): `--color-divider` plus
Überschrift. Keine gerahmten Boxen.

---

## §4 Abschnitt 1 — Wiki-Daten (der Dump-Umzug)

### §4.1 Was umzieht

🔴 **Owner-Entscheid: voller Umzug.** Der Knopf `#wiki-sync-dump-read` im WikiSync-Panel **fällt
weg**; der ganze Lauf steht künftig auf dieser Seite.

Der Lauf ist eine Kette aus vier Schritten, jeder nur nach dem Erfolg des vorigen:

1. `fetch_dump` — den Dump neu herunterladen
2. `start_read` + `read_step`-Schleife — der Sandbox-Scan (schreibt nichts Scharfes)
3. `cleanup_state` — alle anderen Dump-Stände aus der Sandbox räumen
4. `sync_publications`-Schleife — rechnet, was die Publikationsquellen ändern würden, und endet
   in der Übernahme-Vorschau

### §4.2 Der Fußabdruck — gemessen, nicht geschätzt

| Baustein | heute | portabel? |
|---|---|---|
| `submitWikiSyncDumpAction` | `js/app/api-client.js:442` | ✅ eigenständig |
| `openSyncPlanSheet` | `js/review/sync-plan-sheet.js` | ✅ **wird schon heute von drei Einzelseiten geladen** |
| `avesmapsOpenDumpReport` | `review-wiki-sync.js:1373` | ✅ baut Overlay und Stile selbst |
| `runWikiSyncPublicationsSyncLoop` | `review-wiki-sync.js:1766` | ✅ reiner Ablauf |
| Zugangsdaten-Dialog | `review-wiki-sync.js:3661-3730` + Markup in `index.html:1733` | ✅ mit Markup |
| `setWikiSyncStatus` | `js/review/review-status.js:126` | ❌ Panel-Statuszeile |
| `setWikiSyncButtonState` | `review-wiki-sync.js:1462` | ❌ Panel-Knopfform |
| `showFeedbackToast` | `js/map-features/map-features.js:236` | ❌ **Kartenmodul** |

⭐ **Der Befund, der den Umzug bezahlbar macht:** `sync-plan-sheet.js` und
`submitWikiSyncDumpAction` verlassen die Karte längst — `html/citymap-editor.html`,
`html/game-literature-editor.html` und `html/wiki-sync-monitor.html` fahren sie als eigenständige
Seiten. Der Weg ist begangen, nicht neu.

### §4.3 Die Bauform: ein geteilter Treiber mit Wirt-Adapter

Neue Datei **`js/wiki/dump-holen.js`** nach dem Hausmuster von `js/ui/listen-statuskreis.js` und
`js/review/sync-plan-sheet.js`: eine Datei, die **zwei Dokumente** laden können.

💣 **Der Treiber darf die drei nicht-portablen Helfer NIE direkt rufen.** Er bekommt sie als
Wirt-Adapter herein:

```js
avesmapsDumpHolenStarten({
    knopf,                       // das Element, in das der Fortschritt schreibt
    status: (text, ton) => {},   // die Statuszeile des Wirts
    melden: (text, ton) => {},   // die Rückmeldung des Wirts (Toast oder Zeile)
    planHost,                    // Einhängepunkt der Übernahme-Vorschau
});
```

🔴 **`showFeedbackToast` sitzt in `js/map-features/map-features.js`** — einem Kartenmodul mit
Leaflet-Abhängigkeiten. Es kann nicht mitwandern. Wer es im Treiber stehen lässt, baut eine Datei,
die auf der neuen Seite mit `ReferenceError` abbricht — und zwar **mitten in einem
zehnminütigen Lauf**, nicht beim Laden.

⚠️ Der Treiber kennt **keinen Wirt** (kein `if (imPanel)`). Dieselbe Regel wie beim Bauteil der
Wiki-Zuweisung: das Bauteil kennt keine Objektart.

### §4.4 Was in der Karte bleibt

* Der **Dump-Bericht im Konfliktzentrum** („Letzter Dump-Lauf", `review-conflicts.js:898`) bleibt
  unangetastet: er liest den gespeicherten Bericht **vom Server**, nicht aus dem Lauf.
* Die vier **„Syncen"-Knöpfe** je Objektart bleiben, wo sie sind. Sie sind kein Dump.

⚠️ **Der Knopf verschwindet aus dem Panel — das ist eine sichtbare Änderung** und geht nach
AGENTS.md §9 als eigener Commit live, mit einem Satz im Betreff, der sagt, wohin er gewandert ist.
Sonst sucht ihn am nächsten Tag jemand.

### §4.5 Die Zugangsdaten kommen ans Licht

Heute erscheint der Dialog **nur**, wenn ein Lauf mit HTTP 401 scheitert — man kann die
Zugangsdaten also nicht setzen, ohne erst einen Fehlschlag zu erzeugen. Auf der neuen Seite steht
eine Zeile „Dump-Zugangsdaten" mit dem gespeicherten Benutzernamen und einem Knopf „Ändern".

🔴 **Das Passwort wird nie zurückgegeben** — `dump.php` gibt bei `set_dump_credentials` nur den
Benutzernamen zurück, und dabei bleibt es. Angezeigt wird der Name plus „Passwort gespeichert".

---

## §5 Abschnitt 2 — Darstellung

Ein neuer `app_setting`-Schlüssel **`map_display_settings`** (+ `map_display_settings_stamp`),
JSON, nach dem Vorbild von `location_zoom_bands`.

```json
{
  "zoom_fade": { "enabled": true, "out_ms": 100, "in_ms": 200 },
  "start_view": { "zoom": 3, "phone_zoom_offset": 1, "center": [497.28, 520.5] },
  "map_style": "stylized"
}
```

💣 **Die Vorgaben reproduzieren das heutige Bild Ziffer für Ziffer.** Jede Zahl oben steht heute
so im Code (§1.4). Ein Test führt die abgeschafften Konstanten als **Zeugen** mit — dieselbe
Bauform wie `js/map-features/__tests__/zoombaender-vorgabe.test.js`, und aus demselben Grund: wer
diese Kopie „aufräumt", nimmt dem Umbau seinen einzigen Beleg.

🔴 **Ein fehlender Wert heißt „nimm die Vorgabe", nicht „null".** Zurücksetzen **löscht die
Zeile**, statt eine Kopie der Vorgabe zu hinterlassen — die veraltete sonst beim nächsten
Code-Wechsel still.

### §5.1 Überblenden beim Zoomwechsel

Ein Haken „Beim Zoomwechsel überblenden", Vorgabe AN, dazu die zwei Dauern in ms.

Wirkung: eine Klasse am Kartencontainer (`avesmaps-zoom-fade-aus`) und zwei CSS-Variablen für
die Dauern. Aus heißt: harte Schnitte, wie vor dem 30.06.2026.

💣 **Es sind ZWEI Mechanismen, nicht einer** — und wer nur einen abschaltet, bekommt ein
halbes Bild: die Marker faden per **JS-Opacity am Canvas**
(`map-features-location-canvas-layer.js`), die Beschriftungen per **CSS-Regel am Pane**
(`css/features/map-labels.css`). Der Schalter muss beide erreichen. Der Grund für die Trennung
steht in `zoom-fade-and-bootstrap-loadorder` und bleibt gültig: die einzelnen Labels tragen
Inline-`opacity`, eine Per-Label-Regel würde sie überschreiben.

⚠️ **Tiles, Grenzen, Schraffur, Wege und Kraftlinien fadet niemand** — die skalieren nativ mit
und sind von diesem Schalter nicht berührt. Der Erklärsatz im Fenster muss das sagen, sonst
erwartet jemand ein anderes Ergebnis.

### §5.2 Startansicht

Startzoom, Telefon-Abzug und Startmittelpunkt.

💣 **Der Startzoom ist ein GEKOPPELTER Wert, und `bootstrap.js` sagt es selbst:** die
Zoomstufe des Kontinent-Labels („Sichtbar bis Zoom") und diese Zahl müssen zusammen wandern.
Am 05.08.2026 wurde das Band auf 0..3 verbreitert, die Suche flog auf 3 und der Start blieb auf 2
— gemeldet als Fehler. Das Fenster muss beim Speichern den gespeicherten Wert des Kontinent-Labels
lesen und **warnen**, wenn die zwei auseinanderlaufen. Es soll ihn nicht heimlich mitziehen: die
zweite Zahl gehört einem Kartenobjekt, nicht dieser Einstellung.

💣 **Die Startansicht darf den Kartenstart NICHT blockieren.** `bootstrap.js` erzeugt die Karte
mit `setView(...)`; darauf zu warten hieße, eine Anfrage in den kritischen Pfad zu legen.
⭐ Stattdessen: Karte auf dem einkompilierten Wert erzeugen, und **vor dem Lüften des
Startladen-Schleiers** (19.08.2026) auf den eingestellten Wert setzen. Kein Blockieren, kein
sichtbarer Sprung.

⚠️ Der Telefon-Abzug ist eine **Differenz**, keine zweite Zahl (`max(0, zoom - offset)`) — genau
so steht es heute im Code, und der Kommentar dort begründet, warum der Unterschied genau eine
Stufe ist.

### §5.3 Kartenstil-Vorgabe

Welchen Stil ein Besucher zuerst sieht — heute `stylized`.

⚠️ Betrifft **nur den ersten Eindruck**. Ein gespeicherter Editor-Zustand
(`avesmaps.edit.mapStyle`) und `?mapstyle=` schlagen ihn, und beide prüfen ohnehin gegen
`MAP_TILE_STYLES` — ein unbekannter Schlüssel greift nicht durch.

🔴 **Die Auswahl kommt aus `MAP_TILE_STYLES`, nie aus einer abgeschriebenen Liste.** Am
18.08.2026 fiel „Politics" weg; eine zweite Liste hier hätte auf gelöschte Kacheln gezeigt.

### §5.4 Wie die Werte zum Besucher kommen

Ein öffentlicher Leser **`GET /api/app/map-display.php`**, gebaut wie `api/app/zoom-bands.php`:

* 🔴 **fällt offen aus** — jeder Fehler ergibt `settings: null`, nie ein 500; der Browser hat
  seine Vorgaben und zeichnet wie bisher
* macht **kein DDL** (`avesmapsAppSettingGetManyWithoutDdl`)
* schwacher ETag auf dem Stempel

⚠️ **Das ist eine zweite Anfrage beim Start.** Sie ist winzig und darf nichts aufhalten (§5.2),
aber sie zählt zum fetch-Fan-out. Sollte sich das je als spürbar erweisen, ist die Zusammenlegung
mit `zoom-bands.php` die Stelle — nicht ein dritter Endpunkt.

---

## §6 Abschnitt 3 — Automatik

Die zwei Schalter aus §1.1, die heute niemand umlegen kann:

| Beschriftung | Schlüssel | Bedeutung |
|---|---|---|
| Karten-Vorschauen automatisch holen | `citymap_autoget_enabled` | fehlende Stadtplan-Vorschauen im Hintergrund nachladen |
| Literatur-Cover automatisch holen | `adventure_cover_autoget_enabled` | fehlende Cover im Hintergrund nachladen |

Reine Verdrahtung: die Leser existieren, die Setter-Muster existieren
(`avesmapsCitymapAutogetEnabled`, `avesmapsGameLiteratureCoverAutogetEnabled`).

💣 **Der Schreibweg muss zurücklesen.** `app_setting.setting_value` hat schon einmal still
gekürzt, und der Speichern-Knopf der Tempowerte tat deshalb wochenlang nichts, ohne je zu klagen.
Für `'0'`/`'1'` ist die Kürzung zwar unmöglich — die **Regel** gilt trotzdem, weil ein Marker nie
bezeugen darf, dass ein Schreibvorgang stattgefunden hat.

---

## §7 Abschnitt 4 — Übersicht (lesen, nicht schalten)

**Dreizehn Zeilen:** die elf Schalter aus §1.1, die eine Bedienung haben und in ihren Editoren
bleiben, **plus die zwei Zahlentafeln aus §1.2** (Zoombänder, Tempowerte). Für alle gilt dasselbe:
**Zustand lesbar, plus ein Verweis auf den Ort, an dem sie umgelegt werden.**

⚠️ Die zwei Tafeln zeigen statt „An"/„Aus" den Vermerk „Tafel" — ein Schalterzustand wäre dort eine
Lüge — es sind JSON-Tafeln, `travel_values` allein ist über 1400 Zeichen lang (AGENTS.md §10).
Die beiden Schalter **ohne** heutige Bedienung stehen
hier nicht: die sind seit §6 echte Bedienelemente auf dieser Seite.

🔴 **Kein zweiter Bedienort.** Hier steht kein Schalter, sondern eine Auskunft. Der Gewinn ist
echt: heute muss man vier Editoren öffnen, um zu sehen, ob die Wappen an sind.

| Spalte | Inhalt |
|---|---|
| Was | „Ortswappen im Frontend" |
| Zustand | „An" / „Aus", aus dem gelesenen Wert |
| Wo | Verweis auf den Editor, der ihn trägt |

Ein Endpunkt `GET`-Zweig liest alle dreizehn in **einem** Aufruf
(`avesmapsAppSettingGetManyWithoutDdl` kann genau das — er existiert, weil `map-search.php`
dasselbe Problem hatte).

⚠️ **Der Verweis führt in die Karte, und die Karte ist der andere Tab.** Ein Link auf
`/edit/` öffnet eine zweite Shell. Deshalb nennt die Spalte den Ort in Worten („Ortseditor →
Menüband") statt eines Links, der ins Leere führt — ausgenommen die Editoren mit eigener Seite
(Kartensammlung, Literatur), die verlinkt werden können.

---

## §8 Abschnitt 5 — Wartung

Zwei Verweise, dieselben Ziele wie im Hamburger: **Datenbank-Backup** (`/edit/backup.php`) und
**Benutzerverwaltung** (`/admin/`).

⚠️ Das ist bewusst eine Wiederholung: wer die Einstellungsseite offen hat, soll nicht ins Menü
der anderen Registerkarte zurückmüssen. Es sind Verweise, keine zweite Umsetzung — die Gefahr, vor
der AGENTS.md warnt, entsteht bei zwei *Bedienungen*, nicht bei zwei Türen zum selben Raum.

---

## §9 Die Fallen, gesammelt

1. 💣 **`showFeedbackToast` ist ein Kartenmodul** — der geteilte Dump-Treiber darf es nie direkt
   rufen; er bekommt sein Melden vom Wirt (§4.3).
2. 💣 **Der Startzoom ist gekoppelt** an „Sichtbar bis Zoom" des Kontinent-Labels (§5.2).
3. 💣 **Die Startansicht darf den Kartenstart nicht blockieren** — hinter den Schleier, nicht
   davor (§5.2).
4. 💣 **Das Überblenden hat zwei Mechanismen** (JS-Canvas und CSS-Pane); ein Schalter, der nur
   einen erreicht, liefert ein halbes Bild (§5.1).
5. 💣 **Die Vorgaben reproduzieren das heutige Bild Ziffer für Ziffer**, und Zurücksetzen löscht
   die Zeile (§5).
6. 💣 **Jeder Schreibweg liest zurück** (§6).
7. ⚠️ **Eine `.php`-Seite erreicht der Deploy-Stempler nie** (AGENTS.md §7). Ihre CSS/JS-Verweise
   bekommen das **`filemtime`-Muster** aus `edit/index.php:57/67` — nicht den handgeschriebenen
   `?v=` aus `backup.php:63`. Der eine kann nicht veralten, der andere schon.
8. ⚠️ **Der Riegel steht zweimal** — Seite und Endpunkt (§3.3).
9. 🔴 **Beschriftung wandert, Kennung nicht.** Wenn später etwas umgetauft wird, bleiben Dateinamen,
   `app_setting`-Schlüssel und Endpunktadressen, wie sie sind — dieselbe Trennung wie bei
   „Neuigkeiten"/`changelog`. Der Deploy löscht nie.

---

## §10 Tests

| Test | sichert |
|---|---|
| `js/wiki/__tests__/dump-holen-wirt.test.js` | der Treiber ruft **keinen** der drei nicht-portablen Helfer direkt (Quelltextprüfung, Kommentare vorher heraustrennen) |
| `js/wiki/__tests__/dump-holen-ablauf.test.js` | die Vier-Schritt-Kette bricht ab, sobald ein Schritt scheitert; `dumpLocked` beendet die Schleife statt zu wiederholen |
| `js/map-features/__tests__/darstellung-vorgabe.test.js` | die Vorgaben reproduzieren die heutigen Konstanten (mit den alten Werten als Zeugen) |
| `js/app/__tests__/zoom-fade-schalter.test.js` | der Schalter erreicht **beide** Mechanismen |
| `api/_internal/app/__tests__/map-display-test.php` | Formprüfung, Schranken, Rückleseprobe, `reset` löscht die Zeile |
| `edit/__tests__/einstellungen-riegel-test.php` | Seite **und** Endpunkt tragen `admin` |

⚠️ Vor dem Push läuft das **ganze** Testfeld, nicht nur diese sechs (AGENTS.md §9) — samt der 21
`tools/wikidump/test-*.php`, die das übliche Muster nicht findet.

---

## §11 Stufen danach (nicht Teil dieses Entwurfs)

* **Stufe 2:** die elf Schalter aus §1.1 wandern wirklich her; die Editorkacheln fallen. Einzeln
  live, mit einem Satz im Commit-Betreff je Schalter.
* **Stufe 3:** die zwei Zahlentafeln (Zoombänder, Tempowerte) bekommen hier einen Eingang —
  wahrscheinlich als Verweis, nicht als zweite Oberfläche.
