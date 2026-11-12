/**
 * Parametergrenzen des Generators als JSON (WI-0250 Phase A4): Was der Optimierer verstellen darf, steht hier aus den Verträgen des Generators und
 * ist nirgends abgeschrieben. Gelesen werden die Vertragsdateien des gemessenen Stands:
 *
 *   - `GEBIRGS_WERT_GRENZEN`, `GEBIRGS_MUSTER`, `GEBIRGS_WERTE`, `GEBIRGSTYPEN`, `GEBIRGS_KAMMHOEHE` (`packages/shared/src/gebirge/regler.ts`),
 *   - `GEBIRGS_MODELL_GRENZEN` (`modell-werte.ts`),
 *   - `RUECKENNETZ_TYPWERTE` und `typwert` (`rueckennetz/typwerte.ts`),
 *   - `typVorschlag` (`rueckennetz/typen.ts`) und die Presets der Fassung (`gebirgsPresets` in `config/terrain/aventuria/<n>.json`).
 *
 *   node scripts/dev/terrain-lab/grenzen.ts [--commit <sha>] [--fassung <n>] [--labor <ordner>]
 *
 * Ausgabe: ein JSON-Objekt auf der Standardausgabe (eine Zeile, `format: avesmaps-terrainlab-grenzen`). `basis` ist je Typ der WIRKSAME
 * Ausgangspunkt (Fassung, sonst der Vorschlag im Code), `quelle` sagt woher. Ein Wert mit `schritt` 1 muss ganzzahlig sein (so prüft es
 * `mitTest`, die Überlagerung „19 (Test)“, aus der der Optimierer seine Kandidaten baut).
 *
 * Ausgang: 0 gut; 1 Fehler; 2 falsche Eingabe; 4 Stand nicht herstellbar.
 */
import { parseArgs } from "node:util";
import { ladeModul, registriere } from "./generator.ts";
import { ADAPTER_WURZEL, laborWurzel } from "./pfade.ts";
import { loeseCommitAuf, pruefeBaum, StandFehler, stelleStandBereit } from "./stand.ts";

const FORMAT = "avesmaps-terrainlab-grenzen";

const { values } = parseArgs({
    options: { commit: { type: "string" }, fassung: { type: "string" }, labor: { type: "string" } },
});

type Objekt = Record<string, unknown>;

function nimm<T>(modul: Objekt, name: string, wurzel: string): T {
    const wert = modul[name];
    if (wert === undefined) throw new Error(`Schnittstelle fehlt im Stand ${wurzel}: ${name}`);
    return wert as T;
}

async function haupt(): Promise<number> {
    const labor = values.labor ?? laborWurzel();
    let wurzel: string;
    let stand: { art: string; commit: string; baum_sauber: boolean };
    if (values.commit) {
        const s = stelleStandBereit(ADAPTER_WURZEL, values.commit, labor);
        wurzel = s.wurzel;
        stand = { art: "stand", commit: s.commit, baum_sauber: true };
    } else {
        const b = pruefeBaum(ADAPTER_WURZEL);
        wurzel = b.wurzel;
        stand = { art: "arbeitsbaum", commit: b.commit, baum_sauber: b.sauber };
    }
    registriere(wurzel);
    const regler = await ladeModul(wurzel, "packages/shared/src/gebirge/regler.ts");
    const modell = await ladeModul(wurzel, "packages/shared/src/gebirge/modell-werte.ts");
    const typwerte = await ladeModul(wurzel, "packages/shared/src/gebirge/rueckennetz/typwerte.ts");
    const typen = await ladeModul(wurzel, "packages/shared/src/gebirge/rueckennetz/typen.ts");
    const rezepte = await ladeModul(wurzel, "apps/server/src/terrain/domain/recipes.ts");

    const GEBIRGSTYPEN = nimm<readonly string[]>(regler, "GEBIRGSTYPEN", wurzel);
    const GEBIRGS_MUSTER = nimm<readonly string[]>(regler, "GEBIRGS_MUSTER", wurzel);
    const GEBIRGS_WERTE = nimm<readonly string[]>(regler, "GEBIRGS_WERTE", wurzel);
    const GRENZEN = nimm<Record<string, Objekt>>(regler, "GEBIRGS_WERT_GRENZEN", wurzel);
    const KAMMHOEHE = nimm<Objekt>(regler, "GEBIRGS_KAMMHOEHE", wurzel);
    const VORGABE = nimm<{ typen: Record<string, { werte: Objekt; muster: string }> }>(
        regler,
        "GEBIRGS_PRESETS_VORGABE",
        wurzel,
    );
    const MODELL = nimm<Record<string, Objekt>>(modell, "GEBIRGS_MODELL_GRENZEN", wurzel);
    const TYPWERTE = nimm<readonly Objekt[]>(typwerte, "RUECKENNETZ_TYPWERTE", wurzel);
    const typwert = nimm<(typ: unknown, id: string) => number>(typwerte, "typwert", wurzel);
    const typVorschlag = nimm<(typ: string) => unknown>(typen, "typVorschlag", wurzel);
    const alle = nimm<ReadonlyMap<number, { version: number; gebirgsPresets?: { typen: Record<string, Objekt> } }>>(
        rezepte,
        "AVENTURIA_TERRAIN_RECIPES",
        wurzel,
    );
    const auswahl = nimm<{ recipe: { version: number } }>(rezepte, "AVENTURIA_TERRAIN_SELECTION", wurzel);

    const fassung = values.fassung === undefined ? auswahl.recipe.version : Number(values.fassung);
    const rezept = alle.get(fassung);
    if (!rezept)
        throw new Error(
            `Fassung ${String(fassung)} gibt es im Stand nicht (vorhanden: ${[...alle.keys()].join(", ")})`,
        );

    const basis: Record<string, unknown> = {};
    for (const typ of GEBIRGSTYPEN) {
        const preset = rezept.gebirgsPresets?.typen[typ] as
            { werte: Objekt; muster: string; rueckennetz?: unknown } | undefined;
        const aus = preset ?? VORGABE.typen[typ];
        const netz = preset?.rueckennetz ?? typVorschlag(typ);
        basis[typ] = {
            quelle: preset === undefined ? "code" : "fassung",
            rueckennetz_quelle: preset?.rueckennetz === undefined ? "vorschlag-code" : "fassung",
            werte: aus?.werte ?? null,
            muster: aus?.muster ?? null,
            rueckennetz: Object.fromEntries(TYPWERTE.map((t) => [String(t["id"]), typwert(netz, String(t["id"]))])),
        };
    }
    const ausgabe = {
        format: FORMAT,
        version: 1,
        stand,
        fassung,
        fassung_hat_presets: rezept.gebirgsPresets !== undefined,
        typen: [...GEBIRGSTYPEN],
        muster: [...GEBIRGS_MUSTER],
        v12: { werte: [...GEBIRGS_WERTE], grenzen: GRENZEN, kammhoehe: KAMMHOEHE },
        modell: MODELL,
        rueckennetz: TYPWERTE,
        basis,
    };
    await new Promise<void>((fertig) => process.stdout.write(`${JSON.stringify(ausgabe)}\n`, () => fertig()));
    return 0;
}

try {
    if (values.commit) loeseCommitAuf(ADAPTER_WURZEL, values.commit);
    process.exit(await haupt());
} catch (fehler) {
    process.stderr.write(`${fehler instanceof Error ? (fehler.stack ?? fehler.message) : String(fehler)}\n`);
    process.exit(fehler instanceof StandFehler ? 4 : 1);
}
