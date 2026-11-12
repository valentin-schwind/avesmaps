import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import {
    ABZUG_AUFBEWAHRUNG_STUNDEN,
    ABZUG_DATEI_TAR,
    ABZUG_HOECHSTENS,
    ABZUG_TAR_MANIFEST,
    AbzugManifest,
    istAbzugKennung,
    type AbzugDatei,
    type AbzugQuelle,
} from "@avesmaps3d/shared";
import { listeTar, tarText } from "./tar.ts";

/**
 * Die Ablage der Abzüge auf Stage und Production (WI-0251): `<ABZUG_ROOT>/<umgebung>/<kennung>/abzug.tar`. Claudios Korridor schreibt sie (erst
 * `abzug.tar.part`, dann ein atomares Umbenennen), höchstens zwei je Umgebung, und löscht sie nach 24 Stunden. Die App liest nur: Sie zählt, was
 * da ist, und liefert aus. Eine Datei im Verzeichnis, die kein gültiger Abzug ist, zählt nicht und wird nie angeboten.
 *
 * Das Manifest steht als erste Datei im Tar; die App liest es dort und braucht keine zweite Datei daneben.
 */
export interface AblageAbzug extends AbzugDatei {
    readonly tarPfad: string;
}

/** Das Verzeichnis einer Umgebung in der Ablage. */
export function umgebungsOrdner(wurzel: string, quelle: AbzugQuelle): string {
    return join(wurzel, quelle);
}

/** Der Pfad zur Tar-Datei einer Kennung; `null` bei einer Kennung, die kein Ordnername sein darf (nie Pfade aus Eingaben bauen). */
export function abzugPfad(wurzel: string, quelle: AbzugQuelle, kennung: string): string | null {
    if (!istAbzugKennung(kennung)) return null;
    return join(umgebungsOrdner(wurzel, quelle), kennung, ABZUG_DATEI_TAR);
}

async function liesEintrag(
    wurzel: string,
    quelle: AbzugQuelle,
    kennung: string,
    jetzt: number,
): Promise<AblageAbzug | null> {
    const pfad = abzugPfad(wurzel, quelle, kennung);
    if (pfad === null) return null;
    try {
        const info = await stat(pfad);
        if (!info.isFile()) return null;
        const eintraege = await listeTar(pfad);
        const kopf = eintraege[0];
        if (kopf === undefined || kopf.name !== ABZUG_TAR_MANIFEST) return null;
        const roh: unknown = JSON.parse(await tarText(pfad, kopf));
        if (!Value.Check(AbzugManifest, roh) || roh.kennung !== kennung || roh.quelle !== quelle) return null;
        const erstellt = new Date(roh.erstellt);
        const stand = Number.isNaN(erstellt.getTime()) ? info.mtime : erstellt;
        const laeuftAb = new Date(stand.getTime() + ABZUG_AUFBEWAHRUNG_STUNDEN * 3_600_000);
        if (laeuftAb.getTime() <= jetzt) return null;
        return {
            kennung,
            erstellt: stand.toISOString(),
            bytes: info.size,
            tafeln: roh.tafeln.length,
            zeilen: roh.tafeln.reduce((summe, tafel) => summe + tafel.zeilen, 0),
            medien: roh.medien.length,
            medienBytes: roh.medien.reduce((summe, medium) => summe + medium.groesse, 0),
            laeuftAb: laeuftAb.toISOString(),
            tarPfad: pfad,
        };
    } catch {
        // Halb geschrieben, kaputt oder gerade gelöscht: Es gibt ihn nicht.
        return null;
    }
}

/** Die fertigen, noch nicht abgelaufenen Abzüge einer Umgebung, neueste zuerst; höchstens so viele, wie die Ablage hält. */
export async function listeAbzuege(
    wurzel: string,
    quelle: AbzugQuelle,
    jetzt: number = Date.now(),
): Promise<AblageAbzug[]> {
    let namen: string[];
    try {
        namen = await readdir(umgebungsOrdner(wurzel, quelle));
    } catch {
        return [];
    }
    const alle = (await Promise.all(namen.map((name) => liesEintrag(wurzel, quelle, name, jetzt)))).filter(
        (eintrag): eintrag is AblageAbzug => eintrag !== null,
    );
    return alle.sort((a, b) => b.erstellt.localeCompare(a.erstellt)).slice(0, ABZUG_HOECHSTENS);
}

/** Ein Abzug nach Kennung, oder `null`, wenn es ihn nicht (mehr) gibt. */
export async function findeAbzug(
    wurzel: string,
    quelle: AbzugQuelle,
    kennung: string,
    jetzt: number = Date.now(),
): Promise<AblageAbzug | null> {
    return await liesEintrag(wurzel, quelle, kennung, jetzt);
}

/** Der Dateiname beim Herunterladen: sagt, woher der Abzug kommt und welcher es ist. */
export function dateinameFuer(quelle: AbzugQuelle, kennung: string): string {
    return `avesmaps-abzug-${quelle}-${kennung}.tar`;
}

export function istOrdnerFuerQuelle(wert: string): wert is AbzugQuelle {
    return wert === "staging" || wert === "production";
}
