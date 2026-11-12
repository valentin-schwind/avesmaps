import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { Readable } from "node:stream";

/**
 * Ein Leser für das Tar eines Abzugs (WI-0251). Claudio schreibt es mit GNU `tar`; gelesen wird mit wahlfreiem Zugriff: Die Köpfe
 * werden der Reihe nach gesucht (ein Kopf ist 512 Byte, die Daten werden übersprungen), und jede Datei liest danach genau ihren Bereich.
 * So kostet das Listen eines mehrere Gigabyte großen Abzugs Millisekunden, auch mit Zehntausenden Mediendateien.
 *
 * Verstanden werden gewöhnliche Dateien und Ordner (ustar und GNU) und die drei Wege, einen Namen über 100 Zeichen zu schreiben, weil die
 * Schlüssel der Mediendateien (`medien/private/source/sha256/ab/cd/<hash>.jpg`) das Namensfeld sprengen:
 *
 * - das ustar-Feld `prefix` (Vorgabe von `tar --format=ustar` und `bsdtar`, soweit der Name sich an einem `/` teilen lässt),
 * - GNU-Langnamen (Typ `L`, die Vorgabe von GNU `tar --format=gnu`),
 * - PAX-Köpfe (Typ `x` mit `path=`, die Vorgabe von `tar --format=pax` und Pythons `tarfile`); ein `size=` dort gilt auch.
 *
 * Alles andere (Verknüpfungen, Geräte, Sparse-Dateien) liest der Leser nicht und sagt es, statt falsch zu lesen. Globale PAX-Köpfe (`g`)
 * und GNU-Verweisnamen (`K`) werden übersprungen.
 */
export interface TarEintrag {
    readonly name: string;
    readonly groesse: number;
    /** Wo die Daten der Datei beginnen (Byte im Tar). */
    readonly start: number;
}

const BLOCK = 512;
/** Mehr als das darf ein Langname oder PAX-Kopf nicht belegen (ein Pfad ist höchstens 4096 Zeichen lang). */
const ERWEITERUNG_MAX = 64 * 1024;

function textVon(kopf: Buffer, von: number, bis: number): string {
    const ende = kopf.indexOf(0, von);
    return kopf.toString("utf8", von, ende === -1 || ende > bis ? bis : ende);
}

function zahlVon(kopf: Buffer, von: number, bis: number): number {
    // GNU kodiert große Zahlen binär (erstes Bit gesetzt); Abzüge sind kleiner als 8 GiB je Datei, aber die Form gibt es trotzdem.
    if ((kopf[von]! & 0x80) !== 0) {
        let wert = kopf[von]! & 0x7f;
        for (let i = von + 1; i < bis; i += 1) wert = wert * 256 + kopf[i]!;
        return wert;
    }
    const roh = textVon(kopf, von, bis).trim();
    return roh === "" ? 0 : Number.parseInt(roh, 8);
}

function pruefsummeStimmt(kopf: Buffer): boolean {
    let summe = 0;
    for (let i = 0; i < BLOCK; i += 1) summe += i >= 148 && i < 156 ? 32 : kopf[i]!;
    return summe === zahlVon(kopf, 148, 156);
}

/** Die Schlüssel `path` und `size` aus den Datensätzen eines PAX-Kopfes (`<Länge> <Schlüssel>=<Wert>\n`, die Länge zählt Bytes). */
function paxVon(daten: Buffer): { path?: string; size?: number } {
    const ergebnis: { path?: string; size?: number } = {};
    let lage = 0;
    while (lage < daten.length) {
        const leer = daten.indexOf(0x20, lage);
        if (leer === -1) throw new Error("kein Tar: ein PAX-Kopf ist unvollständig");
        const laenge = Number.parseInt(daten.toString("latin1", lage, leer), 10);
        if (!Number.isInteger(laenge) || laenge <= leer - lage + 1 || lage + laenge > daten.length) {
            throw new Error("kein Tar: ein PAX-Kopf hat eine falsche Länge");
        }
        const satz = daten.toString("utf8", leer + 1, lage + laenge - 1); // ohne das abschließende \n
        const gleich = satz.indexOf("=");
        if (gleich > 0) {
            const schluessel = satz.slice(0, gleich);
            const wert = satz.slice(gleich + 1);
            if (schluessel === "path") ergebnis.path = wert;
            else if (schluessel === "size") {
                const groesse = Number.parseInt(wert, 10);
                if (Number.isSafeInteger(groesse) && groesse >= 0) ergebnis.size = groesse;
            }
        }
        lage += laenge;
    }
    return ergebnis;
}

