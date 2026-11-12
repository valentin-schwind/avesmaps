import {
    GEBIRGS_HOEHENSTUFEN,
    GEBIRGS_WERT_GRENZEN,
    GEBIRGS_WERTE,
    GEBIRGSTYPEN,
    HOEHENMODELL_REGLER,
    katalogWert,
    mitTypwert,
    typVorschlag,
    typwert,
    typwertGrenze,
    type Gebirgstyp,
    type HoehenmodellTestWerte,
    type RueckennetzTyp,
} from "@avesmaps3d/shared";
import { parseTerrainRecipe, type TerrainRecipe } from "./recipes.ts";

/**
 * Die Werte von „19 (Test)“ über der Datei einer offenen Fassung (WI-0240; Betreiber 2026-10-19: „wir ändern eigenschaften von test 19
 * live auf der stage bis das modell brauchbare ergebnisse liefert“). Rein, ohne Datenbank: `resolveTerrainRecipe` legt sie über die Datei,
 * die Handlungen prüfen und speichern sie (`terrain/hoehenmodell-test.ts`).
 *
 * - **Was geht:** die freigegebenen Regler (`HOEHENMODELL_REGLER`, wie die Entwürfe), alle übrigen Werte des Katalogs
 *   (`HOEHENMODELL_KATALOG`, je Pfad in `werte.rezept`; Betreiber 2026-10-20: „wenn schon dann richtig“) und die Gebirgs-Presets je Typ, Wert, Muster und
 *   Höhenstufe (Betreiber F3: „die presets sollen im höhenmodell editiert werden können“), dazu die Typwerte des Rückennetzes
 *   (`RUECKENNETZ_TYPWERTE`, WI-0246; fehlen sie in der Fassung, liegen sie über dem Vorschlag im Code). Das ganze Rezept prüft danach
 *   dasselbe Schema wie die Dateien.
 * - 🔴 **Gleich der Datei heißt: nicht da.** `bereinigt` streicht jeden Wert, der dem der Datei gleicht; ohne Werte ist das Ergebnis die
 *   Datei selbst (dasselbe Objekt, derselbe Inhaltsfingerabdruck). So bleibt ein Master aus der Datei gültig, wenn jemand alles auf die
 *   Datei zurücksetzt, und ein Stand, der als Datei ins Repository geht, rechnet bytegleich weiter.
 */

export class TestWerteFehler extends Error {}

type Tree = Record<string, unknown>;

const istRegional = (recipe: TerrainRecipe): boolean => recipe.generator.uplift?.kind === "regional";

function knoten(recipe: Tree, pfad: readonly string[], id: string): Tree {
    let node = recipe;
    for (const key of pfad.slice(0, -1)) {
        const next = node[key];
        if (typeof next !== "object" || next === null)
            throw new TestWerteFehler(`${id}: gibt es in dieser Fassung nicht.`);
        node = next as Tree;
    }
    return node;
}

/** Keine Werte: weder Regler noch Presets. */
export function leer(werte: HoehenmodellTestWerte): boolean {
    const presets = werte.presets;
    return (
        Object.keys(werte.regler ?? {}).length === 0 &&
        Object.keys(werte.rezept ?? {}).length === 0 &&
        Object.keys(presets?.typen ?? {}).length === 0 &&
        Object.keys(presets?.hoehenstufen ?? {}).length === 0
    );
}

