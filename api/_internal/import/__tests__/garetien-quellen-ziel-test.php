<?php

declare(strict_types=1);

// WO haengt die Quelle eines importierten Objekts? EINE Antwort, vier Frager.
//
// Owner 03.09.2026: „Der Garetien-Importer muss unser neues Quellsystem auch beruecksichtigen."
//
// 🔴 SCHRITT 5 DES QUELLEN-UMBAUS HAT DIE ABLAGE DER LANDSCHAFTSQUELLEN UMGEDREHT (03.09.2026):
// die FLAECHE traegt sie (`ecosystem:<region_public_id>`), die gebundene Beschriftung LIEST sie nur.
// Der Importer schrieb weiter nach der alten Regel -- `region:<label_public_id>` -- und zitierte
// sie in seinen Kommentaren woertlich („die Quellen einer Landschaft liegen … an ihrer
// BESCHRIFTUNG"). Gemessen gegen die Hausweiche:
//     avesmapsEcosystemLabelSourceTarget('eco-r1', 'mf-l1')  ->  ecosystem:eco-r1
//     Importer schrieb                                       ->  region:mf-l1
// Folge: Lizenz `cc-by-nc-sa-3.0` und Namensnennung „VolkoV / garetien.de" landeten an einer
// Stelle, die WEDER der Flaechenkasten NOCH die Infobox der Beschriftung liest. Das ist die
// Angabe mit RECHTSFOLGE (NOTICE.md) -- sie darf nicht unsichtbar werden.
//
// 💣 UND ES WAREN VIER ANTWORTGEBER, DIE SICH UNEINIG WAREN. Dieselbe Frage wurde an vier
// Stellen einzeln gerechnet, mit drei verschiedenen Ergebnissen:
//   · avesmapsGaretienUebernehmen        (Anlegen)             region + LABEL-id
//   · avesmapsGaretienErgaenzungAnwenden (Quelle ergaenzen)    region + LABEL-id (eigener SELECT)
//   · avesmapsGaretienQuelleZielAufloesen(Nachzug/Ruecknahme)  region + LABEL-id (eigener SELECT)
//   · garetien-plan.php                  („hat schon Quelle?") ROHES `ziel` als entity_type
// Der Planbau nahm `$ziel['ziel']` unveraendert -- also 'location' und 'label', wo die Schreiber
// 'settlement' und 'region' verknuepfen. Sein Bestandsvergleich konnte damit fuer Ortschaften und
// freie Beschriftungen NIE zutreffen und bot deren Quelle in jedem Lauf erneut an. „Eine Regel,
// die einen von zwei Erzeugern bindet, ist keine Regel" (AGENTS.md §11) -- hier waren es vier.
//
// ⭐ SEITHER: `avesmapsGaretienQuellenZiel` ist die EINE Antwort, und sie rechnet die Regel nicht
// selbst, sondern fragt die HAUSWEICHE `avesmapsEcosystemLabelSourceTarget`
// (api/_internal/app/ecosystem-label-link.php). Der Importer ist damit ihr erster Aufrufer im
// Produktivcode -- die Weiche wurde in Schritt 5 gebaut und hatte bis dahin keinen.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           -d extension=php_pdo_sqlite.dll \
//           api/_internal/import/__tests__/garetien-quellen-ziel-test.php

require_once __DIR__ . '/../garetien-uebernahme.php';

$pruefungen = 0;
$zaehl = static function () use (&$pruefungen): void { $pruefungen++; };
$wurzel = dirname(__DIR__, 4);

$ohneKommentare = static function (string $pfad): string {
    $aus = '';
    foreach (token_get_all((string) file_get_contents($pfad)) as $token) {
        if (is_array($token)) {
            if (in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
                continue;
            }
            $aus .= $token[1];
        } else {
            $aus .= $token;
        }
    }

    return $aus;
};

// =================================================================================================
// 1. Die vier Ziele -- und die FLAECHE ist der Grund fuer diesen Test
// =================================================================================================
assert(
    avesmapsGaretienQuellenZiel('region', 'eco-r1') === ['ecosystem', 'eco-r1'],
    'eine Flaeche traegt ihre Quelle SELBST, unter ecosystem:<region_public_id>'
);
$zaehl();

