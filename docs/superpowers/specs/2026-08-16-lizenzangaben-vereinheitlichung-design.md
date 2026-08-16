# Lizenzangaben vereinheitlichen — Entwurf

**Stand:** 2026-08-16 · **Owner-Freigabe:** ja (Umfang, Zuordnung, Sichtbarkeit)

Jeder Bild-Upload in Avesmaps trägt künftig **dieselben sieben Lizenzwerte**, **dieselben
fünf Angaben** und **dasselbe Anzeige-Gate** — statt heute fünf getrennter Vokabulare, die
sich nie abgeglichen haben.

---

## 1. Ausgangslage: fünf Vokabulare, keines kennt das andere

| Fläche | Werte heute | Namensnennung | Vorgabe | Anzeige-Gate |
|---|---|---|---|---|
| **Stadtkarten** (`api/_internal/app/citymaps.php:38`) | `public_domain` `cc0` `ai_generated` `permission_granted` `own_work` `unknown_other` | nur `*_license_note` | `unknown_other` | ja (`avesmapsCitymapLicenseIsFree`) |
| **Siedlungsbilder** (`api/edit/wiki/settlement-images.php:34`) | `public_domain` `cc0` `ai_generated` `unknown_other` | nur `note` (= KI-Prompt) | `ai_generated` | ja (`avesmapsMapFeaturesPublicImageUrls`) |
| **Territoriums-Wappen** (`api/_internal/wiki/sync-monitor-identity.php:318`) | `public_domain` `attribution_required` — der Wiki-Parser liefert zusätzlich `unknown` | `coat_of_arms_author` ✅ | — | ja, **nur `public_domain`** (`api/_internal/coat-url.php:45`) |
| **Siedlungs-Wappen** (`api/edit/wiki/settlement-coat-upload.php:98`) | fest `'own'`, keine Wahl | — | — | **keins** |
| **Literatur-Cover** (`api/edit/map/game-literature-cover.php`) | gar keine | — | — | keins |

Der Kommentar in `citymaps.php:36-37` benennt das Problem selbst — die Siedlungsbild-Lizenzen
stehen „*in three places with nothing keeping them in sync*". Genau diese Divergenz beendet
dieser Entwurf, statt eine sechste Liste danebenzustellen.

**Zwei Befunde, die dabei aufgefallen sind und mitrepariert werden:**

- 💣 **Siedlungs-Wappen haben kein Lizenz-Gate.** `properties.coat` geht ungefiltert an die
  Karte; `api/app/map-features.php:464` kennt nur den globalen An/Aus-Schalter. Ein Upload
  dort steht sofort öffentlich, unabhängig von seiner Herkunft.
- ⚠️ **Literatur-Cover tragen keine Lizenzangabe**, obwohl sie Ulisses-Produktcover zeigen —
  der Fall, für den `NOTICE.md` „Genehmigung unter den Fan-Regeln, bis auf Widerruf" beschreibt.

---

## 2. Der Katalog

Sieben Werte, in genau dieser Reihenfolge im Auswahlfeld. Die Kennungen sind die der
Stadtkarten — sie decken sechs der sieben bereits ab, `cc_by` ist der einzige neue:

| # | Wert | Beschriftung | im Frontend |
|---|---|---|---|
| 1 | `unknown_other` | Unbekannt/Sonstiges | 🔴 **nicht angezeigt** |
| 2 | `public_domain` | Public Domain | angezeigt |
| 3 | `cc0` | CC0 | angezeigt |
| 4 | `cc_by` | CC-BY | 🔴 **nicht angezeigt** |
| 5 | `permission_granted` | Genehmigung erteilt | angezeigt |
| 6 | `ai_generated` | Von uns KI-generiert | angezeigt |
| 7 | `own_work` | Eigene Kreation | angezeigt |

