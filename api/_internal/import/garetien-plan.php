<?php

declare(strict_types=1);

// Der Garetien-Import fuellt die VORHANDENE Uebernahme-Vorschau.
// Entwurf: docs/superpowers/specs/2026-08-26-garetien-kartenimport-design.md §5
//
// 🔴 ES WIRD KEINE ZWEITE VORSCHAU GEBAUT. `sync_plan_run`/`sync_plan_item` und
// `js/review/sync-plan-sheet.js` bekommen eine weitere Art -- dieselbe Lehre wie beim
// Quellensystem, wo eine zweite Tabelle eine Migration gekostet hat (AGENTS.md §5).
//
// 🔴 UND ES SCHREIBT IN KEINE NUTZTABELLE. Das Rechnen ist von der Uebernahme getrennt; die
// Zusicherung gilt fuer jeden Sync-Lauf im Haus (sync-plan-purity-test.php).

require_once __DIR__ . '/garetien-abgleich.php';
require_once __DIR__ . '/garetien-abruf.php';
require_once __DIR__ . '/../wiki/sync-plan.php';

/** Die Art, unter der dieser Import in der Vorschau steht. */
const AVESMAPS_GARETIEN_PLAN_KIND = 'garetien';

/**
 * Der SEITENNAME einer Staging-Zeile: `<Namensraum>:<Artikel>`, ohne Namensraum nur der Artikel,
 * ohne Artikel leer. REIN -- kein I/O.
 *
 * 🔴 DIE FORMEL STEHT AB HIER GENAU EINMAL. Sie stand bis zum 28.08.2026 zweimal woertlich da --
 * im Objektschluessel und in der Wiki-Adresse darunter --, und die Arbeitsliste des Fensters
 * braucht sie als drittes fuer den Linktext („Garetien:Natter" statt „Wiki-Artikel"). Drei
 * Abschriften derselben Bildung laufen beim ersten Sonderzeichen auseinander; dieselbe Lehre wie
 * RULING P6 unten und wie Review I2, das die zweite Fassung der Wiki-Adresse schon einmal
 * eingesammelt hat.
 */
function avesmapsGaretienSeitenNameAusZeile(array $zeile): string
{
    $artikel = trim((string) ($zeile['artikel'] ?? ''));
    $namensraum = trim((string) ($zeile['namensraum'] ?? ''));

    return ($namensraum !== '' ? $namensraum . ':' : '') . $artikel;
}

/**
 * 🔴 KEIN SCHREIBZUGRIFF AUF EIN BESTEHENDES OBJEKT. Owner 31.08.2026, woertlich:
 * „ich will dass du alle 'ersetzungsfunktionen' des importers augenblicklich deaktivierst. es
 * gibt kein ersetzen. es gibt neu oder nix - kein verändern, kein ersetzen."
 *
 * ANLASS: der Abgleich hatte ihre „Burg Gryffenwacht" mit unserem Dorf „Valpolust" gleichgesetzt
 * (1,90 Karteneinheiten Abstand, Schwelle 2,0 = 6 Meilen) und dessen NAMEN ersetzt. garetien.de
 * fuehrt beide getrennt und zeichnet sogar einen Pfad dazwischen. Am Bestand gemessen: von 2364
 * Punktobjekten haben **2041 (86,3 %)** einen anders benannten Nachbarn innerhalb der Schwelle --
 * eine Burg liegt in diesem Kartenwerk fast immer neben ihrem Dorf. Der Abgleich konnte also
 * systematisch fremde Objekte umbenennen und ueberschreiben.
 *
 * 🔴 DIESE KONSTANTE IST DER EINE SCHALTER. Sie steht hier und wird an jeder Stelle gefragt, die
 * an einem bestehenden Objekt schreiben koennte -- Plan (was angeboten wird), Uebernahme (was
 * geschrieben wird) und Fenster (was ein Editor sieht). Der SERVER ist dabei der verbindliche
 * Riegel: der laufende Lauf traegt bereits fertige Ergaenzungs-Items in der Datenbank, und ein
 * Riegel nur im Browser waere keiner.
 *
 * ⚠️ WAS BLEIBT: „Neu einfuegen". Jede Zeile -- auch eine mit erkanntem Treffer -- behaelt ihr
 * `zusatz`-Item und laesst sich damit als EIGENES Objekt anlegen, samt ihren Quellen. „neu oder
 * nix", genau so.
 *
 * ⚠️ WAS MIT ABGESCHALTET IST: auch die reine QUELLEN-Ergaenzung an einem bestehenden Objekt.
 * Sie ist additiv und war umkehrbar -- aber sie ist ein Schreibzugriff auf ein fremdes Objekt, und
 * der Auftrag lautet „neu oder nix". Sie zurueckzuholen ist eine Zeile hier; das ist eine
 * Owner-Entscheidung, keine Vermutung.
 */
// 🔴 LIVE IST ER AUS, UND ZWAR IMMER: kein Produktivpfad definiert ihn vor. Ueberschreibbar
// ist er nur, damit die Pruefstaende der Ersetzungs-Maschinerie erhalten bleiben -- sie beweisen,
// dass eine spaetere, korrigierte Fassung wieder anschaltbar waere, ohne dass die Regeln neu
// erfunden werden muessen. ⚠️ Ein Test, der ihn anschaltet, sagt NICHTS ueber die Produktion;
// dass die Vorgabe `false` ist und die ganze Kette sie befolgt, steht deshalb in einem eigenen
// Pruefstand (garetien-kein-ersetzen-test.php), und ein Waechter dort verbietet jedem
// Produktivpfad, ihn auf `true` zu setzen.
if (!defined('AVESMAPS_GARETIEN_ERSETZEN_ERLAUBT')) {
    define('AVESMAPS_GARETIEN_ERSETZEN_ERLAUBT', false);
}

/**
 * 🔴 WAS TROTZDEM ERLAUBT BLEIBT: die QUELLE. Owner 31.08.2026, nach dem Abschalten:
 * „Garetien.de als 'Quelle und Artikel ergänzen' soll erlaubt sein, aber nicht den namen
 * verändern."
 *
 * Eine Quellenangabe ist ADDITIV -- sie haengt eine Zeile in `feature_sources`, sie ueberschreibt
 * nichts am Objekt, und die Ruecknahme kann sie exakt wieder loesen. Genau daran haengt die
 * Rechtsfolge (CC BY-NC-SA), und genau deshalb ist sie die eine Ausnahme.
 *
 * ⚠️ DER NAME BLEIBT DRAUSSEN, AUCH WENN UNSERER LEER IST. Das Luecken-Item fuellte frueher einen
 * leeren Namen mit -- „fuellen" ist streng genommen kein „veraendern", aber nach dem heutigen Tag
 * ist die zurueckhaltende Richtung die richtige. Es waere EINE Zeile hier, und es ist eine
 * Owner-Entscheidung, keine Vermutung.
 */
const AVESMAPS_GARETIEN_ERGAENZUNG_FELDER = ['quelle'];

/**
 * Der Trenner zwischen Artikel und Anzeigename im Objektschluessel.
 *
 * 🔴 „!" IST DIE SCHREIBWEISE DES EXPORTS SELBST (`Typ:Namensraum:Artikel!Anzeige`) -- kein
 * frei gewaehltes Zeichen. Damit ist der Schluessel eine Abschrift der Quelle und nicht eine
 * zweite Erfindung daneben; und ein „!" kann im Artikelnamen nicht vorkommen, weil der Parser
 * genau daran trennt.
 */
const AVESMAPS_GARETIEN_SCHLUESSEL_NAME_TRENNER = '!';

/**
 * Der Mittelpunkt eines Rings. REIN -- kein I/O.
 *
 * 🔴 ZWEI LESER, EINE FORMEL: die Flaeche setzt ihr Label darauf
 * (avesmapsGaretienFlaecheAnlegen), und seit dem 01.09.2026 bekommt auch jedes PUNKTziel ihn --
 * ein Ort oder ein freies Label, das aus einer Flaeche entsteht. Owner: „Bei Flaechen, die zu
 * Punkten (label, orte, …) werden, soll der Flaechenmittelpunkt genommen werden."
 *
 * 💣 VORHER STAND DORT `$punkte[0]` -- DIE ERSTE ECKE DES RINGS. Gemessen am Livebestand:
 * von den 79 `Berg`-Zeilen tragen 78 ein Polygon (bis 211 Punkte), also sassen praktisch alle
 * importierten Berggipfel am RAND ihrer Bergflaeche statt in deren Mitte. Es fiel nicht auf,
 * weil ein Gipfel am Rand immer noch wie ein Gipfel aussieht.
 *
 * ⚠️ Ein Flaechenschwerpunkt, kein "Pol der Unzugaenglichkeit". Der waere schoener (polylabel
 * setzt ihn im Frontend), lebt aber im Browser; ihn hier in PHP nachzubauen waere eine zweite
 * Wahrheit ueber dieselbe Frage. Ein Editor kann den Punkt jederzeit verschieben.
 *
 * ⚠️ Bei EINEM Punkt ist er dieser Punkt -- ein Ort mit einer einzigen Koordinate (alle
 * Burgen, Doerfer, Tempel: 1 Punkt) wandert durch diese Aenderung um keinen Pixel.
 */
function avesmapsGaretienRingMittelpunkt(array $ring): array
{
    $n = count($ring);
    if ($n === 0) {
        return [0.0, 0.0];
    }
    $sx = 0.0;
    $sy = 0.0;
    foreach ($ring as $p) {
        $sx += (float) $p[0];
        $sy += (float) $p[1];
    }

    return [$sx / $n, $sy / $n];
}

/**
 * Der Objekt-Schluessel EINER Staging-Zeile. REIN -- kein I/O.
 *
 * 🔴 RULING P6: diese Formel entsteht HIER und wird von `avesmapsGaretienPlanEintrag` benutzt,
 * nicht abgeschrieben. Eine spaetere Aufgabe (die Arbeitsliste des Fensters) muss denselben
 * Schluessel aus einer Staging-Zeile nachbauen koennen, um Vorschlaege und urteilslose Zeilen
 * demselben Objekt zuzuordnen -- zwei Formeln liefen beim ersten Sonderzeichen auseinander, und
 * dann stuende dasselbe Objekt zweimal in der Liste.
 */
function avesmapsGaretienObjektSchluesselAusZeile(array $zeile): string
{
    $wiki = (string) ($zeile['wiki'] ?? 'ggp');
    $seite = avesmapsGaretienSeitenNameAusZeile($zeile);

    return $wiki . ':' . $zeile['ebene'] . ':' . $zeile['typ'] . ':'
        . ($seite !== '' ? $seite : ('#' . $zeile['zeile_nr']))
        . AVESMAPS_GARETIEN_SCHLUESSEL_NAME_TRENNER . trim((string) ($zeile['anzeige'] ?? ''));
}

/**
 * Der Objekt-Schluessel EINES sync_plan_item -- alles vor dem ersten "|".
 *
 * 🔴 RULING P6 (Aufgabe 3, in garetien-plan.php): ein Abschnitts-Item traegt
 * `<basis>|<anlass>|<public_id>`, ein einfacher Neu-/Geaendert-Eintrag nur `<basis>` -- OHNE
 * Pipe. Am ersten "|" zu splitten liefert in beiden Faellen dieselbe Basis wie
 * avesmapsGaretienObjektSchluesselAusZeile, und das ist auch der einzige Ort, an dem diese
 * Formel entsteht -- hier wird sie nur benutzt, nie ein zweites Mal gebaut.
 */
function avesmapsGaretienObjektSchluessel(string $entityKey): string
{
    $pos = strpos($entityKey, '|');

    return $pos === false ? $entityKey : substr($entityKey, 0, $pos);
}

