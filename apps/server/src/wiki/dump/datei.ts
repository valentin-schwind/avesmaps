import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { DumpFehler } from "./xml.ts";

/**
 * Welche Datei im Dump-Ordner (`WIKI_DUMP_ROOT`) gemeint ist (WI-0253 B-1). Der Auftrag nennt höchstens einen Dateinamen, nie einen Pfad;
 * ohne Namen gilt die jüngste Datei `*.xml` oder `*.xml.bz2` des Ordners.
 */

const ENDUNG = /\.xml(\.bz2)?$/iu;

/** Ein reiner Dateiname: kein Pfad, kein Aufstieg, nur Dumpendungen. */
export function istDumpDateiname(name: string): boolean {
    const trenner = name.includes("/") || name.includes("\\") || name.includes("\0");
    return name !== "" && name === name.trim() && !trenner && !name.startsWith(".") && ENDUNG.test(name);
}

export async function waehleDump(wurzel: string | undefined, datei: string | undefined): Promise<string> {
    if (wurzel === undefined) {
        throw new DumpFehler("dump_root_fehlt", "Für den Wiki-Dump ist kein Ordner eingerichtet (WIKI_DUMP_ROOT)");
    }
    if (datei !== undefined) {
        if (!istDumpDateiname(datei)) {
            throw new DumpFehler(
                "datei_ungueltig",
                "Die Datei muss ein Dateiname mit der Endung .xml oder .xml.bz2 sein, ohne Pfad",
            );
        }
        const pfad = join(wurzel, datei);
        const eintrag = await stat(pfad).catch(() => null);
        if (eintrag === null || !eintrag.isFile())
            throw new DumpFehler("dump_fehlt", "Die genannte Dump-Datei liegt nicht im Dump-Ordner");
        return pfad;
    }
    const namen = await readdir(wurzel).catch(() => null);
    if (namen === null) throw new DumpFehler("dump_fehlt", "Der Dump-Ordner ist nicht lesbar oder fehlt");
    let juengste: { pfad: string; zeit: number } | null = null;
    for (const name of namen) {
        if (!istDumpDateiname(name)) continue;
        const pfad = join(wurzel, name);
        const eintrag = await stat(pfad).catch(() => null);
        if (eintrag === null || !eintrag.isFile()) continue;
        if (juengste === null || eintrag.mtimeMs > juengste.zeit) juengste = { pfad, zeit: eintrag.mtimeMs };
    }
    if (juengste === null) throw new DumpFehler("dump_fehlt", "Im Dump-Ordner liegt kein Dump (.xml oder .xml.bz2)");
    return juengste.pfad;
}
