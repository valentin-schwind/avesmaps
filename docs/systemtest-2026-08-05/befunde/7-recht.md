# Agent 7 — Recht und Lizenzen

## Kern

Die Grundausstattung ist für ein Fanprojekt überdurchschnittlich: ausführlicher Hinweistext mit Impressum
und DSGVO-Absätzen, echte im Code durchgesetzte Lizenzriegel (Wappen nur `public_domain`, Stadtpläne fallen
zu), Wappen-Proxy statt Hotlink, keine Fremdschriften, kein CDN, kein Analytics-Drittanbieter — und **keine
Geheimnisse im Repo** (kein Token, kein Dump, kein Nutzerdatensatz, auch nicht in der Historie).

Die Befunde sind fast alle **Abweichungen zwischen Zusage und Code**, nicht Rohheiten:
1. Bewertungen gehen **sofort öffentlich**, der Text sagt redaktionelle Prüfung zu (B1).
2. Der Besucher-Hash-Salt steht im Quelltext und ist technisch **nicht** überschreibbar — „nicht rückführbar" stimmt nicht (B2).
3. Der Siedlungsbild-Riegel fällt als einziger **offen**: jeder Upload gilt ungefragt als „KI-generiert" und ist sofort öffentlich (B3).
4. Das Impressum nennt **keine E-Mail-Adresse** und hat keine eigene URL (B5).
5. Jeder anonyme Besucher bekommt ein `PHPSESSID`-Cookie, das nirgends erwähnt wird (B6).