/**
 * Der ARTIKELNAME aus einem Objektschluessel -- die Umkehrung von
 * `avesmapsGaretienObjektSchluesselAusZeile`. `''`, wenn das Objekt keinen Artikel hat.
 * REIN -- kein I/O.
 *
 * 🔴 Die Formel dort lautet `wiki:ebene:typ:<Namensraum:Artikel>`, und der Artikelname ist der
 * VIERTE Teil -- mit seinem eigenen Doppelpunkt darin, deshalb `explode(..., 4)`.
 *
 * 💣 ZWEI DINGE MUESSEN HERAUSFALLEN, und beide sind schon einmal durchgerutscht:
 *   · Ein Objekt OHNE Artikel traegt `#<Zeilennummer>` an dieser Stelle (der Bauer setzt das ein).
 *     Ohne den Riegel entstuende daraus die Quelle „#417 auf garetien.de".
 *   · Ein Item kann einen SUFFIX hinter `|` tragen (`…|ergaenzung|<public_id>`) -- deshalb erst
 *     durch `avesmapsGaretienObjektSchluessel`. Ohne das hiesse der Artikel
 *     „Testpfad-Quelle|ergaenzung|00000000-…".
 */
function avesmapsGaretienArtikelNameAusSchluessel(string $entityKey): string
{
    $teile = explode(':', avesmapsGaretienObjektSchluessel($entityKey), 4);
    if (count($teile) < 4) {
        return '';
    }
    $seite = trim($teile[3]);
    // 💣 SEIT 01.09.2026 HAENGT DER ANZEIGENAME HINTEN DRAN. Ohne diesen Schnitt entstuende
    // aus „Hügel und Berge in Hartsteen!Kahler Schirch" ein Artikelname, den es nicht gibt -- und
    // daraus eine Quellenadresse, die auf einen 404 zeigt.
    $ruf = strpos($seite, AVESMAPS_GARETIEN_SCHLUESSEL_NAME_TRENNER);
    if ($ruf !== false) {
        $seite = trim(substr($seite, 0, $ruf));
    }

    return str_starts_with($seite, '#') ? '' : $seite;
}

/**
 * Der ANZEIGENAME aus einem Objektschluessel -- `''`, wenn keiner darinsteht (Altschluessel).
 * REIN -- kein I/O.
 */
function avesmapsGaretienAnzeigeNameAusSchluessel(string $entityKey): string
{
    $basis = avesmapsGaretienObjektSchluessel($entityKey);
    $ruf = strpos($basis, AVESMAPS_GARETIEN_SCHLUESSEL_NAME_TRENNER);

    return $ruf === false ? '' : trim(substr($basis, $ruf + 1));
}

/**
 * Der WIRT einer Staging-Zeile allein -- `https://www.garetien.de` bzw. `https://www.koschwiki.de`,
 * ohne Pfad und ohne Artikel. REIN -- kein I/O.
 *
 * 🔴 MELDUNG (30.08.2026, Owner: „ich glaube https://www.garetien.de reicht"): das ist die
 * Adresse, die eine ZITIERTE Quelle bekommt (`quelle.url` in `avesmapsGaretienPlanEintrag`, damit
 * `sources.url`) -- NIE die Export-Arbeitsseite aus `avesmapsGaretienSeitenUrlAusZeile` darunter.
 * `.../index.php?title=Benutzer:VolkoV/MapSVG/Avesmaps_…` ist eine interne Seite, auf der VolkoV
 * Kartendaten fuer DIESEN Import ablegt -- kein Artikel, den ein Leser der Infobox zitieren soll.
 *
 * 🔴 EIN WIRT, ZWEI STELLEN, DIE IHN NENNEN. Diese Formel entsteht HIER; ohne sie stuenden die
 * beiden Host-Literale zweimal im Repo (RULING P6 / Review I2 gilt sinngemaess auch hier).
 */
function avesmapsGaretienWirtAusZeile(array $zeile): string
{
    $wiki = (string) ($zeile['wiki'] ?? 'ggp');

    return $wiki === 'kosch' ? 'https://www.koschwiki.de' : 'https://www.garetien.de';
}

/**
 * Die EXPORT-ARBEITSSEITE einer Staging-Zeile -- die MapSVG-Seite, von der die Zeile stammt.
 * REIN -- kein I/O.
 *
 * 🔴 KORREKTUR 31.08.2026: SIE HEISST NACH DER EBENE, NICHT NACH DEM ARTIKEL. Bis dahin baute
 * diese Funktion `…/Avesmaps_` + ARTIKELNAME, also z.B. `…/Avesmaps_Garetien:Stadt_Praioslob`
 * -- eine Seite, die es nicht gibt. Live gemessen:
 *   `…/Avesmaps_Garetien:Stadt_Praioslob` -> HTTP 404
 *   `…/Avesmaps_Ortschaften_1`            -> HTTP 200
 * Die Exportseiten heissen nach der EBENE (AVESMAPS_GARETIEN_EBENEN in garetien-abruf.php ist die
 * einzige Liste, die sie nennt), und die Ebene steht in der Staging-Zeile. Der Fehler traf jede
 * Zeile MIT Artikel -- 58 % des Bestands -- und war an zwei Stellen sichtbar: als toter Link im
 * Importer-Fenster und als `feature_sources.note` an jedem uebernommenen Objekt.
 * ⚠️ Er ist auch der Grund, warum der Owner den Artikel „Garetien:Stadt Praioslob" ZUFAELLIG
 * entdecken musste, statt ihn anzuklicken.
 *
 * ⚠️ DAS IST NICHT DIE ZITIERTE QUELLE. Die ist `avesmapsGaretienWirtAusZeile` (der Wirt allein),
 * und der ARTIKEL-Link ist `avesmapsGaretienArtikelUrlAusZeile` darunter -- drei Adressen aus
 * derselben Zeile, jede mit eigener Aufgabe.
 */
function avesmapsGaretienSeitenUrlAusZeile(array $zeile): string
{
    $wiki = (string) ($zeile['wiki'] ?? 'ggp');
    $ebene = trim((string) ($zeile['ebene'] ?? ''));
    // ⚠️ Ohne Ebene gibt es keine Arbeitsseite -- dann der Wirt allein, nie ein `Avesmaps_`
    // ohne Namen (das waere eine Adresse, die sicher ins Leere zeigt).
    if ($ebene === '') {
        return avesmapsGaretienWirtAusZeile($zeile);
    }
    $basis = $wiki === 'kosch' ? AVESMAPS_GARETIEN_BASIS_KOSCH : AVESMAPS_GARETIEN_BASIS_GGP;

    return $basis . $ebene;
}

/**
 * Der Artikelname OHNE Namensraum -- aus `Garetien:Stadt Praioslob` wird `Stadt Praioslob`.
 * REIN -- kein I/O.
 *
 * 🔴 Das ist die UMKEHRUNG der Trennung, die `avesmapsGaretienParseZeile` beim Einlesen macht
 * (garetien-parser.php: der erste Doppelpunkt trennt Namensraum vom Artikel, wenn ueberhaupt einer
 * da ist). Sie ist deshalb hier erlaubt und nicht geraten: dieselbe, schon getroffene Entscheidung,
 * nur rueckwaerts -- und ein Artikel im Hauptnamensraum, dessen Titel selbst einen Doppelpunkt
 * traegt, wird vom Parser bereits genauso behandelt.
 *
 * ⚠️ Gebraucht wird sie fuer die BESCHRIFTUNG der Artikelquelle („Stadt Praioslob auf
 * garetien.de", Owner 31.08.2026). Der Namensraum ist ein Wiki-interner Behaelter; er steht
 * weiterhin vollstaendig in der Adresse.
 */
function avesmapsGaretienArtikelOhneNamensraum(string $seite): string
{
    $seite = trim($seite);
    $pos = strpos($seite, ':');

    return $pos === false ? $seite : trim(substr($seite, $pos + 1));
}

/**
 * Die Adresse des WIKI-ARTIKELS -- `https://www.garetien.de/index.php/Garetien:Stadt_Praioslob`.
 * Ohne Artikel: der Wirt allein. REIN -- kein I/O.
 *
 * 🔴 DIE FORM IST GEMESSEN, NICHT GERATEN (31.08.2026): `/index.php/<Namensraum:Artikel>` mit
 * Unterstrichen statt Leerzeichen antwortet mit 200, die frueher hier gebaute
 * `…/Avesmaps_<Artikel>`-Form mit 404. Stichprobe ueber 20 zufaellige Artikel aus den
 * Exportseiten: 20 von 20 vorhanden -- die Angabe der Exportseite ist verlaesslich, eine
 * Existenzpruefung also unnoetig. ⚠️ Sie waere auch nicht baubar: die MediaWiki-API von
 * garetien.de ist fuer Anonyme zu (`readapidenied`), und 3162 Einzelabrufe waeren ein Crawl auf
 * einem fremden Server.
 *
 * 💣 KEIN `urlencode` UEBER DEN GANZEN NAMEN -- Doppelpunkt und Schraegstrich sind hier Struktur
 * (Namensraum, Unterseite), kein Inhalt; kodiert werden muessen die Umlaute. `rawurlencode` und
 * danach genau diese zwei Zeichen zuruecknehmen.
 */
function avesmapsGaretienArtikelUrlAus(string $wiki, string $seite): string
{
    $wirt = $wiki === 'kosch' ? 'https://www.koschwiki.de' : 'https://www.garetien.de';
    $seite = trim($seite);
    if ($seite === '') {
        return $wirt;
    }
    $kodiert = str_replace(['%3A', '%2F'], [':', '/'], rawurlencode(str_replace(' ', '_', $seite)));

    return $wirt . '/index.php/' . $kodiert;
}

/**
 * Die Export-Arbeitsseite aus einem `after`-Rumpf -- NEU GERECHNET, nicht aus `after.seite_url`
 * gelesen. REIN -- kein I/O.
 *
 * 🔴 UND DAS IST ABSICHT, keine Umstaendlichkeit. Jedes Item, das VOR dem 31.08.2026 gebaut
 * wurde, traegt in `after.seite_url` die alte, kaputte Form `…/Avesmaps_<Artikelname>` (HTTP 404,
 * siehe avesmapsGaretienSeitenUrlAusZeile). Das trifft den ganzen Bestand des Owners UND seinen
 * laufenden Lauf mit 8213 Zeilen -- wuerde die Uebernahme das Feld glauben, schriebe sie die tote
 * Adresse weiter in jede neue `feature_sources.note`.
 *
 * ⚠️ Die Herleitung ist exakt und nicht geraten: `after` traegt `wiki` und `ebene`, also genau
 * die zwei Angaben, aus denen ein frischer Planbau dieselbe Adresse baut. Fehlt die Ebene (ein
 * von Hand gebautes Item), gilt weiterhin das gespeicherte Feld.
 */
function avesmapsGaretienArbeitsseiteAus(array $nach): string
{
    $ebene = trim((string) ($nach['ebene'] ?? ''));
    if ($ebene === '') {
        return (string) ($nach['seite_url'] ?? '');
    }

    return avesmapsGaretienSeitenUrlAusZeile([
        'wiki' => (string) ($nach['wiki'] ?? 'ggp'),
        'ebene' => $ebene,
    ]);
}

/** Dieselbe Adresse aus einer Staging-Zeile. REIN. */
function avesmapsGaretienArtikelUrlAusZeile(array $zeile): string
{
    return avesmapsGaretienArtikelUrlAus(
        (string) ($zeile['wiki'] ?? 'ggp'),
        avesmapsGaretienSeitenNameAusZeile($zeile)
    );
}

/**
 * Die Namensnennung eines Wirts. REIN.
 *
 * 🔴 Der Wortlaut ist eine Owner-Entscheidung (27.08.2026) und stand bis zum 31.08.2026 nur
 * inline in `avesmapsGaretienPlanEintrag`. Die Artikelquelle braucht denselben -- und sie entsteht
 * auch im Nachzug, also an einer zweiten Stelle. Er steht deshalb ab hier einmal da.
 */
function avesmapsGaretienNamensnennungFuer(string $wiki): string
{
    return $wiki === 'kosch' ? 'VolkoV / koschwiki.de' : 'VolkoV / garetien.de';
}