„Nicht angezeigt" heißt: **das Bild** erscheint nicht im Frontend. Der Datensatz bleibt
vollständig erhalten und im Editor sichtbar — die Angabe geht nie verloren, nur die
Veröffentlichung unterbleibt. Das ist exakt das Verhalten, das `unknown_other` heute schon
bei Karten und Siedlungsbildern hat; `cc_by` tritt daneben.

🔴 **Warum CC-BY gespeichert, aber nicht gezeigt wird:** die Namensnennung müsste am Bild
selbst stehen, und diese Fläche gibt es im Frontend nicht (§3 — der Urheber bleibt intern).
Ein CC-BY-Bild ohne sichtbaren Nachweis zu zeigen wäre ein Lizenzverstoß; es gar nicht erst
aufnehmen zu können hieße, die Angabe beim Upload wegzuwerfen. Gespeichert-aber-still ist der
einzige ehrliche dritte Weg. Der bisherige Wert `attribution_required` bei den
Territoriums-Wappen tut genau das schon heute — `cc_by` ist sein Nachfolger unter dem Namen,
den der Owner vorgegeben hat.

⚠️ **`permission_granted` ist keine Lizenz, sondern eine Erlaubnis.** Das Werk kann unter
beliebiger Lizenz stehen; entscheidend ist, dass der Urheber der Nutzung zugestimmt hat —
**ausdrücklich auch ohne genannt zu werden**. Weil diese Zustimmung sonst nirgends nachweisbar
wäre, füllt der Dialog das Kommentarfeld bei dieser Wahl mit einem Vorschlagstext vor:

> *„Urheber ist mit der Nutzung einverstanden, ausdrücklich auch ohne Namensnennung."*

Der Editor kann ihn überschreiben (z. B. um Datum und Kanal der Zusage zu notieren), aber nicht
versehentlich übersehen. 💣 Der Text wird **nur bei leerem Kommentarfeld** eingesetzt und
niemals über einen vorhandenen geschrieben.

---

## 3. Fünf Angaben je Upload

| Feld | Inhalt | Pflicht |
|---|---|---|
| `license` | einer der sieben Katalogwerte | ja (mit Vorgabe je Fläche, §6) |
| `author` | Urheber / Namensnennung, freier Text | nein — **bei allen sieben Werten eintragbar** |
| `note` | Kommentar; bei Siedlungsbildern steht dort heute der KI-Prompt | nein |
| `uploaded_by` | Benutzerkennung des Editors | automatisch |
| `uploaded_at` | Zeitpunkt des Uploads | automatisch |

🔴 **Alle fünf bleiben im Editor.** Kein Besucher sieht Urheber, Kommentar oder Protokoll —
Owner-Entscheid 16.08.2026. Damit ändert sich an Infobox, Karten-Dialog, Ribbon und
Wappen-Darstellung **nichts**; der einzige Frontend-Effekt dieses Entwurfs ist das Gate (§5).

⚠️ Der Urheber ist bei `permission_granted` und `ai_generated` ausdrücklich **erlaubt, nicht
gefordert**: „Ulisses" beim Cover ist eine nützliche Notiz für den nächsten Editor, keine
Namensnennung im Rechtssinne — die fände im Frontend statt, und dort steht sie nicht.

---

## 4. Wo der Katalog lebt

Zwei Dateien, aneinandergebunden durch einen Test:

- `api/_internal/media-license.php` — Katalog, Normalisierung, Gate. Alle Endpunkte lesen hier.
- `js/app/media-licenses.js` — derselbe Katalog für die vier Editorseiten.

```
AVESMAPS_MEDIA_LICENSES          Liste der sieben Werte, in Anzeigereihenfolge
AVESMAPS_MEDIA_LICENSES_PUBLIC   die fünf, die im Frontend erscheinen
avesmapsMediaLicenseNormalize()  unbekannter String -> Vorgabe des Aufrufers
avesmapsMediaLicenseIsPublic()   normalisiert ZUERST, prüft DANN
```

