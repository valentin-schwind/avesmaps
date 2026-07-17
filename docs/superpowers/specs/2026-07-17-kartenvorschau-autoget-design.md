# Kartenvorschau-Autoget — Design

> **Status:** Spec, vom Owner freigegeben 2026-07-17.
> **Vorgänger:** `2026-07-17-kartensammlung-redesign-design.md` (parallele Session) — dessen Task 1
> (Band als Zeilen-Überschrift) und Task 7 (`thumb_url` stillgelegt) berühren dieses Feature; siehe §11.

## 1. Ziel

Ein Knopf im Menüband von „Kartensammlung anlegen und editieren" holt die Vorschaubilder **aller**
Karten in einem fortsetzbaren Durchlauf. Kommt das Bild aus einer Quelle, die per Konstruktion ein
Verlagscover liefert (Wiki-Produktseite oder Ulisses-Shop), wird es **öffentlich** — unter derselben
Rechtsgrundlage und Pflichtangabe, unter der die Abenteuer-Sektion ihre Cover längst zeigt. Alles andere
bleibt editor-only.

Heute zeigt **genau 1 von 419 Karten** eine Vorschau (ein Upload). Nach dem ersten Durchlauf sollen es
**~330** sein — nicht ~120: die ~120 Quellen mit Seitenbild hängen an durchschnittlich 2,7 Karten
(365 Karten ÷ 133 Quellen, §2). Quellen und Karten sind hier durchgehend auseinanderzuhalten; der
Durchlauf zählt Quellen, der Leser sieht Karten.

## 2. Datenlage (live gemessen 2026-07-17, `GET /api/app/citymaps.php`)

| Größe | Wert |
|---|---|
| Karten gesamt | 419 |
| davon mit `map_url` | 365 |
| Hosts | `de.wiki-aventurica.de` 364 · `www.ulisses-ebooks.de` 1 |
| **verschiedene URLs** | **133** |
| Karten mit sichtbarer Vorschau heute | 1 (ein Upload) |

**Die 133 sind der Kern des Zuschnitts.** 365 Karten teilen sich 133 Quellen; zwölf Karten aus zwölf
verschiedenen Städten (Festum, Firunen, Neersand, Norburg, Ouvenmas, Rodebrannt, Uhdenberg, Vallusa …)
hängen alle an `…/wiki/Land des schwarzen Bären`. Die Arbeitseinheit ist deshalb die **URL**, nicht die
Karte (§6).

Die URL-Form ist durchgehend `/wiki/<Titel prozentkodiert>` — keine Query, kein Fragment. Der Seitentitel
ist ohne jeden Abruf gewinnbar.

**`map_url` zeigt bei 303 von 365 Karten auf die BUCHSEITE, nicht auf die Karte.** Der Durchlauf holt
dort also das Buchcover. Das ist bekannt, gewollt und richtig — siehe §5.

## 3. Die Crawl-Policy — warum die MediaWiki-API, nicht og:image

Die Betreiber-Zusage an Wiki-Aventurica lautet: **„Dump bevorzugen, API ok, KEINE HTML-Crawls"**
(Owner 2026-07-04, Memory `wiki-aventurica-dump-policy`). 364 og:image-Abrufe wären ein HTML-Crawl.

Die API-Route bricht die Zusage nicht und ist zugleich auf jeder Achse besser:

| | HTML-og:image | MediaWiki-API `prop=pageimages` |
|---|---|---|
| **Seiten-Abrufe** | **133 HTML-Seiten** (364 ohne Dedup) | **~6 JSON-Calls** |
| Betreiber-Zusage | gebrochen | „API ok" ✓ |
| Bildgröße | Vollbild, wir skalieren | `pithumbsize=400` liefert **fertig 400 px** |
| Parsing | Regex auf fremdem HTML | JSON |
| Dauer | ~3 min | ~90 s |

