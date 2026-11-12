import type { KartenSvgDialekt } from "./optionen.ts";

/**
 * Text, Namen und Kennungen des SVG-Abzugs (WI-0280 K2), Portierung aus Legacys `js/pages/svg-export-build.js`.
 *
 * 💣 DIE FALTUNG HIER IST NICHT DIE `wiki_key`-FALTUNG (`packages/shared/src/fold-name.ts`, Legacy `avesmapsFoldToAscii`). Dort
 * verlieren Umlaute ihren Grundbuchstaben („Fürstentum Kosch“ → „f-rstentum-kosch“), und sie darf nie „schöner“ gemacht werden,
 * weil jede Änderung eine Datenmigration über viele Tabellen ist. HIER entsteht ein eigener Namensraum, der nirgends joint und nie
 * in eine Zeile geschrieben wird: Also wird normal gefaltet (`ä` → `ae`, `ß` → `ss`).
 */

const FALTUNG: Readonly<Record<string, string>> = {
    ä: "ae",
    ö: "oe",
    ü: "ue",
    Ä: "Ae",
    Ö: "Oe",
    Ü: "Ue",
    ß: "ss",
    á: "a",
    à: "a",
    â: "a",
    é: "e",
    è: "e",
    ê: "e",
    í: "i",
    ì: "i",
    î: "i",
    ó: "o",
    ò: "o",
    ô: "o",
    ú: "u",
    ù: "u",
    û: "u",
    ç: "c",
    ñ: "n",
};

// Zeichen, die XML 1.0 überhaupt nicht kennt (auch nicht als Verweis), und ungepaarte Surrogate. Ein Name mit einem solchen
// Zeichen machte aus der ganzen Datei ein Dokument, das kein Parser annimmt; Legacy hat das nie gemessen, die Karte kennt es nicht.
// eslint-disable-next-line no-control-regex
const UNGUELTIG = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const UNGEPAART = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Maskiert Text für Attributwerte UND Textinhalt. Tabulator und Zeilenwechsel werden zu Zeichenverweisen: In einem Attribut
 * würde der Parser sie sonst still zu Leerzeichen machen.
 */
export function maskiere(wert: unknown): string {
    return String(wert ?? "")
        .replace(UNGUELTIG, "")
        .replace(UNGEPAART, "�")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/\t/g, "&#9;")
        .replace(/\n/g, "&#10;")
        .replace(/\r/g, "&#13;");
}

/** Ein Wort für eine `id`: nur `A-Za-z0-9_-`, Umlaute gefaltet, alles andere ein Bindestrich. */
export function faltAscii(text: unknown): string {
    return (
        String(text ?? "")
            // Alles AUSSERHALB des druckbaren ASCII durch die Tabelle; was dort fehlt, wird ein Bindestrich.
            // ⚠️ Nicht als /[^ -]/ schreiben: das wäre die Klasse „weder Leerzeichen noch Bindestrich“ und schickte jeden Buchstaben
            // durch die Faltung.
            .replace(/[^\x20-\x7E]/g, (zeichen) => FALTUNG[zeichen] ?? "-")
            .replace(/[^A-Za-z0-9_-]+/g, "-")
            .replace(/-{2,}/g, "-")
            .replace(/^-|-$/g, "")
    );
}

/**
 * Illustrators eigene Maskierung: Was in einem XML-Namen nicht erlaubt ist, wird `_xHH_`. Buchstaben von À bis ɏ bleiben, außer
 * dem Mal- und dem Geteilt-Zeichen (U+00D7, U+00F7): Sie stehen im Bereich, sind aber keine Namenszeichen.
 * ⚠️ Ob Illustrator das beim Import zurückverwandelt, ist (wie in Legacy) nicht gemessen.
 */
export function adobeMaskierung(text: unknown): string {
    return String(text ?? "").replace(/[^A-Za-z0-9À-ÖØ-öø-ɏ_-]/g, (zeichen) => {
        const hex = (zeichen.codePointAt(0) ?? 0).toString(16).toUpperCase();
        return `_x${hex}_`;
    });
}