💣 **Normalisieren vor Prüfen, nie umgekehrt.** `citymap-image.php:190-191` begründet das
bereits für die Karten: ein unbekannter String muss auf `unknown_other` fallen und abgelehnt
werden — nie andersherum. Die gemeinsame Funktion erbt diese Reihenfolge.

⭐ **Warum zwei Dateien und kein Bauprodukt:** ein Generat, das aus der PHP-Datei eine JS-Datei
erzeugt, ist die Bauform, an der `political-territory-editor-inline.css` dreimal gescheitert
ist (AGENTS §10) — von Hand hineingeschriebene Regeln wirkten sofort und starben still beim
nächsten Lauf. Ein Endpunkt, der den Katalog ausliefert, wäre eine Quelle, kostet aber je
Editorseite einen Request und einen Ladezustand für eine Liste, die sich nie zur Laufzeit
ändert. Die Klammer ist stattdessen ein Test, der beide Listen Wert für Wert und in der
Reihenfolge vergleicht und bei der kleinsten Abweichung rot wird
(`js/app/__tests__/media-licenses-parity.test.js`). Er ist die einzige Stelle, an der die
Doppelung überhaupt zulässig ist.

⚠️ **Die vier Editorseiten binden externes JS bereits ein** (geprüft: `html/citymap-editor.html`,
`html/wiki-sync-settlement-editor.html`, `html/wiki-sync-monitor.html`,
`html/game-literature-editor.html` tragen alle `<script src="/js/…">`). Sie sind
`html/*.html`-Seiten, also stempelt der Deploy die neue Datei automatisch (AGENTS §7 Regel 1) —
**kein `?v=` von Hand, kein `ASSET_VERSION`-Bump** (der gilt nur den Territorien-Editor-Assets).

Prüfbefehl vor dem Bauen:

```bash
grep -n "script src" html/citymap-editor.html html/wiki-sync-settlement-editor.html html/wiki-sync-monitor.html html/game-literature-editor.html
```

---

## 5. Das Anzeige-Gate

Eine Regel für alle fünf Flächen: **`cc_by` und `unknown_other` erscheinen nicht im Frontend,
die übrigen fünf schon.** Zwei Flächen ändern dabei ihr Verhalten:

**Siedlungs-Wappen bekommen erstmals ein Gate.** `api/app/map-features.php` filtert
`properties.coat` künftig wie schon `properties.images`. Der Bestand wird `ai_generated` (§6)
und bleibt damit sichtbar — die Regel greift erst bei künftigen Uploads.

**Territoriums-Wappen dürfen mehr als gemeinfrei.** `AVESMAPS_COAT_PUBLIC_LICENSES`
(`api/_internal/coat-url.php:45`) steht heute auf `['public_domain']` und wird auf die fünf
öffentlichen Werte erweitert.

🔴 **Das ist eine bewusste Lockerung, und sie hat einen Grund:** die Editoren erzeugen ihre
Wappen mit KI. Bei den Siedlungen stehen diese Wappen längst auf der Karte (mangels Gate);
bei den Territorien wären sie unsichtbar, obwohl niemandes Rechte berührt sind. Ein
KI-generiertes oder selbst gezeichnetes Wappen als „nicht gemeinfrei, also weg" zu behandeln,
verwechselt die Herkunft mit der Erlaubnis. `NOTICE.md` beschreibt das alte Verhalten und wird
mit angepasst.

⚠️ **Was sich NICHT ändert:** die Reihenfolge in `avesmapsResolveGatedCoatUrl` (Override →
eigen → Staging), der leere Override als bewusstes „kein Wappen", der Cache-Buster, und die
Rangfolge Gate-vor-Schalter aus `coat-display.php:92-94`. Der Schalter bleibt eine
Anzeigepräferenz **nach** dem rechtlichen Riegel — ein wieder eingeschaltetes „Wappen: An"
darf nie etwas hervorholen, das das Gate verworfen hat.

