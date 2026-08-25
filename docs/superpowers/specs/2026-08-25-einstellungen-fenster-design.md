# Das Fenster „Einstellungen" — eine zentrale Schaltstelle für Admins

**Stand 25.08.2026.** Entwurf, mit dem Owner am 25.08.2026 abgestimmt.
Mockup: `docs/einstellungen-mockup.html`.

---

## §0 Kurzfassung

Avesmaps hat **keine Stelle, an der die Konfiguration des Projekts steht**. Elf globale
Notausschalter liegen verstreut über fünf Oberflächen, zwei sind überhaupt nicht bedienbar, fünf
Darstellungswerte leben **ausschließlich in der Adresszeile** (§1.5), die übrigen zentralen
Entscheidungen stehen nur im Code, und „📥 Dump holen" — der Lauf, der die ganze Datengrundlage
erneuert — sitzt in einem Reiter des WikiSync-Panels.

Dieser Entwurf beschreibt **eine Seite**: `/edit/einstellungen.php`, erreichbar über das
Drei-Strich-Menü der Edit-Shell, **nur für Admins**, mit **sieben Reitern** —
Karte · Beschriftung · Reisen · Inhalte · Wiki & Daten · Gemeinschaft · Betrieb.

⚠️ **Der Bestand ist größer als eine Seite.** Die erste Fassung dieses Entwurfs hatte fünf
Abschnitte untereinander und deckte einen Bruchteil ab; der Owner hat am 25.08.2026 Reiter
verlangt, *„ich glaube hier wird noch viel mehr kommen"*. Die Reiter sind deshalb nach **Wirkung**
geschnitten, nicht nach Herkunft — und ein Reiter, der in Stufe 1 leer bleibt, wird trotzdem
gezeigt, damit die Frage „wo käme das hin?" eine Antwort hat (§3.4).

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
* **Kraftlinien-Animation** — `POWERLINE_RENDER_CONFIG.animationEnabled` (`js/config.js:715`).
* **Vorgewählte Ebenen** — `DEFAULT_PLANNER_STATE` (`js/config.js:739`): welche Haken des
  Auge-Menüs an sind, wenn ein Besucher ankommt, plus die Vorgaben des Routenplaners.
* **Weltmaßstab** — `DISTANCE_SCALING_FACTOR`, `TIME_SCALE_FACTOR`, `KM_TO_MILES`
  (`js/config.js:20-22`). 💣 Sie sind der Nenner jeder Entfernung und jeder Dauer.
* **Reisekosten** — `TRAVEL_COST_*` (`js/config.js:203-238`), Zahlen aus Kodex und Geographia.
* **Aufbewahrung** — `AVESMAPS_DB_BACKUP_KEEP_FILES = 3`, `AVESMAPS_ECOSYSTEM_AUDIT_KEEP_ROWS = 200`.
* **Kontaktformular** — `AVESMAPS_CONTACT_RATE_LIMIT_PER_HOUR = 5` und die Spam-Wortliste
  `AVESMAPS_CONTACT_SPAM_WORDS` (`api/app/contact.php:10-11`) — reine Daten, als Konstante abgelegt.
* **Linkprüfer** — `AVESMAPS_LINK_RECHECK_ONLINE_DAYS = 7`, `…_DEAD_DAYS = 14`,
  `AVESMAPS_LINK_DEAD_STREAK = 3`.

### §1.5 🔴 Der wichtigste Fund: die Werte, die nur in der ADRESSZEILE leben

Fünf Darstellungswerte sind heute **ausschließlich** über einen URL-Parameter erreichbar. Sie
wurden angelegt, um beim Bauen den richtigen Wert zu finden — und sind dort geblieben, weil es
keinen Ort gab, an den sie danach gehört hätten.

| Parameter | Was er stellt | Vorgabe | Datei |
|---|---|---|---|
| `?fillopacity=` | Füllung der Herrschaftsgebiete im Frontend | `0.70` | `js/config.js:320` |
| `?leafbg=` | ab welchem Zoom übergeordnete Gebiete solide füllen | `4` | `js/config.js:336` |
| `?hatchopacity=` | Deckkraft der Schraffur umstrittener Gebiete | je Gebiet | `map-features-contested-hatch-overlay.js:34` |
| `?labelrepel=` | Abstoßung zwischen Kartenlabels | `7` | `map-features-label-collisions.js:37` |
| `?labelwrap=` | Umbruchbreite der Gebietsnamen | `0.9` | `map-features-region-rendering.js:48` |

