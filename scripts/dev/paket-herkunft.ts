// Woraus besteht das Besucherpaket? (WI-0235, Optimierer) Der reine Teil des Wächters `paket-waechter.ts`: Startdateien aus
// `index.html` lesen, ihre Bytes über die Source Map den Quelldateien zuordnen und die Quellen nach Herkunft einordnen.
//
// Anlass (Betreiber 2026-10-19, wörtlich): „legacy hat den editor code getrennt. sprich er wurde nicht geladen wenn jemand das frontend
// besucht hat, ist das immer noch so?“ Es ist nicht so: Das Start-JS wuchs vom 06.10. bis 19.10. von 2,0 auf 7,0 MB (0,6 auf 1,9 MB
// gzip), und niemand bemerkte es, weil kein Lauf die Größe ansah (`project-control/discovery/leistung-2026-10-19.md`).
//
// Gezählt werden die Bytes der ausgelieferten, minifizierten Dateien, nicht die Quellen: Jedes Segment der Source Map gehört bis zum
// nächsten Segment seiner Zeile der Quelle, die es nennt. Ohne Abhängigkeit: Die Base64-VLQ-Kodierung ist klein genug, um sie hier zu
// lesen; `source-map-js` liegt nur als Abhängigkeit von Vite im Baum.

/** Die Herkunftsklassen, in der Reihenfolge der Ausgabe. */
export const KLASSEN = [
    "Sprachtafeln",
    "Editor",
    "MapLibre",
    "Karte",
    "shared",
    "config",
    "Vue",
    "Bibliotheken",
    "Anmeldung",
    "app.vue",
    "ohne Zuordnung",
] as const;
export type Klasse = (typeof KLASSEN)[number];

/**
 * Was nur mit Editor- oder Verwaltungsrechten gebraucht wird, relativ zu `apps/web/src/`. Ganze Ordner zuerst, dann einzelne Dateien in
 * gemischten Ordnern. 🪤 Eine Faustregel nach Ordnern, keine Analyse des Importgraphen: Ein neuer Editor-Ordner gehört hier eingetragen,
 * sonst zählt er als „Karte“. Nach der Trennung (`EDITOR_GETRENNT` im Wächter) meldet jeder Treffer im Startpaket eine Kopplung.
 */
const EDITOR_ORDNER = [
    "editor-panel/",
    "editor-menu/",
    "editor-liste/",
    "editor-sperre/",
    "ortseditor/",
    "wegeditor/",
    "landschaftseditor/",
    "gebietseditor/",
    "kraftlinieneditor/",
    "medien/",
    "freigabe/",
    "warteschlange/",
    "zoombaender/",
    "gebirge-vorschau/",
    "map/geometrie/",
    "status/",
];
const EDITOR_DATEIEN = [
    /^news\/(neuigkeiten-editor|neuigkeiten-papierkorb|pflege|verwaltung-neuigkeiten)/,
    /^system\/(mess-|client-messung|messfenster-merker|ungespeichert)/,
    /^map\/(edit-revision|entwurfs-|place-set|sperre-|verborgene-flaechen|verborgen-auge|map-checks|label-tuner)/,
    /^fenster\/(entwurf-|wiki-zuordnung|zoomspanne|bearbeitung|folge-arbeit|ablage-hinweis|leistenplatz|listen-schalter)/,
    /^controls\/(editor-zeichen|sperr-kasten)/,
    /^kartenserien\/verwaltung-/,
    /^besuch\/de-bundeslaender/,
];
/** In `auth/` braucht der Besucher nur den Sitzungskern; die Anmeldung zählt eigens, alles Übrige ist Konto und Verwaltung. */
const AUTH_KERN = /^auth\/(session-state|entry|api|auth-windows|formular|seitentitel)\./;
const AUTH_ANMELDUNG =
    /^auth\/(anmelde|anmelden|passkey|passwort|webauthn|zweiter-faktor|discord-zeichen|oder-trenner|einladung|zugangslink|bestaetigen)/;

/** Ordnet einen Quellpfad aus der Source Map (relativ zu `dist/assets`, etwa `../../src/app.vue`) einer Klasse zu. */
export function herkunft(quelle: string | undefined): Klasse {
    if (quelle === undefined) return "ohne Zuordnung";
    const pfad = quelle.replaceAll("\\", "/");
    const npm = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(pfad)?.[1];
    if (npm !== undefined) {
        if (npm === "maplibre-gl") return "MapLibre";
        if (npm === "vue" || npm.startsWith("@vue/")) return "Vue";
        if (npm === "@avesmaps3d/shared") return "shared";
        return "Bibliotheken";
    }
    if (pfad.includes("packages/shared/")) return "shared";
    if (/(^|\/)config\/[^/]+/.test(pfad) && !pfad.includes("/src/")) return "config";
    const web = /(?:^|\/)src\/(.+)$/.exec(pfad)?.[1];
    if (web === undefined) return "ohne Zuordnung";
    if (web === "app.vue") return "app.vue";
    if (/^i18n\/[a-z]{2}\.ts$/.test(web)) return "Sprachtafeln";
    if (EDITOR_ORDNER.some((ordner) => web.startsWith(ordner))) return "Editor";
    if (EDITOR_DATEIEN.some((muster) => muster.test(web))) return "Editor";
    if (web.startsWith("auth/")) {
        if (AUTH_KERN.test(web)) return "Karte";
        if (AUTH_ANMELDUNG.test(web)) return "Anmeldung";
        return "Editor";
    }
    return "Karte";
}