// 💣 Die alte Antwort, Zeichen fuer Zeichen -- sie darf nicht zurueckkommen.
assert(
    avesmapsGaretienQuellenZiel('region', 'eco-r1') !== ['region', 'eco-r1'],
    'nicht mehr entity_type region'
);
assert(
    avesmapsGaretienQuellenZiel('region', 'eco-r1')[1] === 'eco-r1',
    'und die id ist die REGION, nie die ihrer Beschriftung'
);
$zaehl();
$zaehl();

// --- Die drei uebrigen bleiben, wie sie waren (map-features.php, $entityTypeByFeatureType).
assert(avesmapsGaretienQuellenZiel('path', 'mf-w1') === ['path', 'mf-w1'], 'Weg unveraendert');
assert(
    avesmapsGaretienQuellenZiel('location', 'mf-o1') === ['settlement', 'mf-o1'],
    'ein Ort verknuepft als settlement -- NICHT als location, wie der Planbau annahm'
);
assert(
    avesmapsGaretienQuellenZiel('label', 'mf-l1') === ['region', 'mf-l1'],
    'ein FREIES Label (Berggipfel) bleibt region + eigene public_id'
);
$zaehl();
$zaehl();
$zaehl();

// 🔴 `ziel = 'label'` ist im ganzen Importer NUR der Berggipfel (AVESMAPS_GARETIEN_TYP_MAP,
// 'Berg'), und von dessen Beschriftungen haengt keine an einer Flaeche (AGENTS.md §11: berggipfel,
// vulkan, fluss und ebene sind die vier Namensarten ohne gleichnamige Flaechenart). Deshalb
// braucht diese Funktion KEINEN Nachschlag und ist rein -- siehe Abschnitt 3. Kommt je eine
// Zuordnung dazu, die auf ein GEBUNDENES Label zielt, faellt dieser Zaehler und die Weiche
// bekommt ihre Region hereingereicht.
assert(
    count(array_filter(
        AVESMAPS_GARETIEN_TYP_MAP,
        static fn (array $z): bool => ($z['ziel'] ?? '') === 'label'
    )) === 1,
    'genau eine Zuordnung zielt auf ein freies Label'
);
$zaehl();

// =================================================================================================
// 2. Ein unbekanntes Ziel ist LAUT, nie stillschweigend eine Flaeche
// =================================================================================================
// 💣 Vorher fiel ALLES, was nicht path/location/label war, in den Flaechen-Zweig -- auch ein
// leeres `ziel` aus einem alten Item. Das ist die falsche Richtung: die Quelle landet dann in
// einem ID-Raum, der zu diesem Objekt nicht gehoert, und niemand erfaehrt es. Beide Aufrufer
// fangen Throwable und melden den Fehlschlag je Item, halten den Lauf also nicht an.
foreach (['', 'territorium', 'settlement'] as $unbekannt) {
    $lautGeworden = false;
    try {
        avesmapsGaretienQuellenZiel($unbekannt, 'irgendwas');
    } catch (Throwable) {
        $lautGeworden = true;
    }
    assert($lautGeworden, "das Ziel '$unbekannt' wirft, statt eine Flaeche zu erraten");
    $zaehl();
}

// =================================================================================================
// 3. Die Regel wird GEFRAGT, nicht nachgebaut -- und der Nachschlag ist weg
// =================================================================================================
$uebernahme = $ohneKommentare($wurzel . '/api/_internal/import/garetien-uebernahme.php');
$plan = $ohneKommentare($wurzel . '/api/_internal/import/garetien-plan.php');

// 🔴 Die Antwort wohnt in garetien-plan.php, nicht in garetien-uebernahme.php -- weil die
// Abhaengigkeit in DIESE Richtung laeuft (uebernahme requires plan, nicht umgekehrt). Nur von
// dort aus sehen BEIDE Frager sie; in der Uebernahme waere sie fuer den Planbau unerreichbar,
// und der schriebe sich wieder seine eigene.
assert(
    str_contains($plan, 'function avesmapsGaretienQuellenZiel('),
    'die eine Antwort wohnt in garetien-plan.php -- dort sehen beide Frager sie'
);
assert(
    !str_contains($uebernahme, 'function avesmapsGaretienQuellenZiel('),
    'und nur dort, nicht zweimal'
);
$zaehl();
$zaehl();

assert(
    str_contains($plan, 'avesmapsEcosystemLabelSourceTarget'),
    'der Importer fragt die Hausweiche aus ecosystem-label-link.php'
);
$zaehl();

