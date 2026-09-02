<?php

declare(strict_types=1);

/**
 * Der Korpus — Schluessel, Form, Artvorschlag, Ablage.
 *
 * Entwurf: docs/superpowers/specs/2026-09-01-bekannte-quellen-design.md
 *
 * Fahren: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *             api/_internal/app/__tests__/source-corpus-test.php
 */

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../source-corpus.php';

$anzahl = 0;
$zaehl = static function () use (&$anzahl): void {
    $anzahl++;
};

// ══ 1 · Der Schluessel ══════════════════════════════════════════════════════════════════════════

// Die vier Wirte, an denen der Entwurf gemessen wurde.
assert(avesmapsSourceCorpusKey('https://www.herzogtum-weiden.net/politik/liste-st/staedte/herzogenstadt-trallop')
    === 'herzogtum-weiden.net', 'www. faellt weg, der Pfad zaehlt nicht');
$zaehl();
assert(avesmapsSourceCorpusKey('http://westlande.de/index.php?title=Apfeldorn') === 'westlande.de',
    'ein Query-Teil zaehlt nicht');
$zaehl();

// 🔴 DIE EIGENTLICHE LEISTUNG: zwei Schreibweisen desselben Angebots fallen zusammen. Der erste
// Entwurf brauchte dafuer einen Mehrfachschluessel; die registrierbare Domain macht es umsonst.
assert(avesmapsSourceCorpusKey('https://wiki.punin.de/Baronie_Taubental')
    === avesmapsSourceCorpusKey('https://punin.de/'), 'wiki.punin.de und punin.de sind EIN Korpus');
$zaehl();
assert(avesmapsSourceCorpusKey('https://wiki.horaswiki.de/Foo') === 'horaswiki.de',
    'und horaswiki ebenso -- die Falle der ersten Entwurfsfassung');
$zaehl();

// ⚠️ Eine handgetippte Adresse ohne Schema parst PHP als PFAD. Ohne den zweiten Versuch waere sie
// korpuslos, und der Editor saehe „unbekannte Domain" fuer einen Wirt, den er laengst kennt.
assert(avesmapsSourceCorpusKey('herzogtum-weiden.net/ohne-schema') === 'herzogtum-weiden.net',
    'eine Adresse ohne https:// bekommt trotzdem ihren Korpus');
$zaehl();

// Gross/klein und ein Punkt am Ende sind dieselbe Domain.
assert(avesmapsSourceCorpusKey('https://WWW.Herzogtum-Weiden.NET./x') === 'herzogtum-weiden.net',
    'Grossschreibung und der Wurzelpunkt aendern den Schluessel nicht');
$zaehl();

// 💣 Eine URL-LOSE Quelle hat KEINEN Korpus. 357 Katalogzeilen sind genau das (Wiki-Publikationen
// ohne Adresse, live gemessen: 100 % offiziell, 0 Briefspiele) -- Werke, die ihren Titel tragen.
assert(avesmapsSourceCorpusKey('') === '', 'keine Adresse, kein Korpus');
$zaehl();
assert(avesmapsSourceCorpusKey('https://localhost/x') === '', 'ein Name ohne Punkt ist kein Korpus');
$zaehl();
assert(avesmapsSourceCorpusKey('https://192.168.0.1/x') === '',
    'eine IPv4-Adresse ist kein Korpus -- ihre „letzten zwei Labels" waeren Unfug');
$zaehl();

// ⚠️ Die bewusste Grenze: keine Public-Suffix-Liste. Was in der Tabelle steht, wird richtig
// aufgeloest; was nicht darinsteht, gruppiert zu GROB (zwei Wirte in einem Topf) statt zu fein.
assert(avesmapsSourceCorpusKey('https://beispiel.co.uk/seite') === 'beispiel.co.uk',
    'eine gelistete mehrteilige Endung wird richtig aufgeloest');
$zaehl();
assert(avesmapsSourceCorpusKey('https://beispiel.co.za/seite') === 'co.za',
    'eine NICHT gelistete gruppiert zu grob -- das ist die harmlosere Richtung, und sie steht so im Kommentar');
