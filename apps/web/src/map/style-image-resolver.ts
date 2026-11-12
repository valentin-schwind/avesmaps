import type { Map as MapLibreMap } from "maplibre-gl";

/** Was ein Auflöser von der Karte braucht: nachsehen, ob ein Bild da ist, und eines anlegen. Die echte Karte erfüllt es, ein Test mit einer Fälschung auch. */
export interface ImageSink {
    hasImage(id: string): boolean;
    addImage(
        id: string,
        image: { width: number; height: number; data: Uint8Array },
        options: { pixelRatio: number },
    ): unknown;
}

/**
 * Wer die Bilder anlegt, die der Stil nur beim Namen nennt.
 *
 * MapLibre hat EINEN Auflöser für fehlende Bilder (`setMissingStyleImageResolver`); ein zweiter Aufruf ersetzt den ersten.
 * Zwei Arten von Bildern entstehen zur Laufzeit: das Muster der Schraffur umstrittener Gebiete (`claim-…`, gebaut aus den
 * Farben im Namen) und das Wappen am Gebietsnamen (`coat:<sha256>`, geladen und kleingerechnet). Jede Art meldet sich hier mit
 * ihrem Präfix an, und diese Datei ist die EINE Stelle, die den Auflöser an der Karte setzt - eine zweite Stelle, die ihn setzte,
 * nähme der ersten still ihr Bild weg, und die Karte sähe fast richtig aus.
 *
 * 💣 Der Auflöser, nicht das Ereignis `styleimagemissing`: Seit MapLibre 6 feuert das Ereignis erst NACH dem Fehlschlag (die
 * Kachel ist dann schon ohne Bild gebaut), der Auflöser läuft davor und wird abgewartet.
 */
export interface StyleImageResolver {
    /** Der Anfang der Bildnamen, für die diese Art zuständig ist (`claim-`, `coat:`). */
    readonly prefix: string;
    /** Legt das Bild an (`map.addImage`); darf warten. Ein Name, den sie nicht lesen kann, bleibt unbeantwortet. */
    resolve(id: string): void | Promise<void>;
}

/** Der Auflöser der Karte: reicht einen fehlenden Bildnamen an die Art weiter, die sein Präfix führt. */
export function dispatchMissingImage(resolvers: readonly StyleImageResolver[]): (id: string) => void | Promise<void> {
    return (id) => resolvers.find((resolver) => id.startsWith(resolver.prefix))?.resolve(id);
}

/** Setzt den Auflöser und gibt zurück, was ihn wieder abnimmt. */
export function installStyleImageResolvers(map: MapLibreMap, resolvers: readonly StyleImageResolver[]): () => void {
    map.setMissingStyleImageResolver(dispatchMissingImage(resolvers));
    return () => {
        map.setMissingStyleImageResolver(null);
    };
}
