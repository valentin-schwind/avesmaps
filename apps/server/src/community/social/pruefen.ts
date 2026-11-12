import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { parseArgs } from "node:util";
import { mastodonRegel, zaehleKanal, type MastodonGrenzen, type ZaehlRegel, ZAEHLREGELN } from "@avesmaps3d/shared";
import { recordEvent } from "../../auth/audit.ts";
import type { CliIo } from "../../auth/cli-commands.ts";
import { loadAuthConfig } from "../../auth/config.ts";
import { createDatabase, type Database } from "../../database.ts";
import type { InstagramAblage } from "./instagram-ableitung.ts";
import { leseMastodonZugang } from "./kanaele/konfiguration.ts";
import { MastodonFehler, leseGrenzen, nimmZurueck, sende, type MastodonDeps } from "./kanaele/mastodon.ts";
import type { GraphDeps } from "./kanaele/meta-graph.ts";
import { speichereGrenzen } from "./kanaele/stand.ts";
import { runDiscordPruefen } from "./pruefen-discord.ts";
import { runMetaPruefen } from "./pruefen-meta.ts";

/**
 * Der Lauf von `social:pruefen` (WI-0268 C12a; Fachkonzept §15.7, Recherche `project-control/discovery/social-zeichengrenzen-2026-10-31.md` §4 und §5): die Zählregel eines Kanals am konfigurierten Konto prüfen, bevor der
 * Kanal im Hub freigeschaltet wird. Der Einstieg ist `pruefen-cli.ts`; hier liegt, was sich ohne Prozess prüfen lässt.
 *
 * - 🔴 **Ohne `--anwenden` kein Netz und kein Schreibzugriff:** Das Werkzeug zählt die Prüffälle mit der Regel des Hubs, vergleicht sie mit den Werten der Recherche und zeigt, welche Beiträge es schicken würde.
 * - 🔴 **Mit `--anwenden`** ist `--operator-said "<Zitat>"` Pflicht (der persönliche, scope-genaue Zuruf des Betreibers für genau diese Umgebung und dieses Konto); fehlt er, bricht das Werkzeug ab, bevor es Datei,
 *   Netz oder Datenbank anfasst. Das konfigurierte Konto (`COMMUNITY_SOCIAL_MASTODON_*`) bekommt Beiträge, auch wenn das Werkzeug sie sofort wieder löscht (ein Testkonto, wenn es eines gibt, sonst das öffentliche).
 * - **Was geprüft wird:** Zuerst liest es die Grenzen der Instanz und trägt sie ein. Dann schickt es zu jedem Prüffall zwei Beiträge: einen, der nach der Zählregel GENAU an der Grenze liegt (die Instanz muss ihn
 *   annehmen), und einen mit einem Zeichen mehr (die Instanz muss ihn mit 422 ablehnen). Sichtbarkeit `private`, keine echte Erwähnung, keine Adresse außer `example.org`. Jeder angenommene Beitrag wird in jedem Fall wieder
 *   gelöscht; was nicht zu löschen war, nennt die Ausgabe mit der Kennung (`Bitte von Hand löschen`).
 * - **Zu großzügig ist ein Fehler, zu streng nur ärgerlich:** Nimmt die Instanz den Beitrag an der Grenze NICHT an, zählt der Hub zu wenig (gefährlich: ein Beitrag würde öffentlich scheitern); nimmt sie den mit einem
 *   Zeichen mehr an, zählt der Hub zu viel (harmlos, aber zu streng). Freigeschaltet wird nur bei voller Übereinstimmung.
 * - **Ergebnis:** Die Ausgabe enthält einen Block zum Einfügen in die Tafel der Recherche (§5, mit Datum); die Datenbank bekommt `social_kanal_pruefung_eintragen` (bei Übereinstimmung `freigeschaltet_at`), das
 *   Protokoll `system.social_kanal_geprueft` (nur Zahlen, nie ein Text).
 */

