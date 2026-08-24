<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
define('AVESMAPS_DISCORD_REGISTER_TEST', true);
require __DIR__ . '/../../../discord/register-commands.php';

$defs = avesmapsDiscordCommandDefinitions();
$names = array_map(static fn(array $d): string => $d['name'], $defs);
// 💣 Diese Liste ist der PUT an Discord: `register-commands.php` ERSETZT die Befehle der Gilde
// durch genau sie. Wer hier einen Namen vergisst, loescht ihn beim naechsten Lauf aus Discord.
// 🪤 Die Zusicherung stand vom 13.07. bis 25.08.2026 auf FUENF, waehrend `/offen` laengst der
// sechste war -- unbemerkt, weil dieser Test in `tests/discord/` lag und damit durch BEIDE
// Suchmuster des Deploy-Tors fiel (`__tests__/*.php` und `test-*.php`). Deshalb liegt er jetzt
// hier: ein Test, den niemand faehrt, ist kein Test.
t_ok($names === ['hilfe', 'bug', 'idee', 'frage', 'offen', 'erledigt'], 'six commands in order');

$erledigt = null;
foreach ($defs as $d) {
    if ($d['name'] === 'erledigt') {
        $erledigt = $d;
    }
}
t_ok($erledigt !== null && isset($erledigt['options'][0]), 'erledigt has an option');
t_eq($erledigt['options'][0]['name'], 'nummer', 'option is nummer');
t_eq($erledigt['options'][0]['type'], 4, 'option is integer');
t_ok($erledigt['options'][0]['required'] === true, 'option required');

t_done();
