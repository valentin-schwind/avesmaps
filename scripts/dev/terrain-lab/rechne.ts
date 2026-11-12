/**
 * Generatoradapter des Terrain-Labs (WI-0250 Phase B): ruft den Generator als Rechenkern auf, misst und legt Raster und Messwerte ab.
 *
 *   node --expose-gc scripts/dev/terrain-lab/rechne.ts <auftrag.json> <ausgabeordner> [Optionen]
 *
 * Optionen:
 *   --commit <sha>            Rechnet an diesem Commit in einer eigenen Arbeitskopie (`<Labor>/staende/<sha12>`, einmal angelegt, danach
 *                             wiederverwendet). Ohne: im Arbeitsbaum dieses Checkouts, aber nur, wenn die Generator-Verzeichnisse sauber sind.
 *   --schmutzig-erlauben      Misst auch einen unsauberen Arbeitsbaum (Entwicklung); der Lauf trägt den Hash der Änderung und gilt nicht als reproduzierbar.
 *   --warm <n>                Nach dem kalten Lauf n warme Läufe im selben Prozess (Vorgabe 0). Für das Endgelände nicht vorgesehen.
 *   --phasen                  Phasenproben des Rückennetzes (Differenzen, nach dem Hauptlauf); `--phasen-wiederholungen <n>` (Vorgabe 3).
 *   --arbeiter <n>            `TERRAIN_EROSION_WORKERS` für diesen Lauf (die Erosion des Geländes; 0 bis 8).
 *   --ohne-raster             Keine Raster schreiben (nur meta.json): für reine Zeitmessungen.
 *   --fingerprint             Nur den Fingerabdruck des Auftrags ausgeben (kein Generator wird geladen).
 *   --stand-vorbereiten       Nur den Stand zu `--commit` anlegen und seinen Pfad ausgeben.
 *   --labor <ordner>          Datenwurzel (Vorgabe `AVESMAPS_TERRAIN_LAB` oder `C:\avesmaps3d-data\terrain-lab`).
 *
 * Ausgabe in `<ausgabeordner>`: `meta.json` (siehe `tools/terrain-lab/docs/lauf.md`), das Hauptraster (`vorschau-2x`, `saat` oder `endgelaende`
 * als `.f32` + `.json` im Austauschformat) und, beim Endgelände mit Zwischenständen, `stufen/<phase>.*`. Die letzte Zeile der Standardausgabe ist
 * ein JSON-Objekt mit dem Pfad der `meta.json`.
 *
 * Ausgang: 0 gut; 1 Fehler im Lauf; 2 falsche Eingabe; 3 Arbeitsbaum unsauber (verweigert); 4 Stand nicht herstellbar.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { auftragFingerprint, AuftragFehler, kanonisch, normalisiere, type Auftrag } from "./auftrag.ts";
import { samplesFingerprint, schreibeRaster } from "./austausch.ts";
import { bereiteEndgelaende } from "./endgelaende.ts";
import { dateiHash, ladeGebirge, loeseRezept } from "./eingabe.ts";
import { ladeGenerator } from "./generator.ts";
import { messe, runde, umgebung } from "./messung.ts";
import { ADAPTER_WURZEL, GENERATOR_PFADE, laborWurzel } from "./pfade.ts";
import { schnappschussFingerprint, standardSchnappschuss } from "./schnappschuss.ts";
import { loeseCommitAuf, pruefeBaum, StandFehler, standZustand, stelleStandBereit, type BaumZustand } from "./stand.ts";
import { bereiteSaat, bereiteVorschau } from "./stufen.ts";
import type { Ausfuehrung, Vorbereitet } from "./typen.ts";

/** Hash über die Dateien des Adapters: Eine Messung trägt, mit welchem Adapter sie entstand (er liegt nicht im gemessenen Stand). */
function adapterHash(): string {
    const h = createHash("sha256");
    const ordner = dirname(fileURLToPath(import.meta.url));
    for (const name of readdirSync(ordner).sort()) {
        h.update(name + "|");
        h.update(readFileSync(join(ordner, name)));
    }
    return h.digest("hex");
}

