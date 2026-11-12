// Die öffentliche Ausgabe von Avesmaps3D (WI-0303 P2): baut aus einem Stand von `master` den Baum für den Zweig `avesmaps3d` des öffentlichen
// Legacy-Repositorys, prüft ihn und legt den Commit an.
//
// 🔴 Pusht nie. Das tut der Workflow `.github/workflows/oeffentliche-ausgabe.yml` nach grüner Prüfung, angestoßen vom Betreiber (Betreiber
// 2026-11-10: „ok github“; der Knopf im Reiter „GitHub“ des Datenabgleichs folgt mit P10). Der Zweig ist eine Einbahn: jede Ausgabe ein Commit
// „Avesmaps3D, Stand <sha12>“, ohne die Historie von Avesmaps3D; der erste setzt auf den Legacy-`master` auf.
//
//   node scripts/ausgabe/ausgabe.ts baue --sha <commit> [--basis <ref>] [--baum <ordner>]
//       Baut den öffentlichen Baum als Git-Objekt und gibt seine ID aus (`baum=`). Mit `--basis` muss der Stand darin enthalten sein (lokal
//       `origin/master`). Mit `--baum` liegt er danach als Dateien im (neuen) Ordner, für die Scanner.
//   node scripts/ausgabe/ausgabe.ts pruefe --baum <ordner> --gitleaks <bericht.json> --trufflehog <bericht.jsonl> [--vorschlag <datei>]
//   node scripts/ausgabe/ausgabe.ts pruefe --baum <ordner> --ohne-scanner [--gitleaks <bericht.json>] [--vorschlag <datei>]
//       Pfade, eigener Musterscan und die Berichte der Scanner, abgeglichen mit `bekannte-funde.json`. Exit 1 bei einem neuen Fund oder einem
//       Pfad, der nicht hinausdarf. `--ohne-scanner` nur lokal, wenn trufflehog fehlt; der Workflow verlangt beide Berichte. `--vorschlag`
//       schreibt die neuen Funde als Einträge ohne Grund in eine Datei: zum Prüfen, nie ungelesen übernehmen.
//   node scripts/ausgabe/ausgabe.ts lege-commit --baum-id <id> --sha <commit> --klon <ordner> [--zweig avesmaps3d]
//       Legt im Klon des öffentlichen Repositorys den Commit an (Elternteil: `origin/<zweig>`, sonst `origin/master`) und gibt ihn aus
//       (`commit=`); nichts, wenn sich der Baum gegenüber dem Elternteil nicht geändert hat. Der Klon liest die Objekte dieses Repositorys über
//       `objects/info/alternates`; er braucht keine Blobs (`--filter=blob:none --no-checkout` genügt).
//
// Im Workflow gehen die Werte zusätzlich nach `$GITHUB_OUTPUT`, der Bericht nach `$GITHUB_STEP_SUMMARY`. Kein Bericht nennt einen Wert, nur
// Datei, Zeile, Regel und Kennung (`ausgabe-regeln.ts`, `kennungVon`).
import { spawnSync } from "node:child_process";
import {
    appendFileSync,
    existsSync,
    lstatSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
    gleicheAb,
    leseGitleaks,
    leseTrufflehog,
    pfadFehler,
    scanneText,
    waehleAusgabe,
    ZWEIG,
    type BaumEintrag,
    type BekannterFund,
    type Fund,
} from "./ausgabe-regeln.ts";

const SHA = /^[0-9a-f]{40}$/;
const BEKANNTE_FUNDE = new URL("./bekannte-funde.json", import.meta.url);
/** Der Absender der Ausgabe-Commits: keine Person, keine Mailadresse von jemandem. */
const AUTOR = { name: "github-actions[bot]", email: "41898282+github-actions[bot]@users.noreply.github.com" };

class Abbruch extends Error {}

function git(
    args: readonly string[],
    optionen: { cwd?: string; input?: string | Buffer; env?: NodeJS.ProcessEnv } = {},
): string {
    const r = spawnSync("git", args, {
        cwd: optionen.cwd,
        input: typeof optionen.input === "string" ? Buffer.from(optionen.input, "utf8") : optionen.input,
        env: optionen.env ?? process.env,
        maxBuffer: 2 ** 30,
    });
    if (r.status !== 0) throw new Abbruch(`git ${args[0]} scheiterte: ${r.stderr.toString("utf8").trim()}`);
    return r.stdout.toString("utf8");
}