/**
 * Die ZWEITE Quelle eines Objekts: sein eigener Wiki-Artikel. `null`, wenn kein Artikel genannt
 * ist. REIN -- kein I/O.
 *
 * Owner 31.08.2026, nachdem er den Artikel zu Praioslob zufaellig gefunden hatte: „kann man den
 * artikel dann als zusaetzliche quelle angeben? 'Stadt Praioslob auf garetien.de' (Link)".
 *
 * 🔴 ZUSAETZLICH, NICHT STATT. „Briefspiel (Garetien)" auf den Wirt bleibt -- das ist die
 * Sammelquelle, die JEDES importierte Objekt traegt; diese hier ist die konkrete Seite, und nur
 * 58 % der Zeilen haben eine (Orte/Burgen/Gutshoefe fast 100 %, Wege 7 %, Waelder 8 %).
 *
 * 🔴 EIN BAUER, ZWEI FUETTERER: der Planbau reicht den Namen aus der Staging-Zeile herein, der
 * Nachzug (avesmapsGaretienArtikelQuellenNachtragen) den aus dem entity_key eines schon
 * uebernommenen Items. Zwei Fassungen dieser Form liefen beim ersten abweichenden Zeichen
 * auseinander -- und diese Quelle traegt die Rechtsfolge.
 *
 * ⚠️ Lizenz und Namensnennung sind DIESELBEN wie bei der Sammelquelle: derselbe Wirt, dieselben
 * Inhalte, derselbe Autor. Sie werden hier nicht neu entschieden.
 *
 * ⚠️ Mehrere Objekte duerfen sich einen Artikel teilen (gemessen: 1014 Artikel tragen mehr als
 * ein Objekt, Spitze 7 -- meist dieselbe Burg als Flaeche UND als Beschriftung). Das ist kein
 * Fehler, sondern die Seite, von der die Angabe stammt; die Beschriftung nennt den ARTIKEL, nicht
 * das Objekt. Der geteilte Katalog legt sie ueber `url_hash` ohnehin nur einmal ab.
 *
 * @return array{url:string,label:string,source_type:string,origin:string,license:string,attribution:string}|null
 */
function avesmapsGaretienArtikelQuelleAus(string $wiki, string $seite): ?array
{
    $seite = trim($seite);
    if ($seite === '') {
        return null;
    }

    return [
        'url' => avesmapsGaretienArtikelUrlAus($wiki, $seite),
        // Owner-Wortlaut: „Stadt Praioslob auf garetien.de".
        'label' => avesmapsGaretienArtikelOhneNamensraum($seite)
            . ' auf ' . ($wiki === 'kosch' ? 'koschwiki.de' : 'garetien.de'),
        'source_type' => 'briefspiel',
        'origin' => 'garetien',
        'license' => 'cc-by-nc-sa-3.0',
        'attribution' => avesmapsGaretienNamensnennungFuer($wiki),
    ];
}

/**
 * Aus einer Staging-Zeile und ihrem Urteil einen Vorschlag bauen. REIN -- kein I/O.
 *
 * `after` traegt alles, was die Uebernahme braucht: Zielart, Geometrie IN UNSEREN
 * KARTENEINHEITEN, Name und Quelle. 💣 Die Geometrie wird HIER gewandelt und nicht erst beim
 * Uebernehmen: Wagenhalt-Zahlen gehen bis in die Hunderttausende, unsere Karte ist 0..1024 --
 * eine ungewandelte Geometrie faellt nirgends auf, sie landet nur weit ausserhalb, und das
 * Objekt sieht danach niemand wieder.
 */
function avesmapsGaretienPlanEintrag(array $zeile, array $ziel, array $urteil): array
{
    $punkte = avesmapsGaretienZeilePunkte($zeile);
    $wiki = (string) ($zeile['wiki'] ?? 'ggp');

    // 🔴 DIE BESCHRIFTUNG NENNT DAS BRIEFSPIEL, DIE ADRESSE DEN ARTIKEL (Owner 27.08.2026:
    // „wichtig ist auch die kategorie der quelle ... beispiel Briefspiel (Weiden)"). Das ist die
    // Form, die das Haus fuer Briefspielquellen seit langem fuehrt -- „Albernisches Briefspiel"
    // zeigt auf westlande.de/…/Falkenhain, „Briefspiel (Weiden)" auf
    // herzogtum-weiden.net/…/hzgl-altentrallop. Der Artikelname geht dabei nicht verloren, er
    // steht im Link (avesmapsGaretienSeitenUrlAusZeile).
    $quellenTitel = $wiki === 'kosch' ? 'Briefspiel (Kosch)' : 'Briefspiel (Garetien)';
    // 🔴 Lizenz und Namensnennung reisen als DATEN mit (Owner 27.08.2026), nicht als Regel im
    // Renderer. Der Wortlaut ist seiner: "VolkoV / garetien.de" fuer die Inhalte aus Garetien,
    // "VolkoV / koschwiki.de" fuer den Kosch.
    $namensnennung = avesmapsGaretienNamensnennungFuer($wiki);
    // Die zweite Quelle: der eigene Wiki-Artikel, wenn die Zeile einen nennt (Owner 31.08.2026).
    $artikelQuelle = avesmapsGaretienArtikelQuelleAus($wiki, avesmapsGaretienSeitenNameAusZeile($zeile));

    // 🔴 EIN ZUFLUSS IST EIN NEUES OBJEKT, KEINE AENDERUNG AN UNSEREM FLUSS (Owner 27.08.2026).
    // 34 der 37 Widersprueche sind Baeche, die auf ihrem Hauptfluss liegen. Als 'changed' mit
    // unserem Fluss als Ziel wuerde die Uebernahme dessen Geometrie mit der des Seitenarms
    // ueberschreiben -- und 'changed' kommt nach der Hausregel VORANGEHAKT, ein Klick auf
    // "alle uebernehmen" waere also destruktiv. Sie sind deshalb 'new', tragen unseren
    // Nachbarn nur als ANGABE mit (nicht als Ziel!) und starten UNGEHAKT: die Owner-Regel vom
    // 16.08.2026 -- vorangehakt ist nur das Fuellen einer Luecke, alles andere mit Grund.
    $zufluss = ($urteil['anlass'] ?? null) === 'zufluss';
    $istNeu = $urteil['status'] === 'neu' || $zufluss;
    $nachbar = $urteil['treffer_name'] !== null && $zufluss
        ? ' · liegt auf "' . $urteil['treffer_name'] . '"'
        : '';

    return [
        'entity_key' => avesmapsGaretienObjektSchluesselAusZeile($zeile),
        // 💣 Beim Zufluss NULL: ein entity_public_id ist fuer die Uebernahme das ZIEL, nicht
        // eine Bemerkung. Stuende unser Fluss hier, waere die Zeile trotz 'new' wieder ein
        // Schreibzugriff auf ihn.
        'entity_public_id' => $zufluss ? null : $urteil['treffer_public_id'],
        'change_type' => $istNeu ? 'new' : 'changed',
        'label' => trim((string) ($zeile['anzeige'] ?? '')) . ' (' . $zeile['typ'] . ')' . $nachbar,
        'before' => ($zufluss || $urteil['treffer_public_id'] === null) ? [] : [
            'public_id' => $urteil['treffer_public_id'],
            'name' => $urteil['treffer_name'],
        ],
        'after' => [
            'herkunft' => 'garetien',
            'wiki' => $wiki,
            // ⚠️ Der Filter „Ebene · 18" der spaeteren Arbeitsliste liest DIESES Feld -- sie aus
            // dem entity_key zurueckzuparsen waere eine zweite Wahrheit ueber dasselbe Feld.
            'ebene' => $zeile['ebene'],
            'typ' => $zeile['typ'],
            'ziel' => $ziel['ziel'],
            'subtyp' => $ziel['subtyp'],
            'kind' => $ziel['kind'],
            // 🔴 NUR WENN GESETZT -- die Abwesenheit ist die Aussage „kein Bach". Ein
            // `is_bach: false` an jedem Strom und Fluss waere eine Behauptung in jeder Planzeile.
            ...(!empty($ziel['is_bach']) ? ['is_bach' => true] : []),
            'name' => trim((string) ($zeile['anzeige'] ?? '')),
            // 🔴 Seit 29.08.2026 DREI Geometrieformen, nicht mehr zwei (Entwurf §3.1/§3.4): ein
            // Ort ('location') oder ein Berggipfel-Label ('label') ist bei uns ein PUNKT, keine
            // Flaeche und keine Linie -- der einzige Punkt der Quellzeile.
            'geometry' => [
                'type' => match ($ziel['ziel']) {
                    'path' => 'LineString',
                    'region' => 'Polygon',
                    default => 'Point',
                },
                // Eine Flaeche ist ein RING: die Punktliste liegt eine Ebene tiefer. Ein Punkt
                // (Ort/Berggipfel) ist ein EINZELNES [x,y]-Paar, GeoJSON-Point-Form.
                // 🔴 EIN PUNKTZIEL BEKOMMT DIE MITTE, NICHT DIE ERSTE ECKE (01.09.2026).
                // Hier stand `$punkte[0]`; bei den 78 `Berg`-Zeilen mit Polygon (bis 211 Punkte)
                // war das eine Ringecke, und der Gipfel sass am Rand seiner Bergflaeche.
                'coordinates' => match ($ziel['ziel']) {
                    'path' => $punkte,
                    'region' => [$punkte],
                    default => avesmapsGaretienRingMittelpunkt($punkte),
                },
            ],
            'quelle' => [
                // 🔴 MELDUNG (30.08.2026): DER WIRT, NICHT DIE EXPORT-ARBEITSSEITE. Das ist die
                // Adresse, die als `sources.url` landet und in der Infobox verlinkt wird -- ein
                // Leser soll nach garetien.de/koschwiki.de gefuehrt werden, nicht auf VolkoVs
                // MapSVG-Exportseite (avesmapsGaretienWirtAusZeile darueber). Die Exportseite
                // bleibt als `seite_url` weiter unten erhalten, fuer den Editor.
                'url' => avesmapsGaretienWirtAusZeile($zeile),
                'label' => $quellenTitel,
                'source_type' => 'briefspiel',
                'origin' => 'garetien',
                'license' => 'cc-by-nc-sa-3.0',
                'attribution' => $namensnennung,
            ],
            // 🔴 NUR WENN DIE ZEILE EINEN ARTIKEL NENNT -- die Abwesenheit ist die Aussage
            // „dieses Objekt hat keine eigene Seite" (42 % der Zeilen, vor allem Wege und
            // Waelder). Ein leeres `artikel_quelle` an jeder Planzeile waere eine Behauptung.
            ...($artikelQuelle !== null ? ['artikel_quelle' => $artikelQuelle] : []),
            // Die Export-Arbeitsseite, von der diese Zeile stammt -- NICHT die zitierte Quelle
            // (die ist `quelle.url` darueber, seit der Meldung vom 30.08.2026 der Wirt allein).
            // Der Editor braucht sie trotzdem: `garetien-liste.php` liest sie als `wiki_url` fuer
            // den Artikel-Link im Review-Fenster (js/review/review-garetien-importer.js).
            'seite_url' => avesmapsGaretienSeitenUrlAusZeile($zeile),
            'urteil' => $urteil['grund'],
            'anlass' => $urteil['anlass'],
            // Nur eine ANGABE fuer den Menschen, der die Zeile ansieht -- nie ein Ziel.
            'nachbar' => $zufluss ? $urteil['treffer_name'] : null,
        ],
        'override' => [],
        // 🔴 Ein Zufluss startet UNGEHAKT, mit dem Grund in der Beschriftung. Alles andere
        // folgt der Hausregel avesmapsSyncPlanDefaultSelected.
        'vorwahl_aus' => $zufluss,
    ];
}

/**
 * Laeuft ihr Objekt ueber EINES von uns oder ueber mehrere?
 *
 * 💣 DAS IST DER UNTERSCHIED ZWISCHEN GARDEL UND REICHSSTRASSE 3, und ohne ihn ist einer von
 * beiden falsch. Ihre "Natter" trifft Natter, Gardel und Darpat -- drei Namen, also laeuft ihr
 * Objekt ueber mehrere unserer; den Gardel "Natter" zu nennen waere falsch. Ihre "Angbarer
 * Reichsstrasse" trifft sechsmal "Reichsstrasse 3" -- EIN Name, also ist es unser Objekt, und
 * die Umbenennung ist genau die Frage, die der Owner gestellt hat.
 *
 * ⚠️ Leere Namen zaehlen NICHT mit: eine Luecke ist kein zweiter Name. Barun-Ulah traegt seinen
 * Namen siebenmal und hat eine Luecke -- das ist EIN Objekt.
 */