const META_FORMAT = "avesmaps-terrainlab-lauf";
const META_VERSION = 1;
const NEUSTART_MARKE = "TERRAIN_LAB_NEUSTART";

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        commit: { type: "string" },
        "schmutzig-erlauben": { type: "boolean" },
        warm: { type: "string" },
        phasen: { type: "boolean" },
        "phasen-wiederholungen": { type: "string" },
        arbeiter: { type: "string" },
        "ohne-raster": { type: "boolean" },
        fingerprint: { type: "boolean" },
        "stand-vorbereiten": { type: "boolean" },
        labor: { type: "string" },
    },
});

function ganzeZahl(text: string | undefined, name: string, vorgabe: number, min: number, max: number): number {
    if (text === undefined) return vorgabe;
    const z = Number(text);
    if (!Number.isInteger(z) || z < min || z > max)
        throw new AuftragFehler(`--${name}: ganze Zahl von ${String(min)} bis ${String(max)}`);
    return z;
}

function ausgeben(objekt: unknown): Promise<void> {
    return new Promise((fertig) => process.stdout.write(`${JSON.stringify(objekt)}\n`, () => fertig()));
}

async function beende(code: number): Promise<never> {
    // Die Worker der Erosion halten den Prozess sonst offen.
    await new Promise<void>((fertig) => process.stderr.write("", () => fertig()));
    process.exit(code);
}

/** Das Endgelände braucht `--expose-gc` und viel Heap; ohne beide startet der Adapter sich selbst damit neu. */
function starteNeuMitFlags(): never | void {
    if (process.env[NEUSTART_MARKE] === "1") return;
    if (process.execArgv.includes("--expose-gc") && process.execArgv.some((a) => a.startsWith("--max-old-space-size")))
        return;
    const flags = [
        "--expose-gc",
        ...(process.execArgv.some((a) => a.startsWith("--max-old-space-size")) ? [] : ["--max-old-space-size=8192"]),
    ];
    const r = spawnSync(process.execPath, [...process.execArgv, ...flags, ...process.argv.slice(1)], {
        stdio: "inherit",
        env: { ...process.env, [NEUSTART_MARKE]: "1" },
    });
    process.exit(r.status ?? 1);
}

