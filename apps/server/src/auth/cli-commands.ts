import { userInfo } from "node:os";
import { parseArgs } from "node:util";
import { isRole, type Role } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../database.ts";
import { ACCESS_LINK_PATH, createAccessLink, type AccessLinkKind } from "./access-links.ts";
import { recordEvent } from "./audit.ts";
import { loadAuthConfig, type AuthEnvironment } from "./config.ts";
import {
    dissolvePerson,
    DissolveRefused,
    type DissolveCounts,
    type DissolveInput,
    type DissolveResult,
} from "./dissolve.ts";
import { normalizeLoginName, validLoginName } from "./password-accounts.ts";
import { abgleicheModes } from "../abgleiche/ausfuehrung.ts";
import { hoehenmodellProfil } from "../terrain/hoehenmodell-profil.ts";
import { isSystemCommand, runSystemCommand, SYSTEM_USAGE } from "../system/system-cli.ts";
import { revokePersonIssued, revokePersonSessions, type Sql } from "./session-store.ts";

/**
 * `auth`, der Notzugang ohne Browser und ohne Discord (WI-0120 A4, AUTH-0001 §6.7, §11.2; Kap. 10.46; Ultra-Review R-08).
 * Läuft auf dem VPS per SSH (Claudio oder Betreiber), lokal mit `npm run auth --`. Jede Handlung steht im Protokoll als
 * `cli:<Systembenutzer>`. Ausgegeben wird höchstens ein einmaliger Link; er ist ein Geheimnis und gehört in keinen Chat.
 *
 *   einrichten --name <Anzeigename> --benutzer <Benutzername> [--rolle operator]   erstes Konto (Bootstrap), Link zum Passwort
 *   ruecksetzlink --benutzer <Name>                                                Rücksetzlink, 24 Stunden
 *   notzugang --benutzer <Name>                                                    Notzugang, 60 Minuten, plus Passwort
 *   passkey-link --benutzer <Name>                                                 Link zum ersten Passkey, 24 Stunden
 *   sperren --benutzer <Name> --grund <Text>                                       Person sperren, alle Sitzungen enden
 *   entsperren --benutzer <Name>
 *   sitzungen-beenden --benutzer <Name>
 *   aufloesen --benutzer <Name> [--bestaetigung "<Anzeigename>"]                    Konto auflösen (Art. 17 DSGVO, `dissolve.ts`);
 *                                                                                  ohne Bestätigung nur ein Trockenlauf
 *
 * Dazu der Betriebszustand ohne Person (WI-0127 SYS-2, `system/system-cli.ts`): `betrieb-zeigen`, `betrieb-normal`,
 * `betrieb-einschraenken --grund`, `sperre-setzen --art karte|system --grund`, `sperre-loesen [--art]`. `betrieb-normal` und
 * `sperre-loesen` sind der Rückweg aus jeder Selbstaussperrung. Seit SYS-14 auch `abgleich-starten --quelle legacy|medien` (ein Abgleich
 * als Auftrag der Warteschlange, mit Protokolleintrag wie über die Systemsteuerung; nur wo `ABGLEICHE=worker`).
 *
 * Statt `--benutzer` wählt `--person <Kennung>` oder `--discord <ID>` die Person; ein aufgelöstes Konto hat keinen Benutzernamen
 * und keine Discord-ID mehr, also nur noch die Kennung.
 *
 * Umgebung: AVESMAPS_ENV (Pflicht außer lokal), PUBLIC_ORIGIN (für den Link), DATABASE_URL.
 */
export interface CliIo {
    out(line: string): void;
    err(line: string): void;
}

export interface CliDeps {
    database?: Database;
    systemUser?: string;
}

