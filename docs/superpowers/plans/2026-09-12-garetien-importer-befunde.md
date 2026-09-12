# Garetien-Importer — die Befunde

**Stand:** 12.09.2026 · **Quelle:** sieben Prüfläufe am Code (`c4349283`) plus die offenen Punkte
der vier Garetien-Entwürfe und der zwei Übergaben. Zusammengeführt und entdoppelt.

> 💣 **Diese Liste ist nicht vollständig, und sie weiß, wo sie unvollständig ist.** Kein Prüflauf
> hatte eine **angemeldete Sitzung**, keiner eine **Datenbank**, und `garetien.de` ist aus der
> Prüfumgebung per Egress gesperrt. Jede Zahl unten ist entweder am Code abgelesen, aus einer im
> Code notierten Messung zitiert oder ausdrücklich als Herleitung gekennzeichnet.
>
> 🔴 **Und es fehlt eine zweite Quelle** — siehe `2026-09-12-garetien-importer-UEBERGABE.md`.

**Schwere:** 🔴 richtet Schaden an · 🟠 kostet Arbeit oder Vertrauen · 🟡 stört ·
🔧 braucht eine Entscheidung oder eine Messung · 🟢 ist gut so.

**Bilanz:** 27 · 31 · 11 · 12 · 1 — zusammen 82.

---


## 01 · Abrufen und der Lauf

*Dump holen, parsen, staging — bevor ein Editor irgendetwas sieht.*


### 🔴 Ein halber Lauf wird stillschweigend der geltende — mit dem Plan eines anderen

Reißt die Abrufkette ab (Tab zu, Netz weg), bleibt ein Lauf mit 7 von 18 Ebenen stehen, und das Fenster nimmt beim nächsten Öffnen immer den neuesten. Es paart dann Staging-Zeilen aus Lauf B mit Vorschlägen aus Lauf A. Das Feld, das die Zugehörigkeit festhält, wird gesetzt und **nirgends geprüft**.

— *Gefunden von:* Vor dem Fenster · *Beleg:* garetien-liste.php:481 + :545 · sync_plan_run.source_stamp (garetien-plan.php:1561) · `lauf-gemischt`


### 🔴 Der Laufstatus lügt

Der Abschluss wird bei jeder der 18 Anfragen neu gesetzt, mit nur einer Ebene im Blick: scheitert Ebene 5 und gelingt Ebene 18, steht „fertig“. Die Fehlliste lebt nur in einer Sitzungsvariablen — nach einem Neuladen ist ein Lauf mit fünf fehlenden Ebenen von einem vollständigen nicht zu unterscheiden.

— *Gefunden von:* Vor dem Fenster · *Beleg:* garetien-import.php:422 · Kommentar im Client (:2617) behauptet das Gegenteil · `lauf-status-luegt`


### 🔴 „Holen & Rechnen“ hat kein Zeitlimit und keine Stückelung

Alle ~8348 Zeilen in einer Anfrage, je Zeile ein frisch vorbereitetes Statement. Läuft es in die Zeitgrenze, ist das Fehlerbild ein **leerer Rumpf ohne Ausnahme**. Jeder andere lange Endpunkt des Hauses setzt das Limit hoch.

— *Gefunden von:* Vor dem Fenster · *Beleg:* garetien-import.php (kein set_time_limit) · garetien-plan.php:1275 · `plan-ohne-limit`


### 🟠 Eine gültige Seite mit null Datenzeilen gilt als Erfolg

Der Abruf-Weg prüft nur auf leeren Rumpf und HTTP≠200. Eine geleerte oder umgebaute Exportseite verschwindet spurlos — der Upload-Weg hat genau dafür einen Riegel (422 `no_rows`), der Abruf nicht.

— *Gefunden von:* Vor dem Fenster · *Beleg:* garetien-abruf.php:369 · garetien-import.php:415 gegen :386 · `leere-seite`


### 🟠 Koordinaten werden paarweise gelesen, ohne Paritätsprüfung

Ein einzelner überzähliger Zahlentoken verschiebt jedes Paar dahinter — lautlos. Dazu: der Import lässt einen 64er-Saum außerhalb der Karte durch, den der Schreibweg später hart ablehnt; und „liegt auf der Karte“ prüft mit ODER, ein einziger Schrottpunkt genügt.

— *Gefunden von:* Vor dem Fenster · *Beleg:* garetien-parser.php:50 · AVESMAPS_GARETIEN_KARTE_RAND=64 gegen bootstrap.php:419 · `koordinaten-paritaet`


### 🟠 Der Upload-Weg schließt seinen Lauf nie ab

Er legt den Lauf an, *bevor* er die Eingabe prüft, und beendet ihn nie. Jeder Fehlversuch hinterlässt einen Lauf auf „läuft“ — der beim nächsten Öffnen sofort der geltende wird.

— *Gefunden von:* Vor dem Fenster · *Beleg:* garetien-import.php:367 vor :375/:379/:386, kein FinishRun · `upload-lauf`


### 🟠 Das Staging schreibt ohne Transaktion

Eine Ebene, die mitten im Einfügen stirbt, hinterlässt ihre bis dahin geschriebenen Zeilen — ohne Delete davor, ohne Rollback.

— *Gefunden von:* Vor dem Fenster · *Beleg:* garetien-abruf.php:304 · `staging-transaktion`


### 🟡 Drei stille Fehlleseformen im Parser

Der Container-Regex verlangt ein attributloses `div` (MediaWiki liefert seit 1.39 oft mit `lang`) — greift es nicht, geht die ganze Seite samt Navigation in den Zeilenstrom. Ein Kopf ohne Doppelpunkt macht den ganzen Kopf zum Typ. Und Namensraum und Artikel sind nicht unterscheidbar.

— *Gefunden von:* Vor dem Fenster · *Beleg:* garetien-parser.php:14, :78, :80 · `parser-still`


