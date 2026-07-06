<?php

declare(strict_types=1);

// Depends on signature.php + responses.php + router.php loaded by the caller.

function avesmapsDiscordProcessRequest(
    string $rawBody,
    string $signatureHex,
    string $timestampHeader,
    array $discordConfig,
    array $faq,
    array $deps
): array {
    if (!avesmapsDiscordVerifySignature((string) ($discordConfig['public_key'] ?? ''), $signatureHex, $timestampHeader, $rawBody)) {
        return ['status' => 401, 'body' => ['error' => 'invalid request signature']];
    }

    try {
        $interaction = json_decode($rawBody, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return ['status' => 400, 'body' => ['error' => 'invalid json']];
    }
    if (!is_array($interaction)) {
        $interaction = [];
    }

    $result = avesmapsDiscordRouteInteraction($interaction, $faq, $discordConfig);
    $type = (string) ($result['type'] ?? '');

    if ($type === 'submit_case') {
        try {
            $caseId = (int) $deps['insert']([
                'kind' => (string) $result['kind'],
                'title' => (string) ($result['values']['title'] ?? ''),
                'body' => (string) ($result['values']['description'] ?? ''),
                'location' => (string) ($result['values']['location'] ?? ''),
                'reporter' => (string) $result['reporter'],
                'reporter_id' => (string) $result['reporter_id'],
                'channel_id' => (string) $result['channel_id'],
            ]);
        } catch (Throwable) {
            return ['status' => 200, 'body' => avesmapsDiscordErrorResponse('Konnte gerade nicht gespeichert werden – bitte später erneut versuchen.')];
        }

        // Best-effort channel post; the case is already stored either way.
        try {
            $deps['post'](
                (string) $result['channel_id'],
                avesmapsDiscordCaseEmbedMessage((string) $result['kind'], $caseId, (array) $result['values'], (string) $result['reporter'])
            );
        } catch (\Throwable $e) {
            // best-effort: the case is already stored; ignore post failure
        }

        return ['status' => 200, 'body' => avesmapsDiscordCaseConfirmResponse((string) $result['kind'], $caseId)];
    }

    if ($type === 'close_case') {
        $caseId = (int) ($result['case_id'] ?? 0);
        try {
            $found = $caseId > 0 && (bool) $deps['close']($caseId, (string) ($result['closed_by'] ?? ''));
        } catch (Throwable) {
            return ['status' => 200, 'body' => avesmapsDiscordErrorResponse('Konnte den Fall gerade nicht aktualisieren.')];
        }

        return ['status' => 200, 'body' => avesmapsDiscordCloseConfirmResponse($caseId, $found)];
    }

    return ['status' => 200, 'body' => $result['response'] ?? avesmapsDiscordErrorResponse('Nicht unterstützt.')];
}