Am stärksten in Spannung zur eigenen Fanregel-Zusage („keine Bereitstellung als reines Bilderarchiv"): die
verlinkten Karten-Downloads, 1,86 GB PNG + 169 MB Kacheln (B4). Dazu reisen **1,11 Mio. Zeichen** wörtlicher
Wiki-Fließtext je Kartenpayload — mit Quellzeile, aber die Wiki-Lizenz wird nirgends benannt, und `NOTICE.md`
erwähnt Wiki Aventurica überhaupt nicht (B7/B8). **Zahlen:** 6 AKUT · 12 KANN · 2 ZUKUNFT.

---

### B1 Bewertungen werden sofort öffentlich gestellt, obwohl der Hinweistext redaktionelle Prüfung zusagt
- **Kategorie:** AKUT
- **Fundstelle:** `C:\GIT\avesmaps\api\app\location-reviews.php:8` und `:99-101` · Zusage in `C:\GIT\avesmaps\index.html:2190`
- **Beobachtung:** Der Rechtstext fasst „Community-Meldungen **und Bewertungen**" zusammen und
  sagt: „werden nicht automatisch veröffentlicht. Sie werden redaktionell geprüft […]. Mit dem
  Absenden einer Meldung wird keine Veröffentlichung zugesagt." Der Bewertungs-Endpunkt sagt in
  seinem eigenen Kopfkommentar das Gegenteil: „Bewertungen sind sofort sichtbar; […] Editor kann
  **nach**moderieren", und das INSERT setzt `is_hidden` als Literal `0`. Geprüft wird nur ein
  Wortfilter (`AVESMAPS_REVIEW_SPAM_WORDS`) und ein Honeypot. Frei gewählter Autorenname (80 Z.)
  und Freitext (200 Z.) sind damit unmittelbar über `GET ?location=` für jeden lesbar.
- **Erwartet:** Entweder der Text trennt Meldungen (geprüft) von Bewertungen (sofort sichtbar,
  nachmoderiert) — das wäre die ehrliche und rechtlich unproblematische Variante samt Hinweis auf
  die Verantwortlichkeit für fremde Inhalte — oder Bewertungen laufen tatsächlich durch eine
  Freigabe.
- **Beleg:** Beide Dateien selbst gelesen; INSERT-Spaltenliste (Z. 99) und Werteliste (Z. 100 f.)
  mit dem Literal `0` an der `is_hidden`-Position verifiziert. Keine Live-Anfrage.
- **Sicherheit:** BELEGT
- **Aufwand:** klein (Textkorrektur) bzw. mittel (echte Freigabe-Warteschlange)

### B2 Der Besucher-Hash-Salt steht im Quelltext und kann technisch nicht überschrieben werden — „nicht rückführbar" stimmt nicht
- **Kategorie:** AKUT
- **Fundstelle:** `C:\GIT\avesmaps\api\_internal\analytics\visitor-analytics.php:8-9` und `:48-53` · Zusage in `C:\GIT\avesmaps\index.html:2203`
- **Beobachtung:** `visitor_hash = sha256("YYYYMMDD|avesmaps-visitor-salt-override-me|<IP>|<User-Agent>")`.
  Der Salt ist ein `define()` mit öffentlichem Vorgabewert. Er ließe sich nur überschreiben, wenn
  ihn jemand **vor** dem Include definiert — genau das ist unmöglich: `track.php:5-7`,
  `heartbeat.php:5-7` und `visitor-metrics.php:7` binden das Analytics-Modul ein, **bevor**
  `avesmapsLoadApiConfig()` (track.php:10, heartbeat.php:17) überhaupt läuft. Selbst ein
  `define()` in `api/config.local.php` käme zu spät. `config/api.config.example.php` kennt den
  Schlüssel gar nicht. Mit bekanntem Salt ist der Hash über den IPv4-Raum × Kandidaten-UA
  rückrechenbar. Der Hinweistext nennt ihn „nicht rückführbar".
- **Erwartet:** Salt aus der Konfiguration (oder `getenv`) **innerhalb** von
  `avesmapsVisitorDailyHash()` gelesen, damit er überhaupt überschreibbar ist; ein zufälliger
  Serverwert; sonst die Aussage im Text abschwächen.
- **Beleg:** Alle fünf einbindenden Dateien gelesen; `grep AVESMAPS_VISITOR_SALT` über das ganze
  Repo liefert nur die Definition selbst und die Planungsdatei
  `docs/superpowers/plans/2026-06-28-besucher-analytics.md`. Kein zweiter `define()`.
- **Sicherheit:** BELEGT (Codepfad) — der tatsächliche Serverzustand wurde nicht abgefragt
  (keine Live-Anfrage erlaubt), aber es existiert kein Codepfad, der ihn ändern könnte.
- **Aufwand:** klein
- **Mildernd:** `visitor_daily_seen` wird täglich geleert (`:104-106`), `visitor_live` nach 15 min
  (`:285-290`) — das Zeitfenster ist kurz. Die Zeilen stecken aber im Datenbank-Backup.

### B3 Jedes neu hochgeladene Siedlungsbild gilt ungefragt als „KI-generiert" und ist damit sofort öffentlich
- **Kategorie:** AKUT
- **Fundstelle:** `C:\GIT\avesmaps\api\edit\wiki\settlement-images.php:33-34` und `:219` · Zusage in `C:\GIT\avesmaps\index.html:2185`
- **Beobachtung:** Der Rechtstext verspricht, es würden „ausschließlich gemeinfreies Material
  (Public Domain, CC0) sowie KI-generierte Bilder" eingebunden, „insbesondere **keine** Scans oder
  Fotos von Ulisses-Artworks sowie Fanart […] ohne ausdrückliche Erlaubnis". Der Upload-Zweig fragt
  **keine Lizenz ab**: er hängt das Bild mit
  `'license' => AVESMAPS_SETTLEMENT_IMAGE_LICENSE_DEFAULT` an, und dieser Default ist
  `ai_generated` (Z. 34) — also ein Wert, den der öffentliche Filter
  (`api/app/map-features.php:398-412`) durchlässt. Die Lizenz lässt sich erst **nachträglich** über
  eine eigene Aktion setzen (`:277`). Wer hochlädt und nichts weiter tut, hat das Bild
  veröffentlicht und als KI-generiert etikettiert.
  **Gegenbeispiel im selben Haus:** Stadtpläne machen es richtig herum —
  `api/_internal/app/citymaps.php:39` hat `AVESMAPS_CITYMAP_LICENSE_DEFAULT = 'unknown_other'`,
  und `unknown_other` ist der einzige Wert, der **nicht** in `..._LICENSES_FREE` steht (Z. 40).
  Der Riegel fällt dort zu, hier auf.
- **Erwartet:** Default `unknown_other` (unsichtbar, bis jemand die Lizenz aktiv setzt) — die
  Stadtplan-Regel, eine Zeile.
- **Beleg:** Beide Dateien gelesen; Konstanten und die Upload-Zeile 219 zitiert; öffentlicher
  Filter in `map-features.php:398-412` gelesen. Live-Bestand: 69 Siedlungen mit zusammen 88
  veröffentlichten Bildern (`node`-Auswertung über `snapshots/map-features.json`).
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B4 Das komplette Kartenmaterial ist als 1,86-GB-PNG und 169-MB-Kachelarchiv zum Download verlinkt
- **Kategorie:** AKUT
- **Fundstelle:** `C:\GIT\avesmaps\index.html:2182` · Dateien `uploads/avesmaps_aventurien_v2.05.zip` (1 855 789 721 B) und `uploads/avesmaps_aventurien_tiles_v2.05.zip` (168 647 049 B)
- **Beobachtung:** Im Absatz „Kartenmaterial" stehen zwei Download-Links auf
  `uploads/map/avesmaps_aventurien_tiles_v2.05.zip` und `uploads/map/avesmaps_aventurien_v2.05.zip`.
  Ausgeliefert wird damit nicht mehr die *interaktive Anwendung*, sondern das bearbeitete
  Kartenmaterial selbst als Archiv. `NOTICE.md:70-71` führt unter „weitere beachtete Punkte" der
  Fanrichtlinien ausdrücklich auf: „**keine Bereitstellung als reines Bilder- oder Textarchiv**".
  Der Karten-Ursprung ist laut demselben Dokument „bearbeitetes offizielles DSA-Kartenmaterial".
  Das ist die deutlichste Selbstwiderspruchsstelle, die ich gefunden habe.
- **Erwartet:** Entweder die Downloads entfernen bzw. hinter eine Anfrage stellen, oder — falls
  eine Freigabe dafür existiert — sie im Absatz benennen, so wie es bei den Covern (Z. 2186)
  bereits gemacht wird („werden mit Genehmigung von Ulisses verwendet").
- **Beleg:** `index.html:2182` gelesen; die beiden ZIPs im Arbeitsbaum unter `uploads/` mit
  `ls -la` bestätigt (Größen oben). Ob sie auf dem Server liegen, wurde **nicht** geprüft
  (keine Live-Anfrage) — der Link ist jedoch Bestandteil der ausgelieferten `index.html`.
- **Sicherheit:** BELEGT (Link + lokale Dateien) / PLAUSIBEL (Erreichbarkeit live)
- **Aufwand:** klein

### B5 Das Impressum nennt keine E-Mail-Adresse und ist nur über einen JS-Dialog ohne eigene URL erreichbar
- **Kategorie:** AKUT
- **Fundstelle:** `C:\GIT\avesmaps\index.html:2131-2133` (Dialog) und `:2177` (Impressum-Absatz), `:2204` (Datenschutz-Anfragen), `sitemap.xml`
- **Beobachtung:** Zwei getrennte Formfehler in derselben Stelle.
  (a) `grep -c "mailto:" index.html` → **0**; im gesamten `index.html` steht keine
  E-Mail-Adresse. Der Impressum-Absatz nennt Name und c/o-Postanschrift; als Kanal bleiben das
  Kontaktformular und Discord. Der Datenschutz-Absatz verweist für Betroffenenrechte ebenfalls nur
  auf „das Kontaktformular unten".
  (b) Impressum und Datenschutz stehen ausschließlich im Overlay `#legal-overlay`, das nur der
  Knopf „Hinweise" öffnet. Es gibt keinen Deep-Link (kein `?legal=`/`#impressum`-Parser in
  `js/app/`), keine eigene Seite und keinen Eintrag in `sitemap.xml` — die Sitemap kennt genau
  eine URL. Man kann das Impressum weder verlinken noch als Lesezeichen speichern.
- **Erwartet:** Eine E-Mail-Adresse im Impressum-Absatz (das ist der klassische
  Abmahn-Anlass und kostet eine Zeile) und ein adressierbarer Zustand, z. B. `?hinweise=impressum`,
  der den Dialog beim Laden öffnet — oder eine schlanke `html/impressum.html`.
- **Beleg:** `grep -c "mailto:" index.html` = 0; `grep -o "[a-z0-9._-]*@[a-z0-9.-]*" index.html`
  liefert nur JSON-LD-Schlüssel (`@context`, `@graph`, `@id`, `@type`). `sitemap.xml` gelesen.
  Suche nach einem Legal-Deep-Link in `js/app/*.js` und `index.html` ohne Treffer.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B6 Jeder anonyme Besucher bekommt ein PHPSESSID-Cookie, das der Datenschutztext nicht erwähnt
- **Kategorie:** AKUT
- **Fundstelle:** `C:\GIT\avesmaps\js\config.js:337-338` → `js/app/session.js:91-96` → `api/app/session.php:68` → `api/_internal/auth.php:18-26` · Aussagen in `index.html:2202` und `NOTICE.md:47-49`
- **Beobachtung:** `js/config.js` ruft `AvesmapsSession.load()` beim Skript-Laden **unbedingt**
  auf, für jeden Besucher. `api/app/session.php` sagt es im eigenen Kopfkommentar (`:21`): „Er
  läuft auf dem Startpfad JEDES Besuchers." Der Aufruf landet in `avesmapsCurrentUser()` →
  `avesmapsStartSession()` → `session_start()`, was PHP dazu bringt, ein `PHPSESSID`-Cookie zu
  setzen — auch für jemanden, der sich nie anmeldet. Der Datenschutz-Absatz sagt: „Avesmaps setzt
  keine Cookies **zu Tracking- oder Werbezwecken**" (formal richtig, aber es wird eben ein Cookie
  gesetzt), `NOTICE.md:47` sagt zur Statistik „ohne Cookies" (für die Statistik selbst zutreffend).
  Ein Cookie für eine Sitzung, die ein anonymer Besucher gar nicht braucht, ist schwer als
  „unbedingt erforderlich" zu begründen.
