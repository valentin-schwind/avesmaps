# Bekannte Quellen — die Domain ist der Korpus, die Seite behält ihre Zeile

**Entwurf, 01.–02.09.2026.** Mockup: `docs/bekannte-quellen-mockup.html`
Anlass: Owner-Frage — „ich bräuchte Ideen, wie ich die Briefspieler dazu bringen kann, genaue
Links zu hinterlegen und konsistente Bezeichner für ihre Quellen zu wählen."

> 🔴 **§3 ist der Owner-Entscheid vom 01.09.2026 und ersetzt meinen ersten Vorschlag vollständig.**
> Der sah eine neue Spalte `feature_sources.ref_url` vor und legte 117 Katalogzeilen zu sechs
> zusammen. Das Modell des Owners kommt **ohne beides** aus: keine neue Spalte, kein
> Zusammenlegen, kein Häkchen. Was in der ersten Fassung als „der riskante zweite Schritt"
> beschrieben war, gibt es nicht mehr. Die Messungen in §1/§2 sind davon unberührt und tragen
> weiterhin — sie sind der Grund, warum überhaupt etwas geschieht.

---

## 1 · Der Befund

Der Quellenkatalog trägt zwei verschiedene Dinge, und sie haben gegenläufige Identitäten:

| | **Werk** (Geographia Aventurica) | **Belegstelle** (`herzogtum-weiden.net/…/adlerflug`) |
|---|---|---|
| Identität ist | der **Titel** | die **Adresse** |
| die Adresse ist | Beiwerk (Shop-Link) | die Sache selbst |
| der Titel ist | die Sache selbst | Beiwerk — und wird 27-mal wiederholt |

💣 **KORREKTUR MEINER EIGENEN MESSUNG (01.09.2026).** Die erste Fassung dieses Entwurfs nannte
durchweg um das **3,4-fache zu hohe** Zahlen. Die Kartennutzlast mischt zwei Dinge: echte
Katalogzeilen und `os:`-Einträge — das alte Einzelfeld `properties.other_source`, das der Server
nur **zur Anzeige** synthetisiert (`avesmapsReadFeatureSources`). Ich hatte beide gezählt. Wer aus
`map-features.php` Katalogzahlen zieht, muss `os:`-Kennungen ausschliessen.

### 1.1 Der Bestand, frisch gemessen (01.09.2026)

Eine Anfrage gegen `GET /api/app/map-features.php` (20,7 MB), `os:` ausgeschlossen:

**1.376 echte Katalogzeilen**, davon **1.019 mit Adresse** und **357 ohne**.

⚠️ **Was diese Zahl NICHT ist:** die Nutzlast trägt nur Quellen, die an einem **lebenden** Objekt
hängen (`avesmapsLoadFeatureSourceCatalog` filtert per `EXISTS`). Katalogzeilen ohne Verknüpfung
sind von aussen unsichtbar; dafür braucht es einen Blick in die Datenbank.

Die 1.019 Adressen verteilen sich auf **15 registrierbare Domains**:

| Domain | Zeilen | Titel | Objekte | Titel/Zeile |
|---|---|---|---|---|
| f-shop.de | 637 | 623 | 33.095 | **0,98** |
| ulisses-ebooks.de | 242 | 242 | 6.911 | **1,00** |
| westlande.de | 39 | 4 | 49 | **0,10** |
| herzogtum-weiden.net | 33 | 4 | 121 | **0,12** |
| punin.de | 33 | 5 | 76 | **0,15** |
| kahet-ni-kemi.de | 16 | 2 | 20 | **0,12** |
| wiki-aventurica.de | 7 | 7 | 7 | 1,00 |
| horaswiki.de · garetien.de | je 3 | 3 | 3 / 4 | 1,00 |
| sechs weitere | je 1 | 1 | 1–32 | 1,00 |

### 1.2 Die Namensdopplung, gemessen

Von den 1.019 Zeilen mit Adresse tragen **887 verschiedene Titel — 25 davon doppelt**:

„Briefspiel" ×33 · „Albernisches Briefspiel" ×27 · „AlmadaWiki" ×24 · **leer ×15** ·
„Briefspiel Káhet Ni Kemi" ×9 · „Briefspiel Kâhet Ni Kemi" ×7.