### 🟡 Die Höflichkeitspause gegenüber garetien.de feuert nie

Sie liegt in einer prozess-statischen Variablen, der Client schickt aber eine Ebene je Anfrage — jede ein frischer PHP-Prozess. Zwei Kommentare behaupten eine Drossel, die es nicht gibt; wir haben bei einem fremden Wirt um Erlaubnis gefragt.

— *Gefunden von:* Vor dem Fenster · *Beleg:* garetien-abruf.php:77 · review-garetien-importer.js:2857 · `drossel-inert`


## 02 · Erkennen und Abgleichen

*„Haben wir das schon?“ — die Rechnung, an der alles Weitere hängt.*


### 🔴 „Deckt sich“ heißt: die Hälfte deckt sich

Die Deckung ist ein **Median** über 16 Probepunkte — 8 von 16 genügen für Abstand 0,00. Die andere Hälfte darf beliebig weit weg liegen und wird **stillschweigend nicht importiert**. Bei kurzen Linien noch schärfer: bei zwei Punkten zählt der kleinere.

— *Gefunden von:* Abgleich · *Beleg:* garetien-abgleich.php:718 · gemessen: 8/16 → deckt_sich, 7/16 → neu · `deckung-median`


### 🔴 Gemessen wird Eckpunkt gegen Eckpunkt, nie Punkt gegen Kante

Ihre Linie liegt *exakt* auf unserer — und gilt ab einer eigenen Kantenlänge über ~4 Einheiten als „neu“. Gemessen: 20er Kante → Abstand 4,00 → Dublette. Jede grob gezeichnete Geometrie von uns ist für den Abgleich unsichtbar.

— *Gefunden von:* Abgleich · *Beleg:* garetien-abgleich.php:705 · Abhilfe: Punkt-zu-Segment, drei Zeilen · `punkt-gegen-kante`


### 🔴 78 von 79 Bergen können nie „deckt sich“ werden

Der Abgleich misst die *Polygonkontur* gegen unseren Gipfel*punkt* — der Median dieser Abstände IST der Bergradius —, und das mit der engsten Schwelle des Hauses (0,9 Meilen). Reduziert wird erst im Plan. Proxy-Messung: nur 33 % lägen unter der Schwelle.

— *Gefunden von:* Abgleich + Objektarten · *Beleg:* garetien-abgleich.php:149 + :1117 gegen garetien-plan.php:129 · `berge-umriss`


### 🔴 Gleichnamige Orte kommen als „neu“ und vorangehakt

Die Punktschwelle ist 0,9 Meilen, der Messfehler der Koordinatentransformation p90 **3,5 Meilen** — und einen reinen Namensabgleich gibt es nicht. Bei 1127 Ortschaften ist das die Dublettenmenge, die der Abgleich verhindern soll. Dein Entscheid vom 06.09. sagt es anders: gleicher Name bis 2,0, fremder nur auf dem Punkt.

— *Gefunden von:* Objektarten · *Beleg:* AVESMAPS_GARETIEN_TREFFER_EINHEITEN_PUNKT=0.3 · garetien-abgleich.php:280, :1102 · `orte-schwelle`


### 🔴 Ein Weg trifft höchstens 16 unserer Abschnitte

Die Deckung zählt je Probepunkt einen Sieger, und diese Trefferliste *ist* die Abschnittsliste. Eine Reichsstraße mit 57 Abschnitten bekommt die Quelle an 16, an 41 nicht — **ohne Meldung**, und der nächste Lauf bietet dieselben 16 an.

— *Gefunden von:* Objektarten · *Beleg:* garetien-abgleich.php:683 + :856 · AVESMAPS_GARETIEN_PROBEPUNKTE=16 · `sechzehn-abschnitte`


### 🔴 Innerorts fehlt beim häufigsten Fall — bestätigt

Ein Bauwerk, das *exakt* wie seine Siedlung heißt, gilt als „deckt sich“ und bekommt deshalb kein Innerorts-Angebot. Genau diese **11 von 27** waren das gemessene Kernsignal (68-fache Anreicherung). Der Befund wird korrekt gerechnet und dann weggeworfen.

— *Gefunden von:* Abgleich · *Beleg:* garetien-plan.php:702, $istNeu :621 · auch das Zusatz-Item trägt kein innerorts · `innerorts-haeufigster`


### 🟠 Die Namensregel scheitert an dem einen Beispiel in ihrem eigenen Kommentar

„Der Große Fluss“ und „Großer Fluss“ sollen dasselbe sein — gemessen: **nein**. Gestrichen wird nur der Artikel, keine Endung. Es trifft das größte Objekt des Imports (294 Stützpunkte, 13 unserer Abschnitte) und strukturell 11,3 % aller Namen.

— *Gefunden von:* Abgleich · *Beleg:* garetien-abgleich.php:1288 gegen :1306 · `namensregel-beispiel`


### 🟠 Die Wortanfang-Regel hat keine Mindestlänge

„Aue“ trifft „Auenbach“, „Natter“ trifft „Natternsee“ — gemessen 3,9 % Falschpaare über 284 Namen. Sie *entscheidet* bei Punkten über „deckt sich“. ⚠️ Zugleich **rettet** sie die Merge-Gruppe: „Silber Hain“ ↔ „Silber Hain 1“ hängt an ihr. Wer sie verengt, muss das vorher anders lösen.

— *Gefunden von:* Abgleich · *Beleg:* garetien-abgleich.php:1291 · Nachbar avesmapsGaretienNameNenntOrt hat den Riegel · `wortanfang`


### 🟠 „NIE allein entscheidend“ stimmt nicht mehr

