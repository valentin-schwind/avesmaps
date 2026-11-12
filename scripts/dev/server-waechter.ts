// Startet den lokalen Fastify und startet ihn NEU, wenn sich der INHALT einer Quelldatei unter `apps/server/src` oder `packages/shared/src`
// ändert (oder eine Datei entsteht oder verschwindet). Ersetzt `node --watch-path=…` in `npm run dev` des Servers; die Begründung und die
// Entscheidungsregel stehen in `server-waechter-kern.ts`, hier sind nur `fs.watch` und der Kindprozess.
//
// Nur Bordmittel von Node, keine Abhängigkeit. Der Server bekommt genau die Argumente von früher (ohne `--watch`) und das Arbeitsverzeichnis
// `apps/server`; die Umgebung wird durchgereicht (`PORT`, `TILE_ROOT`, `MEDIA_ROOT` … aus `start-local-stack.ps1`).
//
// 🪤 Der Server wird mit `kind.kill()` beendet, nicht mit `taskkill /T`: Unter Windows ist das `TerminateProcess` nur auf den Server, wie es
// `node --watch` tat. Der Baum käme mit `/T` zu weit: Der abgelöste Starter des Release-Tests (`release-test-prozess.ts`) hängt mit seiner
// Elternprozess-Kennung am Server und soll den Neustart überleben. Nicht abgelöste Kinder des Servers sterben mit ihm (Job-Objekt von libuv).
// Stirbt der Wächter selbst (`taskkill /T /F` des Stapelskripts, Absturz), stirbt der Server mit ihm: Er liegt im Job des Wächters.
//
// Die Zeilen am Ende eines Servers und beim Neustart sind die von `node --watch` (`Restarting '…'`, `Failed running '…'`), damit nichts, was
// das Protokoll liest, umlernen muss; neu ist eine Zeile `server-waechter: …` davor, die sagt, welche Datei den Neustart ausgelöst hat.
import { spawn, type ChildProcess } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dateisystemZugriff, erzeugeAenderungswaechter, type Aenderung } from "./server-waechter-kern.ts";

const SERVER_DATEI = "src/server.ts";
/** Genau die Argumente von `npm run dev` vor dem Wächter, ohne `--watch-path`. Relativ zu `apps/server`. */
const SERVER_ARGUMENTE = [
    "--import",
    "../../scripts/dev/shared-aus-quellen.mjs",
    "--env-file-if-exists=../../.env",
    SERVER_DATEI,
];
const ENTPRELLEN_MS = 300;
/** Wie lange ein Neustart auf das Ende des alten Servers wartet, bevor er sich über den belegten Port beschwert. */
const ENDE_FRIST_MS = 10_000;

const skripte = dirname(fileURLToPath(import.meta.url));
const wurzel = resolve(skripte, "../..");
const serverOrdner = join(wurzel, "apps", "server");
const beobachtet = [join(serverOrdner, "src"), join(wurzel, "packages", "shared", "src")];

let kind: ChildProcess | undefined;
/** Kinder, die wir selbst beendet haben: Ihr Ende ist kein Absturz. */
const absichtlich = new WeakSet<ChildProcess>();
let beendet = false;

function schreibe(text: string): void {
    process.stdout.write(text + "\n");
}

function starteKind(): void {
    const dieses = spawn(process.execPath, SERVER_ARGUMENTE, {
        cwd: serverOrdner,
        env: process.env,
        stdio: ["ignore", "inherit", "inherit"],
        windowsHide: true,
    });
    kind = dieses;
    const verwaist = (text: string): void => {
        if (kind !== dieses) return;
        kind = undefined;
        if (absichtlich.has(dieses) || beendet) return;
        waechter.setzeLaeuft(false);
        schreibe(`${text} Waiting for file changes before restarting...`);
    };
    dieses.once("error", (fehler) => {
        console.error(`server-waechter: Server nicht zu starten: ${fehler.message}`);
        verwaist(`Failed running '${SERVER_DATEI}'.`);
    });
    dieses.once("exit", (code) => {
        verwaist(code === 0 ? `Completed running '${SERVER_DATEI}'.` : `Failed running '${SERVER_DATEI}'.`);
    });
}