Ehrlich gerechnet: Die **Bild**-Abrufe (~133) sind in beiden Wegen dieselben — der Unterschied liegt bei
den Seiten-Abrufen. Auch der HTML-Weg könnte auf 133 dedupen (§2); die im Auftrag genannten 364 wären
die Variante ohne Dedup. Entscheidend ist nicht die Zahl, sondern die Art: **133 HTML-Abrufe sind ein
HTML-Crawl und damit ein Bruch der Zusage, 6 JSON-Calls sind es nicht.** Die ~6 statt der theoretischen
3 (133 ÷ 50) ergeben sich daraus, dass die Schrittgröße durch die Bild-Fetches begrenzt ist, nicht durch
die Titel-Batchgrenze (§6).

**Live verifiziert 2026-07-17:**
- `PageImages` ist auf dem Wiki installiert (Extension-Liste über `meta=siteinfo&siprop=extensions`
  geprüft, 80 Extensions). **Genau diese Extension erzeugt das `og:image`** — wir bekommen über den
  sanktionierten Weg dasselbe Bild, das wir sonst aus dem HTML gekratzt hätten. Kein Qualitätsverlust.
- Ein Request mit 4 Titeln lieferte 4 Seiten in einer Antwort. Titel-Batchgrenze ist **50** für normale
  Nutzer (Memory `wiki-aventurica-dump-policy`, per `paraminfo` verifiziert; `highlimit` 500 bräuchte
  Bot-Recht, das wir nicht haben). 133 URLs passen also in 3 Batches — real werden es ~6 Calls, weil der
  Schritt an den Bild-Fetches hängt und nicht an der Titelgrenze (§6).
- API-Endpunkt ist `https://de.wiki-aventurica.de/de/api.php` (`AVESMAPS_WIKI_API_URL`, `sync.php:5`) —
  **nicht** `/api.php` (das ist 404) und nicht der `/wiki/`-Pfad der `map_url`.

Die Bild-Dateien selbst kommen weiterhin von wiki-aventurica. Ein Medien-Abruf ist kein HTML-Crawl; der
Abenteuer-Cover-Pfad holt seit Phase 4 über `Spezial:Dateipfad` genauso.

