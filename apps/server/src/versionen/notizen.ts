import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { Value } from "@sinclair/typebox/value";
import {
    KURZINFO_ABSCHNITTE,
    RELEASE_STAMM,
    ReleaseNotizen,
    artAus,
    kurzinfoAus,
    neuUndAchtung,
    releaseStamm,
    versionGruppen,
    type ReleaseCommit,
    VERLAUF_BEREICHE,
    VERLAUF_BESCHREIBUNG_MAX,
    VERLAUF_DATEI,
    type ReleaseVerlauf,
    type VerlaufBereich,
} from "@avesmaps3d/shared";

/**
 * Das Werkzeug der Release-Notizen (WI-0137, VERSION-0001 §2), ohne Einstieg: `scripts/ops/release-notizen-cli.ts` ruft es. Es liest
 * `git log` zwischen zwei Commits und schreibt die Commit-Liste als `config/releases/<stamm>.json`, dazu ein Gerüst der Kurzinfo. Der Server
 * importiert dieses Modul NIE (kein Git zur Laufzeit); er liest nur die Dateien (`versionen/lesen.ts`).
 */

const run = promisify(execFile);
const git = async (repo: string, args: string[]): Promise<string> =>
    (await run("git", args, { cwd: repo, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" })).stdout;

export class NotizenFehler extends Error {
    constructor(message: string) {
        super(message);
        this.name = "NotizenFehler";
    }
}

/** Der Name aus Git als Anzeigename; nie die E-Mail-Adresse. */
export function werAus(name: string): string {
    if (/claudia/iu.test(name)) return "Claudia";
    if (/claudio/iu.test(name)) return "Claudio";
    if (/valentin/iu.test(name)) return "Valentin";
    return name.trim().slice(0, 80) || "unbekannt";
}

/** Ändert ein Commit nur Doku? Entschieden an den Dateien, nicht am Präfix (VERSION-0001 §1). */
export function nurDoku(dateien: readonly string[]): boolean {
    return (
        dateien.length > 0 &&
        dateien.every((datei) => /^(project-control|docs|review)\//u.test(datei) || datei.toLowerCase().endsWith(".md"))
    );
}

export async function aufloesen(repo: string, ref: string): Promise<string> {
    try {
        return (await git(repo, ["rev-parse", "--verify", `${ref}^{commit}`])).trim();
    } catch {
        throw new NotizenFehler(`${ref} ist kein Commit in diesem Repository`);
    }
}

async function istVorfahre(repo: string, vorfahre: string, nachfahre: string): Promise<boolean> {
    try {
        await git(repo, ["merge-base", "--is-ancestor", vorfahre, nachfahre]);
        return true;
    } catch {
        return false;
    }
}

/** Die Titel der Arbeitspakete aus der ersten Zeile von `project-control/work-items/WI-xxxx-*.md` (`# WI-0128: …`, `— …` oder `· …`). */
async function paketTitel(repo: string, nummern: ReadonlySet<string>): Promise<Record<string, string>> {
    const ordner = join(repo, "project-control", "work-items");
    const dateien = await readdir(ordner).catch(() => [] as string[]);
    const titel: Record<string, string> = {};
    for (const wi of [...nummern].sort()) {
        const datei = dateien.find((name) => name.startsWith(`${wi}-`) && name.endsWith(".md"));
        if (datei === undefined) continue;
        const erste = (await readFile(join(ordner, datei), "utf8")).split(/\r?\n/u)[0] ?? "";
        const text = erste
            .replace(/^#\s*/u, "")
            .replace(new RegExp(`^${wi}\\s*[:—–·-]?\\s*`, "u"), "")
            .trim();
        if (text !== "") titel[wi] = text.slice(0, 300);
    }
    return titel;
}

/** Sammelt die Notizen zwischen `seit` (ausschließlich) und `bis` (einschließlich), ohne Merges. */
export async function sammle(repo: string, seit: string, bis: string, titel = ""): Promise<ReleaseNotizen> {
    const von = await aufloesen(repo, seit);
    const nach = await aufloesen(repo, bis);
    if (von === nach) throw new NotizenFehler("--seit und --bis sind derselbe Commit");
    if (!(await istVorfahre(repo, von, nach))) throw new NotizenFehler(`${seit} ist kein Vorfahre von ${bis}`);
    const roh = await git(repo, [
        "log",
        "--no-merges",
        "--name-only",
        "--format=%x1e%H%x1f%aI%x1f%an%x1f%s",
        `${von}..${nach}`,
    ]);
    const commits: ReleaseCommit[] = [];
    for (const block of roh.split("\x1e")) {
        if (block.trim() === "") continue;
        const [kopf = "", ...rest] = block.split(/\r?\n/u);
        const [sha = "", datum = "", name = "", betreff = ""] = kopf.split("\x1f");
        const dateien = rest.map((zeile) => zeile.trim()).filter((zeile) => zeile !== "");
        commits.push({ sha, datum, wer: werAus(name), betreff: betreff.slice(0, 500), doku: nurDoku(dateien) });
    }
    const nummern = new Set(
        commits.flatMap((commit) => /WI-\d{4}/u.exec(commit.betreff.split(":")[0] ?? "")?.[0] ?? []),
    );
    const datum = (await git(repo, ["show", "-s", "--format=%cI", nach])).trim();
    return { schema: 1, titel: titel.trim(), von, bis: nach, datum, pakete: await paketTitel(repo, nummern), commits };
}

/**
 * Was nicht zur Anwendung gehört: Doku, Planung, Betrieb, Werkzeuge, Prüfstände und Tests. Ein Commit, der NUR solche Dateien ändert, steht
 * nicht in „Neue Version“ (dieselbe Grenze wie die Glocke „Neu auf der Stage“ in `ops/deploy/auto-stage.sh`, dazu `scripts/`).
 */
export function nurNebensache(dateien: readonly string[]): boolean {
    return dateien.every(
        (datei) =>
            /^(project-control|docs|ops|review|scripts|\.claude)\//u.test(datei) ||
            /(^|\/)(test|e2e)\//u.test(datei) ||
            /\.(test|spec)\.ts$/u.test(datei) ||
            datei.endsWith(".md"),
    );
}

/** Wo eine Datei wirkt; Reihenfolge zählt (das Editor-Fenster vor dem allgemeinen Web-Teil). `null`: Nebensache oder unbekannt. */
const BEREICH_DATEI: readonly [RegExp, VerlaufBereich][] = [
    [
        /^apps\/web\/src\/(editor-[^/]+|[a-z]*editor|medien|warteschlange|wikisync|inhalte|kartenserien|gebirge-vorschau)\//u,
        "editor",
    ],
    [/^apps\/web\/src\/(system|news|freigabe|status|feedback)\//u, "verwaltung"],
    [
        /^apps\/web\/src\/(map|route-planner|search|info-panel|viewer|besuch|controls|measure|scale|legal|keyboard|theme|zoombaender|catalog|nachladen)/u,
        "karte",
    ],
    [/^apps\/web\//u, "oberflaeche"],
    [/^apps\/server\/src\/(editor|media-editor)\//u, "editor"],
    [/^(apps\/server\/migrations|config)\//u, "daten"],
    [/^(apps\/server|packages)\//u, "server"],
];

/** Die Bereiche eines Commits aus seinen Dateien (WI-0255 §3e), in der Reihenfolge von `VERLAUF_BEREICHE`; Tests und Doku zählen nicht. */
export function bereicheAus(dateien: readonly string[]): VerlaufBereich[] {
    const gefunden = new Set<VerlaufBereich>();
    for (const datei of dateien) {
        if (nurNebensache([datei])) continue;
        const treffer = BEREICH_DATEI.find(([muster]) => muster.test(datei));
        if (treffer !== undefined) gefunden.add(treffer[1]);
    }
    return VERLAUF_BEREICHE.filter((bereich) => gefunden.has(bereich));
}

/**
 * Die Beschreibung eines Commits für den Verlauf (WI-0255 §3e): ohne `Neu:`/`Achtung:` (die stehen eigens da), ohne Zeilen über Tests und ohne
 * Trailer wie `Co-Authored-By`, Leerraum zusammengezogen, gekürzt. Geglättet für die Öffentlichkeit wird erst im Discord-Bericht.
 */
export function beschreibungAus(beschreibung: string): string {
    const zeilen = beschreibung
        .split(/\r?\n/u)
        .map((zeile) => zeile.trim())
        .filter(
            (zeile) =>
                zeile !== "" &&
                !/^(Neu|Achtung):/u.test(zeile) &&
                !/^[-*]?\s*Tests?\b/u.test(zeile) &&
                !/^[A-Z][A-Za-z-]+-By:/u.test(zeile),
        );
    const text = zeilen.join(" ").replace(/\s+/gu, " ").trim();
    return text.length <= VERLAUF_BESCHREIBUNG_MAX ? text : `${text.slice(0, VERLAUF_BESCHREIBUNG_MAX - 1).trimEnd()}…`;
}

/**
 * Der Verlauf bis `bis` für die Meldung „Neue Version“ (WI-0137, Betreiber 2026-10-17): die letzten `max` Commits ohne Merges, neueste
 * zuerst, je mit Art, Titel, den Zeilen `Neu:`/`Achtung:` der Beschreibung und ob er die Anwendung ändert. `build-release.sh` schreibt ihn
 * beim Bau als `config/releases/verlauf.json` ins Release; der Server schneidet daraus die Spanne zwischen Tab-Stand und laufendem Stand.
 * Seit WI-0255 §3e tragen feat- und fix-Commits der Anwendung auch ihre Beschreibung und ihre Bereiche, für den Discord-Bericht.
 */
export async function sammleVerlauf(repo: string, bis: string, max = 600): Promise<ReleaseVerlauf> {
    const nach = await aufloesen(repo, bis);
    const roh = await git(repo, [
        "log",
        "--no-merges",
        "--name-only",
        `--max-count=${String(max)}`,
        "--format=%x1e%H%x1f%s%x1f%b%x1d",
        nach,
    ]);
    const commits: ReleaseVerlauf["commits"] = [];
    for (const block of roh.split("\x1e")) {
        if (block.trim() === "") continue;
        const [kopf = "", dateiteil = ""] = block.split("\x1d");
        const [sha = "", titel = "", beschreibung = ""] = kopf.split("\x1f");
        const dateien = dateiteil
            .split(/\r?\n/u)
            .map((zeile) => zeile.trim())
            .filter((zeile) => zeile !== "");
        const art = artAus(titel);
        const anwendung = dateien.length > 0 && !nurNebensache(dateien);
        const erzaehlt = anwendung && (art === "feat" || art === "fix");
        commits.push({
            sha,
            art,
            titel: titel.slice(0, 500),
            ...neuUndAchtung(beschreibung),
            anwendung,
            ...(erzaehlt ? { beschreibung: beschreibungAus(beschreibung), bereich: bereicheAus(dateien) } : {}),
        });
    }
    return { schema: 1, bis: nach, commits };
}

/** Die gruppierte Liste fürs Terminal (Doku gezählt, nicht gelistet). */
export function uebersicht(notizen: ReleaseNotizen): string {
    const doku = notizen.commits.filter((commit) => commit.doku).length;
    const zeilen = [
        `Release ${releaseStamm(notizen.datum, notizen.bis)}: ${String(notizen.commits.length - doku)} Änderungen, ${String(doku)} nur Doku` +
            (notizen.titel === "" ? "" : ` · ${notizen.titel}`),
    ];
    for (const gruppe of versionGruppen(notizen.commits, notizen.pakete, false)) {
        const name =
            gruppe.id === "sonstiges" ? "Sonstiges" : `${gruppe.id}${gruppe.name === null ? "" : ` · ${gruppe.name}`}`;
        zeilen.push("", `${name} (${String(gruppe.zeilen.length)})`);
        for (const zeile of gruppe.zeilen)
            zeilen.push(`  ${zeile.art ?? "-"}  ${zeile.text}  ${zeile.commit.sha.slice(0, 8)}`);
    }
    return zeilen.join("\n");
}

/** Das Gerüst der Kurzinfo: die drei Überschriften ohne Punkte, darunter feat und fix je Arbeitspaket als Kommentar. */
export function geruest(notizen: ReleaseNotizen): string {
    const hilfe: string[] = [];
    for (const gruppe of versionGruppen(notizen.commits, notizen.pakete, false)) {
        const neu = gruppe.zeilen.filter((zeile) => zeile.art === "feat" || zeile.art === "fix");
        if (neu.length === 0) continue;
        hilfe.push(
            `  ${gruppe.id === "sonstiges" ? "Sonstiges" : `${gruppe.id}${gruppe.name === null ? "" : ` · ${gruppe.name}`}`}`,
        );
        for (const zeile of neu)
            hilfe.push(`    ${zeile.art === "fix" ? "Fix" : "neu"}: ${zeile.text.replaceAll("--", "-")}`);
    }
    return [
        "# Was ist neu?",
        "",
        "<!--",
        "  Kurzinfo zu diesem Release, in einfacher Sprache (WI-0137). Nur diese drei Überschriften; jede darf fehlen. Punkte mit „- “.",
        "  Text bleibt Text: kein Markdown, keine Links. Bleibt alles leer, zeigt die Seite nur „↺ Neu laden“.",
        "",
        "  Gedächtnisstütze, neu und Fix nach Arbeitspaket (wird nicht angezeigt):",
        ...hilfe,
        "-->",
        "",
        // Das Gerüst kennt die drei geschriebenen Abschnitte; „Neu“ und „Achtung“ kommen aus den Commits (`neuerungenAlsKurzinfo`).
        ...KURZINFO_ABSCHNITTE.filter((titel) => titel !== "Neu" && titel !== "Achtung").flatMap((titel) => [
            `## ${titel}`,
            "",
        ]),
    ].join("\n");
}

export interface Befund {
    datei: string;
    art: "fehler" | "hinweis";
    text: string;
}

/**
 * Prüft `config/releases`: jede JSON gegen das Schema und ihren Stamm, jede Kurzinfo auf fremde Überschriften (Fehler). Fehlt die Kurzinfo
 * eines Release oder ist sie leer, ist das ein Hinweis ohne Abbruch (Wunsch der Koordination 2026-10-11: beim Schnitt nicht vergessen).
 */
export async function pruefe(ordner: string): Promise<Befund[]> {
    const dateien = (await readdir(ordner).catch(() => [] as string[])).sort();
    const befunde: Befund[] = [];
    for (const datei of dateien.filter((name) => name.endsWith(".json") && name !== VERLAUF_DATEI)) {
        const stamm = datei.slice(0, -".json".length);
        if (!RELEASE_STAMM.test(stamm)) {
            befunde.push({ datei, art: "fehler", text: "Name ist kein Stamm <YYYY-MM-DD>-<8 Zeichen SHA>" });
            continue;
        }
        let inhalt: unknown;
        try {
            inhalt = JSON.parse(await readFile(join(ordner, datei), "utf8"));
        } catch {
            befunde.push({ datei, art: "fehler", text: "kein gültiges JSON" });
            continue;
        }
        if (!Value.Check(ReleaseNotizen, inhalt)) {
            const erster = [...Value.Errors(ReleaseNotizen, inhalt)][0];
            befunde.push({
                datei,
                art: "fehler",
                text: `passt nicht zum Schema (${erster?.path ?? "?"}: ${erster?.message ?? "?"})`,
            });
            continue;
        }
        if (releaseStamm(inhalt.datum, inhalt.bis) !== stamm) {
            befunde.push({
                datei,
                art: "fehler",
                text: `Stamm passt nicht zu Datum und bis (${releaseStamm(inhalt.datum, inhalt.bis)})`,
            });
        }
        const md = `${stamm}.md`;
        if (!dateien.includes(md)) {
            befunde.push({ datei: md, art: "hinweis", text: "Kurzinfo fehlt; die Seite zeigt dann nur „↺ Neu laden“" });
            continue;
        }
        const kurz = kurzinfoAus(await readFile(join(ordner, md), "utf8"));
        for (const titel of kurz.fremd) {
            befunde.push({
                datei: md,
                art: "fehler",
                text: `Überschrift „${titel}“ gehört nicht dazu (nur ${KURZINFO_ABSCHNITTE.join(", ")})`,
            });
        }
        if (kurz.abschnitte.length === 0) {
            befunde.push({
                datei: md,
                art: "hinweis",
                text: "Kurzinfo ist leer; die Seite zeigt dann nur „↺ Neu laden“",
            });
        }
    }
    for (const datei of dateien.filter((name) => name.endsWith(".md"))) {
        if (!dateien.includes(`${datei.slice(0, -".md".length)}.json`)) {
            befunde.push({ datei, art: "fehler", text: "Kurzinfo ohne Commit-Liste (.json)" });
        }
    }
    return befunde;
}

/** Ist der Arbeitsbaum sauber (für ein neues Release bis HEAD)? */
export async function sauber(repo: string): Promise<boolean> {
    return (await git(repo, ["status", "--porcelain"])).trim() === "";
}
