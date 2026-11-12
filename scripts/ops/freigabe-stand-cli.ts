import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
    FREIGABE_NACHWEISE,
    freigabeDateiFehler,
    GRUNDLAGE,
    themaVon,
    type FreigabeDatei,
    type FreigabeMarke,
    type FreigabeNachweis,
    type FreigabeThema,
} from "@avesmaps3d/shared";
import { bereinigeZeile, entscheideAusRepo } from "../dev/release-freigabe.ts";

/**
 * Rechnet, was auf der Stage liegt und noch nicht in Production ist, und schreibt es als Datei (FREIGABE-0001 §1.4, F2).
 *
 * 🔴 **Warum eine Datei und keine Abfrage:** Der Server kennt kein Git und hat keinen Zugang zu Production. Er soll auch keinen
 * bekommen — er zeigt nur, was dasteht. Dasselbe Muster trägt schon die Sicherung (`BACKUP_STATUS_FILE`) und den Systemzustand.
 *
 * Läuft bei Claudio im Takt und nach jedem Stage-Ausrollen; `FREIGABE_STATUS_FILE` sagt dem Server, wo die Datei liegt.
 *
 *   npm run freigabe:stand -- --production <commit> --stage <commit> --out <datei>
 *   npm run freigabe:stand -- --production 878c244 --stage e2f28dd --stage-gruen --out /srv/.../freigabe.json
 *
 * Ohne `--out` geht die Datei nach stdout (zum Ansehen). `--stage-gruen` setzt, dass die Proben grün waren; ohne die Angabe
 * steht „nicht feststellbar“, und der Weg nach Production bleibt zu. `--stage-rot` setzt „geprüft und rot“ (`stageGruen: false`), etwa
 * wenn der Sammellauf nach dem Push den Stage-Stand rot gemeldet hat (Betreiber 2026-10-18 „A, ab jetzt immer“: nach Production nur ein
 * Stand mit grünem Sammellauf; die Notiz `refs/notes/sammellauf` liest Claudios `freigabe-stand.sh`). Rot gewinnt über grün.
 *
 * `--nachts` (WI-0234, „Für Production freigeben, nachts ausliefern“) sagt dem Server, dass Claudios Probe, Nachtlauf und Abholer die
 * Art `nacht` kennen; erst dann gibt der Knopf nur frei, statt sofort zu schieben. Eine offene Nacht-Freigabe gibt `freigabe-stand.sh` mit,
 * damit das Fenster ihren Prüfstand zeigt:
 *   --freigabe-ops OPS-000123 --freigabe-commit <sha> --freigabe-release <release> [--freigabe-pruefung "<Satz>"]
 * Alle drei Pflichtwerte oder keiner; ein Wert, den der Vertrag nicht zulässt, bricht ab (Exit 2), statt eine Datei zu schreiben, die der
 * Server als unlesbar verwirft.
 *
 * `--proben-gruen` und `--nachweis <fehlt|laeuft|gruen|rot>` (WI-0248, Weg nach Production): Im Nachtmodus ist das Freigeben die
 * Kandidatenbenennung. `--proben-gruen` sagt, dass die Stage-Proben für den Stand grün sind (dann gibt der Knopf frei, auch ohne
 * Release-Nachweis); `--nachweis` nennt den Stand des Release-Nachweises (Version 3) für den Stage-Commit, und `rot` hält den Knopf zu.
 * Beide werden nur geschrieben, wenn sie angegeben sind; ohne sie bleibt die Datei bytegleich. Ein anderer Wert für `--nachweis` bricht
 * ab (Exit 2).
 *
 * `--production-seit <ISO>` und `--stage-seit <ISO>` (Claudio 2026-11-01, „seit“ zeigte die Bauzeit): wann `current` der Umgebung umgeschaltet
 * wurde. Ohne die Angabe steht wie bisher die Zeit des Commits da. Eine Zeit, die kein Datum ist, bricht ab (Exit 2).
 *
 * `--release-freigabe [--release-freigabe-satz "<Satz>"]` (WI-0248; Vali 2026-10-26: der Start des Release-Tests ist die Freigabe, die Auslieferung
 * folgt automatisch bei Grün): liest die jüngste Freigabe aus den LOKALEN Notizen von `--repo` (`refs/notes/release-auftrag`,
 * `refs/notes/sammellauf`; vorher holen) mit derselben Regel wie Claudios Abholer (`scripts/dev/release-freigabe.ts`) und schreibt sie als
 * `releaseFreigabe`: wartet, läuft, rot, grün, abgebrochen, und `ausgeliefert`, wenn `--production` genau diesen Stand nennt. Der Satz ist Claudios
 * Zusatz zur Auslieferung („Auslieferung wartet: …“). Ohne die Angabe fehlt das Feld (die Datei bleibt bytegleich).
 */