async function listeUngeprueft(pfad: string): Promise<TarEintrag[]> {
    const datei = await open(pfad, "r");
    try {
        const { size } = await datei.stat();
        const eintraege: TarEintrag[] = [];
        const kopf = Buffer.alloc(BLOCK);
        let lage = 0;
        let langerName: string | undefined;
        let paxName: string | undefined;
        let paxGroesse: number | undefined;
        while (lage + BLOCK <= size) {
            const { bytesRead } = await datei.read(kopf, 0, BLOCK, lage);
            if (bytesRead < BLOCK) break;
            if (kopf.every((byte) => byte === 0)) break; // Ende: Nullblock
            if (!pruefsummeStimmt(kopf)) throw new Error("kein Tar: Prüfsumme eines Kopfes stimmt nicht");
            const typ = String.fromCharCode(kopf[156] === 0 ? 48 : kopf[156]!);
            let name = textVon(kopf, 0, 100);
            const praefix = textVon(kopf, 345, 500);
            if (praefix !== "" && kopf.toString("latin1", 257, 262) === "ustar") name = `${praefix}/${name}`;
            const kopfGroesse = zahlVon(kopf, 124, 136);

            // Köpfe, die dem nächsten Eintrag etwas mitgeben (oder ganz überlesen werden).
            if (typ === "L" || typ === "K" || typ === "x" || typ === "g") {
                if (kopfGroesse > ERWEITERUNG_MAX) throw new Error(`Tar-Eintrag ${name}: Der Kopf ist zu groß`);
                if (lage + BLOCK + kopfGroesse > size)
                    throw new Error(`Tar-Eintrag ${name}: Die Datei ist abgeschnitten`);
                if (typ === "L" || typ === "x") {
                    const daten = Buffer.alloc(kopfGroesse);
                    await datei.read(daten, 0, kopfGroesse, lage + BLOCK);
                    if (typ === "L") {
                        const ende = daten.indexOf(0);
                        langerName = daten.toString("utf8", 0, ende === -1 ? daten.length : ende);
                    } else {
                        const pax = paxVon(daten);
                        paxName = pax.path;
                        paxGroesse = pax.size;
                    }
                }
                lage += BLOCK + Math.ceil(kopfGroesse / BLOCK) * BLOCK;
                continue;
            }

            if (typ !== "0" && typ !== "5" && typ !== "7") {
                throw new Error(`Tar-Eintrag ${name}: Art "${typ}" wird nicht gelesen (nur Dateien und Ordner)`);
            }
            // Ein Langname oder PAX-Pfad gehört genau diesem Eintrag.
            name = paxName ?? langerName ?? name;
            const groesse = paxGroesse ?? kopfGroesse;
            langerName = undefined;
            paxName = undefined;
            paxGroesse = undefined;
            if (typ !== "5") {
                if (lage + BLOCK + groesse > size) throw new Error(`Tar-Eintrag ${name}: Die Datei ist abgeschnitten`);
                eintraege.push({ name: name.replace(/^\.\//u, ""), groesse, start: lage + BLOCK });
            }
            lage += BLOCK + Math.ceil((typ === "5" ? 0 : groesse) / BLOCK) * BLOCK;
        }
        return eintraege;
    } finally {
        await datei.close();
    }
}

/**
 * Das zuletzt gelesene Verzeichnis eines Tars: Die Oberfläche fragt den Eingang alle paar Sekunden ab, und Prüfung, Liste und Einspielen
 * lesen dieselbe Datei. Gilt nur, solange Größe, Änderungszeit und Inode gleich sind, und nur für Dateien, die seit mehr als zwei Sekunden
 * unverändert liegen (zwei Schreibvorgänge im selben Zeittakt des Dateisystems ließen sich sonst nicht unterscheiden).
 */
let gemerkt: { pfad: string; marke: string; eintraege: TarEintrag[] } | undefined;
const RUHEZEIT_MS = 2000;

/** Alle Dateien des Tars in der Reihenfolge, in der sie stehen. Wirft bei einer Datei, die kein Tar ist. */
export async function listeTar(pfad: string): Promise<TarEintrag[]> {
    const info = await stat(pfad, { bigint: true });
    const marke = `${String(info.size)}:${String(info.mtimeNs)}:${String(info.ino)}`;
    const ruhig = Date.now() - Number(info.mtimeNs / 1_000_000n) > RUHEZEIT_MS;
    if (ruhig && gemerkt !== undefined && gemerkt.pfad === pfad && gemerkt.marke === marke)
        return [...gemerkt.eintraege];
    const eintraege = await listeUngeprueft(pfad);
    if (ruhig) gemerkt = { pfad, marke, eintraege };
    return [...eintraege];
}

/** Die Daten einer Datei im Tar als Strom. */
export function tarStrom(pfad: string, eintrag: TarEintrag): Readable {
    if (eintrag.groesse === 0) return Readable.from([]);
    return createReadStream(pfad, { start: eintrag.start, end: eintrag.start + eintrag.groesse - 1 });
}

/** Eine kleine Datei des Tars ganz als Text (das Manifest), mit Obergrenze. */
export async function tarText(pfad: string, eintrag: TarEintrag, hoechstens = 64 * 1024 * 1024): Promise<string> {
    if (eintrag.groesse > hoechstens)
        throw new Error(`Tar-Eintrag ${eintrag.name}: größer als ${String(hoechstens)} Byte`);
    const datei = await open(pfad, "r");
    try {
        const puffer = Buffer.alloc(eintrag.groesse);
        if (eintrag.groesse > 0) await datei.read(puffer, 0, eintrag.groesse, eintrag.start);
        return puffer.toString("utf8");
    } finally {
        await datei.close();
    }
}
