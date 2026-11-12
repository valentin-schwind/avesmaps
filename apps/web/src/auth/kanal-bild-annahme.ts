/**
 * Woher ein Bild im Kanal kommen darf (Kanal OPS-000013, Thomas 2026-10-15: „Im Vorgang melden Tab sollte es möglich sein, die
 * Bilder per Drag-n-Drop oder durch STRG-V einzufügen und nicht nur über den Dateimanager“).
 *
 * Drei Wege, ein Ziel: Der Knopf mit der Dateiwahl, das Ablegen auf der Fläche und das Einfügen aus der Zwischenablage reichen
 * dieselben `File` weiter; verkleinert, neu kodiert und hochgeladen wird danach wie bisher (`kanal-bild.ts`).
 *
 * 🔴 Die Auswahl der Typen steht hier und nicht in drei Bauteilen: Das `accept` der Dateiwahl filtert nur den Dialog — was jemand
 * ablegt oder einfügt, kommt ungefiltert an. Ein Screenshot aus der Zwischenablage ist PNG, ein gezogenes Bild aus dem Browser
 * kann alles sein.
 */

/** Die Rasterbilder, die der Kanal annimmt — dieselben wie im `accept` der Dateiwahl und in der Prüfung des Servers. */
export const KANAL_BILD_TYPEN = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

const istBild = (datei: File): boolean => (KANAL_BILD_TYPEN as readonly string[]).includes(datei.type);

/**
 * Die Bilder aus einer Auswahl, höchstens so viele, wie noch Platz ist.
 *
 * 🪤 `platz` ist der verbleibende Platz, nicht die Obergrenze: Wer schon zwei von drei Bildern hat, darf noch eines ablegen.
 * Ohne Platz kommt nichts an — und eine eingefügte Textstelle bleibt Text, weil sie gar keine Datei mitbringt.
 */
export function bilderAus(dateien: Iterable<File> | null | undefined, platz: number): File[] {
    if (dateien === null || dateien === undefined || platz <= 0) return [];
    return [...dateien].filter((datei) => istBild(datei)).slice(0, platz);
}

/**
 * Zieht jemand Dateien über die Fläche? Nur dafür leuchtet der Hinweis.
 *
 * 🪤 Während des Ziehens sind `dataTransfer.files` noch leer — der Browser gibt die Dateien erst beim Ablegen frei. Was es
 * schon gibt, ist `types`; „Files“ darin heißt: Da kommt eine Datei. Gefiltert wird dann beim Ablegen.
 */
export function ziehtDateien(uebertrag: Pick<DataTransfer, "types"> | null | undefined): boolean {
    return [...(uebertrag?.types ?? [])].includes("Files");
}
