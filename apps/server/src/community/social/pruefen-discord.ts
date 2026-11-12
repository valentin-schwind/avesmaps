import { userInfo } from "node:os";
import { ZAEHLREGELN } from "@avesmaps3d/shared";
import { recordEvent } from "../../auth/audit.ts";
import type { CliIo } from "../../auth/cli-commands.ts";
import { loadAuthConfig } from "../../auth/config.ts";
import { createDatabase } from "../../database.ts";
import { DiscordFehler, discordGrenzen, leseWebhook } from "./kanaele/discord.ts";
import { leseDiscordZugang } from "./kanaele/konfiguration.ts";
import { speichereGrenzen } from "./kanaele/stand.ts";
import type { PruefenDeps } from "./pruefen.ts";

/**
 * Der Lauf von `social:pruefen` für Discord (WI-0268). Die Regeln des Werkzeugs sind die von Mastodon und Meta (`pruefen.ts`), mit einem Unterschied:
 *
 * - 🔴 **Er schickt nichts.** Einen Testkanal gibt es nicht, jede Probe stünde öffentlich im echten Kanal, und das gibt es nur mit Valis Wort (Handover `2026-11-03-social-hub-discord-kanal-an-claudia.md`). Darum liest der Lauf nur: Der
 *   Webhook gilt und gehört zum eingestellten Kanal. Die Zählregel des Hubs ist damit nicht gegen Discord gemessen; sie zählt vorsichtig (UTF-16-Einheiten, 2000), und ein zu langer Text scheiterte nicht öffentlich, sondern als „Fehler“ am Ziel.
 * - **Ohne `--anwenden` kein Netz und kein Schreibzugriff.** Mit `--anwenden` ist `--operator-said "<Zitat>"` Pflicht: Der Lauf trägt die Grenzen ein und schaltet den Kanal frei (`social_kanal_pruefung_eintragen`, Protokoll
 *   `system.social_kanal_geprueft`, nur Zahlen); ein Webhook, der nicht passt, sperrt ihn.
 */

export interface DiscordPruefAufruf {
    readonly anwenden: boolean;
    readonly zitat: string | undefined;
}

const grundVon = (fehler: unknown): string =>
    fehler instanceof DiscordFehler
        ? fehler.message
        : `Fehler (${String((fehler as { code?: unknown }).code ?? "unbekannt")})`;

/** Rückgabe wie bei den anderen Kanälen: 0 in Ordnung, 1 Fehler, 2 falscher Aufruf (auch: `--anwenden` ohne Zitat). */
export async function runDiscordPruefen(
    aufruf: DiscordPruefAufruf,
    environment: NodeJS.ProcessEnv,
    io: CliIo,
    deps: PruefenDeps = {},
): Promise<number> {
    const regel = ZAEHLREGELN.discord;
    if (!aufruf.anwenden) {
        io.out("PROBELAUF - ohne --anwenden kein Netz und kein Schreibzugriff");
        if (aufruf.zitat !== undefined && aufruf.zitat !== "")
            io.out("Hinweis: --operator-said gilt nur mit --anwenden; dies ist ein Probelauf.");
        io.out(`Zählregel des Hubs für Discord  ${String(regel.grenze)} UTF-16-Einheiten, Links zählen als Text`);
        io.out(
            "Discord: Auch mit --anwenden geht nichts in den Kanal. Der Lauf liest nur, ob der Webhook gilt und zum eingestellten Kanal gehört.",
        );
        return 0;
    }
    if (aufruf.zitat === undefined || aufruf.zitat === "") {
        io.err(
            '--anwenden schreibt in die Datenbank und schaltet den Kanal frei. Es braucht den Zuruf des Betreibers für genau diese Umgebung: --operator-said "<Zitat>". Nichts geschrieben.',
        );
        return 2;
    }
    const databaseUrl = environment["DATABASE_URL"];
    if (deps.database === undefined && databaseUrl === undefined) {
        io.err("DATABASE_URL fehlt.");
        return 2;
    }
    let umgebung;
    try {
        umgebung = loadAuthConfig(environment).environment;
    } catch (error) {
        io.err(`Die Umgebung ist nicht lesbar: ${error instanceof Error ? error.message : String(error)}`);
        return 2;
    }
    if (umgebung === undefined) {
        io.err("AVESMAPS_ENV fehlt: Ohne benannte Umgebung gibt es kein Protokoll, also wird nichts eingetragen.");
        return 2;
    }
    const zugang = leseDiscordZugang(environment);
    if (zugang === undefined) {
        io.err(
            "COMMUNITY_SOCIAL_DISCORD_WEBHOOK und COMMUNITY_SOCIAL_DISCORD_KANAL fehlen oder sind unbrauchbar: In dieser Umgebung gibt es den Kanal nicht. Nichts eingetragen.",
        );
        return 1;
    }
    const heute = (deps.heute ?? (() => new Date().toISOString().slice(0, 10)))();
    const marke = `cli:${deps.systemUser ?? userInfo().username}`;
    const database = deps.database ?? createDatabase(databaseUrl!, { max: 2 });
    try {
        io.out(`Freigabe (Betreiberzitat): „${aufruf.zitat}“`);
        const grenzen = discordGrenzen();
        let grund: string | undefined;
        try {
            await leseWebhook(zugang, deps);
        } catch (fehler) {
            // Ein vorübergehender Fehler ändert nichts am Stand; ein Webhook, den Discord ablehnt oder der in einen anderen Kanal schreibt, sperrt.
            if (!(fehler instanceof DiscordFehler) || !fehler.dauerhaft) {
                io.err(`Der Webhook ist nicht lesbar: ${grundVon(fehler)}. Der Kanal bleibt, wie er war.`);
                return 1;
            }
            grund = fehler.message;
        }
        const freigeschaltet = grund === undefined;
        try {
            await speichereGrenzen(database, "discord", grenzen);
            await database`
                SELECT avesmaps_community.social_kanal_pruefung_eintragen(
                    'discord', ${marke}, ${freigeschaltet},
                    ${database.json({ datum: heute, faelle: 1, uebereinstimmend: freigeschaltet ? 1 : 0 })}::jsonb
                )
            `;
            await database.begin((tx) =>
                recordEvent(tx, {
                    environment: umgebung,
                    action: "system.social_kanal_geprueft",
                    actorKind: "cli",
                    actorLabel: marke,
                    targetRef: "kanal:discord",
                    details: {
                        kanal: "discord",
                        faelle: 1,
                        uebereinstimmend: freigeschaltet ? 1 : 0,
                        freigeschaltet,
                        zitat: true,
                    },
                }),
            );
        } catch (fehler) {
            io.err(
                `Das Ergebnis konnte nicht eingetragen werden (${String((fehler as { code?: unknown }).code ?? "Fehler")}). Der Kanal bleibt, wie er war.`,
            );
            return 1;
        }
        if (!freigeschaltet) {
            io.err(`Der Kanal Discord bleibt GESPERRT: ${grund ?? ""}.`);
            return 1;
        }
        io.out(`Grenze des Hubs                ${String(grenzen.zeichen)} UTF-16-Einheiten, Links zählen als Text`);
        io.out(
            "Der Kanal Discord ist freigeschaltet: Der Webhook gilt und gehört zum eingestellten Kanal. Es ging nichts in den Kanal.",
        );
        return 0;
    } finally {
        if (deps.database === undefined) await database.end();
    }
}
