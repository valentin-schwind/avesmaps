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
Verlagslink derselben Ausgabe sind drei verschiedene `url_hash`-Werte, also drei Zeilen ohne
Verbindung. Gemessen (2026-07-18, live): 842 eindeutige Quellen, davon **539 mit F-Shop-Adresse und nur
19 mit Wiki-Adresse**.

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

⚠️ **Ein Abgleich über Namen oder Shop-IDs ist keine Lösung** — das ist gemessen, nicht vermutet:
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

## 6. Vor dem Bau zu klären

- **Wer entscheidet bei Konflikten?** Wenn zwei zusammenzuführende Quellen unterschiedliche
  `source_type` oder `is_official` tragen — automatisch nach Regel, oder Owner-Sichtung je Fall?
- ~~Sofort oder bestätigt?~~ **Entschieden (Owner 2026-07-18): sofort.** Siehe Schritt 6 — samt der
  daraus folgenden Pflicht, dass das Entfernen der Quelle die Zuordnung im selben Zug mitnimmt.
- **Was passiert mit den 539 F-Shop-Quellen ohne Wiki-Entsprechung?** Bleiben sie dauerhaft
  URL-identifiziert — oder sollen sie langfristig eine Wiki-Seite bekommen?
- **Wird `uq_sources_url_hash` irgendwann ersetzt?** Solange beide Identitäten nebeneinander existieren,
  ist die Tabelle zweigleisig. Das ist tragbar, sollte aber eine bewusste Entscheidung sein.
