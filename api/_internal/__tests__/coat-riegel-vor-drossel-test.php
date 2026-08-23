<?php

declare(strict_types=1);

/**
 * Die REIHENFOLGE im Wappen-Proxy: erst der Riegel, dann die Drossel. Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/coat-riegel-vor-drossel-test.php
 *
 * 🔴 Gemessen am 23.08.2026 an der Live-Seite: `api/app/coat.php` antwortete auf eine
 * Wiki-Adresse mit `X-Avesmaps-Coat: abruf` und HTTP 502 -- ununterscheidbar davon, dass der
 * Riegel gar nicht greift. Er griff; nur sagte es niemand. Zwei Fehler steckten darin:
 *
 * (1) Die Absage nannte ihren Grund nicht. „Haemmern wir noch?" war von aussen nicht zu
 *     beantworten -- die Frage, an der der Owner drei Tage haengengeblieben ist.
 * (2) 💣 Der geriegelte Pfad lief in `avesmapsCoatDrosselFehlschlag` und schrieb einen Grabstein
 *     fuer eine Adresse, die NIE PROBIERT WURDE. Fuenf davon schliessen die Drossel global fuer
 *     30 Minuten, ohne dass je eine Anfrage nach draussen ging -- und beim Oeffnen des Riegels
 *     waeren alle beruehrten Adressen sechs Stunden gesperrt. Also kaputt genau dann, wenn wir
 *     die Wappen endlich holen wollen.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'. Neu starten mit: "
        . "php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

// dirname(__DIR__, 2) ist `api/` -- der Proxy liegt darunter in `app/`.
$pfad = dirname(__DIR__, 2) . '/app/coat.php';
assert(is_file($pfad), "coat.php muss unter $pfad liegen");
$quelle = (string) file_get_contents($pfad);

// ⚠️ Kommentare raus, BEVOR nach Code gesucht wird. Dieselbe Falle wie sonst: die Erklaerung
// nennt jeden Bezeichner, um den es geht, und ein Suchtreffer im Kommentar beweist nichts.
$code = preg_replace('#/\*.*?\*/#s', '', $quelle);
$code = preg_replace('#^\s*//.*$#m', '', (string) $code);
$code = (string) $code;

// ---- 1. Der Riegel wird VOR der Drossel gefragt ------------------------------------------------
// 💣 Den Riegel gibt es ZWEIMAL, mit Absicht (Teil 4) -- einmal in `avesmapsCoatFetch` weit oben
// in der Datei, einmal im Hauptpfad. Ein blosses strpos() findet den ERSTEN, also den falschen,
// und misst danach einen ganz anderen Codeabschnitt. Beim ersten Lauf genau so passiert: der
// Test meldete einen fehlenden Header, der zwei Bildschirmseiten weiter unten stand.
// Der Hauptpfad beginnt an seinem eigenen Marker.
// ⚠️ Der Marker muss VOR allem liegen, dessen Reihenfolge hier geprueft wird -- sonst
// verschwindet ein nach vorn gewanderter Riegel aus dem Messbereich und der Test meldet
// „nicht im Hauptpfad" statt „steht an der falschen Stelle". Beim Mutieren genau so passiert:
// richtig rot, irrefuehrend begruendet. `$key = sha1($url)` steht am Anfang des Hauptpfads.
$hauptpfad = strpos($code, 'key = sha1($url);');
assert($hauptpfad !== false, 'der Hauptpfad hat seinen Marker');
$riegel  = strpos($code, 'avesmapsWikiDateiAbrufErlaubt($url)', $hauptpfad);
$drossel = strpos($code, 'avesmapsCoatDrosselDarfHolen($dir', $hauptpfad);
assert($riegel !== false, 'der Riegel wird im Hauptpfad gefragt');
assert($drossel !== false, 'die Drossel wird im Hauptpfad gefragt');
assert($riegel < $drossel,
    'DER KERN VON TEIL 1: der Riegel steht VOR der Drossel. Andersherum bucht ein Abruf, der nie '
    . 'stattfand, einen Fehlschlag gegen das Wiki.');

// ---- 2. Der geriegelte Ausgang bucht KEINEN Fehlschlag -----------------------------------------
// 🔴 Das ist Fehler (2). Zwischen dem Riegel und seinem `avesmapsCoatFail` darf nichts stehen,
// was die Drossel anfasst.
// ⚠️ Nur der geriegelte AUSGANG, nicht alles bis zur Drossel: dazwischen steht der
// „drossel-fehlt"-Zweig, der zu Recht seinen eigenen Header traegt. Beim ersten Lauf genau
// daran haengengeblieben -- ein zu weit gefasster Bereich macht aus einer richtigen Regel
// einen Fehlalarm.
$ausgangEnde = strpos($code, 'avesmapsCoatFail', $riegel);
assert($ausgangEnde !== false && $ausgangEnde < $drossel, 'der geriegelte Ausgang endet in einem CoatFail');
$nachRiegel = substr($code, $riegel, ($ausgangEnde - $riegel) + 60);
assert(strpos($nachRiegel, 'avesmapsCoatDrosselFehlschlag') === false,
    'DER KERN VON TEIL 2: ein geriegelter Abruf ist KEIN Fehlschlag des Wikis und darf die '
    . 'Drossel nicht verschmutzen');
