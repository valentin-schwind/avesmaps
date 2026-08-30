<?php

declare(strict_types=1);

// Die Arbeitsliste des Fensters -- der Leseweg fuer die kommende Oberflaeche (Aufgabe 8).
// Entwurf: .superpowers/sdd/2026-08-27-garetien-importer-fenster/task-8-brief.md
//
// 🔴 REIN LESEND, und OHNE die 200er-Deckelung von avesmapsSyncPlanItems -- "das ist ihr ganzer
// Zweck, und 259 Zeilen sind kein Mengenproblem" (Mockup §4).
//
// 🔴 SIE SITZT HIER UND NICHT AN sync-plan.php: sie liest garetien_import_row (die 49 + 6 Zeilen,
// die gar keinen Vorschlag erzeugen) -- und was diese Tabelle kennt, steht innerhalb des
// Importers (Auftrag §5.5). Ein `liste` an sync-plan.php muessten die anderen sieben Arten
// mittragen.

require_once __DIR__ . '/garetien-plan.php';

/**
 * So viele Objekte je Antwort -- der Rest blaettert ueber `versatz`.
 *
 * 🔴 500 -> 10000 am 30.08.2026 (Owner: „setz das limit auf 10000 und ich [schau], ob wir alle auf
 * einmal im browser handeln koennen"). Damit reist ein ganzer Lauf in EINER Antwort.
 *
 * 💣 SIE HAT DEN SERVER NIE GESCHUETZT, und das war der Anlass, sie ueberhaupt zu messen:
 * avesmapsGaretienArbeitslisteObjekte liest ALLE Items des Laufs, baut ALLE Objekte samt
 * Geometrie -- und erst danach schneidet avesmapsGaretienArbeitsliste zu. Jede Seite kostet also
 * denselben vollen Aufbau wie alle Seiten zusammen; Blaettern ueber `versatz` war damit TEURER als
 * eine grosse Antwort, nicht billiger.
 *
 * ⚠️ GEMESSEN (30.08.2026, Lauf 9, live): 500 Objekte = 1,35 MB, davon 0,67 MB Geometrie
 * (18.748 Punkte, ~37,5 je Objekt -- unsere eigenen Wege liegen bei 7,8), 0,52 MB Text, 0,16 MB
 * Abschnitte. Mit der Koordinatenrundung unten sind es 1,00 MB je 500, also rund 16 MB fuer die
 * 8212 Objekte des Reiters „Offen".
 * 🔧 Ob ein Browser das traegt, misst der Owner -- deshalb steht hier 10000 und nicht 2000.
 * Reicht es nicht, ist der naechste Schritt NICHT eine kleinere Zahl, sondern die Geometrie aus
 * der Listenzeile heraus (sie ist die Haelfte der Nutzlast und wird nur fuer ANGEZEIGTE Objekte
 * gebraucht).
 */
const AVESMAPS_GARETIEN_LISTE_MAX = 10000;

/**
 * PURE: die Punkte einer Geometrie fuer die ANZEIGE -- auf Millimeterarbeit verzichtet.
 *
 * 🔴 FUER DIE ANZEIGE -- und, weil sie am OBJEKT haengt, auch fuer die Umkreissuche, die dieselben
 * Punkte liest (avesmapsGaretienNaeheAusObjekten). Das ist gemessen unbedenklich: gerundet wird auf
 * +-2,4 Meter, und der Umkreis betraegt eine ganze Karteneinheit = 4,8 Kilometer. Es steht hier
 * trotzdem, weil „nur Anzeige" sonst eine Behauptung waere, die der naechste Leser glaubt.
 * 🔴 Der Umrechner (avesmapsGaretienNachAvesmaps) rechnet roh in
 * Fliesskomma und rundet nie; PHP schreibt daraus `554.095820893` -- dreizehn Zeichen je Zahl.
 * Auf einer Karte von 0..1024 Einheiten, wo eine Einheit DREI MEILEN ist, ist die neunte
 * Nachkommastelle 4,8 Mikrometer. Drei Stellen sind 4,8 Meter und damit feiner als alles, was je
 * gezeichnet wird.
 * ⚠️ GEMESSEN: 0,67 -> 0,32 MB je 500 Objekte, also 26 % der GANZEN Antwort.
 *
 * 💣 DIE GESPEICHERTE GEOMETRIE WIRD NICHT ANGEFASST. Liste und Uebernahme lesen zwar beide
 * `after.geometry`, erzeugen daraus aber getrennte Ausgaben: diese Funktion fuer die Anzeige,
 * avesmapsGaretienGeoJsonNachHausvertrag fuer das Anlegen. Wer die Rundung stattdessen in
 * avesmapsGaretienZeilePunkte oder in den Umrechner legte, ruendete auch das, was in die KARTE
 * geschrieben wird -- und den Uebersprung-Riegel und die Umkreissuche gleich mit, die beide
 * dieselben Punkte lesen.
 */
function avesmapsGaretienListePunkteRunden(array $punkte): array
{
    $raus = [];
    foreach ($punkte as $punkt) {
        if (!is_array($punkt) || count($punkt) < 2) { continue; }
        $raus[] = [round((float) $punkt[0], 3), round((float) $punkt[1], 3)];
    }

    return $raus;
}

/**
 * Der Objekt-Schluessel EINES sync_plan_item -- alles vor dem ersten "|".
 *
 * 🔴 RULING P6 (Aufgabe 3, in garetien-plan.php): ein Abschnitts-Item traegt
 * `<basis>|<anlass>|<public_id>`, ein einfacher Neu-/Geaendert-Eintrag nur `<basis>` -- OHNE
 * Pipe. Am ersten "|" zu splitten liefert in beiden Faellen dieselbe Basis wie
 * avesmapsGaretienObjektSchluesselAusZeile, und das ist auch der einzige Ort, an dem diese
 * Formel entsteht -- hier wird sie nur benutzt, nie ein zweites Mal gebaut.
 */
function avesmapsGaretienObjektSchluessel(string $entityKey): string
{
    $pos = strpos($entityKey, '|');

    return $pos === false ? $entityKey : substr($entityKey, 0, $pos);
}

/**
 * Der VERTRAG dieser Funktion: sie liefert IMMER eine Liste von [x,y]-Paaren -- nie ein
 * einzelnes Paar, nie eine tiefere Ebene. Drei Eingabeformen (garetien-plan.php, Entwurf
 * §3.1/§3.4):
 * - LineString: `coordinates` ist bereits die Punktliste -- unveraendert durchgereicht.
 * - Polygon: `coordinates` ist eine Liste von Ringen; der AEUSSERE Ring (Index 0) ist die
 *   gesuchte Punktliste.
 * - Point: `coordinates` ist ein EINZELNES [x,y]-Paar (GeoJSON-Point-Form), seit
 *   29.08.2026 die dritte Form (Ort/Berggipfel-Label). Sie wird hier in eine Liste MIT
 *   GENAU EINEM Paar gewickelt.
 *
 * 🔴 Dieser dritte Fall fehlte bis zum 30.08.2026 -- ohne ihn lieferte diese Funktion fuer
 * einen Point das nackte Paar `[x, y]` zurueck, und `avesmapsGaretienNachLeaflet`
 * (js/review/review-garetien-karte.js) iteriert darueber wie ueber eine Punktliste: jede
 * der beiden ZAHLEN x und y wurde einzeln als „Punkt" gelesen, hatte kein `.length` und
 * fiel durch deren `< 2`-Riegel -- das Ergebnis war eine leere Punktliste, gemeldet als
 * „keine Geometrie fuer das Objekt".
 */
