<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
require __DIR__ . '/../../api/_internal/discord/faq.php';

$faq = avesmapsDiscordLoadFaq(__DIR__ . '/../../api/discord/faq.de.json');
t_eq(count($faq), 7, '7 entries');
t_eq($faq[0]['id'], 'was-ist-avesmaps', 'first id');
$item = avesmapsDiscordFaqById($faq, 'kostenlos');
t_ok($item !== null && str_starts_with($item['a'], 'Ja.'), 'lookup by id');
t_eq(avesmapsDiscordFaqById($faq, 'nope'), null, 'unknown id -> null');
t_eq(avesmapsDiscordLoadFaq(__DIR__ . '/nope.json'), [], 'missing file -> []');

t_done();
