import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

/**
 * Das ZIP der Kartendateien (WI-0280): ohne Packen („stored“), weil PNG schon gepackt ist, und ohne Zwischendatei: Ein Plan aus Kopf- und
 * Dateistücken wird beim Abruf gelesen. Dieselben Dateien ergeben dieselben Bytes, also lässt sich ein abgebrochener Download mit `Range`
 * fortsetzen, ohne etwas neu zu bauen, und drei Karten belegen die Platte nicht doppelt.
 *
 * - **Die Prüfsumme steht vorher fest** (`quellen.ts`): Sie steht im Kopf jedes Eintrags, also vor seinen Bytes. Ein Datendeskriptor (Bit 3)
 *   käme ohne sie aus, machte aber den Stand am Ende vom ganzen Lesen abhängig; `Range` ginge nicht.
 * - **ZIP64 nur, wenn nötig:** ab 4 GiB je Datei oder Versatz (neue Kartenserien mit 64k haben bis 6 GB). Darunter bleibt das Format das einfache, das
 *   auch alte Werkzeuge lesen.
 * - Namen sind UTF-8 (Bit 11), die Zeit steht als DOS-Zeit in UTC: Sie gehört zur Datei, nicht zum Abruf.
 */

export type ZipInhalt =
    { readonly art: "datei"; readonly pfad: string } | { readonly art: "puffer"; readonly daten: Buffer };

export interface ZipEintrag {
    readonly name: string;
    readonly bytes: number;
    readonly crc32: number;
    readonly zeit: Date;
    readonly inhalt: ZipInhalt;
}

type Stueck =
    | { readonly art: "puffer"; readonly start: number; readonly daten: Buffer }
    | { readonly art: "datei"; readonly start: number; readonly laenge: number; readonly pfad: string };

export interface ZipPlan {
    readonly bytes: number;
    readonly stuecke: readonly Stueck[];
    /** SHA-256 über Namen, Größen und Prüfsummen: gleich genau dann, wenn die Bytes gleich sind. */
    readonly sha256: string;
}

const GRENZE_32 = 0xffffffff;
const GRENZE_16 = 0xffff;
const FLAG_UTF8 = 0x0800;
const VERSION_EINFACH = 20;
const VERSION_ZIP64 = 45;

function dosZeit(zeit: Date): { zeit: number; datum: number } {
    const jahr = Math.max(1980, zeit.getUTCFullYear());
    return {
        zeit: (zeit.getUTCHours() << 11) | (zeit.getUTCMinutes() << 5) | Math.floor(zeit.getUTCSeconds() / 2),
        datum: ((jahr - 1980) << 9) | ((zeit.getUTCMonth() + 1) << 5) | zeit.getUTCDate(),
    };
}

/** Das Extrafeld 0x0001: nur die Werte, die im festen Teil als 0xFFFFFFFF stehen, in fester Reihenfolge. */
function zip64Extra(werte: readonly number[]): Buffer {
    if (werte.length === 0) return Buffer.alloc(0);
    const extra = Buffer.alloc(4 + werte.length * 8);
    extra.writeUInt16LE(0x0001, 0);
    extra.writeUInt16LE(werte.length * 8, 2);
    werte.forEach((wert, index) => extra.writeBigUInt64LE(BigInt(wert), 4 + index * 8));
    return extra;
}

function lokalerKopf(eintrag: ZipEintrag, name: Buffer): Buffer {
    const gross = eintrag.bytes >= GRENZE_32;
    const extra = zip64Extra(gross ? [eintrag.bytes, eintrag.bytes] : []);
    const { zeit, datum } = dosZeit(eintrag.zeit);
    const kopf = Buffer.alloc(30);
    kopf.writeUInt32LE(0x04034b50, 0);
    kopf.writeUInt16LE(gross ? VERSION_ZIP64 : VERSION_EINFACH, 4);
    kopf.writeUInt16LE(FLAG_UTF8, 6);
    kopf.writeUInt16LE(0, 8);
    kopf.writeUInt16LE(zeit, 10);
    kopf.writeUInt16LE(datum, 12);
    kopf.writeUInt32LE(eintrag.crc32, 14);
    kopf.writeUInt32LE(gross ? GRENZE_32 : eintrag.bytes, 18);
    kopf.writeUInt32LE(gross ? GRENZE_32 : eintrag.bytes, 22);
    kopf.writeUInt16LE(name.length, 26);
    kopf.writeUInt16LE(extra.length, 28);
    return Buffer.concat([kopf, name, extra]);
}