/** Aus den beiden Angaben das Feld `stageGruen`: rot vor grün, ohne beide „nicht feststellbar“ (`null`). */
export function stageGruenAus(angaben: { gruen: boolean; rot: boolean }): boolean | null {
    if (angaben.rot) return false;
    return angaben.gruen ? true : null;
}

/** Der Release-Nachweis aus der Angabe (WI-0248): einer der vier Werte, sonst ein Fehler mit Satz; ohne Angabe `undefined`. */
export function nachweisAus(wert: string | undefined): FreigabeNachweis | undefined {
    if (wert === undefined) return undefined;
    const gefunden = FREIGABE_NACHWEISE.find((moeglich) => moeglich === wert);
    if (gefunden === undefined)
        throw new Error(`--nachweis kennt nur ${FREIGABE_NACHWEISE.join(", ")}, nicht "${wert}"`);
    return gefunden;
}

/** Die Sätze je Arbeitspaket, wie Besucher sie lesen sollen (FREIGABE-0001 §2a.1): aus der Kurzinfo des Release. */
const SATZ_MUSTER = /^-\s*\[(WI-\d{4})\]\s*(.+)$/u;

function git(args: string[], repo: string): string {
    return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trimEnd();
}

/** Ein Commit mit den Dateien, die er anfasst. */
interface Commit {
    sha: string;
    betreff: string;
    dateien: string[];
}

export function leseCommits(repo: string, von: string, bis: string): Commit[] {
    // Ein Datensatz je Commit: SHA, Betreff, dann die Pfade. `-z` wäre robuster, aber die Trennung über \x1e reicht und bleibt lesbar.
    const roh = git(["log", "--reverse", "--name-only", "--format=%x1e%H%x1f%s", `${von}..${bis}`], repo);
    const commits: Commit[] = [];
    for (const satz of roh.split("\x1e")) {
        if (satz.trim() === "") continue;
        const [kopf = "", ...rest] = satz.split("\n");
        const [sha = "", betreff = ""] = kopf.split("\x1f");
        commits.push({ sha, betreff, dateien: rest.filter((zeile) => zeile.trim() !== "") });
    }
    return commits;
}

/** Die Kurzinfo-Sätze je Paket aus allen Release-Notizen zwischen den beiden Ständen. */
export function leseSaetze(repo: string, bis: string): Map<string, string> {
    const saetze = new Map<string, string>();
    let dateien: string[];
    try {
        dateien = git(["ls-tree", "--name-only", bis, "config/releases/"], repo)
            .split("\n")
            .filter((pfad) => pfad.endsWith(".md"));
    } catch {
        return saetze;
    }
    for (const pfad of dateien) {
        let inhalt: string;
        try {
            inhalt = git(["show", `${bis}:${pfad}`], repo);
        } catch {
            continue;
        }
        for (const zeile of inhalt.split("\n")) {
            const treffer = SATZ_MUSTER.exec(zeile.trim());
            // Der jüngste Satz gewinnt; die Dateien kommen nach Namen, also nach Datum.
            if (treffer !== null) saetze.set(treffer[1]!, treffer[2]!.trim());
        }
    }
    return saetze;
}

