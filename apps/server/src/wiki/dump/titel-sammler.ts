import { leseDump } from "./leser.ts";
import type { DumpKopf } from "./xml.ts";

/**
 * Ein Durchgang über den Dump für den Abgleich (WI-0253 B-1): zählt die Seiten je Namensraum und merkt sich von den GESUCHTEN Titeln,
 * in welchem Namensraum sie stehen und ob sie eine Weiterleitung sind. Mehr bleibt nicht im Speicher: nie das Verzeichnis aller 253.000
 * Titel, nie ein Text.
 *
 * Verglichen wird der Titel wörtlich, wie der Dump ihn führt (mit Leerzeichen und Namensraum-Präfix). Hier wird kein Key gerechnet
 * (Vertrag `wiki-link-targets.yaml`: Avesmaps3D rechnet nie einen Key).
 */

export interface GefundeneSeite {
    ns: number;
    /** Das Ziel, wenn die Seite eine Weiterleitung ist. */
    weiterleitung: string | null;
}

export interface TitelErgebnis {
    seiten: number;
    vollstaendig: boolean;
    kopf: DumpKopf | null;
    /** Die jüngste Revision im Dump (ISO-Zeit), für den Stand. */
    neuesteRevision: string | null;
    gefunden: ReadonlyMap<string, GefundeneSeite>;
    /** Seiten je Namensraum (alle, auch die unbekannten). */
    namensraeume: ReadonlyMap<number, number>;
}

export async function sammleTitel(
    pfad: string,
    gesucht: ReadonlySet<string>,
    optionen: { bzip2?: string | undefined; beiFortschritt?: ((seiten: number) => void) | undefined } = {},
): Promise<TitelErgebnis> {
    const gefunden = new Map<string, GefundeneSeite>();
    const namensraeume = new Map<number, number>();
    let kopf: DumpKopf | null = null;
    let vollstaendig = false;
    let seiten = 0;
    let neueste: string | null = null;
    for await (const teil of leseDump(pfad, { mitText: false, bzip2: optionen.bzip2 })) {
        if (teil.art === "kopf") {
            kopf = teil.kopf;
        } else if (teil.art === "ende") {
            vollstaendig = teil.vollstaendig;
        } else {
            const { seite } = teil;
            seiten += 1;
            namensraeume.set(seite.ns, (namensraeume.get(seite.ns) ?? 0) + 1);
            const zeit = seite.revision?.zeit ?? null;
            if (zeit !== null && (neueste === null || zeit > neueste)) neueste = zeit;
            if (gesucht.has(seite.titel))
                gefunden.set(seite.titel, { ns: seite.ns, weiterleitung: seite.weiterleitung });
            if (seiten % 1000 === 0) optionen.beiFortschritt?.(seiten);
        }
    }
    return { seiten, vollstaendig, kopf, neuesteRevision: neueste, gefunden, namensraeume };
}
