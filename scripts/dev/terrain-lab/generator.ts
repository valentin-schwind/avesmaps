/**
 * Der Generator als Rechenkern (WI-0250 Phase B): lädt die öffentlichen Funktionen des gemessenen Stands und sonst nichts. Die Typen hier
 * sind die Teile der Schnittstelle, die der Adapter liest; sie nennen keine Interna der Gebirgsrechnung. Fehlt eine Funktion in einem
 * (älteren) Stand, sagt `fordere`, welche und in welchem Commit.
 *
 * Die Module werden von der Wurzel des Stands per `import()` geladen (nach `registriere`, das `@avesmaps3d/shared` auf die Quellen dieses
 * Stands legt). Der Adapter selbst importiert nichts aus dem Generator: Er läuft in jedem Checkout und misst jeden Stand.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire, register } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export interface Grenzen {
    min_x: number;
    min_y: number;
    max_x: number;
    max_y: number;
}

/** Ein V12-Raster (Schritt, Zeile 0 = Süd). `h` ist je nach Rechnung Float32 oder Float64. */
export interface GebirgsRaster {
    w: number;
    hh: number;
    cell: number;
    bounds: Grenzen;
    eigen: Uint8Array;
    h: ArrayLike<number>;
    talboden?: number;
}

export interface RueckenErgebnis extends GebirgsRaster {
    talboden: number;
    senke: Uint8Array;
    nebengipfel: { x: number; y: number; h: number }[];
}

export type Eingabe = Record<string, unknown>;

export interface GebirgeApi {
    buildMountainRaster(eingabe: Eingabe): GebirgsRaster & { leer: boolean };
    gebirgsRegler(preset: unknown, stand: unknown, grundhoehe: number | null): Record<string, unknown>;
    rechneRueckennetz(eingabe: Eingabe, typ: unknown, optionen?: Record<string, unknown>): RueckenErgebnis;
    /** Die Weiche Rückennetz oder V12 (`rechnetRueckennetz`, WI-0249 P2); fehlt in Ständen davor (dann gilt: Kämme oder Mulden). */
    rechnetRueckennetz: ((netz: Record<string, unknown>, kopf: number | undefined) => boolean) | null;
    rueckennetzRegler(
        gruppe: unknown,
        typ: string | null,
        abweichung: Record<string, number>,
        durchschnittshoehe?: number | null,
    ): Record<string, unknown> & {
        struktur: unknown;
        form: unknown;
        band: unknown;
        gratMin: number;
        talbodenFest: number | null;
        mittelZiel: number | null;
    };
}

export interface VorschauErgebnis extends GebirgsRaster {
    ms: number;
    talboden?: number;
}

export interface Rezept {
    version: number;
    generator: Record<string, unknown> & {
        size: number;
        iterations: number;
        seed: number;
        fine?: Record<string, unknown> & { size: number; tiles: number };
    };
    gebirgsPresets?: { typen: Record<string, unknown> };
    /** Formerhalt der Rückennetz-Gebirge (WI-0249 P2); fehlt der Eintrag (Fassung 17 und 18), rechnet alles wie zuvor. */
    mountainMorphology?: { rueckennetz?: Record<string, unknown> };
}

/** Das Gitter des Geländes für Rückennetz-Saaten (WI-0249 P2, `RueckennetzRegler.gitter`). */
export interface RueckennetzGitter {
    zelle: number;
    mitte: number;
}

export interface RezeptApi {
    alle: ReadonlyMap<number, Rezept>;
    vorgabeFassung: number;
    fingerprint(rezept: Rezept): string;
    /** Überlagerung „19 (Test)“; fehlt in Ständen vor WI-0240. */
    mitTest: ((basis: Rezept, werte: Record<string, unknown>) => Rezept) | null;
}