- **Erwartet:** Entweder `session_start()` nur, wenn ein Sitzungs-Cookie bereits vorliegt (die
  anonyme Antwort braucht keine Sitzung), oder ein Satz im Datenschutz-Absatz, der das technisch
  notwendige Sitzungs-Cookie benennt.
- **Beleg:** Alle vier Dateien gelesen; die Aufrufkette `config.js:337` → `session.js:91` (`fetch`
  mit `credentials: "same-origin"`) → `session.php:68` → `auth.php:26` nachverfolgt. Der
  `Set-Cookie`-Kopf wurde **nicht** live beobachtet (Live-Anfragen verboten).
- **Sicherheit:** BELEGT (Codepfad), PLAUSIBEL (beobachteter Kopf)
- **Aufwand:** klein

### B7 NOTICE.md nennt Wiki Aventurica überhaupt nicht — die größte Inhaltsquelle des Projekts fehlt in der Rechtsdatei
- **Kategorie:** KANN
- **Fundstelle:** `C:\GIT\avesmaps\NOTICE.md` (ganze Datei) · Verweis darauf in `README.md:183-184`
- **Beobachtung:** `NOTICE.md` benennt avespfade.de, Orkenspalter-Kartenmaterial, die Schriftart,
  Leaflet/polygon-clipping, DB-IP und die Ulisses-Fanrichtlinien. **Nicht** genannt: Wiki
  Aventurica (Quelle von Namen, Hierarchien, Infoboxdaten, Wappen, Abenteuerkatalog, Stadtplan-
  Katalog, Lore und ~1,1 Mio. Zeichen Fließtext), die Abenteuer-Cover, die Siedlungsbilder, die
  Stadtplan-Vorschauen, Nutzerkonten/Kontaktformular/Bewertungen. `README.md` verweist für „Details,
  sources and notes on the rights situation" auf genau diese Datei. Der eigentliche, vollständige
  Rechtstext lebt in `index.html` — und wird nicht deployt (`NOTICE.md` steht nicht in der
  Deploy-Allowlist), existiert also nur auf GitHub. Zwei Rechtstexte, der ältere ist der, auf den
  das Repo zeigt.
