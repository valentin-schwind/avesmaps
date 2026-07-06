<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
require __DIR__ . '/../../api/_internal/discord/store.php';

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
avesmapsDiscordEnsureCasesTable($pdo);

$id = avesmapsDiscordInsertCase($pdo, [
    'kind' => 'bug', 'title' => 'Absturz', 'body' => 'Karte hängt', 'location' => 'Gareth',
    'reporter' => 'valente', 'reporter_id' => '42', 'channel_id' => '111', 'created_at' => '2026-07-06 10:00:00',
]);
t_ok($id >= 1, 'insert returns an id');

$open = avesmapsDiscordOpenCases($pdo);
t_eq(count($open), 1, 'one open case');
t_eq($open[0]['title'], 'Absturz', 'open case title');
t_eq($open[0]['kind'], 'bug', 'open case kind');

t_ok(avesmapsDiscordCloseCase($pdo, $id, 'chef', '2026-07-06 12:00:00') === true, 'close an open case -> true');
t_eq(count(avesmapsDiscordOpenCases($pdo)), 0, 'no open cases after close');
t_ok(avesmapsDiscordCloseCase($pdo, $id, 'chef', '2026-07-06 12:00:00') === false, 'closing again -> false');
t_ok(avesmapsDiscordCloseCase($pdo, 9999, 'chef', '2026-07-06 12:00:00') === false, 'closing missing -> false');

t_done();
