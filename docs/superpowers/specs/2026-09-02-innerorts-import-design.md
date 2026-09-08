# Innerorts einfügen — ein Objekt gehört zu einer Stadt, nicht auf die Karte

**Stand:** 02.09.2026 · **Mockup:** `docs/innerorts-import-mockup.html`
**Anlass:** Owner, wörtlich: „ob wir gebäude, die innerorts in einer stadt liegen, ebenso falten
können wie wir das jetzt tun … dinge, die in die kategorie ‚gebäude' fallen, nicht räumlich
importieren und sie als innerorts taggen können, sodass sie bei uns gelistet aber nicht gleich auf
der karte platziert werden müssen" — und zur Bedienung: „ich hole und rechne und der importer sieht
‚ah das ist ein objekt, das könnte innerorts liegen' und bietet neben dem Button ‚Neu einfügen' die
alternative ein ‚Innerorts einfügen (Punin)'."

---

## 1 · Was es schon gibt

Avesmaps kennt das Innerorts-Objekt seit dem 27.07.2026, aber **nur aus Wiki Aventurica**.

- **Der Begriff** steht in `api/_internal/wiki/place-scope.php`: drei Werte, `inside` · `outside` ·
  `ambiguous`. Das Signal ist die Standortkette der Infobox (`|Standort= [[Gareth]]:
  [[Arenaviertel]]`) — nennt ein Glied eine Siedlung, **die wir schon auf der Karte haben**, liegt
  das Objekt darin. 🔴 Ein Nachschlagen gegen echte Daten, keine Namensregel: über Titel geht es
  nicht, „X von \<Stadt\>" trifft rund 2100 Artikel, überwiegend Personen und Belagerungen.
- **Die Anzeige** ist die Infobox-Zeile „N besondere Stätten verzeichnet"
  (`js/map-features/map-features-settlement-places.js`) — nach Art gruppiert, Gruppen klappen ab 25
  zu.
- **Die Liste** ist `in_settlement_places` in der Kartennutzlast.

💣 **Und die ist ABGELEITET, nicht gespeichert.** `avesmapsFetchInSettlementSearchRows`
(`api/_internal/app/in-settlement-search.php`) liest bei jedem Kartenabruf `wiki_sync_pages.standort`
(Bauwerke), `wiki_path_staging.lage_raw` (Wege) und die Sitze aus `organisation-sync.php`. Es gibt
**keine Tabelle** „Objekt ohne Kartenposition, gehört zu Stadt X" — es gibt nur drei Ableitungen aus
der Wiki-Aventurica-Registry.

Live gemessen 02.09.2026 aus der Kartennutzlast:

| | |
|---|---|
| Einträge in `in_settlement_places` | **3561** |
| verteilt auf | **383 Städte** |
| Median je Stadt · p90 · Maximum | 2 · 21 · **Gareth 383** |
| Städte mit genau einem Eintrag | 150 |
| verschiedene Arten | 383 (Tempel 593, Gasthaus 156, Taverne 127, Festung 95 …) |

---

## 2 · Das Kriterium — drei Kandidaten sind gemessen ausgeschieden

Die eigentliche Frage des Owners war: **welches Kriterium wenden wir an?** Vier Kandidaten, alle am
Livebestand geprüft.

### (a) „Keine Koordinate" — NEIN

