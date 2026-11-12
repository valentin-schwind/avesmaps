/**
 * Der Schnappschuss der Geländeeingaben für das lokale Endgelände (WI-0250 Phase B). Er entsteht außerhalb dieses Adapters, nur lesend aus
 * der Datenbank (Muster: `project-control/discovery/wi-0249-formerhalt/snapshot.mjs`, eine Lesetransaktion, REPEATABLE READ, READ ONLY):
 *
 *   inputs.json    DomainInputs ohne Saaten, dazu `seedsMeta` (Kennung, Name, Lage im Block `seeds.u16`)
 *   seeds.u16      alle Saaten hintereinander (gespeicherte Ausrichtung, Zeile 0 im Süden)
 *   gebirge.json   der Auftrag des Gebirges aus der Datenbank (Rahmen zur Gegenprobe)
 *   master.u16     der geltende Master (Zeile 0 im Süden), mit master.json (Fingerabdruck, Größe)
 *
 * Der Adapter liest sie nur. Ihr Inhalts-Fingerabdruck geht in den des Auftrags ein: Ein neuer Schnappschuss ist ein neuer Lauf.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface SaatMeta {
    id: string;
    name: string;
    cell: number;
    originX: number;
    originY: number;
    width: number;
    height: number;
    offset: number;
}

export interface Saat {
    cell: number;
    originX: number;
    originY: number;
    width: number;
    height: number;
    samples: Uint16Array;
}

export interface Schnappschuss {
    ordner: string;
    /** DomainInputs mit den Saaten aus `seeds.u16` (Feld `seeds`); `seedsMeta` bleibt für die Zuordnung der Kennung. */
    eingaben: Record<string, unknown> & { seeds: Saat[]; seedsMeta: SaatMeta[]; fingerprint: string };
    gebirge: {
        id: string;
        name: string;
        input: { bounds: { min_x: number; min_y: number; max_x: number; max_y: number } };
    };
    master: Uint16Array;
    master_kopf: { fingerprint: string; size: number };
    inhalt_sha256: string;
}

/** Standardort, wenn der Auftrag keinen nennt. */
export function standardSchnappschuss(laborDir: string): string {
    return join(laborDir, "schnappschuss", "aktuell");
}

const DATEIEN = ["inputs.json", "gebirge.json", "master.json", "seeds.u16", "master.u16"] as const;

/** Der Inhalts-Fingerabdruck, ohne die Dateien zu parsen (die Reihenfolge der Dateien ist fest). */
export function schnappschussFingerprint(ordner: string): string {
    const h = createHash("sha256");
    for (const name of DATEIEN) {
        const pfad = join(ordner, name);
        if (!existsSync(pfad)) throw new Error(`Schnappschuss unvollständig: ${pfad} fehlt`);
        h.update(`${name}\0`);
        h.update(readFileSync(pfad));
    }
    return h.digest("hex");
}

function leseU16(pfad: string): Uint16Array {
    const bytes = readFileSync(pfad);
    const a = new Uint16Array(bytes.byteLength / 2);
    new Uint8Array(a.buffer).set(bytes);
    return a;
}

export function ladeSchnappschuss(ordner: string): Schnappschuss {
    const inhalt_sha256 = schnappschussFingerprint(ordner);
    const json = <T>(name: string): T => JSON.parse(readFileSync(join(ordner, name), "utf8")) as T;
    const roh = json<Record<string, unknown> & { seedsMeta: SaatMeta[]; fingerprint: string }>("inputs.json");
    const block = readFileSync(join(ordner, "seeds.u16"));
    const seeds: Saat[] = roh.seedsMeta.map((m) => {
        const samples = new Uint16Array(m.width * m.height);
        new Uint8Array(samples.buffer).set(block.subarray(m.offset, m.offset + m.width * m.height * 2));
        return { cell: m.cell, originX: m.originX, originY: m.originY, width: m.width, height: m.height, samples };
    });
    const master_kopf = json<Schnappschuss["master_kopf"]>("master.json");
    const master = leseU16(join(ordner, "master.u16"));
    if (master.length !== master_kopf.size * master_kopf.size)
        throw new Error("master.u16 passt nicht zur Größe in master.json");
    return {
        ordner,
        eingaben: { ...roh, seeds },
        gebirge: json<Schnappschuss["gebirge"]>("gebirge.json"),
        master,
        master_kopf,
        inhalt_sha256,
    };
}