🚩 **„Briefspiel" ×33 sind ZWEI verschiedene Korpora** — 27 Zeilen aus Weiden und 6 aus
`punin.de`. Derselbe Name für zwei verschiedene Angebote, in derselben Vorschlagsliste. Wer dort
greift, greift nicht nur unscharf, sondern kann das falsche Briefspiel erwischen.

🚩 **Ein Diakritikum spaltet ein Korpus:** „Ká­het" (9) gegen „Kâ­het" (7). Bei 9:7 entscheidet
nicht einmal die Mehrheit — und in einer Auswahlliste sind die beiden **mit dem Auge nicht zu
unterscheiden**.

🚩 **15 Zeilen tragen gar keinen Titel** (an 22 Objekten). Sie zeigen dem Besucher heute ihre
nackte Adresse oder nichts.

🚩 **Auch der TYP ist inkonsistent, nicht nur der Name.** Dieselbe Domain trägt `briefspiel` und
`sonstiges` nebeneinander — bei Weiden sogar **`sonstiges: 22` gegen `briefspiel: 11`**. Wer nur
die Namen vereinheitlicht, hat die halbe Arbeit gemacht.

🚩 **Ein ANKER erzeugt eine zweite Zeile.** `?title=Gräflich_Abagund` und `…#Siedlungen_im_Land`
sind für `url_hash` zwei Quellen — dieselbe Seite, zweimal im Katalog. Dasselbe gilt für
`http`/`https`, `www.` und einen Schrägstrich am Ende.

🚩 **Vier Zeilen zeigen schon auf die STARTSEITE** (`wiki.punin.de/`) — sie sind faktisch
Korpuszeilen mit falschem Namen; einige zeigen auf Bilddateien statt auf Artikel.

### 1.3 Die 357 ohne Adresse — und warum sie hier nicht mitspielen

Owner-Frage: *„ok aber alle haben einen link, oder?"* — nein, 357 nicht. Gemessen, was sie sind:

| | |
|---|---|
| offiziell | **357 von 357** |
| Arten | Aventurischer Bote 141 · Abenteuer 55 · Regionalspielhilfe 49 · Roman 46 · sonstiges 40 · Regelbuch 26 |
| davon **Briefspiel** | **0** |
| ohne Titel | **0** |
| verschiedene Titel | 347 von 357 |

Es sind erschienene Werke, die das Wiki kennt und für die es keinen Shop-Link (mehr) gibt —
Aventurischer Bote Nr. 70, „Das Land des Schwarzen Auges" (488× zitiert), Sternenschweif. Auch die
40 unter `sonstiges` sind durchweg Kaufprodukte, kein einziges falsch getyptes Briefspiel.

🔴 **Die zwei Hälften sind exakt invertiert: 100 % der Belegstellen haben eine Adresse, 0 % der
Adresslosen sind Belegstellen.** Wo der Link fehlt, ist der Titel eindeutig; wo der Link da ist,
sitzt das ganze Namenschaos. Der Korpus braucht den Link genau dort, wo er ohnehin liegt.