/** Beendet den Server und wartet auf sein Ende, damit der Port frei ist, bevor der neue startet. */
function beendeKind(): Promise<void> {
    const dieses = kind;
    if (dieses === undefined || dieses.exitCode !== null || dieses.signalCode !== null) return Promise.resolve();
    absichtlich.add(dieses);
    return new Promise((fertig) => {
        const frist = setTimeout(() => {
            console.error(
                `server-waechter: Der Server endet nicht innerhalb von ${String(ENDE_FRIST_MS / 1000)} s (PID ${String(dieses.pid)})`,
            );
            fertig();
        }, ENDE_FRIST_MS);
        dieses.once("exit", () => {
            clearTimeout(frist);
            fertig();
        });
        if (process.platform === "win32") {
            dieses.kill(); // TerminateProcess; ein Signal gibt es hier nicht
        } else {
            dieses.kill("SIGTERM"); // der Server fährt dabei sauber herunter (server.ts)
            setTimeout(() => {
                if (dieses.exitCode === null && dieses.signalCode === null) dieses.kill("SIGKILL");
            }, 5_000).unref();
        }
    });
}

const ART: Record<Aenderung["art"], string> = {
    geaendert: "geändert",
    neu: "neu",
    weg: "gelöscht",
    beruehrt: "berührt",
};

function beschreibe(aenderungen: readonly Aenderung[]): string {
    const namen = aenderungen.map(
        (aenderung) => `${ART[aenderung.art]} ${relative(wurzel, aenderung.pfad).replaceAll("\\", "/")}`,
    );
    const weitere = namen.length > 3 ? ` (+${String(namen.length - 3)} weitere)` : "";
    return `server-waechter: ${namen.slice(0, 3).join(", ")}${weitere}`;
}

/** Neustarts laufen nacheinander: Einer, der noch auf das Ende des alten Servers wartet, wird nicht überholt. */
let umschaltung: Promise<void> = Promise.resolve();
function neustart(aenderungen: readonly Aenderung[]): void {
    umschaltung = umschaltung
        .then(async () => {
            if (beendet) return;
            schreibe(beschreibe(aenderungen));
            schreibe(`Restarting '${SERVER_DATEI}'`);
            await beendeKind();
            if (!beendet) starteKind();
        })
        .catch((fehler: unknown) => {
            console.error("server-waechter: Neustart fehlgeschlagen:", fehler);
        });
}

const waechter = erzeugeAenderungswaechter({
    zugriff: dateisystemZugriff(beobachtet),
    entprellenMs: ENTPRELLEN_MS,
    beiNeustart: neustart,
    beiFehler: (fehler) => {
        console.error("server-waechter: Prüfung fehlgeschlagen:", fehler);
    },
});

const beobachter = new Set<FSWatcher>();
function beobachte(ordner: string): void {
    if (beendet) return;
    let dieser: FSWatcher;
    try {
        dieser = watch(ordner, { recursive: true }, (_art, name) => {
            // Ohne Namen (Überlauf des Puffers beim Auschecken vieler Dateien) wird alles verglichen.
            waechter.ereignis(name === null || name === "" ? null : join(ordner, name));
        });
    } catch (fehler) {
        console.error(`server-waechter: ${ordner} nicht zu beobachten:`, fehler);
        process.exit(1);
    }
    beobachter.add(dieser);
    // Verschwindet der Ordner (Auschecken eines anderen Standes), bricht der Beobachter mit EPERM ab: neu aufmachen, sobald er wieder da ist.
    dieser.once("error", (fehler) => {
        console.error(`server-waechter: Beobachter für ${ordner} gestört (${String(fehler)}), neuer Versuch in 2 s`);
        beobachter.delete(dieser);
        dieser.close();
        setTimeout(() => {
            beobachte(ordner);
            waechter.ereignis(null);
        }, 2_000);
    });
}

async function beende(code: number): Promise<void> {
    if (beendet) return;
    beendet = true;
    waechter.schliessen();
    for (const dieser of beobachter) dieser.close();
    await beendeKind();
    process.exit(code);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) {
    process.on(signal, () => {
        void beende(0);
    });
}
process.on("exit", () => {
    if (kind !== undefined && kind.exitCode === null) kind.kill();
});

// Erst beobachten, dann den Stand aufnehmen, dann starten: Was sich dazwischen ändert, wird nach dem Entprellen mit dem Stand verglichen.
for (const ordner of beobachtet) beobachte(ordner);
waechter.aufnehmen();
schreibe(
    `server-waechter: beobachtet ${beobachtet.map((ordner) => relative(wurzel, ordner).replaceAll("\\", "/")).join(" und ")}, Neustart nur bei geändertem Inhalt`,
);
starteKind();
