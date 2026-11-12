import { createHash } from "node:crypto";
import { createFinding, type Finding } from "../findings.ts";
import { MigrationAborted } from "./places.ts";

/**
 * Die Sprachenkarte als Quelle des Einspielens (WI-0261 S6): die Farbtafel der elf Kartengruppen (T-2) und das Lesen der abgeleiteten
 * GeoJSON (`sprachen-s1.geojson`, Werkzeug `tools/sprachenkarte/s1-ableitung.py`). Rein, ohne Datenbank; die Datenbank-Arbeit steht in
 * `sprachen-import.ts`.
 *
 * Die Datei trägt je Sprache ein Feature (MultiPolygon in Kartenkoordinaten 0..1024, SRID 0) mit `properties.sprache` (Schlüssel),
 * `name` (Name der Legende) und `farbe`. Maßgeblich ist die Tafel hier: Namen und Farben der Datei sind nur Gegenprobe.
 */

export const SPRACHEN_CONTRACT_VERSION = "1";

/** Herkunft der Einträge, Flächen und Zuordnungen dieses Einspielens (Migration 0254, T-1). */
export const HERKUNFT_SPRACHENKARTE = "sprachenkarte";

export type Rgb = readonly [number, number, number];

export interface SprachenTafelEintrag {
    /** Gruppenschlüssel der Farbtafel (T-2). */
    readonly schluessel: string;
    /** Kurzname für Karte und Zeilen. */
    readonly name: string;
    /** Name der Legende der Referenzkarte. */
    readonly legende: string;
    /** Farbe der Legende (RGB der Referenzkarte). */
    readonly rgb: Rgb;
    /** Titel der Wiki-Artikel der Gruppe, in der Reihenfolge der Pillen (Betreiber 2026-10-30: „synce alle wiki daten, weise sie den flächen zu“). */
    readonly wikiArtikel: readonly string[];
}

/**
 * Die Farbtafel des WI (11 Schlüssel). Die Reihenfolge ist die der Legende und wird zu `sprache.reihenfolge` 0 bis 10. Die Wiki-Artikel
 * je Gruppe nach dem Auftrag der Orchestrierung; verglichen wird über die Vergleichsform des Titels (`sprachSchluessel`).
 */
export const SPRACHEN_TAFEL: readonly SprachenTafelEintrag[] = [
    {
        schluessel: "thorwalsch",
        name: "Thorwalsch",
        legende: "Thorwalsch / Gjalskisch / Fjarningsch",
        rgb: [27, 170, 212],
        wikiArtikel: ["Thorwalsch", "Gjalskisch", "Fjarningsch"],
    },
    {
        schluessel: "nujuka",
        name: "Nujuka",
        legende: "Nujuka (Nivesisch)",
        rgb: [38, 129, 112],
        wikiArtikel: ["Nujuka"],
    },
    { schluessel: "isdira", name: "Isdira", legende: "Isdira (Elfisch)", rgb: [120, 159, 42], wikiArtikel: ["Isdira"] },
    {
        schluessel: "orkisch",
        name: "Orkisch",
        legende: "Ologhaijan / Oloarkh (Orkisch)",
        rgb: [96, 76, 52],
        wikiArtikel: ["Ologhaijan", "Oloarkh"],
    },
    {
        schluessel: "goblinisch",
        name: "Goblinisch",
        legende: "Goblinisch",
        rgb: [194, 119, 28],
        wikiArtikel: ["Goblinisch"],
    },
    {
        schluessel: "rogolan",
        name: "Rogolan",
        legende: "Rogolan (Zwergisch)",
        rgb: [127, 119, 116],
        wikiArtikel: ["Rogolan"],
    },
    { schluessel: "garethi", name: "Garethi", legende: "Garethi", rgb: [255, 185, 1], wikiArtikel: ["Garethi"] },
    {
        schluessel: "tulamidya",
        name: "Tulamidya",
        legende: "Tulamidya",
        rgb: [218, 90, 19],
        wikiArtikel: ["Tulamidya"],
    },
    {
        schluessel: "ferkina",
        name: "Ferkina",
        legende: "Ferkina / Zhulchammaqra",
        rgb: [160, 56, 19],
        wikiArtikel: ["Ferkina (Sprache)", "Zhulchammaqra"],
    },
    {
        schluessel: "rssahh",
        name: "Rssahh",
        legende: "Rssahh (Echsisch)",
        rgb: [196, 3, 4],
        wikiArtikel: ["Rssahh"],
    },
    {
        schluessel: "tahaya",
        name: "Tahaya",
        legende: "Tahaya (Waldmenschen und Utulus)",
        rgb: [120, 55, 61],
        wikiArtikel: ["Ta-Haya"],
    },
];

/** `#rrggbb` in Kleinbuchstaben, wie `sprache_farbe_format` (Migration 0254) es verlangt. */
export function farbeHex(rgb: Rgb): string {
    return `#${rgb.map((teil) => teil.toString(16).padStart(2, "0")).join("")}`;
}

/** Die Geometrie eines Features, wie die Datei sie führt. */
export interface SprachenGeometrie {
    type: "Polygon" | "MultiPolygon";
    coordinates: unknown;
}

export interface SprachenMerkmal {
    schluessel: string;
    /** Die Geometrie als JSON-Text, fertig für `ST_GeomFromGeoJSON`. */
    geometrie: string;
}