/**
 * 🔴 DIE EINZIGE STELLE, AN DER EINE `id` ENTSTEHT. Die Beschriftung der Wege ruft sie für ihren `<textPath href>` NICHT noch
 * einmal: Sie liest die id aus der Merkliste, die der Wegebauer füllt. Ein zweiter Zusammenbau des Namens ließe jeden Verweis ins
 * Leere zeigen und machte die ganze Wegbeschriftung unsichtbar, in einer Datei, die sonst tadellos aussieht.
 */
export function kennungFuer(
    name: string,
    oeffentlicheKennung: string,
    dialekt: KartenSvgDialekt,
    gesehen: Set<string>,
): string {
    const kennung = oeffentlicheKennung;
    let id =
        dialekt === "illustrator"
            ? adobeMaskierung(name)
            : [faltAscii(name), faltAscii(kennung)].filter(Boolean).join("-");
    if (!id) id = "objekt";
    // XML: ein Name beginnt nie mit einer Ziffer.
    if (/^[^A-Za-z_]/.test(id)) id = `x${id}`;

    if (gesehen.has(id)) {
        const trenner = dialekt === "illustrator" ? "_x20_" : "-";
        const basis = kennung ? `${id}${trenner}${faltAscii(kennung)}` : id;
        id = basis;
        let nummer = 2;
        while (gesehen.has(id)) {
            id = `${basis}-${String(nummer)}`;
            nummer += 1;
        }
    }
    gesehen.add(id);
    return id;
}

/** Die id einer Gruppe: aus einem festen Wort, doppelte bekommen eine Nummer. Gruppen und Elemente teilen sich dieselbe Menge. */
export function gruppenKennung(basis: string, gesehen: Set<string>): string {
    let id = basis;
    let nummer = 2;
    while (gesehen.has(id)) {
        id = `${basis}-${String(nummer)}`;
        nummer += 1;
    }
    gesehen.add(id);
    return id;
}

/** Eine Zahl für ein Attribut: ohne Fließkommarauschen (0,125 × 1,1 wird nicht 0,13750000000000002). */
export function zahlText(zahl: number): string {
    return String(Math.round(zahl * 10_000) / 10_000);
}

/** Attribute als Text; leere und fehlende fallen weg. */
export function attributText(werte: Readonly<Record<string, string | undefined>>): string {
    return Object.entries(werte)
        .filter(([, wert]) => wert !== undefined && wert !== "")
        .map(([name, wert]) => ` ${name}="${maskiere(wert)}"`)
        .join("");
}

function labelAttribut(name: string, dialekt: KartenSvgDialekt): string {
    return dialekt === "inkscape" ? ` inkscape:label="${maskiere(name)}"` : "";
}

export interface GruppenKopf {
    id: string;
    name: string;
    dialekt: KartenSvgDialekt;
    attribute?: Readonly<Record<string, string | undefined>>;
}

export function gruppeOeffnen(kopf: GruppenKopf): string {
    return `<g id="${maskiere(kopf.id)}"${labelAttribut(kopf.name, kopf.dialekt)}${attributText(kopf.attribute ?? {})}>\n`;
}

/** Eine Ebene ist eine Gruppe, die Inkscape als Ebene führt (`inkscape:groupmode="layer"`). */
export function ebeneOeffnen(kopf: GruppenKopf): string {
    const modus = kopf.dialekt === "inkscape" ? ' inkscape:groupmode="layer"' : "";
    return `<g id="${maskiere(kopf.id)}"${modus}${labelAttribut(kopf.name, kopf.dialekt)}${attributText(kopf.attribute ?? {})}>\n`;
}

export const GRUPPE_SCHLIESSEN = "</g>\n";

/** Das Label eines Elements im Inkscape-Dialekt (im Illustrator-Dialekt trägt die `id` den Namen). */
export { labelAttribut };