export interface Generator {
    wurzel: string;
    gebirge: GebirgeApi;
    rechneVorschau(auftrag: Record<string, unknown>): VorschauErgebnis;
    rezepte: RezeptApi;
    /** Fassungen der Drittpakete, wie sie der Stand lädt. */
    abhaengigkeiten: Record<string, string | null>;
}

let registriertFuer: string | null = null;

/** Legt `@avesmaps3d/shared` auf die Quellen der Wurzel. Einmal je Prozess; eine zweite, andere Wurzel ist ein Fehler. */
export function registriere(wurzel: string): void {
    if (registriertFuer === wurzel) return;
    if (registriertFuer !== null) throw new Error(`Modulauflösung ist schon für ${registriertFuer} gesetzt`);
    register(new URL("./modul-hook.mjs", import.meta.url), { parentURL: import.meta.url, data: { wurzel } });
    registriertFuer = wurzel;
}

export function fordere<T>(wert: T | undefined, name: string, wurzel: string): T {
    if (wert === undefined || wert === null) throw new Error(`Schnittstelle fehlt im Stand ${wurzel}: ${name}`);
    return wert;
}

/** Lädt ein Modul des Stands; fehlt die Datei (älterer Commit), sagt der Fehler, welche. */
export async function ladeModul(wurzel: string, relativ: string): Promise<Record<string, unknown>> {
    const pfad = join(wurzel, relativ);
    if (!existsSync(pfad))
        throw new Error(`Schnittstelle fehlt im Stand ${wurzel}: Datei ${relativ} gibt es in diesem Commit nicht`);
    return (await import(pathToFileURL(pfad).href)) as Record<string, unknown>;
}

/** Die Fassung eines Drittpakets, wie `apps/server/src` es lädt: vom aufgelösten Einstieg aufwärts bis zur `package.json` des Pakets. */
function fassungVon(wurzel: string, paket: string): string | null {
    try {
        const require = createRequire(pathToFileURL(join(wurzel, "apps", "server", "src", "x.ts")));
        let ordner = dirname(require.resolve(paket));
        for (let i = 0; i < 6; i++) {
            const datei = join(ordner, "package.json");
            if (existsSync(datei)) {
                const kopf = JSON.parse(readFileSync(datei, "utf8")) as { name?: string; version?: string };
                if (kopf.name === paket) return kopf.version ?? null;
            }
            ordner = dirname(ordner);
        }
        return null;
    } catch {
        return null;
    }
}

/** Lädt Vorschau, Gebirgsrechnung und Rezepte der Wurzel. Domain-Module (Endgelände) lädt erst `domain.ts`. */
export async function ladeGenerator(wurzel: string): Promise<Generator> {
    registriere(wurzel);
    const gebirge = await ladeModul(wurzel, "packages/shared/src/gebirge/browser.ts");
    const vorschau = await ladeModul(wurzel, "apps/web/src/gebirge-vorschau/rechnen.ts");
    const rezepte = await ladeModul(wurzel, "apps/server/src/terrain/domain/recipes.ts");
    // `recipe-test.ts` gibt es erst seit WI-0240; ein älterer Stand rechnet ohne Überlagerung.
    const mitTest = await ladeModul(wurzel, "apps/server/src/terrain/domain/recipe-test.ts").then(
        (test) => (test["mitTest"] as RezeptApi["mitTest"]) ?? null,
        () => null,
    );
    const auswahl = fordere(rezepte["AVENTURIA_TERRAIN_SELECTION"], "AVENTURIA_TERRAIN_SELECTION", wurzel) as {
        recipe: Rezept;
    };
    return {
        wurzel,
        gebirge: {
            buildMountainRaster: fordere(
                gebirge["buildMountainRaster"],
                "buildMountainRaster",
                wurzel,
            ) as GebirgeApi["buildMountainRaster"],
            gebirgsRegler: fordere(gebirge["gebirgsRegler"], "gebirgsRegler", wurzel) as GebirgeApi["gebirgsRegler"],
            rechneRueckennetz: fordere(
                gebirge["rechneRueckennetz"],
                "rechneRueckennetz",
                wurzel,
            ) as GebirgeApi["rechneRueckennetz"],
            rueckennetzRegler: fordere(
                gebirge["rueckennetzRegler"],
                "rueckennetzRegler",
                wurzel,
            ) as GebirgeApi["rueckennetzRegler"],
            rechnetRueckennetz: (gebirge["rechnetRueckennetz"] as GebirgeApi["rechnetRueckennetz"] | undefined) ?? null,
        },
        rechneVorschau: fordere(vorschau["rechneVorschau"], "rechneVorschau", wurzel) as Generator["rechneVorschau"],
        rezepte: {
            alle: fordere(rezepte["AVENTURIA_TERRAIN_RECIPES"], "AVENTURIA_TERRAIN_RECIPES", wurzel) as ReadonlyMap<
                number,
                Rezept
            >,
            vorgabeFassung: auswahl.recipe.version,
            fingerprint: fordere(rezepte["recipeFingerprint"], "recipeFingerprint", wurzel) as RezeptApi["fingerprint"],
            mitTest,
        },
        abhaengigkeiten: {
            "@sinclair/typebox": fassungVon(wurzel, "@sinclair/typebox"),
            postgres: fassungVon(wurzel, "postgres"),
        },
    };
}

