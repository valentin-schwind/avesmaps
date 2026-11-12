import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { hostname, userInfo } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { belegteDateien, hoechsteNummer, workItemNummer, workItemsAufOrigin } from "./anspruch-nummer.ts";

/**
 * Die Anspruchsliste (Betreiber 2026-10-05: eine Datei je laufender Arbeit mit Work Item, Dateibereich, Konto und Gerät,
 * „damit sein zweites Claude-Konto und Codex sehen, woran gearbeitet wird").
 *
 * 🔴 Sie liegt AUSSERHALB des Repositoriums (`C:\avesmaps3d-data\claims`, überschreibbar mit `--ordner` oder
 * `AVESMAPS_CLAIMS_DIR`). Grund: Ein Anspruch gilt nur, solange eine Sitzung läuft — flüchtige Sperren, Heartbeats und
 * Secrets gehören nicht in Git (`CLAUDE.local.md`). Im Repository stünde er morgen als Leiche.
 *
 * 🪤 Das ist eine ANSAGE, keine Sperre. Niemand wird gehindert; die Liste sagt nur, wer woran sitzt. Eine echte Sperre
 * wäre falsch, weil eine abgestürzte Sitzung sie nie zurückgäbe.
 *
 *   npm run anspruch                                     # was läuft gerade
 *   npm run anspruch -- --nimm WI-0091 --bereich "apps/web/src/info-panel/**" --bereich "apps/server/src/subjects/**"
 *   npm run anspruch -- --nimm WI-0091 --weiter --bereich "…"   # an einem vorhandenen Work Item weiterarbeiten
 *   npm run anspruch -- --gib WI-0091
 *   npm run anspruch -- --aufraeumen                     # tote Ansprüche entfernen
 *
 * 🔴 `--nimm` weist eine Work-Item-Nummer ab, die auf `origin/master` schon als Datei liegt (WI-0169). Wer an einem
 * vorhandenen Work Item weiterarbeitet, sagt das mit `--weiter`. Ist origin nicht erreichbar, gibt es nur eine Warnung.
 */
const { values } = parseArgs({
    options: {
        nimm: { type: "string" },
        gib: { type: "string" },
        bereich: { type: "string", multiple: true },
        notiz: { type: "string" },
        ordner: { type: "string" },
        aufraeumen: { type: "boolean", default: false },
        /** An einem Work Item weiterarbeiten, das auf origin schon liegt: Dann wird die Nummer nicht abgewiesen. */
        weiter: { type: "boolean", default: false },
        /** Ab wann ein Anspruch als tot gilt, in Stunden. */
        "tot-nach": { type: "string", default: "8" },
    },
});

const ordner = values.ordner ?? process.env["AVESMAPS_CLAIMS_DIR"] ?? "C:\\avesmaps3d-data\\claims";
const totNach = Number(values["tot-nach"]);
if (!Number.isFinite(totNach) || totNach <= 0) {
    console.error("--tot-nach braucht eine Zahl größer als 0");
    process.exit(1);
}

interface Anspruch {
    workItem: string;
    bereiche: string[];
    konto: string;
    geraet: string;
    seit: string;
    notiz?: string;
}

const datei = (wi: string): string => join(ordner, `${wi.replace(/[^A-Za-z0-9._-]/g, "-")}.json`);

const lies = (): { name: string; a: Anspruch }[] => {
    mkdirSync(ordner, { recursive: true });
    const raus: { name: string; a: Anspruch }[] = [];
    for (const name of readdirSync(ordner)) {
        if (!name.endsWith(".json")) continue;
        try {
            raus.push({ name, a: JSON.parse(readFileSync(join(ordner, name), "utf8")) as Anspruch });
        } catch {
            console.warn(`unlesbar, übersprungen: ${name}`);
        }
    }
    return raus.sort((x, y) => x.a.seit.localeCompare(y.a.seit));
};

const alterStunden = (a: Anspruch): number => (Date.now() - Date.parse(a.seit)) / 3_600_000;

if (values.nimm !== undefined) {
    const bereiche = values.bereich ?? [];
    if (bereiche.length === 0) {
        console.error('--nimm braucht mindestens einen --bereich (Glob, z. B. "apps/web/src/map/**")');
        process.exit(1);
    }
    const nummer = workItemNummer(values.nimm);
    if (nummer !== undefined && !values.weiter) {
        const origin = workItemsAufOrigin(process.cwd());
        if (origin.warnung !== undefined) console.warn(`🪤 ${origin.warnung}.`);
        const belegt = belegteDateien(nummer, origin.dateien ?? []);
        if (belegt.length > 0) {
            console.error(`${nummer} ist auf origin/master schon vergeben: ${belegt.join(", ")}.`);
            console.error(
                `Neue Arbeit braucht eine freie Nummer (höchste auf origin/master: ${hoechsteNummer(origin.dateien ?? []) ?? "keine"}; vorher die drei Quellen aus AGENTS.md, „Die Anspruchsliste“).`,
            );
            console.error("Wer an diesem Work Item weiterarbeitet: --weiter.");
            process.exit(3);
        }
    }
    const vorhanden = lies().find((e) => e.a.workItem === values.nimm);
    if (vorhanden !== undefined && alterStunden(vorhanden.a) < totNach) {
        console.error(
            `${values.nimm} hat schon einen Anspruch: ${vorhanden.a.konto} auf ${vorhanden.a.geraet}, seit ${vorhanden.a.seit}.`,
        );
        console.error("Kläre das, statt ihn zu überschreiben. Ist die Sitzung tot: --aufraeumen.");
        process.exit(2);
    }
    const a: Anspruch = {
        workItem: values.nimm,
        bereiche,
        konto: userInfo().username,
        geraet: hostname(),
        seit: new Date().toISOString(),
        ...(values.notiz === undefined ? {} : { notiz: values.notiz }),
    };
    mkdirSync(ordner, { recursive: true });
    writeFileSync(datei(values.nimm), `${JSON.stringify(a, null, 2)}\n`, "utf8");
    console.log(`genommen: ${values.nimm} (${bereiche.join(", ")})`);
    process.exit(0);
}

if (values.gib !== undefined) {
    try {
        rmSync(datei(values.gib));
        console.log(`zurückgegeben: ${values.gib}`);
    } catch {
        console.log(`${values.gib} hatte keinen Anspruch.`);
    }
    process.exit(0);
}

if (values.aufraeumen) {
    let weg = 0;
    for (const { name, a } of lies()) {
        if (alterStunden(a) >= totNach) {
            rmSync(join(ordner, name));
            console.log(`entfernt (${alterStunden(a).toFixed(1)} h alt): ${a.workItem} — ${a.konto}@${a.geraet}`);
            weg += 1;
        }
    }
    console.log(weg === 0 ? "nichts zu entfernen." : `${String(weg)} tote Ansprüche entfernt.`);
    process.exit(0);
}

const liste = lies();
if (liste.length === 0) {
    console.log(`Keine laufende Arbeit angemeldet (${ordner}).`);
    process.exit(0);
}
console.log(`Laufende Arbeit (${ordner}):\n`);
for (const { a } of liste) {
    const alt = alterStunden(a);
    const marke = alt >= totNach ? " 🪤 vermutlich tot" : "";
    console.log(
        `  ${a.workItem.padEnd(10)} ${a.konto}@${a.geraet}  seit ${a.seit.slice(0, 16).replace("T", " ")} (${alt.toFixed(1)} h)${marke}`,
    );
    for (const b of a.bereiche) console.log(`             ${b}`);
    if (a.notiz !== undefined) console.log(`             „${a.notiz}"`);
}
