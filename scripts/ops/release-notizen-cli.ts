import { access, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { releaseStamm } from "@avesmaps3d/shared";
import {
    NotizenFehler,
    geruest,
    pruefe,
    sammle,
    sammleVerlauf,
    sauber,
    uebersicht,
} from "../../apps/server/src/versionen/notizen.ts";

/**
 * Release-Notizen für „Versionen“ und die Kurzinfo „Was ist neu?“ (WI-0137, VERSION-0001 §2). Die Dateien reisen in `config/releases/` mit
 * dem Release; der Server braucht kein Git.
 *
 *   npm run release:notizen -- --seit <vorheriges-release>                  # neues Release bis HEAD: <stamm>.json und Gerüst <stamm>.md
 *   npm run release:notizen -- --seit <sha> --bis <sha> --titel "…"         # Nachtrag eines gelaufenen Release (ohne Gerüst)
 *   npm run release:notizen -- --seit <sha> --vorschau                      # nur die gruppierte Liste, nichts schreiben
 *   npm run release:notizen -- --pruefen                                    # alle Dateien prüfen; fehlende Kurzinfo ist ein Hinweis
 *   node scripts/ops/release-notizen-cli.ts --verlauf <datei> --repo <git> --bis <sha>   # beim Bau: der Verlauf für „Neue Version“
 *
 * `--verlauf` (WI-0137, Betreiber 2026-10-17): die letzten Commits bis `--bis` mit Art, Titel und den Zeilen `Neu:`/`Achtung:` als
 * `config/releases/verlauf.json`. `build-release.sh` ruft es nach `npm run build` im gebauten Baum, `--repo` zeigt auf den Klon mit Git
 * (der gebaute Baum kommt aus `git archive` und hat keins).
 *
 * Ablauf beim Schnitt: Notizen erzeugen → `<stamm>.md` füllen → `--pruefen` → ein Commit `docs(release): Notizen <stamm>` → diesen Commit
 * schneiden. Exit 0 gut, 1 Fehler in den Dateien, 2 Aufruf falsch oder Weigerung.
 */
const { values } = parseArgs({
    options: {
        seit: { type: "string" },
        bis: { type: "string" },
        titel: { type: "string" },
        vorschau: { type: "boolean", default: false },
        pruefen: { type: "boolean", default: false },
        ordner: { type: "string" },
        verlauf: { type: "string" },
        repo: { type: "string" },
        max: { type: "string" },
    },
});

const repo = process.cwd();
const ordner = resolve(repo, values.ordner ?? join("config", "releases"));
const da = (pfad: string): Promise<boolean> =>
    access(pfad).then(
        () => true,
        () => false,
    );

async function main(): Promise<number> {
    if (values.verlauf !== undefined) {
        const max = values.max === undefined ? 600 : Number.parseInt(values.max, 10);
        if (!Number.isInteger(max) || max < 1) {
            console.error("--max <Zahl> fehlt oder ist keine ganze Zahl");
            return 2;
        }
        const verlauf = await sammleVerlauf(resolve(values.repo ?? repo), values.bis ?? "HEAD", max);
        const ziel = resolve(repo, values.verlauf);
        await writeFile(ziel, `${JSON.stringify(verlauf)}\n`, "utf8");
        const redigiert = verlauf.commits.filter((commit) => commit.neu.length > 0).length;
        console.log(
            `Verlauf: ${String(verlauf.commits.length)} Commits bis ${verlauf.bis.slice(0, 8)}, ${String(redigiert)} mit „Neu:“ → ${ziel}`,
        );
        return 0;
    }
    if (values.pruefen) {
        const befunde = await pruefe(ordner);
        for (const befund of befunde)
            console.log(`${befund.art === "fehler" ? "FEHLER " : "Hinweis"}  ${befund.datei}: ${befund.text}`);
        const fehler = befunde.filter((befund) => befund.art === "fehler").length;
        console.log(fehler === 0 ? `geprüft: ${ordner}, keine Fehler` : `${String(fehler)} Fehler in ${ordner}`);
        return fehler === 0 ? 0 : 1;
    }
    if (values.seit === undefined) {
        console.error("--seit <vorheriges-release> fehlt (oder --pruefen)");
        return 2;
    }
    if (values.bis === undefined && !values.vorschau && !(await sauber(repo))) {
        console.error(
            "Der Arbeitsbaum ist nicht sauber: erst committen, dann die Notizen bis HEAD erzeugen (oder --bis angeben).",
        );
        return 2;
    }
    const notizen = await sammle(repo, values.seit, values.bis ?? "HEAD", values.titel ?? "");
    console.log(uebersicht(notizen));
    if (values.vorschau) return 0;

    const stamm = releaseStamm(notizen.datum, notizen.bis);
    const json = join(ordner, `${stamm}.json`);
    if (await da(json)) {
        console.error(`\n${json} gibt es schon; nichts überschrieben.`);
        return 2;
    }
    await mkdir(ordner, { recursive: true });
    await writeFile(json, `${JSON.stringify(notizen, null, 4)}\n`, "utf8");
    console.log(`\ngeschrieben: ${json}`);
    // Nur beim neuen Release ein Gerüst: Nachträge bleiben ohne Kurzinfo (Koordination 2026-10-11).
    const md = join(ordner, `${stamm}.md`);
    if (values.bis === undefined && !(await da(md))) {
        await writeFile(md, geruest(notizen), "utf8");
        console.log(`Gerüst der Kurzinfo: ${md} (in einfacher Sprache füllen, dann --pruefen)`);
    }
    return 0;
}

main().then(
    (code) => process.exit(code),
    (error: unknown) => {
        console.error(error instanceof NotizenFehler ? error.message : error);
        process.exit(error instanceof NotizenFehler ? 2 : 1);
    },
);