Der Export markiert 359 Zeilen mit `2000000 2000000` („noch nicht auf der Karte"), und
`avesmapsGaretienUeberspringGrund` überspringt sie.

🚩 **Sie stammen ALLE aus dem Kosch-Wiki**, 358 davon von einer einzigen Seite
(`kosch/Ortschaften_1`), eine von `kosch/Wege`. Aus garetien.de: **null**. Das ist VolkoVs
Verortungs-Rückstand, keine Aussage über innerorts. Wer die Marke als Innerorts-Signal liest,
importiert einen Arbeitsstand als Sachaussage.

### (b) Die Standortkette des Artikels — NEIN, es gibt sie nicht

Die Hausregel `avesmapsPlaceScopeDecide` ist rein und getestet und würde sich sofort füttern lassen
— aber garetien.de liefert das Feld nicht. Zehn echte Bauwerksartikel aus dem Export geprüft
(Tempel, Kloster, Gebäude, Akademie, Burg): **10 von 10 ohne Standort-Feld**. Die Lage steht im
Fließtext:

> „**liegt** am Schattenbachpass und ist ein Wachturm mit Signalfeuer." (Turm Dohlentrutz)
> „**steht** auf dem Platz der Sonne, direkt gegenüber der Neuen Residenz." (Praiostempel Scraan)

Der zweite Satz ist ein Innerorts-Satz und der erste nicht — aber das aus Fließtext zu entscheiden
ist Textverstehen, nicht ein Nachschlagen. Ausgeschieden.

### (c) Abstand allein — NEIN, die Gegenprobe widerlegt es

Für jedes ggp-Bauwerk mit Position der Abstand zur nächsten Ortschaft, **und dieselbe Messung für
die Ortschaften des Exports als Kontrollgruppe**:

| | unter 1 Meile | Median |
|---|---|---|
| Bauwerke (1048) | 4,5 % | 12,4 Meilen |
| **Ortschaften (957), Kontrolle** | **4,5 %** | 14,3 Meilen |

Identisch. Ein Dorf 800 Schritt neben einer Stadt ist ein Nachbardorf. ⚠️ **Ohne die Kontrollgruppe
hätte die Zahl „4,5 % liegen dicht an einer Stadt" wie ein Befund ausgesehen** — sie ist keiner.

### (d) 🔴 Abstand UND Name — DAS Kriterium

| ggp-Bauwerke | in Reichweite | Ortsname steckt im Namen |
|---|---|---|
| unter 0,5 Meilen | 27 | **11 (40,7 %)** |
| unter 1,0 Meilen | 72 | 16 (22,2 %) |
| **über 5 Meilen** | 698 | **4 (0,6 %)** |

68-fache Anreicherung gegenüber dem Hintergrund. Das Signal ist echt.

**Der Name wird gefaltet, nicht verglichen:** Kleinschreibung, Umlaute auf ihren Grundbuchstaben,
alles Nicht-Buchstabige weg, und der Ortsname verliert ein Schluss-`e` — so trifft `Wandleth` auch
„**Wandleth**er Baumeisterzunft". Dieselbe Faltungsidee wie `avesmapsStaettenSchluessel`.

### 💣 Und der wichtigste Befund: die Menge ist klein

Von 1048 ggp-Bauwerken liegen **27** näher als eine halbe Meile an einer Ortschaft; der Median ist
12,4 Meilen. **VolkoV verortet seine Bauwerke.** Es sind Burgen, Klöster und Wachtürme im Land —
echte Außerorts-Objekte. Das gemeldete Muster gibt es (Wandleth trägt Armbrustmanufaktur, Brauerei,
Baumeisterzunft und Rondra-Tempel im Umkreis von 0,2 Meilen), aber es ist ein Dutzend Fälle, kein
Hunderter.

⭐ **Das ist die Rechtfertigung für „Angebot statt Automatik".** Bei einem Dutzend Fällen kostet ein
Fehlgriff wenig, und der Editor sieht den Ortsnamen im Knopf.

### 🔴 (e) NACHTRAG 07.09.2026 — die Regel ist umgedreht, die Messung bleibt wahr

Owner, wörtlich: „Der Button soll kommen, wenn der Name X in Y oder 5 Meilen in der Nähe einer
bestehenden oder anderen importierten Siedlung sein sollte. Sind in der Nähe mehrere soll ein
dropdown Menü sortiert nach entfernung zur auswahl stehen, für welches man sich innerorts
entscheiden möchte."

**Anlass:** der Knopf war unauffindbar. Nach (d) trifft das Kriterium **11 von 1048** ggp-Bauwerken
— und seit dem Stage-Umbau (07.09.2026, `f0362ab`) läuft der normale Import über Auswahl → Stage →
„Stage importieren", wo es ihn gar nicht gab. Zusammen heißt das: praktisch nie sichtbar, und wenn
sichtbar, dann auf einem Weg, den niemand mehr geht.

**Was gilt jetzt:** Kandidat ist jede Siedlung innerhalb von **5 Meilen**; der Namenstreffer ist
**keine Bedingung mehr, sondern eine Marke** an der Zeile. Der Preis steht im Code:

| | vorher (0,5 Meilen UND Name) | jetzt (5 Meilen, Name als Marke) |
|---|---|---|
| ggp-Bauwerke mit Angebot | 11 | rund 350 (§2d: 698 liegen über 5 Meilen) |

💣 **Damit ist (c) formal umgedreht — und (c) bleibt trotzdem richtig.** Die Kontrollgruppe hat
bewiesen, dass Nähe **kein Befund** ist (4,5 % der Bauwerke unter einer Meile an einer Ortschaft,
und exakt 4,5 % der Ortschaften auch). Was sie widerlegt, ist ein *automatischer Schluss*. Nähe ist
seither nur noch der **Filter für ein Angebot**, und welche Stadt es wird, entscheidet der Editor
aus einer Liste. Genau diese Rechtfertigung steht in (d) schon: „Angebot statt Automatik".

🔴 **Zwei Regeln halten das zusammen, und ohne sie wäre der Umbau eine Verschlechterung:**

1. **Die Liste ist nach Entfernung sortiert, die VORAUSWAHL ist es nicht.** Sie nimmt den nächsten
   Kandidaten *mit Namenstreffer* (`avesmapsGaretienInnerortsVorauswahl`). Der Namenstreffer ist das
   einzige gemessene Signal (68-fache Anreicherung, (d)); nach bloßer Nähe stünde in der Testfixture
   „Innerorts einfügen (Aue)" im Knopf, während „Wandleth" gemeint ist — und bis zum 07.09.2026
   hatte der Importer dort **recht**.
2. **Im Kasten ist „auf die Karte" vorausgewählt.** Bei 350 Objekten legte eine vorbelegte Stadt
   beim nächsten „Stage importieren" stillschweigend dreihundert Stätten an. §5 („Keine Automatik")
   gilt unverändert — der Vorschlag steht im Knopf und in der Liste, gewählt ist er nicht.

