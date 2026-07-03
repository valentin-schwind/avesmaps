<?php

declare(strict_types=1);

// TEMPORARY capability probe: reports whether STRATO's PHP can talk IMAP.
// No secrets, no mailbox access -- only boolean feature detection. Delete after use.

header('Content-Type: application/json');

echo json_encode([
    'php' => PHP_VERSION,
    'imap_extension' => extension_loaded('imap'),
    'imap_open' => function_exists('imap_open'),
    'openssl' => extension_loaded('openssl'),
    'mbstring' => extension_loaded('mbstring'),
    'iconv' => function_exists('iconv'),
    'stream_socket_client' => function_exists('stream_socket_client'),
], JSON_PRETTY_PRINT) . "\n";