**Der Dump ist hier kein besserer Weg:** Er kennt `[[Datei:…]]` im Wikitext, aber nicht das *Seitenbild*
(das entsteht erst beim Rendern der Infobox — dieselbe I6-Grenze, an der schon die vier Online-Phasen
von „Dump holen" hängen). Und die Bild-Bytes müsste man ohnehin abrufen.

## 4. Die drei Routen

Die bestehende Zweiteilung in `api/edit/map/citymap-image.php` wird zur Dreiteilung:

| Route | Auslöser | Bildquelle | Ziel | Öffentlich |
|---|---|---|---|---|
| **Wiki** (neu) | Host `de.wiki-aventurica.de`, Pfad `/wiki/<Titel>` | `/de/api.php?action=query&titles=…&prop=pageimages&piprop=thumbnail\|original\|name&pithumbsize=400&redirects=1` | `thumb_local_url` | **ja** |
| **Ulisses** (existiert) | `avesmapsCitymapUlissesApiUrl()` ≠ `''` | Produkt-API → `www.ulisses-ebooks.de/images/<pfad>` | `thumb_local_url` | **ja** |
| **og:image** (existiert) | jeder andere Host | HTML → `avesmapsCitymapPickPreviewImage()` | `thumb_auto_url` | **nein** |

`redirects=1` ist Pflicht: `map_url` kann auf eine Weiterleitung zeigen, und die API löst sie sonst nicht
auf. `pageid: -1` bedeutet „Seite gibt es nicht" → `no_image` (§8).

**Warum die Route über die Öffentlichkeit entscheidet:** Die ersten beiden Routen liefern per
Konstruktion ein Verlagscover — ein Wiki-Seitenbild einer DSA-Produktseite und ein Ulisses-Produktbild
sind dasselbe Artwork unter derselben Fanrichtlinie. Ein beliebiges `og:image` von einem fremden Host ist
es nicht, und dafür haben wir keine Erlaubnis. Die Route ist eine **Eigenschaft der Quelle**, kein Flag,
das jemand vergessen kann.

`thumb_auto_url` bleibt damit bestehen (heute 0 Karten, aber der Weg bleibt offen) — mit seiner
Eigenschaft aus 2026-07-16: es wird von `avesmapsCitymapsReadCatalog` **nie selektiert**, ist also
editor-only per Konstruktion und nicht per Flag.

## 5. Öffentlichkeit, Lizenz und die Pflichtangabe

**Owner-Entscheidung 2026-07-17 — bitte nicht „reparieren":** Verlagscover werden **generell**
öffentlich, nicht nur die vom Ulisses-CDN.

Der ursprüngliche Auftrag lautete „nur Ulisses → öffentlich, alles Wiki → editor-only". Beim Messen kam
heraus, dass die 364 Wiki-Links **Buchcover** liefern (`Land des schwarzen Bären` →
`RSH_DSA4_G10_Land_des_schwarzen_Bären.jpg`) — dieselben Bilder, die die Abenteuer-Sektion bereits
öffentlich zeigt. Die enge Regel hätte dasselbe Cover bei den Abenteuern gezeigt und bei den Karten
versteckt, obwohl die Rechtslage identisch ist. Der Owner hat die weite Regel gewählt.

- **Lizenz:** `thumb_license = 'permission_granted'`. Der Wert existiert bereits in
  `AVESMAPS_CITYMAP_LICENSES` und steht in `AVESMAPS_CITYMAP_LICENSES_FREE` → das bestehende Gate
  (`avesmapsCitymapPublicThumbUrl`) lässt ihn durch. **Nicht `public_domain`** — das wäre die falsche
  Behauptung; es ist eine Erlaubnis unter den Fanrichtlinien, „nur bis auf Widerruf" (NOTICE.md).
- **Pflichtangabe:** „Cover © Ulisses Spiele — im F-Shop ansehen ↗" in der Kartensammlungs-Sektion und
  im Dialog. Vorbild ist `avesmapsAdventureCreditMarkup()`
  (`map-features-place-extras.js:630`); der F-Shop-Link dort ist **generisch** (`https://www.f-shop.de/`),
  nicht pro Titel — also 1:1 übernehmbar.
- **Kill-Switch:** eigener `citymap_previews_enabled` (`app_setting`) analog `adventure_covers_enabled`,
  eigene Zeile im Menüband. Bewusst **nicht** der Abenteuer-Switch: die Erlaubnis gilt „bis auf
  Widerruf", und dann will man beide Flächen einzeln greifen können. Ist der Switch aus, fällt die
  Fußnote mit weg (keine Cover auf dem Schirm = kein Credit nötig) — dieselbe Logik wie bei den
  Abenteuern.

**„Zwölf Städte, ein Cover" ist kein Fehler, sondern richtig — aber nur mit Task 1 des Redesigns.**
Die ursprüngliche Freigabe für „alle Karten" stand auf der Begründung „unschädlich, weil `thumb_auto_url`
editor-only ist". Die trägt hier nicht mehr, die Bilder werden ja sichtbar. Sie wird ersetzt durch: Task 1
der parallelen Session macht **den Band zur Überschrift der Zeile** (`cityMapBandLabel` → „Land des
schwarzen Bären"). Ein Buchcover neben einem Bandnamen ist das korrekte Bild — die zwölf Städte zeigen
alle „Land des schwarzen Bären", und das stimmt zwölfmal. **Landet Task 1 nicht, kippt diese Begründung**
(zwölf Zeilen „Stadtplan von Festum" mit einem Cover, das nicht Festum ist) — siehe §11.

## 6. Der Motor: fortsetzbar, Arbeitseinheit ist die URL

**STRATO-Auflage (AGENTS.md §9):** Niemals einen schweren Endpoint loopen — das hat einmal die
PHP-Worker gesättigt und wie ein DB-Ausfall ausgesehen. Der Server macht **einen begrenzten Schritt pro
Request**, der Client treibt die Wiederholung. Vorbild ist der Linkchecker (`check_step`,
`js/review/review-link-check.js`), nicht ein Request, der 364 Bilder holt.

```
Schritt = bis zu 25 fällige URLs          (~15 s; Vorbild: check_step = 40 Links in ~13 s)
  ├─ Wiki-URLs des Schritts: 1 API-Call für bis zu 50 Titel
  ├─ je URL: Bild holen, 600 ms Höflichkeitspause pro Host
  └─ je URL: Ergebnis an ALLE Karten dieser URL schreiben
Ganzer Durchlauf ≈ 6 Schritte ≈ 90 s
```

Die Dedup auf URL-Ebene ist der Grund, warum das klein bleibt: 133 Fetches statt 365.

**Fortschritt per Callback, nie pollen.** Der Editor ist ein iframe und ruft
`window.parent.startCitymapAutoget(onProgress)` — genau wie „Links prüfen" nebenan
`window.parent.startLinkCheck('citymap', cb)` ruft. Ein Poll stellte sich nur hinter den laufenden
Schritt (gemessen beim Linkchecker: ein simpler `status` brauchte 21 s mitten im Schritt).

**Re-Entrancy-Guard**, wie beim Linkchecker: zwei Durchläufe gleichzeitig würden nur um PHP-Worker und
die Host-Drossel streiten.

## 7. Schema — zwei Spalten, kein Zustandstisch

```sql
thumb_origin     VARCHAR(16) NOT NULL DEFAULT 'manual'  -- 'manual' | 'auto'
thumb_auto_state VARCHAR(24) NULL                        -- NULL | ok | no_image | fetch_failed | not_an_image | skipped_manual
```

Beide über das vorhandene selbstheilende `$columnExists`-ALTER in `api/_internal/app/citymaps.php`.

**`thumb_origin` ist „eigen schlägt auto"** (Owner-Entscheidung 2026-07-17, Vorbild: der
Abenteuer-Cover-Reconcile mit `field_origins['cover_url'] !== 'manual'`). Es beschreibt, **wer das
aktuelle `thumb_local_url` gemacht hat**; bei leerem Slot ist es bedeutungslos. Der Upload-Pfad setzt
`'manual'`, der Durchlauf `'auto'`. Default `'manual'` ist konservativ und für den Bestand korrekt: die
eine existierende Vorschau ist ein Upload.

**`thumb_auto_state` ist Fälligkeit und Schlussbericht in einem.** `NULL` = steht noch aus. Fälligkeit:

```sql
WHERE thumb_auto_state IS NULL AND TRIM(map_url) <> ''
```

**Die Skip-Regel steht im Code, nicht in der Query** — und das ist keine Stilfrage:

```php
if ($thumbLocalUrl !== '' && $thumbOrigin === 'manual') { → 'skipped_manual', kein Fetch }
```

Die Query nach `thumb_origin <> 'manual'` zu filtern wäre falsch, weil der Default `'manual'` ist: dann
wäre **keine einzige Karte je fällig** und der Durchlauf täte stumm nichts. Die Regel lautet „überspringe
Karten, die ein *eigenes Bild haben*" — nicht „überspringe Karten, deren Herkunftsspalte auf dem Default
steht". Und als Code-Zweig produziert sie einen Zustand (`skipped_manual`), den der Bericht in §8 nennen
kann; eine Query-Bedingung hätte sie unsichtbar verschluckt.

**Die zwei Fallen, die der Linkchecker schon bezahlt hat** (Memory `linkchecker-feature-task-a`):

1. **Ohne Zustand für „versucht, nichts gefunden" endet der Durchlauf nie** — der nächste Schritt fände
   dieselbe Karte wieder fällig. Deshalb bekommt **jeder** Ausgang einen Zustand, auch der Fehlschlag.
2. **Batch-Lease ist mit einem Zeitbudget unvereinbar.** Vorab zu leasen und beim Budget abzubrechen
   ⇒ die Fälligkeits-Query sieht die Zeilen nicht mehr ⇒ `remaining=0` ⇒ „fertig" bei halbem Bestand.
   Deshalb wird der Zustand **pro URL direkt nach ihrem Fetch** geschrieben, nicht als Batch vorab.

„Alle neu ziehen" ist dadurch ein Einzeiler und fasst Uploads nicht an:

```sql
UPDATE citymap SET thumb_auto_state = NULL
 WHERE NOT (TRIM(thumb_local_url) <> '' AND thumb_origin = 'manual')
```

**Nicht** `WHERE thumb_origin = 'auto'`: eine Karte, bei der der Durchlauf nichts fand (`no_image`), hat
kein Bild und trägt deshalb weiter den Default `'manual'` — sie wäre von jedem Reset für immer
ausgeschlossen gewesen, obwohl sie genau der Fall ist, den man später neu ziehen will (das Wiki bekommt
ja Bilder dazu). Zurückgesetzt wird alles **außer** echten Uploads.

## 8. Fehler und Bericht — kein stilles Abschneiden

| Zustand | Bedeutung |
|---|---|
| `ok` | Bild geholt und gespeichert |
| `no_image` | Quelle erreichbar, nennt aber kein Bild (Wiki: kein `pageimage`; `pageid: -1` = Seite gibt es nicht; Ulisses: kein `image`-Feld; og:image: kein Tag) |
| `fetch_failed` | Seite oder Bild nicht erreichbar (DNS, Timeout, 4xx/5xx, SSRF-Riegel) |
| `not_an_image` | Bytes sind kein Bild (finfo) oder zu groß |
| `skipped_manual` | eigenes Bild vorhanden, `thumb_origin='manual'` |

Der Schlussbericht liest die Spalte und sagt konkret — **in Karten, denn das ist, was der Leser sieht,
mit den Quellen als Klammer**:

> „133 Quellen geprüft · 331 Karten haben jetzt eine Vorschau · 9 Quellen ohne Seitenbild (24 Karten) ·
> 4 nicht erreichbar (9 Karten) · 1 übersprungen (eigenes Bild)."

Jede übersprungene Karte trägt ihren Grund in der Zeile — auffindbar im Editor. Ein Bericht nur in
Quellen („118 geholt") wäre die falsche Auskunft: er untertreibt die Wirkung um Faktor 2,7 und antwortet
auf eine Frage, die niemand gestellt hat.

## 9. Sicherheit

**Unverhandelbar (Owner-Auflage, und der Grund, warum Autoget 2026-07-16 überhaupt erlaubt wurde):**

- **Beide Fetches durch `avesmapsLinkCheckFetchBody`** — die API-/Seiten-Antwort **und** das Bild, das
  sie nennt. Nur die Seite zu prüfen wäre gar kein Riegel: die Bild-URL wählt eine fremde Seite aus
  (`og:image` → `169.254.169.254` ist DER Angriff).
- **Die Quell-URL kommt aus der DB**, nie aus dem Request. Sonst wäre der Endpoint ein
  General-Purpose-Fetcher für jeden mit Edit-Session.
- **`finfo` prüft die Bytes, nicht den Header.** Die Ulisses-CDN liefert `Content-Type: image/jpg` — kein
  gültiger MIME-Typ. Hätte man dem Header geglaubt, wären alle DSA-Cover mit 415 abgelehnt worden.
- **Bekannte Grenze des Riegels, die wir erben:** `avesmapsLinkCheckFetchBody` prüft die Host-IP vor dem
  Request und den `CURLINFO_PRIMARY_IP` danach (Post-Flight). Ein Redirect *durch* privaten Raum hindurch
  zurück nach public bliebe unentdeckt — dieser PHP-Build hat kein `CURLOPT_OPENSOCKETFUNCTION`. Das ist
  eine bestehende Eigenschaft, keine neue: der Einzel-Autoget lebt seit 2026-07-16 damit.

**Die Wappen-Engine (`avesmapsWikiSyncMonitorHttpGetBinary`) ist hier NICHT verwendbar**, obwohl der
Abenteuer-Cover-Pfad sie nutzt. Sie hat keinen SSRF-Guard, kein Größenlimit und kein finfo — das ist
dort vertretbar, weil die URL aus einem Wiki-Dateinamen *abgeleitet* wird. Unsere `map_url` ist ein
Freitextfeld im Editor. Ein Mensch tippt sie, also gilt der Riegel.

## 10. Was gebaut wird

**Kein Parallel-Neubau** (Owner-Regel): Die Autoget-Logik einer einzelnen Karte zieht in eine geteilte
Funktion `avesmapsCitymapAutogetOne()`. Der bestehende `mode=autoget`-Knopf (eine Karte) und der neue
Durchlauf rufen **dieselbe** Funktion. Der Einzelknopf bleibt, was er ist.

| Datei | Was |
|---|---|
| `api/_internal/app/citymaps.php` | Routen-Wähler, Wiki-Titel-Extraktor, `pageimages`-Parser, `avesmapsCitymapAutogetOne()`, 2 Spalten (DDL + ALTER), Editor-Ausgabe der neuen Felder |
| `api/edit/map/citymap-autoget.php` (neu) | `action=autoget_step` + `status`; ein begrenzter Schritt, Capability `edit` |
| `api/edit/map/citymap-image.php` | ruft `avesmapsCitymapAutogetOne()` statt eigener Logik; setzt `thumb_origin='manual'` beim Upload |
| `js/review/review-citymap-autoget.js` (neu) | der Client-Loop + `window.startCitymapAutoget(onProgress)` |
| `html/citymap-editor.html` | Menüband-Knopf „🖼️ Vorschauen holen" + Kill-Switch-Zeile |
| `js/map-features/map-features-place-extras.js` | `avesmapsCitymapCreditMarkup()` (Fußnote) |
| `js/app/i18n-en.js` | EN-Overlay der neuen Keys |

Ein eigener Endpoint statt einer Erweiterung von `citymap-image.php` ist hier richtig: das ist ein
multipart-Upload-Endpoint **pro Karte**; ein fortsetzbarer Batch-Schritt ist ein anderer Job. Der
Linkchecker trennt genauso. Der Parallel-Neubau, den die Owner-Regel meint, wäre die duplizierte
Autoget-*Logik* — und genau die wird geteilt.

## 11. Abhängigkeiten und Risiken

**Task 7 der parallelen Session (`kartensammlung-design-rethink-f65f80`) entfernt versehentlich das
Lizenz-Gate.** Der Plan schreibt:

```php
function avesmapsCitymapPublicThumbUrl(array $row): string
{
    return trim((string) ($row['thumb_local_url'] ?? ''));   // Gate weg
}
```

Der Plan-*Text* daneben behauptet „Die Lizenz gilt weiterhin für `thumb_local_url` (der Upload ist erst
bei freier Lizenz erlaubt)". **Das stimmt nicht:** `api/edit/map/citymap-image.php` prüft die Lizenz
nirgends (verifiziert 2026-07-17, kein Treffer für `license` in der Datei). `avesmapsCitymapPublicThumbUrl`
ist die **einzige** Stelle, die `thumb_license` durchsetzt. Fällt sie, wird jedes hochgeladene Bild
öffentlich — auch mit `unknown_other`, dem **Default** — und der Lizenz-Select im Editor ist Dekoration.

Fix (eine Zeile, Gate behalten, nur den `thumb_url`-Rückfall streichen):

```php
if (!avesmapsCitymapLicenseIsFree($row['thumb_license'] ?? null)) { return ''; }
return trim((string) ($row['thumb_local_url'] ?? ''));
```

Der Owner meldet das der anderen Session (Entscheidung 2026-07-17). **Dieses Feature setzt das intakte
Gate voraus** — ohne es ist `thumb_license = 'permission_granted'` wirkungslos und die ganze
Öffentlichkeits-Regel hängt in der Luft.

**Task 1 der parallelen Session trägt die Begründung für „zwölf Städte, ein Cover"** (§5). Landet Task 1
nicht, muss die Öffentlichkeits-Regel neu bewertet werden.

**Kollisionsflächen im geteilten Baum:** `api/_internal/app/citymaps.php`, `html/citymap-editor.html`,
`js/map-features/map-features-place-extras.js` und `css/features/place-extras.css` werden von beiden
Sessions angefasst. Getrennte Worktrees, aber gemeinsames `master`. Reihenfolge: Backend zuerst
(kleinste Fläche), Fußnote zuletzt (größte). Bei Push-Ablehnung `fetch` + `rebase origin/master`, nie
force-push (AGENTS.md §9).

**Kopplung an fremde APIs:** Ändert die MediaWiki-API ihre `pageimages`-Form, liefern alle Wiki-Karten
`no_image` („alle auf einmal leer" = das Signal). Dasselbe gilt für die Ulisses-Produkt-API, deren Form
schon einmal einen Live-Fehlschlag kostete: sie **verhandelt den Inhalt** (`Accept: application/json` →
flach `{"image":"…"}`; ohne Accept → Hülle `{"data":{"attributes":{…}}}`). Der bestehende Parser liest
beide — beim Testen mit denselben Headern holen, die der Code schickt.

## 12. Tests

**Rein und lokal beweisbar (ohne DB):**

- Titel-Extraktor: `/wiki/Land%20des%20schwarzen%20B%C3%A4ren` → `Land des schwarzen Bären`; `/wiki/`
  ohne Titel → `''`; Host mit anderem Pfad → `''`.
- Routen-Wähler: Wiki-URL → `wiki`; `ulisses-ebooks.de/de/product/120516/…` → `ulisses`; alles andere →
  `ogimage`; Lookalike-Domain löst **keine** Sonderroute aus.
- `pageimages`-Parser: Seite mit `thumbnail.source`; Seite ohne `pageimage`; `pageid: -1`; mehrere Seiten
  in einer Antwort (Batch); Antwort ohne `query`.
- Zustandsübergang: jeder Ausgang setzt genau einen Zustand; `skipped_manual` bei `thumb_origin='manual'`.
- Die Öffentlichkeits-Regel: Wiki-/Ulisses-Route setzt `permission_granted`; og:image-Route setzt **keine**
  Lizenz und schreibt in `thumb_auto_url`.

**Erst live prüfbar** (keine lokale DB, kein MySQL): die beiden ALTER, die Fälligkeits-Query, der
Durchlauf selbst. Abnahme: `?edit=1` → WikiSync → Abenteuer → „Kartensammlung editieren" → „Vorschauen
holen"; danach `?siedlung=Gareth` → die Kartensammlung zeigt Cover + Fußnote.

Kommando (ohne `zend.assertions=1` prüft `assert()` **nichts**):

```
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll <test>
node js/map-features/__tests__/<x>.test.js
```

## 13. Owner-Entscheidungen (nicht neu verhandeln)

1. **Der Durchlauf geht über ALLE Karten**, auch wenn oft das Buchcover statt der Karte herauskommt.
2. **Verlagscover generell öffentlich** (Wiki **und** Ulisses), nicht nur Ulisses — §5.
3. **Eigen schlägt auto:** ein manueller Upload wird nie überschrieben — §7.
4. **Eigener Kill-Switch** `citymap_previews_enabled`, nicht der Abenteuer-Switch — §5.
5. **`permission_granted`, nicht `public_domain`** — §5.
6. **MediaWiki-API statt HTML-Crawl** — §3. Wer das auf og:image zurückbaut, bricht eine Zusage an einen
   Dritten und macht den Durchlauf 100× teurer.