function avesmapsGaretienEinObjekt(array $abschnitte): bool
{
    $namen = [];
    foreach ($abschnitte as $abschnitt) {
        $name = trim((string) ($abschnitt['name'] ?? ''));
        if ($name !== '') {
            $namen[$name] = true;
        }
    }

    return count($namen) <= 1;
}

/**
 * Welche unserer Objekte tragen die Garetien-Quelle bereits?
 *
 * ⚠️ EINE Abfrage je LAUF, nicht je Zeile. 289 Zeilen mit bis zu 13 Abschnitten waeren sonst rund
 * tausend Einzelabfragen fuer eine Frage, deren Antwort sich waehrend des Rechnens nicht aendert.
 * ⚠️ Faellt OFFEN aus: fehlt die Tabelle (frische Installation), gilt "keine Quelle liegt" -- das
 * erzeugt hoechstens ein Item zu viel, und ein Item zu viel ist sichtbar. Ein Item zu WENIG waere
 * eine stillschweigend verlorene Quellenangabe.
 *
 * 🔴 RULING R3 (Review C1): KEIN `status`-Filter. Der Hauswert ist `'approved'`, der einzige
 * andere `'suppressed'` -- der Grabstein einer von HAND entfernten Verknuepfung. Wer ihn
 * ignoriert, bietet genau das wieder an, was ein Mensch weggenommen hat, und verletzt die
 * Uebersteuerungs-Sicherheit, die das Haus ueberall verlangt ("manual/suppressed untouched",
 * AGENTS.md §11 Wiki-Publikations-Quellen). Eine Zeile da = die Quelle ist erledigt, egal in
 * welchem Zustand. (Der vorherige Wert `'active'` war falsch -- das ist das Vokabular des
 * Lore-Systems, nicht von `feature_sources`, und lieferte live IMMER die leere Menge.)
 *
 * 🔴 Der Schluessel traegt `entity_type`, weil dieser Import `path`- UND `region`-Zeilen
 * schreibt und `feature_sources` erst ueber (entity_type, entity_public_id, source_id) eindeutig
 * ist -- eine ueber zwei Typen geteilte public_id laese sich sonst als "Quelle liegt".
 *
 * @return array<string,true> "<entity_type>|<entity_public_id>" => true
 */
function avesmapsGaretienQuellenBestand(PDO $pdo): array
{
    try {
        $stmt = $pdo->query(
            'SELECT DISTINCT fs.entity_type, fs.entity_public_id, s.url'
            . ' FROM feature_sources fs JOIN sources s ON s.id = fs.source_id'
            . " WHERE fs.origin = 'garetien'"
        );
    } catch (PDOException) {
        return [];
    }
    $raus = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $zeile) {
        $raus[avesmapsGaretienQuellenSchluessel(
            (string) $zeile['entity_type'],
            (string) $zeile['entity_public_id'],
            (string) $zeile['url']
        )] = true;
    }

    return $raus;
}

/**
 * Der Schluessel EINER Quellen-Verknuepfung: Objektart, Objekt UND Adresse.
 *
 * 🔴 DIE ADRESSE GEHOERT DAZU, seit ein Objekt ZWEI Quellen bekommt (Sammelquelle des Wirts
 * und sein eigener Wiki-Artikel, 31.08.2026). Bis dahin lautete die Frage „haengt an diesem Objekt
 * IRGENDEINE garetien-Quelle?" -- und damit bekam ein Objekt, das vor diesem Tag importiert wurde
 * und nur die Sammelquelle traegt, seine Artikelquelle NIE angeboten. Geheilt hat das ein zweiter
 * Mechanismus (der Nachzug); eine Frage mit zwei Antwortgebern ist aber genau die Divergenz, die
 * dieses Projekt schon mehrfach bezahlt hat.
 *
 * ⚠️ Beide Leser gehen jetzt hier durch: der Planbau (was wird angeboten) und der Nachzug (was
 * wird nachgetragen).
 */
function avesmapsGaretienQuellenSchluessel(string $entityType, string $publicId, string $url): string
{
    return $entityType . '|' . $publicId . '|' . trim($url);
}

/**
 * Welche Quellen-Adressen haengt dieser Import an EIN Objekt? REIN -- kein I/O.
 *
 * 🔴 SIE MUSS ZEICHENGLEICH DAS SEIN, WAS avesmapsGaretienQuelleAnlegen WIRKLICH SCHREIBT --
 * sonst fragt der Planbau nach etwas, das nie kommt, und der Nachzug traegt in jedem Lauf erneut
 * nach. Genau das ist beim Bau passiert: die Liste nannte den Wirt IMMER, ein Item ohne
 * `after.quelle` bekommt ihn aber nie, und der Nachzug hielt es fuer ewig unvollstaendig.
 *
 * ⚠️ Deshalb nimmt sie die zwei Werte HEREIN, statt sie selbst zu raten: der Wirt steht in
 * `after.quelle.url` (leer = dieses Item bringt keine Sammelquelle mit), der Artikel kommt aus
 * avesmapsGaretienArtikelQuelleAus bzw. -AusItem.
 *
 * @return list<string>
 */
function avesmapsGaretienQuellenAdressenAus(?string $wirtUrl, ?array $artikelQuelle): array
{
    // 🔴 DER ARTIKEL SCHLAEGT DIE SAMMELQUELLE (Owner 01.09.2026: „nur noch den artikel als
    // quelle", nachdem an „Stadt Praioslob" beide nebeneinander standen: „jetzt hast du genau
    // gemacht was ich befuerchtet hatte und 2x die quelle hinzufuegt").
    //
    // Die beiden sagen dasselbe -- gleiche Domain, gleiche Namensnennung, gleiche Lizenz --, nur
    // sagt der Artikel es genau. Zwei Zeilen in der Infobox, von denen die eine in der anderen
    // enthalten ist, liest ein Besucher als Dublette, und er hat recht.
    //
    // ⚠️ Die Sammelquelle bleibt der RUECKFALL, nicht Beiwerk: knapp die Haelfte der Zeilen
    // nennt gar keinen Artikel (live gemessen 4311 von 8348 tragen einen). Fuer die ist
    // `https://www.garetien.de` die einzige Angabe, die es gibt.
    $artikel = trim((string) ($artikelQuelle['url'] ?? ''));
    if ($artikel !== '') {
        return [$artikel];
    }

    $wirt = trim((string) $wirtUrl);

    return $wirt !== '' ? [$wirt] : [];
}

/**
 * DER VIERTE AUSGANG: "haben wir -- aber sie wissen mehr" (Auftrag §4).
 *
 * 🔴 KEIN vierter change_type. Es ist ein `changed`; `after.anlass` sagt, welcher Art. Ein
 * vierter Wert muesste durch sync-plan.php, die drei Gruppen des Blattes und deren Tests wandern
 * und koennte nichts, was `anlass` nicht kann. ⭐ Und das Blatt stellt ihn schon richtig dar:
 * syncPlanDiffMarkup zeichnet `-- -> Alke` bzw. `Reichsstrasse 3 -> Angbarer Reichsstrasse` aus
 * before/after, ohne eine Zeile Aenderung.
 *
 * 🔴 EIN ABSCHNITT IST EIN EIGENES ITEM. Gehakt wird je Abschnitt, nie je Objekt -- weil ihr
 * eines Objekt ueber mehrere unserer Fluesse laufen kann. Eine Abschnittsauswahl in
 * `override`/`after` waere der zweite Schreibweg, den Auftrag §5.4 verbietet.
 *
 * REIN -- kein I/O. `$quellen` kommt aus avesmapsGaretienQuellenBestand.
 *
 * @param array<string,true> $quellen "<entity_type>|<entity_public_id>" => true
 * @return list<array>
 */
