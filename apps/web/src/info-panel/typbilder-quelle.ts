import { shallowRef } from "vue";
import { MEDIA_TYPE_IMAGES_PUBLIC_URL, isHeaderGraphic, type HeaderGraphic } from "@avesmaps3d/shared";
import { headerGraphicUrl } from "./header-graphic";
import { nennungZeile } from "./panel-header";

/**
 * Die Typbilder für Besucher (WI-0068, Betreiber 2026-10-11; Route `GET /api/media/type-images`, `resolveTypeImages`): Je Kategorie
 * die Adresse des Bildes, das die redaktionelle Wahl (★) und die EINE Freigaberegel erlauben. Fehlt eine Kategorie, gilt die
 * eingebaute Grafik des Releases — bis zum Cutoff bleibt sie der Rückfall.
 *
 * - **Eine Antwort für alle, einmal je Seitenaufruf.** Die Karte ist klein (höchstens so viele Einträge wie Kategorien) und für jedes Objekt dieselbe;
 *   ein zweiter Aufruf wartet auf denselben Lauf, statt erneut zu fragen.
 * - 🔴 **Kein Flackern und kein Leerstand:** Solange die Karte nicht da ist, steht die eingebaute Grafik. Sie ist nie leer, also
 *   gibt es keinen Zustand ohne Bild; kommt die Karte später, tauscht der Browser nur die Quelle.
 * - 🔴 **Die Beschriftung bleibt „Typbild“** (Betreiber 2026-10-11, „3 A ja das gilt für alle“): Hier wechselt nur die DATEI der
 *   Grafik der Art, nicht ihre Bedeutung. Was eine Ortsansicht ist, entscheidet allein das Feld des Servers am gelieferten Bild
 *   (`bildbezug.ts`) — niemals diese Karte.
 * - Ein Fehler ist stumm: Ohne Netz, ohne Datenbank (503) oder bei einer unerwarteten Antwort bleibt es bei den eingebauten
 *   Grafiken. Ein Infopanel darf nicht an einer Kopfgrafik scheitern.
 *
 * **Zwei Varianten** (WI-0281, Betreiber 2026-11-05): Die Antwort trägt `images` (Normalmodus: KI-Variante, sonst Ohne-KI-Variante) und `ohneKi` (nur die
 * Ohne-KI-Variante). `artgrafikVon` wählt nach dem Modus „Ohne KI“ (`reisebilder.ohneKi`):
 * - Normalmodus: `images`, sonst die eingebaute Grafik, wie bisher.
 * - 🔴 „Ohne KI“: nur `ohneKi`. Fehlt die Kategorie, steht der neutrale Platzhalter, nie die KI-Variante und nie die eingebaute Grafik (die eingebauten
 *   Grafiken sind KI-erzeugt, Betreiber 2026-10-12). Solange die Karte lädt, steht nur der Platzhaltergrund (`laedt`), damit kein KI-Bild aufblitzt; scheitert
 *   das Laden oder fehlt das Feld (Server der Vorversion), gilt überall der Platzhalter.
 */

export interface Typbild {
    url: string;
    width: number;
    height: number;
    /** Die Nennung als eine Zeile, nur wo die Rechte sie verlangen (ein Foto unter CC BY, WI-0281). */
    credit?: string;
}

/** Was der Kopf an der Stelle der Grafik der Art zeigt: ein Bild, den neutralen Platzhalter (nur „Ohne KI“) oder, solange die Karte lädt, nur den Grund. */
export type Artgrafik = { art: "bild"; bild: Typbild } | { art: "platzhalter" } | { art: "laedt" };

/** Die Maße der eingebauten Grafiken (16:9, wie `info-header.vue` sie bisher fest schrieb). */
export const EINGEBAUTE_MASSE = { width: 800, height: 450 } as const;

/** Die geladene Karte des Normalmodus; `undefined`, solange noch nichts da ist (dann gilt überall die eingebaute Grafik). */
const karte = shallowRef<ReadonlyMap<HeaderGraphic, Typbild> | undefined>(undefined);
/** Die geladene Karte des Modus „Ohne KI“; `undefined`, solange noch nichts da ist. Nach einem Fehlschlag leer: dann überall der Platzhalter. */
const ohneKiKarte = shallowRef<ReadonlyMap<HeaderGraphic, Typbild> | undefined>(undefined);
let lauf: Promise<void> | undefined;