function avesmapsGaretienListeGeometriePunkte(array $geometry): array
{
    $koordinaten = $geometry['coordinates'] ?? [];
    $typ = $geometry['type'] ?? '';
    if ($typ === 'Polygon') {
        return (array) ($koordinaten[0] ?? []);
    }
    if ($typ === 'Point') {
        return $koordinaten === [] ? [] : [$koordinaten];
    }

    return (array) $koordinaten;
}

/**
 * Die gespeicherte Trefferauskunft EINER Staging-Zeile: `['deckung' => ?float, 'abschnitte' => [...]]`.
 * REIN -- kein I/O.
 *
 * ⚠️ FAELLT OFFEN AUS und wirft nie. Ein Lauf von vor dem 28.08.2026 traegt die Spalte gar nicht
 * oder leer; dann gilt genau das Verhalten von davor (die Abschnitte kommen allein aus den Items).
 * Ein halber oder kaputter Eintrag wird wie "nichts gespeichert" behandelt -- die Liste ist der
 * Arbeitsplatz eines Editors, und ein Wurf machte sie unbenutzbar, statt eine Zeile aermer zu sein.
 */
function avesmapsGaretienListeTrefferAuskunft(mixed $roh): array
{
    $leer = ['deckung' => null, 'abschnitte' => []];
    if (!is_string($roh) || trim($roh) === '') {
        return $leer;
    }
    $daten = json_decode($roh, true);
    if (!is_array($daten) || !isset($daten['abschnitte']) || !is_array($daten['abschnitte'])) {
        return $leer;
    }
    $deckung = $daten['deckung'] ?? null;

    return [
        'deckung' => is_numeric($deckung) ? (float) $deckung : null,
        'abschnitte' => array_values(array_filter(
            $daten['abschnitte'],
            static fn(mixed $a): bool => is_array($a) && ($a['public_id'] ?? null) !== null
        )),
    ];
}

/**
 * Der NENNER der Punktzahl: wie viele Probepunkte ihres Objekts ueberhaupt verglichen wurden.
 * REIN -- kein I/O.
 *
 * 🔴 KEINE ZWEITE RECHNUNG, sondern eine SUMME der schon gerechneten Zahlen: in
 * `avesmapsGaretienDeckung` zaehlt jeder Probepunkt fuer genau EINEN Abschnitt, die Summe der
 * Abschnittsdeckungen ist also die Zahl der Probepunkte. Deshalb steht sie nicht ein zweites Mal
 * in der Datenbank -- eine gespeicherte Zahl neben einer ableitbaren laeuft irgendwann auseinander.
 * 💣 Gezaehlt wird die GESPEICHERTE Liste, nie die vereinigte: die Item-Abschnitte sind eine
 * TEILMENGE, und ihre Summe waere ein zu kleiner Nenner ("9 von 10" statt "9 von 16").
 * ⚠️ 0 heisst "nicht gemessen" (alter Lauf ohne gespeicherte Liste), nicht "null Punkte".
 */
function avesmapsGaretienListeProbepunkte(array $gespeichert): int
{
    $summe = 0;
    foreach ($gespeichert as $abschnitt) {
        $summe += (int) ($abschnitt['punkte'] ?? 0);
    }

    return $summe;
}

/**
 * Die getroffenen Abschnitte EINES Objekts: die gespeicherte Trefferliste des Abgleichs,
 * VEREINIGT mit denen, die ein Item nennt. REIN -- kein I/O.
 *
 * 🔴 VEREINIGEN, NICHT ERSETZEN, und zwar FELDWEISE. Der Item-Abschnitt gewinnt bei gleicher
 * `public_id` -- er ist der juengere und der handlungsrelevante --, aber Felder, die nur die
 * gespeicherte Liste kennt (`name_gleich`), ueberleben. Ein pauschales Ersetzen in der einen
 * Richtung verloere den Namensbefund, in der anderen den Abschnitt ohne Item.
 * ⚠️ Die REIHENFOLGE ist die des Abgleichs (absteigend nach Deckung, `arsort` in
 * avesmapsGaretienDeckung) -- ein Editor liest von oben, und der am meisten abdeckende Abschnitt
 * gehoert dorthin. Was nur ein Item kennt, haengt sich hinten an.
 *
 * @param list<array> $gespeichert
 * @param array<string,array> $ausItems public_id => Abschnitt
 * @return list<array>
 */
function avesmapsGaretienListeAbschnitteVereinen(array $gespeichert, array $ausItems): array
{
    $raus = [];
    foreach ($gespeichert as $abschnitt) {
        $publicId = (string) $abschnitt['public_id'];
        $raus[$publicId] = isset($ausItems[$publicId])
            ? array_merge($abschnitt, $ausItems[$publicId])
            : $abschnitt;
    }
    foreach ($ausItems as $publicId => $abschnitt) {
        if (!isset($raus[$publicId])) {
            $raus[$publicId] = $abschnitt;
        }
    }

    return array_values($raus);
}

/**
 * Das FEINERE Urteil je Objekt (Brief Schritt 5). Feiner als der Staging-Wert: eine Zeile mit
 * `urteil='deckt_sich'` und Ergaenzungs-Items heisst hier 'ergaenzung' -- der Staging-Wert sagt,
 * was der Abgleich FAND, dieses Urteil sagt, was zu TUN ist.
 *
 * ⚠️ Reihenfolge ist eine PRIORITAET: der erste zutreffende Fall gewinnt, es wird nicht gezaehlt.
 *
 * @param list<array{anlass:?string, change_type:string}> $items
 */
function avesmapsGaretienListeObjektUrteil(array $items, string $stagingUrteil): string
{
    // 💣 DER ABGLEICH SCHREIBT `widerspricht`, ALLES ANDERE HEISST `widerspruch`.
    // `avesmapsGaretienUrteil` gibt `'status' => 'widerspricht'` zurueck (garetien-abgleich.php,
    // zwei Stellen) und das landet so in `garetien_import_row.urteil`. Die Bilanz-Eimer, die
    // Facetten des Urteil-Filters und die Zeilenbeschriftung im Fenster heissen dagegen alle
    // `widerspruch` -- der Item-Pfad unten liefert genau das.
    //
    // Ein Objekt OHNE Items faellt auf den Staging-Wert zurueck und war damit UEBERALL unsichtbar:
    // `isset($bilanz[...])` schlug fehl (die Laufzeile zaehlte weniger Objekte, als die Reiter
    // zusammen ergaben), `avesmapsGaretienUrteilInfo` fand keine Beschriftung, und der
    // Urteil-Filter konnte es nicht auswaehlen. Live gemeldet vom Owner am 29.08.2026:
    // Laufzeile „239 Zeilen" gegen Reiter 77 + 211 = 288.
    //
    // 🔴 Normalisiert wird HIER, nicht im Abgleich: der Wert steht schon in der Datenbank, und ein
    // umbenannter Erzeuger liesse jeden vorhandenen Lauf kaputt zurueck. Der Lesepfad hat genau
    // einen Eingang fuer den Staging-Wert -- diesen.
    // ⚠️ Und er steht VOR dem Kurzschluss `$items === []`, sonst greift er genau im Fall nicht,
    // fuer den es ihn gibt.
    if ($stagingUrteil === 'widerspricht') {
        $stagingUrteil = 'widerspruch';
    }

    if ($items === []) {
        return $stagingUrteil;
    }
    foreach ($items as $item) {
        if (in_array($item['anlass'], ['ergaenzung', 'umbenennung', 'geometrie'], true)) {
            return 'ergaenzung';
        }
    }
    foreach ($items as $item) {
        if ($item['anlass'] === 'zufluss') {
            return 'zweifel';
        }
    }
    foreach ($items as $item) {
        if ($item['change_type'] === 'new') {
            return 'neu';
        }
    }
    foreach ($items as $item) {
        if ($item['change_type'] === 'changed' && in_array($item['anlass'], ['artikel_widerspruch', 'zufluss'], true)) {
            return 'widerspruch';
        }
    }

    return $stagingUrteil;
}

