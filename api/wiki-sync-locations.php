<?php

declare(strict_types=1);

const AVESMAPS_WIKI_SYNC_NO_AUTO_HANDLE = true;

require __DIR__ . '/wiki-sync.php';

avesmapsWikiSyncHandleRequest('locations');