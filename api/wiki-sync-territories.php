<?php

declare(strict_types=1);

const AVESMAPS_WIKI_SYNC_NO_AUTO_HANDLE = true;

const AVESMAPS_WIKI_POLITICAL_TERRITORY_SEED_PAGES = [
	'Baronie/Liste',
	"Bergk\u{00F6}nigreich/Liste",
	'Dom\u{00E4}ne (Horasreich)/Liste',
	'Emirat/Liste',
	'Freiherrschaft/Liste',
	"F\u{00FC}rstentum/Liste",
	'Grafschaft/Liste',
	'Herzogtum/Liste',
	'Kaiserpfalz/Liste',
	'Kaiserreich/Liste',
	'Komturei/Liste',
	"K\u{00F6}nigreich/Liste",
	'Markgrafschaft/Liste',
	'Pfalzgrafschaft/Liste',
	'Provinz (Imperium)/Liste',
	'Provinz (Mittelreich)/Liste',
	'Reichsmark/Liste',
	'Republik/Liste',
	"Sh\u{00EE}kanydad/Liste",
	'Staat/Liste',
	'Sultanat/Liste',
	'Theokratie/Liste',
];

require __DIR__ . '/wiki-sync.php';

avesmapsWikiSyncHandleRequest('territories');