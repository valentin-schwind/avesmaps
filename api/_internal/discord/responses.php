<?php

declare(strict_types=1);

const AVESMAPS_DISCORD_HELP_SELECT_ID = 'help_faq_select';
const AVESMAPS_DISCORD_BUG_BUTTON_ID = 'open_bug_modal';
const AVESMAPS_DISCORD_IDEA_BUTTON_ID = 'open_idea_modal';
const AVESMAPS_DISCORD_QUESTION_BUTTON_ID = 'open_question_modal';
const AVESMAPS_DISCORD_BUG_MODAL_ID = 'bug_modal';
const AVESMAPS_DISCORD_IDEA_MODAL_ID = 'idea_modal';
const AVESMAPS_DISCORD_QUESTION_MODAL_ID = 'question_modal';

const AVESMAPS_DISCORD_EPHEMERAL_FLAG = 64;
const AVESMAPS_DISCORD_PONG = 1;
const AVESMAPS_DISCORD_CHANNEL_MESSAGE = 4;
const AVESMAPS_DISCORD_MODAL = 9;

const AVESMAPS_DISCORD_COLOR = 0x2E7D64;

function avesmapsDiscordKindMeta(string $kind): array {
    return match ($kind) {
        'bug' => ['emoji' => '🐞', 'label' => 'Bug', 'color' => 0xC0392B, 'channel_key' => 'bug_channel_id'],
        'idea' => ['emoji' => '💡', 'label' => 'Idee', 'color' => 0xF1C40F, 'channel_key' => 'idea_channel_id'],
        'question' => ['emoji' => '❓', 'label' => 'Frage', 'color' => AVESMAPS_DISCORD_COLOR, 'channel_key' => 'faq_channel_id'],
        default => ['emoji' => '📌', 'label' => 'Fall', 'color' => AVESMAPS_DISCORD_COLOR, 'channel_key' => ''],
    };
}

function avesmapsDiscordTruncate(string $text, int $max): string {
    if ($max <= 0) {
        return '';
    }
    if (mb_strlen($text) <= $max) {
        return $text;
    }

    return mb_substr($text, 0, $max - 1) . '…';
}

function avesmapsDiscordPongResponse(): array {
    return ['type' => AVESMAPS_DISCORD_PONG];
}

function avesmapsDiscordEphemeralMessage(array $data): array {
    $data['flags'] = AVESMAPS_DISCORD_EPHEMERAL_FLAG;

    return ['type' => AVESMAPS_DISCORD_CHANNEL_MESSAGE, 'data' => $data];
}

function avesmapsDiscordHelpResponse(array $faq): array {
    $options = [];
    foreach ($faq as $item) {
        if (!is_array($item)) {
            continue;
        }
        $options[] = [
            'label' => avesmapsDiscordTruncate((string) ($item['q'] ?? ''), 100),
            'value' => (string) ($item['id'] ?? ''),
        ];
    }

    $components = [];
    if ($options !== []) {
        $components[] = [
            'type' => 1,
            'components' => [[
                'type' => 3,
                'custom_id' => AVESMAPS_DISCORD_HELP_SELECT_ID,
                'placeholder' => 'Wähle eine Frage …',
                'options' => $options,
            ]],
        ];
    }
    $components[] = [
        'type' => 1,
        'components' => [
            ['type' => 2, 'style' => 2, 'custom_id' => AVESMAPS_DISCORD_BUG_BUTTON_ID, 'label' => 'Bug melden', 'emoji' => ['name' => '🐞']],
            ['type' => 2, 'style' => 2, 'custom_id' => AVESMAPS_DISCORD_IDEA_BUTTON_ID, 'label' => 'Idee einreichen', 'emoji' => ['name' => '💡']],
            ['type' => 2, 'style' => 2, 'custom_id' => AVESMAPS_DISCORD_QUESTION_BUTTON_ID, 'label' => 'Frage stellen', 'emoji' => ['name' => '❓']],
        ],
    ];

    return avesmapsDiscordEphemeralMessage([
        'embeds' => [[
            'title' => 'Avesmaps-Hilfe',
            'description' => 'Wähle unten eine häufige Frage aus – oder melde einen Bug, reiche eine Idee ein oder stell eine Frage.',
            'color' => AVESMAPS_DISCORD_COLOR,
        ]],
        'components' => $components,
    ]);
}

