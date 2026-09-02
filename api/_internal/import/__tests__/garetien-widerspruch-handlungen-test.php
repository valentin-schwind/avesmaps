<?php

declare(strict_types=1);

// Ein Artikel-Widerspruch bekommt HANDLUNGEN -- er war die einzige Sackgasse des Importers.
//
// 🔴 DER BEFUND (Owner 02.09.2026, Fall „Drommsel"): „der garetien importer hat die kategorie
// 'widerspricht'. trotzdem sehen wir immer wieder fälle, die eigentlich korrekt sind, wie z.b.
// die drommsel, eine sinnvolle erweiterung des flusses. ich kanns aber nicht importieren."
// Der Abgleich kennt ZWEI Sorten Widerspruch, und nur eine war bedienbar: ein `zufluss` wird
// `change_type:'new'` und laesst sich anlegen, ein `artikel_widerspruch` wurde ein `changed` auf
// unser getroffenes Objekt -- mit KEINEM geschriebenen Feld. Damit fand „Neu einfuegen" kein
// 'new'-Item, „Quelle + Artikel einfuegen" kein Feld `quelle`, und die Uebernahme warf das Item
// als „braucht eine Entscheidung von Hand" wieder heraus. Uebrig blieb „Ablehnen": der Fall war
// ausdruecklich als FRAGE AN EINEN MENSCHEN gebaut, aber der Mensch konnte seine Antwort
// nirgends hinschreiben.
//
// 🔴 GEBAUT WIRD NICHTS NEUES: der vierte Ausgang (avesmapsGaretienErgaenzungsEintraege) baut
// genau die zwei Angebote, die hier fehlen -- das Luecken-Item „Quelle" und das Zusatz-Item
// „trotzdem neu anlegen". Er galt nur fuer 'deckt_sich'.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           -d extension=php_pdo_sqlite.dll \
//           api/_internal/import/__tests__/garetien-widerspruch-handlungen-test.php

require_once __DIR__ . '/../garetien-plan.php';
require_once __DIR__ . '/../garetien-liste.php';

$pruefungen = 0;

// Der Fall Drommsel, wie ihn avesmapsGaretienFindeBestand liefert: der Artikel trifft unseren
// Fluss (staerkstes Signal, ein Wiki-Artikel gehoert genau einem Objekt), die Geometrie liegt
// 25 Meilen daneben -- ihre Zeile zeichnet ein Stueck, das wir nicht haben.
$widerspruch = [
    'status' => 'widerspricht', 'anlass' => 'artikel_widerspruch',
    'treffer_public_id' => 'a771eba8', 'treffer_name' => 'Drommsel',
    'grund' => 'Artikel trifft "Drommsel", liegt aber 25,0 Meilen entfernt',
    'abstand' => 8.34,
    'abschnitte' => [['public_id' => 'a771eba8', 'name' => 'Drommsel', 'punkte' => 16]],
];
$zeile = [
    'wiki' => 'ggp', 'ebene' => 'Gewaesser', 'zeile_nr' => 11, 'typ' => 'Bach',
    'namensraum' => 'Garetien', 'artikel' => 'Drommsel', 'anzeige' => 'Drommsel',
    'geo_art' => 'koordinaten', 'geo' => '20000 10000, 21000 11000, 22000 12000',
];
$ziel = avesmapsGaretienMappeTyp('Bach');

// =================================================================================================
// 1. DIE WEICHE -- wer geht durch den vierten Ausgang?
// =================================================================================================
// 💣 REIN GEFRAGT, nicht am Planbau abgelesen: avesmapsGaretienBaueSyncPlan braucht eine ganze
// Datenbank, und die Frage „welcher Ausgang" ist eine Entscheidung ueber ein Urteil, kein I/O.
assert(avesmapsGaretienUeberVierterAusgang($widerspruch) === true,
    'der Artikel-Widerspruch geht durch den vierten Ausgang');
assert(avesmapsGaretienUeberVierterAusgang([
    'status' => 'deckt_sich', 'anlass' => 'geometrie',
]) === true, 'und deckt_sich weiterhin auch');
$pruefungen += 2;