⚠️ **Die 5 Meilen sind eine Owner-Zahl, keine gemessene Schwelle** — anders als die 0,5 davor, die
an 27 Fällen gemessen war. Sie trennt nichts; sie begrenzt, was zur Wahl steht.

---

## 3 · Der Speicher — die eigentliche Entscheidung

Ein innerorts eingefügtes Objekt hat **keine Kartenposition** und kann deshalb nicht in
`map_features`: dort ist die Geometrie Pflicht, und alles darunter zeichnet sie.

`in_settlement_places` wäre der richtige Platz, ist aber eine **Ableitung** aus der
Wiki-Aventurica-Registry. 💣 Ein garetien-Objekt nach `wiki_sync_pages` zu schreiben verbietet der
Abbau-Vertrag des Importers (`docs/…/garetien-importer-abbau`): kein Modul ausserhalb von
`api/_internal/import/` darf seine Tabellen kennen — und umgekehrt darf er sich nicht in fremde
setzen.

🔴 **Also eine eigene, kleine Tabelle — und sie gehört NICHT dem Importer.**

```sql
CREATE TABLE IF NOT EXISTS settlement_place (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    public_id     CHAR(36)     NOT NULL,          -- wie jedes Kartenobjekt
    name          VARCHAR(190) NOT NULL,
    place_type    VARCHAR(80)  NULL,              -- „Tempel", „Gasthaus" -- das Vokabular des Wikis
    settlement_public_id VARCHAR(64) NOT NULL,    -- der ORT, nicht sein Name
    settlement_name      VARCHAR(190) NOT NULL,   -- der Name zum Zeitpunkt der Aufnahme
    wiki_url      VARCHAR(500) NULL,
    origin        VARCHAR(20)  NOT NULL,          -- 'garetien' | 'manual' | …
    is_active     TINYINT(1)   NOT NULL DEFAULT 1,
    created_by    INT          NULL,
    created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_settlement_place (settlement_public_id, name),
    KEY idx_settlement (settlement_public_id, is_active)
);
```

💣 **Die Bindung ist die `public_id` des Ortes, nicht sein Name.** `in_settlement_places` reist heute
mit dem NAMEN der Stadt und der Index im Browser fällt Namen aufeinander
(`avesmapsStaettenSchluessel`) — das ist für eine Ableitung aus dem Wiki richtig, weil es dort keine
id gibt. Ein gespeichertes Objekt darf sich darauf nicht verlassen: eine umbenannte Stadt verlöre
sonst alle ihre Stätten, lautlos. ⚠️ Der Name reist trotzdem mit — er ist die Anzeige und der
Schlüssel, unter dem der bestehende Index sie einsortiert.

🔴 **`is_active` statt `DELETE`**, wie überall im Haus: eine Rücknahme muss umkehrbar sein.

**Der Leser bekommt einen zweiten Erzeuger.** `avesmapsFetchInSettlementSearchRows` liest heute drei
Quellen; die vierte ist diese Tabelle. ⚠️ Sie liefert Zeilen in **derselben Form** wie die drei
anderen (`title`, `raw`/Ort, `type_label`, `wiki_url`) — genau so, wie die Organisationssitze schon
heute dazukommen, ohne dass der reine Teil einen Sonderfall braucht.

💣 **Und der Kartenstempel.** Die Nutzlast hängt am ETag über `map_revision`, und eine neue Zeile in
`settlement_place` bewegt kein Kartenobjekt. Ohne einen eigenen Stempel bekäme jeder warme Browser
sein 304 und sähe die neue Stätte nie — dieselbe Falle, die Klimazonen, Tempowerte und der
Wappen-Notaus schon bezahlt haben. Also `avesmapsSettlementPlaceReadStamp()` in den Seed des ETags,
wie `avesmapsClimateReadStamp()`.