function gitPuffer(args: readonly string[]): Buffer {
    const r = spawnSync("git", args, { maxBuffer: 2 ** 31 - 1 });
    if (r.status !== 0) throw new Abbruch(`git ${args[0]} scheiterte: ${r.stderr.toString("utf8").trim()}`);
    return r.stdout;
}

function ausgeben(werte: Record<string, string>): void {
    for (const [schluessel, wert] of Object.entries(werte)) process.stdout.write(`${schluessel}=${wert}\n`);
    const datei = process.env["GITHUB_OUTPUT"];
    if (datei)
        appendFileSync(
            datei,
            Object.entries(werte)
                .map(([k, v]) => `${k}=${v}\n`)
                .join(""),
        );
}

function zusammenfassung(markdown: string): void {
    const datei = process.env["GITHUB_STEP_SUMMARY"];
    if (datei) appendFileSync(datei, `${markdown}\n`);
}

/** Alle Einträge eines Stands (`git ls-tree -r -z --full-tree`). */
function eintraegeVon(sha: string): BaumEintrag[] {
    return git(["ls-tree", "-r", "-z", "--full-tree", sha])
        .split("\0")
        .filter((z) => z.length > 0)
        .map((z) => {
            const tab = z.indexOf("\t");
            const [modus = "", , objekt = ""] = z.slice(0, tab).split(" ");
            return { modus, objekt, pfad: z.slice(tab + 1) };
        });
}

function baue(werte: { sha?: string | undefined; basis?: string | undefined; baum?: string | undefined }): void {
    if (!werte.sha) throw new Abbruch("--sha fehlt");
    const sha = git(["rev-parse", "--verify", `${werte.sha}^{commit}`]).trim();
    if (werte.basis) {
        const r = spawnSync("git", ["merge-base", "--is-ancestor", sha, werte.basis]);
        if (r.status !== 0)
            throw new Abbruch(
                `${sha} ist nicht in ${werte.basis} enthalten: Ausgegeben wird nur, was auf master liegt.`,
            );
    }
    const auswahl = waehleAusgabe(eintraegeVon(sha));
    if (auswahl.fehler.length > 0)
        throw new Abbruch(`Der Baum geht so nicht hinaus:\n  ${auswahl.fehler.join("\n  ")}`);

    // Den Baum über einen eigenen, leeren Index bauen: Der Index des Checkouts bleibt unberührt, die Blobs sind bytegleich mit dem Stand.
    const index = join(tmpdir(), `ausgabe-index-${process.pid}-${Date.now()}`);
    let baumId: string;
    try {
        const env = { ...process.env, GIT_INDEX_FILE: index };
        const zeilen = auswahl.eintraege.map((e) => `${e.modus} ${e.objekt}\t${e.pfad}\0`).join("");
        git(["update-index", "--add", "-z", "--index-info"], { input: zeilen, env });
        baumId = git(["write-tree"], { env }).trim();
    } finally {
        rmSync(index, { force: true });
    }

    if (werte.baum) {
        const ziel = resolve(werte.baum);
        if (existsSync(ziel) && readdirSync(ziel).length > 0) throw new Abbruch(`--baum ist nicht leer: ${ziel}`);
        mkdirSync(ziel, { recursive: true });
        const tar = spawnSync("tar", ["-xf", "-"], {
            cwd: ziel,
            input: gitPuffer(["archive", "--format=tar", baumId]),
        });
        if (tar.status !== 0) throw new Abbruch(`tar scheiterte: ${tar.stderr.toString("utf8").trim()}`);
    }
    ausgeben({ sha, baum: baumId, dateien: String(auswahl.eintraege.length) });
}

/** Jede Datei unter dem Baum mit Pfad, Größe und (bei Text) Inhalt; ein Link hält an. */
function dateienUnter(baum: string): { pfad: string; groesse: number; text: string | undefined }[] {
    const dateien: { pfad: string; groesse: number; text: string | undefined }[] = [];
    const offen = [""];
    for (let rel = offen.pop(); rel !== undefined; rel = offen.pop()) {
        for (const name of readdirSync(join(baum, rel))) {
            const pfad = rel ? `${rel}/${name}` : name;
            const info = lstatSync(join(baum, pfad));
            if (info.isSymbolicLink()) throw new Abbruch(`symbolischer Link im Baum: ${pfad}`);
            if (info.isDirectory()) offen.push(pfad);
            else {
                const inhalt = readFileSync(join(baum, pfad));
                const binaer = inhalt.subarray(0, 8000).includes(0);
                dateien.push({ pfad, groesse: info.size, text: binaer ? undefined : inhalt.toString("utf8") });
            }
        }
    }
    return dateien.sort((a, b) => (a.pfad < b.pfad ? -1 : 1));
}

