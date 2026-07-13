<?php

declare(strict_types=1);

// Depends on responses.php + faq.php loaded by the caller.

function avesmapsDiscordExtractReporter(array $interaction): string {
    $user = $interaction['member']['user'] ?? $interaction['user'] ?? [];
    if (!is_array($user)) {
        return 'Unbekannt';
    }
    $name = (string) ($user['global_name'] ?? $user['username'] ?? '');

    return $name !== '' ? $name : 'Unbekannt';
}

function avesmapsDiscordExtractReporterId(array $interaction): string {
    $user = $interaction['member']['user'] ?? $interaction['user'] ?? [];

    return is_array($user) ? (string) ($user['id'] ?? '') : '';
}

function avesmapsDiscordModalValues(array $interaction): array {
    $values = [];
    foreach (($interaction['data']['components'] ?? []) as $row) {
        if (!is_array($row)) {
            continue;
        }
        foreach (($row['components'] ?? []) as $component) {
            if (!is_array($component)) {
                continue;
            }
            $id = (string) ($component['custom_id'] ?? '');
            if ($id !== '') {
                $values[$id] = (string) ($component['value'] ?? '');
            }
        }
    }

    return $values;
}

function avesmapsDiscordCommandOptionInt(array $interaction, string $name): int {
    foreach (($interaction['data']['options'] ?? []) as $option) {
        if (is_array($option) && ($option['name'] ?? '') === $name) {
            return (int) ($option['value'] ?? 0);
        }
    }

    return 0;
}

function avesmapsDiscordRespond(array $response): array {
    return ['type' => 'respond', 'response' => $response];
}

function avesmapsDiscordModalForKind(string $kind): array {
    return match ($kind) {
        'bug' => avesmapsDiscordBugModal(),
        'idea' => avesmapsDiscordIdeaModal(),
        'question' => avesmapsDiscordQuestionModal(),
        default => avesmapsDiscordErrorResponse('Unbekannte Aktion.'),
    };
}

function avesmapsDiscordSubmitCase(string $kind, array $interaction, array $discordConfig): array {
    $meta = avesmapsDiscordKindMeta($kind);
    $channelId = (string) ($discordConfig[$meta['channel_key']] ?? '');

    return [
        'type' => 'submit_case',
        'kind' => $kind,
        'channel_id' => $channelId,
        'values' => avesmapsDiscordModalValues($interaction),
        'reporter' => avesmapsDiscordExtractReporter($interaction),
        'reporter_id' => avesmapsDiscordExtractReporterId($interaction),
    ];
}

function avesmapsDiscordRouteInteraction(array $interaction, array $faq, array $discordConfig): array {
    $type = (int) ($interaction['type'] ?? 0);

    if ($type === 1) {
        return avesmapsDiscordRespond(avesmapsDiscordPongResponse());
    }

    if ($type === 2) {
        $name = (string) ($interaction['data']['name'] ?? '');
        if ($name === 'hilfe') {
            return avesmapsDiscordRespond(avesmapsDiscordHelpResponse($faq));
        }
        if ($name === 'bug' || $name === 'idee' || $name === 'frage') {
            $kind = $name === 'idee' ? 'idea' : ($name === 'frage' ? 'question' : 'bug');
            return avesmapsDiscordRespond(avesmapsDiscordModalForKind($kind));
        }
        if ($name === 'erledigt') {
            return [
                'type' => 'close_case',
                'case_id' => avesmapsDiscordCommandOptionInt($interaction, 'nummer'),
                'closed_by' => avesmapsDiscordExtractReporter($interaction),
            ];
        }
        if ($name === 'offen') {
            // Read-only overview; the DB fetch happens in the endpoint (via the open_cases dep),
            // mirroring how close_case keeps the router side-effect-free.
            return ['type' => 'list_open_cases'];
        }

        return avesmapsDiscordRespond(avesmapsDiscordErrorResponse('Unbekannter Befehl.'));
    }

    if ($type === 3) {
        $customId = (string) ($interaction['data']['custom_id'] ?? '');
        if ($customId === AVESMAPS_DISCORD_HELP_SELECT_ID) {
            $selected = (string) (($interaction['data']['values'][0]) ?? '');
            $item = avesmapsDiscordFaqById($faq, $selected);

            return avesmapsDiscordRespond($item !== null ? avesmapsDiscordFaqAnswerResponse($item) : avesmapsDiscordUnknownAnswerResponse());
        }
        $kind = match ($customId) {
            AVESMAPS_DISCORD_BUG_BUTTON_ID => 'bug',
            AVESMAPS_DISCORD_IDEA_BUTTON_ID => 'idea',
            AVESMAPS_DISCORD_QUESTION_BUTTON_ID => 'question',
            default => '',
        };
        if ($kind !== '') {
            return avesmapsDiscordRespond(avesmapsDiscordModalForKind($kind));
        }

        return avesmapsDiscordRespond(avesmapsDiscordErrorResponse('Unbekannte Aktion.'));
    }

    if ($type === 5) {
        $customId = (string) ($interaction['data']['custom_id'] ?? '');
        $kind = match ($customId) {
            AVESMAPS_DISCORD_BUG_MODAL_ID => 'bug',
            AVESMAPS_DISCORD_IDEA_MODAL_ID => 'idea',
            AVESMAPS_DISCORD_QUESTION_MODAL_ID => 'question',
            default => '',
        };
        if ($kind === '') {
            return avesmapsDiscordRespond(avesmapsDiscordErrorResponse('Unbekanntes Formular.'));
        }

        return avesmapsDiscordSubmitCase($kind, $interaction, $discordConfig);
    }

    return avesmapsDiscordRespond(avesmapsDiscordErrorResponse('Nicht unterstützt.'));
}