Zwei Kommentare bescheinigen der Namensregel, sie sei bloß eine Bemerkung. Sie entscheidet an drei Stellen: über die Punkt-Identität, über die Quellen-Ergänzung an fremden Objekten, und sie hebt den Ausdehnungsriegel auf. Die Sache ist richtig — die Kommentare sind die Deckung, unter der jemand sie „vereinfacht“.

— *Gefunden von:* Abgleich · *Beleg:* garetien-abgleich.php:1173 und :1286 gegen :1183 · garetien-plan.php:966 · `nie-allein`


### 🟠 Die Küste wird eine Fläche — und ein perfekter Treffer meldet „vermutlich ein Zufluss“

20 Linien werden ohne Ringschluss zum Polygon, und der Ausdehnungsriegel hält ihre *Linienlänge* gegen unseren *Ringumfang*: 48 % → „widerspricht“. Die Zielwahl hat für diese Art keine richtige Antwort.

— *Gefunden von:* Abgleich · *Beleg:* garetien-abgleich.php:143 · garetien-plan.php:118 · Riegel :1211 · `kueste`


### 🟠 Eine Schwelle für alle Wegearten

2,0 Einheiten = 6 Meilen, ob Pfad oder Reichsstraße, und bei Linien spielt der Name keine Rolle. Ein Pfad, der 6 Meilen neben einer Reichsstraße herläuft, liest sich als „deckt sich“ und wird nicht importiert.

— *Gefunden von:* Abgleich · *Beleg:* AVESMAPS_GARETIEN_TREFFER_EINHEITEN=2.0 · garetien-abgleich.php:259, :305 · `linien-schwelle`


### 🟠 Stadtviertel ist ausgeschlossen — mit einer falschen Begründung

22 Objekte fallen heraus mit „hat bei uns kein Gegenstück“. Die Ortsklasse `stadtviertel` existiert seit August, und dein Entscheid vom 27.08. sagt das Gegenteil. **Zwei Tests nageln den falschen Zustand fest.** Reichsstadt/Königsstadt stehen weiter auf „Großstadt“.

— *Gefunden von:* Vor dem Fenster + Objektarten · *Beleg:* garetien-abgleich.php:196 · features.php:200 · garetien-abgleich-test.php:87 · `stadtviertel`


### 🔧 Was WIR haben und Garetien nicht, sieht niemand

Der Abgleich ist gerichtet — er läuft über ihre Zeilen. Welche unserer Objekte nie getroffen wurden, wird nicht ausgewertet, obwohl die Trefferzählung es weiß. Das ist die einzige Auskunft, mit der man beurteilen könnte, ob ein Lauf vollständig war.

— *Gefunden von:* Abgleich · *Beleg:* garetien-abgleich.php:668 · braucht eine Hüllbox-Eingrenzung auf das Sichtgebiet · `fuenfter-ausgang`


### 🟡 Innerorts sieht nur übernommene Importe, nicht gestagte

Eine Siedlung, die erst auf der Stage liegt, ist noch kein Wirt. Deine Formulierung vom 07.09. („einer bestehenden *oder anderen importierten* Siedlung“) ist damit halb erfüllt.

— *Gefunden von:* Abgleich · *Beleg:* garetien-liste.php:1168 · `innerorts-nur-uebernommen`


## 03 · Beurteilen: Liste und Stage

*Die Fläche, auf der entschieden wird.*


### 🔴 Auf „Offen“ sind 16 Einstellfelder bedienbar — und die Karte folgt

Zwei Auswahllisten und 14 Eingaben, samt Namensvorschau auf der Karte. Beim Import kommt nichts davon an, weil das Objekt nie auf der Stage lag. Gesperrt wird erst im Zustand „übernommen“.

— *Gefunden von:* Neuer Editor · *Beleg:* garetienEingefuegtWirdMarkup:5064, Sperre erst :5075 · `offen-felder`


### 🔴 Die Stage hat keinen Deckel — und Suche und Filter sind gesperrt

Wer eine Ebene auflegt, hat mehrere tausend Zeilen und kein Mittel, darin etwas zu finden. Genau auf dieser Liste steht, was der nächste Klick schreibt. Der Entwurf verlangt ausdrücklich das Gegenteil.

— *Gefunden von:* Vielimporteur · *Beleg:* garetienStageFilterSperreSetzen:1721 · Stage-Entwurf §4 · `stage-ohne-suche`


### 🟠 Die Ziel-Marke ist gebaut und wird nie gerufen

`garetienStageZeile2` baut „→ Weg · Bach“ / „→ Stätte in ‚Wandleth‘“ — `grep` findet keinen Aufrufer außer dem Test. Eine Zeile Arbeit; ohne sie sieht man der Liste nicht an, was gleich passiert oder was schon auf der Stage liegt.

— *Gefunden von:* Vielimporteur + Neuer Editor · *Beleg:* review-garetien-importer.js:6542 · `zielmarke`


### 🟠 Das Abschnittshäkchen schreibt an den Server — und der Import hebt es auf

Jeder Klick ist eine Serverrunde plus voller Listenabruf (~2 MB). Und „Stage importieren“ hakt die Abwahl wieder an, weil der Plan über *alle* Items des Objekts läuft. Für Wege ist das die einzige Stelle, an der man „ja zu diesem, nein zu jenem“ sagen kann.

— *Gefunden von:* Neuer Editor + Objektarten · *Beleg:* garetienHakenKlick:8067 · garetienPlanAusItems:6815 · `abschnittshaken`


### 🟠 Sieben Knöpfe in zwei Reihen, und „Alle wählen“ steht in der falschen

„Auswahl von der Stage nehmen“ und „Stage leeren“ stehen übereinander, getrennt durch eine Leistengrenze, die niemand kennt. Der Entwurf wollte „alle n“ als Häkchen im Listenkopf.

— *Gefunden von:* Neuer Editor · *Beleg:* AVESMAPS_GARETIEN_AUSWAHL_KNOEPFE_JE_REITER:678 · index.html:4269 · `zwei-leisten`