/** Die Datei mit den Werten von „19 (Test)“; ohne Werte die Datei selbst. Wirft `TestWerteFehler` bei einem Wert außerhalb der Freigabe. */
export function mitTest(basis: TerrainRecipe, werte: HoehenmodellTestWerte): TerrainRecipe {
    if (leer(werte)) return basis;
    const recipe = structuredClone(basis) as unknown as Tree;
    for (const [id, value] of Object.entries(werte.regler ?? {})) {
        const regler = HOEHENMODELL_REGLER.find((entry) => entry.id === id);
        if (!regler) throw new TestWerteFehler(`Der Regler ${id} ist nicht freigegeben.`);
        if (!Number.isFinite(value)) throw new TestWerteFehler(`${id}: keine Zahl.`);
        if (regler.ganz && !Number.isInteger(value)) throw new TestWerteFehler(`${id}: nur ganze Zahlen.`);
        if (value < regler.min) throw new TestWerteFehler(`${id}: kleiner als erlaubt.`);
        if (regler.max !== null && value > regler.max) throw new TestWerteFehler(`${id}: größer als erlaubt.`);
        if (regler.nurRegional && !istRegional(basis))
            throw new TestWerteFehler(`${id}: Fassung ${String(basis.version)} hat keine regionale Rückverteilung.`);
        knoten(recipe, regler.pfad, id)[regler.pfad.at(-1)!] = value;
    }
    for (const [pfad, value] of Object.entries(werte.rezept ?? {})) {
        const eintrag = katalogWert(pfad);
        // Ein Regler geht über `werte.regler` (eine Stelle je Wert), Unbekanntes und Technik gar nicht.
        if (eintrag === undefined || eintrag.regler !== undefined)
            throw new TestWerteFehler(`Der Wert ${pfad} ist nicht freigegeben.`);
        if (!Number.isFinite(value)) throw new TestWerteFehler(`${pfad}: keine Zahl.`);
        if (eintrag.ganz && !Number.isInteger(value)) throw new TestWerteFehler(`${pfad}: nur ganze Zahlen.`);
        if (value < eintrag.min) throw new TestWerteFehler(`${pfad}: kleiner als erlaubt.`);
        if (eintrag.max !== null && value > eintrag.max) throw new TestWerteFehler(`${pfad}: größer als erlaubt.`);
        const teile = pfad.split(".");
        const ziel = knoten(recipe, teile, pfad);
        if (typeof ziel[teile.at(-1)!] !== "number")
            throw new TestWerteFehler(`${pfad}: gibt es in dieser Fassung nicht.`);
        ziel[teile.at(-1)!] = value;
    }
    const presets = werte.presets;
    if (
        presets !== undefined &&
        (Object.keys(presets.typen ?? {}).length > 0 || Object.keys(presets.hoehenstufen ?? {}).length > 0)
    ) {
        const gruppe = recipe["gebirgsPresets"] as Tree | undefined;
        if (gruppe === undefined)
            throw new TestWerteFehler(`Fassung ${String(basis.version)} trägt keine Gebirgs-Presets.`);
        for (const [typ, preset] of Object.entries(presets.typen ?? {})) {
            if (!(GEBIRGSTYPEN as readonly string[]).includes(typ))
                throw new TestWerteFehler(`Unbekannter Gebirgstyp ${typ}.`);
            const ziel = (gruppe["typen"] as Tree)[typ] as Tree;
            for (const [wert, value] of Object.entries(preset.werte ?? {})) {
                if (!(GEBIRGS_WERTE as readonly string[]).includes(wert))
                    throw new TestWerteFehler(`${typ}: unbekannter Wert ${wert}.`);
                if (!Number.isFinite(value)) throw new TestWerteFehler(`${typ}.${wert}: keine Zahl.`);
                // Die Grenzen des Gebirge-Reiters (`GEBIRGS_WERT_GRENZEN`); das Schema der Datei prüft nur „Zahl“.
                const { min, max, schritt } = GEBIRGS_WERT_GRENZEN[wert as keyof typeof GEBIRGS_WERT_GRENZEN];
                if (schritt === 1 && !Number.isInteger(value))
                    throw new TestWerteFehler(`${typ}.${wert}: nur ganze Zahlen.`);
                if (value < min) throw new TestWerteFehler(`${typ}.${wert}: kleiner als erlaubt.`);
                if (value > max) throw new TestWerteFehler(`${typ}.${wert}: größer als erlaubt.`);
                (ziel["werte"] as Tree)[wert] = value;
            }
            if (preset.muster !== undefined) ziel["muster"] = preset.muster;
            if (preset.rueckennetz !== undefined && Object.keys(preset.rueckennetz).length > 0) {
                let rueckennetz = rueckennetzDerDatei(ziel, typ as Gebirgstyp);
                for (const [id, value] of Object.entries(preset.rueckennetz)) {
                    const g = typwertGrenze(id);
                    if (g === undefined) throw new TestWerteFehler(`${typ}: unbekannter Typwert ${id}.`);
                    if (!Number.isFinite(value)) throw new TestWerteFehler(`${typ}.${id}: keine Zahl.`);
                    if (g.schritt === 1 && !Number.isInteger(value))
                        throw new TestWerteFehler(`${typ}.${id}: nur ganze Zahlen.`);
                    if (value < g.min) throw new TestWerteFehler(`${typ}.${id}: kleiner als erlaubt.`);
                    if (value > g.max) throw new TestWerteFehler(`${typ}.${id}: größer als erlaubt.`);
                    rueckennetz = mitTypwert(rueckennetz, id, value);
                }
                ziel["rueckennetz"] = rueckennetz;
            }
        }
        for (const [stufe, value] of Object.entries(presets.hoehenstufen ?? {})) {
            if (!(GEBIRGS_HOEHENSTUFEN as readonly string[]).includes(stufe))
                throw new TestWerteFehler(`Unbekannte Höhenstufe ${stufe}.`);
            if (!Number.isFinite(value)) throw new TestWerteFehler(`${stufe}: keine Zahl.`);
            (gruppe["hoehenstufen"] as Tree)[stufe] = value;
        }
    }
    try {
        return parseTerrainRecipe(recipe);
    } catch (error) {
        throw new TestWerteFehler(error instanceof Error ? error.message : "Das Rezept ist ungültig.");
    }
}

