<?php
// TEMPORARY diagnostic: reveals how the (STRATO) server reports request scheme + host, so we can write a
// loop-safe http->https redirect in .htaccess. No secrets, no DB, no auth. DELETE after use.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
echo json_encode([
    'HTTPS'                    => $_SERVER['HTTPS'] ?? null,
    'SERVER_PORT'             => $_SERVER['SERVER_PORT'] ?? null,
    'REQUEST_SCHEME'          => $_SERVER['REQUEST_SCHEME'] ?? null,
    'HTTP_X_FORWARDED_PROTO'  => $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? null,
    'HTTP_X_FORWARDED_SSL'    => $_SERVER['HTTP_X_FORWARDED_SSL'] ?? null,
    'HTTP_X_FORWARDED_PORT'   => $_SERVER['HTTP_X_FORWARDED_PORT'] ?? null,
    'HTTP_FRONT_END_HTTPS'    => $_SERVER['HTTP_FRONT_END_HTTPS'] ?? null,
    'HTTP_HOST'               => $_SERVER['HTTP_HOST'] ?? null,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
