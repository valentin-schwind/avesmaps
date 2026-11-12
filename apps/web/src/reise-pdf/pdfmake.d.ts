/**
 * Was „Reise als PDF“ von pdfmake 0.3 nutzt (WI-0306); das Paket bringt keine Typen mit. Die Beschreibung des Dokuments selbst steht in
 * `pdf-knoten.ts`.
 */
declare module "pdfmake/build/pdfmake" {
    interface PdfmakeAusgabe {
        getBlob(): Promise<Blob>;
    }
    interface PdfmakeSchnitte {
        normal: string;
        bold: string;
        italics: string;
        bolditalics: string;
    }
    export interface Pdfmake {
        addVirtualFileSystem(vfs: Record<string, string>): void;
        addFonts(fonts: Record<string, PdfmakeSchnitte>): void;
        setUrlAccessPolicy(erlaubt: (url: string) => boolean): void;
        createPdf(dokument: unknown): PdfmakeAusgabe;
    }
    const pdfmake: Pdfmake;
    export default pdfmake;
}
