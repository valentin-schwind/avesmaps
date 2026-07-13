<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
require __DIR__ . '/../../api/_internal/discord/responses.php';
require __DIR__ . '/../../api/_internal/discord/faq.php';
require __DIR__ . '/../../api/_internal/discord/router.php';

$faq = [['id' => 'kostenlos', 'q' => 'Ist Avesmaps kostenlos?', 'a' => 'Ja.']];
$config = ['bug_channel_id' => '111', 'idea_channel_id' => '222', 'faq_channel_id' => '333'];

t_eq(avesmapsDiscordRouteInteraction(['type' => 1], $faq, $config)['response']['type'], AVESMAPS_DISCORD_PONG, 'PING -> PONG');

$help = avesmapsDiscordRouteInteraction(['type' => 2, 'data' => ['name' => 'hilfe']], $faq, $config);
t_eq($help['response']['data']['components'][0]['components'][0]['custom_id'], AVESMAPS_DISCORD_HELP_SELECT_ID, '/hilfe menu');

t_eq(avesmapsDiscordRouteInteraction(['type' => 2, 'data' => ['name' => 'frage']], $faq, $config)['response']['data']['custom_id'], AVESMAPS_DISCORD_QUESTION_MODAL_ID, '/frage -> question modal');

$pick = avesmapsDiscordRouteInteraction(['type' => 3, 'data' => ['custom_id' => AVESMAPS_DISCORD_HELP_SELECT_ID, 'values' => ['kostenlos']]], $faq, $config);
t_eq($pick['response']['data']['embeds'][0]['title'], 'Ist Avesmaps kostenlos?', 'select -> answer');

$btn = avesmapsDiscordRouteInteraction(['type' => 3, 'data' => ['custom_id' => AVESMAPS_DISCORD_QUESTION_BUTTON_ID]], $faq, $config);
t_eq($btn['response']['data']['custom_id'], AVESMAPS_DISCORD_QUESTION_MODAL_ID, 'question button -> modal');

$submit = avesmapsDiscordRouteInteraction([
    'type' => 5,
    'data' => ['custom_id' => AVESMAPS_DISCORD_QUESTION_MODAL_ID, 'components' => [
        ['type' => 1, 'components' => [['type' => 4, 'custom_id' => 'title', 'value' => 'Wie plane ich?']]],
        ['type' => 1, 'components' => [['type' => 4, 'custom_id' => 'description', 'value' => 'Wo klicke ich?']]],
    ]],
    'member' => ['user' => ['username' => 'valente', 'id' => '42']],
], $faq, $config);
t_eq($submit['type'], 'submit_case', 'question submit -> submit_case');
t_eq($submit['kind'], 'question', 'kind question');
t_eq($submit['channel_id'], '333', 'question -> faq channel');
t_eq($submit['values']['title'], 'Wie plane ich?', 'values captured');
t_eq($submit['reporter'], 'valente', 'reporter captured');
t_eq($submit['reporter_id'], '42', 'reporter id captured');

$bugSubmit = avesmapsDiscordRouteInteraction([
    'type' => 5, 'data' => ['custom_id' => AVESMAPS_DISCORD_BUG_MODAL_ID, 'components' => []],
    'user' => ['username' => 'x', 'id' => '1'],
], $faq, $config);
t_eq($bugSubmit['channel_id'], '111', 'bug submit -> bug channel');

$close = avesmapsDiscordRouteInteraction([
    'type' => 2, 'data' => ['name' => 'erledigt', 'options' => [['name' => 'nummer', 'value' => 42]]],
    'member' => ['user' => ['username' => 'chef']],
], $faq, $config);
t_eq($close['type'], 'close_case', '/erledigt -> close_case');
t_eq($close['case_id'], 42, 'close case id');
t_eq($close['closed_by'], 'chef', 'closed_by captured');

// /offen -> list_open_cases action (router stays side-effect-free; the DB fetch is the endpoint's job)
$open = avesmapsDiscordRouteInteraction(['type' => 2, 'data' => ['name' => 'offen']], $faq, $config);
t_eq($open['type'], 'list_open_cases', '/offen -> list_open_cases');

// idea kind: command, button, and modal submit -> idea channel (was untested)
t_eq(avesmapsDiscordRouteInteraction(['type' => 2, 'data' => ['name' => 'idee']], $faq, $config)['response']['data']['custom_id'], AVESMAPS_DISCORD_IDEA_MODAL_ID, '/idee -> idea modal');
t_eq(avesmapsDiscordRouteInteraction(['type' => 3, 'data' => ['custom_id' => AVESMAPS_DISCORD_IDEA_BUTTON_ID]], $faq, $config)['response']['data']['custom_id'], AVESMAPS_DISCORD_IDEA_MODAL_ID, 'idea button -> idea modal');
$ideaSubmit = avesmapsDiscordRouteInteraction(['type' => 5, 'data' => ['custom_id' => AVESMAPS_DISCORD_IDEA_MODAL_ID, 'components' => []], 'user' => ['username' => 'u', 'id' => '1']], $faq, $config);
t_eq($ideaSubmit['type'], 'submit_case', 'idea submit -> submit_case');
t_eq($ideaSubmit['kind'], 'idea', 'idea submit kind');
t_eq($ideaSubmit['channel_id'], '222', 'idea submit -> idea channel');

// fallback branches: each returns an ephemeral respond carrying a content message
foreach ([
    ['type' => 2, 'data' => ['name' => 'bogus']],
    ['type' => 3, 'data' => ['custom_id' => 'bogus']],
    ['type' => 5, 'data' => ['custom_id' => 'bogus', 'components' => []]],
    ['type' => 4],
] as $i => $unknown) {
    $r = avesmapsDiscordRouteInteraction($unknown, $faq, $config);
    t_eq($r['type'], 'respond', "fallback #{$i} -> respond");
    t_ok(isset($r['response']['data']['content']), "fallback #{$i} -> content message");
}

// FAQ id not found -> unknown-answer (a content message, not an embed)
$noFaq = avesmapsDiscordRouteInteraction(['type' => 3, 'data' => ['custom_id' => AVESMAPS_DISCORD_HELP_SELECT_ID, 'values' => ['does-not-exist']]], $faq, $config);
t_ok(isset($noFaq['response']['data']['content']), 'unknown FAQ id -> unknown-answer content');

// reporter fallback when no user is present
t_eq(avesmapsDiscordRouteInteraction(['type' => 5, 'data' => ['custom_id' => AVESMAPS_DISCORD_BUG_MODAL_ID, 'components' => []]], $faq, $config)['reporter'], 'Unbekannt', 'missing user -> reporter Unbekannt');

t_done();