// 🔴 DER ZUFLUSS NICHT. Er ist im Staging ebenfalls 'widerspricht', hat aber laengst seinen
// eigenen Weg: avesmapsGaretienPlanEintrag macht ihn zu einem 'new' mit `entity_public_id` NULL.
// Durch den vierten Ausgang gefuehrt bekaeme er ein Luecken-Item auf SEINEN HAUPTFLUSS -- also
// genau den Schreibzugriff, den sein eigener Zweig seit dem 27.08.2026 ausdruecklich verhindert.
assert(avesmapsGaretienUeberVierterAusgang([
    'status' => 'widerspricht', 'anlass' => 'zufluss',
]) === false, '💣 ein Zufluss bleibt beim Einzeleintrag -- er darf seinen Hauptfluss nicht anfassen');
assert(avesmapsGaretienUeberVierterAusgang([
    'status' => 'neu', 'anlass' => null,
]) === false, 'ein Neufund hat nichts zu ergaenzen');
$pruefungen += 2;

// =================================================================================================
// 2. DIE ZWEI ANGEBOTE
// =================================================================================================
$eintraege = avesmapsGaretienEintraegeFuerUrteil($zeile, $ziel, $widerspruch, []);
$anlaesse = array_map(static function (array $e): string {
    return (string) ($e['after']['anlass'] ?? '');
}, $eintraege);
assert($anlaesse === ['ergaenzung', 'zusatz'],
    'Quelle nachtragen UND trotzdem neu anlegen, in dieser Reihenfolge: ' . implode(' | ', $anlaesse));
$pruefungen++;

// --- Das Luecken-Item: die Quelle an UNSEREM getroffenen Objekt.
$quelle = $eintraege[0];
assert($quelle['change_type'] === 'changed', 'das Quellen-Item schreibt an einem vorhandenen Objekt');
assert($quelle['entity_public_id'] === 'a771eba8', 'und zwar an dem, den der Artikel trifft');
// 💣 NUR die Quelle. Der Name wird seit dem 31.08.2026 nicht mehr geschrieben (Owner: „aber nicht
// den namen verändern") -- stuende 'name' hier, fiele das Item ausserdem unter „Namen ersetzen"
// statt unter „Quelle + Artikel einfuegen" (die Knoepfe unterscheiden an der Feldliste, nicht am
// Anlass).
assert($quelle['after']['felder'] === ['quelle'],
    'nur die Quelle: ' . implode(',', (array) $quelle['after']['felder']));
$pruefungen += 3;

// --- Das Zusatz-Item: ihr Verlauf als EIGENES Objekt daneben.
$zusatz = $eintraege[1];
assert($zusatz['change_type'] === 'new', '„trotzdem neu anlegen" legt an');
// 💣 NULL, nicht der Treffer -- sonst waere „zusaetzlich anlegen" in Wahrheit „unseres
// ueberschreiben". Dieselbe Regel wie beim Zufluss.
assert($zusatz['entity_public_id'] === null, '💣 und fasst unser Objekt NICHT an');
assert($zusatz['vorwahl_aus'] === true, 'und ist niemals vorangehakt');
$pruefungen += 3;

// 🔴 DAS LABEL DARF NICHT LUEGEN. „trotz Nähe zu" ist die Begruendung des deckt_sich-Falls; hier
// liegt das Objekt 25 Meilen daneben, nah ist daran nichts. Was die zwei Faelle verbindet, ist der
// TREFFER, nicht der Abstand.
assert(strpos((string) $zusatz['label'], 'trotz Nähe') === false,
    '🔴 kein „trotz Nähe" bei einem Widerspruch: ' . $zusatz['label']);
assert(strpos((string) $zusatz['label'], 'Drommsel') !== false,
    'aber der Nachbar wird benannt: ' . $zusatz['label']);
$pruefungen += 2;

