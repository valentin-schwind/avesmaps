<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
require __DIR__ . '/../../api/_internal/discord/app-auth.php';

t_ok(avesmapsDiscordCheckAppToken('secret', 'secret') === true, 'match');
t_ok(avesmapsDiscordCheckAppToken('secret', 'nope') === false, 'mismatch');
t_ok(avesmapsDiscordCheckAppToken('', 'secret') === false, 'empty configured -> false');
t_ok(avesmapsDiscordCheckAppToken('secret', '') === false, 'empty provided -> false');

t_done();
