import { ref, watch, type Ref } from "vue";

/**
 * Die Sprachen für die Legende der Ebene „Sprachen“ (WI-0261 S5a): Reihenfolge, Name der Legende und Farbe aus
 * `GET /api/sprachen` (öffentlich, `no-cache` mit ETag: Ein unveränderter Stand kommt als 304 aus dem Cache des Browsers).
 *
 * Geladen wird erst, wenn die Ebene zum ersten Mal gezeigt wird, und wieder, wenn die Kacheln der Sprachen eine neue Revision
 * bekommen (`neuLaden`, gehört an `editRevision.hoere`): Eine neue Farbe steht dann in Karte und Legende zugleich.
 *
 * Die Form der Antwort steht serverseitig (`apps/server/src/sprachen/schema.ts`); hier wird nur gelesen, was die Legende braucht,
 * und jede Zeile geprüft. Eine kaputte Zeile fällt weg, statt die Legende zu leeren.
 */

export interface SprachLegendenZeile {
    /** `sprache.public_id`: Ein Klick auf die Zeile öffnet die Infobox dieser Sprache (WI-0261 S5b). */
    id: string;
    schluessel: string;
    /** Der Name der Legende (`legende`), sonst der Name der Sprache. */
    name: string;
    /** `#rrggbb`. */
    farbe: string;
}

const FARBE = /^#[0-9a-f]{6}$/u;

/** Die Zeilen der Legende aus der Antwort, in ihrer Reihenfolge; Unlesbares fällt weg. */
export function legendenZeilen(antwort: unknown): SprachLegendenZeile[] {
    const sprachen = (antwort as { sprachen?: unknown } | null)?.sprachen;
    if (!Array.isArray(sprachen)) return [];
    return sprachen.flatMap((roh: unknown): SprachLegendenZeile[] => {
        const eintrag = roh as Record<string, unknown> | null;
        const id = eintrag?.["id"];
        const schluessel = eintrag?.["schluessel"];
        const name = eintrag?.["legende"] ?? eintrag?.["name"];
        const farbe = eintrag?.["farbe"];
        if (typeof id !== "string" || id === "") return [];
        if (typeof schluessel !== "string" || typeof name !== "string" || name.trim() === "") return [];
        if (typeof farbe !== "string" || !FARBE.test(farbe)) return [];
        return [{ id, schluessel, name, farbe }];
    });
}

export interface SprachenStand {
    zeilen: Readonly<Ref<readonly SprachLegendenZeile[]>>;
    /** Nach einer neuen Revision der Sprachkacheln: gleich neu, wenn die Ebene gezeigt wird, sonst beim nächsten Zeigen. */
    neuLaden(): void;
}

export function useSprachenStand(gezeigt: () => boolean, holen: typeof fetch = globalThis.fetch): SprachenStand {
    const zeilen = ref<readonly SprachLegendenZeile[]>([]);
    let veraltet = true;
    let laufend = 0;

    const lade = async (): Promise<void> => {
        veraltet = false;
        const nummer = ++laufend;
        try {
            const antwort = await holen("/api/sprachen", { cache: "no-cache" });
            if (!antwort.ok) throw new Error(`HTTP ${String(antwort.status)}`);
            const neu = legendenZeilen(await antwort.json());
            if (nummer === laufend) zeilen.value = neu;
        } catch {
            // Ohne Antwort bleibt die Legende, wie sie war (oder leer und damit unsichtbar); das nächste Zeigen fragt neu.
            if (nummer === laufend) veraltet = true;
        }
    };

    watch(
        gezeigt,
        (jetzt) => {
            if (jetzt && veraltet) void lade();
        },
        { immediate: true },
    );

    return {
        zeilen,
        neuLaden() {
            veraltet = true;
            if (gezeigt()) void lade();
        },
    };
}