/**
 * Der Bearbeitungsstand je Objekt (Brief Schritt 6). Wieder eine Prioritaet: EIN uebernommenes
 * Item macht das GANZE Objekt uebernommen, egal was die uebrigen Items sagen.
 *
 * ⚠️ "declined" kommt aus sync_decision und ist fuer diesen Import heute nie erreichbar (der
 * Import erzeugt keine Loeschungen, und nur eine Loeschung wird dort dauerhaft abgelehnt) --
 * die Zeile steht trotzdem hier, wortgetreu nach Brief Schritt 6, fuer den Tag, an dem ein
 * Ablehnungsweg dazukommt.
 *
 * @param list<array{selected:int, apply_state:?string, declined:bool}> $items
 */
function avesmapsGaretienListeObjektStand(array $items): string
{
    if ($items === []) {
        return 'offen';
    }
    foreach ($items as $item) {
        if ($item['apply_state'] === 'done') {
            return 'uebernommen';
        }
    }
    $alleAbgelehnt = true;
    foreach ($items as $item) {
        if (!$item['declined']) {
            $alleAbgelehnt = false;
            break;
        }
    }
    if ($alleAbgelehnt) {
        return 'abgelehnt';
    }
    // 🔴 HIER STAND BIS ZUM 29.08.2026 EIN ZWEIG `selected === 1 ⇒ 'vorgemerkt'`.
    // Er machte aus dem Haekchen eine EINBAHNTUER: die Zeile sprang beim Anhaken aus „Offen"
    // heraus in einen Reiter, in dem sie nicht mehr abhakbar war. Owner 29.08.2026:
    // „Markieren aendert nichts." Das Haekchen ist seither ein client-seitiger Marker
    // (Entwurf §3.2), und die Anzeige ist eine eigene Menge im Fenster (§3).
    // ⚠️ Die ZAHL bleibt: `reiter.vorgemerkt` wird weiter gezaehlt (siehe
    // avesmapsGaretienListeObjektHatVormerkung) und steht in der Fusszeile
    // („14 vorgemerkt · 3 abgelehnt · 0 uebernommen"). Sie ist kein Stand mehr, aber sie ist wahr.

    return 'offen';
}

/**
 * Traegt irgendein Item dieses Objekts ein Haekchen (`selected === 1`)? REIN -- kein I/O.
 *
 * 🔴 RULING R1 (Aufgabe 1, 29.08.2026): die Fusszeile zaehlt weiterhin „N vorgemerkt" -- diese
 * Zahl ist aber seit dem Entfernen des `vorgemerkt`-Zweigs oben KEIN Bearbeitungsstand mehr, den
 * man aus `$objekt['stand']` ablesen koennte. Sie bekommt deshalb eine EIGENE Rechnung statt der
 * gemeinsamen `$reiter[$objekt['stand']]++` in avesmapsGaretienArbeitsliste -- ein Haekchen ist
 * eine Markierung, kein Stand, und beide Fragen ("welcher Stand?" / "ist etwas angehakt?") duerfen
 * unabhaengig voneinander wahr sein. Ein bereits uebernommenes Objekt etwa traegt in aller Regel
 * ebenfalls ein angehaktes Item und zaehlt hier BEWUSST mit.
 *
 * @param list<array{selected:int}> $items
 */
function avesmapsGaretienListeObjektHatVormerkung(array $items): bool
{
    foreach ($items as $item) {
        if ((int) $item['selected'] === 1) {
            return true;
        }
    }

    return false;
}

/**
 * Passt ein fertig gebautes Objekt auf den Filter? REIN -- kein I/O.
 *
 * 💣 `ebene`/`typ`/`urteil`/`wiki` sind LISTEN (Mehrfachauswahl): eine leere Liste heisst
 * "kein Filter", nicht "nichts passt".
 */
function avesmapsGaretienListeObjektPasstFilter(array $objekt, array $filter): bool
{
    foreach (['ebene', 'typ', 'urteil', 'wiki'] as $feld) {
        $erlaubt = (array) ($filter[$feld] ?? []);
        if ($erlaubt !== [] && !in_array($objekt[$feld], $erlaubt, true)) {
            return false;
        }
    }
    // ⚠️ Fehlt der Schluessel GANZ (kein 'stand' im Filter), gilt "alle Staende zeigen" -- der
    // Endpunkt schickt immer einen Reiter, ein direkter Aufruf (Test, spaeterer Leser) darf
    // trotzdem den ganzen Bestand sehen.
    if (isset($filter['stand'])) {
        $stand = trim((string) $filter['stand']);
        if ($stand !== '' && $objekt['stand'] !== $stand) {
            return false;
        }
    }
    if (($filter['nur_mehrteilig'] ?? false) === true && count($objekt['abschnitte']) <= 1) {
        return false;
    }
    // ⚠️ Review I3: EIN Objekt OHNE Items faellt hier immer heraus (der `foreach` findet nichts,
    // `$hatUngehaktes` bleibt `false`) -- vertretbar, weil ein Objekt ohne Item auch kein Haekchen
    // hat, das ein Editor setzen koennte (weder "deckt sich" ohne Ergaenzung noch "uebersprungen"
    // haben je ein `sync_plan_item`). Nicht nur im Bericht, sondern hier im Code festgehalten.
    if (($filter['nur_ungehakt'] ?? false) === true) {
        $hatUngehaktes = false;
        foreach ($objekt['items'] as $item) {
            if ((int) $item['selected'] === 0) {
                $hatUngehaktes = true;
                break;
            }
        }
        if (!$hatUngehaktes) {
            return false;
        }
    }
    $suche = trim(mb_strtolower((string) ($filter['suche'] ?? ''), 'UTF-8'));
    if ($suche !== '' && !str_contains(mb_strtolower((string) $objekt['name'], 'UTF-8'), $suche)) {
        return false;
    }

    return true;
}

