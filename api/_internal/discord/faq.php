<?php

declare(strict_types=1);

function avesmapsDiscordLoadFaq(string $path): array {
    if (!is_file($path)) {
        return [];
    }
    $raw = file_get_contents($path);
    if ($raw === false) {
        return [];
    }
    try {
        $data = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return [];
    }
    if (!is_array($data)) {
        return [];
    }

    $items = [];
    foreach ($data as $entry) {
        if (!is_array($entry)) {
            continue;
        }
        $id = (string) ($entry['id'] ?? '');
        $question = (string) ($entry['q'] ?? '');
        $answer = (string) ($entry['a'] ?? '');
        if ($id === '' || $question === '' || $answer === '') {
            continue;
        }
        $items[] = ['id' => $id, 'q' => $question, 'a' => $answer];
    }

    return $items;
}

function avesmapsDiscordFaqById(array $faq, string $id): ?array {
    foreach ($faq as $item) {
        if (is_array($item) && ($item['id'] ?? null) === $id) {
            return $item;
        }
    }

    return null;
}