/**
 * Rechnet ein Gebirge mit diesem Netz das Rückennetz statt der V12? Dieselbe Weiche wie Gelände und Vorschau (`rechnetRueckennetz`); in Ständen vor
 * WI-0249 P2 die alte Regel (Kämme oder Mulden).
 */
export function mitRueckennetz(
    gen: Generator,
    netz: { kaemme: readonly unknown[]; mulden: readonly unknown[]; nebengipfel: readonly unknown[] },
    kopf: number | undefined,
): boolean {
    if (gen.gebirge.rechnetRueckennetz) return gen.gebirge.rechnetRueckennetz(netz, kopf);
    return netz.kaemme.length > 0 || netz.mulden.length > 0;
}

/**
 * Das Gitter des Geländes für die Saat, so wie der Server es dem Auftrag des Gebirges mitgibt (`rueckennetzGitter` in `apps/server/src/terrain/inputs.ts`,
 * WI-0249 P2 Schritt 2): nur mit dem Formerhalt der Fassung (`mountainMorphology.rueckennetz`), sonst `null` und die Saat rechnet ab dem Rahmen der Fläche. Die
 * Funktion des Servers selbst wird aufgerufen, nicht nachgebaut: Das Lab misst sonst einen anderen Generator als die Stage.
 */
export async function rueckennetzGitter(gen: Generator, rezept: Rezept): Promise<RueckennetzGitter | null> {
    if (!rezept.mountainMorphology?.rueckennetz) return null;
    const m = await ladeModul(gen.wurzel, "apps/server/src/terrain/inputs.ts");
    const f = fordere(m["rueckennetzGitter"], "rueckennetzGitter", gen.wurzel) as (
        r: Rezept,
    ) => RueckennetzGitter | null;
    return f(rezept);
}

/**
 * Das gezeichnete Netz eines Rückennetz-Gebirges für den Formerhalt der Domäne (`rueckennetzNetz`, WI-0249 P2): Der Server hängt es an den Eintrag des
 * Gebirges in den Eingaben des Geländes. `null` in Ständen davor (dann kennt die Domäne keinen Formerhalt).
 */
export async function rueckennetzNetz(gen: Generator, input: Record<string, unknown>): Promise<unknown> {
    const m = await ladeModul(gen.wurzel, "apps/server/src/terrain/domain/rueckennetz-flaechen.ts");
    const f = m["rueckennetzNetz"] as ((i: Record<string, unknown>) => unknown) | undefined;
    return f === undefined ? null : f(input);
}