export const USAGE =
    'usage: social:pruefen --kanal mastodon|facebook|instagram|discord [--bild <https-Adresse eines Testbilds; Instagram: ein JPEG, oder die .webp-Adresse eines Mediums dieser Umgebung (dann geht dessen JPEG-Fassung hinaus)>] [--testkonto-bestaetigt] [--anwenden --operator-said "<Zitat des Betreibers>"]';

/** Ein Prüffall der Recherche §4. `mastodon` ist die erwartete Zählung nach der Quelle von Mastodon. */
export interface Pruefall {
    readonly id: string;
    readonly name: string;
    readonly text: string;
    readonly mastodon: number;
}

/**
 * Die Prüffälle der Recherche §4 für Mastodon. Zwei Abweichungen von der Tafel, beide, damit der Test niemanden erreicht: die Erwähnung zeigt auf `beispiel.invalid` (keine echte Instanz, kein echtes Konto,
 * zählt als `@vali` = 5 wie `@vali@rollenspiel.social`) und die lange Adresse zeigt auf `example.org` (80 Zeichen, zählt 23).
 */
export const PRUEFFAELLE: readonly Pruefall[] = [
    { id: "umlaute", name: "Umlaute", text: "Größe", mastodon: 5 },
    { id: "hautton", name: "Emoji mit Hautton", text: "\u{1F44D}\u{1F3FD}", mastodon: 1 },
    { id: "familie", name: "Familie (ZWJ)", text: "\u{1F468}‍\u{1F469}‍\u{1F467}", mastodon: 1 },
    { id: "flagge", name: "Flagge", text: "\u{1F1E9}\u{1F1EA}", mastodon: 1 },
    { id: "crlf", name: "Zeilenumbruch Windows", text: "a\r\nb", mastodon: 3 },
    { id: "adresse", name: "Lange Adresse", text: `https://example.org/${"a".repeat(60)}`, mastodon: 23 },
    { id: "adresse-ohne", name: "Adresse ohne Protokoll", text: "avesmaps.de/karte", mastodon: 17 },
    { id: "erwaehnung", name: "Erwähnung fremder Instanz", text: "@vali@beispiel.invalid", mastodon: 5 },
    { id: "hashtag", name: "Hashtag mit Umlaut", text: "#Über", mastodon: 5 },
];

export interface Probe {
    readonly fall: Pruefall;
    /** Der Beitrag, der nach der Zählregel genau an der Grenze liegt. */
    readonly grenze: string;
    /** Derselbe mit einem Zeichen mehr. */
    readonly darueber: string;
}

/** Zählt einen Text wie der Hub für den Kanal der Regel (Mastodon, Facebook, Instagram). */
export const zaehle = (text: string, regel: ZaehlRegel): number =>
    zaehleKanal(regel.id, { text, hashtags: [] }, { [regel.id]: regel }).n;

/**
 * Baut die Proben zu einer Regel: `<Prüffall>\\n<Füllzeichen>`, bis die Zählung der Regel genau die Grenze (bzw. eins mehr) erreicht. Der Zeilenumbruch trennt den Prüffall vom Füllwerk, sodass weder Adresse noch
 * Erwähnung noch Hashtag mit ihm verschmelzen.
 */
export function baueProben(regel: ZaehlRegel, faelle: readonly Pruefall[] = PRUEFFAELLE): Probe[] {
    return faelle.map((fall) => {
        const kopf = `${fall.text}\n`;
        const frei = regel.grenze - zaehle(kopf, regel);
        if (frei < 1) throw new Error(`Der Prüffall ${fall.id} füllt die Grenze schon aus`);
        return { fall, grenze: kopf + "a".repeat(frei), darueber: kopf + "a".repeat(frei + 1) };
    });
}

