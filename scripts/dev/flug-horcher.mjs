// Die Gegenstelle des Melders (`apps/web/src/map/flug-melder.ts`): nimmt jede Sekunde eine Meldung der Karte entgegen und schreibt
// sie als Zeile. Fuer den Befund „Chrome auf dem iPhone beendet den Zugriff im 3D-Flug" (Betreiber 2026-10-12): Stirbt der Tab, ist
// die letzte Meldung schon hier, und sie sagt, was unmittelbar davor geschah.
//
// 🔴 Nur fuer die Entwicklung, nur solange gemessen wird, danach beenden. Kein Teil des Produkts, nichts davon laeuft auf einem
// Server.
//
// 🔴 ER LAUSCHT NUR AUF DEM EIGENEN RECHNER, bis jemand es ausdruecklich anders will. Wer das Telefon messen will, nennt die
// Adresse selbst (`--host 0.0.0.0`); dann warnt er, denn ab da kann JEDER im selben Netz Zeilen in die Datei schreiben. Eine
// Anmeldung hat er nicht, und er soll auch keine bekommen - er soll nur kurz leben.
//
// 💣 Alles, was hereinkommt, ist FREMDER TEXT. Er wandert in ein Terminal und in eine Datei, also:
//   - hoechstens 64 KB je Anfrage (sonst haelt ein einziger Absender den Speicher),
//   - nur der Pfad `/melder`,
//   - ausgegeben werden nur Zahlen; alles andere wird auf druckbares ASCII gekuerzt. Sonst schriebe ein fremder Absender
//     Steuerzeichen in mein Terminal (Farben, Cursorspruenge, geloeschte Zeilen - im schlimmsten Fall ein unsichtbarer Befehl).
//   - in die Datei geht nur, was die erwartete Form hat.
//
// Aufruf:
//   node scripts/dev/flug-horcher.mjs [--port 5177] [--host 0.0.0.0] [--out datei.jsonl]
//
// Dazu im Browser die Adresse um `&melder=1` ergaenzen. Jede Meldung erscheint sofort als Zeile und wandert in die Datei.
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const wert = (flagge, vorgabe) => {
    const at = args.indexOf(flagge);
    return at >= 0 ? (args[at + 1] ?? vorgabe) : vorgabe;
};
const port = Number(wert("--port", "5177"));
const host = wert("--host", "127.0.0.1");
const ziel = wert("--out", "flug-melder.jsonl");
const offen = host !== "127.0.0.1" && host !== "::1" && host !== "localhost";

/** Hoechstens so viel nimmt er je Anfrage an; eine Meldung ist rund 300 Byte. */
const MAX_BYTES = 64 * 1024;

let letzte = null;
let zahl = 0;
const spalten = [
    "t",
    "bilder",
    "zoom",
    "neigung",
    "gelaende",
    "kacheln",
    "buffer",
    "textur",
    "vao",
    "texturMb",
    "hochMb",
    "verloren",
    "lang",
    "langMs",
    "heapMb",
    "schalter",
];

/** Nur Zahlen gehen roh hinaus; alles andere wird auf druckbares ASCII gekuerzt (siehe Kopf). */
const sauber = (wert_) => {
    if (typeof wert_ === "number" && Number.isFinite(wert_)) return String(wert_);
    if (wert_ === null || wert_ === undefined) return "-";
    return String(wert_)
        .replace(/[^\x20-\x7e]/gu, "?")
        .slice(0, 16);
};

/** Eine Meldung ist brauchbar, wenn sie ein Objekt ist und `t` als Zahl trägt. */
const brauchbar = (meldung) =>
    typeof meldung === "object" && meldung !== null && !Array.isArray(meldung) && typeof meldung.t === "number";

const server = createServer((anfrage, antwort) => {
    // Der Melder schickt `no-cors`; eine Antwort braucht er nicht, aber ein Vorflug-OPTIONS soll nicht haengen.
    antwort.setHeader("access-control-allow-origin", "*");
    antwort.setHeader("access-control-allow-headers", "content-type");
    if (anfrage.method === "OPTIONS") {
        antwort.writeHead(204).end();
        return;
    }
    const pfad = (anfrage.url ?? "").split("?")[0];
    if (anfrage.method !== "POST" || pfad !== "/melder") {
        antwort.writeHead(anfrage.method === "POST" ? 404 : 405).end();
        return;
    }
    const teile = [];
    let groesse = 0;
    anfrage.on("data", (stueck) => {
        groesse += stueck.length;
        if (groesse > MAX_BYTES) {
            anfrage.destroy();
            return;
        }
        teile.push(stueck);
    });
    anfrage.on("end", () => {
        antwort.writeHead(204).end();
        const text = Buffer.concat(teile).toString("utf8");
        let meldung;
        try {
            meldung = JSON.parse(text);
        } catch {
            process.stdout.write(`unlesbar: ${sauber(text.slice(0, 200))}\n`);
            return;
        }
        if (!brauchbar(meldung)) {
            process.stdout.write(`verworfen (unerwartete Form): ${sauber(text.slice(0, 120))}\n`);
            return;
        }
        zahl += 1;
        letzte = meldung;
        appendFileSync(ziel, `${JSON.stringify({ ...meldung, empfangen: new Date().toISOString() })}\n`, "utf8");
        if (zahl === 1) process.stdout.write(`\n${spalten.map((s) => s.padStart(9)).join("")}\n`);
        process.stdout.write(`${spalten.map((s) => sauber(meldung[s]).padStart(9)).join("")}\n`);
    });
});

process.on("SIGINT", () => {
    process.stdout.write(
        `\n${String(zahl)} Meldungen in ${ziel}.\n` +
            (letzte
                ? `Letzte vor dem Ende: ${sauber(JSON.stringify(letzte)).slice(0, 400)}\n`
                : "Keine Meldung angekommen.\n"),
    );
    process.exit(0);
});

server.listen(port, host, () => {
    process.stdout.write(
        `Horcher auf http://${host}:${String(port)}/melder, schreibt nach ${ziel}.\n` +
            (offen
                ? `🔴 OFFEN im Netz (${host}): ohne Anmeldung, jeder im selben Netz kann Zeilen schreiben. Nach der Messung beenden.\n`
                : "") +
            `Im Browser die Adresse um &melder=1 ergaenzen. Beenden mit Strg+C.\n`,
    );
});
