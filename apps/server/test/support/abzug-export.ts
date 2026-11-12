import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
    ABZUG_DATEI_TAR,
    ABZUG_FORMAT,
    ABZUG_TAR_MANIFEST,
    ABZUG_VERSION,
    type AbzugManifest,
    type AbzugManifestTafel,
    type AbzugMedium,
    type AbzugPlan,
    type AbzugQuelle,
} from "@avesmaps3d/shared";
import type { Database } from "../../src/database.ts";

/**
 * Der Referenz-Export für Tests (WI-0251): macht aus einem Plan (`abzug/plan.ts`) ein Tar mit Manifest, so wie Claudios Korridor-Schritt es
 * aus dem Plan machen soll. Nur für Tests und als lesbare Fassung des Vertrags; die Anwendung exportiert nie selbst (Production zu lesen
 * hat sie keinen Weg).
 */

/**
 * Wie ein Name über 100 Zeichen ins Tar kommt: `prefix` (ustar, geteilt an einem `/`), `gnu` (Typ `L`, die Vorgabe von GNU tar) oder `pax`
 * (Typ `x`, Vorgabe von Pythons tarfile). `auto`: prefix, wenn sich der Name teilen lässt, sonst gnu.
 */
export type TarNamensform = "auto" | "prefix" | "gnu" | "pax";

function kopf(name: string, groesse: number, typ: string, praefix = ""): Buffer {
    const block = Buffer.alloc(512);
    block.write(name, 0, 100, "utf8");
    block.write("0000644\0", 100, "latin1");
    block.write("0000000\0", 108, "latin1");
    block.write("0000000\0", 116, "latin1");
    block.write(`${groesse.toString(8).padStart(11, "0")}\0`, 124, "latin1");
    block.write("00000000000\0", 136, "latin1");
    block.write("        ", 148, "latin1");
    block.write(typ, 156, "latin1");
    block.write("ustar\0", 257, "latin1");
    block.write("00", 263, "latin1");
    if (praefix !== "") block.write(praefix, 345, 155, "utf8");
    let summe = 0;
    for (const byte of block) summe += byte;
    block.write(`${summe.toString(8).padStart(6, "0")}\0 `, 148, "latin1");
    return block;
}

function auffuellen(daten: Buffer): Buffer {
    return Buffer.alloc((512 - (daten.length % 512)) % 512);
}

/** Ein PAX-Datensatz `<Länge> <Schlüssel>=<Wert>\n`; die Länge zählt sich selbst mit. */
function paxSatz(schluessel: string, wert: string): Buffer {
    const rest = ` ${schluessel}=${wert}\n`;
    const restBytes = Buffer.byteLength(rest, "utf8");
    let laenge = restBytes + 1;
    while (String(laenge).length + restBytes !== laenge) laenge = String(laenge).length + restBytes;
    return Buffer.from(`${String(laenge)}${rest}`, "utf8");
}

/** Teilt einen langen Namen für ustar: Name ≤ 100 und Präfix ≤ 155 Zeichen an einem `/`; `null`, wenn es nicht geht. */
export function teileNamen(name: string): { praefix: string; kurz: string } | null {
    for (let i = name.indexOf("/"); i !== -1; i = name.indexOf("/", i + 1)) {
        const praefix = name.slice(0, i);
        const kurz = name.slice(i + 1);
        if (praefix.length <= 155 && kurz.length <= 100 && kurz.length > 0) return { praefix, kurz };
    }
    return null;
}

/** Ein Tar aus Dateien im Speicher; kurze Namen gehen ins Namensfeld, lange nach `namensform`. */
export function tarBytes(
    dateien: readonly { name: string; daten: Buffer }[],
    namensform: TarNamensform = "auto",
): Buffer {
    const teile: Buffer[] = [];
    for (const datei of dateien) {
        let name = datei.name;
        let praefix = "";
        if (Buffer.byteLength(name, "utf8") > 100) {
            const geteilt = teileNamen(name);
            if (namensform === "prefix" || (namensform === "auto" && geteilt !== null)) {
                if (geteilt === null) throw new Error(`Name ${name} lässt sich für ustar nicht teilen`);
                name = geteilt.kurz;
                praefix = geteilt.praefix;
            } else if (namensform === "pax") {
                const daten = paxSatz("path", datei.name);
                teile.push(kopf("PaxHeader/x", daten.length, "x"), daten, auffuellen(daten));
                name = datei.name.slice(0, 100);
            } else {
                const daten = Buffer.from(`${datei.name}\0`, "utf8");
                teile.push(kopf("././@LongLink", daten.length, "L"), daten, auffuellen(daten));
                name = datei.name.slice(0, 100);
            }
        }
        teile.push(kopf(name, datei.daten.length, "0", praefix), datei.daten, auffuellen(datei.daten));
    }
    teile.push(Buffer.alloc(1024));
    return Buffer.concat(teile);
}

