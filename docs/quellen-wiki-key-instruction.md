# Quellen bekommen einen Wiki-Key

> **Status:** Beschreibung + Vorgehen, noch nicht gebaut. Owner-Auftrag 2026-07-18.
> Verwandt: `docs/quellen-system-design.md`, `docs/wiki-publikations-quellen-design.md`,
> `docs/abenteuer-feature-design.md`.

## 1. Das Problem

Eine Quelle wird heute über ihre **URL** identifiziert (`sources.url_hash`, UNIQUE). Das war praktisch,
solange eine Quelle nur ein Link war. Es ist falsch, sobald eine Quelle ein **Werk** ist, über das wir
mehr wissen als seine Adresse.

Konkret entstehen daraus drei Schäden:

**Dieselbe Publikation zerfällt in mehrere Quellen.** Der F-Shop-Link, die Wiki-Seite und ein
Verlagslink derselben Ausgabe sind drei verschiedene `url_hash`-Werte, also drei Zeilen ohne Verbindung.

**Die Datenlage, gemessen** (`GET /api/app/source-coverage.php`, 2026-07-19, gegen die Live-DB):

| | |
|---|---|
| Quellen gesamt | **1132** |
| davon mit Wiki-Adresse | **13** (1,1 %) |
| davon mit F-Shop-Adresse | 539 · Ulisses 229 |
| als `source_type='abenteuer'` getaggt | **308** |
| Quellen, die ein Abenteuer treffen (URL normalisiert) | **2** |
| Abenteuer mit `wiki_url` | **921 von 921** (100 %) |
| bestehende Ort↔Quelle-Zuordnungen (`feature_sources`) | **55 353**, davon 12 an Wiki-Quellen |

Diese Tabelle ist der ganze Fall. **Die Gegenstelle ist vollständig wiki-identifiziert — jedes einzelne
der 921 Abenteuer hat seine Wiki-Seite.** Auf der Quellenseite haben 13 von 1132 eine, und ganze 2 finden
darüber zusammen. Es stehen also 308 als Abenteuer erkannte Quellen 921 Abenteuern gegenüber, und
verbunden sind zwei.

⚠️ **Und 55 353 Zuordnungen hängen daran.** Das ist die Menge, die ein Umbau bewegt. Die Invarianten in
Abschnitt 4 sind deshalb keine Vorsicht, sondern die Aufgabe selbst.

> **Korrektur:** Eine frühere Fassung nannte 842 Quellen und 19 Wiki-Adressen. Diese Zahlen stammten aus
> dem **Client-Payload**, der nur die Quellen gerade geladener Features mitführt — eine Teilmenge. Wer
> Datenlagen misst, misst die Datenbank, nicht das, was der Browser zufällig dabeihat.

**Die Quelle weiß nicht, was sie ist.** `sources` kennt `url`, `url_hash`, `label`, `source_type`,
`is_official` — mehr nicht. Ob hinter einer Quelle ein Abenteuer aus unserem Katalog steckt, eine Karte
oder ein Regionalband, ist der Zeile nicht anzusehen.

**Die Wiki-Verbindung existiert, kommt aber nicht an.** Der Publikations-Sync arbeitet bereits
vollständig über Wiki-Keys: `wiki_publication_catalog` führt jede Publikation unter ihrem `wiki_key`,
`wiki_entity_publication` verknüpft `entity_wiki_key` ↔ `publication_wiki_key`. **Beim Übertragen in die
Live-Tabellen fällt der Key weg**, weil `sources` keine Spalte dafür hat. Die Information wird erzeugt
und weggeworfen.

### Der Fall, an dem es sichtbar wurde

Der Ort **„Der Schläfer"** trägt die Quelle **„Blutmond I"**, zeigt aber „Abenteuer in … (0)".

- Das Abenteuer heißt im Katalog **„Die Feuer von Gruuzash"**. „Blutmond" kommt in keinem der 921
  Titel vor — es ist der **Reihenname**, nicht der Bandtitel. Im Wiki ist es dieselbe Seite.
- Das Abenteuer nennt als Orte nur **Territorien** („Markgrafschaft Greifenfurt", „Herzogtum Weiden").
  „Der Schläfer" steht in **keinem** der 921 Abenteuer als Ort.