/**
 * Alle Objekte EINES Laufs, UNGEFILTERT und UNPAGINIERT -- der Bauabschnitt, den sich
 * avesmapsGaretienArbeitsliste (unten, Aufgabe 8) und avesmapsGaretienNaehe (Owner-Auftrag A,
 * 30.08.2026, "Imports in der Naehe anzeigen") teilen. Beide brauchen dieselben Objekte samt
 * ihrer schon fertig gebauten Geometrie -- eine zweite Fassung dieses Item-Merges liefe beim
 * naechsten Feld auseinander (AGENTS.md §11: "eine Regel, die einen von mehreren Lesern bindet,
 * ist keine Regel").
 *
 * 🔴 REIN LESEND, wie die Arbeitsliste selbst. Baut GENAU die Schritte 2-5, die vorher am Anfang
 * von avesmapsGaretienArbeitsliste standen, wortgleich -- nur ohne die Filterung/Bilanz danach,
 * die beide Aufrufer unterschiedlich brauchen (der eine filtert+seitet, der andere sucht im
 * ganzen Lauf nach einem Umkreis).
 *
 * @return array{plan_run_id: ?int, objekte: array<string, array>, angehakt: array{new:int, changed:int}}
 *   `plan_run_id` ist `null`, solange kein offener Vorschau-Lauf existiert -- dann ist `objekte`
 *   leer und `angehakt` beide 0, derselbe leere Zustand wie vor dem ersten Rechnen.
 */