// =================================================================================================
// 3. DER RUECKFALL -- ein Objekt ohne Vorschlag waere schlimmer als vorher
// =================================================================================================
// 💣 avesmapsGaretienErgaenzungsEintraege gibt bei LEERER Trefferliste `[]` zurueck. Ein
// Widerspruch, der so durch den vierten Ausgang liefe, haette danach GAR KEIN Item mehr -- und
// ohne Item gibt es nichts, worauf „Ablehnen" zeigen koennte. Der Fall verlore seine einzige
// heutige Handlung, weil er zwei neue bekommen sollte.
$ohneAbschnitt = $widerspruch;
$ohneAbschnitt['abschnitte'] = [];
$rueckfall = avesmapsGaretienEintraegeFuerUrteil($zeile, $ziel, $ohneAbschnitt, []);
assert(count($rueckfall) === 1, '💣 ohne getroffenen Abschnitt bleibt der Einzeleintrag stehen');
assert(($rueckfall[0]['after']['anlass'] ?? '') === 'artikel_widerspruch',
    'und es ist der alte Einzeleintrag, kein erfundener');
// ⚠️ Er ist damit weiterhin nicht uebernehmbar (avesmapsGaretienUebernehmen verwirft ihn als
// `stale`) -- aber er traegt „Ablehnen", und das ist genau der Stand von vorher. Der Rueckfall
// soll nichts verbessern, er soll nichts VERSCHLECHTERN.
assert($rueckfall[0]['change_type'] === 'changed', 'unveraendert ein changed');
$pruefungen += 3;

// ⚠️ Und deckt_sich behaelt sein bisheriges Verhalten: ohne Abschnitt KEIN Eintrag. Ein
// Einzeleintrag daraus waere ein 'changed' mit Anlass 'artikel', das die Uebernahme als `stale`
// verwirft -- ein Vorschlag, der niemals ausgefuehrt werden kann.
$deckendOhne = [
    'status' => 'deckt_sich', 'anlass' => 'artikel',
    'treffer_public_id' => 'w-9', 'treffer_name' => 'Alke',
    'grund' => 'Artikel trifft "Alke"', 'abstand' => 0.1, 'abschnitte' => [],
];
assert(avesmapsGaretienEintraegeFuerUrteil($zeile, $ziel, $deckendOhne, []) === [],
    '⚠️ deckt_sich ohne Abschnitt bleibt leer, wie bisher');
$pruefungen++;

// =================================================================================================
// 4. DIE KATEGORIE UEBERLEBT IHRE HANDLUNGSANGEBOTE
// =================================================================================================
// 🔴 Der Abgleich HAT einen Widerspruch festgestellt; dass wir dem Editor jetzt zwei Ausgaenge
// anbieten, aendert daran nichts. Ohne diesen Riegel faende avesmapsGaretienListeObjektUrteil das
// Luecken-Item ('ergaenzung') zuerst -- die Drommsel verschwaende aus dem Reiter „widersprüchlich"
// in die 305 Ergaenzungen, und der Reiter, in dem der Owner diese Faelle SUCHT, liefe leer.
$itemsWiderspruch = [
    ['anlass' => 'ergaenzung', 'change_type' => 'changed'],
    ['anlass' => 'zusatz', 'change_type' => 'new'],
];
assert(avesmapsGaretienListeObjektUrteil($itemsWiderspruch, 'widerspricht') === 'widerspruch',
    '🔴 der Widerspruch bleibt ein Widerspruch, auch mit Ergaenzungs- und Zusatz-Item');
$pruefungen++;

// ⚠️ Der Zufluss bleibt „zweifel" -- er ist im Staging derselbe 'widerspricht'. Der Riegel steht
// deshalb HINTER der Zufluss-Regel; davor haette er 490 Zeilen umkategorisiert.
assert(avesmapsGaretienListeObjektUrteil(
    [['anlass' => 'zufluss', 'change_type' => 'new']], 'widerspricht'
) === 'zweifel', '⚠️ ein Zufluss bleibt „zweifel", nicht „widerspruch"');
$pruefungen++;

// Und die uebrigen Wege der Funktion sind unberuehrt.
assert(avesmapsGaretienListeObjektUrteil(
    [['anlass' => 'ergaenzung', 'change_type' => 'changed']], 'deckt_sich'
) === 'ergaenzung', 'deckt_sich mit Luecken-Item heisst weiter „ergaenzung"');
assert(avesmapsGaretienListeObjektUrteil(
    [['anlass' => null, 'change_type' => 'new']], 'neu'
) === 'neu', 'und ein Neufund weiter „neu"');
$pruefungen += 2;

echo "OK garetien-widerspruch-handlungen: {$pruefungen} Zusicherungen\n";