- Die handgepflegte Quelle **weiß also mehr als der Wiki-Sync**: Sie kennt den konkreten Ort, die
  `{{Infobox Produkt}}` kennt nur die Landschaft.

⚠️ **Die vorhandene URL genügt nicht als Brücke.** Naheliegender Gedanke: `sources.url` gegen
`adventure.wiki_url` vergleichen, fertig — keine neue Spalte nötig. Gemessen trifft das **2 von 1132**
Quellen. Die Wiki-Adresse ist auf der Quellenseite schlicht nicht vorhanden; sie muss erst dorthin
kommen. Genau deshalb ist der Wiki-Key eine Spalte und keine Abfrage.

⚠️ **Ein Abgleich über Namen oder Shop-IDs ist ebenfalls keine Lösung** — das ist gemessen, nicht vermutet:
Über den Titel im Shop-URL-Slug lassen sich **3 von 539** Quellen einem Abenteuer zuordnen (1 %). Der
`fshop_code` des Abenteuers (`US26154`) hat mit der Shop-ID in der URL (`4953`) nichts zu tun. Die drei
Treffer sind ausgerechnet die schönen (`Blutmond I → Die Feuer von Gruuzash`, `Gekreuzte Klingen`,
`Finsterwacht`) und verführen dazu, den Weg für tragfähig zu halten. Er ist es nicht.

## 2. Das Ziel

**Eine Quelle darf einen Wiki-Key haben. Hat sie einen, kommen ihre Inhalte aus dem Wiki.**

Daraus folgt:

1. **Identität.** Wo ein Wiki-Key existiert, ist *er* die Identität der Quelle — nicht die URL. Zwei
   Links auf dieselbe Wiki-Seite sind eine Quelle.
2. **Inhalte.** Label, Typ, Offiziell-Status und die Verknüpfung zu Abenteuer/Karte kommen dann aus dem
   Wiki, nicht aus dem, was jemand ins Formular getippt hat.
3. **Ortszuordnung.** Fügt ein Editor einem Ort eine Quelle hinzu und ist diese Quelle ein **Abenteuer**,
   erscheint der Ort automatisch unter „Abenteuer in …" (Rolle *spielt hier*, also Spoiler). Ist sie eine
   **Karte**, erscheint der Ort als Fundort im Karteneditor.
4. **Ohne Wiki-Key bleibt alles wie es ist.** Eine reine Shop- oder Fremdquelle behält URL-Identität und
   verhält sich unverändert.

Das Mapping läuft **ausdrücklich über das Wiki, nicht über Shopseiten** (Owner). Für Namensvarianten wie
Reihe gegen Band existiert bereits `wiki_redirect_alias`.

## 3. Was es schon gibt

Der Umbau erfindet wenig; er verbindet Vorhandenes:

| Vorhanden | Wofür |
|---|---|
| `wiki_publication_catalog` (`wiki_key` = PK) | eine Zeile je Publikations-Wikiseite |
| `wiki_entity_publication` (`entity_wiki_key`, `publication_wiki_key`) | Ort ↔ Publikation, rein über Wiki-Keys |
| `wiki_redirect_alias` | löst Namensvarianten auf (Reihe ↔ Band) |
| `adventure.wiki_url` / Karten-`wiki_key` | die Gegenstelle, an die gemappt wird |
| `feature_sources.origin` (`wiki_publication` \| `manual` \| `community`) | trennt Sync-Besitz von Handarbeit |
| `sync_publications` / `sync_adventures` | override-sichere Reconcile-Aktionen des Owners |

**Was fehlt, ist eine Spalte und ihre Pflege** — nicht ein System.

## 4. Invarianten: was dieser Umbau NIE tun darf

Diese Liste ist der eigentliche Inhalt der Aufgabe. Jeder Schritt unten wird an ihr gemessen.

1. **Kein bestehendes Mapping geht verloren.** Jede heutige Zeile in `feature_sources` muss nach der
   Migration denselben Ort mit demselben Werk verbinden — auch wenn die Quelle darunter eine andere
   `sources.id` bekommt.