### 🟠 Die Auswahl meldet Erfolg, wo nichts geschah

Nach „Holen & Rechnen“ zeigen ihre Item-Nummern ins Leere. „Auswahl ablehnen“ trifft 0 Zeilen — und meldet „40 Objekte abgelehnt“, weil die Zahl im Browser gerechnet und die Serverantwort nie gelesen wird.

— *Gefunden von:* Vielimporteur · *Beleg:* garetienAuswahlAblehnenMeldung:7208 · kein keys-Nachschlag für die Auswahl · `auswahl-luegt`


### 🟠 Ein Knopf zählt anders, als er handelt

„Auswahl aus der Karte zurücknehmen“ zählt die ganze Auswahl, handelt aber nur auf der gefilterten Liste: Knopf sagt 60, zurückgenommen werden 22. Für die übrigen fünf Knöpfe wurde genau das am 08.09. repariert — diese Tür nicht.

— *Gefunden von:* Vielimporteur · *Beleg:* garetienRuecknahmeMengeZustand:7805 gegen AVESMAPS_GARETIEN_AUSWAHL_ZAEHLER:729 · `zaehler-handelt-anders`


### 🟠 Der Stage-Nachschlag kostet 1,94 s reine Rechenzeit

Eine Schlüsselliste wird je Objekt des Laufs neu aufgebaut (`array_map` im Prädikat) — nach jedem „Holen & Rechnen“ und jedem Import, auf STRATO ein Vielfaches. Die Abhilfe ist eine Zeile.

— *Gefunden von:* Vielimporteur · *Beleg:* garetien-liste.php:413 · gemessen bei 8213 Objekten · `nachschlag-teuer`


### 🟡 Gesperrte Häkchen ohne Grund

„Als Quelle einfügen“ steht mal grau-angehakt, mal grau-leer — beides erklärt nichts. Die zwei Nachbarleisten schreiben ihren Grund als Satz darunter, ausdrücklich weil ein gesperrtes Element keine Zeigerereignisse bekommt; ein Tooltip hülfe also nicht.

— *Gefunden von:* Neuer Editor · *Beleg:* garetienEingefuegtWirdHakenZeile:3588 gegen .gi-acts__grund:6900 · `haken-ohne-grund`


## 04 · Einstellen: die Wege ins Ziel

*„Neu einfügen“, „Als Quelle“, „Innerorts“ — und was daraus wird.*


### 🔴 „Innerorts einfügen“ schreibt sofort in die Karte

Kein Stage-Umweg, **keine Rückfrage**, neutral gefärbt, direkt neben „Auf die Stage“ — und schon auf „Offen“. Während der Tooltip am Fenster verspricht: „Es wird nichts geschrieben, bis du ‚Stage importieren‘ drückst.“ Dein eigener Satz steht als Kommentar daneben.

— *Gefunden von:* Neuer Editor · *Beleg:* review-garetien-importer.js:6694 · :7545 `void fragen;` · index.html:587 · `innerorts-sofort`


### 🔴 Wer die Stadt wählt, macht sein Objekt unimportierbar

Fußknopf springt auf „Stage importieren (0 von 1)“ und sperrt — mit der Begründung, der Abgleich habe nichts gefunden. `{innerorts:true}` erreicht den Server über die Stage nie. Zwei Code-Kommentare widersprechen sich darüber.

— *Gefunden von:* Neuer Editor · *Beleg:* garetienNeuMoeglich:6042 → garetienStageItems:6107 → :8236 · `stadt-unimportierbar`


### 🔴 „Neu einfügen“ schreibt heimlich an ein fremdes Objekt

Der Haken erzwingt intern die Quellen-Ergänzung: ein Klick legt die Dublette an *und* hängt garetien.de an unser bestehendes Objekt — die Aussage, die „trotzdem neu anlegen“ gerade bestreitet. **334 Objekte**, ohne die Rückfrage, die es beim Auflegen gäbe. Serverseitig kein Riegel.

— *Gefunden von:* Vielimporteur + Datenpflege · *Beleg:* garetienEinfuegeWahlSetzen:6081 · garetienStageVorhaben:5987 · Schaden vom 30.08.2026 · `neu-einfuegen-334`


### 🔴 1356 Bauwerke verlieren ihre Art

Burg, Tempel, Kloster, Gutshof, Gasthaus, Pfalz, Magierturm stehen im Quelltyp und werden auf „Gebäude“ abgeworfen; `place_kind` wird nie vorbelegt. Der Quelltyp *ist* die Aussage — geraten wäre erst eine Ableitung aus dem Namen.

— *Gefunden von:* Objektarten · *Beleg:* garetien-uebernahme.php:572 · Typtabelle garetien-abgleich.php:161 · `place-kind`


### 🔴 „Bach“ ist nicht wählbar — und überlebt den Artwechsel

Die Artliste bietet nur die Wegarten an, „Bach“ ist keine davon. Und `is_bach` wird beim Umstellen nicht gelöscht: aus einem Bach wird ein Pfad, den kein Reisender betreten kann, in Bachfarbe gezeichnet. 143 Bäche gegen 32 Flüsse — der häufigste Handgriff überhaupt.

— *Gefunden von:* Objektarten · *Beleg:* garetien-plan.php:270 (fasst is_bach nicht an) · garetien-abgleich.php:349 · `bach`


### 🟠 „Als Quelle einfügen“ nennt weder Ziel noch Anzahl

Bei einem Fluss, der sich mit sechs unserer Abschnitte deckt: ein Häkchen, keine Zahl, kein Name. Die Funktion, die früher „Bei ‚Rakula‘ Quelle + Artikel einfügen (6)“ baute, ist tot. Die Rückfrage sagt „1 Objekt“, während sechs fremde angefasst werden.

