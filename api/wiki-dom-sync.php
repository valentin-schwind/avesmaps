<?php

declare(strict_types=1);

final class AvesmapsWikiDomSyncStream {
    private int $position = 0;
    private string $content = '';

    public function stream_open(string $path, string $mode, int $options, ?string &$opened_path): bool {
        unset($mode, $options, $opened_path);
        $sourcePath = __DIR__ . '/wiki-dom-playground-seed.php';
        $source = file_get_contents($sourcePath);
        if (!is_string($source) || trim($source) === '') return false;
        $source = preg_replace('/^\s*<\?php\s*/u', '', $source, 1) ?? $source;
        $source = str_replace("const WIKI_DOM_MAX_ITERATIONS = 160;\nconst WIKI_DOM_MAX_PAGES = 100;\nconst WIKI_DOM_MAX_RUNTIME = 35;\n", '', $source);
        $source = str_replace('@set_time_limit(WIKI_DOM_MAX_RUNTIME + 10);', '@set_time_limit(0);', $source);
        $source = str_replace(
            "function defaultOptions(): array { return ['max_iterations' => 30, 'max_pages' => 20, 'max_runtime_seconds' => 20, 'sleep_ms' => 450, 'request_timeout_seconds' => 8]; }\nfunction options(array \$payload): array { \$d = defaultOptions(); return ['max_iterations' => max(1, min(WIKI_DOM_MAX_ITERATIONS, (int) (\$payload['max_iterations'] ?? \$d['max_iterations']))), 'max_pages' => max(1, min(WIKI_DOM_MAX_PAGES, (int) (\$payload['max_pages'] ?? \$d['max_pages']))), 'max_runtime_seconds' => max(3, min(WIKI_DOM_MAX_RUNTIME, (int) (\$payload['max_runtime_seconds'] ?? \$d['max_runtime_seconds']))), 'sleep_ms' => max(0, min(5000, (int) (\$payload['sleep_ms'] ?? \$d['sleep_ms']))), 'request_timeout_seconds' => max(3, min(20, (int) (\$payload['request_timeout_seconds'] ?? \$d['request_timeout_seconds'])))]; }",
            "function defaultOptions(): array { return ['max_iterations' => 30, 'max_pages' => 20, 'max_runtime_seconds' => 20, 'sleep_ms' => 450, 'request_timeout_seconds' => 8]; }\nfunction wikiDomSyncPositiveInt(mixed \$value, int \$default, int \$min): int { \$number = filter_var(\$value, FILTER_VALIDATE_INT); if (\$number === false) \$number = \$default; return max(\$min, (int) \$number); }\nfunction options(array \$payload): array { \$d = defaultOptions(); return ['max_iterations' => wikiDomSyncPositiveInt(\$payload['max_iterations'] ?? \$d['max_iterations'], \$d['max_iterations'], 1), 'max_pages' => wikiDomSyncPositiveInt(\$payload['max_pages'] ?? \$d['max_pages'], \$d['max_pages'], 1), 'max_runtime_seconds' => wikiDomSyncPositiveInt(\$payload['max_runtime_seconds'] ?? \$d['max_runtime_seconds'], \$d['max_runtime_seconds'], 3), 'sleep_ms' => wikiDomSyncPositiveInt(\$payload['sleep_ms'] ?? \$d['sleep_ms'], \$d['sleep_ms'], 0), 'request_timeout_seconds' => wikiDomSyncPositiveInt(\$payload['request_timeout_seconds'] ?? \$d['request_timeout_seconds'], \$d['request_timeout_seconds'], 3)]; }",
            $source
        );
        $this->content = "<?php\n" . $source;
        $this->position = 0;
        return true;
    }

    public function stream_read(int $count): string {
        $chunk = substr($this->content, $this->position, $count);
        $this->position += strlen($chunk);
        return $chunk;
    }

    public function stream_eof(): bool { return $this->position >= strlen($this->content); }
    public function stream_stat(): array { return []; }
}

stream_wrapper_register('avesmaps-wiki-dom-sync', AvesmapsWikiDomSyncStream::class);
require 'avesmaps-wiki-dom-sync://source';
