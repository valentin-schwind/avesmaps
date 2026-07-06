<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
require __DIR__ . '/../../api/_internal/discord/responses.php';

$faq = [['id' => 'a', 'q' => 'Frage A?', 'a' => 'Antwort A.']];

$help = avesmapsDiscordHelpResponse($faq);
t_eq($help['data']['flags'], AVESMAPS_DISCORD_EPHEMERAL_FLAG, 'help ephemeral');
t_eq($help['data']['components'][0]['components'][0]['custom_id'], AVESMAPS_DISCORD_HELP_SELECT_ID, 'help select');
$buttons = $help['data']['components'][1]['components'];
t_eq(count($buttons), 3, 'three action buttons');
t_eq($buttons[2]['custom_id'], AVESMAPS_DISCORD_QUESTION_BUTTON_ID, 'question button present');

$answer = avesmapsDiscordFaqAnswerResponse($faq[0]);
t_eq($answer['data']['embeds'][0]['title'], 'Frage A?', 'answer title');

$modal = avesmapsDiscordQuestionModal();
t_eq($modal['type'], AVESMAPS_DISCORD_MODAL, 'question modal type');
t_eq($modal['data']['custom_id'], AVESMAPS_DISCORD_QUESTION_MODAL_ID, 'question modal id');
t_eq(count($modal['data']['components']), 3, 'modal has 3 inputs');

$embed = avesmapsDiscordCaseEmbedMessage('bug', 42, ['title' => 'Absturz', 'description' => 'Hängt', 'location' => 'Gareth'], 'valente');
t_ok(str_contains($embed['embeds'][0]['title'], 'Fall #42'), 'embed shows case number');
t_ok(str_contains($embed['embeds'][0]['title'], 'Absturz'), 'embed shows title');
$names = array_map(static fn(array $f): string => $f['name'], $embed['embeds'][0]['fields']);
t_ok(in_array('Wo?', $names, true) && in_array('Von', $names, true), 'embed has Wo?/Von fields');

$embedNoLoc = avesmapsDiscordCaseEmbedMessage('idea', 7, ['title' => 'X', 'description' => 'Y', 'location' => ''], 'u');
$names2 = array_map(static fn(array $f): string => $f['name'], $embedNoLoc['embeds'][0]['fields']);
t_ok(!in_array('Wo?', $names2, true), 'no Wo? field when empty');

$confirm = avesmapsDiscordCaseConfirmResponse('question', 5);
t_ok(str_contains($confirm['data']['content'], 'Fall #5'), 'confirm shows case number');

t_ok(str_contains(avesmapsDiscordCloseConfirmResponse(5, true)['data']['content'], 'erledigt'), 'close-found message');
t_ok(str_contains(avesmapsDiscordCloseConfirmResponse(5, false)['data']['content'], 'nicht gefunden'), 'close-missing message');

t_eq(avesmapsDiscordKindMeta('bug')['channel_key'], 'bug_channel_id', 'bug -> bug channel');
t_eq(avesmapsDiscordKindMeta('question')['channel_key'], 'faq_channel_id', 'question -> faq channel');

t_done();
