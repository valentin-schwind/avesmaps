<?php

declare(strict_types=1);

if (!function_exists('avesmapsNormalizeSingleLine')) {
    function avesmapsNormalizeSingleLine(string $value, int $maxLength = 500): string {
        $normalized = html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $normalized = preg_replace('/\s+/u', ' ', $normalized) ?? $normalized;
        $normalized = trim($normalized);
        if ($maxLength > 0 && mb_strlen($normalized, 'UTF-8') > $maxLength) {
            return mb_substr($normalized, 0, $maxLength, 'UTF-8');
        }
        return $normalized;
    }
}

require __DIR__ . '/wiki-dom-playground.php';