export interface SprachenKarte {
    /** SHA-256 der Eingabedatei (hex, klein): `sprache_flaeche.quelle_revision` (T-1). */
    sha256: string;
    /** Ein Merkmal je Sprache der Datei, in der Reihenfolge der Tafel. */
    merkmale: SprachenMerkmal[];
    /** Was die Gegenprobe der Datei gegen die Tafel fand (Namen, Farben, fehlende Sprachen). */
    findings: Finding[];
}

function abbruch(grund: string, detail: Record<string, number | string> = {}): never {
    throw new MigrationAborted(`Die Sprachenkarte ist unbrauchbar: ${grund}`, detail);
}

const istObjekt = (wert: unknown): wert is Record<string, unknown> =>
    typeof wert === "object" && wert !== null && !Array.isArray(wert);

/**
 * Liest die GeoJSON der Sprachenkarte aus ihren Bytes (der SHA-256 gehört zu den Bytes, nie zum geparsten Text).
 *
 * Technischer Abbruch (`MigrationAborted`, nichts geschrieben): kein JSON, keine `FeatureCollection`, kein Feature, ein Feature ohne
 * Schlüssel, ein Schlüssel außerhalb der Farbtafel, ein Schlüssel zweimal, eine Geometrie, die weder Polygon noch MultiPolygon ist.
 * Befunde (der Lauf geht weiter): Name oder Farbe der Datei weichen von der Tafel ab, eine Sprache der Tafel fehlt in der Datei.
 */
export function liesSprachenKarte(bytes: Uint8Array): SprachenKarte {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    let roh: unknown;
    try {
        roh = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
        return abbruch("kein gültiges JSON in UTF-8", { sha256 });
    }
    if (!istObjekt(roh) || roh["type"] !== "FeatureCollection" || !Array.isArray(roh["features"])) {
        return abbruch("keine FeatureCollection", { sha256 });
    }
    const features = roh["features"] as unknown[];
    if (features.length === 0) return abbruch("die FeatureCollection ist leer", { sha256 });

    const nachSchluessel = new Map<string, SprachenMerkmal>();
    const abweichungen: string[] = [];
    features.forEach((feature, index) => {
        const stelle = `Feature ${String(index)}`;
        if (!istObjekt(feature)) return abbruch(`${stelle} ist kein Objekt`, { feature: index });
        const eigenschaften = istObjekt(feature["properties"]) ? feature["properties"] : {};
        const schluessel = eigenschaften["sprache"];
        if (typeof schluessel !== "string" || schluessel === "") {
            return abbruch(`${stelle} trägt keinen Schlüssel (properties.sprache)`, { feature: index });
        }
        const tafel = SPRACHEN_TAFEL.find((eintrag) => eintrag.schluessel === schluessel);
        if (tafel === undefined) {
            return abbruch(`Schlüssel „${schluessel}“ steht nicht in der Farbtafel`, { feature: index, schluessel });
        }
        if (nachSchluessel.has(schluessel)) {
            return abbruch(`Schlüssel „${schluessel}“ kommt zweimal vor`, { feature: index, schluessel });
        }
        const geometrie = istObjekt(feature["geometry"]) ? feature["geometry"] : null;
        const art = geometrie?.["type"];
        if (
            geometrie === null ||
            (art !== "Polygon" && art !== "MultiPolygon") ||
            !Array.isArray(geometrie["coordinates"])
        ) {
            return abbruch(`die Geometrie von „${schluessel}“ ist weder Polygon noch MultiPolygon`, {
                feature: index,
                schluessel,
            });
        }
        nachSchluessel.set(schluessel, { schluessel, geometrie: JSON.stringify(geometrie) });
        if (eigenschaften["name"] !== undefined && eigenschaften["name"] !== tafel.legende) {
            abweichungen.push(
                `${schluessel}: name „${String(eigenschaften["name"])}“ statt „${tafel.legende}“ (Legende der Tafel)`,
            );
        }
        const farbe = farbeHex(tafel.rgb);
        if (eigenschaften["farbe"] !== undefined && String(eigenschaften["farbe"]).toLowerCase() !== farbe) {
            abweichungen.push(`${schluessel}: farbe ${String(eigenschaften["farbe"])} statt ${farbe} (Farbtafel)`);
        }
    });

    const findings: Finding[] = [];
    if (abweichungen.length > 0) {
        findings.push(
            createFinding(
                "datei_weicht_von_farbtafel_ab",
                "Namen oder Farben der Datei weichen von der Farbtafel ab; eingespielt wird die Tafel",
                { abweichungen: abweichungen.length },
                [],
                0,
                abweichungen,
            ),
        );
    }
    const fehlend = SPRACHEN_TAFEL.filter((eintrag) => !nachSchluessel.has(eintrag.schluessel));
    if (fehlend.length > 0) {
        findings.push(
            createFinding(
                "sprache_ohne_flaeche_in_datei",
                "Die Datei führt für diese Sprachen der Farbtafel keine Fläche; die Einträge entstehen trotzdem",
                { sprachen: fehlend.length },
                [],
                0,
                [fehlend.map((eintrag) => eintrag.schluessel).join(", ")],
            ),
        );
    }
    return {
        sha256,
        merkmale: SPRACHEN_TAFEL.flatMap((eintrag) => nachSchluessel.get(eintrag.schluessel) ?? []),
        findings,
    };
}