— *Gefunden von:* Neuer Editor · *Beleg:* garetienQuelleZielText:6178 ohne Aufrufer · Rückfrage :8794 · `quelle-ohne-ziel`


### 🟠 Eine veraltete Formwahl formt die frische Geometrie um

Die Handeingaben werden beim ersten Kontakt gefüllt und nie wieder abgeglichen — über Läufe, über „Stage leeren“, über Importe hinweg. Zeichnet VolkoV neu und der Vorschlag ändert sich, gilt die alte Form, und der Server formt danach um. Still.

— *Gefunden von:* Vielimporteur · *Beleg:* garetienZielWahlZu:4973 · die fünf …Vergessen()-Funktionen haben keinen Aufrufer · `formwahl-veraltet`


### 🔧 Für ein Herrschaftsgebiet gibt es keine einzige Zielwahl

Weder Form noch „nur Quelle“: der Quellen-Zweig *wirft* für `territory`, obwohl der Typ in der Whitelist des Quellensystems längst steht. Die risikoärmste Stufe („nur Quelle ans bestehende Gebiet“) ist damit für alle 759 Flächen gesperrt.

— *Gefunden von:* Objektarten · *Beleg:* garetien-plan.php:912 · AGENTS.md §5 — zwei Zeilen · `territorien-keine-wahl`


## 05 · Übernehmen

*Der Schreibweg und was er in den Daten hinterlässt.*


### 🔴 Ein abgebrochener Massenimport meldet „die Liste ist unverändert“

1000 Objekte sind 30 sequenzielle Schreibanfragen. Bricht die 20. ab, liegen ~600 auf der Karte, das Fenster sagt das Gegenteil, und der „Rückgängig“-Link entsteht nie, weil er im Erfolgszweig steht.

— *Gefunden von:* Vielimporteur · *Beleg:* garetienEinfuegenAusfuehren:8665 · catch :8876 · garetienListeFehlerZeigen:1018 · `massenimport-abbruch`


### 🔴 Der Wiki-Schlüssel landet am Schild, nie an der Fläche

Seit dem Quellen-Umbau entscheidet die **Fläche** über Kanon und Statuskreis. Jede importierte Landschaft bleibt deshalb halb zugewiesen und bekommt ihr Etikett aus der Garetien-Quelle statt aus dem Namensraum ihres Artikels. Der Durchtrag läuft nur abwärts und heilt es nie. Eine Zeile beim Anlegen.

— *Gefunden von:* Datenpflege + Objektarten · *Beleg:* garetien-uebernahme.php:602–670 · `wiki-am-schild`


### 🔴 Die Wiki-Zuweisung verschluckt jeden SQL-Fehler — auf einem Schreibweg

Ihr `catch` antwortet „kein Treffer“. Fällt die Abfrage aus, legt ein ganzer Stapel Flächen ohne Zuweisung an, ununterscheidbar von „es gab wirklich keinen Treffer“. Dieselbe Klasse wie die HY093-Falle bei „Was ist hier?“.

— *Gefunden von:* Vor dem Fenster · *Beleg:* garetien-wiki-landschaft.php:71, :120 — und der Kopf verbietet den Massenlauf, den der Code fährt · `wiki-schluckt-fehler`


### 🔴 Die Baronie verliert ihre Eigengeometrie außerhalb jedes Items

585 Junkertümer als Kinder heißt: die Eigengeometrie der Baronie muss weg, sonst beschreibt dieselbe Gegend sich doppelt. Dieses Löschen ist in keinem Item sichtbar, nicht anhakbar und im Rücknahme-Modell nicht abbildbar — und zwischen „Geometrie weg“ und „Grenzen berechnen“ ist die Baronie **gar nicht gezeichnet**.

— *Gefunden von:* Objektarten · *Beleg:* territories-derived-geometry.php:~168 · Übernahme läuft stur ORDER BY id · `baronie-geometrie`


### 🟠 Die Lizenz einer Stätte steht auf keiner Seite

Die Verknüpfung wird sauber geschrieben, aber `settlement_place` fehlt in der Liste, die Quellen in die Kartennutzlast mitnimmt — und eine Stätte hat keinen Quellenkasten. CC BY-NC-SA verlangt die Nennung an der Stelle der Nutzung.

— *Gefunden von:* Datenpflege · *Beleg:* garetien-uebernahme.php:1686 · AVESMAPS_MAP_FEATURES_SOURCE_ENTITY_TYPES · `lizenz-staette`


### 🟠 Dem fertigen Objekt sieht man den Import nicht an

`origin='garetien'` steht genau einmal im Modul — an der Stätte. Kartenobjekte bekommen keinen Marker, kein `field_origins`. Entfernt jemand die Quelle, ist es von Handarbeit nicht zu unterscheiden.

— *Gefunden von:* Datenpflege · *Beleg:* ein Feld `properties.import_origin` genügt, kein DDL · `kein-import-marker`


### 🟠 Ein Fehlschlag mitten im Objekt hinterlässt ein halbes

Eine Fläche entsteht in drei Schritten mit je eigener Transaktion. Bricht der dritte ab, steht das Item auf „nicht importiert“, während Label und Region auf der Karte liegen — die Rücknahme erreicht sie nicht, weil sie „done“ verlangt.

— *Gefunden von:* Datenpflege · *Beleg:* garetien-uebernahme.php:602 ff., catch :1808 · `teilzustand`


### 🟠 Strömung: `source: editor` ohne Editor

Ohne Handeingabe wird „flussabwärts“ angenommen und als Editor-Entscheidung gespeichert. Und es ist schlimmer als notiert: der Prüfreiter „Flussrichtung unbekannt“ liest `source` gar nicht — die bloße Anwesenheit einer Richtung genügt, damit 129 neue Flüsse aus der Liste fallen, die genau das finden soll.

— *Gefunden von:* Abgleich · *Beleg:* garetien-uebernahme.php:1959 · review-path-sync.js:515 · `stroemung`


