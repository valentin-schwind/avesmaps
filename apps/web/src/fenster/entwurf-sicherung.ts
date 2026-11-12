/**
 * Der Entwurf im Browser gesichert (O3; EDIT-0003 R1, EDIT-0001 D19): Was ungeschrieben ist, überlebt das Neuladen und steht danach
 * unter „Offene Bearbeitungen“. Je Objekt EIN Eintrag `avesmaps3d.entwurf.<art>.<id>`: der gelesene Stand, auf dem der Entwurf beruht
 * (für den Konflikt beim Wiederherstellen), Start und letzter Stand, Titel und Zeit. Die 20 Schritte reisen nicht mit; nach dem
 * Neuladen ist der Entwurf EIN Schritt.
 *
 * Nur Bequemlichkeit des einen Browsers, nie geteilter Zustand: Jeder Zugriff steht in `try/catch` (privates Fenster, voller oder
 * gesperrter Speicher); ohne Speicher geht das Bearbeiten weiter, nur ohne Sicherung.
 */

const PRAEFIX = "avesmaps3d.entwurf.";

export const sicherungsSchluessel = (art: string, id: string): string => `${PRAEFIX}${art}.${id}`;

export interface Gesichert {
    readonly art: string;
    readonly id: string;
    readonly titel: string;
    /** Wann zuletzt gesichert (ISO). */
    readonly zeit: string;
    /** Die Fassung der Art (`BearbeitungsArt.sicherung.version`): Eine andere wird nicht wiederhergestellt. */
    readonly version: number;
    readonly basis: unknown;
    readonly start: unknown;
    readonly jetzt: unknown;
}

export function sichere(speicher: Storage | undefined, eintrag: Gesichert): void {
    try {
        speicher?.setItem(sicherungsSchluessel(eintrag.art, eintrag.id), JSON.stringify(eintrag));
    } catch {
        // Ohne Speicher (voll, gesperrt) bleibt der Entwurf nur bis zum Neuladen.
    }
}

export function lies(speicher: Storage | undefined, art: string, id: string): Gesichert | undefined {
    try {
        const text = speicher?.getItem(sicherungsSchluessel(art, id));
        if (text === null || text === undefined) return undefined;
        const wert = JSON.parse(text) as Partial<Gesichert>;
        return typeof wert.version === "number" && wert.art === art && wert.id === id ? (wert as Gesichert) : undefined;
    } catch {
        return undefined;
    }
}

export function vergiss(speicher: Storage | undefined, art: string, id: string): void {
    try {
        speicher?.removeItem(sicherungsSchluessel(art, id));
    } catch {
        // Nichts zu tun: Ohne Speicher gab es keine Sicherung.
    }
}

/** Alle gesicherten Entwürfe (für „Offene Bearbeitungen“ nach dem Neuladen), jüngste zuerst; nur Kopf, ohne Stände. */
export function gesicherte(
    speicher: Storage | undefined,
): { readonly art: string; readonly id: string; readonly titel: string; readonly zeit: string }[] {
    const raus: { art: string; id: string; titel: string; zeit: string }[] = [];
    try {
        if (speicher === undefined) return raus;
        for (let i = 0; i < speicher.length; i += 1) {
            const schluessel = speicher.key(i);
            if (schluessel === null || !schluessel.startsWith(PRAEFIX)) continue;
            const rest = schluessel.slice(PRAEFIX.length);
            const punkt = rest.indexOf(".");
            if (punkt < 0) continue;
            const eintrag = lies(speicher, rest.slice(0, punkt), rest.slice(punkt + 1));
            if (eintrag !== undefined)
                raus.push({ art: eintrag.art, id: eintrag.id, titel: eintrag.titel, zeit: eintrag.zeit });
        }
    } catch {
        return raus;
    }
    return raus.sort((a, b) => b.zeit.localeCompare(a.zeit));
}

/** Der Speicher des Browsers für die Sicherung; schon der Zugriff kann werfen (gesperrte Website-Daten), dann keiner. */
export function entwurfsSpeicher(): Storage | undefined {
    try {
        return globalThis.localStorage ?? undefined;
    } catch {
        return undefined;
    }
}