- **Erwartet:** `NOTICE.md` auf den Stand des Hinweis-Dialogs bringen (mindestens: Wiki Aventurica
  mit Lizenzangabe, Cover, Bilder, Stadtpläne) oder es zu einem kurzen Zeiger auf den
  Hinweis-Dialog machen, damit es nur eine Wahrheit gibt.
- **Beleg:** `NOTICE.md` vollständig gelesen; `grep -i "aventurica" NOTICE.md` ohne Treffer;
  Deploy-Allowlist `.github/workflows/deploy-avesmaps-strato.yml:80-103` gelesen (kein
  `NOTICE.md`, kein `docs`, kein `README.md`).
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B8 1,11 Mio. Zeichen wörtlicher Wiki-Fließtext je Kartenpayload — die Lizenz des Wikis wird nirgends benannt
- **Kategorie:** KANN
- **Fundstelle:** `GET /api/app/map-features.php` (Momentaufnahme `snapshots/map-features.json`) · Text in `C:\GIT\avesmaps\index.html:2189`
- **Beobachtung:** Eine einzige Payload-Antwort enthält wörtliche Wiki-Beschreibungen in fünf
  Feldern: `wiki_settlement.description` 1 889 Einträge / 480 285 Zeichen,
  `wiki_path.description` 1 832 / 463 096, `wiki_region.description` 542 / 140 580,
  `wiki_powerline.description` 80 / 23 917 — zusammen **1 111 654 Zeichen**. Die Anzeige kürzt oft
  auf den ersten Satz, **ausgeliefert wird aber der ganze Text** an jeden Besucher.
  Positiv: **0** dieser Einträge kommt ohne `wiki_url` (Prüfung unten), und
  `js/ui/popups.js:52-58` rendert zu jedem eine Quellzeile („Informationen aus dem Wiki
  Aventurica." + „Mehr hier"-Link). Die Zuordnung stimmt also.
  Offen bleibt die **Lizenz**: `index.html:2189` sagt nur, die Rechte „richten sich nach der auf
  Wiki Aventurica angegebenen Lizenz", ohne sie zu nennen oder zu verlinken; `NOTICE.md` schweigt
  ganz (B7). Bei einer Copyleft-artigen Wiki-Lizenz gehören Lizenzname + Lizenzlink zur
  Namensnennung.
- **Erwartet:** Lizenz von Wiki Aventurica einmal prüfen, im Hinweistext und in `NOTICE.md`
  namentlich mit Link nennen; wenn nur der erste Satz angezeigt wird, auch nur den ersten Satz
  ausliefern (spart nebenbei ~1 MB je Payload).
- **Beleg:** Eigenes Node-Skript über `snapshots/map-features.json` (11 486 Features), Zählung je
  Feld inkl. „ohne Verweis"-Spalte; `js/ui/popups.js:52-58` gelesen; `index.html:2189` gelesen.
- **Sicherheit:** BELEGT (Zahlen) / PLAUSIBEL (rechtliche Bewertung — ich habe die Wiki-Lizenz
  nicht abgerufen, Live-Anfragen waren untersagt)
- **Aufwand:** klein (Textnennung) bis mittel (Payload kürzen)

### B9 Zehn Platzhalter-Cover werden direkt von de.wiki-aventurica.de nachgeladen — die IP jedes Besuchers geht dorthin
- **Kategorie:** KANN
- **Fundstelle:** `C:\GIT\avesmaps\js\map-features\map-features-place-extras.js:16-30` (Daten), `:687` und `:775` (Ausgabe)
- **Beobachtung:** `AVESMAPS_PLACEHOLDER_ADVENTURES` enthält zehn fest verdrahtete
  `https://de.wiki-aventurica.de/de/images/thumb/...`-URLs, die als `<img src="…">` ausgegeben
  werden. Sie greifen laut `:45-53` immer dann, wenn der Abenteuerkatalog noch nicht bereit ist —
  also im normalen Ladefenster einer geöffneten Ortsbox. Damit fordert der Browser des Besuchers
  Bilder bei einem fremden Server an; dessen Protokoll sieht IP, User-Agent und Referrer. Der
  Quellkommentar `:16-18` weiß es selbst: „TEMPORAER hotgelinkte Wiki-Aventurica-Thumbnails […]
  idealerweise ueber den coat.php-artigen Cache-Proxy statt Hotlink."
  **Alles andere ist sauber:** Wappen laufen über den echten Proxy `api/app/coat.php`
  (`js/map-features/map-features-region-info-markup.js:9-18`), die 1 097 echten Abenteuer-Cover
  liegen ausnahmslos lokal unter `/uploads/…` (Zählung über `snapshots/adventures.json`:
  1 097 lokal, 255 leer, 0 fremd), Stadtplan-Vorschauen ebenso (346 lokale Thumbs, 0 fremde),
  Schriften lokal, kein CDN, kein Analytics-Drittanbieter.
- **Erwartet:** Die zehn Platzhalter durch das vorhandene SVG-Platzhaltersymbol
  (`AVESMAPS_ADV_COVER_PH_SVG`, `:39`) ersetzen oder über den Proxy führen.
- **Beleg:** Datei gelesen (Zeilen zitiert); Snapshot-Auszählung `adventures.json` (1 352 Zeilen
  `cover_url`) und `citymaps.json` (456 Karten) mit Node.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B10 Landschafts-Infobox rendert das Wiki-Bild ohne Proxy — derzeit wirkungslos, aber scharf, sobald Lizenzen nachgetragen werden