$zaehl();

// ══ 2 · Die Form ════════════════════════════════════════════════════════════════════════════════

// 🔴 DREI Formen. Alles Unbekannte faellt auf '' -- nie auf eine geratene Aussage.
assert(avesmapsSourceCorpusNormalizeForm('BELEGSTELLE') === 'belegstelle', 'Grossschreibung zaehlt nicht');
$zaehl();
assert(avesmapsSourceCorpusNormalizeForm('quatsch') === '', 'ein unbekannter Wert ist keine Aussage');
$zaehl();

// 💣 '' verhaelt sich wie `werk` -- das ist das HEUTIGE Verhalten (Titel vorn), also kein
// Rueckschritt fuer einen frischen Korpus.
assert(avesmapsSourceCorpusShowsCorpusName('belegstelle') === true, 'Belegstelle: Korpusname vorn');
$zaehl();
assert(avesmapsSourceCorpusShowsCorpusName('werk') === false, 'Werk: Titel vorn');
$zaehl();
assert(avesmapsSourceCorpusShowsCorpusName('') === false, 'unentschieden verhaelt sich wie Werk');
$zaehl();

// Der Vorschlag, an den LIVE gemessenen Verhaeltnissen (01.09.2026).
assert(avesmapsSourceCorpusFormSuggestion(637, 623) === 'werk', 'f-shop 0,98 -> Werke');
$zaehl();
assert(avesmapsSourceCorpusFormSuggestion(242, 242) === 'werk', 'ulisses 1,00 -> Werke');
$zaehl();
assert(avesmapsSourceCorpusFormSuggestion(39, 4) === 'belegstelle', 'westlande 0,10 -> Belegstellen');
$zaehl();
assert(avesmapsSourceCorpusFormSuggestion(33, 5) === 'belegstelle', 'punin 0,15 -> Belegstellen');
$zaehl();

// 💣 DIE TRAGENDE ZUSICHERUNG: bei einem NEUEN Korpus sagt das Verhaeltnis NICHTS. Eine Zeile
// ergibt immer 1,00 und saehe aus wie ein Werk. Wer hier vorschlaegt, raet -- und behauptet dabei,
// gemessen zu haben. Sechs der 15 Domains haben live genau eine Zeile.
assert(avesmapsSourceCorpusFormSuggestion(1, 1) === '', 'eine einzelne Zeile ergibt KEINEN Vorschlag');
$zaehl();
assert(avesmapsSourceCorpusFormSuggestion(2, 1) === '',
    'auch zwei Zeilen nicht -- unter der Schwelle ist das Verhaeltnis Arithmetik, kein Signal');
$zaehl();
assert(avesmapsSourceCorpusFormSuggestion(0, 0) === '', 'ein leerer Korpus ergibt keinen Vorschlag');
$zaehl();

// ══ 3 · Die Art ═════════════════════════════════════════════════════════════════════════════════

// 💣 DER FALL, DER DIE SCHLICHTE MEHRHEIT WIDERLEGT -- live gemessen an herzogtum-weiden.net.
// `sonstiges` ist die NICHT-Aussage; die schlichte Mehrheit ergaebe „sonstiges" und schriebe genau
// den Defekt fest, den dieser Umbau beseitigen soll.
assert(avesmapsSourceCorpusTypeSuggestion(['sonstiges' => 22, 'briefspiel' => 11]) === 'briefspiel',
    'Weiden: 22 Nicht-Aussagen schlagen 11 Aussagen NICHT');
$zaehl();
assert(avesmapsSourceCorpusTypeSuggestion(['briefspiel' => 38, 'sonstiges' => 1]) === 'briefspiel',
    'westlande: der klare Fall bleibt klar');
$zaehl();
assert(avesmapsSourceCorpusTypeSuggestion(['sonstiges' => 5]) === '',
    'nur Nicht-Aussagen ergeben keine Aussage');
$zaehl();
assert(avesmapsSourceCorpusTypeSuggestion([]) === '', 'nichts ergibt nichts');
$zaehl();

