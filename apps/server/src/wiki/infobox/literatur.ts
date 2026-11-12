import { leseParameter } from "./block.ts";
import type { Infoboxseite } from "./seite.ts";
import {
    LEER,
    LEER_FOLGE,
    entschluesseleHtml,
    kuerze,
    ohneWikiAuszeichnung,
    phpTrim,
    schluesselform,
    titelOhneAuszeichnung,
} from "./text.ts";

/**
 * Ein Werk der Spielliteratur aus seinem Wiki-Artikel (WI-0253, Scheibe Literatur): die Felder, die Legacys Literatur-Abgleich aus `{{Infobox Produkt}}` liest und in
 * `adventure` schreibt, in denselben Grenzen und mit derselben Bereinigung. Das Vorbild (Legacy-Mirror a7f2dac86):
 *
 * - `avesmapsWikiParseProductInfobox` (`api/_internal/wiki/publication-parsing.php`): der Kasten, die Parameter (zeilenweise, Namen mit Groß- und Kleinschreibung),
 *   die Zeichenverweise GENAU EINMAL aufgelöst (`avesmapsWikiDecodeEntities`), die Werkart (`avesmapsWikiProductGameLiteratureKind`), die Ortsliste
 *   (`avesmapsWikiParseGameLiteraturePlaceList`) und die Bereinigung von Genre, Autoren und Reihe (`avesmapsWikiStripWikiInlineMarkup`);
 * - die Ablage im Katalog (`api/_internal/wiki/game-literature-sync.php`, Phase `adventures`): Titel aus `Titel`, sonst der Seitentitel; die Längen der Spalten.
 *   🔴 Gewollte Abweichung: Legacy übernahm den Titel samt `<br>` und Wiki-Link; hier geht er durch `titelOhneAuszeichnung`, wie jeder Titel einer Quelle oder eines Werks.
 *
 * Welche Spalten der Abgleich setzt, sagt Legacys Liste `AVESMAPS_GAME_LITERATURE_WIKI_FIELDS`. Hier stehen davon die, die Avesmaps3D aus dem Wiki übernimmt:
 * `wiki_url` ist die Zuordnung (die ändert dieser Abgleich nie, Work Item §3a), und das Cover (`Bild`, `Cover`) ist eine Datei des Wikis, die nicht abgerufen wird
 * (§4 B1). `bf_year`, `bf_label`, `contained_in`, `link_ulisses`, `link_fshop`, `isbn` und `is_official` schreibt Legacys Abgleich nie; sie fehlen hier ebenso.
 *
 * 🔴 Ein Feld, das der Artikel nicht oder leer nennt, fehlt im Ergebnis: „das Wiki kennt nichts“, nie ein Leerstring (wie `lesen.ts`).
 */

/** Die Felder eines Werks, die der Abgleich liest, in der Reihenfolge, in der der Bericht sie zeigt. Die Namen sind die Spalten von `adventure`. */
export const LITERATUR_FELDER: readonly string[] = [
    "title",
    "product_type",
    "edition",
    "genre",
    "complexity_gm",
    "complexity_pl",
    "authors",
    "series",
    "fshop_code",
];

/** Die Werkarten (Legacy `AVESMAPS_GAME_LITERATURE_KINDS`): welches Feld die Orte trägt. Die Abenteuer-Familie erkennt `werkart` zusätzlich am Wortteil. */
const WERKARTEN: readonly { art: string; typen: readonly string[]; ortsfeld: "Ort" | "Thema" }[] = [
    { art: "abenteuer", typen: ["szenario", "anthologie", "metaband"], ortsfeld: "Ort" },
    { art: "roman", typen: ["roman"], ortsfeld: "Ort" },
    { art: "kurzgeschichte", typen: ["kurzgeschichte"], ortsfeld: "Ort" },
    { art: "regionalspielhilfe", typen: ["regionalspielhilfe"], ortsfeld: "Thema" },
    { art: "spielhilfe", typen: ["spielhilfe"], ortsfeld: "Thema" },
];

/** Zu welcher Werkart ein `Art`-Wert gehört; `""`: keine Spielliteratur (Regelband, Hörbuch, Brettspiel …). Legacy `avesmapsWikiProductGameLiteratureKind`. */
export function werkart(art: string): string {
    const schluessel = schluesselform(art);
    if (schluessel === "") return "";
    if (schluessel.includes("abenteuer") || schluessel.includes("kampagne")) return "abenteuer";
    return WERKARTEN.find((eintrag) => eintrag.typen.includes(schluessel))?.art ?? "";
}

const ortsfeldDer = (art: string): "Ort" | "Thema" =>
    WERKARTEN.find((eintrag) => eintrag.art === art)?.ortsfeld ?? "Ort";

const ORTSLINK = new RegExp(`\\[\\[${LEER}*([^\\]|#]+?)${LEER}*(?:#[^\\]|]*)?(?:\\|[^\\]]*)?\\]\\]`, "gu");
const LISTENTRENNER = new RegExp(`${LEER}*[,;\\n]${LEER}*`, "u");

/**
 * Die Ortsliste eines Werks (Legacy `avesmapsWikiParseGameLiteraturePlaceList`): die Ziele der Wikilinks in der Reihenfolge des Texts. Ohne Link eine Kommaliste, aber nur
 * im Feld `Ort` (`mitFreitext`): `Thema` ist nicht immer eine Ortsliste („erweiterte Regeln“).
 */