- **Kategorie:** KANN
- **Fundstelle:** `C:\GIT\avesmaps\js\map-features\map-features-labels.js:347-351`
- **Beobachtung:** Die öffentliche Landschafts-Infobox setzt
  `src="${escapeHtml(wiki.image_url)}"` **ohne** die `avesmapsCoatSrc()`-Umhüllung, die jeder
  andere Bildpfad benutzt; `wiki.image_url` wird serverseitig als
  `https://de.wiki-aventurica.de/wiki/Spezial:Dateipfad/…` gebaut. Geprüft wird nur die Lizenz
  (`image_license_status === public_domain`), nicht der Host. **Aktuell wirkungslos:** in der
  Live-Momentaufnahme haben **alle 2 374** Vorkommen von `image_license_status` den leeren Wert,
  es wird also kein einziges Bild gezeigt. Sobald jemand die Lizenzen nachträgt (die Memory-Notiz
  „nur public_domain + CC0 — INERT bis Re-Enrich" beschreibt genau das als geplant), wird aus der
  Zeile ein echter Hotlink.
- **Erwartet:** `avesmapsCoatSrc()` (bzw. `api/app/coat.php`) auch hier, wie an allen anderen
  Bildstellen.
- **Beleg:** Datei gelesen; Auszählung `"image_license_status":"…"` über
  `snapshots/map-features.json` → 2 374 × leer, 0 gesetzt.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B11 Kein Aufbewahrungs- oder Löschkonzept für Kontaktnachrichten, Meldungen und Bewertungen
- **Kategorie:** KANN
- **Fundstelle:** `C:\GIT\avesmaps\api\app\contact.php:171-190` (DDL), `api\app\report-location.php:180-181`, `api\_internal\reviews.php:20-41`
- **Beobachtung:** Gespeichert werden dauerhaft: Kontaktformular — `sender_name`, `sender_email`,
  `message` (4 000 Z.), `user_agent` (500 Z.), `ip_hash`, `page_url`; Meldungen —
  `reporter_name`, `comment`, `user_agent`, `ip_hash`; Bewertungen — `author_name`, `body`,
  `user_agent`, `ip_hash`. Ein `grep` über `api/` nach `DELETE FROM contact_message|map_reports|
  location_reports|map_reviews` findet **nur zwei** Treffer, beide manuell:
  `api/edit/reviews.php:108` (Editor löscht eine Bewertung) und
  `api/import/location-reports/delete.php:31`. Es gibt keine Frist, keinen Aufräumlauf, keinen
  Hinweis auf eine Speicherdauer im Datenschutz-Absatz. Positiv gegengerechnet: die
  Analytics-Tabellen räumen selbst auf (`visitor_daily_seen` täglich, `visitor_live` nach 15 min),
  und `report-location.php:179` schreibt die Klartext-IP **absichtlich als leeren String** — die
  Rohe IP steht nur noch im Fehlerpfad-Log (`:198`, `:207`, `:217`).
- **Erwartet:** Eine benannte Frist (z. B. erledigte Kontaktnachrichten nach 6/12 Monaten) und ein
  Satz dazu im Datenschutz-Absatz; `user_agent` bei Nachrichten braucht es fachlich kaum.
- **Beleg:** DDL-Blöcke aller drei Tabellen gelesen; `grep -rn "DELETE FROM …" api/` ausgeführt
  (Ergebnis oben).
- **Sicherheit:** BELEGT
- **Aufwand:** klein bis mittel

### B12 Der IP-Hash der Bewertungen ist nur mit dem Datenbanknamen gesalzen
- **Kategorie:** KANN
- **Fundstelle:** `C:\GIT\avesmaps\api\_internal\reviews.php:44-48`
- **Beobachtung:** `avesmapsReviewIpHash()` nimmt als HMAC-Geheimnis
  `$config['database']['name'] ?? 'avesmaps'` — also einen kurzen, ratbaren Wert; der Kommentar
  darüber (`:43`) nennt das Ergebnis „privatsphaere-schonender IP-Hash". Die beiden
  Schwesterfunktionen machen es besser: `api/app/contact.php:150-157` und
  `api/app/report-location.php:427-434` nehmen zuerst den Import-Token und fallen **erst dann**
  auf den Datenbanknamen zurück.
- **Erwartet:** Dieselbe Reihenfolge wie bei Kontakt und Meldung (Import-Token zuerst) — eine
  Zeile, und die drei Pfade sind wieder gleich stark.
- **Beleg:** Alle drei Funktionen gelesen und verglichen.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B13 Das Meldeformular enthält keinen Datenschutzhinweis — das Kontaktformular daneben schon
- **Kategorie:** KANN
- **Fundstelle:** `C:\GIT\avesmaps\index.html:1025-1032` und `:1115-1160` gegen `:2207`
- **Beobachtung:** Der Kontakt-Block trägt eine Hinweiszeile: „Deine Nachricht und (falls
  angegeben) deine E-Mail-Adresse werden nur zur Bearbeitung deiner Anfrage genutzt und nicht
  weitergegeben." Der Melde-Dialog („Karteneintrag melden") hat im Intro (`:1030-1032`) nur einen
  fachlichen Satz und im Abschnitt „Weiteres" die Felder „Dein Name/Pseudonym (optional)" und
  „Kommentar" — **ohne** einen Satz dazu, was damit geschieht, und ohne Verweis auf die Hinweise.
  Der passende Absatz existiert (`:2190`), steht aber zwanzig Bildschirme entfernt in einem
  anderen Dialog.