Dazu `?smoothLines=0` / `?smoothRoute=0` (Linienglättung) und `?mapstyle=` (Kartenstil).

⭐ **Das ist zugleich das schärfste Auswahlkriterium für dieses Fenster** (§2.1): Ein Parameter,
der nur existiert, damit jemand einen Wert *sucht*, ist der Beweis, dass der Wert eine Bedienung
verdient hätte und nie eine bekommen hat. Die Kommentare sagen es wörtlich — „live justierbar via
`?labelrepel=20`", „zum Finden des Werts, bei dem das Terrain durchscheint".

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

### §2.1 Der Filter — warum nicht einfach alles

Das Projekt hat **mehrere hundert** Konstanten. Sie alle anzubieten wäre nicht großzügig, sondern
das Gegenteil: der Owner hat am 22.08.2026 entschieden, dass *„der Editor nur 2 Optionen"*
bekommt, während im Mockup zwölf Regler standen — **Werkstattregler gehören ins Mockup, nicht ins
Produkt.** Ein Wert wandert nur dann hierher, wenn mindestens eines gilt:

1. **Es gibt schon einen `?param=` dafür** (§1.5). Der Parameter *ist* das Eingeständnis, dass der
   Wert eine Bedienung braucht.
2. **Der Wert wird gelesen, hat aber keine Bedienung** — die zwei Autoget-Schalter.
3. **Die Antwort ist an verschiedenen Tagen verschieden** — Aufbewahrungsfristen, Notausschalter,
   der erste Eindruck der Karte.

Umgekehrt bleibt im Code, was einmal beantwortet wurde: Zeitüberschreitungen, Höchstlängen,
Rasterweiten, Puffergrößen, die eingefrorenen Code-Flags. **Kein Regler wandert her, nur weil er
sich verstellen ließe.**

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

### §3.4 Die Form innen — SIEBEN REITER

🔴 **Owner-Entscheid 25.08.2026: Reiter, nicht eine lange Seite** — *„ich glaube hier wird noch
viel mehr kommen, du hast nur einen Bruchteil."* Die erste Fassung hatte fünf Abschnitte
untereinander; §1 zeigt, dass das Fenster auf ein Vielfaches zuwächst.

| Reiter | Was hineingehört | Stufe 1 |
|---|---|---|
| **Karte** | Startansicht, Kartenstil, Überblenden, Kraftlinien-Animation, Linienglättung, Territorien-Füllung/Schraffur/Zoomgrenze, vorgewählte Ebenen | ja (ohne Ebenen) |
| **Beschriftung** | Zoombänder (Eingang), Label-Abstoßung, Umbruchbreite, Kurvenbeschriftung | teilweise |
| **Reisen** | Weltmaßstab, Tempowerte (Eingang), Reisekosten, Planer-Vorgaben | nein |
| **Inhalte** | Automatik, plus die Übersicht der Schalter, die anderswo sitzen | ja |
| **Wiki & Daten** | Dump holen, Zugangsdaten, Laufbericht | ja |
| **Gemeinschaft** | Social-Kanäle, Kontaktformular, Besucherzählung | nein |
| **Betrieb** | Backup, Benutzer, Aufbewahrung, Linkprüfer | teilweise |

**Die Ordnung ist nach WIRKUNG geschnitten, nicht nach Herkunft.** „Beim Zoomwechsel überblenden"
steht in einem Kartenmodul, „Startzoom" in `bootstrap.js`, „Füllung" in `js/config.js` — für den
Admin ist alles dreies dieselbe Frage: *wie sieht die Karte aus.* Nach Dateien zu gruppieren
hieße, ihm die Ablage zu erklären statt seine Frage zu beantworten.