/** Die Dateien, die `index.html` beim Start lädt: das Modul-Skript, seine `modulepreload`-Verweise und die Stilblätter. */
export function startDateien(indexHtml: string): { js: string[]; css: string[] } {
    const js = new Set<string>();
    const css = new Set<string>();
    for (const tag of indexHtml.match(/<(?:script|link)\b[^>]*>/g) ?? []) {
        const ziel = /\b(?:src|href)="\/?([^"]+)"/.exec(tag)?.[1];
        if (ziel === undefined || !ziel.startsWith("assets/")) continue;
        if (tag.startsWith("<script") || /rel="modulepreload"/.test(tag)) js.add(ziel);
        else if (/rel="stylesheet"/.test(tag)) css.add(ziel);
    }
    return { js: [...js], css: [...css] };
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const ZIFFER = new Map([...BASE64].map((zeichen, wert) => [zeichen, wert]));

/** Ein Segment der Source Map als Folge von Zahlen (Base64-VLQ, je Ziffer fünf Bit, das sechste sagt „es folgt mehr“). */
export function vlq(segment: string): number[] {
    const werte: number[] = [];
    let wert = 0;
    let schiebe = 0;
    for (const zeichen of segment) {
        const ziffer = ZIFFER.get(zeichen);
        if (ziffer === undefined) throw new Error(`Source Map: unbekanntes Zeichen „${zeichen}“`);
        wert += (ziffer & 31) << schiebe;
        if (ziffer & 32) {
            schiebe += 5;
            continue;
        }
        werte.push(wert & 1 ? -(wert >>> 1) : wert >>> 1);
        wert = 0;
        schiebe = 0;
    }
    return werte;
}

export interface SourceMap {
    readonly sources: readonly string[];
    readonly mappings: string;
}

/** Bytes (UTF-8) der erzeugten Datei je Quellpfad; Bytes ohne Segment oder ohne Quelle stehen unter `undefined`. */
export function bytesJeQuelle(code: string, map: SourceMap): Map<string | undefined, number> {
    const ergebnis = new Map<string | undefined, number>();
    fuerJedesStueck(code, map, (quelle, stueck) => {
        ergebnis.set(quelle, (ergebnis.get(quelle) ?? 0) + Buffer.byteLength(stueck, "utf8"));
    });
    return ergebnis;
}

/**
 * Zerlegt die erzeugte Datei lückenlos in Stücke und nennt je Stück die Quelle (`undefined`: ohne Segment, ohne Quelle oder ein
 * Zeilenumbruch). Die Stücke ergeben zusammen genau `code`.
 */
export function fuerJedesStueck(
    code: string,
    map: SourceMap,
    rueckruf: (quelle: string | undefined, stueck: string) => void,
): void {
    const zaehle = (quelle: string | undefined, stueck: string): void => {
        if (stueck.length > 0) rueckruf(quelle, stueck);
    };
    const zeilen = code.split("\n");
    const mapZeilen = map.mappings.split(";");
    let quelle = 0;
    for (let nr = 0; nr < zeilen.length; nr += 1) {
        const zeile = zeilen[nr] ?? "";
        // Spalten zählen in UTF-16-Einheiten, wie JavaScript-Strings; die Zeilenumbrüche gehören zu keiner Quelle.
        const segmente: { spalte: number; quelle: string | undefined }[] = [];
        let spalte = 0;
        for (const segment of (mapZeilen[nr] ?? "").split(",")) {
            if (segment === "") continue;
            const werte = vlq(segment);
            spalte += werte[0] ?? 0;
            if (werte.length >= 4) {
                quelle += werte[1] ?? 0;
                segmente.push({ spalte, quelle: map.sources[quelle] });
            } else {
                segmente.push({ spalte, quelle: undefined });
            }
        }
        zaehle(undefined, zeile.slice(0, segmente[0]?.spalte ?? zeile.length));
        segmente.forEach((segment, i) => {
            zaehle(segment.quelle, zeile.slice(segment.spalte, segmente[i + 1]?.spalte ?? zeile.length));
        });
        if (nr < zeilen.length - 1) zaehle(undefined, "\n");
    }
}