/** Die Titel der Arbeitspakete aus ihren Work Items (`# WI-0128: Ortseditor, …` → „Ortseditor“). */
export function leseNamen(repo: string, bis: string): Map<string, string> {
    const namen = new Map<string, string>();
    let dateien: string[];
    try {
        dateien = git(["ls-tree", "--name-only", bis, "project-control/work-items/"], repo).split("\n");
    } catch {
        return namen;
    }
    for (const pfad of dateien) {
        const nummer = /WI-\d{4}/u.exec(pfad)?.[0];
        if (nummer === undefined) continue;
        try {
            const kopf = git(["show", `${bis}:${pfad}`], repo).split("\n")[0] ?? "";
            // 🪤 Die Köpfe schreiben die Nummer mal mit Doppelpunkt, mal mit Gedankenstrich: beides fällt weg.
            const titel = /^#\s*WI-\d{4}\s*[:\u2014\u2013\u00b7-]?\s*(.+)$/u.exec(kopf)?.[1];
            if (titel !== undefined) namen.set(nummer, titel.split(/[,:(]/u)[0]!.trim());
        } catch {
            continue;
        }
    }
    return namen;
}

function marken(dateien: readonly string[]): FreigabeMarke[] {
    const gefunden = new Set<FreigabeMarke>();
    for (const pfad of dateien) {
        if (pfad.startsWith("apps/server/migrations/")) gefunden.add("migration");
        if (pfad.endsWith("-grants.psql")) gefunden.add("rechte");
        if (pfad === "apps/server/src/config.ts") gefunden.add("umgebungswert");
    }
    return [...gefunden];
}

export function rechneThemen(
    commits: readonly Commit[],
    saetze: Map<string, string>,
    namen: Map<string, string>,
): FreigabeThema[] {
    const nach = new Map<string, { commits: Commit[]; dateien: Set<string> }>();
    for (const commit of commits) {
        const thema = themaVon(commit.betreff, commit.dateien);
        if (thema === null) continue;
        const bisher = nach.get(thema) ?? { commits: [], dateien: new Set<string>() };
        bisher.commits.push(commit);
        for (const pfad of commit.dateien) bisher.dateien.add(pfad);
        nach.set(thema, bisher);
    }
    const themen: FreigabeThema[] = [];
    for (const [id, inhalt] of nach) {
        const letzter = inhalt.commits.at(-1)!;
        const satz = saetze.get(id) ?? null;
        themen.push({
            id,
            name: id === GRUNDLAGE ? null : (namen.get(id) ?? null),
            // Ohne redigierten Satz steht der Betreff des jüngsten Commits da — sichtbar als solcher, nicht stillschweigend.
            satz: satz ?? (id === GRUNDLAGE ? null : letzter.betreff),
            unredigiert: satz === null && id !== GRUNDLAGE,
            marken: marken([...inhalt.dateien]),
            anzahl: inhalt.commits.length,
            bis: letzter.sha.slice(0, 7),
        });
    }
    // Die Grundlage zuerst, der Rest nach Umfang: oben steht, was am meisten bewegt.
    return themen.sort((a, b) =>
        a.id === GRUNDLAGE ? -1 : b.id === GRUNDLAGE ? 1 : b.anzahl - a.anzahl || a.id.localeCompare(b.id),
    );
}

function technik(commits: readonly Commit[], repo: string, von: string, bis: string) {
    const dateien = new Set(commits.flatMap((commit) => commit.dateien));
    const migrationen = [...dateien]
        .filter((pfad) => pfad.startsWith("apps/server/migrations/"))
        .map((pfad) => /(\d{4})_/u.exec(pfad)?.[1] ?? pfad)
        .sort();
    const rechte = [...dateien].filter((pfad) => pfad.endsWith("-grants.psql")).map((pfad) => pfad.split("/").pop()!);
    let umgebungswerte: string[];
    try {
        const diff = git(["diff", von, bis, "--", "apps/server/src/config.ts"], repo);
        umgebungswerte = [
            ...new Set(
                diff
                    .split("\n")
                    .filter((zeile) => zeile.startsWith("+"))
                    .flatMap((zeile) =>
                        [...zeile.matchAll(/environment\["([A-Z_]+)"\]/gu)].map((treffer) => treffer[1]!),
                    ),
            ),
        ].sort();
    } catch {
        umgebungswerte = [];
    }
    return { migrationen, rechte: [...new Set(rechte)].sort(), umgebungswerte };
}

export function baueDatei(options: {
    repo: string;
    production: string;
    stage: string;
    stageGruen: boolean | null;
    stagePruefung: string | null;
    freigabe?: NonNullable<FreigabeDatei["freigabe"]> | null;
    nachts?: boolean;
    probenGruen?: boolean;
    nachweis?: FreigabeNachweis | undefined;
    /** WI-0248: die Freigabe aus den Notizen lesen; `satz` ist Claudios Zusatz. */
    releaseFreigabe?: { satz: string | null } | undefined;
    /** Wann `current` umgeschaltet wurde (ISO); ohne die Angabe gilt die Zeit des Commits. */
    seit?: { production?: string | undefined; stage?: string | undefined };
}): FreigabeDatei {
    const { repo, production, stage } = options;
    const voll = (ref: string): string => git(["rev-parse", ref], repo);
    const zeit = (ref: string): string =>
        new Date(Number(git(["log", "-1", "--format=%ct", ref], repo)) * 1000).toISOString();
    const commits = leseCommits(repo, production, stage);
    return {
        schema: 1,
        standAt: new Date().toISOString(),
        production: {
            release: production.slice(0, 7),
            commit: voll(production),
            seit: options.seit?.production ?? zeit(production),
        },
        stage: { release: stage.slice(0, 7), commit: voll(stage), seit: options.seit?.stage ?? zeit(stage) },
        stageGruen: options.stageGruen,
        stagePruefung: options.stagePruefung,
        technik: technik(commits, repo, production, stage),
        themen: rechneThemen(commits, leseSaetze(repo, stage), leseNamen(repo, stage)),
        // Ohne Freigabe fehlt das Feld ganz: Ein älterer Server liest die Datei streng und verwürfe ein unbekanntes Feld („erst erweitern“).
        ...(options.freigabe ? { freigabe: options.freigabe } : {}),
        ...(options.nachts === true ? { nachts: true } : {}),
        // Wie `nachts`: nur mit Angabe, damit die Datei ohne sie bytegleich bleibt und ein älterer Server sie lesen kann (WI-0248).
        ...(options.probenGruen === true ? { probenGruen: true } : {}),
        ...(options.nachweis !== undefined ? { nachweis: options.nachweis } : {}),
        ...(options.releaseFreigabe === undefined
            ? {}
            : { releaseFreigabe: releaseFreigabeAus(repo, voll(production), options.releaseFreigabe.satz) }),
    };
}

/**
 * Die Freigabe aus dem Start des Release-Tests für die Statusdatei (WI-0248): die jüngste aus den lokalen Notizen von `repo`, entschieden wie bei Claudios
 * Abholer; `ausgeliefert`, wenn Production genau diesen Stand trägt. `null`, wenn es keine gibt.
 */
export function releaseFreigabeAus(
    repo: string,
    productionCommit: string,
    satz: string | null,
): NonNullable<FreigabeDatei["releaseFreigabe"]> | null {
    const e = entscheideAusRepo(repo);
    if (e.zustand === "keine" || e.sha === null || e.kennung === null || e.zeit === null) return null;
    const glatt = (text: string, max: number): string => bereinigeZeile(text, max);
    return {
        commit: e.sha,
        kennung: e.kennung,
        von: e.von === null || glatt(e.von, 80) === "" ? null : glatt(e.von, 80),
        seit: e.zeit,
        zustand: productionCommit === e.sha && e.zustand === "gruen" ? "ausgeliefert" : e.zustand,
        grund: glatt(e.grund, 400),
        satz: satz === null || glatt(satz, 200) === "" ? null : glatt(satz, 200),
    };
}

/** Die offene Nacht-Freigabe aus den Angaben (WI-0234): alle drei Pflichtwerte oder keiner, sonst ein Fehler mit Satz. */
export function freigabeAus(werte: {
    ops?: string | undefined;
    commit?: string | undefined;
    release?: string | undefined;
    pruefung?: string | undefined;
}): NonNullable<FreigabeDatei["freigabe"]> | null {
    const pflicht = [werte.ops, werte.commit, werte.release];
    if (pflicht.every((wert) => wert === undefined) && werte.pruefung === undefined) return null;
    if (pflicht.some((wert) => wert === undefined))
        throw new Error("--freigabe-ops, --freigabe-commit und --freigabe-release gehören zusammen");
    return {
        ops: werte.ops as string,
        commit: werte.commit as string,
        release: werte.release as string,
        pruefung: werte.pruefung ?? null,
    };
}

/** Eine Umschaltzeit als ISO-Zeit in UTC; eine Angabe, die kein Datum ist, ist ein Fehler, kein stilles „Bauzeit“. */
export function seitAus(wert: string | undefined): string | undefined {
    if (wert === undefined) return undefined;
    const ms = Date.parse(wert);
    if (!Number.isFinite(ms)) throw new Error(`keine Zeit: ${wert}`);
    return new Date(ms).toISOString();
}

async function main(): Promise<void> {
    const { values } = parseArgs({
        options: {
            repo: { type: "string" },
            production: { type: "string" },
            stage: { type: "string" },
            "stage-gruen": { type: "boolean", default: false },
            "stage-rot": { type: "boolean", default: false },
            "stage-pruefung": { type: "string" },
            nachts: { type: "boolean", default: false },
            "proben-gruen": { type: "boolean", default: false },
            nachweis: { type: "string" },
            "freigabe-ops": { type: "string" },
            "freigabe-commit": { type: "string" },
            "freigabe-release": { type: "string" },
            "freigabe-pruefung": { type: "string" },
            "release-freigabe": { type: "boolean", default: false },
            "release-freigabe-satz": { type: "string" },
            "production-seit": { type: "string" },
            "stage-seit": { type: "string" },
            out: { type: "string" },
        },
    });
    if (values.production === undefined || values.stage === undefined) {
        console.error(
            "Aufruf: node scripts/ops/freigabe-stand.ts --production <commit> --stage <commit> [--out <datei>]",
        );
        process.exit(2);
    }
    let freigabe: ReturnType<typeof freigabeAus>;
    try {
        freigabe = freigabeAus({
            ops: values["freigabe-ops"],
            commit: values["freigabe-commit"],
            release: values["freigabe-release"],
            pruefung: values["freigabe-pruefung"],
        });
    } catch (error) {
        console.error(`freigabe:stand: ${(error as Error).message}`);
        process.exit(2);
    }
    // 🪤 Claudios `freigabe-stand.sh` erkennt per grep, ob dieses Werkzeug die Angaben kennt: nach den Zeichenketten "proben-gruen" und
    // "nachweis". Prettier schreibt einen Schlüssel `nachweis:` ohne Anführungszeichen, darum steht der Zugriff hier in Klammern.
    let nachweis: FreigabeNachweis | undefined;
    try {
        nachweis = nachweisAus(values["nachweis"]);
    } catch (error) {
        console.error(`freigabe:stand: ${(error as Error).message}`);
        process.exit(2);
    }
    let seit: { production?: string | undefined; stage?: string | undefined };
    try {
        seit = { production: seitAus(values["production-seit"]), stage: seitAus(values["stage-seit"]) };
    } catch (error) {
        console.error(`freigabe:stand: ${(error as Error).message}`);
        process.exit(2);
    }
    const datei = baueDatei({
        repo: values.repo ?? resolve(import.meta.dirname, "../.."),
        production: values.production,
        stage: values.stage,
        stageGruen: stageGruenAus({ gruen: values["stage-gruen"] === true, rot: values["stage-rot"] === true }),
        stagePruefung: values["stage-pruefung"] ?? null,
        freigabe,
        nachts: values.nachts === true,
        probenGruen: values["proben-gruen"] === true,
        nachweis,
        // 🪤 Wie oben: Claudios Skript erkennt die Angabe per grep nach "release-freigabe".
        releaseFreigabe:
            values["release-freigabe"] === true ? { satz: values["release-freigabe-satz"] ?? null } : undefined,
        seit,
    });
    // 🔴 Lieber kein Schreiben als eine Datei, die der Server als unlesbar verwirft: Dann hieße es dort „nicht eingerichtet“.
    const fehler = freigabeDateiFehler(datei);
    if (fehler.length > 0) {
        console.error(`freigabe:stand: die Datei hielte den Vertrag nicht: ${fehler.join("; ")}`);
        process.exit(2);
    }
    const text = `${JSON.stringify(datei, null, 2)}\n`;
    if (values.out === undefined) {
        process.stdout.write(text);
        return;
    }
    mkdirSync(dirname(values.out), { recursive: true });
    writeFileSync(values.out, text, "utf8");
    console.log(
        `${values.out}: ${String(datei.themen.length)} Themen, ${String(datei.technik.migrationen.length)} Migrationen`,
    );
}

if (process.argv[1]?.endsWith("freigabe-stand-cli.ts") === true) await main();