async function haupt(): Promise<number> {
    const labor = values.labor ?? laborWurzel();

    // 1. Nur den Stand anlegen.
    if (values["stand-vorbereiten"]) {
        if (!values.commit) throw new AuftragFehler("--stand-vorbereiten braucht --commit");
        const s = stelleStandBereit(ADAPTER_WURZEL, values.commit, labor);
        await ausgeben({ stand: s.wurzel, commit: s.commit, neu: s.neu });
        return 0;
    }

    // 2. Auftrag.
    const auftragsDatei = positionals[0];
    if (!auftragsDatei) throw new AuftragFehler("Aufruf: rechne.ts <auftrag.json> <ausgabeordner> [Optionen]");
    const auftrag: Auftrag = normalisiere(
        JSON.parse(readFileSync(auftragsDatei, "utf8")) as unknown,
        basename(auftragsDatei).replace(/\.json$/, ""),
    );
    const inhalte = {
        gebirgeDatei: dateiHash(auftrag),
        schnappschuss:
            auftrag.endgelaende === null
                ? null
                : schnappschussFingerprint(auftrag.endgelaende.schnappschuss ?? standardSchnappschuss(labor)),
    };
    const fingerprint = auftragFingerprint(auftrag, inhalte);
    if (values.fingerprint) {
        // Auch woher der Code käme, ohne einen Stand anzulegen: Der Aufrufer bildet daraus den Schlüssel des Zwischenspeichers.
        const stand = values.commit
            ? { commit: loeseCommitAuf(ADAPTER_WURZEL, values.commit), baum_sauber: true, geaendert: [] as string[] }
            : (({ commit, sauber, geaendert }) => ({ commit, baum_sauber: sauber, geaendert }))(
                  pruefeBaum(ADAPTER_WURZEL),
              );
        await ausgeben({ auftrag_fingerprint: fingerprint, name: auftrag.name, stufe: auftrag.stufe, ...stand });
        return 0;
    }
    const ausgabe = positionals[1];
    if (!ausgabe) throw new AuftragFehler("Ausgabeordner fehlt");

    // 3. Woher der Code kommt.
    let baum: BaumZustand;
    if (values.commit) {
        const s = stelleStandBereit(ADAPTER_WURZEL, values.commit, labor);
        baum = standZustand(s.wurzel, s.commit);
    } else {
        baum = pruefeBaum(ADAPTER_WURZEL);
        if (!baum.sauber && !values["schmutzig-erlauben"]) {
            process.stderr.write(
                `Verweigert: Die Generator-Verzeichnisse (${GENERATOR_PFADE.join(", ")}) weichen von Commit ${baum.commit.slice(0, 12)} ab:\n` +
                    `${baum.geaendert.map((z) => `  ${z}`).join("\n")}\n` +
                    "Gemessen wird nur ein festgelegter Stand. Committen und mit --commit <sha> messen, oder --schmutzig-erlauben (nur Entwicklung).\n",
            );
            return 3;
        }
    }

    if (auftrag.stufe === "endgelaende-lokal") starteNeuMitFlags();
    if (values.arbeiter !== undefined)
        process.env["TERRAIN_EROSION_WORKERS"] = String(ganzeZahl(values.arbeiter, "arbeiter", 2, 0, 8));
    const warm = ganzeZahl(values.warm, "warm", 0, 0, 50);
    const phasenWdh = ganzeZahl(values["phasen-wiederholungen"], "phasen-wiederholungen", 3, 1, 20);
    mkdirSync(ausgabe, { recursive: true });

    // 4. Laden und vorbereiten (nicht gemessen).
    const t0 = performance.now();
    const gen = await ladeGenerator(baum.wurzel);
    const rezept = loeseRezept(gen, auftrag);
    const fall = ladeGebirge(auftrag, baum.wurzel);
    const vorbereitet: Vorbereitet =
        auftrag.stufe === "vorschau"
            ? bereiteVorschau(gen, auftrag, fall, rezept.rezept)
            : auftrag.stufe === "saat"
              ? await bereiteSaat(gen, auftrag, fall, rezept.rezept)
              : await bereiteEndgelaende(gen, auftrag, fall, rezept.rezept, { laborDir: labor });
    const vorbereitung_ms = runde(performance.now() - t0, 1);
    const rss_nach_vorbereitung_mib = runde(process.resourceUsage().maxRSS / 1024, 1);
    // Der Fingerabdruck der WIRKSAMEN Eingabe: aufgelöste Parameter, Gebirgsdatei, Rezept. Zwei Aufträge, die dasselbe rechnen, teilen ihn.
    const eingabe_fingerprint = createHash("sha256")
        .update(
            kanonisch({ gebirge: fall.quelle_sha256, parameter: vorbereitet.parameter, rezept: rezept.fingerprint }),
        )
        .digest("hex");

    // 5. Kalt, dann warm.
    const laeufe: Record<string, unknown>[] = [];
    const kalt = await messe(() => vorbereitet.fuehreAus());
    const kaltFp = samplesFingerprint(kalt.wert.samples);
    laeufe.push({
        art: "kalt",
        ...kalt.messung,
        ...(kalt.wert.zusatz["intern_ms"] === undefined ? {} : { intern_ms: kalt.wert.zusatz["intern_ms"] }),
    });
    let deterministisch = true;
    for (let i = 0; i < warm; i++) {
        const w = await messe(() => vorbereitet.fuehreAus());
        if (samplesFingerprint(w.wert.samples) !== kaltFp) deterministisch = false;
        laeufe.push({
            art: "warm",
            ...w.messung,
            ...(w.wert.zusatz["intern_ms"] === undefined ? {} : { intern_ms: w.wert.zusatz["intern_ms"] }),
        });
    }

    // 6. Phasenproben.
    const lauf: Ausfuehrung = kalt.wert;
    const phasen = values.phasen ? await vorbereitet.phasen(lauf, kaltFp, phasenWdh) : null;

    // 7. Raster.
    const rasterListe: {
        name: string;
        datei: string;
        sha256: string;
        breite: number;
        hoehe: number;
        zellgroesse_m: number;
    }[] = [];
    if (!values["ohne-raster"]) {
        for (const r of lauf.rasters()) {
            const herkunft = {
                ...r.raster.herkunft,
                commit: baum.commit,
                baum: baum.sauber ? "sauber" : "schmutzig",
                auftrag_fingerprint: fingerprint,
                ausrichtung: "Zeile 0 = Nord (vom Generator gespiegelt, dort Zeile 0 = Süd)",
            };
            const ziel = r.name.includes("/") ? join(ausgabe, dirname(r.name)) : ausgabe;
            const g = schreibeRaster(ziel, basename(r.name), { ...r.raster, herkunft });
            rasterListe.push({
                name: r.name,
                datei: join(dirname(r.name), g.datei).split(sep).join("/"),
                sha256: g.sha256,
                breite: g.breite,
                hoehe: g.hoehe,
                zellgroesse_m: g.zellgroesse_m,
            });
        }
    }

    // 8. meta.json
    const meta = {
        format: META_FORMAT,
        version: META_VERSION,
        erzeugt: new Date().toISOString(),
        auftrag,
        auftrag_fingerprint: fingerprint,
        eingabe_fingerprint,
        adapter_sha256: adapterHash(),
        inhalte,
        stufe: auftrag.stufe,
        stand: {
            art: baum.art,
            commit: baum.commit,
            baum_sauber: baum.sauber,
            geaendert: baum.geaendert,
            aenderung_sha256: baum.aenderung_sha256,
            wurzel: baum.wurzel,
            reproduzierbar: baum.sauber,
        },
        rezept: {
            fassung: rezept.fassung,
            fingerprint: rezept.fingerprint,
            basis_fingerprint: rezept.basis_fingerprint,
            ueberlagert: rezept.ueberlagert,
            roh_angewendet: rezept.roh_angewendet,
        },
        gebirge: { name: fall.name, area: fall.area, quelle_sha256: fall.quelle_sha256 },
        parameter: vorbereitet.parameter,
        raster: {
            zellen: lauf.zellen,
            eigene_zellen: lauf.eigene_zellen,
            breite: lauf.form.breite,
            hoehe: lauf.form.hoehe,
            zellgroesse_m: lauf.form.zellgroesse_m,
            ergebnis_fingerprint: kaltFp,
            dateien: rasterListe,
        },
        umgebung: { ...umgebung(), abhaengigkeiten: gen.abhaengigkeiten },
        vorbereitung_ms,
        rss_nach_vorbereitung_mib,
        laeufe,
        deterministisch,
        phasen_ms: lauf.phasen_ms ?? null,
        gruppen_ms: lauf.gruppen_ms ?? null,
        phasenproben: phasen,
        zwischenstaende: lauf.zwischenstaende ?? null,
        zusatz: lauf.zusatz,
    };
    const metaPfad = resolve(ausgabe, "meta.json");
    writeFileSync(metaPfad, JSON.stringify(meta, null, 2), "utf8");
    await ausgeben({
        meta: metaPfad,
        ergebnis_fingerprint: kaltFp,
        kalt_ms: (laeufe[0] as { wall_ms: number }).wall_ms,
        deterministisch,
    });
    return 0;
}

try {
    await beende(await haupt());
} catch (fehler) {
    const text = fehler instanceof Error ? (fehler.stack ?? fehler.message) : String(fehler);
    process.stderr.write(`${text}\n`);
    await beende(fehler instanceof AuftragFehler ? 2 : fehler instanceof StandFehler ? 4 : 1);
}
