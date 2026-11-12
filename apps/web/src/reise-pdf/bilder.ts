/**
 * Die Bilder des PDFs (WI-0306): Logo und Zeichen liegen als WebP unter `public/`; pdfmake liest kein WebP. Der Browser dekodiert sie, eine
 * Leinwand legt sie auf den Grund des Papiers und schreibt sie als JPEG. Einmal je Adresse und Grund; ein Bild, das nicht lädt, fehlt im PDF,
 * statt es anzuhalten.
 *
 * 🔴 **Kein PNG mit Transparenz** (Stage-Befund 2026-11-10): pdfmake entpackt ein solches PNG über fflate in einem Worker aus einer `blob:`-Adresse
 * (`decodePixels`). Die Stage und Production erlauben Worker nur von der eigenen Adresse (`worker-src 'self'`, `ops/deploy/staging-deploy.sh`); der
 * Worker wird abgelehnt, und die Erzeugung bleibt ohne Fehler stehen. Ein JPEG bettet pdfmake ungeöffnet ein. Die Zeichen stehen im PDF ohnehin
 * auf dem Papier, darum geht mit dem Grund nichts verloren.
 */

const gemerkt = new Map<string, Promise<string | undefined>>();

export function alsJpeg(adresse: string, grund: string): Promise<string | undefined> {
    const schluessel = `${grund}|${adresse}`;
    const bekannt = gemerkt.get(schluessel);
    if (bekannt !== undefined) return bekannt;
    const laden = new Promise<string | undefined>((fertig) => {
        const bild = new Image();
        bild.decoding = "async";
        bild.onload = () => {
            const leinwand = document.createElement("canvas");
            leinwand.width = bild.naturalWidth;
            leinwand.height = bild.naturalHeight;
            const ctx = leinwand.getContext("2d");
            if (ctx === null) {
                fertig(undefined);
                return;
            }
            ctx.fillStyle = grund;
            ctx.fillRect(0, 0, leinwand.width, leinwand.height);
            ctx.drawImage(bild, 0, 0);
            fertig(leinwand.toDataURL("image/jpeg", 0.92));
        };
        bild.onerror = () => {
            gemerkt.delete(schluessel);
            fertig(undefined);
        };
        bild.src = adresse;
    });
    gemerkt.set(schluessel, laden);
    return laden;
}

/** Alle Bilder einer Liste `Name → Adresse` als JPEG auf `grund`; was nicht lädt, fehlt. */
export async function ladeBilder(
    liste: Readonly<Record<string, string>>,
    grund: string,
): Promise<Record<string, string>> {
    const paare = await Promise.all(
        Object.entries(liste).map(async ([name, adresse]) => [name, await alsJpeg(adresse, grund)] as const),
    );
    return Object.fromEntries(paare.filter((paar): paar is readonly [string, string] => paar[1] !== undefined));
}