### 🟠 Die Wegenden rasten nicht ein

An beiden Enden wird bedingungslos eine *neue* Kreuzung angelegt, ohne im Umkreis nach einem vorhandenen Knoten zu suchen. Ergebnis: **0 von 129** Flüssen am Wegenetz, Median 0,663 Einheiten daneben — genau die Distanz, in der eine Einrastung griffe.

— *Gefunden von:* Abgleich · *Beleg:* garetien-uebernahme.php:2012 · Fenster-Auftrag §8.4 · `endkreuzungen-einrasten`


### 🟡 Flächen vor Wegen — die Reihenfolge ist nicht gebaut

Jede Abfrage steht auf `ORDER BY id`, nirgends nach Zieltyp. Der Stage-Entwurf nagelt das ausdrücklich fest, also braucht die Änderung einen Entscheid, nicht nur einen Patch.

— *Gefunden von:* Abgleich · *Beleg:* garetien-plan.php:1497, garetien-uebernahme.php:971 u. a. · `reihenfolge`


### 🟡 LOD-Spanne ungenutzt, Wiki-Zuweisung für Orte fehlt ganz

`lodmin`/`lodmax` werden geparst, gespeichert, bis in die Liste gereicht — und von niemandem ausgewertet. Und `wiki_settlement` kommt im ganzen Import-Modul nicht vor: ein importierter Ort startet ohne Zuweisung und fällt sofort in den Prüfhaken (heute schon 982 offene Orte).

— *Gefunden von:* Abgleich · *Beleg:* garetien-parser.php:89 → garetien-liste.php:718, kein Leser · `lod-wiki-ort`


## 06 · Zurücknehmen

*Der Rückweg — und wo er kürzer ist als der Hinweg.*


### 🔴 Die Identität ist eine Zeilennummer

Ein Objekt ohne Wiki-Artikel wird über seine Position im Export identifiziert. Schiebt VolkoV eine Zeile ein, verrutscht alles dahinter: Ablehnungen gelten nicht mehr, Importiertes bietet sich wieder an. Ein Kommentar versichert wörtlich das Gegenteil. **Für den Merge ist das der Hauptaufwand** — die Gruppe bekommt einen fünften Schlüssel.

— *Gefunden von:* Datenpflege + Vielimporteur · *Beleg:* garetien-plan.php:317 · sync_decision hängt daran · `identitaet-zeilennummer`


### 🔴 Ein Teil zurücknehmen löscht die ganze Region

Die Rücknahme sitzt auf der Region-id: „Silber Hain 3 zurücknehmen“ deaktiviert alle vier Flächen und alle Labels, und die drei übrigen Items zeigen danach auf eine tote Region. Die Region darf erst fallen, wenn die letzte Fläche fällt.

— *Gefunden von:* Datenpflege · *Beleg:* garetien-uebernahme.php:2430 → ecosystem.php:3684 · `merge-loescht-region`


### 🔴 Die Rücknahme lässt Quellen stehen — und nimmt anderswo zu viel

Beim Zurücknehmen eines *neuen* Objekts wird keine einzige Quellenverknüpfung gelöst, und der Katalogzähler zählt ohne `is_active` — er geht nie zurück. Umgekehrt löst die Rücknahme eines *Quellen*-Items **alle** Garetien-Quellen des Objekts, auch die eines anderen Items.

— *Gefunden von:* Datenpflege · *Beleg:* garetien-uebernahme.php:2412 ff. · :319 · `ruecknahme-quellen`


### 🔴 Endkreuzungen bleiben bei der Rücknahme liegen

Der Anleger gibt ihre Kennungen zurück, der Aufrufer wirft sie weg. Je zurückgenommenem Weg zwei Geisterknoten ohne Arm, ohne Quelle, ohne Spur — und ein zweiter Import legt zwei weitere auf dieselbe Koordinate, von denen das Routing nur eine sieht.

— *Gefunden von:* Datenpflege + Objektarten · *Beleg:* garetien-uebernahme.php:1722 (Rückgabewert verworfen) · :2420 · `endkreuzungen-waisen`


### 🟠 Die Massen-Rücknahme ist eine Anfrage je Objekt

1000 Objekte = 1000 sequenzielle POSTs, jeder mit zwei `CREATE TABLE IF NOT EXISTS`. Bei 300 ms sind das fünf Minuten, und ein Fehlschlag bei Nummer 137 hinterlässt einen halb zurückgenommenen Stapel — danach ist der Link weg.

— *Gefunden von:* Vielimporteur · *Beleg:* garetienRuecknahmeMengeSchritt:7913 · `massen-ruecknahme`


### 🟠 Der Quellen-Nachzug schreibt an gelöschte Objekte

Löscht ein Editor ein importiertes Objekt im normalen Karteneditor, bleibt sein Item auf „done“ — und der nächste Import legt dessen Quellenverknüpfung neu an, samt Revisionssprung und ~3 MB Revalidierung für jeden Besucher.

— *Gefunden von:* Datenpflege · *Beleg:* garetien-uebernahme.php:1256, catch greift nur bei unbekanntem Ziel · `nachzug-tot`


### 🟠 „Rückgängig“ stirbt beim nächsten Klick

Der Link hängt an der Statuszeile, und die wird vom nächsten „Auf die Stage“ zurückgesetzt. Der natürliche Rhythmus — importieren, weitermachen — tötet den Rückweg, bevor man den Fehler auf der Karte sieht.

— *Gefunden von:* Neuer Editor · *Beleg:* garetienStatusRuhe:995 · garetienStageKlick → :9018 · `rueckgaengig-stirbt`


### 🟡 Eine von Hand angelegte Stätte wird vom Import übernommen

Bei Namensgleichheit überschreibt der Import auch `origin` — heute harmlos (nur er schreibt), ab dem ersten Editor, der selbst eine anlegt, eine stille Enteignung samt späterer Deaktivierung fremder Arbeit.