function avesmapsGaretienErgaenzungsEintraege(array $zeile, array $ziel, array $urteil, array $quellen): array
{
    $abschnitte = $urteil['abschnitte'] ?? [];
    if ($abschnitte === []) {
        return [];
    }
    $ihrName = trim((string) ($zeile['anzeige'] ?? ''));
    $einObjekt = avesmapsGaretienEinObjekt($abschnitte);
    $wiki = (string) ($zeile['wiki'] ?? 'ggp');
    // 🔴 KEIN ERSETZEN MEHR (Owner 31.08.2026). Umbenennung und Geometrie-Ersatz schreiben an
    // einem BESTEHENDEN Objekt und entstehen nicht mehr; das Luecken-Item bleibt, traegt aber nur
    // noch die QUELLE (AVESMAPS_GARETIEN_ERGAENZUNG_FELDER) -- sie ist additiv und exakt
    // ruecknehmbar.
    // ⚠️ Und das ZUSATZ-Item („trotzdem neu anlegen") bleibt ebenfalls: eine Zeile mit Treffer
    // laesst sich weiterhin als EIGENES Objekt anlegen.
    $ersetzenErlaubt = AVESMAPS_GARETIEN_ERSETZEN_ERLAUBT;
    // Der gemeinsame Rumpf (Quelle, Wiki, Beschriftung) steht schon im Neu-Eintrag -- er wird
    // wiederverwendet und nicht abgeschrieben.
    $vorlage = avesmapsGaretienPlanEintrag($zeile, $ziel, $urteil);
    $eintraege = [];
    $abschnittAnzahl = count($abschnitte);

    foreach ($abschnitte as $abschnitt) {
        $publicId = (string) $abschnitt['public_id'];
        $unserName = trim((string) ($abschnitt['name'] ?? ''));
        $nameLeer = $unserName === '';
        $nameGleich = !$nameLeer && avesmapsGaretienNamenAehnlich($ihrName, $unserName);
        // 🔴 „Legitim" ist derselbe Massstab, der ueber Luecke und Umbenennung entscheidet: nur
        // ein Abschnitt, der WIRKLICH zu ihrem Objekt gehoert (Luecke, Namensgleichheit, oder das
        // ganze Treffer-Objekt IST eins), darf ueberhaupt etwas von ihnen annehmen. Er entscheidet
        // seit Meldung A (30.08.2026, Owner) auch ueber das Geometrie-Item -- der Gardel unter
        // ihrer Natter bleibt aussen vor, auch wenn er getroffen ist.
        $legitim = $nameLeer || $nameGleich || $einObjekt;
        // 🔴 Review C1: der Schluessel traegt den Zieltyp -- derselbe public_id-Raum wird von
        // path UND region benutzt.
        //
        // 🔴 KORRIGIERT (Aufgabe 14, nach 367895a38): bei einer FLAECHE ist $publicId die
        // Regions-id (avesmapsGaretienKandidaten waehlt `r.public_id`) -- die Quelle haengt aber
        // an der BESCHRIFTUNG, nicht an der Region (map-features.php:1228, dieselbe Bindung wie
        // beim Schreiben in avesmapsGaretienErgaenzungAnwenden, garetien-uebernahme.php). Ohne
        // diese Umschaltung war $hatQuelle fuer jede Flaeche dauerhaft false, und der Abgleich
        // bot ihre Quelle bei jedem Lauf erneut an, auch wenn sie laengst haengt.
        // Die Label-id reist als DATEN mit ($abschnitt['label_public_id'], gesetzt in
        // garetien-abgleich.php) -- diese Funktion bleibt REIN und schlaegt nichts selbst nach.
        $quellenSchluesselId = $ziel['ziel'] === 'region'
            ? (string) ($abschnitt['label_public_id'] ?? '')
            : $publicId;
        // ⚠️ Fehlt die Label-id (sollte bei einer von uns angelegten Flaeche nicht vorkommen),
        // gilt OFFEN "keine Quelle liegt" -- das erzeugt hoechstens ein Item zu viel
        // (Bedienungs-Rauschen), nie eines zu wenig (eine stillschweigend verlorene
        // Quellenangabe), dieselbe Richtung wie an avesmapsGaretienQuellenBestand begruendet.
        // \U0001f534 JE ADRESSE GEFRAGT, nicht pauschal (31.08.2026). „Haengt IRGENDEINE garetien-Quelle
        // dran?" liess ein Objekt, das nur die Sammelquelle trug, seine Artikelquelle nie
        // bekommen. Gefragt wird jetzt: haengen ALLE, die dieser Import haengen wuerde?
        $hatQuelle = $quellenSchluesselId !== '';
        if ($hatQuelle) {
            $erwartet = avesmapsGaretienQuellenAdressenAus(
                (string) ($vorlage['after']['quelle']['url'] ?? ''),
                avesmapsGaretienArtikelQuelleAus($wiki, avesmapsGaretienSeitenNameAusZeile($zeile))
            );
            foreach ($erwartet as $adresse) {
                if (!isset($quellen[avesmapsGaretienQuellenSchluessel(
                    (string) $ziel['ziel'], $quellenSchluesselId, $adresse
                )])) {
                    $hatQuelle = false;
                    break;
                }
            }
        }

        // 1. Das Luecken-Item: nur Leeres wird gefuellt, deshalb VORANGEHAKT.
        // 🔴 SEIT 31.08.2026 NUR NOCH DIE QUELLE. Der leere Name wird nicht mehr gefuellt --
        // siehe AVESMAPS_GARETIEN_ERGAENZUNG_FELDER.
        $felder = [];
        if ($ersetzenErlaubt && $nameLeer) {
            $felder[] = 'name';
        }
        if (!$hatQuelle && $legitim) {
            // ⚠️ Eine Quelle bekommt nur, wem sie GEHOERT. Der Gardel liegt zufaellig unter ihrer
            // Natter -- ihre Quelle dort anzuhaengen behauptete, garetien.de beschreibe den Gardel.
            $felder[] = 'quelle';
        }
        if ($felder !== []) {
            $eintraege[] = avesmapsGaretienAbschnittsEintrag(
                $vorlage, $abschnitt, 'ergaenzung', $felder, $ihrName, $unserName, false, $abschnittAnzahl
            );
        }

        // 2. Das Umbenennungs-Item: ein VORHANDENER Name wird ueberschrieben -- nie stillschweigend.
        // 🔴 ABGESCHALTET 31.08.2026 (Owner: „aber nicht den namen verändern"). Genau dieses
        // Item hat unser Dorf „Valpolust" in „Gryffenwacht" umbenannt.
        if ($ersetzenErlaubt && !$nameLeer && !$nameGleich && $einObjekt) {
            $eintraege[] = avesmapsGaretienAbschnittsEintrag(
                $vorlage, $abschnitt, 'umbenennung', ['name'], $ihrName, $unserName, true, $abschnittAnzahl
            );
        }

        // 3. Das Geometrie-Item -- EIN Item JE LEGITIMEM Abschnitt (Owner-Meldung 30.08.2026,
        // Meldung A). 🔴 GEAENDERT: bis dahin stand hier "genau eins je Objekt, nur bei GENAU
        // EINEM getroffenen Abschnitt", mit der Begruendung, "ersetze die Geometrie" habe bei
        // mehreren kein wohldefiniertes Ziel. Der Owner widerspricht dem ausdruecklich: die
        // Einzelansicht zeigt jeden Abschnitt einzeln mit Haekchen, und die angehakten SIND das
        // Ziel -- dieselbe Form, in der Luecken- und Umbenennungs-Items oben schon laengst je
        // Abschnitt einzeln entstehen. avesmapsGaretienErgaenzungAnwenden verarbeitet jedes Item
        // ohnehin EINZELN (ein `entity_public_id` je Aufruf, in der Schleife von
        // avesmapsGaretienUebernehmen) -- ein Item je Abschnitt ist also keine neue Form, nur eine,
        // die bisher hier kuenstlich auf einen einzigen Abschnitt begrenzt war.
        // 💣 JEDER ausgewaehlte Abschnitt bekommt DIESELBE (ihre) Geometrie als Ersatz --
        // avesmapsGaretienAbschnittsEintrag aendert `after.geometry` nicht, es bleibt die aus der
        // Vorlage. Werden mehrere Abschnitte zugleich angehakt, bekommen alle denselben Verlauf;
        // das Fenster nennt dem Editor deshalb VOR dem Uebernehmen, wie viele Abschnitte betroffen
        // sind (garetienGeometrieRueckfrageText, review-garetien-importer.js).
        // 🔴 NUR LEGITIME Abschnitte -- der Gardel (fremder Name, kein gemeinsames Objekt) bekommt
        // weiterhin KEIN Geometrie-Angebot, genau wie er keine Luecke/Umbenennung bekommt: ihn
        // "Natter" zu nennen waere falsch, seine Geometrie durch die Natter zu ersetzen ebenso.
        // 🔴 RULING R6 (Owner, nach R5) bleibt in Kraft: geometrie ersetzen gilt fuer ALLE Formen
        // -- Flaechen UND Wege/Fluesse. Die zwei echten Fehler des Region-Zweigs (falscher
        // id-Raum, fehlende erwartete Revision) bleiben im Anwender repariert
        // (avesmapsGaretienErgaenzungAnwenden, garetien-uebernahme.php).
        // 🔴 ABGESCHALTET 31.08.2026 (Owner: „es gibt kein ersetzen"). Ein Geometrie-Ersatz
        // ueberschreibt den gezeichneten Verlauf eines bestehenden Objekts -- und anders als ein
        // Name laesst er sich nicht aus dem Item zurueckholen, nur aus dem Aenderungs-Protokoll.
        if ($ersetzenErlaubt && $legitim) {
            $eintraege[] = avesmapsGaretienAbschnittsEintrag(
                $vorlage, $abschnitt, 'geometrie', ['geometrie'], $ihrName, $unserName, true, $abschnittAnzahl
            );
        }
    }

    // 4. DAS ZUSATZ-ITEM -- „trotzdem neu anlegen", trotz erkannter Kollision (Meldung B,
    // 30.08.2026, Owner: „bei bestehenden Fläche, wo er Kollisionen erkannt hat ... kann ich
    // Quelle + Artikel und Geometrie ersetzen aber die Region nicht 'neu hinzufügen'"). Ein
    // Objekt, das hier ankommt, hat IMMER einen Treffer -- der vierte Ausgang existiert nur fuer
    // 'deckt_sich' -- und bislang gab es fuer „das ist trotz der Nähe ein EIGENES Objekt" keinen
    // Weg. Genau EIN Zusatz-Item je Objekt, unabhängig von der Abschnittszahl: es hängt an
    // KEINEM Abschnitt, es legt etwas DANEBEN an.
    //
    // 🔴 Dieselbe Maschinerie wie beim Zufluss (avesmapsGaretienPlanEintrag oben): `change_type`
    // 'new', `entity_public_id` NULL -- ein Schreibzugriff auf das getroffene Objekt wäre sonst
    // wieder möglich, obwohl das Ziel gerade ist, es NICHT anzufassen. Die Vorlage ($vorlage)
    // trägt schon die volle Geometrie/Quelle/Subtyp der Staging-Zeile -- geklont, nicht neu
    // gebaut, damit „trotzdem neu anlegen" ZEICHENGLEICH dasselbe Objekt anlegt wie ein echter
    // Neufund derselben Zeile.
    // 🔴 Owner: „darf niemals vorangehakt sein" -- `vorwahl_aus` bleibt TRUE, ausnahmslos. Der
    // Normalfall bei einem Treffer ist „das haben wir schon"; eine Dublette anzulegen ist die
    // begründete Ausnahme, nicht der bequeme Weg (Auftrag: „Keine Dubletten" ist eine der drei
    // tragenden Anforderungen).
    // ⚠️ Die Rückfrage davor gehört dem Fenster (garetienZusatzRueckfrageText,
    // review-garetien-importer.js) -- sie liest `objekt.grund`/`objekt.name`, die in der
    // Einzelansicht schon stehen, statt hier ein weiteres Feld zu bauen.
    $zusatz = $vorlage;
    $zusatz['change_type'] = 'new';
    // 💣 NULL, nicht der Treffer: sonst wäre es doch ein Schreibzugriff auf das getroffene
    // Objekt, und „trotzdem neu anlegen" hieße in Wahrheit „unseres überschreiben".
    $zusatz['entity_public_id'] = null;
    $zusatz['before'] = [];
    $trefferName = trim((string) ($urteil['treffer_name'] ?? ''));
    $zusatz['label'] = $ihrName . ' (' . $zeile['typ'] . ') · trotz Nähe zu '
        . ($trefferName !== '' ? '"' . $trefferName . '"' : 'einem unbenannten Objekt')
        . ' zusätzlich anlegen';
    $zusatz['after']['anlass'] = 'zusatz';
    // Nur eine ANGABE fuer den Menschen, der die Zeile ansieht -- nie ein Ziel (dieselbe Regel
    // wie beim Zufluss-Nachbarn oben).
    $zusatz['after']['nachbar'] = $trefferName !== '' ? $trefferName : null;
    $zusatz['vorwahl_aus'] = true;
    $eintraege[] = $zusatz;

    return $eintraege;
}

/** Menschlich lesbarer Anlass, fuer die Beschriftung -- NICHT fuer `after.anlass` (Review I1). */
const AVESMAPS_GARETIEN_ANLASS_BESCHRIFTUNG = [
    'ergaenzung' => 'Quelle',
    'umbenennung' => 'umbenennen',
    'geometrie' => 'Geometrie',
];

/**
 * Ein Item fuer EINEN Abschnitt, aus der gemeinsamen Vorlage.
 *
 * 💣 Der `entity_key` traegt den Abschnitt UND den Anlass. Ohne beides teilten sich zwei Items
 * eine Zeile in `sync_decision` -- und eine Ablehnung des Umbenennens naehme die Quelle mit.
 *
 * 🔴 Review I1: DIE BESCHRIFTUNG WAR UNTERSCHEIDUNGSLOS. Sechs Reichsstrasse-3-Abschnitte tragen
 * denselben Namen -- ohne Anlass UND Abschnitt sahen ihr Quellen-Item und ihr Umbenennungs-Item
 * (und alle sechs Umbenennungs-Items untereinander) identisch aus. Die Beschriftung traegt jetzt
 * den Anlass, und bei mehreren getroffenen Abschnitten zusaetzlich die public_id.
 *
 * 🔴 Review I1: `after.name` bleibt NUR stehen, wenn 'name' wirklich in `felder` liegt -- sonst
 * behauptet das Blatt (syncPlanDiffMarkup zeigt jedes Feld aus `after`) eine Umbenennung, die gar
 * nicht ausgefuehrt wird (ein Quellen- oder Geometrie-Item schreibt keinen Namen).
 */
function avesmapsGaretienAbschnittsEintrag(
    array $vorlage, array $abschnitt, string $anlass, array $felder,
    string $ihrName, string $unserName, bool $vorwahlAus, int $abschnittAnzahl
): array {
    $publicId = (string) $abschnitt['public_id'];
    $eintrag = $vorlage;
    $eintrag['entity_key'] = mb_substr($vorlage['entity_key'] . '|' . $anlass . '|' . $publicId, 0, 190, 'UTF-8');
    $eintrag['entity_public_id'] = $publicId;
    $eintrag['change_type'] = 'changed';
    $anlassText = AVESMAPS_GARETIEN_ANLASS_BESCHRIFTUNG[$anlass] ?? $anlass;
    $abschnittText = $abschnittAnzahl > 1 ? ' (' . $publicId . ')' : '';
    $eintrag['label'] = $ihrName . ' → ' . ($unserName !== '' ? $unserName : 'ohne Namen')
        . ' · ' . $anlassText . $abschnittText;
    $eintrag['before'] = ['public_id' => $publicId, 'name' => $unserName];
    $eintrag['after']['anlass'] = $anlass;
    $eintrag['after']['felder'] = $felder;
    if (!in_array('name', $felder, true)) {
        // Kein Namenswechsel auf diesem Item -- die Vorlage traegt IHREN Namen in `after.name`
        // (fuer den Neu-Fall gedacht), und der wuerde hier faelschlich als Umbenennung gelesen.
        unset($eintrag['after']['name']);
    }
    $eintrag['after']['abschnitt'] = [
        'public_id' => $publicId,
        'name' => $unserName,
        'punkte' => (int) ($abschnitt['punkte'] ?? 0),
        // 🔴 Die Geometrie traegt seit dem 30.08.2026 ihre RINGSTRUKTUR (avesmapsGaretienGeoJsonTeile)
        // -- flachgeklopft wurde daraus die "wirre rosa Linie". Sie wird hier nur durchgereicht.
        'geometrie' => $abschnitt['geometrie'] ?? [],
        // 💣 Und ihre Kappungszahl MIT. Diese Fassung gewinnt in
        // avesmapsGaretienListeAbschnitteVereinen ueber die gespeicherte; fehlt sie hier, kappt
        // der Server still (AGENTS.md §9).
        'verworfene_teile' => (int) ($abschnitt['verworfene_teile'] ?? 0),
    ];
    // ⚠️ `nachbar` gehoert dem Zufluss und hat hier nichts zu suchen.
    $eintrag['after']['nachbar'] = null;
    $eintrag['vorwahl_aus'] = $vorwahlAus;

    return $eintrag;
}