function avesmapsGaretienArbeitslisteObjekte(PDO $pdo, int $importRunId): array
{
    $leer = ['plan_run_id' => null, 'objekte' => [], 'angehakt' => ['new' => 0, 'changed' => 0]];

    // 1. Der offene Vorschau-Lauf. Keiner da -> leere, aber gueltige Antwort (kein Fehler: das
    // ist der Normalfall vor dem ersten Rechnen).
    $lauf = avesmapsSyncPlanOpenRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND);
    if ($lauf === null) {
        return $leer;
    }
    $planRunId = (int) $lauf['id'];

    // 2. ALLE Items des Laufs -- OHNE LIMIT und NICHT ueber avesmapsSyncPlanItems (die deckelt
    // bei 200 je Gruppe, und genau das soll hier wegfallen).
    $itemStmt = $pdo->prepare(
        'SELECT id, entity_key, change_type, before_json, after_json, selected, apply_state'
        . ' FROM sync_plan_item WHERE run_id = :r ORDER BY id'
    );
    $itemStmt->execute([':r' => $planRunId]);
    $entscheidungen = avesmapsSyncPlanDecisions($pdo, AVESMAPS_GARETIEN_PLAN_KIND);

    $gruppen = [];              // Objektschluessel => Liste roher Items
    $angehaktNeu = 0;
    $angehaktGeaendert = 0;
    foreach ($itemStmt->fetchAll(PDO::FETCH_ASSOC) as $roh) {
        $entityKey = (string) $roh['entity_key'];
        $changeType = (string) $roh['change_type'];
        $after = json_decode((string) ($roh['after_json'] ?? ''), true);
        $before = json_decode((string) ($roh['before_json'] ?? ''), true);
        $entscheidungsSchluessel = avesmapsSyncPlanDecisionKey($entityKey, $changeType);

        $gruppen[avesmapsGaretienObjektSchluessel($entityKey)][] = [
            'id' => (int) $roh['id'],
            'change_type' => $changeType,
            'selected' => (int) $roh['selected'],
            'apply_state' => $roh['apply_state'] !== null ? (string) $roh['apply_state'] : null,
            'declined' => ($entscheidungen[$entscheidungsSchluessel]['declined_at'] ?? null) !== null,
            'after' => is_array($after) ? $after : [],
            'before' => is_array($before) ? $before : [],
        ];

        // `angehakt` zaehlt den GANZEN Lauf (fuer Aufgabe 16), nicht die gefilterte Sicht.
        if ((int) $roh['selected'] === 1) {
            if ($changeType === 'new') {
                $angehaktNeu++;
            } elseif ($changeType === 'changed') {
                $angehaktGeaendert++;
            }
        }
    }

    // 3. Die Staging-Zeilen dazuholen. RULING P1 (Aufgabe 6) hat urteil/grund an diese Tabelle
    // gehaengt -- genau die zwei Spalten, die diese Liste fuer die Zeilen OHNE Item braucht.
    // ⚠️ `abschnitte_json` kam am 28.08.2026 dazu (Aufgabe 13b). Ein Bestand, der die SPALTE noch
    // nicht traegt, muss weiter funktionieren -- deshalb faellt der Leseweg hier OFFEN aus und
    // liest dann genau das, was er vorher gelesen hat.
    // 🔴 KEIN `ALTER TABLE` auf einem Lesepfad: die Liste laeuft bei jedem Filterklick, und genau
    // diese Last ist die, vor der AGENTS.md §10 warnt. Der Nachzug sitzt im Planbau (Schreibweg).
    // ⚠️ Der Rueckfall verschluckt keinen echten Datenbankfehler: schlaegt auch er fehl, wirft er.
    $spalten = 'wiki, ebene, zeile_nr, typ, namensraum, artikel, anzeige, lodmin, lodmax, extra,'
        . ' geo_art, geo, urteil, grund';
    $lies = static function (string $auswahl) use ($pdo, $importRunId): PDOStatement {
        $stmt = $pdo->prepare(
            'SELECT ' . $auswahl . ' FROM garetien_import_row WHERE run_id = :r ORDER BY id'
        );
        $stmt->execute([':r' => $importRunId]);

        return $stmt;
    };
    try {
        $zeilenStmt = $lies($spalten . ', abschnitte_json');
    } catch (PDOException) {
        $zeilenStmt = $lies($spalten);
    }
    $zeilenNachSchluessel = [];
    foreach ($zeilenStmt->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        // 💣 Derselbe Schluessel wie in garetien-plan.php -- eine zweite Formel liefe beim ersten
        // Sonderzeichen auseinander und stuende dasselbe Objekt zweimal in der Liste.
        $zeilenNachSchluessel[avesmapsGaretienObjektSchluesselAusZeile($zeile)] = $zeile;
    }

    // 4. Objekte MIT Item bauen -- Name/Typ/Wiki/Ebene/Geometrie/Wiki-Link aus dem after des
    // ERSTEN Items, das sie traegt; ihre Staging-Zeile liefert nur urteil/grund UND die Felder,
    // die kein `after` kennt (lodmin/lodmax/extra), nach.
    $objekte = [];
    foreach ($gruppen as $key => $items) {
        $zeile = $zeilenNachSchluessel[$key] ?? null;
        unset($zeilenNachSchluessel[$key]);   // was danach uebrig bleibt, hat KEIN Item

        $erstesAfter = $items[0]['after'];

        // ⚠️ Nicht jedes Item traegt after.name (ein reines Quellen- oder Geometrie-Item nicht) --
        // genommen wird das ERSTE, das ihn wirklich hat, sonst der Name aus der Staging-Zeile.
        $name = '';
        foreach ($items as $item) {
            $kandidat = trim((string) ($item['after']['name'] ?? ''));
            if ($kandidat !== '') {
                $name = $kandidat;
                break;
            }
        }
        if ($name === '' && $zeile !== null) {
            $name = trim((string) ($zeile['anzeige'] ?? ''));
        }

        $ausItems = [];
        foreach ($items as $item) {
            $abschnitt = $item['after']['abschnitt'] ?? null;
            if (is_array($abschnitt) && ($abschnitt['public_id'] ?? null) !== null) {
                // Mehrere Items (Luecke, Umbenennung, Geometrie) koennen denselben Abschnitt
                // nennen -- ueber die public_id entdoppelt, sonst stuende er mehrfach da.
                $ausItems[(string) $abschnitt['public_id']] = [
                    'public_id' => (string) $abschnitt['public_id'],
                    'name' => (string) ($abschnitt['name'] ?? ''),
                    'punkte' => (int) ($abschnitt['punkte'] ?? 0),
                    'geometrie' => avesmapsGaretienListePunkteRunden((array) ($abschnitt['geometrie'] ?? [])),
                    // 💣 Die zweite feldweise Abschrift derselben Angabe (die erste steht in
                    // avesmapsGaretienAbschnittsEintrag, garetien-plan.php). Faellt sie an EINER
                    // der beiden Stellen weg, kappt der Server still -- AGENTS.md §9.
                    'verworfene_teile' => (int) ($abschnitt['verworfene_teile'] ?? 0),
                ];
            }
        }
        // 💣 Ein getroffener Abschnitt, der KEIN Item erzeugt, stuende sonst gar nicht da -- und
        // der Fall saehe kleiner aus, als er ist (Aufgabe 13b, der Gardel unter ihrer Natter).
        $treffer = avesmapsGaretienListeTrefferAuskunft($zeile['abschnitte_json'] ?? null);
        $abschnitte = avesmapsGaretienListeAbschnitteVereinen($treffer['abschnitte'], $ausItems);

        $urteilEingaben = [];
        foreach ($items as $item) {
            $urteilEingaben[] = ['anlass' => $item['after']['anlass'] ?? null, 'change_type' => $item['change_type']];
        }

        $objekte[$key] = [
            'key' => $key,
            'name' => $name,
            'typ' => (string) ($erstesAfter['typ'] ?? ($zeile['typ'] ?? '')),
            'wiki' => (string) ($erstesAfter['wiki'] ?? ($zeile['wiki'] ?? '')),
            'ebene' => (string) ($erstesAfter['ebene'] ?? ($zeile['ebene'] ?? '')),
            'urteil' => avesmapsGaretienListeObjektUrteil($urteilEingaben, (string) ($zeile['urteil'] ?? '')),
            'grund' => (string) ($zeile['grund'] ?? ($erstesAfter['urteil'] ?? '')),
            'abschnitte' => $abschnitte,
            'geometrie' => avesmapsGaretienListePunkteRunden(
                avesmapsGaretienListeGeometriePunkte((array) ($erstesAfter['geometry'] ?? []))
            ),
            // 🔴 IST IHR OBJEKT EINE FLAECHE ODER EINE LINIE? Der Browser kann das sonst nicht
            // wissen: avesmapsGaretienListeGeometriePunkte flacht einen Polygon auf seinen
            // AEUSSEREN RING ab, und eine flache Punktliste sieht aus wie eine Linie. Die Karte
            // zeichnete jeden See als gestrichelten Umriss statt als Flaeche -- 113 der 288
            // Objekte der Stufe 1 sind Flaechen (96 See, 15 Sumpf, 2 Meer).
            // 🔴 DURCHGEREICHT, NICHT HERGELEITET: `after.geometry.type` steht seit dem Planbau
            // da (garetien-plan.php). Aus `typ`/`subtyp` abzuleiten waere die hartkodierte
            // Typenliste, die Ruling R21 verworfen hat -- im Browser waere es zusaetzlich eine
            // zweite Wahrheit ueber eine Tabelle, die hier liegt.
            // ⚠️ `erster === letzter` ist KEIN Ersatz: die Punkte kommen roh aus garetien.de und
            // werden beim Bau nur in `[$punkte]` gewickelt -- ein unsauber geschlossener Ring ist
            // moeglich, und dann raet der Browser falsch.
            'geometrie_typ' => (string) ($erstesAfter['geometry']['type'] ?? ''),
            // 🔴 MELDUNG (30.08.2026): `seite_url`, NICHT `quelle.url` -- seit der Korrektur zeigt
            // `quelle.url` auf den Wirt allein (garetien.de/koschwiki.de, die zitierte Quelle),
            // `seite_url` bleibt die Export-Arbeitsseite dieser Zeile. Dieses Feld hier ist der
            // Artikel-Link im Review-Fenster (garetienDetailMetaMarkup), der braucht weiterhin die
            // konkrete Seite -- ein Rueckfall auf `quelle.url` wuerde ihn lautlos auf den Wirt
            // ziehen und der Editor koennte nicht mehr nachsehen, VON WELCHER Seite eine Zeile kam.
            'wiki_url' => (string) ($erstesAfter['seite_url'] ?? ($zeile !== null ? avesmapsGaretienSeitenUrlAusZeile($zeile) : '')),
            // Die Quelle, die beim Uebernehmen mitreist -- Beschriftung, Namensnennung, Lizenz.
            // 🔴 DATEN, keine Regel im Renderer: der Wortlaut ist eine Owner-Entscheidung, und ein
            // Browser, der ihn aus dem Wiki-Kuerzel ableitet, waere ihre zweite Fassung.
            'quelle' => (array) ($erstesAfter['quelle'] ?? []),
            // Als WAS wir es anlegen wuerden. Ohne dieses Feld sagt der Kopf nur ihren Typ.
            'subtyp' => (string) ($erstesAfter['subtyp'] ?? ''),
            // 🔴 Das Bach-Haekchen -- DURCHGEREICHT, nicht aus `typ === 'Bach'` hergeleitet.
            // Die Zuordnung (AVESMAPS_GARETIEN_TYP_MAP) entscheidet, was ein Bach ist; eine zweite
            // Fassung im Browser liefe beim ersten neuen Quelltyp auseinander.
            'is_bach' => avesmapsGaretienNachIstBach($erstesAfter),
            // 🔴 AUFGABE „Eingefuegt wird": DURCHGEREICHT, NICHT HERGELEITET -- dieselbe Lehre wie
            // beim `kind`-Feld darueber. `after.ziel` (path|region|location|label) steht seit dem
            // Planbau da (garetien-plan.php:143); die Einzelansicht braucht es, um zu wissen, WAS
            // fuer eine Vorschau sie zeigen darf (Flaeche/Beschriftung/Ort), ohne den Subtyp-String
            // im Browser gegen eine abgeschriebene Liste zu raten -- genau das Muster, das Ruling
            // R21 fuer `geometrie_typ` schon verworfen hat.
            'ziel' => (string) ($erstesAfter['ziel'] ?? ''),
            // 🔴 FIX-RUNDE 1 ZU AUFGABE 3: OHNE DIESES FELD WIRD AUSGERECHNET EIN SEE UNSICHTBAR.
            // `garetien-plan.php` schreibt `kind` (topographie/vegetation/null) laengst in `after`
            // (Zeile ~145, aus AVESMAPS_GARETIEN_TYP_MAP in garetien-abgleich.php) -- bis hierher
            // wurde es nie an den Client durchgereicht. Die Sicht-Tafel im Browser
            // (avesmapsGaretienSichtFuer, review-garetien-karte.js) braucht `kind` fuer JEDES
            // Regions-Ziel (See/Meer/Sumpf), um seine ECHTE Kartenfarbe herzuleiten
            // (`--color-ecosystem-<kind>-<subtyp>`). Ohne `kind` faellt ein See faelschlich in die
            // WEG-Ableitung (`--color-path-see`) -- ein Tokenname, den es nicht gibt, und der See
            // wird lautlos gar nicht gezeichnet. Ein Weg-Ziel (Fluss/Bach/Strom) traegt `kind: null`
            // und bleibt davon unberuehrt (siehe der Riegel in review-garetien-karte.js).
            'kind' => (string) ($erstesAfter['kind'] ?? ''),
            'seite' => $zeile !== null ? avesmapsGaretienSeitenNameAusZeile($zeile) : '',
            // 🔴 Deckungsgrad und Nenner kommen vom SERVER. Der Deckungsgrad IST das Ergebnis des
            // Abgleichs; der Nenner ist die Zahl der wirklich verglichenen Probepunkte, und die ist
            // NICHT ihre Punktzahl -- avesmapsGaretienProbepunkte duennt auf hoechstens
            // AVESMAPS_GARETIEN_PROBEPUNKTE aus. `geometrie.length` im Browser abzulesen ergaebe bei
            // ihrem Grossen Fluss "9 von 294" -- die 294 ist NICHT hier gemessen, sie ist die Zahl
            // aus dem Kopf von avesmapsGaretienDeckung (garetien-abgleich.php, gemessen 27.08.2026);
            // wer sie nachpruefen will, prueft sie DORT und nicht an dieser Abschrift.
            // ⚠️ 0 heisst "nicht gemessen", nicht "null Punkte" -- die Anzeige laesst „von N" dann weg.
            'deckung' => $treffer['deckung'],
            'probepunkte' => avesmapsGaretienListeProbepunkte($treffer['abschnitte']),
            'lodmin' => (string) ($zeile['lodmin'] ?? ''),
            'lodmax' => (string) ($zeile['lodmax'] ?? ''),
            'extra' => (string) ($zeile['extra'] ?? ''),
            'items' => array_map(static function (array $item): array {
                return [
                    'id' => $item['id'],
                    // 🔴 Der `change_type` reist MIT (28.08.2026, Aufgabe 15). Die Knopfleiste der
                    // Einzelansicht bietet „Neu einfuegen" genau fuer die `new`-Zeilen an, und ohne
                    // dieses Feld findet sie keine einzige -- der Knopf waere bei JEDEM Neuzugang
                    // und JEDEM Zweifel dauerhaft ausgegraut, also bei der grossen Mehrheit der
                    // Stufe 1. 🪤 Hier stand eine Zahl, und sie war doppelt gezaehlt; die Aufteilung
                    // steht im Auftrag §3.4 und wird DORT nachgeschlagen, nicht an dieser Abschrift.
                    // 💣 Durchgereicht, nicht hergeleitet: aus `anlass`/`abschnitt` zu erraten,
                    // welche Zeile die Basiszeile ist, waere eine zweite Fassung der Entscheidung,
                    // die garetien-plan.php getroffen hat (`$istNeu`).
                    'change_type' => $item['change_type'],
                    'anlass' => $item['after']['anlass'] ?? null,
                    'felder' => $item['after']['felder'] ?? [],
                    'selected' => $item['selected'],
                    'apply_state' => $item['apply_state'],
                    'before_name' => $item['before']['name'] ?? null,
                    'after_name' => $item['after']['name'] ?? null,
                    'abschnitt' => $item['after']['abschnitt'] ?? null,
                ];
            }, $items),
            'stand' => avesmapsGaretienListeObjektStand(array_map(static fn(array $item): array => [
                'selected' => $item['selected'],
                'apply_state' => $item['apply_state'],
                'declined' => $item['declined'],
            ], $items)),
        ];
    }

    // 5. Was jetzt noch in $zeilenNachSchluessel steht, hat KEIN Item -- die Zeilen, um die es in
    // Aufgabe 6 ging ("deckt sich" ohne Ergaenzung, "uebersprungen").
    foreach ($zeilenNachSchluessel as $key => $zeile) {
        // ⚠️ Auch hier steht die Trefferliste. Ein Objekt, das sich VOLLSTAENDIG deckt (jeder
        // getroffene Abschnitt traegt Namen UND Quelle), erzeugt kein einziges Item -- und ist
        // trotzdem genau der Fall, in dem ein Editor sehen will, WORAUF es liegt.
        $treffer = avesmapsGaretienListeTrefferAuskunft($zeile['abschnitte_json'] ?? null);
        $objekte[$key] = [
            'key' => $key,
            'name' => trim((string) ($zeile['anzeige'] ?? '')),
            'typ' => (string) ($zeile['typ'] ?? ''),
            'wiki' => (string) ($zeile['wiki'] ?? ''),
            'ebene' => (string) ($zeile['ebene'] ?? ''),
            // 🔴 DURCH DIESELBE NORMALISIERUNG wie oben -- `widerspricht` aus dem Abgleich
            // heisst hier `widerspruch`. 🪤 DIES IST DIE ZWEITE STELLE, an der ein Urteil in
            // die Liste eintritt (die erste ist der Item-Pfad). Beim ersten Reparaturversuch
            // am 29.08.2026 war nur die andere gebunden, und der Fehler blieb genau fuer die
            // Objekte OHNE Item stehen -- also fuer die, um die es ging. Eine Regel, die einen
            // von zwei Erzeugern bindet, ist keine Regel (AGENTS.md §11).
            'urteil' => avesmapsGaretienListeObjektUrteil([], (string) ($zeile['urteil'] ?? '')),
            'grund' => (string) ($zeile['grund'] ?? ''),
            'abschnitte' => $treffer['abschnitte'],
            'geometrie' => avesmapsGaretienListePunkteRunden(avesmapsGaretienZeilePunkte($zeile)),
            // ⚠️ LEER, und das ist richtig: diese Zeilen haben KEIN Item, also kein `after` und
            // damit keine Auskunft ueber die Form. Gezeichnet werden sie nie -- die Karte zeigt
            // nur, was ein Haekchen traegt, und ohne Item gibt es keins. Der Browser faellt bei
            // leerem Feld auf "Linie" zurueck, die zurueckhaltende Richtung.
            'geometrie_typ' => '',
            'wiki_url' => avesmapsGaretienSeitenUrlAusZeile($zeile),
            // ⚠️ LEER, und das ist die Auskunft: ohne Vorschlag reist auch keine Quelle mit, und
            // ein Zieltyp waere eine Behauptung ueber etwas, das gar nicht angelegt wird.
            'quelle' => [],
            'subtyp' => '',
            // Dieselbe Auskunft wie bei `subtyp`: ohne Item gibt es kein `after` und damit kein
            // `kind` -- leer ist hier die richtige Aussage, kein Versaeumnis.
            'kind' => '',
            // Dieselbe Auskunft wie bei `kind`: ohne Item kein `ziel`.
            'ziel' => '',
            'seite' => avesmapsGaretienSeitenNameAusZeile($zeile),
            'deckung' => $treffer['deckung'],
            'probepunkte' => avesmapsGaretienListeProbepunkte($treffer['abschnitte']),
            'lodmin' => (string) ($zeile['lodmin'] ?? ''),
            'lodmax' => (string) ($zeile['lodmax'] ?? ''),
            'extra' => (string) ($zeile['extra'] ?? ''),
            'items' => [],
            'stand' => 'offen',
        ];
    }

    return ['plan_run_id' => $planRunId, 'objekte' => $objekte, 'angehakt' => ['new' => $angehaktNeu, 'changed' => $angehaktGeaendert]];
}