assert(strpos($nachRiegel, 'avesmapsCoatDrosselAdresseRuhen') === false,
    'und er legt auch keine Adresse schlafen');

// ---- 3. Die Absage nennt ihren Grund -----------------------------------------------------------
// 🔴 Das ist Fehler (1) -- und der Grund muss sich von den drei anderen unterscheiden, sonst ist
// er keiner.
assert(strpos($nachRiegel, "X-Avesmaps-Coat: geriegelt") !== false,
    'DER KERN VON TEIL 3: die geriegelte Absage traegt ihren eigenen Header');
foreach (['gedrosselt', 'drossel-fehlt', 'abruf'] as $anderer) {
    assert(strpos($nachRiegel, 'X-Avesmaps-Coat: ' . $anderer) === false,
        "der geriegelte Ausgang traegt nicht zugleich '$anderer'");
}

// ⚠️ 503, nicht 502: 502 heisst „das Gegenueber hat versagt" -- hier hat es niemand gefragt.
assert(preg_match('/geriegelt.{0,200}avesmapsCoatFail\(\s*503/s', $nachRiegel) === 1,
    'die geriegelte Absage ist ein 503, kein 502 -- das Wiki hat nicht versagt, es wurde nicht gefragt');

// ---- 4. Der Riegel in avesmapsCoatFetch BLEIBT ------------------------------------------------
// ⚠️ Zwei Ebenen mit Absicht: der Hauptpfad sagt den Grund, die Funktion deckt jeden ANDEREN
// Aufrufer ab. Wer die zweite als „doppelt" entfernt, oeffnet sie fuer alle uebrigen.
$fetch = strpos($code, 'function avesmapsCoatFetch');
assert($fetch !== false && $fetch < $hauptpfad, 'die Funktion steht vor dem Hauptpfad');
$fetchRumpf = substr($code, $fetch, 700);
// 🪤 Der VOLLSTAENDIGE Aufruf, nicht der blosse Name: eine Mutationsprobe benannte die Funktion
// in `…ErlaubtXX` um, und ein Teilstring-Vergleich hielt sie fuer unveraendert -- die Zusicherung
// war trivial erfuellt und haette den Wegfall des zweiten Riegels nie bemerkt.
assert(strpos($fetchRumpf, 'avesmapsWikiDateiAbrufErlaubt($url)') !== false,
    'DER KERN VON TEIL 4: der Riegel in avesmapsCoatFetch bleibt als zweite Ebene stehen');
assert(preg_match('/avesmapsWikiDateiAbrufErlaubt\(\$url\).{0,120}return \[null/s', $fetchRumpf) === 1,
    'und er BRICHT dort auch wirklich ab, statt nur gefragt zu werden');

// ---- 4b. DER RIEGEL DARF DEN CACHE NICHT BLOCKIEREN -------------------------------------------
// 🔴 Die wichtigste Zusicherung dieser Datei. Am 23.08.2026 stand schon einmal eine zweite Bremse
// VOR der ersten -- im Browser, gegen jede Wiki-Adresse -- und warf damit die ~118 Wappen mit weg,
// die laengst im Cache liegen und mit HTTP 200 ausgeliefert wurden. Zurueckgenommen in d68f56dc.
// **Eine Bremse vor dem Cache sieht nicht, was der Cache beantworten koennte.**
$cacheTreffer = strpos($code, 'avesmapsCoatServeFile($cachedPath');
assert($cacheTreffer !== false, 'der Cache-Treffer liefert die Datei aus');
assert($cacheTreffer < $riegel,
    'DER KERN VON TEIL 4b: der Cache-Treffer wird AUSGELIEFERT, bevor der Riegel gefragt wird -- '
    . 'sonst nimmt der Riegel die Wappen mit, die wir laengst haben');

// ⚠️ Und die Drossel ebenso: ein Wappen von der Platte kostet das Wiki nichts.
assert($cacheTreffer < $drossel, 'auch die Drossel steht hinter dem Cache-Treffer');

// ---- 5. Und der Riegel ist wirklich zu ---------------------------------------------------------
require_once dirname(__DIR__) . '/wiki/datei-riegel.php';
$wikiAdresse = 'https://de.wiki-aventurica.de/wiki/Spezial:Dateipfad/Wappen%20Gareth.png';
assert(avesmapsWikiDateiIstWikiHost($wikiAdresse) === true, 'die Adresse gilt als Wiki-Host');
assert(avesmapsWikiDateiAbrufErlaubt($wikiAdresse) === false,
    'DER KERN VON TEIL 5: der Riegel ist zu');

// ⚠️ Und er gilt NUR dem Wiki -- eine fremde Adresse darf er nicht mitsperren, sonst faellt mit
// ihm jede andere Bildquelle aus.
assert(avesmapsWikiDateiAbrufErlaubt('https://upload.wikimedia.org/x.png') === true,
    'fremde Hosts bleiben erlaubt');

echo "OK: coat-riegel-vor-drossel-test -- alle Zusicherungen gehalten\n";