function zentralerKopf(eintrag: ZipEintrag, name: Buffer, versatz: number): Buffer {
    const grosseDatei = eintrag.bytes >= GRENZE_32;
    const grosserVersatz = versatz >= GRENZE_32;
    const extra = zip64Extra([
        ...(grosseDatei ? [eintrag.bytes, eintrag.bytes] : []),
        ...(grosserVersatz ? [versatz] : []),
    ]);
    const version = grosseDatei || grosserVersatz ? VERSION_ZIP64 : VERSION_EINFACH;
    const { zeit, datum } = dosZeit(eintrag.zeit);
    const kopf = Buffer.alloc(46);
    kopf.writeUInt32LE(0x02014b50, 0);
    kopf.writeUInt16LE(version, 4);
    kopf.writeUInt16LE(version, 6);
    kopf.writeUInt16LE(FLAG_UTF8, 8);
    kopf.writeUInt16LE(0, 10);
    kopf.writeUInt16LE(zeit, 12);
    kopf.writeUInt16LE(datum, 14);
    kopf.writeUInt32LE(eintrag.crc32, 16);
    kopf.writeUInt32LE(grosseDatei ? GRENZE_32 : eintrag.bytes, 20);
    kopf.writeUInt32LE(grosseDatei ? GRENZE_32 : eintrag.bytes, 24);
    kopf.writeUInt16LE(name.length, 28);
    kopf.writeUInt16LE(extra.length, 30);
    kopf.writeUInt32LE(grosserVersatz ? GRENZE_32 : versatz, 42);
    return Buffer.concat([kopf, name, extra]);
}

function ende(anzahl: number, groesse: number, versatz: number): Buffer {
    const zip64 = anzahl >= GRENZE_16 || groesse >= GRENZE_32 || versatz >= GRENZE_32;
    const teile: Buffer[] = [];
    if (zip64) {
        const satz = Buffer.alloc(56);
        satz.writeUInt32LE(0x06064b50, 0);
        satz.writeBigUInt64LE(44n, 4);
        satz.writeUInt16LE(VERSION_ZIP64, 12);
        satz.writeUInt16LE(VERSION_ZIP64, 14);
        satz.writeBigUInt64LE(BigInt(anzahl), 24);
        satz.writeBigUInt64LE(BigInt(anzahl), 32);
        satz.writeBigUInt64LE(BigInt(groesse), 40);
        satz.writeBigUInt64LE(BigInt(versatz), 48);
        const zeiger = Buffer.alloc(20);
        zeiger.writeUInt32LE(0x07064b50, 0);
        zeiger.writeBigUInt64LE(BigInt(versatz + groesse), 8);
        zeiger.writeUInt32LE(1, 16);
        teile.push(satz, zeiger);
    }
    const schluss = Buffer.alloc(22);
    schluss.writeUInt32LE(0x06054b50, 0);
    schluss.writeUInt16LE(Math.min(anzahl, GRENZE_16), 8);
    schluss.writeUInt16LE(Math.min(anzahl, GRENZE_16), 10);
    schluss.writeUInt32LE(Math.min(groesse, GRENZE_32), 12);
    schluss.writeUInt32LE(Math.min(versatz, GRENZE_32), 16);
    teile.push(schluss);
    return Buffer.concat(teile);
}

/** Legt fest, welches Byte des ZIP woher kommt. Liest keine Datei. */
export function planeZip(eintraege: readonly ZipEintrag[]): ZipPlan {
    const stuecke: Stueck[] = [];
    const zentral: Buffer[] = [];
    const pruefung = createHash("sha256");
    let stelle = 0;
    const puffer = (daten: Buffer): void => {
        stuecke.push({ art: "puffer", start: stelle, daten });
        stelle += daten.length;
    };
    for (const eintrag of eintraege) {
        const name = Buffer.from(eintrag.name, "utf8");
        zentral.push(zentralerKopf(eintrag, name, stelle));
        puffer(lokalerKopf(eintrag, name));
        if (eintrag.inhalt.art === "puffer") {
            puffer(eintrag.inhalt.daten);
        } else {
            stuecke.push({ art: "datei", start: stelle, laenge: eintrag.bytes, pfad: eintrag.inhalt.pfad });
            stelle += eintrag.bytes;
        }
        pruefung.update(
            `${eintrag.name}\n${String(eintrag.bytes)}\n${String(eintrag.crc32)}\n${eintrag.zeit.toISOString()}\n`,
        );
    }
    const zentralStart = stelle;
    const verzeichnis = Buffer.concat(zentral);
    puffer(verzeichnis);
    puffer(ende(eintraege.length, verzeichnis.length, zentralStart));
    return { bytes: stelle, stuecke, sha256: pruefung.digest("hex") };
}

/** Die Bytes `start` bis `letztes` (einschließlich) als Strom; eine Datei wird nur geöffnet, wenn der Bereich sie berührt. `geliefert` zählt, was abgenommen wurde. */
export function zipStrom(
    plan: ZipPlan,
    start: number,
    letztes: number,
    geliefert?: (anzahl: number) => void,
): Readable {
    async function* bytes(): AsyncGenerator<Buffer> {
        for (const stueck of plan.stuecke) {
            const laenge = stueck.art === "puffer" ? stueck.daten.length : stueck.laenge;
            const von = Math.max(start, stueck.start);
            const bis = Math.min(letztes, stueck.start + laenge - 1);
            if (von > bis) continue;
            if (stueck.art === "puffer") {
                const teil = stueck.daten.subarray(von - stueck.start, bis - stueck.start + 1);
                yield teil;
                geliefert?.(teil.length);
                continue;
            }
            for await (const teil of createReadStream(stueck.pfad, {
                start: von - stueck.start,
                end: bis - stueck.start,
            })) {
                yield teil as Buffer;
                geliefert?.((teil as Buffer).length);
            }
        }
    }
    return Readable.from(bytes(), { objectMode: false });
}
