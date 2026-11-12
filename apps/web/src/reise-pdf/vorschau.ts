import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

/**
 * Die Vorschau zeigt das echte PDF (WI-0306, Entwurf: „Vorschau = das echte PDF“): pdf.js (Apache-2.0) zeichnet seine Seiten auf Leinwände,
 * die große Seite und die Daumen. 🔴 Erst beim Öffnen des Fensters geladen, samt Worker; nichts davon liegt im Start-JS. Der Worker kommt wie der
 * von MapLibre über `?worker&url`: eigenständig gebündelt als `.js` (eine `.mjs`-Datei unter `/assets/` brauchte ihren eigenen MIME-Typ).
 */

type Pdfjs = typeof import("pdfjs-dist");
let laedt: Promise<Pdfjs> | undefined;

function ladePdfjs(): Promise<Pdfjs> {
    laedt ??= Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?worker&url")]).then(
        ([pdfjs, worker]) => {
            pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
            return pdfjs;
        },
    );
    laedt.catch(() => {
        laedt = undefined;
    });
    return laedt;
}

/**
 * Öffnet ein PDF für die Vorschau; die Daten werden kopiert (pdf.js übergibt sie an den Worker).
 *
 * 🔴 Härtung gegen CVE-2024-4367 (Schadcode über eine Schriftmatrix, behoben in pdf.js 4.2.67): Die Fassung ist 6.5.438 (`package.json`, dieselbe wie im Server),
 * und `isEvalSupported: false` steht trotzdem da. pdf.js 5 und 6 kennen die Option nicht mehr, weil es gar kein `eval`/`new Function` mehr hat
 * (`reise-pdf-vorschau-haertung.test.ts` prüft beides am Paket); sie kostet nichts und wirkt wieder, falls jemand auf 4.x zurückgeht. Darum
 * steht sie in einer eigenen Variablen: Als Literal wiese der Typ sie als unbekannt ab.
 */
export async function oeffnePdf(pdf: Blob): Promise<PDFDocumentProxy> {
    const pdfjs = await ladePdfjs();
    const daten = new Uint8Array(await pdf.arrayBuffer());
    const optionen = { data: daten, isEvalSupported: false };
    return pdfjs.getDocument(optionen).promise;
}

/**
 * Zeichnet eine Seite (ab 1) in `leinwand`, so groß, dass sie in `breite` × `hoehe` CSS-Pixel passt, scharf in der Dichte des Bildschirms.
 * Gibt die Aufgabe zurück, damit eine neue Vorschau die alte abbrechen kann.
 */
export async function zeichneSeite(
    pdf: PDFDocumentProxy,
    nummer: number,
    leinwand: HTMLCanvasElement,
    breite: number,
    hoehe: number,
): Promise<RenderTask | undefined> {
    const seite = await pdf.getPage(nummer);
    const roh = seite.getViewport({ scale: 1 });
    const mass = Math.min(breite / roh.width, hoehe / roh.height);
    if (!(mass > 0)) return undefined;
    const dichte = globalThis.devicePixelRatio || 1;
    const ansicht = seite.getViewport({ scale: mass * dichte });
    leinwand.width = Math.round(ansicht.width);
    leinwand.height = Math.round(ansicht.height);
    leinwand.style.width = `${String(Math.round(ansicht.width / dichte))}px`;
    leinwand.style.height = `${String(Math.round(ansicht.height / dichte))}px`;
    return seite.render({ canvas: leinwand, viewport: ansicht });
}