/**
 * Die Arbeitsliste: EINE Zeile je Objekt, ihre Items daran -- und die Zeilen, die gar kein Item
 * erzeugen (Aufgabe 6: "deckt sich" ohne Ergaenzung, "uebersprungen"), trotzdem sichtbar.
 *
 * @param array{ebene?:list<string>, typ?:list<string>, urteil?:list<string>, wiki?:list<string>,
 *              suche?:string, nur_ungehakt?:bool, nur_mehrteilig?:bool, stand?:string,
 *              versatz?:int, anzahl?:int} $filter
 */
function avesmapsGaretienArbeitsliste(PDO $pdo, int $importRunId, array $filter): array
{
    $leer = [
        'ok' => true,
        'plan_run_id' => 0,
        'gesamt' => 0,
        'objekte' => [],
        'bilanz' => ['neu' => 0, 'ergaenzung' => 0, 'zweifel' => 0, 'widerspruch' => 0, 'deckt_sich' => 0, 'uebersprungen' => 0],
        'reiter' => ['offen' => 0, 'vorgemerkt' => 0, 'abgelehnt' => 0, 'uebernommen' => 0],
        'facetten' => ['ebene' => [], 'typ' => [], 'urteil' => [], 'wiki' => [], 'typ_kategorie' => []],
        'angehakt' => ['new' => 0, 'changed' => 0],
    ];

    $basis = avesmapsGaretienArbeitslisteObjekte($pdo, $importRunId);
    if ($basis['plan_run_id'] === null) {
        return $leer;
    }
    $planRunId = $basis['plan_run_id'];
    $objekte = $basis['objekte'];
    $angehaktNeu = $basis['angehakt']['new'];
    $angehaktGeaendert = $basis['angehakt']['changed'];

    // 6. Facetten und Bilanz zaehlen den LAUF -- VOR dem Filtern. Sonst faellt nach dem ersten
    // Klick jeder andere Wert auf 0, und der Trichter laesst sich nicht mehr oeffnen.
    //
    // 🔴 `typ_kategorie` ist Owner-Meldung 29.08.2026: der Trichter soll Typen, aus denen ohnehin
    // nichts zu holen ist ("BurgKlein" -- Entscheidung "raus damit" -- und alles ohne Zuordnung),
    // blasser darstellen. Die Kategorie kommt aus avesmapsGaretienTypKategorie (garetien-abgleich.php)
    // -- DERSELBEN Stelle, die auch den Zeilen-Riegel (avesmapsGaretienUeberspringGrund) speist.
    // Kein Nachbau der zwei Listen im Browser (AGENTS.md §5).
    $facetten = ['ebene' => [], 'typ' => [], 'urteil' => [], 'wiki' => [], 'typ_kategorie' => []];
    $bilanz = ['neu' => 0, 'ergaenzung' => 0, 'zweifel' => 0, 'widerspruch' => 0, 'deckt_sich' => 0, 'uebersprungen' => 0];
    $reiter = ['offen' => 0, 'vorgemerkt' => 0, 'abgelehnt' => 0, 'uebernommen' => 0];
    foreach ($objekte as $objekt) {
        foreach (['ebene', 'typ', 'urteil', 'wiki'] as $feld) {
            $wert = (string) $objekt[$feld];
            $facetten[$feld][$wert] = ($facetten[$feld][$wert] ?? 0) + 1;
        }
        // Reine Funktion des Typs -- fuer denselben Wert immer dasselbe Ergebnis, deshalb reicht
        // ein Eintrag je Typ (kein Zaehler wie bei den uebrigen Facetten).
        $typWert = (string) $objekt['typ'];
        if (!isset($facetten['typ_kategorie'][$typWert])) {
            $facetten['typ_kategorie'][$typWert] = avesmapsGaretienTypKategorie($typWert);
        }
        if (isset($bilanz[$objekt['urteil']])) {
            $bilanz[$objekt['urteil']]++;
        }
        if (isset($reiter[$objekt['stand']])) {
            $reiter[$objekt['stand']]++;
        }
        // RULING R1: `vorgemerkt` zaehlt NICHT aus `$objekt['stand']` -- der liefert diesen Wert
        // seit Aufgabe 1 nie mehr (avesmapsGaretienListeObjektStand). Sie ist die einzige der vier
        // Reiterzahlen mit einer EIGENEN Rechnung, siehe avesmapsGaretienListeObjektHatVormerkung.
        if (avesmapsGaretienListeObjektHatVormerkung($objekt['items'])) {
            $reiter['vorgemerkt']++;
        }
    }

    // 7. Objekte NACH dem Filtern schneiden -- die Facetten oben blieben unberuehrt davon.
    $gefiltert = array_values(array_filter(
        $objekte,
        static fn(array $objekt): bool => avesmapsGaretienListeObjektPasstFilter($objekt, $filter)
    ));

    $gesamt = count($gefiltert);
    $versatz = max(0, (int) ($filter['versatz'] ?? 0));
    $anzahl = (int) ($filter['anzahl'] ?? AVESMAPS_GARETIEN_LISTE_MAX);
    if ($anzahl <= 0 || $anzahl > AVESMAPS_GARETIEN_LISTE_MAX) {
        $anzahl = AVESMAPS_GARETIEN_LISTE_MAX;
    }

    return [
        'ok' => true,
        'plan_run_id' => $planRunId,
        'gesamt' => $gesamt,
        'objekte' => array_slice($gefiltert, $versatz, $anzahl),
        'bilanz' => $bilanz,
        'reiter' => $reiter,
        'facetten' => $facetten,
        'angehakt' => ['new' => $angehaktNeu, 'changed' => $angehaktGeaendert],
    ];
}