2. **Handarbeit schlägt Sync, immer.** `origin='manual'` und `'community'` werden nie vom Sync
   überschrieben oder gelöscht; `status='suppressed'` bleibt unterdrückt. Das ist die geltende Regel des
   Publikations- und Abenteuer-Syncs und gilt hier unverändert.
3. **Kein Rateschritt.** Zusammengeführt wird nur bei *belegter* Gleichheit (gleicher Wiki-Key, ggf. über
   `wiki_redirect_alias`). Titelähnlichkeit, Shop-IDs und Slug-Vergleiche sind ausgeschlossen — siehe die
   1-%-Messung oben.
4. **Umkehrbar.** Vor jeder zusammenführenden Schreiboperation existiert eine Zuordnungstabelle
   alt→neu, aus der sich der Zustand rekonstruieren lässt. Ohne sie wird nicht zusammengeführt.
5. **Die öffentliche Seite bleibt ruhig.** Ein Leser darf während der Migration keine verschwundenen
   Quellen sehen. Zusammenführen heißt: erst neue Verbindung schreiben, dann alte lösen — nie umgekehrt.
6. **Kein Massenlauf gegen fremde Server.** Der Dump ist die Grundlage (`wiki-aventurica-dump-policy`);
   HTML-Crawls sind ausgeschlossen, und der Neulauf hält sich an die bestehende Schrittsteuerung.

## 5. Vorgehen

Sechs Schritte, jeder für sich abschließbar und überprüfbar. **Erst Schritt 5 verändert bestehende
Zuordnungen** — davor ist alles additiv und damit gefahrlos.

### Schritt 1 — Spalte anlegen, nichts weiter

`sources.wiki_key VARCHAR(190) NULL`, dazu ein Index. NULL heißt „kein Wiki-Bezug bekannt" und ist ein
gültiger Dauerzustand. Kein Verhalten ändert sich. Die bestehende `uq_sources_url_hash` bleibt zunächst
unangetastet.

**Prüfung:** Bestand unverändert, alle Quellen weiterhin sichtbar.

### Schritt 2 — Den Key beim Sync mitschreiben

Der Publikations-Reconcile trägt den `wiki_key` aus `wiki_publication_catalog` in die Zeile ein, die er
ohnehin anlegt oder aktualisiert. Nur für `origin='wiki_publication'`.

**Prüfung:** Nach einem Reconcile tragen die vom Sync verwalteten Quellen einen Key; alles andere bleibt
NULL. Zählen: wie viele Quellen haben jetzt einen Key?

### Schritt 3 — Dump neu holen

Der bestehende Dump kennt die Publikationsseiten bereits; ein neuer Lauf stellt sicher, dass Katalog und
Aliase aktuell sind, bevor gemappt wird. Über die vorhandene Schrittsteuerung, kein Sonderweg.

**Prüfung:** `wiki_publication_catalog` und `wiki_redirect_alias` frisch; Laufprotokoll ohne Abbrüche.

### Schritt 4 — Zuordnung berechnen, aber NICHT anwenden

Ein Bericht (read-only) beantwortet für jede bestehende Quelle:

- Gibt es einen Wiki-Key dafür? Woher (direkt, über Alias, gar nicht)?
- Fallen dadurch mehrere Quellen zu einer zusammen? Welche `feature_sources`-Zeilen hängen daran?
- Entstehen Konflikte — etwa zwei Quellen mit unterschiedlichem `source_type`, die denselben Key
  bekommen sollen?

Dieser Bericht ist das Material für die Owner-Entscheidung. **Hier wird nichts geschrieben.**

**Prüfung:** Der Bericht nennt Zahlen für: mit Key / ohne Key / Zusammenführungen / Konflikte — und listet
die Konfliktfälle einzeln auf.