/**
 * Liest alle Tafeln des Plans in EINER lesenden Transaktion, wie der Korridor es tut, und schreibt `<ziel>` als Tar. Gibt das Manifest zurück.
 * `veraendere` darf die Bytes einer Tafel verfälschen (Test der Prüfsumme).
 *
 * Mediendateien: Die Liste kommt aus derselben Transaktion (`plan.medien.abfrage`), die Dateien aus `medienWurzel` (ohne Wurzel zählen alle als
 * fehlend an der Quelle). `veraendereMedium` ändert die Bytes im Tar, ohne dass das Manifest es merkt (Test der Prüfsumme).
 */
export async function schreibeAbzug(
    db: Database,
    plan: AbzugPlan,
    optionen: {
        ziel: string;
        kennung: string;
        quelle?: AbzugQuelle;
        veraendereManifest?: (manifest: AbzugManifest) => AbzugManifest;
        veraendereTafel?: (tafel: string, daten: Buffer) => Buffer;
        medienWurzel?: string;
        veraendereMedium?: (pfad: string, daten: Buffer) => Buffer;
        namensform?: TarNamensform;
    },
): Promise<AbzugManifest> {
    const dateien: { name: string; daten: Buffer }[] = [];
    const tafeln: AbzugManifestTafel[] = [];
    const medien: AbzugMedium[] = [];
    const medienFehlend: string[] = [];
    const [migrationen, domaenen] = await db.begin("isolation level repeatable read read only", async (tx) => {
        const journal = await tx.unsafe<{ version: string; checksum: string }[]>(plan.abfragen.migrationen);
        const kopfzeilen = await tx.unsafe<{ id: string; koordinatenraum: string; pruefsumme: string }[]>(
            plan.abfragen.kartendomaenen,
        );
        for (const tafel of plan.tafeln) {
            const stuecke: Buffer[] = [];
            for await (const stueck of await tx.unsafe(tafel.copy).readable()) stuecke.push(stueck as Buffer);
            const gelesen = Buffer.concat(stuecke);
            const daten = optionen.veraendereTafel?.(tafel.tafel, gelesen) ?? gelesen;
            const [zeilen] = await tx.unsafe<{ n: string }[]>(
                `SELECT count(*)::text AS n FROM (${tafel.abfrage}) AS q`,
            );
            dateien.push({ name: tafel.datei, daten });
            tafeln.push({
                tafel: tafel.tafel,
                datei: tafel.datei,
                spalten: tafel.spalten,
                leeren: tafel.leeren,
                verdeckt: tafel.verdeckt,
                zeilen: Number(zeilen?.n),
                // Die Prüfsumme gilt dem, was im Tar liegt, wie bei `sha256sum` auf der Datei.
                sha256: createHash("sha256").update(daten).digest("hex"),
            });
        }
        // Die Liste der Mediendateien aus derselben Transaktion wie die Zeilen.
        const zeilen = await tx.unsafe<{ pfad: string; groesse: string; sha256: string }[]>(plan.medien.abfrage);
        const gesehen = new Set<string>();
        for (const zeile of zeilen) {
            // Wie der echte Export (`ops/corridor/lib/avesmaps3d-abzug.mjs`): Ableitungen liegen nach Inhalt, zeigen zwei Zeilen auf denselben Schlüssel, ist es eine Datei und kommt einmal mit.
            if (gesehen.has(zeile.pfad)) continue;
            gesehen.add(zeile.pfad);
            let daten: Buffer | undefined;
            if (optionen.medienWurzel !== undefined) {
                try {
                    daten = readFileSync(join(optionen.medienWurzel, ...zeile.pfad.split("/")));
                } catch {
                    daten = undefined;
                }
            }
            if (daten === undefined) {
                medienFehlend.push(zeile.pfad);
                continue;
            }
            // Größe und Prüfsumme gelten den Bytes, wie sie an der Quelle liegen.
            medien.push({
                pfad: zeile.pfad,
                groesse: daten.length,
                sha256: createHash("sha256").update(daten).digest("hex"),
            });
            dateien.push({
                name: `${plan.medien.verzeichnis}${zeile.pfad}`,
                daten: optionen.veraendereMedium?.(zeile.pfad, daten) ?? daten,
            });
        }
        return [journal, kopfzeilen] as const;
    });
    let manifest: AbzugManifest = {
        format: ABZUG_FORMAT,
        version: ABZUG_VERSION,
        kennung: optionen.kennung,
        quelle: optionen.quelle ?? plan.quelle,
        erstellt: new Date().toISOString(),
        regeln: plan.regeln,
        migrationen: migrationen.map((zeile) => ({ version: zeile.version, checksum: zeile.checksum })),
        kartendomaenen: domaenen.map((zeile) => ({
            id: zeile.id,
            koordinatenraum: zeile.koordinatenraum,
            pruefsumme: zeile.pruefsumme,
        })),
        tafeln,
        medien,
        medienFehlend,
    };
    if (optionen.veraendereManifest !== undefined) manifest = optionen.veraendereManifest(manifest);
    const inhalt = tarBytes(
        [
            { name: ABZUG_TAR_MANIFEST, daten: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8") },
            ...dateien,
        ],
        optionen.namensform ?? "auto",
    );
    writeFileSync(optionen.ziel, inhalt);
    return manifest;
}

export { ABZUG_DATEI_TAR };
