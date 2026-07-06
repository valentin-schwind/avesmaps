<?php

declare(strict_types=1);

function avesmapsDiscordCheckAppToken(string $configured, string $provided): bool {
    if ($configured === '' || $provided === '') {
        return false;
    }

    return hash_equals($configured, $provided);
}
