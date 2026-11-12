import type { Pdfmake } from "pdfmake/build/pdfmake";
import schriftAdresse from "../../../../assets/fonts/FacultyGlyphic-Regular.ttf?url";
import type { PdfDokument } from "./pdf-knoten";
import { abdeckung, saeuberer } from "./zeichen";

/**
 * pdfmake und die Hausschrift, erst beim Öffnen von „Reise als PDF“ geladen (WI-0306). 🔴 Nichts davon liegt im Start-JS: pdfmake (MIT) kommt
 * über einen dynamischen Import, die Schrift (Faculty Glyphic Regular, OFL, `assets/fonts/`) als eigene Datei des Baus. pdfmake liest keine
 * Adressen: Bilder und Schrift kommen als Daten, jede URL wird abgewiesen (`setUrlAccessPolicy`).
 */

/** Der Name der Hausschrift im PDF. */
export const PDF_SCHRIFT = "FacultyGlyphic";
const SCHRIFT_DATEI = "FacultyGlyphic-Regular.ttf";

export interface PdfWerkzeug {
    pdfmake: Pdfmake;
    /** Ersetzt, was die Hausschrift nicht hat (`zeichen.ts`). */
    saeubern: (text: string) => string;
}

let laedt: Promise<PdfWerkzeug> | undefined;

function base64(daten: ArrayBuffer): string {
    const bytes = new Uint8Array(daten);
    let roh = "";
    const stueck = 0x8000;
    for (let i = 0; i < bytes.length; i += stueck) roh += String.fromCharCode(...bytes.subarray(i, i + stueck));
    return btoa(roh);
}

/** pdfmake samt Schrift, einmal geladen. Scheitert es, versucht der nächste Aufruf es noch einmal. */
export function ladePdfWerkzeug(): Promise<PdfWerkzeug> {
    laedt ??= (async (): Promise<PdfWerkzeug> => {
        const [modul, antwort] = await Promise.all([import("pdfmake/build/pdfmake"), fetch(schriftAdresse)]);
        if (!antwort.ok) throw new Error(`Schrift nicht geladen (${String(antwort.status)})`);
        const ttf = await antwort.arrayBuffer();
        // Der Bündler reicht das UMD-Modul als `default` oder als Namensraum herein.
        const roh = modul as unknown as { default?: Pdfmake } & Partial<Pdfmake>;
        const pdfmake = (roh.default ?? roh) as Pdfmake;
        pdfmake.setUrlAccessPolicy(() => false);
        pdfmake.addVirtualFileSystem({ [SCHRIFT_DATEI]: base64(ttf) });
        pdfmake.addFonts({
            [PDF_SCHRIFT]: {
                normal: SCHRIFT_DATEI,
                bold: SCHRIFT_DATEI,
                italics: SCHRIFT_DATEI,
                bolditalics: SCHRIFT_DATEI,
            },
        });
        return { pdfmake, saeubern: saeuberer(abdeckung(ttf)) };
    })();
    laedt.catch(() => {
        laedt = undefined;
    });
    return laedt;
}

export async function erzeugePdf(werkzeug: PdfWerkzeug, dokument: PdfDokument): Promise<Blob> {
    return werkzeug.pdfmake.createPdf(dokument).getBlob();
}

/** Speichert das PDF als Download unter seinem Namen (am Telefon wie am Rechner derselbe Weg). */
export function speicherePdf(pdf: Blob, name: string): void {
    const url = URL.createObjectURL(pdf);
    const verweis = document.createElement("a");
    verweis.href = url;
    verweis.download = name;
    verweis.rel = "noopener";
    document.body.append(verweis);
    verweis.click();
    verweis.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Wie viele Seiten ein PDF von pdfmake hat: pdfkit schreibt jede Seite als eigenes Objekt `/Type /Page`, unkomprimiert. */
export async function seitenZahl(pdf: Blob): Promise<number> {
    const text = await pdf.text();
    return Math.max(1, (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length);
}