— *Gefunden von:* Datenpflege · *Beleg:* settlement-places.php:88–107 · `staette-enteignung`


### 🟠 Eine Stätte ist für den Abgleich unsichtbar

`settlement_place` kommt im Abgleich überhaupt nicht vor. Nach einem Schlüsselwechsel gilt ein innerorts eingefügtes Objekt als neu, steht vorangehakt da — und wird ein zweites Mal angelegt, diesmal als Kartenpunkt. Zwei Existenzen ohne Verbindung.

— *Gefunden von:* Datenpflege · *Beleg:* 0 Treffer in garetien-abgleich.php / garetien-plan.php · `staette-unsichtbar`


## 07 · Das Fenster

*Größe, Tastatur, Telefon.*


### 🔴 Am Telefon ragt das Fenster 134 px aus dem Bild — mit beiden Kopfknöpfen

`min-width: 480px` schlägt `max-width: 100vw`: auf 390 px steht es bei x 44…524. Draußen liegen ✕ (510), − (472) und die Zieh-Ecke; von „Stage importieren“ bleiben 37 px. Zurückholen geht nicht — Verschieben steigt bei Touch aus, der Griff wird ausgeblendet, ein fixes Fenster erzeugt keinen Seitenscroll.

— *Gefunden von:* Fenster · *Beleg:* garetien-importer.css:78 gegen :82 · dialog-drag.js:209 · `minwidth`


### 🔴 Mit offenem Routenplaner steht es vollständig außerhalb

Der Versatz rechnet 350 + 26 + 18 = **394 px** — rechts neben einem 390-px-Schirm. Dass überhaupt etwas sichtbar ist, verdankt sich einem JS-Nebeneffekt, der den Planer beim Öffnen einklappt. Fällt er aus, öffnet sich ein unsichtbares Fenster.

— *Gefunden von:* Fenster · *Beleg:* garetien-importer.css:37 · Vorbild route-plan-map.js:95 macht es richtig · `planer-versatz`


### 🔴 Es gibt keine Telefon-Verzweigung

Null `@media` in der ganzen Datei, kein `avesmaps-phone`, kein `avesmapsIsPhoneViewport` — zwölf andere Stellen im Haus lesen diese Klasse. Das Fenster wurde nie gegen den Bildschirm gerechnet, nur gegen den Routenplaner.

— *Gefunden von:* Fenster · *Beleg:* grep über garetien-importer.css und die zwei JS-Dateien: 0 Treffer · `keine-phone-weiche`


### 🟠 „✦ Zentrieren“ fliegt das Objekt hinter das Fenster

Leaflet zentriert im vollen Viewport; das Fenster verdeckt bei 1024 px Breite 83 % davon. Der Knopf bewegt die Karte und liefert trotzdem nicht, wofür er da ist — und das trifft auch den Klick auf eine Listenzeile. Das Rezept liegt im Haus fertig.

— *Gefunden von:* Fenster · *Beleg:* review-garetien-karte.js:1799 · Vorbild getRouteFitBoundsOptions() · `zentrieren`


### 🟠 Solange der Importer offen ist, sind alle Tastaturbefehle der Karte tot

Der Riegel prüft `role="dialog"`, und das trägt der Importer — obwohl er ausdrücklich *nicht* modal ist und sein eigener Dateikopf verspricht, die Karte bleibe bedienbar. Zoom, WASD, die sechs Ansichten fallen aus.

— *Gefunden von:* Fenster · *Beleg:* keyboard-shortcuts.js:170 · Unterscheidung über aria-modal wäre da · `tastatur-tot`


### 🟠 Ohne Maus kommt man nicht an die Einzelansicht

Die Listenzeile ist ein `<div>` ohne `tabindex`; fokussierbar ist nur die Checkbox. Anhaken geht, ansehen nicht — und damit auch nichts, was nur dort steht. Das Haus sagt es in derselben CSS-Datei: andere Editoren rendern ihre Zeilen als `<button>`.

— *Gefunden von:* Fenster · *Beleg:* review-garetien-importer.js:1424 · editor-row.css:37 · `ohne-maus`


### 🟠 Nach jeder Handlung fällt der Fokus auf den Seitenanfang

Die Liste wird per `innerHTML` ersetzt; es gibt keinen `focus()`-Aufruf in der Datei. Wer mit der Tastatur hakt, tabbt sich danach erneut durch bis zu 8213 Checkboxen. Die Rollposition wird dagegen gerettet — der Weg dafür liegt daneben.

— *Gefunden von:* Fenster · *Beleg:* review-garetien-importer.js:1824 · garetienZeileHervorheben:6991 · `fokus-verloren`


### 🟡 Beim Öffnen wandert kein Fokus ins Fenster, und es gibt kein Escape

Dem Fenster fehlt `tabindex="-1"`, das seine sechs Nachbarn in derselben Datei tragen. Der Fokus bleibt auf dem Knopf im weggeschobenen Panel — sichtbar weg, im Tab-Index noch da.

— *Gefunden von:* Fenster · *Beleg:* index.html:4209 gegen 439/958/1019 · grep Escape: nur der HTML-Escaper · `kein-fokus-kein-escape`


### 🟡 Die Breite hat für die Reiterzeile exakt null Reserve

Gebaut sind **855 px** (der Stage-Entwurf verlangt 1000 — nie umgesetzt). Die linke Spalte misst damit 399,0 px, und die vier Reiter brauchen 399. Jeder Schirm darunter und jede wachsende Reiterzahl bricht sie zweizeilig.

— *Gefunden von:* Fenster · *Beleg:* garetien-importer.css:50, :115 · Kommentar bei :64 nennt die 399 · `855-reserve`


### 🟡 Der Rollkasten der Einzelansicht kann auf null schrumpfen