⭐ **Und das ist strukturell garantiert, keine Momentaufnahme:** die Aktion `add` weist eine Quelle
ohne Adresse ab (*„url ist erforderlich."*). Ein Editor **kann** keine linklose Zeile anlegen — die
entstehen ausschliesslich im Wiki-Publikations-Abgleich, und der legt nur Werke an.

⚠️ Nebenbefund, nicht Teil dieses Vorhabens: **10 Werke stehen doppelt** im Katalog (Enzyklopaedia
Aventurica, Die Phileasson-Saga, Die Schicksalsklinge, Liber Cantiones …). Sie teilen keinen
`url_hash`, weil der bei linklosen Zeilen aus dem `wiki_key` synthetisiert wird — zwei
Wiki-Schlüssel für dasselbe Buch.

---

## 2 · Die Ursache

Ein Kommentar in `api/_internal/import/garetien-uebernahme.php` beschreibt das Ziel bereits richtig:

> „die Beschriftung nennt das **Briefspiel**, die Adresse den **Artikel**"

⚠️ Das ist **kein Beleg, sondern eine Beobachtung**: der Kommentar stammt selbst aus einem
Agenten-Commit (`a95bed8fc`, Co-Authored-By: Claude), wie fast alle deutschen Kommentare hier. „Das
Haus macht es so" trägt als Argument nur, solange es auf eine Entscheidung des Owners oder auf eine
Messung zurückgeht — nicht auf früheren Agententext. Was hier trägt, sind die Zahlen aus §1.

Der Satz beschreibt das Ziel dennoch genau. Nur liegt die Artikeladresse in `sources.url` — und
`url_hash` **IST** die Identität der Katalogzeile (UNIQUE). Aus einem Briefspiel mit 200 Artikeln
werden damit 200 Quellen, die alle denselben Namen tragen wollen.

💣 **Das Modell zwingt den Editor zu einer Wahl zwischen zwei Fehlern**, und beide sind live zu
sehen:

- **Präziser Link, unbrauchbarer Name:** 27 Zeilen „Briefspiel" für Weiden, dazu vier ganz ohne
  Titel. Der Link stimmt, die Auswahlliste ist unbenutzbar.
- **Brauchbarer Name, falscher Link:** `liebliches-feld.net` hat EINE Zeile mit **32 Objekten** —
  und ihre Adresse zeigt auf `wiki/Datei:Ponterra_detail`, eine beliebige Bildseite. Der Name
  stimmt, der Link ist für 31 der 32 Objekte falsch.

🔴 **Die Autocomplete-Mehrdeutigkeit ist deshalb kein Bedienfehler.** Sie ist die direkte Folge des
Modells: wer eine brauchbare Bezeichnung will, MUSS eine neue Zeile anlegen, weil die vorhandene
die falsche Adresse trägt.

---

## 3 · Das Modell (Owner-Entscheid 01.09.2026)

> Owner, wörtlich: *„Name des Korpus: die top-level-domain (herzogtum-weiden.net → automatisch
> ermittelt aus dem Link; wenn jemand was anderes einträgt, wird die top-level-domain zum Schlüssel
> des Namens)"* — auf Nachfrage präzisiert: **registrierbare Domain**.

```
Korpusschlüssel  = die registrierbare Domain aus sources.url      (abgeleitet, nicht gespeichert)
Korpusname       = eine Beschriftung dieses Schlüssels            (frei, änderbar)
Titel            = wie DIESE Seite heisst                          (sources.label, je Zeile)
```

🔴 **Es gibt nichts zu migrieren.** Der Schlüssel ist aus einer Spalte abgeleitet, die es längst
gibt. Alle 1.019 Zeilen mit Adresse sind **per Konstruktion bereits zugeordnet** — ein Bulk-Lauf
rechnet nichts aus, was ein `SELECT` nicht ausrechnet. Was gespeichert werden muss, ist nur das
**nicht Ableitbare**: eine Tabelle mit rund 15 Zeilen.

⭐ **Die „registrierbare Domain" löst eine Falle der ersten Fassung nebenbei.** Dort stand: *„die
Domain allein reicht als Schlüssel nicht ewig — `horaswiki.de` und `wiki.horaswiki.de` sind
dasselbe Angebot, das Register muss mehrere Domains auf eine Quelle zeigen lassen."* Mit der
registrierbaren Domain fallen beide von selbst zusammen, ebenso `wiki.punin.de` → `punin.de`. Kein
Mehrfachschlüssel, keine zweite Liste.

### 3.1 Die zwei Namen

| | steht vorn | steht im ⓘ |
|---|---|---|
| **Belegstelle** | Korpusname („Briefspiel (Weiden)") | Titel („Herzogenstadt Trallop") |
| **Werk** | Titel („Geographia Aventurica") | Korpus („f-shop.de") |

⚠️ **Der Titel-Link zeigt in beiden Fällen auf die Fundstelle** — wer auf „Briefspiel (Weiden)"
klickt, will die Seite über *dieses* Objekt, nicht die Startseite. Die Korpusadresse steht hinter
dem ⓘ, dort, wo seit dem 01.09.2026 auch Nennung und Lizenz stehen.

### 3.2 Werk oder Belegstelle — die EINE Eigenschaft, und sie ist messbar

💣 **Das ist die einzige Eigenschaft, die ein Korpus tragen MUSS.** Sie entscheidet, welcher der
beiden Namen vorn steht. Wer sie falsch setzt, dreht die Anzeige eines ganzen Korpus um.

⭐ **Sie ist ableitbar, und zwar ohne Zwischenfeld** (Titel je Zeile):

```
Werke:        f-shop 0,98 · ulisses 1,00
Belegstellen: westlande 0,10 · weiden 0,12 · kahet 0,12 · punin 0,15
```

Zwischen 0,15 und 0,98 liegt **nichts**. Der erste Entwurf nannte das „16 Entscheidungen"; es sind
15 **Bestätigungen eines Vorschlags**.

💣 **Aber bei einem NEUEN Korpus sagt das Verhältnis nichts.** Eine frische Domain hat eine Zeile,
Verhältnis 1,00 — das sieht aus wie ein Werk und ist keine Aussage. Deshalb:

🔴 **Unentschieden ist ein eigener Zustand und verhält sich wie „Werk"** — Titel vorn, also genau
das heutige Verhalten. Kein Rückschritt, keine geratene Aussage, und die offene Entscheidung steht
sichtbar in der Korpusliste. Sie wird fällig, sobald ein zweiter Titel doppelt auftaucht.

⚠️ **Sechs der 15 Domains haben genau eine Zeile.** Dort ist die Frage bis auf Weiteres gegenstandslos.

💣 **`wiki-aventurica.de` ist ein WERK-Korpus, kein Belegstellen-Korpus** — 7 Zeilen, 7 Titel,
darunter „Mutterglück" und „Kosch (Regionalspielhilfe)". Ihre Adresse ist zufällig ein Wikiartikel,
ihre Identität ist der Titel. Als Belegstellen-Korpus geführt, verlören sie ihre Namen.

### 3.3 Wem gehören Art, Lizenz, Nennung und Kanon

Die Messung beantwortet das, und die Antwort fällt **aus §3.2 heraus**:

- **Belegstellen-Korpus → dem KORPUS.** Innerhalb eines solchen sind die Werte einheitlich (Lizenz
  und Kanon durchweg gleich; die Art nur durch Defekte gestört, siehe unten). Ein Briefspiel hat
  eine Lizenz, nicht 33.
- **Werk-Korpus → der ZEILE.** Dort sind sie *echt* gemischt: f-shop trägt `abenteuer: 193`,
  `regionalspielhilfe: 192`, `sonstiges: 90`; ulisses `abenteuer: 99`, `aventurischer_bote: 54`,
  `roman: 54`. Eine Korpus-Art wäre dort schlicht falsch.

💣 **Beim Hochziehen der Art zählt die MEHRHEIT DER GETROFFENEN AUSSAGEN, nicht die Mehrheit.**
`herzogtum-weiden.net` steht auf `sonstiges: 22` gegen `briefspiel: 11` — und `sonstiges` ist im
Haus die **Nicht-Aussage** (`avesmapsNormalizeSourceType` macht aus `''` beim Anlegen `sonstiges`).
Die schlichte Mehrheit ergäbe „sonstiges" und schriebe den Defekt fest; gezählt werden nur die
echten Aussagen, dann steht es 11:0 für `briefspiel`.

⚠️ **Die Lizenz migriert gar nichts.** 1.017 von 1.019 Zeilen tragen keine (nur `garetien.de` hat
zwei mit `cc-by-nc-sa-3.0`). „Lizenz vom Korpus" ist reine Dateneingabe — acht Werte, einmal.

### 3.4 Die drei Zustände des Adressfeldes

Owner-Frage vom 01.09.2026: *„was passiert, wenn ich denselben Link reinpaste?"* — die Antwort
deckte auf, dass mein Mockup **zwei** Zustände zeigte, wo es **drei** gibt:

| | Zustand | der Editor füllt |
|---|---|---|
| 1 | **neue Domain** | alles — und legt den Korpus damit an |
| 2 | **bekannte Domain, neue Seite** | Adresse und Titel; der Rest steht |
| 3 | **bekannte Seite** | Adresse, Seiten, Abdeckung — mehr nicht |

Zustand 3 ist der einzige, in dem die Katalogfelder **gar nicht zur Eingabe gehören**. Am Code
nachgelesen (`avesmapsSourceUpsertOnDuplicateSql`), was bei bekannter Adresse mit ihnen geschieht:

| Feld | bei bekannter Adresse | Folge |
|---|---|---|
| Titel | füllt nur eine *Lücke* | der eingetippte wird **verworfen** |
| Lizenz, Nennung | füllen nur | nichts geht verloren |
| Art | nur bei ausdrücklicher Wahl | eine Vorauswahl ändert nichts |
| **offiziell** | **unbedingt überschrieben** | 💣 gilt danach **katalogweit** |
| Seiten, Abdeckung | unbedingt gesetzt | 💣 leer **löscht** am selben Objekt |

🔴 **Am selben Objekt entsteht keine zweite Zeile** — `feature_sources` hat ein UNIQUE auf
(Objektart, Objekt, Quelle), die bestehende Verknüpfung wird *aktualisiert*. Damit ist die
Seitenangabe die gefährlichere Hälfte: das Formular startet leer, und leer heisst hier „lösche".

⭐ Deshalb sind die Katalogfelder in Zustand 3 **gesperrt**, der Knopf heisst **„Verknüpfen"**, und
offen bleiben nur die drei Werte, die *hier* gelten. Wer den Katalogeintrag ändern will, geht über
das ✎ in der Liste — dort steht, wie viele Objekte die Änderung trifft.

⚠️ Zwei der sechs Regeln melden sich seit dem 01.09.2026 bereits (`linked` mit `typed_label`,
`official_changed`) — aber als Meldung **danach**. Der gesperrte Zustand ist die Antwort **davor**,
und die ist besser: was gar nicht erst einzugeben ist, muss niemand zurückerklärt bekommen. Die
Meldungen bleiben trotzdem stehen; sie sind der serverseitige Riegel hinter der Oberfläche.

---

## 4 · Der Linkcheck — Titel und Korpusname kommen aus der Seite

Owner: *„wenn man einen link pastet, kann man den titel einer seite rausparsen?"* — ja, und aus
derselben Antwort fällt der Korpusname mit ab.

### 4.1 Gemessen an den echten Seiten (01.09.2026)

| Adresse | `<h1>` → Titel | `<title>`-Zusatz → Korpus |
|---|---|---|
| …/staedte/herzogenstadt-trallop | Herzogenstadt Trallop | — |
| …/baronien/hzgl-weiden | Herzoglich Weiden | — |
| wiki.punin.de/Baronie_Taubental | Baronie Taubental | **Almada Wiki** |
| westlande.de/…?title=Apfeldorn | Apfeldorn | **AlberniaWiki** |
| de.wiki-aventurica.de/wiki/Trallop | Trallop | **Wiki Aventurica** |

🔴 **Der `<h1>` ist die bessere Quelle als der `<title>`** — letzterer trägt bei jedem Wiki einen
Seitenzusatz, der `<h1>` ist sauber.

⭐ **Und der Zusatz nennt den Korpus** — „Almada Wiki", „AlberniaWiki", „Wiki Aventurica" sind
genau die Namen, die die Editoren sonst selbst erfinden. **Ein Abruf liefert beide Hälften.**

⚠️ **Aus der Adresse allein geht es nicht.** Bei MediaWiki-Adressen wäre es machbar
(`/Baronie_Taubental` → „Baronie Taubental"), bei Slug-Adressen nicht: `hzgl-weiden` → „hzgl
weiden", `gfl-salthel` → „gfl salthel". Abkürzungen und Grossschreibung stehen nur auf der Seite.

💣 **Beides ist ein VORSCHLAG, kein gesetzter Wert.** Ein Wiki kann seinen Zusatz ändern, eine Seite
kann ohne `<h1>` auskommen. Überschreibbar bleiben beide Felder.

🔴 **Erst im Katalog nachsehen, dann erst nach draussen greifen.** Sonst wartet der Editor auf einen
fremden Server, um einen Titel zu holen, den der Katalog anschliessend verwirft (§3.4, Zeile 1) —
Wartezeit für einen Wert, der auf dem *häufigsten* Weg nie ankommt. Die Katalogabfrage ist lokal
und sofort; der Abruf ist die Ausnahme für unbekannte Adressen.

⚠️ **Fällt der Abruf aus, muss die Zeile ohne ihn benutzbar bleiben** — Titel leer, Korpusname aus
der Domain. Ein Formular, das auf einen fremden Server wartet, ist kaputt, sobald der langsam ist.

### 4.2 Der Läufer existiert bereits

`api/_internal/linkcheck/` ist ein vollständiges Teilsystem, und es geht **schon heute über genau
diese Adressen**: `avesmapsLinkCheckCollectSourceLinks` sammelt die Quell-Links für
Ort/Territorium/Region/Weg, und sein `entity_public_id` **ist die `sources.id`** — also 1:1 auf
Katalogzeilen.

⭐ **`link_status.url_hash` ist zeichengleich derselbe sha256 wie `sources.url_hash`** (beide
`hash('sha256', $url)`, ohne Normalisierung). Die zwei Tabellen lassen sich ohne neue Verdrahtung
aneinanderlegen.

✅ **Damit ist die STRATO-Frage beantwortet — die Wirte antworten dem Server.** Über den
öffentlichen `GET /api/app/link-status.php` gemessen (ohne Sitzung), 129 Belegstellen-Adressen:
**16 online mit echtem HTTP 200 vom Server** — punin.de 10 · westlande.de 2 · horaswiki.de 2 ·
herzogtum-weiden.net 1 · liebliches-feld.net 1 (zuletzt 25.07.2026). Fünf der acht Domains sind
belegt erreichbar. **Die dokumentierte STRATO-Sperre gilt Wiki Aventurica, nicht den Briefspielen.**

⚠️ **107 der 129 stehen gar nicht im Register.** Der `sync` ist überfällig — er macht allerdings
*kein* HTTP, nur Datenbank, kostet also nichts.

💣 **Der Läufer liest den Rumpf nicht.** Er schickt HEAD bzw. ein 1-Byte-Range-GET und liest den
Statuscode; der Rumpfholer `avesmapsLinkCheckFetchBody` ist bewusst **geriegelt** (Bild-Riegel,
Owner-Entscheid 01.09.2026: *„Statuscode lesen ja, Bytes holen nur auf ausdrücklichen
Knopfdruck"*). Titel und Korpusname zu füllen heisst: **ein zusätzlicher GET je Adresse** — und
diese Riegelentscheidung müsste dafür ausdrücklich um einen Fall erweitert werden. 🔧 Owner.

🚩 **Nebenbefund, beim Messen selbst kassiert:** `AVESMAPS_LINK_STATUS_MAX_HASHES = 200` verspricht
mehr, als der Server trägt. Bei 129 Hashes (8.385 Zeichen) antwortet Apache mit **414 und einer
HTML-Seite** statt des JSON-Umschlags; 120 gehen durch, die Grenze liegt bei ~8 KB, also ~124
Hashes. Heute ruft kein Client mit einer Hash-Liste an — es ist eine gestellte Falle für den
nächsten, kein laufender Fehler.

### 4.3 Der Nachlauf über den Bestand

⭐ **Die teure Hälfte ist genau die, die nicht gebraucht wird.** Die 879 Shop-Adressen (f-shop,
ulisses) tragen korrekte Werktitel — sie müssen **nie** abgerufen werden. Es bleiben:

- **129 Abrufe** für die Titel der Belegstellen,
- **8 Abrufe** für die Korpusnamen (ein `<title>`-Zusatz je Domain genügt).

Bei 600 ms Wirtsdrossel und Batches von 40 sind das rund **3–5 Minuten** in etwa zehn Schritten,
die der Client treibt — genau die Bauform, die es schon gibt.

🔴 **Geschrieben wird erst nach Bestätigung.** Der Lauf erzeugt eine **Vorschlagsliste zum
Abhaken**, in der Formensprache der Übernahme-Vorschau (AGENTS.md §11) — nicht einen stillen
Massenschreibvorgang über 129 katalogweit zitierte Zeilen.

⚠️ **Der Titel ist FÜLL-Regel, kein Überschreiben.** Wo schon ein brauchbarer Titel steht, bleibt
er; die **15 leeren** und die **100 gleichnamigen** (33+27+24+9+7) sind die eigentliche Ernte.

---

## 5 · Die Fallen

💣 **`is_official` überschreibt der Upsert UNBEDINGT.** Gehört der Kanon dem Korpus (§3.3), muss er
beim Verknüpfen aus dem Korpus kommen — sonst kippt der erste Editor, der den Haken nicht sieht,
den Kanon des ganzen Korpus. Seit dem 01.09.2026 wird das wenigstens gemeldet
(`linked.official_changed`), geheilt ist es nicht. **Das ist die Umstellung mit der grössten
Reichweite und die einzige echte Verhaltensänderung dieses Vorhabens.**

💣 **Die Auflösung darf NICHT „eine Domain, eine Quelle" heissen.** `f-shop.de` trägt 637 Zeilen
mit 623 Titeln — eine solche Regel machte daraus 2 Quellen für 879 Werke. Die Weiche ist §3.2, und
sie ist eine **Korpus-Eigenschaft**, kein Muster über Adressen.

💣 **Ein ANKER, `www.`, `http`/`https` und der Schrägstrich am Ende erzeugen je eine eigene Zeile**
(§1.2). Der Korpus ändert daran nichts — er gruppiert sie nur richtig. Eine Normalisierung des
`url_hash` wäre ein eigenes Vorhaben mit Datenwanderung und steht hier **nicht** an.

💣 **Der Korpusname ist eine Beschriftung, kein Schlüssel.** Wer ihn ändert, benennt den Korpus um —
das trifft alle seine Zeilen. Wer eine *andere* Domain meint, meint einen anderen Korpus. Diese
zwei Dinge dürfen in der Oberfläche nie gleich aussehen; deshalb steht der Schlüssel neben dem
Namen („Name des Korpus · (Korpusschlüssel: herzogtum-weiden.net) · gültig für 118 Objekte").

⚠️ **317 `os:`-Einträge warten noch** (`properties.other_source`), die
`avesmapsFeatureSourcesTakeoverOtherSource` in Katalogzeilen verwandelt, sobald ein Editor das
Objekt öffnet. Unter diesem Modell ist das **unproblematisch**: jede landet über ihre Adresse im
richtigen Korpus, statt eine weitere Zeile „Briefspiel" zu werden. In der ersten Fassung war das
noch ein Risiko.

⚠️ **Die Vorschlagsliste der Namen bleibt** — sie schlägt künftig **Korpora** vor statt Titel. Das
ist eine Umstellung von `js/ui/source-autocomplete.js` (372 Zeilen, geladen von vier Editorseiten
und `review-lore-rule.js`), keine Abschaffung: dasselbe Bauteil, eine andere Liste.

---

## 6 · Reihenfolge

1. **Der Korpus-Datensatz** (Name, Form, Art, Lizenz, Nennung, Kanon) plus der abgeleitete
   Schlüssel. Ändert noch nichts Sichtbares.
2. **Die Eingabezeile mit ihren drei Zuständen** (§3.4) samt Linkcheck. Ab hier entsteht nichts
   Falsches mehr.
3. **Die Anzeige**: Korpusname vorn bei Belegstellen, Titel im ⓘ (§3.1).
4. **Der Nachlauf über den Bestand** (§4.3) — 129 Titel füllen, mit Vorschau. **Kein
   Zusammenlegen.**

🔴 Schritte 2 und 3 sind für Besucher sichtbar und gehen deshalb **einzeln** live (AGENTS.md §9).

---

## 7 · Ablöse — was am Ende umgestellt wird

Owner-Entscheid 02.09.2026, nachdem die Frage „kann man Nicht-mehr-Gebrauchtes für die
Refactor-Routine freigeben?" auf eine Wand lief:

🔴 **Die Refactor-Routine kann konstitutionell nicht löschen.** In ihrer Anweisung steht *„Du
löschst NIE etwas."* — mit zwei Begründungen: ihr Sicherheitsriegel ist ein **Fingerabdruck**
(Einfügungen ≈ Löschungen, Differenz ≤ 20 Zeilen und ≤ 5 %), den eine Löschung per Konstruktion
bricht; und „tot" ist in diesem Bestand schwer zu beweisen (globale Funktionen, kein Build-Schritt,
Inline-Handler, dynamisch zusammengesetzte CSS-Klassen).

💣 **Ein Marker „freigegeben zum Aufräumen" wäre deshalb ein Versprechen, das niemand einlöst** —
und er liesse den Code **beaufsichtigt aussehen**, während er liegen bleibt. Dieses Projekt hat
genau das schon bezahlt: die englische Kommentarregel in AGENTS.md §8 stand monatelang als totes
Recht da, und ein Reviewer meldete danach korrekte Arbeit als Abweichung.

**Die drei Regeln für diesen Umbau:**

1. **Jede Zeile, die der Umbau ersetzt, wird im SELBEN Commit ersetzt, der ihren Nachfolger
   bringt.** Kein „später aufräumen".
2. Was sich nicht im selben Atemzug umstellen lässt (Datenreste, Altpfade mit fremden Aufrufern),
   bekommt **einen Eintrag in `liste.md` der Refactor-Routine unter `## Für den Owner`** — Datei,
   Zeile, warum tot, und **womit belegt**. Dieselbe Form wie ihre eigenen Totfunde; sie liest den
   Abschnitt bei jedem Lauf, er heisst wörtlich *„Funde, die die Routine nicht selbst anfassen
   darf"*.
3. **Kein Marker-Kommentar im Code.**

**Was dieser Umbau anfasst, vorab sortiert:**

| | |
|---|---|
| **umstellen** | `is_official = VALUES(is_official)` → aus dem Korpus (§5). Eine Verhaltensänderung — genau das, was die Routine nie anfassen darf. |
| **umstellen** | `js/ui/source-autocomplete.js` — schlägt Korpora vor statt Titel. Dasselbe Bauteil, andere Liste. |
| **bleibt** | `avesmapsFeatureSourceLinkedReport` / `featureSourceLinkedMessage` — der serverseitige Riegel hinter dem dritten Zustand. Wer sie löscht, nimmt den Gürtel und behält die Hosenträger. |
| **wird tot** | heute nicht seriös benennbar. Die Liste entsteht **am Ende**, aus dem gebauten Zustand — nicht aus einer Vermutung davor. |

⚠️ **Der Korpus ist additiv.** Er ist ein abgeleiteter Schlüssel über eine vorhandene Spalte und
ersetzt kein Teilsystem; die erwartete tote Fläche ist entsprechend klein.

---

## 8 · Offene Fragen für den Owner

🔧 **Gilt die Erlaubnis dem KORPUS oder der SEITE?** Owner, 01.09.2026: *„Namensnennung ist, wenn
ein bestimmter Typ im Wiki uns was genehmigt hat."* 🔴 Das ist `permission`, nicht `attribution` —
der Kanon-Etikett-Entwurf vom 27.08.2026 (§4.4) trennt beides bereits:

| Spalte | Frage | Beispiel |
|---|---|---|
| `license` | Was gilt rechtlich? | CC BY-NC-SA 3.0 |
| `attribution` | **Wen muss man nennen?** | VolkoV / garetien.de |
| `permission` *(nie gebaut)* | **Wer hat es erlaubt, und wann?** | Freundeskreis …, 12.08.2026 |

Die dritte Spalte gibt es bis heute nicht — deshalb trägt `attribution` beides, und das sieht man
den drei Livewerten an: **„herzogtum-weiden.net"** (eine Domain), **„Jens: Meister"** (eine Person),
**„VolkoV / garetien.de"** (Person und Domain). Drei Werte, drei Bedeutungen. Klingt die Erlaubnis
nach dem Korpus (eine Person gibt ihr Briefspiel frei), bleibt sie an ihm und dieser Entwurf trägt
unverändert; gilt sie je Artikel, gehört sie an die Verknüpfung. **Gemessen werden kann es nicht** —
es gibt nur drei Werte.

🔧 **Wie heissen die Korpora?** Vorschlag aus dem Bestand — *Briefspiel (Weiden)* · *AlmadaWiki* ·
*Albernisches Briefspiel* · *Briefspiel Káhet Ni Kemi* · *Briefspiel Liebliches Feld*. Bei
Ká­het/Kâ­het steht es **9:7**; hier entscheidest du, nicht die Mehrheit.

🔧 **Darf der Linkcheck für diesen Fall den Rumpf holen?** (§4.2) Der Bild-Riegel steht bewusst da;
die Titelübernahme braucht eine ausdrückliche Ausnahme.

🔧 **Bleibt der freie Weg für unbekannte Domains offen?** Der Entwurf sagt ja — sonst kann niemand
ein neues Briefspiel eintragen.

⚠️ Und eine Frage, die sich **erledigt** hat: *„Register als Tabelle oder Konstante?"* Weder. Der
Schlüssel ist abgeleitet; gespeichert wird nur die Beschriftung samt der vier Eigenschaften — rund
15 Zeilen.