---

## 6. Migration

### 6.1 Zuordnung der Bestandswerte

| Fläche | heute | wird | sichtbar vorher → nachher |
|---|---|---|---|
| Territoriums-Wappen | `attribution_required` | `cc_by` | nein → nein |
| Territoriums-Wappen | `unknown`, leer, NULL | `unknown_other` | nein → nein |
| Territoriums-Wappen | `public_domain` | unverändert | ja → ja |
| Siedlungs-Wappen | `'own'` | `ai_generated` | ja → ja |
| Siedlungs-Wappen | `'public_domain'` (Wiki-Übernahme) | unverändert | ja → ja |
| Literatur-Cover | (kein Feld) | `permission_granted`, `author` = „Ulisses" | ja → ja |
| Siedlungsbilder | alle vier Werte | unverändert | unverändert |
| Stadtkarten | alle sechs Werte | unverändert | unverändert |

🔴 **Die tragende Zusicherung: kein einziges Bild wechselt seine Sichtbarkeit.** Das ist der
Abnahmefall, nicht eine Nebenbemerkung — er wird als Test festgeschrieben (§8), weil eine
Migration, die still ein paar hundert Wappen abschaltet, von einer geglückten nicht zu
unterscheiden wäre, bis es jemandem auffällt.

💣 **`'own'` heißt heute „von einem Editor hochgeladen", nicht „selbst erschaffen"** — der Wert
steht fest verdrahtet in `settlement-coat-upload.php:98` und sagt nichts über die Lizenz. Er
wird trotzdem `ai_generated` und nicht `own_work`: die Editoren haben diese Wappen nach und
nach mit KI erzeugt (Owner 16.08.2026). Beide Werte sind öffentlich, die Sichtbarkeit hängt
also nicht daran — wohl aber die Aussage im Datenbestand, und `ai_generated` ist die, die
zutrifft.