> **Das Werkzeug dafür existiert seit 2026-07-19:** `POST /api/edit/map/source-merge.php`
> `{action, from_source_id, into_source_id}`. `action:"report"` (Berechtigung `edit`) rechnet den
> Fall durch und **schreibt nichts** — das ist das Material für Schritt 4. `action:"apply"`
> (Berechtigung `admin`) führt zusammen. Beide Ids kommen vom Aufrufer; nichts wird über Titel oder
> Slug erraten (Invariante 3). Der Ist-Zustand landet vor dem Trennen in `source_merge_log`
> (Invariante 4), die neue Verknüpfung wird vor dem Lösen der alten geschrieben (Invariante 5).
>
> Der Lauf fasst **zwei Bestände** an, weil eine Quelle einen Ort auf zwei Wegen erreicht: die
> `feature_sources`-Verknüpfungen **und** die Orte, die dieselbe URL noch im Altfeld
> `properties.other_source` tragen (die haben gar keine Verknüpfungszeile). Letztere werden zuerst
> über die vorhandene atomare Übernahme eingesammelt. Wer nur die Verknüpfungen zählt, übersieht die
> Mehrheit — beim ersten echten Fall waren es 4 gegenüber 33.

### Schritt 5 — Zusammenführen (der heikle Schritt)

Erst nach Sichtung des Berichts. Für jede Gruppe von Quellen mit gleichem Wiki-Key:

1. Eine Zeile wird die führende (die mit Wiki-URL, sonst die älteste).
2. Alle `feature_sources`-Zeilen der übrigen werden auf die führende **umgehängt** — vorher schreiben,
   nachher lösen (Invariante 5).
3. Dubletten, die dabei entstehen (derselbe Ort war über zwei Quellen mit demselben Werk verbunden),
   werden zu einer Zeile verschmolzen; dabei gewinnt der stärkere `origin` (`manual` > `community` >
   `wiki_publication`) und ein `suppressed`-Status bleibt erhalten.
4. Die alten Zeilen werden **nicht gelöscht**, sondern als abgelöst markiert, mit Verweis auf die
   führende — die Rückabwicklung aus Invariante 4.

**Prüfung:** Zahl der Ort↔Werk-Verbindungen vor und nach dem Lauf ist identisch (Verschmelzungen
eingerechnet). Stichprobe „Der Schläfer": trägt weiterhin genau eine Quelle, jetzt mit Wiki-Key.

### Schritt 6 — Die Wirkung freischalten

Jetzt erst darf ein Wiki-Key etwas auslösen:

- Quelle mit Key, der ein **Abenteuer** ist → Ort erscheint unter „Abenteuer in …", Rolle *spielt hier*,
  `origin='manual'` (damit sync-sicher, siehe Invariante 2).
- Quelle mit Key, der eine **Karte** ist → Ort erscheint als Fundort.
- Im Ort-Editor: Quelle suchen und hinzufügen; die Zuordnung entsteht daraus automatisch.

### Beide Richtungen, ein Ergebnis

Die Verbindung entsteht **von beiden Seiten** (Owner 2026-07-18):