- **Erwartet:** Eine Zeile unter dem Melde-Formular, gleiche Machart wie beim Kontaktformular,
  mit Verweis auf die Hinweise.
- **Beleg:** Beide Formularblöcke in `index.html` gelesen.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B14 Community-Meldungen samt Melder-Pseudonym stehen im öffentlichen Kartenpayload
- **Kategorie:** KANN
- **Fundstelle:** `properties.description` einzelner Orte in `GET /api/app/map-features.php` (Momentaufnahme)
- **Beobachtung:** 13 der 31 Features mit einem eigenen `description`-Feld enthalten keinen
  Wiki-Text, sondern hineinkopierte Meldungen, teils mit dem selbstgewählten Namen des Melders,
  z. B. „— Community-Änderungswunsch von Andy - Feljaten: …" und „— Community-Änderungswunsch von
  Weidener: …". Das Feld wird an jeden Besucher ausgeliefert. Der Rechtstext (`index.html:2190`)
  sagt zwar, Meldungen würden geprüft, sagt aber nirgends, dass Name **und** Text öffentlich
  sichtbar werden können — und das Formular sagt es auch nicht (B13).
- **Erwartet:** Redaktionelle Notizen gehören in ein internes Feld (`review_note` existiert
  bereits in `map_reports`), nicht in die öffentliche Beschreibung; oder das Formular sagt vorab,
  dass der Name veröffentlicht werden kann.
- **Beleg:** Node-Auswertung über `snapshots/map-features.json`; 31 Treffer mit `description`,
  davon 13 ohne `wiki_url`, Stichproben ausgegeben (Feenburg, Kaltenforst, Hohenhain,
  Düsterthurm, Blutulmenthurm).
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B15 Besucher können eine Bewertung nicht melden — Moderation gibt es nur für angemeldete Editoren
- **Kategorie:** KANN
- **Fundstelle:** `C:\GIT\avesmaps\js\community\location-reviews.js:359-370`
- **Beobachtung:** Die Moderationsknöpfe (verbergen/einblenden/löschen) sind laut Kommentar
  „nur im Editor sichtbar/aktiv". Für einen normalen Besucher, der eine beleidigende oder
  rechtsverletzende Bewertung sieht, gibt es keinen Melde-Weg an dieser Stelle — nur das allgemeine
  Kontaktformular in den Hinweisen, das an dieser Stelle nirgends verlinkt ist. Zusammen mit B1
  (sofort öffentlich) ist das die klassische Lücke im Notice-and-Action-Ablauf.
- **Erwartet:** Ein unscheinbares „melden" an jeder Bewertung, das im Editor-Postfach landet
  (`docs`-Notiz `editor-mail-inbox-plan.md` beschreibt das Postfach bereits).
- **Beleg:** Datei gelesen; `grep` nach „melden/löschen/Hinweis" in derselben Datei liefert nur
  die Editor-Aktionen.
- **Sicherheit:** BELEGT
- **Aufwand:** mittel

### B16 Beim Wappen-Upload behauptet der Editor die Lizenz — der Rechtstext spricht von der „im Import übernommenen Lizenzkennzeichnung"
- **Kategorie:** KANN
- **Fundstelle:** `C:\GIT\avesmaps\api\_internal\wiki\sync-monitor-identity.php:307`, `:318` und `:385` · Zusage in `index.html:2184`
- **Beobachtung:** Der Riegel selbst ist echt und gut gebaut: `api/_internal/coat-url.php:44`
  lässt ausschließlich `public_domain` durch, alle Leser gehen durch dieselbe Funktion
  (`:61-74`), und die Live-Momentaufnahme bestätigt es — im Politik-Layer sind 150 Wappen-URLs
  gesetzt, **alle** lokal unter `/uploads/…`, keine einzige fremd. Die Formulierung im Rechtstext
  ist trotzdem zu stark: „Angezeigt werden ausschließlich Wappen, die **nach der im Import
  übernommenen Lizenzkennzeichnung** als gemeinfrei eingestuft sind." Beim eigenen Upload gilt das
  nicht — der Code sagt es selbst (`:307`): „Die Lizenz waehlt der Nutzer selbst. […] keine
  Quell-/Lizenz-Beschraenkung", akzeptiert wird `public_domain` oder `attribution_required`
  (`:318`), und der gewählte Wert wird als Override gesetzt (`:385`). Ein selbst hochgeladenes
  Bild, das jemand auf „gemeinfrei" stellt, geht ungeprüft durch den Riegel.