---

## 4 · Die Bedienung

Im Kasten „Eingefügt wird" steht neben **„Neu einfügen"** ein zweiter Knopf:

> **Innerorts einfügen (Wandleth)**

🔴 **Er erscheint nur, wenn eine Siedlung in Reichweite liegt** — `AVESMAPS_GARETIEN_INNERORTS_MEILEN`
(seit 07.09.2026: 5, siehe §2e). Sonst steht er gar nicht da; ein dauerhaft ausgegrauter Knopf
behauptet eine Möglichkeit, die es nicht gibt (dieselbe Owner-Regel wie bei „Zurücknehmen",
30.08.2026).

🔴 **Und seit dem 07.09.2026 steht die Stadt zur Wahl** (§2e): im Kasten „Eingefügt wird" die Zeile
**„Innerorts"** — ein Auswahlfeld mit allen Städten in Reichweite, nach Entfernung sortiert, je
Zeile `Wandleth · 0,09 Meilen · Name passt`. Der erste Eintrag heißt **„— auf die Karte —"** und ist
vorausgewählt. Ist eine Stadt gewählt, sagt die Zeile darunter, was das heißt (kein Kartenpunkt,
Form und Art gelten nicht), und der Knopf trägt **ihren** Namen.

⭐ **Damit wirkt Innerorts über die Stage** — `garetienEingabenFuerServer` schickt bei getroffener
Wahl `{innerorts, innerorts_public_id}`, und `garetienStageEinstellungenJeItem` heftet den Rumpf an
die 'new'-Items. Bis dahin legte „Stage importieren" nie eine Stätte an, und der Einzelknopf war der
einzige Weg dorthin; `f0362ab` musste ihn deshalb als „GEMESSENE ABWEICHUNG" stehen lassen.