/**
 * Der Zuschlag ueber die eigene Ausdehnung hinaus (Owner-Auftrag A, 30.08.2026, woertlich:
 * "5 karteneinheiten von zentrum, entferntesten flaechepunkt entfernt"). Eine benannte Konstante,
 * keine Zahl im Ausdruck -- eine Zahl ohne Namen wird beim naechsten Zweifel geraten.
 *
 * 🔴 Am 30.08.2026 von 5,0 auf 1,0 gesenkt, nachdem der Owner den Knopf an echten Daten benutzt
 * hat: "geil funktioniert, aber der radius ist etwas groß, kannst du auf 1 karteneinheit stellen?"
 * ⚠️ Die Fixturen in garetien-naehe-test.php rechnen seither RELATIV zu dieser Konstante. Sie
 * waren auf die 5,0 geeicht ([105,100] ist genau 5 von [100,100]) und waeren bei dieser Senkung
 * alle vier gekippt -- an einer Stelle, an der nichts kaputt war. Wer den Wert wieder aendert,
 * braucht sie deshalb nicht anzufassen.
 */
const AVESMAPS_GARETIEN_NAEHE_ZUSCHLAG = 1.0;

/**
 * Owner-Auftrag A (30.08.2026), Knopf "Imports in der Naehe anzeigen": weitere Objekte DES
 * IMPORTS im groben Umkreis um ein bereits geladenes Objekt.
 *
 * Der Radius reicht ueber die eigene Ausdehnung hinaus: Mittelpunkt -> entferntester eigener
 * Punkt + AVESMAPS_GARETIEN_NAEHE_ZUSCHLAG. Fuer einen Punkt (Ort, Gipfel) ist der erste Teil 0,
 * der Radius also schlicht der Zuschlag -- genau die Zusicherung aus dem Auftrag.
 *
 * 🔴 SIE SUCHT UEBER DEN GANZEN LAUF, NIE UEBER EINE SEITE. Die Liste im Fenster haelt hoechstens
 * AVESMAPS_GARETIEN_LISTE_MAX von bis zu 8213 Objekten, zusaetzlich gefiltert -- eine Umkreissuche
 * ueber nur das GELADENE faende nur, was die Ansicht gerade zeigt, und die Zahl im Knopf haenge
 * dann von der Ansicht ab statt von der Karte. Das ist die Falschaussage ueber die naechste
 * Handlung, die dieses Fenster laut Auftrag schon mehrfach gekostet hat. Deshalb baut diese
 * Funktion auf avesmapsGaretienArbeitslisteObjekte auf, die den GANZEN Lauf liest.
 *
 * ⚠️ GROB, absichtlich: geprueft wird "hat der Nachbar irgendeinen Punkt im Kreis um den
 * Mittelpunkt", keine echte Flaechenueberschneidung -- derselbe Massstab wie der Abgleich selbst
 * (avesmapsGaretienDeckung, garetien-abgleich.php), der ebenfalls nur Punkte vergleicht statt
 * Geometrien zu schneiden.
 *
 * 💣 DER VORFILTER IST DIE HUELLBOX DES KANDIDATEN, FRISCH AUS SEINEN PUNKTEN GERECHNET -- NIE
 * eine gespeicherte Spalte. `garetien_import_row` hat gar keine bbox-Spalten, und der Abgleich
 * verbietet ihre Benutzung ohnehin aus gutem Grund (avesmapsGaretienKandidaten,
 * garetien-abgleich.php: eine gespeicherte bbox kann veralten). `min()`/`max()` ueber die schon
 * geladene Punktliste sind C-Funktionen und schneiden die grosse Mehrheit der weit entfernten
 * Kandidaten mit vier Vergleichen ab, bevor ihre Punkte einzeln gegen den Kreis geprueft werden --
 * derselbe Griff wie avesmapsGaretienHuellenBeruehrenSich (garetien-abgleich.php), nur mit dem
 * Radius als Rand statt der festen Trefferzone AVESMAPS_GARETIEN_TREFFER_EINHEITEN.
 *
 * @return array{gefunden: list<array>, radius: float}
 *   `gefunden` sind VOLLE Objekte, in der Form, die avesmapsGaretienArbeitslisteObjekte liefert --
 *   nicht nur Schluessel. Der Client kann sie damit direkt markieren UND anzeigen, ohne an die
 *   hoechstens 500 Zeilen der gerade geladenen Seite gebunden zu sein (Auftrag: "Wenn du siehst,
 *   dass die Serverantwort die Objekte ohnehin mitbringen koennte ... waere die Grenze weg statt
 *   nur benannt" -- sie kann es, siehe avesmapsGaretienArbeitslisteObjekte oben, also ist sie weg).
 *   Leer (`radius: 0.0`), wenn `$ziel` im Lauf nicht existiert oder keine eigene Geometrie traegt --
 *   ohne eigene Punkte gibt es keinen Mittelpunkt und keinen Radius.
 *
 * 🔴 REIN, KEIN PDO -- dieselbe Trennung wie bei avesmapsGaretienListeObjektUrteil/-Stand daneben:
 * die Umkreisrechnung selbst braucht keine Datenbank, nur die schon gebauten Objekte. Ihr
 * PDO-Zwilling avesmapsGaretienNaehe (Endpunkt-Aufrufer) ist ein duenner Wrapper, der nur noch
 * avesmapsGaretienArbeitslisteObjekte davorschaltet -- eine Testfixture braucht damit keine echten
 * Koordinaten aus garetien.de samt Affintransformation, sondern kann Objekte mit handgewaehlten
 * Karteneinheiten direkt uebergeben.
 *
 * @param array<string, array{geometrie: list<array{0:float,1:float}>}> $objekte
 */
