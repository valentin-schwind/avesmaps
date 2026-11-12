/** Das Erkennungsmerkmal eines PDF im Dateikopf (Magic Bytes `%PDF-`), nie die Endung. Ohne Abhängigkeit, damit `inspect.ts` keine Bibliothek lädt. */
export function isPdf(bytes: Uint8Array): boolean {
    const magic = [0x25, 0x50, 0x44, 0x46, 0x2d];
    return bytes.length >= magic.length && magic.every((value, index) => bytes[index] === value);
}