function wertBei(recipe: TerrainRecipe, pfad: readonly string[]): unknown {
    let node: unknown = recipe;
    for (const key of pfad) {
        if (typeof node !== "object" || node === null) return undefined;
        node = (node as Tree)[key];
    }
    return node;
}

/** Die Typwerte eines Typs in der Datei, sonst der Vorschlag im Code. */
function rueckennetzDerDatei(preset: Tree | undefined, typ: Gebirgstyp): RueckennetzTyp {
    return (preset?.["rueckennetz"] as RueckennetzTyp | undefined) ?? typVorschlag(typ);
}

/** Nur was von der Datei abweicht (siehe Kopf); ein leeres Ergebnis heißt „wie die Datei“. */
export function bereinigt(basis: TerrainRecipe, werte: HoehenmodellTestWerte): HoehenmodellTestWerte {
    const regler = Object.fromEntries(
        Object.entries(werte.regler ?? {}).filter(([id, value]) => {
            const eintrag = HOEHENMODELL_REGLER.find((entry) => entry.id === id);
            return eintrag === undefined || wertBei(basis, eintrag.pfad) !== value;
        }),
    );
    const rezept = Object.fromEntries(
        Object.entries(werte.rezept ?? {}).filter(([pfad, value]) => wertBei(basis, pfad.split(".")) !== value),
    );
    const datei = basis.gebirgsPresets;
    const typen = Object.fromEntries(
        Object.entries(werte.presets?.typen ?? {}).flatMap(([typ, preset]) => {
            const vorher = datei?.typen[typ as keyof typeof datei.typen];
            const werteJeTyp = Object.fromEntries(
                Object.entries(preset.werte ?? {}).filter(
                    ([wert, value]) => vorher?.werte[wert as keyof typeof vorher.werte] !== value,
                ),
            );
            const muster = preset.muster !== undefined && preset.muster !== vorher?.muster ? preset.muster : undefined;
            const typwerte = rueckennetzDerDatei(vorher as Tree | undefined, typ as Gebirgstyp);
            const rueckennetz = Object.fromEntries(
                Object.entries(preset.rueckennetz ?? {}).filter(([id, value]) => typwert(typwerte, id) !== value),
            );
            const rest = {
                ...(Object.keys(werteJeTyp).length > 0 ? { werte: werteJeTyp } : {}),
                ...(muster !== undefined ? { muster } : {}),
                ...(Object.keys(rueckennetz).length > 0 ? { rueckennetz } : {}),
            };
            return Object.keys(rest).length > 0 ? [[typ, rest]] : [];
        }),
    );
    const hoehenstufen = Object.fromEntries(
        Object.entries(werte.presets?.hoehenstufen ?? {}).filter(
            ([stufe, value]) => datei?.hoehenstufen[stufe as keyof typeof datei.hoehenstufen] !== value,
        ),
    );
    const presets = {
        ...(Object.keys(typen).length > 0 ? { typen } : {}),
        ...(Object.keys(hoehenstufen).length > 0 ? { hoehenstufen } : {}),
    };
    return {
        ...(Object.keys(regler).length > 0 ? { regler } : {}),
        ...(Object.keys(rezept).length > 0 ? { rezept } : {}),
        ...(Object.keys(presets).length > 0 ? { presets } : {}),
    };
}