| Editor tut … | … und es entsteht zusätzlich |
|---|---|
| fügt einem Ort eine **Quelle** hinzu (Ort-Editor) | die Abenteuer- bzw. Kartenzuordnung |
| fügt einem Ort ein **Abenteuer** hinzu („Abenteuer in …" / Abenteuer-Editor) | die Quelle am Ort |
| trägt einen Ort in eine **Karte** ein (Karteneditor) | die Quelle am Ort |

Gemeint ist ein **Paar**, nicht zwei Einträge: Ort ↔ Werk, aus zwei Türen erreichbar. Wer beide Türen
benutzt, erzeugt trotzdem nur eine Verbindung — die zweite Eingabe findet die vorhandene und ändert
nichts. Ohne diese Regel entstünden Dubletten genau bei den gewissenhaften Editoren, die beides pflegen.

Die Quelle, die dabei aus einem Abenteuer entsteht, trägt dessen **Wiki-Key und Wiki-URL** — nicht den
Shoplink. Genau das ist die Lücke aus Abschnitt 1, nur von der anderen Seite geschlossen: Was über diesen
Weg entsteht, ist von Anfang an wiki-identifiziert.

### Dritte Tür: „Änderung vorschlagen" (Community)

Auch das Meldeformular bietet bei der Quellenangabe eine **Vorauswahl aus den vorhandenen Abenteuern**
(und Karten) an, statt nur ein freies Feld (Owner 2026-07-18). Das ist die wirksamste Stelle überhaupt:
Ein Vorschlag, der ein Werk aus unserem Katalog nennt, kommt **schon wiki-identifiziert** herein — statt
als getippter Titel oder Shoplink, den später niemand mehr zuordnen kann. Genau so ist „Blutmond I"
seinerzeit entstanden.

⚠️ **Hier greift die Zuordnung NICHT sofort.** Ein Community-Vorschlag ist ein Vorschlag: Er trägt
`origin='community'` und läuft über die bestehende Review, wie jede andere Meldung auch. Das „sofort" aus
dem nächsten Absatz gilt für **Editoren**, die eine Berechtigung haben — nicht für anonyme Meldungen.
Wer das verwechselt, macht aus einem Melde- ein Schreibrecht.

Was der Vorschlag mitbringen soll, ist deshalb nicht die fertige Verbindung, sondern der **Wiki-Key des
gemeinten Werks**. Der Editor in der Review bestätigt dann nur noch — und muss nicht raten, welches
Abenteuer mit „Blutmond I" gemeint war.

Freitext bleibt trotzdem möglich: Ein Werk, das wir nicht kennen, muss meldbar bleiben. Es entsteht dann
wie bisher eine Quelle ohne Wiki-Key (Abschnitt 2, Punkt 4).

**Die Zuordnung greift SOFORT** (Owner 2026-07-18) — kein Bestätigungsschritt, keine Warteschlange. Der
Editor sieht unmittelbar, was seine Eingabe bewirkt hat, und das ist der Sinn der Sache.

Daraus folgt eine Pflicht, die sonst niemandem auffiele: **Der Rückweg muss genauso unmittelbar sein —
und zwar durch dieselbe Tür, durch die es hereinkam.** Entfernt ein Editor die Quelle, verschwindet die
daraus entstandene Ortszuordnung mit ihr; entfernt er den Ort aus dem Abenteuer, verschwindet die daraus
entstandene Quelle. Sonst hinterlässt jeder Irrtum eine Hälfte, die niemand mehr dem Ort ansieht und die
kein späterer Sync aufräumt — sie ist ja `origin='manual'`. Eine sofort wirksame Aktion ohne ebenso
sofortige Rücknahme wäre eine Falle.

⚠️ Was der Rückweg **nicht** tun darf: eine Verbindung mitnehmen, die schon vorher bestand. Wurde ein Ort
längst von Hand in ein Abenteuer eingetragen und jemand fügt später dieselbe Quelle hinzu und entfernt sie
wieder, muss die ältere Eintragung stehen bleiben. Es zählt, was diese Eingabe erzeugt hat — nicht, was
zufällig dasselbe Paar beschreibt.

**Prüfung:** „Der Schläfer" zeigt „Die Feuer von Gruuzash" als *spielt hier*. Ein anschließender
`sync_adventures` verändert diese Zeile nicht.

## 5a. Vorgezogen: bestehende Quellen auswählen statt neue anlegen

**Owner 2026-07-19.** An **jedem** Formular, das Quellen aufnimmt, soll man eine bereits vorhandene
Quelle referenzieren können — per Autovervollständigung, statt sie erneut einzutippen. Betrifft
mindestens: Siedlungseditor (Eigenschaften & Overrides), „Siedlung bearbeiten", „Änderung vorschlagen" —
und weitere Stellen, die vor dem Bau zu sammeln sind.

**Bekannte Formulare** (Stand 2026-07-19, Owner): Siedlungseditor (Eigenschaften & Overrides),
„Siedlung bearbeiten", „Änderung vorschlagen", **Abenteuer-Editor**, **Karteneditor**.

⚠️ Die letzten beiden sind ein Sonderfall, der nicht übersehen werden darf: Dort ist das Werk **selbst**
der Gegenstand. Eine Quelle, die man einem Abenteuer zuweist, ist etwas anderes als das Abenteuer — sie
belegt es (Rezension, Erwähnung, Begleitband). Die Auswahl darf dort also nicht dazu verleiten, ein
Abenteuer mit sich selbst zu verknüpfen; und wenn die gewählte Quelle das eigene Werk IST, gehört sie
nicht als Beleg hinzugefügt, sondern ist bereits die Identität der Zeile (Wiki-Key, Abschnitt 2).

Verhalten:

- Tippen sucht in den vorhandenen Quellen. Treffer → **direkte Zuweisung** zur bestehenden Quelle.
- Kein Treffer → neue Quelle anlegen, genau wie heute. Der bisherige Weg bleibt vollständig erhalten.
- **Sichtbar machen, welcher Fall eintrat.** Das Formular sagt, dass es eine bestehende Quelle gefunden
  und verwendet hat — sonst weiß der Editor nie, ob er gerade referenziert oder eine Dublette erzeugt.

**Gemessene Inventur (2026-07-19).** Die offene Frage aus Abschnitt 6 („wo überall gibt es
Quellenformulare?") ist damit beantwortet: Es sind **acht** Eingabestellen in **drei technisch getrennten
Systemen**, und **keine einzige** hat heute eine Vorschlagsliste. Dedupliziert wird ausschließlich
serverseitig über `url_hash`.

| System | schreibt wohin | Formulare | jetzt? |
|---|---|---|---|
| Mehrquellen-Widget (`js/review/review-feature-sources.js`) | echter Katalog | „Siedlung bearbeiten", Siedlungseditor-Panel | **ja** |
| Community `sources_json` | Katalog nach Review | „Änderung vorschlagen", **Kartenvorschlag** | **ja** |
| Altfeld `properties.other_source` | einzelnes URL+Label im Feature-JSON | Weg-Editor, Region-Label-Editor, Herrschaftsgebiet-Dialog, Territorien-Editor | nein |
| *kein Quellenfeld vorhanden* | — | **Abenteuer-Editor, Karteneditor** | nein |

Drei Korrekturen an der Formularliste oben:

1. **Der Kartenvorschlag fehlte.** Er ist ein öffentliches Formular mit eigenem Quellenfeld und geht
   durch denselben Report-Endpunkt — er kommt dazu, sonst bleibt ausgerechnet die Stelle uneinheitlich,
   an der Fremde Quellen eintragen.
2. **Abenteuer-Editor und Karteneditor haben heute gar kein Quellenfeld.** Das dortige „offiziell"
   (`html/adventure-editor.html:647`, `html/citymap-editor.html:883`) ist eine Eigenschaft *des Werks*
   („Offizielles Produkt"), keine Katalogquelle. Der Sonderfall oben ist damit nicht nur eine
   Verwechslungsgefahr — dort muss das Feld erst **gebaut** werden, mitsamt der Regel, dass ein Werk
   nicht sein eigener Beleg sein kann. Eigener Bauabschnitt.
3. **Vier Editoren schreiben noch ins Altfeld** und kennen den Katalog nicht (Weg, Region-Label,
   Herrschaftsgebiet, Territorien-Editor). Vorschläge dort hießen: Katalogeinträge in ein Feld anbieten,
   das keinen Katalogeintrag erzeugt. Sie brauchen zuerst das Widget — die nie beendete Phase 2/3 aus
   `docs/quellen-system-2-editor-design.md`.

⚠️ **Die wichtigste Stelle sind die öffentlichen Formulare**, nicht die Editoren: dort ist nur der
**Name** Pflicht, die URL optional (`js/review/review-locations.js:93`). Eine gemeldete Quelle ohne Link
kann der Server gar nicht deduplizieren — er vergleicht nur `url_hash` — und wird garantiert zur neuen
Zeile. Genau so ist „Blutmond I" entstanden.

**Gebaut wird jetzt:** der read-only Endpunkt `GET /api/app/source-search.php` (den gibt es nicht,
`api/app/feature-sources.php` liest nur die Quellen *eines* Elements) plus eine geteilte Vorschlagsliste
am Quellenname-Feld, in den **vier** Formularen der ersten beiden Tabellenzeilen.

**Das steht bewusst VOR den Schritten 1–6 und ist von ihnen unabhängig.** Es braucht keinen Wiki-Key:
Gesucht wird im Bestand, wie er ist. Der Nutzen ist trotzdem sofort da, und er wirkt in dieselbe
Richtung — jede nicht neu angelegte Dublette ist eine, die Schritt 5 später nicht zusammenführen muss.
Sobald der Wiki-Key existiert, wird aus derselben Auswahl zusätzlich die Abenteuer-/Kartenzuordnung
(Schritt 6); die Oberfläche ändert sich dann nicht mehr.

⚠️ **Kein Widerspruch zum Rest, aber eine Reihenfolge-Korrektur:** Die Instruction sah die Auswahl nur im
Ort-Editor und erst in Schritt 6 vor. Beides war zu eng.

## 6. Entschieden vor dem Bau (2026-07-19)

Die offenen Punkte sind geklärt. Was offen **bleibt**, steht am Ende dieses Abschnitts.

**Konflikte beim Zusammenführen — das Wiki gewinnt, aber nur über das Werk.** Im Dokument steckte ein
Widerspruch: Invariante 2 sagt „Handarbeit schlägt Sync, immer", Abschnitt 2.2 sagt, Label/Typ/Offiziell
kommen aus dem Wiki. Beide gelten — sie reden über verschiedene Dinge:

| Worüber | Wer gewinnt |
|---|---|
| **Was das Werk ist** — `label`, `source_type`, `is_official` | das **Wiki**, wo ein Wiki-Key die Identität belegt |
| **Dass dieser Ort zu diesem Werk gehört** — die `feature_sources`-Zeile, ihr `origin`, ein `suppressed` | **immer** die Handarbeit, unverändert |

Invariante 2 schützt das Urteil eines Menschen über einen *Ort*. Sie schützt keinen Tippfehler im
Werktyp. Jede Überschreibung eines von Hand gesetzten Werk-Feldes wird im Schritt-4-Bericht einzeln
aufgeführt und ist über die alt→neu-Tabelle umkehrbar (Invariante 4). **Keine Owner-Sichtung je Fall** —
das blockierte den Lauf bei 1132 Quellen, ohne die Entscheidung besser zu machen.

**~~Sofort oder bestätigt?~~ Sofort** (Owner 2026-07-18) — samt der Pflicht, dass das Entfernen der
Quelle die Zuordnung im selben Zug mitnimmt (Schritt 6).

**Die 539 F-Shop-Quellen bleiben URL-identifiziert.** Dauerhaft und rechtmäßig: Abschnitt 2.4 sagt das
bereits, `NULL` ist ein gültiger Dauerzustand (Schritt 1). Kein Feldzug, ihnen Wiki-Seiten zu beschaffen
— das wäre genau der Rateschritt, den Invariante 3 verbietet (gemessen 1 % Trefferquote). Die Zahl
schrumpft von allein, sobald der Publikations-Sync Keys mitschreibt.

**`uq_sources_url_hash` bleibt und bekommt Gesellschaft.** Nicht ersetzt, sondern ergänzt um
`UNIQUE KEY uq_sources_wiki_key (wiki_key)` — MySQL erlaubt in einem UNIQUE-Index beliebig viele `NULL`.
Damit sind die beiden Identitäten nicht „zweigleisig", sondern trennscharf: **mit Key gilt der Key, ohne
Key die URL.** Der Index ist zugleich die Sperre, die verhindert, dass die Dubletten nach Schritt 5 neu
wachsen. ⚠️ Er kann erst **nach** Schritt 5 gesetzt werden — vorher gibt es die Dubletten ja noch.

**Wo überall gibt es Quellenformulare?** Beantwortet: die gemessene Inventur steht in Abschnitt 5a.
Acht Stellen in drei Systemen; vier bekommen jetzt die Autovervollständigung.

### Bleibt offen

- **📌 TODO (Owner 2026-07-19, NICHT Teil dieses Umbaus):** Territorien bekommen ihre Quellen
  **automatisch**. Ob das so bleiben soll — oder ob man dort auch von Hand Quellen hinzufügen können
  soll — ist eine eigene Frage für später. Beim Zählen und Zusammenführen nicht als Fehler werten: Diese
  Quellen sind gewollt entstanden.
- **Abenteuer-Editor und Karteneditor brauchen zuerst ein Quellenfeld** (Abschnitt 5a, Korrektur 2) —
  eigener Bauabschnitt, samt der Regel, dass ein Werk nicht sein eigener Beleg sein kann.
- **Die vier Altfeld-Editoren brauchen zuerst das Mehrquellen-Widget** (Phase 2/3 aus
  `docs/quellen-system-2-editor-design.md`), bevor eine Vorschlagsliste dort Sinn ergibt.