⭐ **Das Reiter-Bauteil ist `.avm-tabs`/`.avm-tab` aus `css/components/editor-page.css`** — dasselbe
wie im Wege-Editor. Kein zweites Reiter-Rezept; dieselbe Regel wie bei der Listenzeile
(AGENTS.md §11: „zwei ist die Obergrenze").

💣 **Der Zähler am Reiter wird GERECHNET, nie geschrieben.** Im ersten Bau stand dort eine
abgeschriebene Zahl („Karte 8"), und der Reiter trug in derselben Stunde 9 Zeilen. Eine Zahl, die
ihren eigenen Inhalt behauptet, läuft von der ersten Änderung an auseinander — dieselbe Lehre wie
bei der Bilanzzeile der WikiSync-Listen (EIN Erzeuger). Ein Reiter ohne bedienbare Zeile bekommt
**gar keine** Zahl, keine `0`: eine Null liest sich wie ein Fehler.

💣 **Der Reiterzustand ist eine Variable, keine Klasse.** Am `data-panel` gelesen, nicht an
`is-active` — dieselbe Falle, die beim Anzeige-Menü und bei den Ansichts-Kacheln zweimal
zugeschlagen hat: die Klasse steht erst im nächsten Bild.

🔴 **Speichern je ABLAGE** — nicht je Reiter, nicht für alles, und **nicht je Abschnitt.**

🪤 Hier stand bis zum 25.08.2026 „je Abschnitt", und die Regel war falsch. Im Mockup führte sie
direkt zu einem Fehler: der Reiter „Karte" hat drei Abschnitte, die **alle dieselbe**
`app_setting`-Zeile schreiben (`map_display_settings`) — der oberste bekam eine Leiste, die zwei
darunter keine, und **elf Bedienelemente hatten keinen Speichern-Knopf.** Drei Leisten wären
allerdings auch falsch gewesen: drei Wege, dasselbe Objekt zu schreiben.

Die Regel lautet deshalb: **eine Leiste am Ende jeder Gruppe von Abschnitten, die sich eine Zeile
teilen** — und ihre Meldung sagt ausdrücklich, wie weit sie reicht („Speichert alle drei
Abschnitte — sie liegen in einer Zeile"). Heute ergibt das:

| Gruppe | Ablage | Leisten |
|---|---|---|
| Karte: Erster Eindruck + Bewegung + Herrschaftsgebiete | `map_display_settings` | 1 |
| Beschriftung: Kollisionen + Abstände | `map_display_settings` | 1 |
| Beschriftung: Kurvenbeschriftung | eigene Zeile (Entwurf 22.08.) | 1 |
| Inhalte: Automatik | zwei einzelne Schalter | 1 |

⚠️ **Die Prüfung dazu ist mechanisch und gehört in den Test:** kein Bedienelement darf *unterhalb*
seiner Leiste stehen, und keine Gruppe mit Bedienelementen darf ohne Leiste sein. Beides lässt sich
aus dem DOM messen; genau so ist der Fehler gefunden worden.

⚠️ **Gruppierung durch Trennlinie, nicht durch Kästen** (AGENTS.md §12): `--color-divider` plus
Überschrift. Keine gerahmten Boxen.

⭐ **Ein Reiter, der in Stufe 1 nichts Gebautes trägt, wird trotzdem GEZEIGT** — mit seinen
Abschnittsüberschriften und einem Satz, was dort hingehört, sichtbar gedämpft und als „später"
markiert. Ein leerer, aber benannter Platz beantwortet die Frage „wo käme das hin?", und genau die
stellt sich beim nächsten Wert. Ein Reiter, den es noch nicht gibt, beantwortet sie nicht.

---

## §4 Reiter „Wiki & Daten" — der Dump-Umzug

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

### §4.4b 🔴 Der Lauf gehört der HÜLLE, nicht dem Fenster

Owner am 25.08.2026: *„Prozesse, die in den Einstellungen angestoßen werden, z. B. Dump holen,
sollen nicht davon abhängig sein, ob das Fenster auf oder zu ist."*
Entwurf und Mockup: **`docs/vorgangsanzeige-mockup.html`**.

🪤 **Zuerst die Grenze, denn sie bestimmt alles Weitere: es gibt keinen Server-Läufer.** Auf STRATO
läuft kein Hintergrundprozess und kein Zeitplan im Haus — `api/social/routine-post.php` wird von
**außen** mit einem Token angestoßen. Ein Schrittlauf wie „Dump holen" (bis zu 2000 Teilschritte,
je einer pro Anfrage) kommt nur voran, solange **irgendein Browser ihn treibt**.

**„Unabhängig vom Fenster" heißt hier also genau: unabhängig vom EINSTELLUNGS-Fenster.** Das ist
erreichbar und deckt den gemeldeten Fall vollständig ab. „Unabhängig von jedem Fenster" ist es
nicht, und dieser Entwurf verspricht es nicht.

Die Lösung ist ein Wechsel des Wirts:

| | heute | künftig |
|---|---|---|
| Wer treibt | das Dokument, das gestartet hat | die **Edit-Hülle** (`edit/index.php`) |
| Fenster zu | Lauf ist tot | Lauf läuft weiter |
| Hülle zu | — | Lauf **hält an**, ist fortsetzbar |
| Wo man ihn sieht | im startenden Dokument | in der **Kopfleiste**, immer |

⭐ Die Hülle ist der richtige Wirt, weil sie das äußere Dokument ist, die Kopfleiste trägt und
ohnehin offen ist, solange jemand arbeitet. Das Einstellungs-Fenster **bittet** nur um einen Lauf
und zeigt danach denselben Zustand wie die Leiste.

⚠️ **Genau ein Treiber.** Den Riegel gibt es bereits (`avesmapsWikiDumpLockAcquireOrThrow`, der
Server antwortet dem zweiten mit `409 dump_locked`); neu ist nur, dass die Hülle sich vordrängt und
das Fenster von vornherein zusieht, statt es zu versuchen und abgewiesen zu werden.

⚠️ **Ein angehaltener Lauf ist nicht verloren** — Lauf-Zeile und Sperre mit Herzschlag existieren.
Er steht beim nächsten Öffnen als *angehalten* in der Liste.

### §4.4c Die Vorgangsanzeige in der Kopfleiste

Ein Anzeiger **links neben dem Drei-Strich-Menü**, nicht darin.

💣 **Nicht im Menü.** Ein Zustand, der sich ändert, während niemand hinsieht, darf nicht hinter
einem Klick liegen — dieselbe Überlegung wie beim Ansage-Streifen der Landschaften-Isolation und
beim Zähler gesperrter Regionen.

* **Nichts läuft → der Anzeiger ist nicht da.** Kein leerer Platz, kein „0 Vorgänge"; Abwesenheit
  ist die Aussage.
* 🔴 **Ein unbestimmter Fortschritt sieht anders aus als 0 %** — ein Ring auf null ist von „hängt"
  nicht zu unterscheiden. Solange keine Zahl da ist, dreht er.
* 🔴 **„Fertig" und „fehlgeschlagen" verhalten sich VERSCHIEDEN:** fertig verschwindet nach ein paar
  Sekunden von selbst, fehlgeschlagen bleibt stehen, bis jemand quittiert. Ein Fehler, der sich
  selbst wegräumt, ist ein ungesehener Fehler.
* Ein Klick öffnet die Liste — natives `<details>`, dieselbe Bauform wie das Menü daneben.

#### Mobil — der Hamburger bewegt sich nie

💣 **Container-Abfrage, keine Medien-Abfrage.** Was zählt, ist die Breite der **Leiste**, nicht die
des Geräts: dieselbe Hülle kann am Zeiger schmal sein (geteiltes Fenster) und am Telefon im
Querformat breit.

Geschrumpft wird in fester Reihenfolge — **Nebenzeile → Phase → Titel → nur noch der Ring.** Der
Ring bleibt immer, weil er die eigentliche Auskunft trägt.

Gemessen am Mockup: Leiste 962 px → Titel und Phase; 498 px → nur Titel; 373 px → nur Ring und
Zahl. Der Abstand des Hamburgers zum rechten Rand bleibt in **allen** Stufen 12 px, und bei einem
echten Fenster von 375 px wie von 320 px läuft weder die Leiste noch die Seite über.

💣 **Die Leiste muss im Selektor stehen.** `.edit-shell__bar button` (`css/pages/edit.css`) färbt
JEDEN Knopf der Kopfzeile gefüllt-braun ein und hat (0,1,1) — eine blanke `.vorgang`-Regel (0,1,0)
verliert, und der Anzeiger säße als brauner Klotz in der Leiste.
🪤 **Das ist nicht neu:** genau diese Falle steht als 💣-Kommentar in `edit.css`, weil sie
„Abmelden" im Drei-Strich-Menü schon einmal erwischt hat. Sie erwischt jeden, der einen zweiten
Knopf in diese Leiste hängt — und sie fällt beim Hinsehen nicht auf, der Klotz sieht aus wie
Absicht. Beim Bau des Mockups hat sie sofort wieder zugeschlagen und wurde nur durch die Messung
gefunden (`rgb(91,85,72)` statt `--color-panel-soft`).

#### Es ist größer als „Dump holen"

**Neun** lange Läufe stecken heute jeweils in der Seite, die sie gestartet hat, und sterben mit
ihr: Dump holen · Datenbank-Backup · Links prüfen · Karten-Vorschauen holen · Literatur-Cover
holen · Wegprofile rechnen · Höhenraster rechnen · Zugehörigkeit rechnen · Kurven rechnen.

Jeder hat eigenen Fortschritt, eigene Kachel, eigene Abbruchbehandlung. Die Leiste ist der Ort, an
dem sie **ein** Vokabular bekommen — und die Vorgangsliste der Rahmen, in den sich ein zehnter
einhängt, statt sich einen eigenen zu bauen.

🔧 **Vor dem Bau zu entscheiden:**
* Wie das Fenster der Hülle den Startwunsch mitteilt — `BroadcastChannel` (sofort, aber nur bei
  offener Hülle) oder eine Zeile in der Datenbank, die die Hülle pollt (überlebt alles, kostet eine
  Abfrage je Takt).
* Ob ein angehaltener Lauf beim Öffnen der Hülle **angeboten** oder **automatisch** fortgesetzt
  wird. ⚠️ Automatisch heißt: das bloße Öffnen des Editors startet einen zehnminütigen Lauf, den
  niemand angefordert hat.
* Ob die Leiste auch im **Frontend** erscheint. Dort gibt es keine Kopfleiste, und ein Besucher hat
  damit nichts zu tun — vermutlich nein.

### §4.5 Die Zugangsdaten kommen ans Licht

Heute erscheint der Dialog **nur**, wenn ein Lauf mit HTTP 401 scheitert — man kann die
Zugangsdaten also nicht setzen, ohne erst einen Fehlschlag zu erzeugen. Auf der neuen Seite steht
eine Zeile „Dump-Zugangsdaten" mit dem gespeicherten Benutzernamen und einem Knopf „Ändern".

🔴 **Das Passwort wird nie zurückgegeben** — `dump.php` gibt bei `set_dump_credentials` nur den
Benutzernamen zurück, und dabei bleibt es. Angezeigt wird der Name plus „Passwort gespeichert".

---

## §5 Reiter „Karte" und „Beschriftung" — die Darstellung

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

### §5.5 🪤 Die Füllung ist eine ÜBERSTEUERUNG, keine Vorgabe

Owner am 25.08.2026: *„Füllung der Flächen ist nur der Default wert oder? die editoren können die
transparenz ja ändern."* **Nein — und der Unterschied ist der ganze Punkt.**

Gemessen an `map-features-region-rendering.js:202-207`:

```js
const activeFillOpacity = (!IS_EDIT_MODE
    && regionEntry.source === "political_territory"
    && typeof POLITICAL_FRONTEND_FILL_OPACITY === "number"
    && Number.isFinite(POLITICAL_FRONTEND_FILL_OPACITY))
    ? POLITICAL_FRONTEND_FILL_OPACITY      // <- gewinnt IMMER, für JEDES Gebiet
    : regionEntry.opacity;                 // <- nur im Editor, oder wenn der Wert null ist
```

* Editoren **setzen** weiterhin eine Deckkraft je Gebiet (live liegen dort 0,33 / 0,5 / 0,75).
* Sie **sehen** sie auch — aber nur im Editor (`IS_EDIT_MODE`).
* Ein **Besucher sieht sie nie**: 0,70 überschreibt jede einzelne.

🔴 **Deshalb ist das Bedienelement zweiwertig, kein bloßer Regler:** eine Auswahl
**„einheitlich (Zahl)" ↔ „je Gebiet"**, wobei „je Gebiet" den gespeicherten Wert auf `null` setzt
und damit die Editorwerte im Frontend wieder durchlässt. Genau dieser Zustand ist im Code als
Ausweg vorgesehen (*„auf null setzen -> wieder per-Territorium"*) und heute **über keinen Weg
erreichbar** — auch nicht über `?fillopacity=`, denn der Parser nimmt nur Zahlen.

⚠️ Ein Regler allein wäre die gefährlichere Bauform: er sähe aus wie eine Vorgabe und wäre eine
Enteignung. Wer 0,70 auf 0,50 zieht, ändert nicht „die Vorgabe für Gebiete ohne eigenen Wert",
sondern **alle**.

⭐ Für die Schraffur (`?hatchopacity=`) gilt derselbe Bau — sie folgt im Frontend derselben
Zahl (`map-features-contested-hatch-overlay.js:121-126`).

### §5.6 🔴 Beschriftung: eine KOLLISIONSMATRIX, nichts Ortsspezifisches

Owner am 25.08.2026: *„nichts ortsspezifisches, es geht mehr insgesamt um ‚kollisionen an/aus‘ …
oder kollision zwischen Orten – Regionen, Orten – Flüssen/Straßen, Flüssen – Straßen – Regionen
(ne matrix?)"*

**Es geht.** Und die Bestandsaufnahme sagt genau, in welcher Form.

#### Was heute läuft — vier Klassen in einer festen Rangfolge

| # | Klasse | Quelle | Wie sie ausweicht |
|---|---|---|---|
| 1 | **Gebietsnamen** | `regionLabels` (Herrschaftsgebiete) | bis ±40 px in 8 Richtungen; wird **nie** versteckt |
| 2 | **Landschaftstitel** | `labelMarkers` / `.map-label` (Kontinent, Meer, Landschaft) | feste Landmarke, Prio 1000+ |
| 3 | **Ortsnamen** | `locationNameLabels` | 12 Nachbarstellen; sonst `is-colliding` (unsichtbar) |
| 4 | **Wege-/Flussnamen** | Canvas-Overlay | rutscht **nur an der eigenen Linie** (300 px); sonst fällt die Platzierung aus |

Die Klassen laufen in dieser Reihenfolge; jede Stufe reicht ihre belegten Rechtecke an die nächste
weiter (`publishLabelOccupancy` → `labelOccupancyBlocksGlyphs`). Dazu gibt es **eine
Selbstprüfung** je Klasse — bei den Wegnamen heißt sie im Code „Kanal A" (`blockedByOwnKind`).

#### 💣 Die Matrix ist DREIECKIG, und das ist keine Bequemlichkeit

Ein Matrixfeld kann nur sagen: **„darf X über Y liegen?"** Es kann **nicht** sagen, wer ausweicht
— das entscheidet allein die Rangfolge, und die ist **gemessen, nicht gesetzt**: die Umkehrung von
Ortsnamen und Wegnamen erreicht zwar auch null Überlappungen, blendet aber **503 zusätzliche
Ortsnamen** aus (444 → 947, Entwurf vom 05.08.2026). Wer „Ortsnamen weichen Gebietsnamen" abschaltet,
bekommt Überlappung — nicht weichende Gebietsnamen.

Damit hat die Tafel **sechs Paarfelder** (jede spätere Klasse gegen jede frühere) und **vier
Selbstfelder** auf der Diagonale:

|  | Gebiet | Landschaft | Ort | Weg |
|---|---|---|---|---|
| **Gebiet** | ⬦ selbst | — | — | — |
| **Landschaft** | ✓ | ⬦ selbst | — | — |
| **Ort** | ✓ | ✓ | ⬦ selbst | — |
| **Weg** | ✓ | ✓ | ✓ | ⬦ selbst (Kanal A) |

Dazu **ein Hauptschalter „Kollisionen berücksichtigen"** — aus heißt: jedes Label steht an seinem
Platz und überlappt. Das ist kein Unsinn, sondern das schnellste Diagnosemittel für die Frage
„liegt mein Label falsch, oder ist es nur weggeblendet?" — genau die Frage, die den Owner am
28.07.2026 vier duplizierte Labels suchen ließ, von denen alle vier in der Datenbank standen.

#### Wie es gebaut wird

⭐ **Jedes belegte Rechteck bekommt eine Klassenmarke**, und die Blockierprüfung fragt die Matrix,
statt jedes Rechteck blind zu nehmen. Das ist ein Feld mehr je Eintrag und eine Bedingung mehr in
`labelOccupancyBlocksGlyphs` bzw. beim Vorbelegen von `acceptedRects` — die Reihenfolge, die
measure-once-Bauform und die Rangfolge bleiben **unberührt**.

💣 **Nicht die Rangfolge konfigurierbar machen.** Sie ist der teuerste gemessene Wert dieses
Systems (503 Namen), und sie ist der Perf-Fix von 2026-06-08 (measure-once → rechnen → write-once).
Eine drehbare Reihenfolge holt beide Probleme zurück.

⚠️ **Die Vorgabe ist: alle zehn Felder an.** Das ist das heutige Verhalten Ziffer für Ziffer.

🔧 **Offen und ehrlich zu nennen:** ob eine halb abgeschaltete Matrix ein *brauchbares* Kartenbild
ergibt, ist **ungemessen**. Sie ist als Werkzeug gedacht, nicht als Schönheitsregler — und die
Abnahme muss an der echten Karte stattfinden, nicht an einer Zähltabelle.

#### 💣 Zwei Fallen der Tafel selbst — beide im Mockup zugeschlagen

Der Owner hat sie am 25.08.2026 an einem Screenshot gesehen, nicht das Werkzeug. Sie stehen hier,
weil sie beim echten Bau genauso zuschlagen.

**(1) In einem Feld steht NUR der Haken.** Die erste Fassung schrieb „selbst" neben den Haken der
Diagonale. Damit war die Zelle breiter als ihre Nachbarn, und weil `text-align: center` das
**ganze Etikett** mittet, verließ der Haken die Spaltenflucht. Die Diagonale sagt sich über ihre
**Fläche** (`.es-diag`, `--color-panel-soft`) plus eine Legende, nie über Text im Feld.

**(2) Die Kopfzelle muss mittig stehen UND symmetrisch gepolstert sein.** Zwei unabhängige
Ursachen, beide aus der geteilten `.es-table`:
* `.es-table th` ist **linksbündig** — richtig für die Übersichtstabelle, falsch für eine Matrix.
* `.es-table td/th` polstern nur **rechts** (`… var(--space-8) … 0`). Eine einseitige Polsterung
  verschiebt die Mitte des Inhaltskastens um ihre halbe Breite — hier 5 px.

🪤 **Und die Tarnung:** `td:last-child` hat `padding-right: 0`, war also symmetrisch und stand als
einzige richtig. Ein Versatz, der in **drei von vier** Spalten auftritt und in der vierten nicht,
sieht wie ein Zufall aus und ist keiner. Gemessen wird gegen die Mitte des **sichtbaren Textes**
der Kopfzeile (per `Range`), nicht gegen die Zelle — die Zelle kann mittig sein, während der Text
in ihr am Rand klebt.

**(3) Die Speicherleiste gehört an ihre Bedienelemente.** Zwischen Tafel und „Speichern" standen
zwei volle Absätze in Lesegröße; der Knopf saß dadurch weit unter seinen Häkchen und las sich, als
gehöre er zum Text. Die Begründung der Dreiecksform steht jetzt **oben**, wo sie das Lesen der
Tafel vorbereitet, statt es nachträglich zu erklären; unter der Tafel bleibt eine einzeilige
Legende (11 px, die Untergrenze aus §12). Gemessen: 59 px zwischen Tafel und Leiste.

⚠️ **Die allgemeine Lehre, und sie gilt über die Matrix hinaus:** eine geteilte Tabellenklasse
bringt die Ausrichtung ihres *ersten* Anwendungsfalls mit. `.es-table` wurde für die Übersicht
gebaut (linksbündig, Text) und in der Matrix zweitverwendet (mittig, Häkchen). Wer eine
Tabellenklasse teilt, prüft **Ausrichtung und Polsterung** ausdrücklich nach — sie fallen nicht
auf, solange man nur die Zeilen zählt.

### §5.7 Kurvenbeschriftung — die ganze Werkstatt, aber NUR hier

Owner am 25.08.2026: *„die einstellungen können vollständig hierher."*

Damit ziehen alle zwölf Werte aus `2026-08-22-kurvenbeschriftung-design.md` §6.1 in diesen Reiter:
Glättung, Begradigung, Randvereinfachung, Stützpunktabstand, Mindestgröße einer Teilfläche,
max. Verdrehung, Kurvenverlängerung, Sperrung über die Fläche, Sperrung je Lücke, Mindestabstand
zweier Namen, Ausweichweg, Schrift verkleinern.

🔴 **Das widerspricht der Regel vom 22.08.2026 NICHT — es schärft sie.** Dort hieß es: *„später
will ich, dass die editoren nur 2 optionen haben."* Das Subjekt war der **Editor**, nicht der
Admin. Die Regel lautet damit genauer:

> **Werkstattregler gehören nicht in den EDITOR. Ihr Zuhause sind die Admin-Einstellungen.**

Vorher gab es dieses Zuhause nicht — deshalb hieß die einzige Alternative „einfrieren". Jetzt gibt
es beide Enden: der Editor sieht zwei Schalter (an/aus, Anzahl der Labels), der Admin sieht die
zwölf, mit denen die zwei überhaupt erst richtig eingestellt sind.

⚠️ **Zwei der zwölf sind ausdrücklich ungemessen** — Mindestabstand und Ausweichweg sind „an sechs
Flächen geraten, nicht an 644 gemessen" und stehen laut jenem Entwurf **genau deshalb** in einer
einstellbaren Tafel. Sie gehören hierher, nicht in eine Konstante.

---

## §6 Reiter „Inhalte" — Automatik

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

## §7 Reiter „Inhalte" — die Übersicht (lesen, nicht schalten)

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

## §8 Reiter „Betrieb" — Wartung

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
| `js/pages/__tests__/einstellungen-reiter.test.js` | genau EIN Panel ist sichtbar; der Zähler ist **gerechnet** und stimmt mit dem Inhalt überein; ein leerer Reiter zeigt keine `0` |
| `js/pages/__tests__/einstellungen-speicherleisten.test.js` | **kein Bedienelement ohne Leiste**, keines unterhalb seiner Leiste, keine zweite Leiste auf derselben Ablage |
| `js/pages/__tests__/einstellungen-url-parameter.test.js` | jeder Wert aus §1.5 kommt aus der Einstellung, und der `?param=` schlägt sie weiterhin |

⚠️ Vor dem Push läuft das **ganze** Testfeld, nicht nur diese acht (AGENTS.md §9) — samt der 21
`tools/wikidump/test-*.php`, die das übliche Muster nicht findet.

---

## §11 Stufen danach (nicht Teil dieses Entwurfs)

Die Reiter aus §3.4 sind zugleich die Landkarte dafür. Grob nach Nutzen sortiert:

* **Stufe 2 — die Adresszeilen-Werte** (§1.5): Füllung, Schraffur, Zoomgrenze, Abstoßung,
  Umbruchbreite. Der größte Gewinn je Zeile Arbeit, weil die Leser schon existieren und nur ihre
  Quelle wechseln.
* **Stufe 3 — die elf Schalter aus §1.1** wandern wirklich her; die Editorkacheln fallen. Einzeln
  live, mit einem Satz im Commit-Betreff je Schalter.
* **Stufe 4 — Reiter „Reisen"**: Weltmaßstab und Reisekosten. 💣 Der Weltmaßstab ist der Nenner
  jeder Zahl der Karte; er braucht eine eigene Abnahme, keine Zeile in einem Sammel-Commit.
* **Stufe 5 — Gemeinschaft und Aufbewahrung**: Kontakt-Ratenbegrenzung, Spam-Wortliste,
  Backup-Anzahl, Protokollgrenzen, Linkprüfer-Fristen.

⚠️ **Die Reihenfolge ist keine Zusage.** Sie steht hier, damit die Reiter nicht als Versprechen
gelesen werden: ein Reiter mit „später" sagt „hier wäre der Platz", nicht „das kommt".

🔴 **Zwei Tafeln bleiben, wo sie sind** (Zoombänder, Tempowerte) — sie haben gewachsene,
zieh-bedienbare Oberflächen. Hier gehört nur ihr Eingang hin, nie eine zweite Fassung.