⚠️ **Die Liste wird beim Öffnen einer Zeile FRISCH nachgeschlagen** (`innerorts_kandidaten`,
`avesmapsGaretienInnerortsKandidatenFrisch`) — das ist die Hälfte des Owner-Satzes, die der Planbau
nicht kann („oder anderen importierten Siedlung"): eine Stadt, die dieser Lauf gerade erst angelegt
hat, steht sonst erst nach einem zweiten „Holen & Rechnen" zur Wahl. 💣 Sie gehört **nicht** in den
Lesepfad der Liste — `AVESMAPS_GARETIEN_LISTE_MAX` ist 10000, das wären zehntausend Umkreissuchen je
Filterklick.

🔴 **Und seit dem 08.09.2026 stellt ein Spinner die Reichweite ein** (Owner: „einen numerischen
spinner … der zwischen 0 - 20 die meilen eingrenzt" — auf die Rückfrage, welcher Umkreis gemeint
sei: „beide"). Er steht unter dem Auswahlfeld, 0–20 Meilen in ganzen Schritten, Vorgabe 5.

💣 **Er steht auch da, wenn nichts gefunden wurde** — die tragende Regel. Bis dahin hing die ganze
Zeile am Befund; fände die Suche bei 5 Meilen nichts und verschwände dann das Feld, mit dem man sie
auf 12 stellt, wäre es genau dann weg, wenn man es braucht. Deshalb hängt die Zeile jetzt am
**Bauwerk** (`avesmapsIstBauwerksklasse`, das geteilte Merkmal) und nicht am Treffer — und aus
demselben Grund fragt der frische Nachschlag für **jedes** geöffnete Bauwerk nach, nicht nur für
eines mit Planbau-Befund: ein Tempel 8 Meilen neben einer Stadt hätte sonst auch bei 20 Meilen
keinen Vorschlag.

💣 **Geklemmt wird serverseitig** (`avesmapsGaretienUmkreisMeilen`, ein Prüfer für beide Spinner):
ein `max="20"` im Markup ist eine Bitte an den Browser, und eine Umkreissuche mit 10.000 Meilen
läuft gegen den ganzen Bestand. 🔴 „Nicht genannt" und „0" sind dabei verschiedene Antworten — jenes
nimmt die Vorgabe der aufgerufenen Funktion (so kennt jede Vorgabe genau eine Stelle), dieses sucht
wirklich mit 0.

⚠️ **„Imports in der Nähe" hat denselben Spinner**, dort aber als **Zuschlag** über die eigene
Ausdehnung hinaus („Umkreis +", Vorgabe 3 Meilen = 1 Karteneinheit). Als ganzer Radius gelesen fände
eine große Waldfläche mit 3 Meilen gar nichts mehr. `AVESMAPS_GARETIEN_NAEHE_ZUSCHLAG` bleibt in
Karteneinheiten — die Fixturen rechnen relativ zu ihr —, umgerechnet wird beim Eintritt.

💣 **Die gewählte `public_id` wird serverseitig geprüft, nicht geglaubt** — sie gilt nur, wenn sie in
den `kandidaten` dieses Vorschlags steht (`avesmapsGaretienInnerortsAusVorschlag`). Ohne den Riegel
bände ein beliebiger Anfragerumpf eine Stätte an eine beliebige Stadt, und weil `settlement_place`
weich schreibt und die Stätten-Zeile nur einen Namen zeigt, fiele das niemandem auf.

⚠️ **Der Ortsname steht IM Knopf**, nicht im Hilfetext: der Editor entscheidet nicht „innerorts
ja/nein", sondern „innerorts **in Wandleth**" — und wenn der Ort falsch ist, sieht er es, bevor er
drückt.

🔴 **Die Zielwahl bleibt unberührt.** Die zwei Auswahlfelder (Form/Art) beschreiben, was auf der
Karte entstünde; ein innerorts eingefügtes Objekt entsteht dort nicht. Der Kasten darunter wird
deshalb beim Überfahren des Knopfes **abgeblendet**, statt zu verschwinden — verschwände er, spränge
die Spalte, und der Editor verlöre den Bezug.

**Danach:** das Objekt steht in der Infobox seines Ortes unter „N besondere Stätten verzeichnet",
in der Kartensuche mit „… in Wandleth · nicht auf der Karte", und im Importer als
**„Übernommen · innerorts"**.

⚠️ **Die Rücknahme muss es auch geben**, und sie ist einfacher als die gewöhnliche: kein
Kartenobjekt wurde angelegt, also genügt `is_active = 0` plus der dauerhafte Vermerk.

---

## 5 · Was NICHT gebaut wird

🔴 **Keine Automatik.** Der Importer schlägt vor, er entscheidet nicht. 27 Kandidaten bei 8348
Zeilen rechtfertigen keinen stillen Pfad, und ein falsch einsortiertes Objekt ist von aussen nicht
von einem fehlenden zu unterscheiden.

🔴 **Keine Textanalyse.** „liegt am Schattenbachpass" gegen „steht auf dem Platz der Sonne" zu
unterscheiden ist Textverstehen; wir haben ein Nachschlagen und bleiben dabei.

🔴 **Keine zweite Faltung.** Die Anzeige ist die vorhandene Stätten-Zeile mit ihren Lore-Klassen.
Eine dritte Rezeptur für „Liste von Namen in einer Infobox-Klappzeile" ist genau die Divergenz, vor
der AGENTS.md §11 warnt.

⚠️ **Der Kosch-Rückstand bleibt übersprungen.** Die 359 Zeilen ohne Position sind kein
Innerorts-Fall, und sie ohne Ort einzusortieren hiesse, sie unter einer geratenen Stadt abzulegen.

---

## 6 · Offene Punkte

🔧 **Die Schwelle ist seit dem 08.09.2026 einstellbar** (Spinner, 0–20 Meilen); die fünf Meilen sind
nur noch ihre Vorgabe — und auch die ist NICHT gemessen (§2e). Die 0,5
davor war an 27 Fällen gemessen und trennte sauber (11 mit Namenstreffer gegen 0,6 % Hintergrund);
die 5 ist eine Owner-Zahl und trennt nichts — sie begrenzt, was zur Wahl steht. Ob acht Kandidaten
(`AVESMAPS_GARETIEN_INNERORTS_KANDIDATEN`) in dicht besiedelten Gegenden reichen oder zu viele sind,
ist am Livebestand ungemessen.

🔧 **Der Ablauf mit angemeldeter Sitzung steht weiter aus** — Auswahlfeld, frischer Nachschlag und
der Stage-Weg sind über Tests und im Node-Lauf abgenommen, nicht im Browser gegen die echte
Datenbank.

🔧 **Ein Objekt, das später doch verortet wird**, hätte dann zwei Existenzen — die Stätte und den
Kartenpunkt. Der Importer müsste das beim nächsten Lauf erkennen. Für Stufe 1 nicht gebaut; die
Menge ist klein genug, dass ein Editor es von Hand auflöst.

🔧 **Andere Quellen als der Importer.** `origin` ist von Anfang an dabei, damit später ein Editor
eine Stätte von Hand anlegen kann — gebaut wird dafür in Stufe 1 nichts.
