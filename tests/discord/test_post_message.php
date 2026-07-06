<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
require __DIR__ . '/../../api/_internal/discord/post-message.php';

t_ok(avesmapsDiscordPostMessage('', '123', ['content' => 'x'])['ok'] === false, 'missing token -> not ok');
t_ok(avesmapsDiscordPostMessage('token', '', ['content' => 'x'])['ok'] === false, 'missing channel -> not ok');

t_done();