💣 **Der Wiki-Lizenzparser muss mitwandern, sonst kommt der alte Wert zurück.**
`avesmapsWikiSyncMonitorParseLicense` (`api/_internal/wiki/sync-monitor-licenses.php:154-172`)
schreibt `attribution_required` für CC-BY, CC-BY-SA, CC-BY-NC/ND, generisches „Creative
Commons" und GFDL. Er schreibt künftig `cc_by`. ⚠️ Alle fünf fallen damit auf einen Wert
zusammen — folgenlos, weil sie sämtlich „nicht angezeigt" sind und der Katalog bewusst keine
Feinunterscheidung anbietet. Das Klartextfeld `coat_of_arms_license` behält die genaue
Bezeichnung („CC-BY-SA-3.0"), es geht also keine Information verloren.
Prüfbefehl: `grep -rn "attribution_required" api/ js/ tools/`

### 6.2 Upload-Protokoll rekonstruieren

Ein Einmal-Lauf, resumierbar wie die übrigen Wartungsläufe, mit Vorschau vor dem Schreiben:

1. **`uploaded_at` aus dem Datei-Datum.** `filemtime` über `/uploads/wappen/own/`,
   `/uploads/siedlungen/`, `/uploads/kartensammlungen/`, `/uploads/questcovers/`. ⚠️ Der Lauf
   muss **auf dem Server** laufen — diese Verzeichnisse liegen nicht im Repo (geprüft: `ls
   uploads/` zeigt nur Dumps und Backups).
2. **`uploaded_by` aus `map_audit_log`, wo auffindbar.** Die Tabelle trägt `feature_id`,
   `action`, `actor_user_id`, `before_json`, `after_json`, `created_at`. Ein Siedlungs-Wappen-
   Upload hinterlässt eine `wiki_sync_update_point`-Zeile, deren `after_json` ein
   `coat.source === 'own'` trägt, das im `before_json` fehlt oder eine andere URL hat.
   ⚠️ **Der Treffer ist nicht garantiert** und gilt nur dieser einen Fläche: die Aktion ist
   generisch, das Protokoll kann beschnitten sein, und für Karten, Bilder und Cover gibt es
   keine vergleichbare Spur. Wo nichts gefunden wird, bleibt das Feld leer.
3. **Leer heißt leer.** Der Editor zeigt „unbekannt". 🔴 Kein Platzhaltername, keine Annahme
   „wird schon der Owner gewesen sein" — ein erfundener Eintrag wäre später von einem echten
   nicht mehr zu unterscheiden, und das Protokoll wäre als Nachweis wertlos.

### 6.3 Neue Spalten

| Tabelle | neu |
|---|---|
| `citymap` | `map_license_author`, `map_uploaded_by`, `map_uploaded_at`, dieselben drei für `thumb_` |
| `adventure` | `cover_license`, `cover_author`, `cover_note`, `cover_uploaded_by`, `cover_uploaded_at` |

Siedlungsbilder und beide Wappenarten brauchen **keine** DDL — sie liegen in
`properties_json` bzw. in `metadata_overrides_json`, und ein zusätzlicher Schlüssel ist dort
kostenlos.

💣 **Rückfall `'' AS spalte` gleich mitbauen.** Die DDL läuft im Haus per self-healing beim
Sync; ein Lesepfad, der eine noch nicht angelegte Spalte selektiert, fällt in sein `try/catch`
und liefert eine leere Liste — ein stiller Live-Ausfall, der wie „keine Daten" aussieht. Jeder
neue `SELECT` bekommt den Rückfall, bevor er ausgeliefert wird.

💣 **`author` als `VARCHAR(190)`, nicht kürzer.** Eine stille MySQL-Kürzung ist von „nie
gespeichert" nicht zu unterscheiden — die Lehre aus `app_setting.setting_value` (AGENTS §10).
`note` folgt den vorhandenen `*_license_note` mit `VARCHAR(2000)`.

---

## 7. Die fünf Dialoge

Alle bekommen dieselbe Reihe: **Lizenz (Auswahl) · Urheber · Kommentar**, darunter die
graue Protokollzeile „hochgeladen von X am TT.MM.JJJJ". Vorgabe je Fläche — jede behält die
heutige, damit sich an bestehenden Arbeitsabläufen nichts ändert:

| Dialog | Datei | Vorgabe | heute dort |
|---|---|---|---|
| Stadtkarten | `html/citymap-editor.html:618` | `unknown_other` | 6 Werte, Notiz |
| Siedlungsbilder | `html/wiki-sync-settlement-editor.html:1505` | `ai_generated` | 4 Werte, Notiz |
| Siedlungs-Wappen | `html/wiki-sync-settlement-editor.html` (Upload-Dialog) | `ai_generated` | keine Wahl |
| Territoriums-Wappen | `html/wiki-sync-monitor.html` (Upload-Dialog) | `public_domain` | 2 Radios + Urheber |
| Literatur-Cover | `html/game-literature-editor.html` | `permission_granted` | keine Wahl |

⚠️ **Der Hinweistext bei den Siedlungsbildern wird sachlich falsch und muss mit.**
`wiki-sync-settlement-editor.html:1549` sagt heute „*Wir verwenden auch keine Bilder mit
Namensnennung oder unter sonstigen Lizenzen (CC, GNU, …)*". Verwendet werden sie weiterhin
nicht — aber sie lassen sich künftig **hinterlegen**. Der Text sagt das künftig auch.

⚠️ **Die zwei Radios beim Territoriums-Wappen werden ein Auswahlfeld** — dieselbe Form wie
überall. Der serverseitige Riegel in `avesmapsWikiSyncMonitorUploadCoat:318` (heute
`in_array($license, ['public_domain', 'attribution_required'])`) nimmt künftig den Katalog.

⚠️ Designsprache nach AGENTS §12: die Auswahl ist ein normales Formularfeld in der bestehenden
Gruppe, kein neuer Rahmen. Kein hartkodierter Farbwert, keine Schrift unter 11px, „Hochladen"
bleibt die einzige gefüllte Schaltfläche des Dialogs.

---

## 8. Tests

| Test | sichert |
|---|---|
| `js/app/__tests__/media-licenses-parity.test.js` | PHP-Katalog == JS-Katalog, Werte **und** Reihenfolge. Liest die PHP-Datei als Text und zieht die Liste heraus — dasselbe Muster wie `css-comment-balance.test.js`, das ebenfalls fremde Dateien liest, statt sie auszuführen |
| `api/_internal/__tests__/media-license-test.php` | Normalisierung fällt auf die Vorgabe des Aufrufers; unbekannter String wird nie öffentlich; `cc_by`/`unknown_other` sind nicht öffentlich |
| `api/_internal/__tests__/media-license-migration-test.php` | 🔴 **der Abnahmefall:** je ein Datensatz jeder Fläche mit jedem Altwert durch die Zuordnung — kein Wechsel der Sichtbarkeit |
| `api/_internal/__tests__/coat-resolve-test.php` (Erweiterung) | Siedlungs-Wappen werden gegated; `ai_generated` bleibt sichtbar; die Rangfolge Gate-vor-Schalter hält |
| `api/_internal/wiki/__tests__/coat-license-parsing-test.php` (Anpassung) | der Parser schreibt `cc_by` statt `attribution_required` |

💣 **Vor dem Push läuft das ganze Testfeld**, einschließlich der 21 `tools/wikidump/test-*.php`,
die das `__tests__`-Muster nicht findet (AGENTS §9). Ein roter Test lädt nichts hoch und
vergiftet den `?v=`-Stempel.

---

## 9. Zuschnitt

**Phase 1 — Fundament.** Katalog, Normalisierung, Gate-Funktion, Paritätstest. Kein Aufrufer
wechselt, nichts wird migriert, nichts ist sichtbar. Deploybar für sich.

**Phase 2 — Migration.** Neue Spalten, Einmal-Lauf mit Vorschau, Zuordnung und Protokoll-
Rekonstruktion. Läuft, **bevor** ein Dialog umgestellt ist — die alten Dialoge schreiben
weiter ihre alten Werte, die der Katalog bereits kennt.

**Phase 3 — die Gates.** Siedlungs-Wappen bekommen ihres, Territoriums-Wappen ihres gelockert.
🔴 Das ist die einzige Besucher-sichtbare Änderung; sie geht allein live und wird angesehen
(AGENTS §9).

**Phase 4 — die fünf Dialoge.** Einer nach dem anderen, jeder mit eigenem Commit und eigenem
Blick. Reihenfolge: Stadtkarten (kleinster Eingriff, Katalog fast fertig) → Siedlungsbilder →
Siedlungs-Wappen → Territoriums-Wappen → Cover.

---

## 10. Offene Punkte

- 🔧 **`NOTICE.md` und `LEGAL.md`** beschreiben die alte Wappenregel („nur gemeinfrei") und
  werden in Phase 3 angepasst. Der Owner sieht den Wortlaut vor dem Push.
- 🔧 **Rechtsprüfung der Cover-Einstufung.** `permission_granted` für die Ulisses-Cover folgt
  den Fan-Regeln und der Praxis bei den Karten-Vorschauen (`citymaps.php:2228`), ist aber eine
  Rechtsauffassung, keine technische Feststellung.
- 🔧 **Trefferquote der `uploaded_by`-Rekonstruktion** ist erst nach dem Vorschaulauf auf dem
  Server bekannt. Fällt sie sehr niedrig aus, ist der Schritt es womöglich nicht wert — die
  Entscheidung fällt an der gemessenen Zahl, nicht vorab.