function avesmapsDiscordFaqAnswerResponse(array $item): array {
    return avesmapsDiscordEphemeralMessage([
        'embeds' => [[
            'title' => avesmapsDiscordTruncate((string) ($item['q'] ?? ''), 256),
            'description' => avesmapsDiscordTruncate((string) ($item['a'] ?? ''), 4096),
            'color' => AVESMAPS_DISCORD_COLOR,
        ]],
    ]);
}

function avesmapsDiscordUnknownAnswerResponse(): array {
    return avesmapsDiscordEphemeralMessage(['content' => 'Zu dieser Auswahl habe ich leider keine Antwort gefunden.']);
}

function avesmapsDiscordFeedbackModal(string $customId, string $title): array {
    return [
        'type' => AVESMAPS_DISCORD_MODAL,
        'data' => [
            'custom_id' => $customId,
            'title' => avesmapsDiscordTruncate($title, 45),
            'components' => [
                ['type' => 1, 'components' => [['type' => 4, 'custom_id' => 'title', 'style' => 1, 'label' => 'Titel / Kurzfassung', 'required' => true, 'max_length' => 100]]],
                ['type' => 1, 'components' => [['type' => 4, 'custom_id' => 'description', 'style' => 2, 'label' => 'Beschreibung', 'required' => true, 'max_length' => 1500]]],
                ['type' => 1, 'components' => [['type' => 4, 'custom_id' => 'location', 'style' => 1, 'label' => 'Wo? (URL oder Ort, optional)', 'required' => false, 'max_length' => 300]]],
            ],
        ],
    ];
}

function avesmapsDiscordBugModal(): array {
    return avesmapsDiscordFeedbackModal(AVESMAPS_DISCORD_BUG_MODAL_ID, '🐞 Bug melden');
}

function avesmapsDiscordIdeaModal(): array {
    return avesmapsDiscordFeedbackModal(AVESMAPS_DISCORD_IDEA_MODAL_ID, '💡 Idee einreichen');
}

function avesmapsDiscordQuestionModal(): array {
    return avesmapsDiscordFeedbackModal(AVESMAPS_DISCORD_QUESTION_MODAL_ID, '❓ Frage stellen');
}

function avesmapsDiscordCaseEmbedMessage(string $kind, int $caseId, array $values, string $reporter): array {
    $meta = avesmapsDiscordKindMeta($kind);
    $title = avesmapsDiscordTruncate((string) ($values['title'] ?? ''), 200);
    $description = avesmapsDiscordTruncate((string) ($values['description'] ?? ''), 4000);
    $location = trim((string) ($values['location'] ?? ''));

    $fields = [];
    if ($location !== '') {
        $fields[] = ['name' => 'Wo?', 'value' => avesmapsDiscordTruncate($location, 1024), 'inline' => false];
    }
    $fields[] = ['name' => 'Von', 'value' => avesmapsDiscordTruncate($reporter, 256), 'inline' => false];

    return [
        'embeds' => [[
            'title' => $meta['emoji'] . ' Fall #' . $caseId . ': ' . ($title !== '' ? $title : $meta['label']),
            'description' => $description,
            'color' => $meta['color'],
            'fields' => $fields,
        ]],
    ];
}

function avesmapsDiscordCaseConfirmResponse(string $kind, int $caseId): array {
    $meta = avesmapsDiscordKindMeta($kind);
    $word = match ($kind) {
        'bug' => 'Dein Bug',
        'idea' => 'Deine Idee',
        'question' => 'Deine Frage',
        default => 'Dein Fall',
    };

    return avesmapsDiscordEphemeralMessage(['content' => "Danke! {$word} wurde als Fall #{$caseId} aufgenommen. {$meta['emoji']}"]);
}

function avesmapsDiscordCloseConfirmResponse(int $caseId, bool $found): array {
    return avesmapsDiscordEphemeralMessage([
        'content' => $found
            ? "Fall #{$caseId} als erledigt markiert. ✅"
            : "Fall #{$caseId} nicht gefunden oder schon erledigt.",
    ]);
}

function avesmapsDiscordErrorResponse(string $message): array {
    return avesmapsDiscordEphemeralMessage(['content' => $message]);
}