function zeileVon(f: Fund): string {
    const bestaetigt = f.bestaetigt === true ? " **bestätigt**" : "";
    return `| ${f.werkzeug} | ${f.regel} | \`${f.datei}\`:${f.zeile} | \`${f.kennung}\`${bestaetigt} |`;
}

function pruefe(werte: {
    baum?: string | undefined;
    gitleaks?: string | undefined;
    trufflehog?: string | undefined;
    "ohne-scanner"?: boolean | undefined;
    vorschlag?: string | undefined;
}): number {
    if (!werte.baum) throw new Abbruch("--baum fehlt");
    const baum = resolve(werte.baum);
    if (!werte["ohne-scanner"] && (!werte.gitleaks || !werte.trufflehog)) {
        throw new Abbruch(
            "Ohne die Berichte von gitleaks und trufflehog keine Prüfung (lokal nur mit --ohne-scanner).",
        );
    }
    const dateien = dateienUnter(baum);
    const pfadfehler = dateien.map(pfadFehler).filter((f): f is string => f !== undefined);
    const funde: Fund[] = dateien.flatMap((d) => (d.text === undefined ? [] : scanneText(d.pfad, d.text)));
    if (werte.gitleaks) funde.push(...leseGitleaks(readFileSync(werte.gitleaks, "utf8"), baum));
    if (werte.trufflehog) funde.push(...leseTrufflehog(readFileSync(werte.trufflehog, "utf8"), baum));
    const bekannte = (JSON.parse(readFileSync(BEKANNTE_FUNDE, "utf8")) as { funde: BekannterFund[] }).funde;
    const { neu, ungenutzt } = gleicheAb(funde, bekannte);

    const gelaufen = [
        "Pfade",
        "eigener Musterscan",
        werte.gitleaks ? "gitleaks" : "",
        werte.trufflehog ? "trufflehog" : "",
    ];
    const zeilen = [
        `### Prüfung des öffentlichen Baums`,
        ``,
        `${dateien.length} Dateien; geprüft: ${gelaufen.filter(Boolean).join(", ")}. ${funde.length} Funde, davon ${neu.length} neu.`,
    ];
    if (pfadfehler.length > 0) zeilen.push(``, `**Darf nicht hinaus:**`, ``, ...pfadfehler.map((f) => `- ${f}`));
    if (neu.length > 0) {
        zeilen.push(
            ``,
            `**Neue Funde** (im Quelltext beheben oder nach Prüfung in \`scripts/ausgabe/bekannte-funde.json\` eintragen):`,
            ``,
        );
        zeilen.push(`| Werkzeug | Regel | Stelle | Kennung |`, `|---|---|---|---|`, ...neu.map(zeileVon));
    }
    if (ungenutzt.length > 0) {
        zeilen.push(
            ``,
            `Eingetragen, aber nicht mehr gefunden (aufräumen): ${ungenutzt.map((b) => `\`${b.datei}\``).join(", ")}`,
        );
    }
    const gruen = pfadfehler.length === 0 && neu.length === 0;
    zeilen.push(``, gruen ? `Ergebnis: **grün**` : `Ergebnis: **rot**, die Ausgabe hält an.`);
    const bericht = zeilen.join("\n");
    process.stdout.write(`${bericht}\n`);
    zusammenfassung(bericht);

    if (werte.vorschlag && neu.length > 0) {
        const eintraege = neu.map((f) => ({
            werkzeug: f.werkzeug,
            regel: f.regel,
            datei: f.datei,
            kennung: f.kennung,
            grund: "",
        }));
        writeFileSync(werte.vorschlag, `${JSON.stringify(eintraege, null, 4)}\n`);
    }
    return gruen ? 0 : 1;
}

function legeCommit(werte: {
    "baum-id"?: string | undefined;
    sha?: string | undefined;
    klon?: string | undefined;
    zweig?: string | undefined;
}): void {
    const baumId = werte["baum-id"];
    if (!baumId || !werte.sha || !werte.klon) throw new Abbruch("--baum-id, --sha und --klon sind nötig");
    if (!SHA.test(werte.sha)) throw new Abbruch(`--sha ist keine volle Commit-ID: ${werte.sha}`);
    const zweig = werte.zweig ?? ZWEIG;
    const klon = resolve(werte.klon);

    // Die Objekte dieses Repositorys für den Klon lesbar machen, ohne sie zu kopieren.
    const eigene = join(git(["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim(), "objects");
    const alternates = join(
        git(["rev-parse", "--path-format=absolute", "--git-dir"], { cwd: klon }).trim(),
        "objects",
        "info",
        "alternates",
    );
    const vorhanden = existsSync(alternates) ? readFileSync(alternates, "utf8").split(/\r?\n/) : [];
    if (!vorhanden.includes(eigene)) appendFileSync(alternates, `${eigene}\n`);
    git(["cat-file", "-e", `${baumId}^{tree}`], { cwd: klon });

    const versuch = (ref: string): string | undefined => {
        const r = spawnSync("git", ["rev-parse", "--verify", "-q", `${ref}^{commit}`], { cwd: klon, encoding: "utf8" });
        return r.status === 0 ? r.stdout.trim() : undefined;
    };
    const eltern = versuch(`refs/remotes/origin/${zweig}`) ?? versuch("refs/remotes/origin/master");
    if (!eltern) throw new Abbruch(`Im Klon fehlen origin/${zweig} und origin/master.`);
    if (git(["rev-parse", `${eltern}^{tree}`], { cwd: klon }).trim() === baumId) {
        process.stdout.write(`Unverändert gegenüber ${eltern.slice(0, 12)}: kein Commit.\n`);
        zusammenfassung(`Unverändert gegenüber \`${eltern.slice(0, 12)}\`: nichts zu veröffentlichen.`);
        ausgeben({ eltern, commit: "" });
        return;
    }
    const nachricht = [
        `Avesmaps3D, Stand ${werte.sha.slice(0, 12)}`,
        ``,
        `Ausgabe aus dem Arbeitsrepository von Avesmaps3D, Stand ${werte.sha}.`,
        `Erzeugt von scripts/ausgabe/ausgabe.ts. Beiträge: siehe CONTRIBUTING.md.`,
        ``,
    ].join("\n");
    const env = {
        ...process.env,
        GIT_AUTHOR_NAME: AUTOR.name,
        GIT_AUTHOR_EMAIL: AUTOR.email,
        GIT_COMMITTER_NAME: AUTOR.name,
        GIT_COMMITTER_EMAIL: AUTOR.email,
    };
    const commit = git(["commit-tree", baumId, "-p", eltern, "-F", "-"], { cwd: klon, input: nachricht, env }).trim();
    zusammenfassung(
        `Commit \`${commit.slice(0, 12)}\` auf \`${eltern.slice(0, 12)}\` (Zweig \`${zweig}\`), Stand \`${werte.sha}\`.`,
    );
    ausgeben({ eltern, commit });
}

function main(argv: readonly string[]): number {
    const [befehl, ...rest] = argv;
    const { values } = parseArgs({
        args: rest,
        options: {
            sha: { type: "string" },
            basis: { type: "string" },
            baum: { type: "string" },
            gitleaks: { type: "string" },
            trufflehog: { type: "string" },
            "ohne-scanner": { type: "boolean" },
            vorschlag: { type: "string" },
            "baum-id": { type: "string" },
            klon: { type: "string" },
            zweig: { type: "string" },
        },
    });
    try {
        if (befehl === "baue") baue(values);
        else if (befehl === "pruefe") return pruefe(values);
        else if (befehl === "lege-commit") legeCommit(values);
        else {
            console.error("baue | pruefe | lege-commit (siehe Kopf von scripts/ausgabe/ausgabe.ts)");
            return 2;
        }
        return 0;
    } catch (fehler) {
        if (!(fehler instanceof Abbruch)) throw fehler;
        console.error(fehler.message);
        zusammenfassung(`**Abbruch:** ${fehler.message}`);
        return 1;
    }
}

process.exitCode = main(process.argv.slice(2));