/**
 * Das Urteil an die Staging-Zeile -- damit "deckt sich" und "uebersprungen" nach dem Rechnen
 * noch filterbar sind. Sie erzeugen keinen sync_plan_item, und ohne diese zwei Spalten waere ihr
 * Grund im Arbeitsspeicher geblieben (Aufgabe 6, 27.08.2026).
 *
 * ⚠️ Es steht im STAGING und verschwindet mit ihm (Auftrag §5.5). In sync_plan_item landet
 * dadurch nichts Zusaetzliches.
 *
 * 🔴 REVIEW C1 (Critical, 27.08.2026): `zeile_nr` ALLEIN ist KEIN Schluessel innerhalb eines
 * Laufs -- sie beginnt je SEITE neu bei 1 (`avesmapsGaretienStageSeite`, `garetien-abruf.php`),
 * und der Endpunkt legt ausdruecklich mehrere Seiten in EINEN Lauf. Nachgemessen am echten
 * Zwei-Seiten-Bestand (ggp + kosch Gewaesser, 289 Zeilen): 43 Zeilennummern sind doppelt
 * vergeben. Ohne `wiki`+`ebene` im WHERE traf ein UPDATE BEIDE Zeilen mit derselben Nummer --
 * und item-lose Objekte (Aufgabe 8) lesen ihr urteil/grund AUSSCHLIESSLICH von hier, ein Editor
 * haette also den Grund einer FREMDEN Zeile vorgelegt bekommen. Der Schluessel ist deshalb
 * (run_id, wiki, ebene, zeile_nr) -- exakt das Tupel, unter dem `avesmapsGaretienStageSeite`
 * ihre `zeile_nr` ueberhaupt erst vergibt.
 */
function avesmapsGaretienSchreibeUrteil(
    PDO $pdo, int $importRunId, string $wiki, string $ebene, int $zeileNr, string $urteil, string $grund,
    array $abschnitte = [], ?float $deckung = null
): void {
    // 💣 Die Vorgabe der zwei letzten Parameter ist TRAGEND: der Uebersprung-Zweig ruft diese
    // Funktion, bevor es ueberhaupt einen Abgleich gibt, und jeder kuenftige Aufrufer ohne
    // Trefferauskunft laeuft unveraendert weiter.
    //
    // 🔴 EINE Spalte fuer die ganze Trefferauskunft, nicht drei. Liste, Deckungsgrad und die Zahl
    // der verglichenen Probepunkte entstehen in EINEM Lauf von avesmapsGaretienFindeBestand; drei
    // Spalten koennten auseinanderlaufen, eine kann es nicht. Der Nenner wird dabei NICHT eigens
    // gespeichert -- er ist die Summe der Abschnittsdeckungen (jeder Probepunkt zaehlt fuer genau
    // einen Abschnitt), und eine zweite Zahl fuer dieselbe Summe waere genau die Divergenz.
    //
    // ⚠️ NICHT gekappt. Ein mit `mb_substr` beschnittenes JSON ist kein JSON mehr -- der Leser
    // bekaeme `null` und saehe damit aus wie "der Abgleich fand nichts". Dafuer ist die Spalte
    // MEDIUMTEXT (avesmapsGaretienEnsureUrteilSpalten).
    // ⚠️ Nichts zu berichten heisst NULL, nicht `[]`: "vor dem Nachzug gerechnet" und "nichts
    // getroffen" muessen unterscheidbar bleiben.
    $treffer = $abschnitte === [] && $deckung === null
        ? null
        : json_encode(
            ['deckung' => $deckung, 'abschnitte' => array_values($abschnitte)],
            JSON_UNESCAPED_UNICODE
        );
    $pdo->prepare(
        'UPDATE garetien_import_row SET urteil = :u, grund = :g, abschnitte_json = :a'
        . ' WHERE run_id = :r AND wiki = :w AND ebene = :e AND zeile_nr = :n'
    )->execute([
        ':u' => mb_substr($urteil, 0, 20, 'UTF-8'),
        ':g' => mb_substr($grund, 0, 300, 'UTF-8'),
        ':a' => $treffer === false ? null : $treffer,
        ':r' => $importRunId,
        ':w' => $wiki,
        ':e' => $ebene,
        ':n' => $zeileNr,
    ]);
}

/**
 * Reist die Trefferauskunft des Abgleichs ueberhaupt mit? REIN -- kein I/O.
 *
 * 🔴 GENAU DANN, WENN DER ABGLEICH EIN OBJEKT VON UNS BENANNT HAT -- `treffer_public_id`. Das ist
 * KEINE Aufzaehlung von Urteilsnamen: eine solche Liste waere bei der naechsten Urteilsart still
 * falsch, und niemand merkte es. Sie fragt, was der Abgleich BEHAUPTET.
 *
 * 💣 DER FALL, DER SIE ERZWUNGEN HAT: `avesmapsGaretienDeckung` filtert die Kandidaten ueber die
 * HUELLBOX, nicht ueber AVESMAPS_GARETIEN_TREFFER_EINHEITEN. Ein Objekt, dessen Rechteck unseres
 * ueberlappt, das aber Dutzende Karteneinheiten entfernt liegt, bekam deshalb eine Trefferliste --
 * und die Einzelansicht schrieb drei einander widersprechende Saetze in EINEN Kasten: "1 Abschnitt
 * . Deckung Median 42,79" (das Einundzwanzigfache der Schwelle), "nichts zu ersetzen" (liest sich
 * als "haben wir schon") und darunter den Grund "naechstes gleichartiges Objekt liegt 42.79
 * Einheiten entfernt". Am Pruefstand gemessen: Fernfluss, Urteil `neu`, 2 Abschnitte.
 *
 * 💣 NICHT auf die 2,0-Schwelle filtern. Das naehme dem `widerspricht` seine Abschnitte -- und der
 * ist gerade der Fall "derselbe Artikel behauptet zwei Stellen", bei dem man die weit entfernte
 * Stelle SEHEN muss (Fernartikel, 8,95 Einheiten, behaelt sie). Der `zufluss` behaelt seine
 * ebenfalls (Seitenarm der Alke, 0,18 -- der ist echt).
 */
function avesmapsGaretienUrteilNenntTreffer(array $urteil): bool
{
    return ($urteil['treffer_public_id'] ?? null) !== null;
}

/**
 * Der Namensbefund je Abschnitt: heisst unser Abschnitt so wie ihr Objekt? REIN -- kein I/O.
 *
 * 🔴 ER GEHOERT ZUR TREFFERLISTE, NICHT ZUM ITEM. Ein Abschnitt ohne Item (der Gardel) hat
 * trotzdem einen Namensbefund, und die Einzelansicht zeigt ihn -- haengte er am Item, faehlte er
 * genau dort, wo er am meisten sagt.
 * 🔴 Er benutzt `avesmapsGaretienNamenAehnlich`, dieselbe Regel, die auch ueber das
 * Umbenennungs-Item entscheidet. Ein zweiter Namensvergleich waere die zweite Wahrheit darueber,
 * was "derselbe Name" heisst -- und der Editor saehe "Name gleich" an einer Zeile, die trotzdem
 * eine Umbenennung anbietet.
 *
 * 🔧 OFFEN, UND ES IST EINE BEWUSSTE LUECKE: das Mockup (§3, §6a) zeigt neben dem Namensbefund
 * noch "liegt auf Darpat" -- den Namen des Flusses, zu dem ein NAMENLOSER Abschnitt gehoert.
 * Diese Beziehung gibt es in unseren Daten nicht: ein map_features-Abschnitt ohne Namen hat kein
 * uebergeordnetes Objekt und keinen Namensverbund. `after.nachbar` ist es NICHT -- das ist der
 * Zufluss-Nachbar und am Abschnitts-Item hart `null` (avesmapsGaretienAbschnittsEintrag).
 * Sie herzuleiten hiesse: eine geometrische Nachbarschaftssuche ueber benannte Abschnitte
 * derselben Wegart, mit eigenen Schwellen, fuer eine Textzeile -- ein Owner-Entscheid, keine
 * Auslassung. Wird sie je gebaut, gehoert sie HIERHER (an die Trefferliste, beim Planbau) und
 * nie in den Browser.
 */
function avesmapsGaretienAbschnitteMitNamensbefund(array $abschnitte, string $ihrName): array
{
    $raus = [];
    foreach ($abschnitte as $abschnitt) {
        $unserName = trim((string) ($abschnitt['name'] ?? ''));
        $abschnitt['name_gleich'] = $unserName !== ''
            && avesmapsGaretienNamenAehnlich($ihrName, $unserName);
        $raus[] = $abschnitt;
    }

    return $raus;
}

/**
 * Die Uebernahmen ALTER Laeufe dauerhaft nachtragen -- ein einmaliger Nachzug, der sich selbst
 * ueberfluessig macht.
 *
 * 🔴 WOZU (Owner 30.08.2026): `avesmapsSyncPlanRecordApplied` schreibt den dauerhaften Vermerk erst
 * seit heute. Alles, was VORHER uebernommen wurde, hat ihn nicht -- und stuende beim naechsten
 * „Holen & Rechnen" wieder unter „Offen", obwohl es laengst auf der Karte liegt. Genau das hat der
 * Owner gemeldet.
 *
 * ⭐ Der Nachzug ist EXAKT, nicht geraten: `avesmapsSyncPlanSupersedeRuns` LOESCHT einen alten Lauf
 * nicht, es setzt nur seinen Zustand auf 'superseded'. Seine Items stehen also noch da, samt
 * `apply_state = 'done'` und `entity_key`. Der Umweg ueber die Quellenspur (`origin='garetien'` in
 * feature_sources) waere die schlechtere Achse gewesen: sie haengt am OBJEKT, nicht an der
 * Importzeile, und haette zugeordnet werden muessen.
 *
 * 🔴 GESCHRIEBEN WIRD MIT DEMSELBEN SCHREIBER wie zur Laufzeit (avesmapsSyncPlanRecordApplied),
 * nicht mit einer eigenen SQL. Eine zweite Fassung derselben Regel ist genau die Doppelung, die
 * dieses Projekt mehrfach bezahlt hat -- und sie waere hier besonders leicht zu uebersehen, weil
 * der Nachzug nach dem ersten Lauf nichts mehr tut.
 * ⚠️ Damit ist er idempotent und faellt von selbst trocken: was schon einen Vermerk hat, bekommt
 * ihn nur neu gestempelt.
 */
function avesmapsGaretienUebernahmenNachtragen(PDO $pdo): int
{
    try {
        $stmt = $pdo->prepare(
            'SELECT i.entity_key, i.change_type
               FROM sync_plan_item i
               JOIN sync_plan_run r ON r.id = i.run_id
              WHERE r.kind = :k AND i.apply_state = :s'
        );
        $stmt->execute(['k' => AVESMAPS_GARETIEN_PLAN_KIND, 's' => 'done']);
    } catch (PDOException) {
        // Die Tabellen stehen noch nicht -- der Normalfall vor dem allerersten Lauf.
        return 0;
    }

    $nachgetragen = 0;
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $entityKey = trim((string) ($zeile['entity_key'] ?? ''));
        if ($entityKey === '') {
            continue;
        }
        // ⚠️ `userId` 0: wer es damals uebernommen hat, steht im Item nicht -- und eine erfundene
        // Kennung waere schlimmer als keine.
        avesmapsSyncPlanRecordApplied(
            $pdo,
            AVESMAPS_GARETIEN_PLAN_KIND,
            $entityKey,
            0,
            (string) ($zeile['change_type'] ?? 'new')
        );
        $nachgetragen++;
    }

    return $nachgetragen;
}