// ⚠️ Gleichstand -> '' . Ein Muenzwurf saehe aus wie eine Messung.
assert(avesmapsSourceCorpusTypeSuggestion(['briefspiel' => 4, 'abenteuer' => 4]) === '',
    'Gleichstand ist keine Aussage');
$zaehl();
assert(avesmapsSourceCorpusTypeSuggestion(['briefspiel' => 5, 'abenteuer' => 4]) === 'briefspiel',
    'eine Stimme Vorsprung genuegt aber');
$zaehl();

// ══ 4 · Ablage und Nachschlagen ═════════════════════════════════════════════════════════════════

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
avesmapsEnsureSourceCorpusTable($pdo);
avesmapsEnsureSourceCorpusTable($pdo); // idempotent, wie jede selbstheilende DDL im Haus
$zaehl();

$pdo->prepare(
    'INSERT INTO source_corpus (corpus_key, label, form, source_type, license, attribution, is_official)
     VALUES (:k, :l, :f, :t, :lic, :a, :o)'
)->execute([
    'k' => 'herzogtum-weiden.net', 'l' => 'Briefspiel (Weiden)', 'f' => 'belegstelle',
    't' => 'briefspiel', 'lic' => 'cc-by-nc-sa-3.0', 'a' => 'VolkoV', 'o' => 0,
]);

$korpora = avesmapsSourceCorpusReadAll($pdo);
assert(count($korpora) === 1 && isset($korpora['herzogtum-weiden.net']), 'die Zeile wird gelesen');
$zaehl();

// Der bekannte Wirt -- eine BELIEBIGE Unterseite trifft ihn, ohne dass sie je eingetragen wurde.
$treffer = avesmapsSourceCorpusForUrl($korpora, 'https://www.herzogtum-weiden.net/politik/liste-st/staedte/reichsstadt-baliho');
assert(is_array($treffer) && $treffer['label'] === 'Briefspiel (Weiden)',
    'eine nie gesehene Unterseite findet ihren Korpus -- das ist der ganze Zweck');
$zaehl();
assert($treffer['form'] === 'belegstelle' && $treffer['source_type'] === 'briefspiel'
    && $treffer['license'] === 'cc-by-nc-sa-3.0' && $treffer['attribution'] === 'VolkoV',
    'und bringt Form, Art, Lizenz und Nennung mit');
$zaehl();
assert(($treffer['known'] ?? false) === true, 'er ist als bekannt gekennzeichnet');
$zaehl();

// 🔴 Ein UNBEKANNTER Wirt ist KEIN Fehler: Schluessel als Beschriftung, Form ''. Ohne diesen Fall
// muesste jede neue Domain erst angelegt werden, bevor jemand eine Quelle eintragen kann.
$neu = avesmapsSourceCorpusForUrl($korpora, 'https://kahet-ni-kemi.de/irgendwas');
assert(is_array($neu) && $neu['label'] === 'kahet-ni-kemi.de' && $neu['form'] === '',
    'ein unbekannter Wirt bekommt seinen Schluessel als Beschriftung');
$zaehl();
assert(($neu['known'] ?? true) === false, 'und ist als unbekannt gekennzeichnet');
$zaehl();

// Eine Quelle ohne Adresse hat keinen Korpus -- null, nicht ein leerer Korpus.
assert(avesmapsSourceCorpusForUrl($korpora, '') === null, 'keine Adresse -> kein Korpus, und zwar null');
$zaehl();

// ══ 5 · Die Reichweite eines Korpus ═════════════════════════════════════════════════════════════

