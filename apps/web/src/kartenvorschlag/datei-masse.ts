/**
 * Die Maße eines Bildes im Browser lesen, bevor es hochgeladen wird (WI-0291): Der Server lehnt ein Bild über 16 Megapixel oder mit einer Kante über 8192 Pixeln erst nach dem Hochladen von
 * bis zu 50 MB ab. Hier steht nur das Lesen; ob die Maße passen, entscheidet `masseProbe` in `modell.ts`.
 *
 * - `createImageBitmap` zuerst (dekodiert abseits des Hauptfadens, kein DOM nötig), sonst ein `Image` über eine Blob-Adresse.
 * - **Kann das Bild nicht gelesen werden, ist das kein Befund:** `undefined`, der Server entscheidet (ein Browser ohne Dekoder für ein Format ist kein kaputtes Bild).
 */
export async function leseBildMasse(datei: Blob): Promise<{ breite: number; hoehe: number } | undefined> {
    try {
        if (typeof createImageBitmap === "function") {
            const bild = await createImageBitmap(datei);
            const masse = { breite: bild.width, hoehe: bild.height };
            bild.close();
            return masse;
        }
        if (typeof Image === "undefined" || typeof URL.createObjectURL !== "function") return undefined;
        const adresse = URL.createObjectURL(datei);
        try {
            return await new Promise((fertig) => {
                const bild = new Image();
                bild.onload = () => fertig({ breite: bild.naturalWidth, hoehe: bild.naturalHeight });
                bild.onerror = () => fertig(undefined);
                bild.src = adresse;
            });
        } finally {
            URL.revokeObjectURL(adresse);
        }
    } catch {
        return undefined;
    }
}
