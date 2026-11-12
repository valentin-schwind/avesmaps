import { WARTESCHLANGE_UMGEBUNGEN, type WarteschlangeUmgebung } from "@avesmaps3d/shared";
import { AUSFUEHRER_ARTEN, type AusfuehrerArt } from "./ausfuehrer.ts";

/**
 * Die Konfiguration des Dirigenten aus der Umgebung des Prozesses (WI-0163 §5.3). Eine reine Funktion, damit sie ohne den Prozess
 * prüfbar ist (`worker-cli.ts` ist ein Einstieg und wird nie importiert). Ein ungültiger Wert hält den Start an, wie ein
 * ungültiger `PORT`.
 *
 * - `DIRIGENT_UMGEBUNGEN` (etwa `staging,production`): je Umgebung die Verbindung aus `DIRIGENT_DB_<UMGEBUNG>` (großgeschrieben,
 *   auf dem VPS die Leserolle `avesmaps3d_<env>_queue_read`).
 * - Ohne die Variable genau eine Umgebung: `AVESMAPS_ENV` (sonst `development`) mit `JOBS_DATABASE_URL`, sonst `DATABASE_URL`.
 *   So bleibt `npm run jobs:worker` lokal und auf der Stage, was es war.
 * - `DIRIGENT_AUSFUEHRER`: `lokal` (Vorgabe) oder `sudo`.
 * - `QUEUE_STAND_FILE`: wohin der Stand geht; ohne Wert schreibt er keinen.
 */

export interface DirigentUmgebung {
    umgebung: WarteschlangeUmgebung;
    url: string;
    /**
     * Was ein lokaler Ausführer zusätzlich bekommt. Mit `DIRIGENT_UMGEBUNGEN` die Umgebung und ihre Verbindung (sonst rechnete jeder
     * Auftrag gegen die Datenbank aus `.env`); in der Form mit einer Umgebung nichts, das Kind erbt die Verbindung.
     */
    ausfuehrerEnv: Readonly<Record<string, string>>;
}

export interface DirigentKonfiguration {
    umgebungen: DirigentUmgebung[];
    ausfuehrer: AusfuehrerArt;
    standDatei: string | undefined;
}

function istUmgebung(value: string): value is WarteschlangeUmgebung {
    return (WARTESCHLANGE_UMGEBUNGEN as readonly string[]).includes(value);
}

function gesetzt(environment: NodeJS.ProcessEnv, name: string): string | undefined {
    const value = environment[name]?.trim();
    return value === undefined || value === "" ? undefined : value;
}

export function dirigentKonfiguration(environment: NodeJS.ProcessEnv): DirigentKonfiguration {
    const art = gesetzt(environment, "DIRIGENT_AUSFUEHRER") ?? "lokal";
    if (!(AUSFUEHRER_ARTEN as readonly string[]).includes(art)) {
        throw new Error(
            `DIRIGENT_AUSFUEHRER muss ${AUSFUEHRER_ARTEN.map((value) => `"${value}"`).join(" oder ")} sein: ${art}`,
        );
    }
    const liste = gesetzt(environment, "DIRIGENT_UMGEBUNGEN");
    let umgebungen: DirigentUmgebung[];
    if (liste === undefined) {
        const umgebung = gesetzt(environment, "AVESMAPS_ENV") ?? "development";
        if (!istUmgebung(umgebung)) {
            throw new Error(
                `AVESMAPS_ENV ist keine Umgebung der Warteschlange (${WARTESCHLANGE_UMGEBUNGEN.join(", ")}): ${umgebung}`,
            );
        }
        const url = gesetzt(environment, "JOBS_DATABASE_URL") ?? gesetzt(environment, "DATABASE_URL");
        if (url === undefined) throw new Error("weder JOBS_DATABASE_URL noch DATABASE_URL gesetzt");
        umgebungen = [{ umgebung, url, ausfuehrerEnv: {} }];
    } else {
        // Erst die Liste, dann die Verbindungen: Ein Tippfehler in der Liste ist die bessere Meldung als eine fehlende Variable.
        const namen: WarteschlangeUmgebung[] = [];
        for (const name of liste.split(",").map((entry) => entry.trim())) {
            if (!istUmgebung(name)) {
                throw new Error(
                    `DIRIGENT_UMGEBUNGEN: "${name}" ist keine Umgebung (${WARTESCHLANGE_UMGEBUNGEN.join(", ")}): ${liste}`,
                );
            }
            if (namen.includes(name)) throw new Error(`DIRIGENT_UMGEBUNGEN nennt "${name}" zweimal: ${liste}`);
            namen.push(name);
        }
        umgebungen = [];
        for (const name of namen) {
            const variable = `DIRIGENT_DB_${name.toUpperCase()}`;
            const url = gesetzt(environment, variable);
            if (url === undefined) throw new Error(`${variable} fehlt (DIRIGENT_UMGEBUNGEN=${liste})`);
            umgebungen.push({ umgebung: name, url, ausfuehrerEnv: { AVESMAPS_ENV: name, JOBS_DATABASE_URL: url } });
        }
    }
    return { umgebungen, ausfuehrer: art as AusfuehrerArt, standDatei: gesetzt(environment, "QUEUE_STAND_FILE") };
}