const USAGE = `auth <Befehl>

  einrichten --name <Anzeigename> --benutzer <Benutzername> [--rolle operator|admin|editor|reviewer|tester]
  ruecksetzlink (--benutzer <Name> | --person <Kennung>)
  notzugang --benutzer <Name>
  passkey-link --benutzer <Name>
  sperren --benutzer <Name> --grund <Text>
  entsperren --benutzer <Name>
  sitzungen-beenden --benutzer <Name>
  aufloesen --benutzer <Name> [--bestaetigung "<Anzeigename>"]

Betriebszustand (ohne Person, gilt sofort für alle Instanzen dieser Umgebung):
${SYSTEM_USAGE}

Statt --benutzer geht überall auch --person <Kennung> oder --discord <ID>.
aufloesen löst ein Konto auf Antrag auf (Recht auf Löschung): Anmeldewege, Sitzungen und Discord-Angaben werden gelöscht,
Passkeys geleert, Links, Sonderrechte und Zugang entzogen, der Anzeigename durch einen Platzhalter ersetzt; das Protokoll
bleibt, Freitext darin zur Person wird geschwärzt. Ohne --bestaetigung nur ein Trockenlauf, der zeigt, was geschähe. Nie der
letzte aktive Betreiber. Wiederholbar.

Umgebung: AVESMAPS_ENV, PUBLIC_ORIGIN, DATABASE_URL. Ausgabe: höchstens ein einmaliger Link (ein Geheimnis).`;

async function findPerson(sql: Sql, loginName: string): Promise<{ id: string; display_name: string } | undefined> {
    const [row] = await sql<{ id: string; display_name: string }[]>`
        SELECT p.id, p.display_name FROM avesmaps_auth.password_login pl JOIN avesmaps_auth.person p ON p.id = pl.person_id
         WHERE pl.login_name = ${normalizeLoginName(loginName)}
    `;
    return row;
}

async function findPersonById(sql: Sql, id: string): Promise<{ id: string; display_name: string } | undefined> {
    if (!/^[0-9a-f-]{36}$/u.test(id)) return undefined;
    const [row] = await sql<{ id: string; display_name: string }[]>`
        SELECT id, display_name FROM avesmaps_auth.person WHERE id = ${id}
    `;
    return row;
}

/** Über die Discord-ID (in Discord: Rechtsklick auf den Namen, „Benutzer-ID kopieren“): Wer nur Discord nutzt, hat keinen Benutzernamen. */
async function findPersonByDiscord(
    sql: Sql,
    discordId: string,
): Promise<{ id: string; display_name: string } | undefined> {
    if (!/^[0-9]{15,21}$/u.test(discordId)) return undefined;
    const [row] = await sql<{ id: string; display_name: string }[]>`
        SELECT p.id, p.display_name FROM avesmaps_auth.discord_login d JOIN avesmaps_auth.person p ON p.id = d.person_id
         WHERE d.discord_user_id = ${discordId}
    `;
    return row;
}

/** Bricht die Transaktion eines Trockenlaufs ab und trägt sein Ergebnis hinaus. */
class DryRun extends Error {
    readonly result: DissolveResult;
    constructor(result: DissolveResult) {
        super("Trockenlauf");
        this.result = result;
    }
}

const METHOD_NAMES: Record<string, string> = { password: "Benutzername und Passwort", discord: "Discord" };

function describeCounts(counts: DissolveCounts): string {
    const list = (values: readonly string[], none: string): string => (values.length === 0 ? none : values.join(", "));
    return [
        `Anmeldewege ${list(
            counts.methods.map((method) => METHOD_NAMES[method] ?? method),
            "keine",
        )}`,
        `Sitzungen ${String(counts.sessions)}`,
        `Passkeys ${String(counts.passkeys)}`,
        `offene Links ${String(counts.links)}`,
        `Einladungen ${String(counts.invitations)}`,
        `ausgestellte Einladungen und Links zurückgezogen ${String(counts.revokedIssuedInvitations)} und ${String(counts.revokedIssuedLinks)}`,
        `Legacy-Zuordnungen ${String(counts.legacyMappings)}`,
        `Sonderrechte ${list(counts.revokedCapabilities, "keine")}`,
        `Begründungen von Sonderrechten geschwärzt ${String(counts.capabilityReasons)}`,
        `Zugang entzogen in ${list(counts.environments, "keiner Umgebung")}`,
        `Protokolleinträge geschwärzt ${String(counts.redactedEvents)}`,
        `Medieneinträge geschwärzt ${String(counts.redactedMedia)}`,
        `Kartenprotokoll geschwärzt ${String(counts.redactedMap)}`,
        `„Verantwortlich für“ geleert ${String(counts.responsibility)}`,
        `Kanal-Vorgänge geschwärzt ${String(counts.redactedKanal)}`,
        `Benachrichtigungen gelöscht ${String(counts.benachrichtigungen)}`,
        `Community-Einträge entpersonalisiert ${String(counts.redactedCommunity)}`,
    ].join(" · ");
}