// ⭐ Und er bindet sie selbst ein: garetien-plan.php bekommt `../app/ecosystem.php` nicht,
// anders als garetien-uebernahme.php. Ohne den require_once im Funktionsrumpf waere der
// Planbau beim ersten Aufruf mit einem Fatal Error und LEEREM Rumpf ausgestiegen -- im
// Browser als „Unexpected end of JSON input" (AGENTS.md §11, die Falle vom 19.08.2026).
assert(
    str_contains($plan, "require_once __DIR__ . '/../app/ecosystem-label-link.php';"),
    'und bindet die Weiche selbst ein'
);
$zaehl();

// 🔴 KEIN eigener Nachschlag mehr: die Stellen, die `label_public_id` aus `ecosystem_region`
// holten, um eine Quelle daran zu haengen, sind fort. Die Region IST die Ablage.
assert(
    !str_contains($uebernahme, 'SELECT label_public_id FROM ecosystem_region'),
    'kein SELECT auf label_public_id fuer die Quellenfrage mehr'
);
$zaehl();

// 🔴 UND ES GIBT KEINEN ZWEITEN NAMEN FUER DIESELBE FRAGE. `avesmapsGaretienQuelleZielAufloesen`
// war der Antwortgeber fuer Nachzug und Ruecknahme; er ist nicht umbenannt, sondern aufgeloest --
// zwei Namen fuer eine Entscheidung sind genau die Divergenz, die dieser Umbau beseitigt.
assert(
    !function_exists('avesmapsGaretienQuelleZielAufloesen'),
    'der zweite Name fuer dieselbe Frage ist fort'
);
assert(!str_contains($uebernahme, 'avesmapsGaretienQuelleZielAufloesen'), 'auch im Quelltext');
$zaehl();
$zaehl();

// ⭐ Und die Antwort ist REIN -- kein PDO.
// 💣 Solange sie eines brauchte, war „wo haengt die Quelle" eine Frage an die Datenbank, und
// jede weitere Stelle schrieb sich ihren eigenen SELECT dafuer -- genau so sind die vier
// Antwortgeber entstanden.
$reinTypen = array_map(
    static fn (ReflectionParameter $p): string => (string) $p->getType(),
    (new ReflectionFunction('avesmapsGaretienQuellenZiel'))->getParameters()
);
assert(!in_array('PDO', $reinTypen, true), 'die Antwort braucht keine Datenbank');
$zaehl();

// =================================================================================================
// 4. VIER FRAGER, EINE ANTWORT -- die Zusicherung, die den Befund verhindert haette
// =================================================================================================
assert(
    str_contains($plan, 'avesmapsGaretienQuellenZiel('),
    'der Planbau fragt dieselbe Antwort wie die Schreiber'
);
$zaehl();

// 💣 Die ROHE Uebergabe von `$ziel['ziel']` als entity_type ist fort -- sie war der Grund, warum
// der Bestandsvergleich fuer Ortschaften und freie Labels nie zutraf.
assert(
    !str_contains($plan, "(string) \$ziel['ziel'], \$quellenSchluesselId"),
    'kein rohes ziel als entity_type mehr'
);
$zaehl();

// Alle Schreib-/Lesestellen gehen durch die eine Antwort. Gezaehlt wird der AUFRUF, nicht die
// Definition -- eine Zusicherung, die die Definitionszeile mittrifft, ist Vakuum (AGENTS.md §11,
// „Die Tempowerte gelten auch fuer die Karte").
$aufrufe = substr_count($uebernahme, 'avesmapsGaretienQuellenZiel(')
    - substr_count($uebernahme, 'function avesmapsGaretienQuellenZiel(');
assert($aufrufe >= 4, "mindestens vier Frager in der Uebernahme, gezaehlt: $aufrufe");
$zaehl();

// 🔴 Die alten Einzelantworten sind fort. Geprueft wird MIT schliessendem Hochkomma:
// `$entityType = 'settlement_place';` ist eine ANDERE Objektart (eine Staette innerhalb einer
// Stadt, ohne Kartenposition) und bleibt unberuehrt.
foreach (["\$entityType = 'region';", "\$entityType = 'settlement';", "\$entityType = 'path';"] as $alt) {
    assert(!str_contains($uebernahme, $alt), "die Einzelantwort $alt ist fort");
    $zaehl();
}

echo "OK -- $pruefungen Zusicherungen\n";