- **Erwartet:** Halbsatz im Rechtstext ergänzen („oder von der Redaktion als gemeinfrei
  eingestuft"), damit die Zusage die Wirklichkeit beschreibt.
- **Beleg:** `coat-url.php` und `sync-monitor-identity.php:305-388` gelesen; Auszählung der
  `coat_of_arms_url`-Werte in `snapshots/political-zoom3.json` → 150 × `/uploads/…`, 229 × leer,
  0 fremd.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B17 Abenteuer-Cover: 1 097 Publikations-Cover werden lokal gespiegelt, ohne dass je Cover eine Lizenz-/Herkunftsangabe geführt wird
- **Kategorie:** KANN
- **Fundstelle:** `C:\GIT\avesmaps\api\_internal\wiki\adventure-sync.php:357-398` · `api\_internal\app\adventures.php:42` · Zusage in `index.html:2186`
- **Beobachtung:** Die Cover werden bei Wiki Aventurica geholt und unter
  `/uploads/questcovers/<slug>.<ext>` **auf dem eigenen Server abgelegt**; die Tabelle `adventure`
  hat dafür genau eine Spalte, `cover_url VARCHAR(500)`, und **kein** Lizenz-, Quellen- oder
  Genehmigungsfeld — anders als Wappen (`coat_of_arms_license_status`), Siedlungsbilder
  (`license`) und Stadtpläne (`map_license`/`thumb_license`). Der Code sagt das offen
  (`:361-363`): „UNLIKE coats there is NO public_domain gate — adventure covers are shown under the
  Ulisses fan-content permission WITH a reference to the F-Shop (a licensing basis enforced at the
  DISPLAY layer, not here)."
  **Was tatsächlich stimmt:** die Verhältnismäßigkeit ist gewahrt — längste Kante 600 px
  (`:162`), und der Verweis ist da: `map-features-place-extras.js:660-676` legt die Reihenfolge
  Ulisses-eBook → F-Shop → Wiki → Deutsche Nationalbibliothek fest, das Cover verlinkt immer den
  besten verfügbaren. Das deckt sich mit `index.html:2186`.
  **Was fehlt:** die ganze Konstruktion hängt an einem einzigen Satz („werden mit Genehmigung von
  Ulisses verwendet"), der nirgends belegt ist, und pro Cover ist nicht festgehalten, woher es kam
  und wann. Bei einem Widerruf gäbe es keine Liste, an der man sich entlanghangeln kann — nur
  1 097 Dateien.
- **Erwartet:** Ein Feld für Herkunft/Datum je Cover (die Spalte `cover_source` existiert schon im
  Sync, `:209`), und die Genehmigung als Datum/Aktenzeichen in den Hinweisen oder in `NOTICE.md`
  festhalten.
- **Beleg:** `adventure-sync.php:354-398` und `adventures.php:42` gelesen; Live-Bestand über
  `snapshots/adventures.json`: 1 352 Einträge, davon 1 097 mit `/uploads/…`-Cover, 255 leer,
  **0 fremd**; `map-features-place-extras.js:660-676` gelesen.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B18 Freitext-Suchbegriffe landen ohne Mindestschwelle in der Statistik, Routen dagegen mit
- **Kategorie:** KANN
- **Fundstelle:** `C:\GIT\avesmaps\js\ui\spotlight-search.js:106` · `api\_internal\analytics\visitor-analytics.php:155-160`
- **Beobachtung:** Der Client sendet den **rohen Suchtext** (80 Zeichen) als Dimension:
  `trackVisitorEvent("search", finalSpotlightQuery.slice(0, 80))`. In der Auswertung steht
  `'search' => $top('search', 1)` — Mindestzahl **1**, ein einziges Mal getippter Text erscheint
  also im Statistikfenster. Für Routen hat jemand bereits daran gedacht:
  `'route' => $top('route', 3)` und `'route_waypoint' => $top('route_waypoint', 3)`.
  Der Datensatz selbst ist ein reiner Zähler ohne Besucherbezug — das Risiko ist gering, aber
  „Suche" ist das einzige Feld, in das ein Mensch frei tippt.
- **Erwartet:** Dieselbe Schwelle wie bei Routen (`$top('search', 3)`) — ein Zeichen.
- **Beleg:** Beide Dateien gelesen und die Schwellenwerte verglichen.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B19 Ein eigener Melde-/Löschweg für Rechteinhaber wäre die kleinste sinnvolle Ergänzung
- **Kategorie:** ZUKUNFT
- **Fundstelle:** `C:\GIT\avesmaps\index.html:2181`, `:2184`, `:2185` (drei gleichlautende Zusagen)
- **Beobachtung:** Der Rechtstext verspricht dreimal fast wörtlich: „Auf Hinweis von
  Rechteinhabern werden betroffene Bilder/Wappen/Inhalte geprüft und, soweit erforderlich,
  entfernt oder angepasst." Der einzige Weg dorthin ist das allgemeine Kontaktformular, das
  weder eine Betreffauswahl noch ein Feld für die betroffene URL hat. Bei einem echten
  Beschwerdefall ist genau das der Unterschied zwischen „am selben Tag erledigt" und „liegt
  zwischen dreißig anderen Nachrichten".
- **Erwartet:** Ein Betreff-Auswahlfeld im Kontaktformular („Rechteanfrage / Bildentfernung")
  plus ein Feld für die betroffene Adresse; landet in derselben Tabelle, nur auffindbar.
- **Beleg:** Formular in `index.html:2209-2222` gelesen — es hat Name, E-Mail, Nachricht und
  sonst nichts.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B20 Der Rechtstext existiert doppelt (DE im Markup, EN in der i18n-Tabelle) ohne Kopplung
- **Kategorie:** ZUKUNFT
- **Fundstelle:** `C:\GIT\avesmaps\index.html:2175-2224` gegen `C:\GIT\avesmaps\js\app\i18n-en.js` (u. a. `:793`)
- **Beobachtung:** Jeder rechtliche Absatz steht zweimal: als deutscher Fließtext im Markup und
  als englischer Wert unter einem `legal.*`-Schlüssel. Wer den deutschen Absatz ändert und den
  Schlüssel vergisst, liefert englischsprachigen Besuchern ab sofort eine **andere**
  Rechtsauskunft — und nichts fällt dabei um. Bei einem Impressum ist das eine unangenehme Art
  von Divergenz (bei einer Beschriftung wäre es egal).
- **Erwartet:** Eine Prüfung, die alle `legal.*`-Schlüssel gegen die im Markup vorhandenen
  `data-i18n`-Attribute abgleicht (der Bestand solcher kleinen Prüfskripte ist im Projekt
  vorhanden), damit ein fehlender oder verwaister Schlüssel auffällt.
- **Beleg:** Der englische Impressum-Absatz in `i18n-en.js:793` enthält dieselbe c/o-Anschrift
  wie `index.html:2177`; die Struktur „deutscher Text im Markup + `data-i18n`-Schlüssel" habe ich
  über den gesamten Legal-Block gelesen. Ich habe **nicht** geprüft, ob die beiden Fassungen
  aktuell inhaltlich auseinanderlaufen.
- **Sicherheit:** PLAUSIBEL
- **Aufwand:** klein

---

## Was ausdrücklich sauber ist (geprüft, kein Befund)

Damit die Befunde oben im Verhältnis bleiben — das hier hat der Test **bestanden**:

- **Geheimnisse im Repo: nichts gefunden.** `api/config.local.php` existiert im Arbeitsbaum gar
  nicht und ist ungetrackt; `.gitignore:22-33` hält Dumps und Backups draußen, `git ls-files
  uploads/` liefert genau zwei Deny-all-`.htaccess`. Kein Token, kein Schlüssel, kein
  Passwort-Hash, kein Produktivdump, keine Logdatei, keine fremde E-Mail-Adresse — auch nicht in
  der Historie (`git log --diff-filter=A` über `*.sql|*.env|*.log`). Der Deploy-Workflow löscht
  `.env` und `config.local.php` aktiv aus dem Paket (`deploy-avesmaps-strato.yml:174-181`).
  Einzige echte Zugangsdaten im Code: `dump-fetch.php:101-102` (`'Gareth'`/`'Phex'`), vom Kommentar
  daneben als öffentlich dokumentierte Wiki-Startwerte bezeichnet und zur Laufzeit überschreibbar.
- **Keine Fremdressourcen im Ladepfad.** Schriften liegen lokal (`css/base/fonts.css:1-6`),
  Leaflet/jQuery/polygon-clipping/polylabel sind einvendort, kein CDN, kein `preconnect`, kein
  Google/Matomo/Meta-Schnipsel, keine Kartenkacheln von fremden Servern. Die einzige Ausnahme ist
  B9.
- **Der Wappen-Proxy ist echt** (`api/app/coat.php`): serverseitiger Abruf mit Host-Allowlist und
  lokalem Cache, der Besucherbrowser spricht nie mit dem Wiki.
- **Geschützte Verzeichnisse sind geschützt:** `api/_internal`, `api/_schema`, `api/diagnostics`,
  `config`, `tools/wikidump`, `uploads/dumps`, `uploads/db-backups` tragen alle ein
  `Require all denied`.
- **`docs/`, `sql/`, `tests/`, `prototype/`, `NOTICE.md` und die `verify-*.html` werden nicht
  deployt** — die Allowlist in `deploy-avesmaps-strato.yml:80-103` enthält sie nicht.
- **Die Analytics sind wirklich aggregiert:** keine Rohzeile je Besuch, `visitor_metric` ist ein
  Zähler, die Klartext-IP wird für den Geo-Lookup benutzt und nicht gespeichert
  (`visitor-analytics.php:347-371`), `visitor_daily_seen` räumt täglich, `visitor_live` nach
  15 Minuten. Der Schwachpunkt ist allein der Salt (B2).
- **Der Discord-Export ist token-gesichert und schließt IP/UA ausdrücklich aus**
  (`api/discord/reports-export.php:8`).
- **Stadtpläne machen den Lizenzriegel vorbildlich:** Default `unknown_other`, öffentliche
  Vorschau nur aus eigenem Upload, Fremdlink als Anzeigeweg bewusst stillgelegt
  (`api/_internal/app/citymaps.php:810-843`) — 456 Karten, 0 lokal gespiegelte Vollkarten,
  346 eigene 400-px-Vorschauen.

## Randnotiz außerhalb meines Auftrags (für Agent Sicherheit)

`scripts/` liegt in der Deploy-Allowlist (`deploy-avesmaps-strato.yml:91`), hat **kein**
`.htaccess`, und von den acht dort ausgelieferten PHP-Dateien haben nur zwei einen Web-Riegel
(`wikidump-apply.php:80`, `wikidump-compare.php:139` mit `http_response_code(403)`).
`apply-political-breadcrumb-default-zooms.php`, `check-links.php`,
`migrate-other-source-to-sources.php`, `reset-political-territory-display-defaults.php`,
`wikidump-read.php` und `wikidump-settlement-conflicts-dryrun.php` zeigen keinen.
Nicht weiter verfolgt (Live-Anfragen untersagt, und es ist Agent-Sicherheits-Gebiet) — aber es
sind schreibende Wartungsskripte.

## Methodik / Grenzen

- **Keine einzige Netzwerkanfrage an avesmaps.de.** Alles aus dem Repo-Quelltext und den
  vorgegebenen Momentaufnahmen unter `snapshots/`.
- Nichts im Arbeitsbaum verändert, nichts committet, nichts gepusht; keine Produktivdaten
  angelegt oder gelöscht (kein Spurenbuch-Eintrag nötig).
- Wo ich einen Codepfad gelesen, aber sein Ergebnis nicht auf dem Server gesehen habe (B2, B4, B6),
  steht das ausdrücklich am Befund.
- Ich bin kein Anwalt; oben steht, was im Code und im Text **steht** und wo beides
  auseinandergeht — keine rechtliche Bewertung, kein Zitat aus einem Gesetzestext.