/** Fehlt Migration 0083, 0088 oder 0273 oder ihr Recht, scheitert die ganze Auflösung; die Transaktion ist dann schon zurückgerollt. */
function databaseNotReady(error: unknown): string | undefined {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === "42883") {
        return "Migration 0083, 0088 oder 0273 fehlt (Schwärzen im Protokoll, in den Medien und im Kartenprotokoll: avesmaps_auth.redact_person_events, public.redact_person_media, public.redact_person_map_operation).";
    }
    if (code === "42501") {
        return "Der Datenbankrolle fehlt ein Recht: auth-grants.psql nach der Migration anwenden (für 0083 das EXECUTE auf avesmaps_auth.redact_person_events; public.redact_person_media aus 0088 und public.redact_person_map_operation aus 0273 bekommt die App-Rolle über die Default-Privilegien).";
    }
    return undefined;
}

/**
 * `aufloesen`: ohne Bestätigung ein Trockenlauf in einer Transaktion, die zurückrollt (dieselben Schritte, dieselben Zahlen,
 * dieselbe Prüfung auf den letzten Betreiber); mit `--bestaetigung "<Anzeigename>"` wirksam. Ein schon aufgelöstes Konto braucht
 * keine Bestätigung mehr: Es trägt nur noch den Platzhalter, und die Wiederholung entfernt höchstens Reste.
 */
async function dissolveCommand(database: Database, input: DissolveInput, io: CliIo): Promise<number> {
    let result: DissolveResult;
    try {
        result = await database.begin(async (tx) => {
            const outcome = await dissolvePerson(tx, input);
            if (input.expectName === undefined && !outcome.alreadyDeparted) throw new DryRun(outcome);
            return outcome;
        });
    } catch (error) {
        if (error instanceof DryRun) {
            const { previousName, personId, counts } = error.result;
            io.out(`Trockenlauf, nichts geändert. Auflösen würde das Konto „${previousName}“ (Kennung ${personId}):`);
            io.out(describeCounts(counts));
            io.err(`Zum Auflösen denselben Befehl mit --bestaetigung "${previousName}" wiederholen.`);
            return 2;
        }
        if (error instanceof DissolveRefused) {
            io.err(error.message);
            return error.code === "confirmation" ? 2 : 1;
        }
        const missing = databaseNotReady(error);
        if (missing !== undefined) {
            io.err(`${missing} Nichts geändert.`);
            return 1;
        }
        throw error;
    }
    if (result.alreadyDeparted) {
        io.out(
            result.changed
                ? `„${result.displayName}“ (Kennung ${result.personId}) war schon aufgelöst; Reste entfernt: ${describeCounts(result.counts)}`
                : `„${result.displayName}“ (Kennung ${result.personId}) ist schon aufgelöst. Nichts mehr zu tun.`,
        );
        return 0;
    }
    io.out(
        `Konto „${result.previousName}“ aufgelöst. Es heißt jetzt „${result.displayName}“ (Kennung ${result.personId}).`,
    );
    io.out(`Entfernt: ${describeCounts(result.counts)}`);
    io.out(
        "Das Protokoll bleibt, Freitext darin zur Person ist geschwärzt; der Eintrag „Konto aufgelöst“ nennt keinen Namen.",
    );
    return 0;
}

function linkFor(origin: string, kind: AccessLinkKind, token: string): string {
    return `${origin}${ACCESS_LINK_PATH[kind]}#${token}`;
}