/** Was die Zählung für einen Prüffall ergeben muss: die Werte der Recherche; nur die lange Adresse zählt so viel, wie die Instanz je Adresse reserviert. */
export const erwartet = (fall: Pruefall, regel: ZaehlRegel): number =>
    fall.id === "adresse" ? (regel.adresse ?? fall.mastodon) : fall.mastodon;

/** Stimmt die Zählung des Hubs für die Prüffälle mit den Werten der Recherche überein? (Die Selbstprüfung vor jedem Netz.) */
export function selbstpruefung(regel: ZaehlRegel): { fall: Pruefall; n: number; soll: number; ok: boolean }[] {
    return PRUEFFAELLE.map((fall) => {
        const n = zaehle(fall.text, regel);
        const soll = erwartet(fall, regel);
        return { fall, n, soll, ok: n === soll };
    });
}

export interface ProbenErgebnis {
    readonly fall: Pruefall;
    /** Was der Hub zählt. */
    readonly n: number;
    /** Hat die Instanz den Beitrag an der Grenze angenommen? */
    readonly grenzeAngenommen: boolean;
    /** Hat sie den Beitrag mit einem Zeichen mehr abgelehnt? */
    readonly darueberAbgelehnt: boolean;
    /** Passt beides zur Zählung des Hubs? */
    readonly ok: boolean;
}

const wort = (ja: boolean): string => (ja ? "ja" : "nein");

/** Der Block zum Einfügen in die Tafel der Recherche (§5), mit Datum. */
export function tafelText(
    ergebnisse: readonly ProbenErgebnis[],
    kopf: { datum: string; grenzen: MastodonGrenzen; freigeschaltet: boolean },
): string {
    const zeilen = [
        `**Prüfung Mastodon ${kopf.datum}** (Testkonto, Grenzen der Instanz: ${String(kopf.grenzen.zeichen)} Zeichen, Adresse zählt ${String(kopf.grenzen.adresse)}; ${
            kopf.freigeschaltet ? "alle Fälle stimmen, Kanal freigeschaltet" : "NICHT freigeschaltet"
        })`,
        "",
        "| Fall | Hub zählt | an der Grenze angenommen | eins darüber abgelehnt | stimmt |",
        "|---|---|---|---|---|",
        ...ergebnisse.map(
            (e) =>
                `| ${e.fall.name} | ${String(e.n)} | ${wort(e.grenzeAngenommen)} | ${wort(e.darueberAbgelehnt)} | ${wort(e.ok)} |`,
        ),
    ];
    return zeilen.join("\n");
}

export interface PruefenDeps extends MastodonDeps, GraphDeps {
    /** Die Medienablage für die JPEG-Fassung des Instagram-Testbilds (Tests); sonst `MEDIA_ROOT`. */
    ablage?: InstagramAblage | undefined;
    /** Eine fertige Verbindung (Tests); sonst `DATABASE_URL`. */
    database?: Database | undefined;
    /** Der Systembenutzer für Marke und Protokoll (Tests); sonst der angemeldete. */
    systemUser?: string | undefined;
    /** Der Tag der Prüfung (Tests). */
    heute?: (() => string) | undefined;
}

/** Fehlertext aus einem Fehler der Instanz oder der Datenbank, ohne Einzelheiten. */
const grundVon = (fehler: unknown): string =>
    fehler instanceof MastodonFehler
        ? fehler.message
        : `Fehler (${String((fehler as { code?: unknown }).code ?? "unbekannt")})`;

/**
 * Der Lauf. Rückgabe: 0 in Ordnung (Trockenlauf: Zählung stimmt; Anwenden: alle Fälle stimmen, Kanal freigeschaltet), 1 Abweichung oder Fehler, 2 falscher Aufruf (auch: `--anwenden` ohne Zitat).
 */