function avesmapsGaretienNaeheAusObjekten(array $objekte, string $ziel): array
{
    $leer = ['gefunden' => [], 'radius' => 0.0];

    $zielObjekt = $objekte[$ziel] ?? null;
    if ($zielObjekt === null) {
        return $leer;
    }
    $eigenePunkte = (array) $zielObjekt['geometrie'];
    if ($eigenePunkte === []) {
        return $leer;
    }

    // Der Mittelpunkt -- der schlichte Durchschnitt der eigenen Punkte, wie
    // avesmapsGaretienRingMittelpunkt (garetien-uebernahme.php) ihn fuer eine Flaeche rechnet, nur
    // hier ohne die Abhaengigkeit auf den Schreibweg dieses Imports (§5.5: die Leseseite kennt
    // ausschliesslich ihre eigenen Nachbarn, kein Zweig dieser Datei braucht einen Schreibweg).
    $n = count($eigenePunkte);
    $cx = 0.0;
    $cy = 0.0;
    foreach ($eigenePunkte as $p) {
        $cx += (float) $p[0];
        $cy += (float) $p[1];
    }
    $cx /= $n;
    $cy /= $n;

    $eigenAbstand = 0.0;
    foreach ($eigenePunkte as [$px, $py]) {
        $d = sqrt((($px - $cx) ** 2) + (($py - $cy) ** 2));
        if ($d > $eigenAbstand) {
            $eigenAbstand = $d;
        }
    }
    $radius = $eigenAbstand + AVESMAPS_GARETIEN_NAEHE_ZUSCHLAG;
    $radiusQuadrat = $radius ** 2;

    $gefunden = [];
    foreach ($objekte as $key => $kandidat) {
        if ($key === $ziel) {
            continue;   // das Ziel selbst ist kein Nachbar seiner selbst
        }
        $punkte = (array) $kandidat['geometrie'];
        if ($punkte === []) {
            continue;
        }
        $xs = array_column($punkte, 0);
        $ys = array_column($punkte, 1);
        if (min($xs) > $cx + $radius || max($xs) < $cx - $radius
            || min($ys) > $cy + $radius || max($ys) < $cy - $radius) {
            continue;   // Huellbox-Vorfilter -- ganz ausserhalb des Suchquadrats
        }
        foreach ($punkte as [$px, $py]) {
            if ((($px - $cx) ** 2) + (($py - $cy) ** 2) <= $radiusQuadrat) {
                $gefunden[] = $kandidat;
                break;   // ein Treffer genuegt, der Rest seiner Punkte aendert daran nichts mehr
            }
        }
    }

    return ['gefunden' => $gefunden, 'radius' => $radius];
}

/**
 * Der PDO-Zwilling zu avesmapsGaretienNaeheAusObjekten -- liest den GANZEN Lauf (nie eine Seite,
 * siehe die Begruendung an der reinen Funktion oben) und reicht die Objekte durch.
 */
function avesmapsGaretienNaehe(PDO $pdo, int $importRunId, string $ziel): array
{
    $objekte = avesmapsGaretienArbeitslisteObjekte($pdo, $importRunId)['objekte'];

    return avesmapsGaretienNaeheAusObjekten($objekte, $ziel);
}