export async function runAuthCli(
    argv: readonly string[],
    environment: NodeJS.ProcessEnv,
    io: CliIo,
    deps: CliDeps = {},
): Promise<number> {
    const [command, ...rest] = argv;
    if (command === undefined || command === "--help" || command === "hilfe") {
        io.out(USAGE);
        return command === undefined ? 2 : 0;
    }
    const { values } = parseArgs({
        args: [...rest],
        options: {
            name: { type: "string" },
            benutzer: { type: "string" },
            person: { type: "string" },
            discord: { type: "string" },
            rolle: { type: "string" },
            grund: { type: "string" },
            bestaetigung: { type: "string" },
            art: { type: "string" },
            quelle: { type: "string" },
            fassung: { type: "string" },
            eingabe: { type: "string" },
        },
        strict: true,
    });
    const config = loadAuthConfig(environment);
    const env: AuthEnvironment | undefined = config.environment;
    if (env === undefined) {
        io.err("AVESMAPS_ENV fehlt: Die Anmeldung ist auf dieser Instanz nicht eingerichtet.");
        return 2;
    }
    const origin = config.publicOrigin ?? "http://localhost:5173";
    const actorLabel = `cli:${deps.systemUser ?? userInfo().username}`;
    const databaseUrl = environment["DATABASE_URL"];
    if (deps.database === undefined && databaseUrl === undefined) {
        io.err("DATABASE_URL fehlt.");
        return 2;
    }
    const database = deps.database ?? createDatabase(databaseUrl!, { max: 1 });
    try {
        if (isSystemCommand(command)) {
            return await runSystemCommand(command, {
                database,
                environment: env,
                actorLabel,
                io,
                art: values.art,
                grund: values.grund,
                quelle: values.quelle,
                abgleiche: abgleicheModes(environment),
                fassung: values.fassung,
                eingabe: values.eingabe,
                tileRoot: environment["TILE_ROOT"],
                hoehenmodell: hoehenmodellProfil(environment),
                queueStandFile: environment["QUEUE_STAND_FILE"],
            });
        }
        const loginName = values.benutzer;
        if (command === "einrichten") {
            const name = values.name?.trim();
            const role: Role = values.rolle === undefined ? "operator" : isRole(values.rolle) ? values.rolle : "tester";
            if (
                name === undefined ||
                name === "" ||
                loginName === undefined ||
                !validLoginName(normalizeLoginName(loginName))
            ) {
                io.err("einrichten braucht --name und einen gültigen --benutzer (3 bis 40 Zeichen).");
                return 2;
            }
            if (values.rolle !== undefined && !isRole(values.rolle)) {
                io.err(`Unbekannte Rolle: ${values.rolle}`);
                return 2;
            }
            const link = await database.begin(async (tx) => {
                const [person] = await tx<{ id: string }[]>`
                    INSERT INTO avesmaps_auth.person (display_name, created_via) VALUES (${name}, 'cli') RETURNING id
                `;
                const personId = person!.id;
                await tx`
                    INSERT INTO avesmaps_auth.person_access (person_id, environment, role) VALUES (${personId}, ${env}, ${role})
                `;
                const created = await createAccessLink(tx, {
                    kind: "password_reset",
                    personId,
                    createdByCli: actorLabel,
                });
                await recordEvent(tx, {
                    environment: env,
                    action: "access_link.created",
                    actorKind: "cli",
                    actorLabel,
                    targetPersonId: personId,
                    details: { kind: "password_reset", validHours: 24 },
                });
                return created;
            });
            io.out(
                `Konto „${name}“ (${role}) angelegt. Der Benutzername ${normalizeLoginName(loginName)} entsteht mit dem Passwort.`,
            );
            io.out(`Einmaliger Link (24 Stunden): ${linkFor(origin, "password_reset", link.token)}`);
            io.out(`Beim Öffnen den Benutzernamen ${normalizeLoginName(loginName)} eintragen.`);
            return 0;
        }

        if (loginName === undefined && values.person === undefined && values.discord === undefined) {
            io.err(`${command} braucht --benutzer, --person <Kennung> oder --discord <ID>.`);
            return 2;
        }
        const person =
            values.person !== undefined
                ? await findPersonById(database, values.person)
                : values.discord !== undefined
                  ? await findPersonByDiscord(database, values.discord)
                  : await findPerson(database, loginName!);
        if (person === undefined) {
            const by =
                values.person !== undefined
                    ? "dieser Kennung"
                    : values.discord !== undefined
                      ? "dieser Discord-ID"
                      : "diesem Benutzernamen";
            io.err(`Keine Person mit ${by}.`);
            if (command === "aufloesen" && values.person === undefined) {
                io.err(
                    "Ein aufgelöstes Konto hat weder Benutzernamen noch Discord-ID mehr; nachsehen mit --person <Kennung>.",
                );
            }
            return 1;
        }

        if (command === "aufloesen") {
            return await dissolveCommand(
                database,
                { personId: person.id, environment: env, actorLabel, expectName: values.bestaetigung },
                io,
            );
        }

        const kinds: Record<string, AccessLinkKind> = {
            ruecksetzlink: "password_reset",
            notzugang: "recovery",
            "passkey-link": "passkey_enrollment",
        };
        const kind = kinds[command];
        if (kind !== undefined) {
            const link = await database.begin(async (tx) => {
                const created = await createAccessLink(tx, { kind, personId: person.id, createdByCli: actorLabel });
                await recordEvent(tx, {
                    environment: env,
                    action: "access_link.created",
                    actorKind: "cli",
                    actorLabel,
                    targetPersonId: person.id,
                    details: { kind, validHours: kind === "recovery" ? 1 : 24 },
                });
                return created;
            });
            io.out(`Einmaliger Link für ${person.display_name} (gültig bis ${link.expiresAt.toISOString()}):`);
            io.out(linkFor(origin, kind, link.token));
            return 0;
        }

        if (command === "sperren" || command === "entsperren") {
            const reason = values.grund?.trim();
            if (command === "sperren" && (reason === undefined || reason === "")) {
                io.err("sperren braucht --grund.");
                return 2;
            }
            await database.begin(async (tx) => {
                if (command === "sperren") {
                    await tx`
                        UPDATE avesmaps_auth.person SET status = 'locked', locked_at = now(), lock_reason = ${reason ?? null}
                         WHERE id = ${person.id}
                    `;
                    const ended = await revokePersonSessions(tx, person.id, null, "locked");
                    const issued = await revokePersonIssued(tx, person.id, null);
                    await recordEvent(tx, {
                        environment: env,
                        action: "person.locked",
                        actorKind: "cli",
                        actorLabel,
                        targetPersonId: person.id,
                        details: { reason, sessions: ended.length, ...issued },
                    });
                } else {
                    await tx`
                        UPDATE avesmaps_auth.person SET status = 'active', locked_at = NULL, locked_by = NULL, lock_reason = NULL
                         WHERE id = ${person.id} AND status = 'locked'
                    `;
                    await recordEvent(tx, {
                        environment: env,
                        action: "person.unlocked",
                        actorKind: "cli",
                        actorLabel,
                        targetPersonId: person.id,
                    });
                }
            });
            io.out(`${person.display_name}: ${command === "sperren" ? "gesperrt" : "entsperrt"}.`);
            return 0;
        }

        if (command === "sitzungen-beenden") {
            const ended = await database.begin(async (tx) => {
                const ids = await revokePersonSessions(tx, person.id, null, "cli");
                await recordEvent(tx, {
                    environment: env,
                    action: "session.revoked",
                    actorKind: "cli",
                    actorLabel,
                    targetPersonId: person.id,
                    details: { reason: "cli", count: ids.length },
                });
                return ids.length;
            });
            io.out(`${person.display_name}: ${String(ended)} Sitzung(en) beendet.`);
            return 0;
        }

        io.err(`Unbekannter Befehl: ${command}\n\n${USAGE}`);
        return 2;
    } finally {
        if (deps.database === undefined) await database.end({ timeout: 5 });
    }
}