/**
 * Den Plan fuer einen Import-Lauf bauen. Gibt die Zahl der Vorschlaege zurueck.
 *
 * 🔴 Review I3: `deckt_sich` geht seit dem vierten Ausgang (Aufgabe 3) durch
 * `avesmapsGaretienErgaenzungsEintraege` -- das erzeugt KEINEN Eintrag nur, wenn jeder getroffene
 * Abschnitt Namen UND Quelle schon traegt (das Geometrie-Item bleibt trotzdem, "immer ungehakt"
 * gilt unabhaengig davon). `uebersprungen` erzeugt weiterhin keinen Eintrag, aber der Grund steht
 * im Lauf-Vermerk, damit die Zahl nachpruefbar bleibt: "6 uebersprungen" ohne Grund ist keine
 * Auskunft.
 */
/**
 * EINMALIGE WANDERUNG: Altschluessel ohne Anzeigenamen auf die neue Form ziehen.
 *
 * 🔴 Owner 01.09.2026: „ja, name in den schluessel". Damit aendert sich die IDENTITAET
 * jedes Objekts -- und `entity_key` ist genau die Identitaet, unter der `sync_decision` haelt, was
 * uebernommen und was abgelehnt wurde. Ohne diese Wanderung faende ein Vermerk sein Objekt nie
 * wieder: alle Uebernahmen staenden schlagartig wieder auf „Offen", und ein bereits angelegtes
 * Objekt boete sich ein zweites Mal zum Einfuegen an -- die Dublette, gegen die dieser Importer
 * seit dem 31.08.2026 gebaut ist.
 *
 * 💣 SIE ZIEHT AUCH `sync_plan_item` MIT. Die Ruecknahme sucht die angelegte public_id ueber
 * (kind, entity_key, change_type) in den alten, `superseded` gesetzten Laeufen
 * (avesmapsGaretienRuecknahmeAusfuehren). Bliebe deren Schluessel alt, waere genau der Ausgang
 * wieder zu, der am selben Tag aufgemacht wurde.
 *
 * ⚠️ GEWANDERT WIRD NUR, WAS EINDEUTIG IST. Ein Altschluessel, unter dem MEHRERE Zeilen mit
 * verschiedenen Namen lagen, ist ja gerade der Fall, den die Aenderung aufloest -- dort ist nicht
 * entscheidbar, welchem Namen der Vermerk galt, und er verfaellt. Live gemessen 01.09.2026: 25
 * solcher Schluessel ueber 8348 Zeilen; die uebrigen 8188 wandern 1:1.
 *
 * 🔴 Sie ist idempotent und laeuft sich selbst tot: ein Schluessel in neuer Form traegt ein
 * "!" und wird nicht mehr angefasst. Ist irgendwann keiner mehr alt, kostet sie EINE Abfrage.
 *
 * @return int Zahl der gewanderten Vermerke
 */
function avesmapsGaretienSchluesselWanderung(PDO $pdo, int $importRunId): int
{
    $basisVon = static fn(string $key): string => avesmapsGaretienObjektSchluessel($key);
    $suffixVon = static function (string $key): string {
        $pos = strpos($key, '|');

        return $pos === false ? '' : substr($key, $pos);
    };

    // 1. Gibt es ueberhaupt Altschluessel? Sonst kostet die Wanderung zwei Abfragen und ist fertig.
    //
    // 💣 UND ES SIND NUR ZWEI SCHMALE MENGEN, NICHT ALLE ITEMS. Die erste Fassung sammelte
    // JEDEN `entity_key` aus `sync_plan_item` ueber alle Laeufe -- das sind 8213 je Lauf, und die
    // Schleife unten fuhr fuer jeden zwei UPDATEs. Ergebnis live am 01.09.2026: „Holen & Rechnen"
    // lief in die Zeitschranke, STRATO antwortete mit 502 und einer HTML-Fehlerseite, die im
    // Browser als „Unexpected token '<'" ankam. Genau die Last, vor der CLAUDE.md warnt.
    //
    // 🔴 GEBRAUCHT WIRD NUR, WAS EINEN LAUF UEBERLEBT:
    //   · `sync_decision` -- die dauerhaften Vermerke (eine Handvoll Zeilen).
    //   · `sync_plan_item` MIT `apply_state = 'done'` -- nur die findet die laufuebergreifende
    //     Ruecknahme (avesmapsGaretienRuecknahmeAusfuehren), und nur ihre public_id ist noch
    //     woanders gebraucht.
    // Alles uebrige wird bei JEDEM Planbau ohnehin neu gebaut, und zwar schon in der neuen Form --
    // es zu wandern waere Arbeit fuer Zeilen, die zwei Zeilen spaeter ersetzt werden.
    $alteKeys = [];
    $sammeln = static function (PDOStatement $stmt) use (&$alteKeys, $basisVon): void {
        foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $key) {
            $key = (string) $key;
            if (!str_contains($basisVon($key), AVESMAPS_GARETIEN_SCHLUESSEL_NAME_TRENNER)) {
                $alteKeys[$key] = true;
            }
        }
    };

    $stmt = $pdo->prepare('SELECT DISTINCT entity_key FROM sync_decision WHERE kind = :k');
    $stmt->execute(['k' => AVESMAPS_GARETIEN_PLAN_KIND]);
    $sammeln($stmt);

    $stmt = $pdo->prepare(
        'SELECT DISTINCT i.entity_key FROM sync_plan_item i'
        . ' JOIN sync_plan_run r ON r.id = i.run_id'
        . " WHERE r.kind = :k AND i.apply_state = 'done'"
    );
    $stmt->execute(['k' => AVESMAPS_GARETIEN_PLAN_KIND]);
    $sammeln($stmt);

    if ($alteKeys === []) {
        return 0;
    }

    // 2. Die Abbildung alt -> neu aus den Staging-Zeilen DIESES Laufs.
    // ⚠️ Die ALTE Formel steht hier ein zweites Mal, und das ist der einzige Ort, an dem das
    // erlaubt ist: sie beschreibt einen Zustand der Vergangenheit, den es sonst nirgends mehr
    // gibt. Faellt die Wanderung eines Tages weg, faellt sie mit.
    $stmt = $pdo->prepare(
        'SELECT wiki, ebene, zeile_nr, typ, namensraum, artikel, anzeige'
        . ' FROM garetien_import_row WHERE run_id = :r ORDER BY id'
    );
    $stmt->execute([':r' => $importRunId]);
    // ⚠️ Nur die Basen, nach denen wirklich gefragt wird -- sonst stuenden 8213 Eintraege im
    // Speicher, von denen eine Handvoll gebraucht wird.
    $gesucht = [];
    foreach (array_keys($alteKeys) as $altKey) {
        $gesucht[$basisVon($altKey)] = true;
    }
    $abbildung = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $seite = avesmapsGaretienSeitenNameAusZeile($zeile);
        $altBasis = (string) ($zeile['wiki'] ?? 'ggp') . ':' . $zeile['ebene'] . ':' . $zeile['typ']
            . ':' . ($seite !== '' ? $seite : ('#' . $zeile['zeile_nr']));
        if (!isset($gesucht[$altBasis])) {
            continue;
        }
        $abbildung[$altBasis][avesmapsGaretienObjektSchluesselAusZeile($zeile)] = true;
    }

    // 3. Wandern, was eindeutig ist.
    $decision = $pdo->prepare(
        'UPDATE sync_decision SET entity_key = :neu WHERE kind = :k AND entity_key = :alt'
    );
    $item = $pdo->prepare(
        'UPDATE sync_plan_item SET entity_key = :neu WHERE entity_key = :alt AND run_id IN'
        . ' (SELECT id FROM (SELECT id FROM sync_plan_run WHERE kind = :k) x)'
    );

    $gewandert = 0;
    foreach (array_keys($alteKeys) as $altKey) {
        $ziele = $abbildung[$basisVon($altKey)] ?? [];
        if (count($ziele) !== 1) {
            continue;
        }
        $neuKey = array_key_first($ziele) . $suffixVon($altKey);
        try {
            $decision->execute(['neu' => $neuKey, 'alt' => $altKey, 'k' => AVESMAPS_GARETIEN_PLAN_KIND]);
            $gewandert += $decision->rowCount();
            $item->execute(['neu' => $neuKey, 'alt' => $altKey, 'k' => AVESMAPS_GARETIEN_PLAN_KIND]);
        } catch (PDOException) {
            // ⚠️ Der Zielschluessel steht schon da (UNIQUE) -- dann ist nichts zu tun, und ein
            // Abbruch wuerde die uebrigen Vermerke mitreissen.
        }
    }

    return $gewandert;
}