// Zwei Seiten desselben Wirts, eine fremde -- plus eine Adresse, die den Wirtsnamen nur im PFAD
// fuehrt. 💣 Genau die faengt ein `LIKE '%herzogtum-weiden.net%'` faelschlich mit; gerechnet wird
// deshalb ueber avesmapsSourceCorpusKey, also ueber DIESELBE Regel wie der Schluessel selbst.
// ⚠️ Die Reichweite liest `sources` und `feature_sources` -- die legt der Korpus NICHT an
// (er kennt sie nicht, siehe die Zusicherung am Ende). Hier stehen sie also eigens.
avesmapsEnsureFeatureSourceTables($pdo);
$anlegen = $pdo->prepare('INSERT INTO sources (url, url_hash, label, source_type, is_official) VALUES (:u, :h, :l, "sonstiges", 0)');
$ids = [];
foreach ([
    'a' => 'https://www.herzogtum-weiden.net/politik/eins',
    'b' => 'https://herzogtum-weiden.net/politik/zwei',
    'c' => 'https://westlande.de/albernia/drei',
    'd' => 'https://fremd.example/artikel/herzogtum-weiden.net',
] as $marke => $adresse) {
    $anlegen->execute(['u' => $adresse, 'h' => hash('sha256', $adresse), 'l' => 'X-' . $marke]);
    $ids[$marke] = (int) $pdo->lastInsertId();
}
$verknuepfen = $pdo->prepare(
    "INSERT INTO feature_sources (entity_type, entity_public_id, source_id, status) VALUES ('settlement', :id, :sid, 'approved')"
);
$verknuepfen->execute(['id' => 'o1', 'sid' => $ids['a']]);
$verknuepfen->execute(['id' => 'o2', 'sid' => $ids['a']]);
$verknuepfen->execute(['id' => 'o3', 'sid' => $ids['b']]);
$verknuepfen->execute(['id' => 'o4', 'sid' => $ids['c']]);
$verknuepfen->execute(['id' => 'o5', 'sid' => $ids['d']]);

$reichweite = avesmapsSourceCorpusUsage($pdo, 'herzogtum-weiden.net');
assert($reichweite['sources'] === 2, 'zwei Katalogzeilen gehoeren dem Wirt -- www. zaehlt nicht getrennt');
$zaehl();
assert($reichweite['objects'] === 3, 'sie haengen an drei Objekten');
$zaehl();

// 💣 Die Adresse, die den Namen nur im PFAD fuehrt, gehoert NICHT dazu. Ohne diese Zusicherung
// sieht ein `LIKE` genauso richtig aus wie die Schluesselregel.
assert(!in_array($ids['d'], [], true) && avesmapsSourceCorpusKey('https://fremd.example/artikel/herzogtum-weiden.net') === 'fremd.example',
    'ein Wirtsname im Pfad macht keinen Korpus');
$zaehl();

// Ein unbekannter Korpus hat die Reichweite null -- und ein leerer Schluessel fragt gar nicht erst.
assert(avesmapsSourceCorpusUsage($pdo, 'gibtesnicht.de') === ['sources' => 0, 'objects' => 0],
    'ein unbenutzter Korpus hat Reichweite null');
$zaehl();
assert(avesmapsSourceCorpusUsage($pdo, '') === ['sources' => 0, 'objects' => 0],
    'ein leerer Schluessel fragt die Datenbank gar nicht');
$zaehl();

// 💣 KEIN ZWEITES QUELLENSYSTEM (AGENTS.md §5). Dieses Modul darf `sources`/`feature_sources`
// nirgends schreiben -- wer hier Quellen ablegt, baut den Lore-Fehler von 2026-07-21 nach.
$quelltext = (string) file_get_contents(__DIR__ . '/../source-corpus.php');
$ohneKommentare = preg_replace('#/\*[\s\S]*?\*/|^[ \t]*//.*$#m', '', $quelltext) ?? '';
assert(preg_match('/\b(INSERT|UPDATE|DELETE)\b[\s\S]{0,80}\b(sources|feature_sources)\b/i', $ohneKommentare) !== 1,
    'das Korpus-Modul schreibt NIE in sources oder feature_sources');
$zaehl();
// Und es legt auch keinen Korpus selbst an -- das tut die Oberflaeche, nicht der Leser.
assert(strpos($ohneKommentare, 'INSERT INTO source_corpus') === false,
    'der Leser schreibt gar nicht; ein stiller Schreibvorgang im Lesepfad waere die Falle');
$zaehl();

echo "OK — {$anzahl} Zusicherungen (Korpus: Schluessel, Form, Art, Ablage)\n";
