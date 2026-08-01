<?php

declare(strict_types=1);

// "Wer bin ich, was darf ich" -- der einzige Weg, auf dem die statische Karte von der Anmeldung erfährt.
//
// GET /api/app/session.php
//   -> { ok:true, authenticated:bool, username:string|null, role:string|null,
//        capabilities:{ admin:bool, edit:bool, review:bool } }
//
// 💣 WARUM ES DIESEN ENDPUNKT GIBT. Bis 2026-08-01 hing die Landschaftsebene an `?landschaften=1` --
// einem ungeprüften URL-Schalter. Ihn durch „nur für Admins" zu ersetzen (Owner 2026-07-30) ging nicht
// ohne diesen Kanal: `index.html` ist statisch, serverseitig gerendert wird der Nutzer nur in
// `edit/index.php` und `admin/index.php`, und die Editor-Hülle bindet die Karte als
// `<iframe ...&edit=1>` ein, ohne etwas über den Nutzer weiterzugeben. Einen `session`/`me`-Endpunkt
// gab es nicht; `POST /api/edit/map/presence.php` liefert zwar Name und Rolle, verlangt aber die
// Fähigkeit `review` und wird nur im Edit-Modus gepollt -- als Rechteauskunft für die öffentliche
// Karte ist er der falsche Hebel.
//
// 🔴 KEIN PDO, KEIN DDL, KEINE TABELLE. Dieser Endpunkt liest die PHP-Sitzung und sonst nichts. Er
// läuft auf dem Startpfad JEDES Besuchers -- eine Datenbankverbindung hier wäre auf dem STRATO-Webspace
// eine Verbindung pro Seitenaufruf für eine Auskunft, die schon im Cookie steht (AGENTS.md §10).
//
// 🔴 `no-store`, nicht `no-cache`. Die Antwort hängt am Sitzungs-Cookie. Ein Zwischenspeicher, der die
// Admin-Antwort einem anonymen Besucher ausliefert, wäre genau der Fehler, den dieser Umbau abstellt.
// Deshalb steht hier auch KEIN ETag, obwohl jeder andere Lesepfad im Haus einen hat.
//
// ⚠️ CORS: `avesmapsApplyCorsPolicy` sendet nie `Access-Control-Allow-Credentials`, deshalb kann keine
// fremde Seite diese Antwort MIT dem Cookie lesen -- auch nicht, wenn die Konfiguration `*` erlaubt.
// Das ist die Eigenschaft, auf der die Sicherheit hier ruht; sie darf nicht beiläufig aufgeweicht werden.

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/auth.php';

try {
    // 💣 Die Konfiguration wird hier NUR fuer die CORS-Regel gebraucht, und ihr Fehlen darf diesen
    // Endpunkt nicht umwerfen: sie beschreibt die Datenbank, und dieser Endpunkt fasst keine an. Ohne
    // Konfiguration bleibt `$allowedOrigins` leer -- eine gleichnamige Anfrage (kein Origin-Kopf, also
    // der Normalfall) geht durch, eine fremde Herkunft wird abgewiesen. Faellt also geschlossen aus.
    //
    // ⚠️ Gefunden, weil es zuerst ANDERS war: mit dem Aufruf im aeusseren try lief eine fehlende
    // Konfiguration in den catch-Block, und der antwortet „du bist niemand" -- ein angemeldeter Admin
    // waere still zum anonymen Besucher geworden, mit exakt derselben 200er-Antwort. Genau die Art
    // Fehler, die man auf der Karte nie findet.
    $config = [];
    try {
        $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    } catch (Throwable) {
        $config = [];
    }

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'This origin may not read the session.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Only GET is allowed for the session.');
    }

    // avesmapsCurrentUser() gibt den Sitzungs-Dateilock sofort wieder frei (session_write_close), was auf
    // dem netzgemounteten Webspace der Unterschied zwischen „schnell" und „der Editor blockiert sich
    // selbst" ist -- siehe die Begründung an der Funktion.
    $user = avesmapsCurrentUser();

    // 💣 NACH avesmapsCurrentUser(), nicht davor. `session_start()` setzt seinen eigenen cache limiter
    // und ERSETZT dabei ein vorher gesetztes Cache-Control -- davor gesetzt kam hier gar kein
    // Cache-Control mehr an der Leitung an (gemessen, nicht vermutet). Bei einer Antwort, die vom
    // Sitzungs-Cookie abhaengt, ist genau das der Fehler, den dieser Umbau abstellen soll.
    header('Cache-Control: no-store, private');
    header('Vary: Cookie');

    avesmapsJsonResponse(200, ['ok' => true] + avesmapsSessionPayload($user));
} catch (Throwable) {
    // Fällt geschlossen aus: im Zweifel ist der Besucher anonym und die Karte bietet nichts an. Ein 500
    // wäre hier schlechter als eine ehrliche „du bist niemand"-Antwort, weil der Client sonst auf dem
    // Startpfad einen Fehler behandeln müsste, dessen einzige richtige Reaktion ohnehin „anonym" ist.
    avesmapsJsonResponse(200, ['ok' => true] + avesmapsSessionPayload(null));
}