export function ortsliste(wert: string, mitFreitext: boolean): string[] {
    const aus: string[] = [];
    for (const treffer of wert.matchAll(ORTSLINK)) {
        const ziel = phpTrim(treffer[1] ?? "");
        if (ziel !== "") aus.push(ziel);
    }
    if (aus.length > 0 || !mitFreitext) return aus;
    return phpTrim(wert)
        .split(LISTENTRENNER)
        .map((name) => phpTrim(name))
        .filter((name) => name !== "");
}

/** Legacy `avesmapsWikiStripWikiInlineMarkup`: Fett und Kursiv weg, `[[Ziel|Text]]` wird „Text“, `[[Ziel]]` „Ziel“, Leerraum ein Leerzeichen. */
export function ohneAuszeichnung(text: string): string {
    return phpTrim(ohneWikiAuszeichnung(text).replace(LEER_FOLGE, " "));
}

const LEERZEICHEN_KLASSE = LEER.slice(1, -1);
const F_SHOP = new RegExp(
    `\\{\\{${LEER}*F-Shop${LEER}*\\|${LEER}*PID${LEER}*=${LEER}*([^|}${LEERZEICHEN_KLASSE}]+)`,
    "iu",
);

export type ProduktGrund = "keine_infobox" | "nicht_geschlossen" | "fremde_infobox" | "keine_literatur";

export type ProduktErgebnis =
    | {
          ok: true;
          infobox: string;
          /** Die gefalteten Werkart-Schlüssel (`product_type`) und die Art im Text (für den Bericht). */
          art: string;
          werkart: string;
          felder: Readonly<Record<string, string>>;
          /** Die Ortsliste (Ziele der Wikilinks), für die Frage, ob Legacy den Artikel in den Katalog genommen hätte. */
          orte: readonly string[];
          /** Hätte Legacy aus diesem Artikel einen Katalogeintrag gemacht? Nur mit Ortsliste („no linked place, no entry“). */
          katalog: boolean;
      }
    | { ok: false; grund: ProduktGrund; infobox: string; art: string };

function setze(felder: Record<string, string>, name: string, wert: string): void {
    if (wert !== "") felder[name] = wert;
}

/**
 * Liest einen Produkt-Artikel. Ohne `{{Infobox Produkt}}` (als ERSTE Infobox der Seite), mit offener Klammer oder mit einer Art, die keine Spielliteratur ist, ist der
 * Artikel kein Werk; das ist ein Befund, nie ein Raten. Ein Werk ohne Ortsliste liest sich trotzdem (`katalog: false`): Legacy legt daraus nichts neu an, aber
 * die Felder eines vorhandenen Werks hängen nicht an seinen Orten.
 */
export function leseProdukt(seite: Infoboxseite): ProduktErgebnis {
    const infobox = seite.infobox;
    if (infobox === "") return { ok: false, grund: "keine_infobox", infobox, art: "" };
    if (!seite.block.geschlossen) return { ok: false, grund: "nicht_geschlossen", infobox, art: "" };
    if (seite.infoboxSchluessel !== "produkt") return { ok: false, grund: "fremde_infobox", infobox, art: "" };

    // EIN Durchgang für alle Werte (Legacy: `array_map('avesmapsWikiDecodeEntities', $params)`), nie ein zweiter.
    const parameter = new Map<string, string>();
    for (const [name, wert] of leseParameter(seite.block.block)) parameter.set(name, entschluesseleHtml(wert));
    const roh = (name: string): string => parameter.get(name) ?? "";

    const art = phpTrim(roh("Art"));
    const zugehoerig = werkart(art);
    if (zugehoerig === "") return { ok: false, grund: "keine_literatur", infobox, art };

    const ortsfeld = ortsfeldDer(zugehoerig);
    let orte = ortsliste(roh(ortsfeld), ortsfeld === "Ort");
    if (orte.length === 0) {
        const anderes = ortsfeld === "Ort" ? "Thema" : "Ort";
        orte = ortsliste(roh(anderes), anderes === "Ort");
    }

    // Die Reihe: `Teil von`, sonst `Reihe` – auch wenn sie leer ist (PHP `??` fragt nur, ob es den Parameter gibt) –, sonst `Reihentitel`.
    const reihe =
        phpTrim(roh("Teil von")) !== "" ? roh("Teil von") : parameter.has("Reihe") ? roh("Reihe") : roh("Reihentitel");
    const titel = phpTrim(titelOhneAuszeichnung(roh("Titel")));
    const fShop = F_SHOP.exec(roh("Direktlinks"));

    const felder: Record<string, string> = {};
    setze(felder, "title", kuerze(titel === "" ? seite.titel : titel, 300));
    setze(felder, "product_type", kuerze(schluesselform(art), 32));
    setze(felder, "edition", kuerze(phpTrim(roh("Regeln")), 16));
    setze(felder, "genre", kuerze(ohneAuszeichnung(roh("Genre")), 160));
    setze(felder, "complexity_gm", kuerze(phpTrim(roh("KompM")), 60));
    setze(felder, "complexity_pl", kuerze(phpTrim(roh("KompSp")), 60));
    setze(felder, "authors", kuerze(ohneAuszeichnung(roh("Autoren")), 500));
    setze(felder, "series", kuerze(ohneAuszeichnung(reihe), 200));
    setze(felder, "fshop_code", kuerze(phpTrim(fShop?.[1] ?? ""), 40));
    return { ok: true, infobox, art, werkart: zugehoerig, felder, orte, katalog: orte.length > 0 };
}