function avesmapsGaretienBaueSyncPlan(PDO $pdo, int $importRunId, int $userId = 0): int
{
    avesmapsEnsureSyncPlanTables($pdo);
    // 🔴 Die Urteilsspalten VOR dem ersten Schreibvorgang nachziehen. `abschnitte_json` kam am
    // 28.08.2026 dazu; ein Lauf, der vor dem Nachzug abgerufen wurde, traegt sie noch nicht, und
    // ohne diese Zeile braeche das erste UPDATE den ganzen Planbau ab. EINMAL je Planbau -- das
    // ist eine 0,35-s-Handlung, kein haeufiger Pfad (die Last, vor der AGENTS.md §10 warnt,
    // entstuende erst im Lesepfad, und dort steht sie ausdruecklich nicht).
    avesmapsGaretienEnsureUrteilSpalten($pdo);
    // 🪤 Der Kandidatenspeicher gilt fuer den ganzen Prozess. Wer im selben Lauf erst uebernimmt
    // und dann neu plant, bekaeme sonst den Stand von vorher.
    avesmapsGaretienKandidatenVergessen();
    // 🔴 VOR dem neuen Lauf: die Uebernahmen der ALTEN Laeufe dauerhaft nachtragen.
    avesmapsGaretienUebernahmenNachtragen($pdo);

    $runId = avesmapsSyncPlanStartRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND, $userId, 'import:' . $importRunId);
    if ($runId <= 0) {
        throw new RuntimeException('Der Vorschau-Lauf konnte nicht angelegt werden.');
    }
    // 🔴 VOR dem Lesen der Entscheidungen: Altschluessel auf die neue Form ziehen. Danach
    // liest der Planbau nur noch Schluessel, die zu den Items passen, die er gleich baut.
    avesmapsGaretienSchluesselWanderung($pdo, $importRunId);
    $entscheidungen = avesmapsSyncPlanDecisions($pdo, AVESMAPS_GARETIEN_PLAN_KIND);
    // EINE Abfrage je Lauf -- der vierte Ausgang fragt sonst je Abschnitt nach.
    $quellenBestand = avesmapsGaretienQuellenBestand($pdo);

    $stmt = $pdo->prepare(
        'SELECT wiki, ebene, zeile_nr, typ, namensraum, artikel, anzeige, lodmin, lodmax, extra, geo_art, geo'
        . ' FROM garetien_import_row WHERE run_id = :r ORDER BY id'
    );
    $stmt->execute([':r' => $importRunId]);

    $anzahl = 0;
    $uebersprungen = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $grund = avesmapsGaretienUeberspringGrund($zeile);
        if ($grund !== null) {
            $uebersprungen[$grund] = ($uebersprungen[$grund] ?? 0) + 1;
            // 💣 Der Uebersprung-Zweig steht VOR dem Abgleich und wird sonst nie erfasst -- das
            // sind genau die 6, um die es in Aufgabe 6 geht.
            avesmapsGaretienSchreibeUrteil($pdo, $importRunId, (string) $zeile['wiki'], (string) $zeile['ebene'], (int) $zeile['zeile_nr'], 'uebersprungen', $grund);
            continue;
        }
        $ziel = avesmapsGaretienMappeTyp((string) $zeile['typ']);
        if ($ziel === null) {
            continue;   // von avesmapsGaretienUeberspringGrund bereits erfasst
        }
        $urteil = avesmapsGaretienFindeBestand($pdo, $zeile, $ziel);
        // Das Urteil ueberlebt das Rechnen -- auch "deckt_sich", das seit Aufgabe 3 durch den
        // vierten Ausgang eigene Items erzeugen KANN, aber nicht MUSS (⚠️ Brief §Aufgabe 6: das
        // ist kein Widerspruch, sondern derselbe Sachverhalt aus zwei Blickwinkeln).
        // 🔴 DIE GANZE TREFFERLISTE WANDERT MIT, nicht nur der genannte Beste. Ein getroffener
        // Abschnitt, der kein Item erzeugt, existierte fuer das Fenster sonst gar nicht -- und
        // genau das ist der Gardel unter ihrer Natter: sein Name ist weder leer noch gleich, und
        // ihr Objekt laeuft ueber mehrere unserer, also faellt er durch beide Zweige von
        // avesmapsGaretienErgaenzungsEintraege. Ein dreiteiliger Fall saehe wie ein zweiteiliger
        // aus (Aufgabe 13b).
        // 🔴 Die Zahl entsteht HIER, EINMAL. Sie im Lesepfad neu zu rechnen waere eine zweite
        // Wahrheit ueber "was trifft was" -- und sie liefe je Zeile der Liste.
        // 🔴 ABER NUR, WENN DER ABGLEICH EIN OBJEKT VON UNS BENANNT HAT. Ohne diesen Riegel bekaeme
        // ein `neu` Phantom-Abschnitte aus dem blossen Huellbox-Vorfilter -- die Begruendung steht
        // bei avesmapsGaretienUrteilNenntTreffer. Die Auskunft reist GANZ oder GAR NICHT: eine
        // Deckung ohne Abschnitte stuende als "Deckung Median 42,79" ueber "0 Abschnitte".
        $nenntTreffer = avesmapsGaretienUrteilNenntTreffer($urteil);
        avesmapsGaretienSchreibeUrteil(
            $pdo, $importRunId, (string) $zeile['wiki'], (string) $zeile['ebene'], (int) $zeile['zeile_nr'],
            $urteil['status'], $urteil['grund'],
            $nenntTreffer ? avesmapsGaretienAbschnitteMitNamensbefund(
                (array) ($urteil['abschnitte'] ?? []), trim((string) ($zeile['anzeige'] ?? ''))
            ) : [],
            $nenntTreffer && $urteil['abstand'] !== null ? (float) $urteil['abstand'] : null
        );
        if ($urteil['status'] === 'uebersprungen') {
            continue;
        }
        // 🔴 DER VIERTE AUSGANG. `deckt_sich` erzeugte bis zum 27.08.2026 gar nichts -- und genau
        // dabei gingen ihr Name, ihr Wiki-Artikel und ihre Quelle verloren. 25 von 76
        // Geometrietreffern trugen bei uns keinen Namen.
        $eintraege = $urteil['status'] === 'deckt_sich'
            ? avesmapsGaretienErgaenzungsEintraege($zeile, $ziel, $urteil, $quellenBestand)
            : [avesmapsGaretienPlanEintrag($zeile, $ziel, $urteil)];
        foreach ($eintraege as $eintrag) {
            // 🔴 Die Vorwahl kommt aus der HAUSREGEL, sie wird nicht nachgebaut: 'deleted' nie,
            // 'changed' faellt beim zweiten Ueberspringen heraus. Ein zweiter Vorwahl-Rechner waere
            // genau die Divergenz, die diese Anbindung vermeiden soll.
            $schluessel = avesmapsSyncPlanDecisionKey($eintrag['entity_key'], $eintrag['change_type']);
            $eintrag['selected'] = avesmapsSyncPlanDefaultSelected(
                $eintrag['change_type'],
                (int) ($entscheidungen[$schluessel]['skipped_count'] ?? 0)
            );
            // 🔴 Die Hausregel kann nur AUS-, nie EINgeschaltet werden. Sie darf einen Zufluss
            // nicht vorhaken; ein Zufluss darf umgekehrt aber auch nicht anhaken, was sie
            // ausgehakt hat (zweimal uebersprungen heisst zweimal uebersprungen).
            if ($eintrag['vorwahl_aus']) {
                $eintrag['selected'] = 0;
            }
            unset($eintrag['vorwahl_aus']);
            avesmapsSyncPlanAddItem($pdo, $runId, $eintrag);
            $anzahl++;
        }
    }

    avesmapsSyncPlanFinishBuild($pdo, $runId);

    if ($uebersprungen !== []) {
        // Der Grund reist im Lauf mit -- eine Zahl ohne Grund ist keine Auskunft.
        $pdo->prepare('UPDATE sync_plan_run SET source_stamp = :s WHERE id = :id')->execute([
            ':s' => mb_substr('import:' . $importRunId . ' · ' . json_encode($uebersprungen, JSON_UNESCAPED_UNICODE), 0, 64, 'UTF-8'),
            ':id' => $runId,
        ]);
    }

    return $anzahl;
}

/**
 * Ein SQLite-Prüfstand mit Staging, Bestand und Vorschau-Tabellen.
 *
 * ⚠️ Lebt hier und nicht im Test, weil die Uebernahme (Aufgabe 6) denselben Aufbau braucht --
 * zwei Fassungen desselben Pruefstands laufen auseinander, und dann prueft der eine etwas
 * anderes als der andere.
 */
function avesmapsGaretienPlanTestPdo(): PDO
{
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec('CREATE TABLE garetien_import_run (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT, finished_at TEXT, status TEXT, note TEXT)');
    $pdo->exec('CREATE TABLE garetien_import_row (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INT, wiki TEXT, ebene TEXT, zeile_nr INT, typ TEXT, namensraum TEXT, artikel TEXT, anzeige TEXT, lodmin TEXT, lodmax TEXT, extra TEXT, geo_art TEXT, geo TEXT, roh TEXT)');
    // 🔴 RULING P1: die Tabelle steht hier bewusst OHNE die Urteilsspalten -- wie live vor dem
    // 27.08.2026. Der Nachzug laeuft ueber denselben ALTER-Weg wie in Produktion, statt die
    // Spalten hart in dieses CREATE zu schreiben; nur so prueft dieser Pruefstand den echten
    // Nachzug an einer bestehenden Tabelle, nicht nur seinen Endzustand.
    avesmapsGaretienEnsureUrteilSpalten($pdo);
    $pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, name TEXT, feature_type TEXT, feature_subtype TEXT, geometry_json TEXT, properties_json TEXT, is_active INT DEFAULT 1)');
    $pdo->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, name TEXT, kind TEXT, region_type TEXT, wiki_url TEXT, label_public_id TEXT, is_active INT DEFAULT 1)');
    $pdo->exec('CREATE TABLE ecosystem_area (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, region_id INT, geometry_geojson TEXT, is_active INT DEFAULT 1, is_trial INT DEFAULT 0)');
    // 🔴 Review C1: eine TESTTABELLE (kein Produktions-DDL, das steht in
    // api/_internal/app/feature-sources.php), damit avesmapsGaretienQuellenBestand() ihre Abfrage
    // wirklich AUSFUEHRT statt sie im catch-Zweig zu verschlucken. Bleibt LEER -- ein Test, der
    // eine hinterlegte Quelle braucht, saet seine eigene Zeile.
    $pdo->exec('CREATE TABLE feature_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT, entity_public_id TEXT, source_id INT, status TEXT DEFAULT \'approved\', origin TEXT DEFAULT \'manual\')');
    // 🔴 Seit 01.09.2026 fragt avesmapsGaretienQuellenBestand je (Objekt, ADRESSE) und JOINt dafuer
    // den Katalog -- der Pruefstand braucht ihn deshalb auch.
    $pdo->exec('CREATE TABLE sources (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT, url_hash TEXT, label TEXT, source_type TEXT, is_official INT DEFAULT 0, license TEXT, attribution TEXT)');
    avesmapsEnsureSyncPlanTablesSqlite($pdo);

    // Ein Bestandsfluss dort, wo die erste Quellzeile landet -- damit "deckt_sich" wirklich
    // vorkommt und der Test nicht nur den Neu-Fall prueft.
    $vorhanden = avesmapsGaretienLinieNachAvesmaps([[20000.0, 10000.0], [21000.0, 11000.0], [22000.0, 12000.0]]);
    $pdo->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json) VALUES (?,?,?,?,?,?)')
        ->execute(['vorhanden-1', 'Alke', 'path', 'Flussweg',
            json_encode(['type' => 'LineString', 'coordinates' => $vorhanden], JSON_UNESCAPED_UNICODE), '{}']);

    $pdo->exec("INSERT INTO garetien_import_run (id, started_at, status) VALUES (1, '2026-08-26 12:00:00', 'done')");
    $zeilen = [
        // deckt sich mit 'vorhanden-1'
        ['ggp', 'Gewaesser', 1, 'Bach', 'Garetien', 'Alke', 'Alke', 'koordinaten', '20000 10000, 21000 11000, 22000 12000'],
        // neu, ein Fluss weit weg
        ['ggp', 'Gewaesser', 2, 'Fluss', 'Garetien', 'Gardel', 'Gardel', 'koordinaten', '90000 -40000, 91000 -41000, 92000 -42000'],
        // neu, eine Seeflaeche
        ['ggp', 'Gewaesser', 3, 'See', 'Garetien', 'Muehlsee', 'Mühlsee', 'koordinaten', '1000 -12000, 1800 -12700, 1200 -13400, 1000 -12000'],
        // uebersprungen: Sammelartikel
        ['ggp', 'Gewaesser', 4, 'Fluss', '', 'Nachbarprovinzen', 'Llavari', 'koordinaten', '1 2, 3 4'],
        // uebersprungen: Typ ohne Gegenstueck. 🔴 Review C1: zeile_nr=1 ist ABSICHT, nicht Zufall
        // -- sie kollidiert mit der Alke (Zeile darueber, ebenfalls zeile_nr=1) ueber ein ANDERES
        // wiki. Genau das tut die Produktion: avesmapsGaretienStageSeite() startet zeile_nr fuer
        // JEDE Seite neu bei 1, und ein Lauf traegt mehrere Seiten -- am echten Zwei-Seiten-
        // Bestand gemessen sind 43 von 289 Zeilennummern doppelt vergeben. Ohne wiki+ebene im
        // Schluessel von avesmapsGaretienSchreibeUrteil traf ein UPDATE fuer die Alke auch diese
        // Zeile mit (und umgekehrt) -- garetien-staging-test.php sichert beide Seiten der
        // Kollision einzeln zu.
        // 🔴 'Kontinent' statt 'Insel' seit 29.08.2026 (Aufgabe 12): Insel ist jetzt zugeordnet
        // (Entwurf §3.4, `topographie/insel`), Kontinent bleibt in
        // AVESMAPS_GARETIEN_OHNE_GEGENSTUECK und liefert weiterhin verlaesslich 'uebersprungen'.
        ['kosch', 'Gewaesser', 1, 'Kontinent', '', '', 'Aventurien', 'koordinaten', '-193386 52741, -194553 52157, -193386 52741'],
        // 🔴 Ein ZUFLUSS: liegt auf der Alke, ist aber nur ein Bruchteil ihrer Ausdehnung.
        // Er ist ein eigenes neues Objekt und darf die Alke nicht anfassen.
        ['ggp', 'Gewaesser', 6, 'Bach', 'Garetien', 'Seitenarm der Alke', 'Seitenarm der Alke', 'koordinaten',
         '20000 10300, 20200 10500, 20400 10700'],
    ];
    $ins = $pdo->prepare('INSERT INTO garetien_import_row (run_id, wiki, ebene, zeile_nr, typ, namensraum, artikel, anzeige, lodmin, lodmax, extra, geo_art, geo, roh)
                          VALUES (1,?,?,?,?,?,?,?,\'\',\'\',\'\',?,?,\'\')');
    foreach ($zeilen as $z) {
        $ins->execute($z);
    }

    return $pdo;
}