Er hat kein eigenes `min-height`, während das Listenwerkzeug darunter `flex: none` trägt. Bei kleinem Fenster bleibt von einem 900-px-Inhalt ein Streifen. Dass er überhaupt eigenständig rollt, ist richtig gebaut.

— *Gefunden von:* Fenster · *Beleg:* garetien-importer.css:518 gegen :1448 · `rollkasten-null`


### 🟡 Zwei Pixel Versatz zwischen den Spalten

Die linke Spalte polstert oben 8 px, die rechte 10 — die Hausform verlangt denselben Wert. Nichts bricht; es ist die Sorte Abweichung, die niemand meldet.

— *Gefunden von:* Fenster · *Beleg:* .gi-detail:522 statt var(--avm-col-pad) · `polster-2px`


### 🟢 Die Farben sind token-rein — das ist der stärkste Teil des Fensters

Ein einziges Farbliteral in 424 Deklarationszeilen, und das auf einer Kartenmarke. Die heiklen Kontraste sind in hell *und* dunkel nachgemessen, mit eigenen Rezepturen dort, wo die Hauspalette durchgefallen wäre.

— *Gefunden von:* Fenster · *Beleg:* garetien-importer.css:1159 als einzige Ausnahme · `farben-rein`


## 08 · Nur du kannst das entscheiden

*Fragen, an denen Arbeit hängt.*


### 🔧 Werden alle acht Bauwerksarten „Gebäude“?

**1356 Objekte** — zu viele, um es beiläufig zu entscheiden, und ein späteres Auseinandersortieren wäre Handarbeit an jedem einzelnen.

— *Gefunden von:* Typinventar · *Beleg:* 2026-08-27-garetien-typinventar-und-mapping.md · `o-bauwerksarten`


### 🔧 Sollen die Baronien ihre eigene Geometrie verlieren?

585 Junkertümer kommen mit Fläche herein; die Baronien darüber bekämen eine abgeleitete Grenze. Eine sichtbare Veränderung an bestehenden Gebieten — gehört dir vorgelegt, nicht als Nebenwirkung mitgeliefert.

— *Gefunden von:* Typinventar · *Beleg:* 2026-08-27-…-typinventar-und-mapping.md · dazu Befund „Baronie-Geometrie“ · `o-junkertuemer`


### 🔧 Rund 50 Quelltypen brauchen je eine Entscheidung

Die Stufen 2, 3 und 4 sind nicht gebaut. Ohne sie bleibt der Import auf die heute gemappten Typen beschränkt.

— *Gefunden von:* Sichtwerkzeug · *Beleg:* 2026-08-29-garetien-importer-sichtwerkzeug-design.md §6.4 · `o-quelltypen`


### 🔧 Was soll aus der Küste werden?

20 Linien, für die keine der vier Zielformen richtig ist. Bis das entschieden ist, gehört sie in „übersprungen“ — ein Vorschlag, den keine Einstellung richtig machen kann, ist schlimmer als kein Vorschlag.

— *Gefunden von:* Abgleich · *Beleg:* garetien-abgleich.php:143 · `o-kueste-was`


### 🔧 Die 32 Zweifelsfälle

Drei Muster: Zuflüsse mit eigenem Namen · mehrere ihrer Seen auf einer unserer Flächen · namenlose Nebenflüsse ohne Artikel. Ohne Einzelansicht nicht beurteilbar.

— *Gefunden von:* Fenster-Auftrag · *Beleg:* 2026-08-27-garetien-importer-fenster-auftrag.md §8.3 · `o-zweifelsfaelle`


### 🔧 Die fünf Meilen sind eine Zahl, keine Messung

Die 0,5 davor war an 27 Fällen gemessen und trennte sauber. Ob acht Kandidaten in dichter Gegend reichen, ist ungemessen.

— *Gefunden von:* Innerorts · *Beleg:* 2026-09-02-innerorts-import-design.md §6 · `o-innerorts-schwelle`


## 09 · Nie geprüft

*Was keiner der sieben Prüfläufe leisten konnte.*


### 🔧 Kein Handgriff lief je mit angemeldeter Sitzung

Alles ist am Code gemessen, nichts gegen die echte Datenbank. Dieselbe Lücke steht seit dem 27.08. in jeder Übergabe dieses Werkzeugs.

— *Gefunden von:* alle sieben Läufe · *Beleg:* gilt für alle Befunde dieser Liste · `n-sitzung`


### 🔧 Steht die Lizenz am übernommenen Objekt wirklich dran?

CC BY-NC-SA 3.0, „VolkoV / garetien.de“ — in der Übergabe markiert als **der einzige Punkt mit Rechtsfolge**. Für Kartenobjekte geht sie sauber durch das eine Quellensystem; bei Stätten erreicht sie keine Oberfläche.

— *Gefunden von:* Sichtwerkzeug · *Beleg:* 2026-08-29-…-sichtwerkzeug-design.md §6.5 · `n-lizenz`


### 🔧 Wie viele Namen tragen welches Suffix?

Zahl, ein bis zwei Großbuchstaben, ausgeschriebene Himmelsrichtung — ungemessen. `garetien.de` ist von hier per Egress gesperrt; die Zahlen müssten aus einem Lauf am PC kommen.

— *Gefunden von:* Merge-Regel · *Beleg:* Voraussetzung für die Merge-Regel · `n-suffixe`


### 🔧 Vier Fenster-Fragen sind nur im Browser zu klären

Ob Pinch-Zoom das Fenster ins Bild holt · ob die Zieh-Ecke unter Touch greifbar ist · der genaue Bruchpunkt der Reiterzeile · in welcher Reihenfolge das Tabbing nach einem Neuaufbau läuft.

— *Gefunden von:* Fenster · *Beleg:* kein Browser im Prüflauf verfügbar · `n-browser`
