// Hell oder dunkel VOR dem ersten Bild (WI-0032, Legacy index.html:13-23): die eigene Wahl aus dem Speicher, sonst wie das
// Betriebssystem (Betreiber 2026-09-24). Den Rest macht src/theme/theme.ts. Karte und Statusseite laden diese Datei synchron im Kopf.
//
// Eine eigene Datei statt eines Inline-Skripts (WI-0120 A12, Claudio 2026-10-09): So reicht auf Stage und Production eine
// statische CSP `script-src 'self'`; ein Hash im vhost müsste sich mit jeder Änderung hier ändern, und jede Änderung am vhost ist
// ein Betreiber-Gate. Kein Modul und kein Bundle: Sie muss laufen, bevor irgendetwas anderes lädt.
/* global window, document, localStorage -- ein klassisches Skript im Browser, ohne Bundle */
(function () {
    var saved = null;
    try {
        saved = localStorage.getItem("avesmaps-theme");
    } catch {
        // Ohne Speicher entscheidet das Betriebssystem.
    }
    var systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (saved === "dark" || (saved !== "light" && systemDark)) {
        document.documentElement.dataset.theme = "dark";
    }
})();