/**
 * Lädt die Karte einmal. Mehrfache Aufrufe warten auf denselben Lauf; nach einem Fehlschlag bleibt sie leer und wird nicht in einer
 * Schleife erneut gefragt (ein neuer Seitenaufruf fragt wieder).
 */
export function ladeTypbilder(holen: typeof fetch = fetch): Promise<void> {
    lauf ??= (async () => {
        try {
            const antwort = await holen(MEDIA_TYPE_IMAGES_PUBLIC_URL, { headers: { accept: "application/json" } });
            if (!antwort.ok) return;
            const körper = (await antwort.json()) as { images?: unknown; ohneKi?: unknown } | null;
            karte.value = kartenAus(körper?.images);
            ohneKiKarte.value = kartenAus(körper?.ohneKi);
        } catch {
            // Stumm: die eingebauten Grafiken stehen weiter.
        } finally {
            // Ohne Karte kennt „Ohne KI“ kein Bild: der Platzhalter, nie die eingebaute Grafik.
            ohneKiKarte.value ??= new Map();
        }
    })();
    return lauf;
}

/** Nur Einträge, deren Kategorie der Vertrag kennt und deren Maße brauchbar sind; alles andere fällt weg. */
function kartenAus(bilder: unknown): ReadonlyMap<HeaderGraphic, Typbild> {
    const raus = new Map<HeaderGraphic, Typbild>();
    if (typeof bilder !== "object" || bilder === null) return raus;
    for (const [kategorie, wert] of Object.entries(bilder as Record<string, unknown>)) {
        if (!isHeaderGraphic(kategorie)) continue;
        const bild = wert as { url?: unknown; width?: unknown; height?: unknown; credit?: unknown } | null;
        if (
            typeof bild?.url !== "string" ||
            bild.url === "" ||
            typeof bild.width !== "number" ||
            typeof bild.height !== "number" ||
            bild.width <= 0 ||
            bild.height <= 0
        ) {
            continue;
        }
        const credit =
            typeof bild.credit === "object" && bild.credit !== null
                ? nennungZeile(bild.credit as Parameters<typeof nennungZeile>[0])
                : undefined;
        raus.set(kategorie, {
            url: bild.url,
            width: bild.width,
            height: bild.height,
            ...(credit === undefined ? {} : { credit }),
        });
    }
    return raus;
}

/**
 * Das Bild der Grafik einer Art im Normalmodus: das freigegebene Typbild, sonst die eingebaute Datei. Reine Funktion über die geladene Karte, damit
 * Vitest sie ohne Browser prüft.
 */
export function typbildVon(graphic: HeaderGraphic): Typbild {
    return (
        karte.value?.get(graphic) ?? {
            url: headerGraphicUrl(graphic),
            ...EINGEBAUTE_MASSE,
        }
    );
}

/**
 * Was an der Stelle der Grafik einer Art steht, je nach Modus (WI-0281). Liest beide Karten und den Modus reaktiv: Wer es in einem `computed` fragt, folgt dem
 * Umschalten sofort, auch in einem schon offenen Infopanel.
 */
export function artgrafikVon(graphic: HeaderGraphic, ohneKi: boolean): Artgrafik {
    if (!ohneKi) return { art: "bild", bild: typbildVon(graphic) };
    const geladen = ohneKiKarte.value;
    if (geladen === undefined) return { art: "laedt" };
    const bild = geladen.get(graphic);
    return bild === undefined ? { art: "platzhalter" } : { art: "bild", bild };
}

/** Steht für diese Kategorie ein redaktionelles Typbild (statt der eingebauten Grafik)? Nur für Tests und Kennungen. */
export function istEigenesTypbild(graphic: HeaderGraphic): boolean {
    return karte.value?.has(graphic) === true;
}

/** Nur für Tests: den geladenen Stand setzen oder leeren; `ohneKi` ist die Karte des Modus „Ohne KI“ (ohne Angabe leer, sobald `eintraege` gesetzt ist). */
export function setzeTypbilderFuerTest(
    eintraege: ReadonlyMap<HeaderGraphic, Typbild> | undefined,
    ohneKi?: ReadonlyMap<HeaderGraphic, Typbild>,
): void {
    karte.value = eintraege;
    ohneKiKarte.value = eintraege === undefined && ohneKi === undefined ? undefined : (ohneKi ?? new Map());
    lauf = eintraege === undefined && ohneKi === undefined ? undefined : Promise.resolve();
}
