import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { DumpFehler, leseKopf, leseSeite, type DumpKopf, type DumpSeite } from "./xml.ts";

/**
 * Der Strom über einen MediaWiki-XML-Export (WI-0253 B-1; Legacy `dump-reader.php`): eine Seite nach der anderen, nie der ganze Dump im
 * Speicher. Der echte Dump hat rund 253.000 Titel und rund 315 MB entpackt; gehalten wird immer nur der Rest des Stroms bis zum Ende der
 * nächsten Seite.
 *
 * Eingabe `.xml` (direkt) oder `.xml.bz2`. Entpackt wird mit dem externen Programm `bzip2 -dc` als Kindprozess und im Strom (nichts wird
 * auf die Platte entpackt); Node kann bz2 nicht lesen, und eine Bibliothek für ein Format, das ein Systemprogramm in einem Aufruf kann,
 * wäre die schlechtere Abhängigkeit. Fehlt das Programm, steht das klar in der Meldung (`bzip2_fehlt`, mit dem Namen der Einstellung).
 *
 * 🔴 Ein abgeschnittener Dump ist kein kleiner Dump. Der Strom endet nur dann „vollständig“, wenn `</mediawiki>` gelesen wurde; sonst steht
 * `vollstaendig: false` im letzten Teil, und der Aufrufer entscheidet (der Dump-Bericht zeigt es, ein Abgleich rechnet damit nicht).
 */

export type DumpTeil =
    { art: "kopf"; kopf: DumpKopf } | { art: "seite"; seite: DumpSeite } | { art: "ende"; vollstaendig: boolean };

export interface LeseOptionen {
    /** Den Wikitext mitlesen? Für Zählungen und Titelverzeichnisse nicht: Er ist der Hauptteil des Exports und kostet Entschlüsseln. */
    mitText: boolean;
    /** Das Programm `bzip2` (`WIKI_BZIP2_PFAD`); Vorgabe `bzip2` im Suchpfad. */
    bzip2?: string | undefined;
}

/** Mehr als das hält keine einzelne Seite: Ein Strom ohne Seitenende davor ist kein Export. */
const SEITE_MAX_ZEICHEN = 256 * 1024 * 1024;
/** Der Anfang eines Exports (Kopf samt `<siteinfo>`) muss in so vielen Zeichen stehen, sonst ist es kein Export. */
const KOPF_MAX_ZEICHEN = 4 * 1024 * 1024;

function istBz2(pfad: string): boolean {
    return pfad.toLowerCase().endsWith(".bz2");
}

/** Die Bytes des Dumps, bei `.bz2` entpackt durch `bzip2 -dc`. Endet `bzip2` mit einem Fehler, wirft der Strom am Ende. */
async function* bytes(pfad: string, bzip2: string): AsyncGenerator<Buffer> {
    if (!istBz2(pfad)) {
        for await (const stueck of createReadStream(pfad)) yield stueck as Buffer;
        return;
    }
    const kind = spawn(bzip2, ["-dc", "--", pfad], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let meldung = "";
    kind.stderr.on("data", (stueck: Buffer) => {
        if (meldung.length < 400) meldung += stueck.toString("utf8");
    });
    const gestartet = await new Promise<Error | null>((aufloesen) => {
        kind.once("spawn", () => aufloesen(null));
        kind.once("error", (fehler) => aufloesen(fehler));
    });
    if (gestartet !== null) {
        const fehlt = (gestartet as NodeJS.ErrnoException).code === "ENOENT";
        throw new DumpFehler(
            fehlt ? "bzip2_fehlt" : "bzip2_nicht_startbar",
            fehlt
                ? "Das Programm bzip2 ist nicht installiert oder nicht erreichbar (Pfad in WIKI_BZIP2_PFAD); eine .xml.bz2-Datei lässt sich ohne es nicht lesen"
                : "Das Programm bzip2 ließ sich nicht starten",
        );
    }
    const beendet = new Promise<number | null>((aufloesen) => kind.once("close", (code) => aufloesen(code)));
    try {
        for await (const stueck of kind.stdout) yield stueck as Buffer;
    } finally {
        if (kind.exitCode === null) kind.kill();
    }
    const code = await beendet;
    if (code !== 0) {
        throw new DumpFehler(
            "bzip2_fehler",
            `bzip2 meldet einen Fehler beim Entpacken (Exit ${String(code)}): ${meldung.split("\n")[0]?.trim() ?? ""}`.trim(),
        );
    }
}

/**
 * Liest den Export: zuerst den Kopf, dann jede Seite in der Reihenfolge der Datei, zuletzt das Ende. Der Aufrufer darf die Schleife jederzeit
 * verlassen; das Entpacken wird dann abgebrochen.
 */
export async function* leseDump(pfad: string, optionen: LeseOptionen): AsyncGenerator<DumpTeil> {
    const decoder = new StringDecoder("utf8");
    let puffer = "";
    let kopfGelesen = false;
    let wurzelGesehen = false;
    let ende = false;

    for await (const stueck of bytes(pfad, optionen.bzip2 ?? "bzip2")) {
        puffer += decoder.write(stueck);
        for (;;) {
            if (!kopfGelesen) {
                const kopfEnde = puffer.indexOf("</siteinfo>");
                const seitenAnfang = puffer.indexOf("<page>");
                if (!wurzelGesehen && puffer.includes("<mediawiki")) wurzelGesehen = true;
                if (kopfEnde === -1 && seitenAnfang === -1) {
                    if (puffer.length > KOPF_MAX_ZEICHEN || (puffer.length > 4096 && !wurzelGesehen)) {
                        throw new DumpFehler("kein_dump", "Die Datei ist kein MediaWiki-XML-Export");
                    }
                    break;
                }
                if (!wurzelGesehen) throw new DumpFehler("kein_dump", "Die Datei ist kein MediaWiki-XML-Export");
                const siteinfoStart = puffer.indexOf("<siteinfo>");
                const kopf =
                    kopfEnde !== -1 && siteinfoStart !== -1 && (seitenAnfang === -1 || kopfEnde < seitenAnfang)
                        ? leseKopf(puffer.slice(siteinfoStart, kopfEnde))
                        : leseKopf("");
                kopfGelesen = true;
                yield { art: "kopf", kopf };
                if (kopfEnde !== -1 && (seitenAnfang === -1 || kopfEnde < seitenAnfang))
                    puffer = puffer.slice(kopfEnde + "</siteinfo>".length);
                continue;
            }
            const start = puffer.indexOf("<page>");
            if (start === -1) {
                if (puffer.includes("</mediawiki>")) ende = true;
                // Was vor der nächsten Seite liegt, wird nicht mehr gebraucht; ein Rest für eine zerschnittene Marke bleibt.
                puffer = puffer.slice(Math.max(0, puffer.length - 16));
                break;
            }
            const schluss = puffer.indexOf("</page>", start);
            if (schluss === -1) {
                if (puffer.length - start > SEITE_MAX_ZEICHEN) {
                    throw new DumpFehler("seite_zu_gross", "Eine Seite des Dumps ist größer als erlaubt");
                }
                puffer = puffer.slice(start);
                break;
            }
            const block = puffer.slice(start + "<page>".length, schluss);
            puffer = puffer.slice(schluss + "</page>".length);
            yield { art: "seite", seite: leseSeite(block, optionen.mitText) };
        }
    }
    puffer += decoder.end();
    if (!kopfGelesen) throw new DumpFehler("kein_dump", "Die Datei ist kein MediaWiki-XML-Export");
    if (puffer.includes("</mediawiki>")) ende = true;
    yield { art: "ende", vollstaendig: ende };
}