export async function runSocialPruefen(
    argv: readonly string[],
    environment: NodeJS.ProcessEnv,
    io: CliIo,
    deps: PruefenDeps = {},
): Promise<number> {
    let werte;
    try {
        werte = parseArgs({
            args: [...argv],
            options: {
                kanal: { type: "string" },
                anwenden: { type: "boolean", default: false },
                "operator-said": { type: "string" },
                bild: { type: "string" },
                "testkonto-bestaetigt": { type: "boolean", default: false },
            },
            strict: true,
        }).values;
    } catch (error) {
        io.err(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
        return 2;
    }
    if (
        werte.kanal !== "mastodon" &&
        werte.kanal !== "facebook" &&
        werte.kanal !== "instagram" &&
        werte.kanal !== "discord"
    ) {
        io.err(
            `--kanal mastodon, facebook, instagram oder discord sind die Wahl (jeder Kanal wird für sich geprüft).\n${USAGE}`,
        );
        return 2;
    }
    const anwenden = werte.anwenden === true;
    const zitat = werte["operator-said"]?.trim();
    if (werte.kanal === "discord") {
        if (werte.bild !== undefined || werte["testkonto-bestaetigt"] === true) {
            io.err(`--bild und --testkonto-bestaetigt gelten nur für Facebook und Instagram.\n${USAGE}`);
            return 2;
        }
        // Discord: eigener Ablauf (`pruefen-discord.ts`), derselbe Zuruf des Betreibers, aber nichts geht in den Kanal.
        return runDiscordPruefen({ anwenden, zitat }, environment, io, deps);
    }
    if (werte.kanal !== "mastodon") {
        // Meta: eigener Ablauf (`pruefen-meta.ts`), dieselben Prüffälle, derselbe Zuruf des Betreibers.
        return runMetaPruefen(
            werte.kanal,
            {
                anwenden,
                zitat,
                bild: werte.bild?.trim(),
                testkontoBestaetigt: werte["testkonto-bestaetigt"] === true,
            },
            environment,
            io,
            deps,
        );
    }
    if (werte.bild !== undefined || werte["testkonto-bestaetigt"] === true) {
        io.err(`--bild und --testkonto-bestaetigt gelten nur für Facebook und Instagram.\n${USAGE}`);
        return 2;
    }
    // 🔴 Vor allem anderen: Wer sendet und schreibt, braucht den Zuruf des Betreibers.
    if (anwenden && (zitat === undefined || zitat === "")) {
        io.err(
            `--anwenden schickt Beiträge an das konfigurierte Konto und schreibt in die Datenbank. Es braucht den Zuruf des Betreibers für genau diese Umgebung: --operator-said "<Zitat>". Nichts geschickt, nichts geschrieben.\n${USAGE}`,
        );
        return 2;
    }

    // --- Trockenlauf: nur die eigene Zählung, ohne Netz --------------------------------------------------------------------------
    if (!anwenden) {
        io.out("PROBELAUF - ohne --anwenden kein Netz und kein Schreibzugriff");
        if (zitat !== undefined && zitat !== "")
            io.out("Hinweis: --operator-said gilt nur mit --anwenden; dies ist ein Probelauf.");
        const regel = ZAEHLREGELN.mastodon;
        io.out(
            `Zählregel (Vorgabe, nicht die der Instanz)  ${String(regel.grenze)} Zeichen, Adresse zählt ${String(regel.adresse ?? 0)}`,
        );
        let abweichung = 0;
        for (const { fall, n, ok } of selbstpruefung(regel)) {
            io.out(
                `${fall.name.padEnd(30)} Hub zählt ${String(n).padStart(3)}, Recherche ${String(fall.mastodon).padStart(3)}  ${ok ? "ok" : "ABWEICHUNG"}`,
            );
            if (!ok) abweichung += 1;
        }
        for (const probe of baueProben(regel)) {
            io.out(
                `${probe.fall.name.padEnd(30)} würde schicken: ${String(zaehle(probe.grenze, regel))} (angenommen erwartet) und ${String(zaehle(probe.darueber, regel))} (abgelehnt erwartet), Sichtbarkeit private`,
            );
        }
        io.out(
            abweichung === 0
                ? "Die Zählung des Hubs stimmt mit der Recherche überein."
                : `${String(abweichung)} Prüffälle weichen von der Recherche ab.`,
        );
        return abweichung === 0 ? 0 : 1;
    }

    // --- Anwenden ------------------------------------------------------------------------------------------------------------------
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
        io.err("AVESMAPS_ENV fehlt: Ohne benannte Umgebung gibt es kein Protokoll, also wird nichts geschickt.");
        return 2;
    }
    const zugang = leseMastodonZugang(environment);
    if (zugang === undefined) {
        io.err(
            "COMMUNITY_SOCIAL_MASTODON_URL und COMMUNITY_SOCIAL_MASTODON_TOKEN fehlen oder sind unbrauchbar: In dieser Umgebung gibt es den Kanal nicht. Nichts geschickt.",
        );
        return 1;
    }
    const heute = (deps.heute ?? (() => new Date().toISOString().slice(0, 10)))();
    const marke = `cli:${deps.systemUser ?? userInfo().username}`;
    const database = deps.database ?? createDatabase(databaseUrl!, { max: 2 });
    const zuLoeschen: string[] = [];
    try {
        io.out(`Freigabe (Betreiberzitat): „${zitat}“`);
        io.out(
            "Das konfigurierte Konto bekommt jetzt Testbeiträge (private, nur für Follower sichtbar, sofort wieder gelöscht).",
        );

        // 1. Die Grenzen der Instanz lesen und eintragen: Geprüft wird die Regel, die die Zählung später wirklich nimmt.
        let grenzen: MastodonGrenzen;
        try {
            grenzen = await leseGrenzen(zugang, deps);
            await speichereGrenzen(database, "mastodon", grenzen);
        } catch (fehler) {
            io.err(`Die Grenzen der Instanz sind nicht lesbar: ${grundVon(fehler)}. Nichts geschickt.`);
            return 1;
        }
        const regel = mastodonRegel(grenzen, heute);
        io.out(
            `Grenzen der Instanz            ${String(grenzen.zeichen)} Zeichen, Adresse zählt ${String(grenzen.adresse)}`,
        );

        // 2. Die eigene Zählung gegen die Recherche: Stimmt schon sie nicht, wird nichts geschickt.
        const selbst = selbstpruefung(regel).filter((s) => !s.ok);
        if (selbst.length > 0) {
            for (const s of selbst)
                io.err(`Hub zählt ${s.fall.name} mit ${String(s.n)}, erwartet sind ${String(s.soll)}.`);
            io.err("Die Zählung des Hubs weicht von der Recherche ab. Nichts geschickt.");
            return 1;
        }

        // 3. Die Proben: genau an der Grenze (muss durch), eins darüber (muss abgelehnt werden).
        const ergebnisse: ProbenErgebnis[] = [];
        for (const probe of baueProben(regel)) {
            let grenzeAngenommen = false;
            let darueberAbgelehnt = false;
            try {
                const gesendet = await sende(
                    zugang,
                    { text: probe.grenze, idempotenz: randomUUID(), sichtbarkeit: "private" },
                    deps,
                );
                zuLoeschen.push(gesendet.id);
                grenzeAngenommen = true;
            } catch (fehler) {
                if (!(fehler instanceof MastodonFehler) || fehler.status !== 422) throw fehler;
            }
            try {
                const gesendet = await sende(
                    zugang,
                    { text: probe.darueber, idempotenz: randomUUID(), sichtbarkeit: "private" },
                    deps,
                );
                zuLoeschen.push(gesendet.id);
            } catch (fehler) {
                if (!(fehler instanceof MastodonFehler) || fehler.status !== 422) throw fehler;
                darueberAbgelehnt = true;
            }
            const nGrenze = zaehle(probe.grenze, regel);
            ergebnisse.push({
                fall: probe.fall,
                n: zaehle(probe.fall.text, regel),
                grenzeAngenommen,
                darueberAbgelehnt,
                ok: grenzeAngenommen && darueberAbgelehnt && nGrenze === regel.grenze,
            });
        }

        // 4. Aufräumen, in jedem Fall: Die angenommenen Testbeiträge werden gelöscht.
        const bleibt = await loescheAlle(zugang, zuLoeschen, deps);
        zuLoeschen.length = 0;
        if (bleibt.length > 0) io.err(`Bitte von Hand löschen (Kennung bei der Instanz): ${bleibt.join(", ")}`);

        const stimmt = ergebnisse.every((e) => e.ok);
        for (const e of ergebnisse) {
            const zu = !e.grenzeAngenommen
                ? "ZU GROSSZÜGIG (die Instanz nimmt den Beitrag an der Grenze nicht an)"
                : !e.darueberAbgelehnt
                  ? "zu streng (die Instanz nimmt eins mehr an)"
                  : "ok";
            io.out(
                `${e.fall.name.padEnd(30)} Hub zählt ${String(e.n).padStart(3)}  an der Grenze ${wort(e.grenzeAngenommen).padEnd(4)} eins darüber abgelehnt ${wort(e.darueberAbgelehnt).padEnd(4)}  ${zu}`,
            );
        }
        const kopf = { datum: heute, grenzen, freigeschaltet: stimmt && bleibt.length === 0 };
        io.out("");
        io.out("Text zum Einfügen in die Tafel der Recherche (§5):");
        io.out(tafelText(ergebnisse, kopf));
        io.out("");

        // 5. Eintragen: bei voller Übereinstimmung freigeschaltet, sonst gesperrt; dazu das Protokoll.
        try {
            await database`
                SELECT avesmaps_community.social_kanal_pruefung_eintragen(
                    'mastodon', ${marke}, ${kopf.freigeschaltet},
                    ${database.json({ datum: heute, faelle: ergebnisse.length, uebereinstimmend: ergebnisse.filter((e) => e.ok).length })}::jsonb
                )
            `;
            await database.begin((tx) =>
                recordEvent(tx, {
                    environment: umgebung,
                    action: "system.social_kanal_geprueft",
                    actorKind: "cli",
                    actorLabel: marke,
                    targetRef: "kanal:mastodon",
                    details: {
                        kanal: "mastodon",
                        faelle: ergebnisse.length,
                        uebereinstimmend: ergebnisse.filter((e) => e.ok).length,
                        freigeschaltet: kopf.freigeschaltet,
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
        io.out(
            kopf.freigeschaltet
                ? "Der Kanal Mastodon ist freigeschaltet (alle Fälle stimmen)."
                : "Der Kanal Mastodon bleibt GESPERRT: Nicht alle Fälle stimmen oder ein Testbeitrag blieb stehen.",
        );
        return kopf.freigeschaltet ? 0 : 1;
    } catch (fehler) {
        // Ein Abbruch mitten in den Proben: erst aufräumen, dann berichten.
        const bleibt = await loescheAlle(zugang, zuLoeschen, deps);
        if (bleibt.length > 0) io.err(`Bitte von Hand löschen (Kennung bei der Instanz): ${bleibt.join(", ")}`);
        io.err(`Abbruch: ${grundVon(fehler)}. Der Kanal bleibt, wie er war.`);
        return 1;
    } finally {
        if (deps.database === undefined) await database.end({ timeout: 5 });
    }
}

/** Löscht die Testbeiträge; gibt die Kennungen zurück, die nicht zu löschen waren. */
async function loescheAlle(
    zugang: NonNullable<ReturnType<typeof leseMastodonZugang>>,
    ids: readonly string[],
    deps: MastodonDeps,
): Promise<string[]> {
    const bleibt: string[] = [];
    for (const id of ids) {
        try {
            await nimmZurueck(zugang, id, deps);
        } catch {
            bleibt.push(id);
        }
    }
    return bleibt;
}
