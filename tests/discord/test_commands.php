<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
define('AVESMAPS_DISCORD_REGISTER_TEST', true);
require __DIR__ . '/../../api/discord/register-commands.php';

$defs = avesmapsDiscordCommandDefinitions();
$names = array_map(static fn(array $d): string => $d['name'], $defs);
t_ok($names === ['hilfe', 'bug', 'idee', 'frage', 'erledigt'], 'five commands in order');

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
