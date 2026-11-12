import {
    WATER_CARTOGRAPHY_LAYER,
    cartographyForType,
    editorPathGroupKey,
    isWaterPathSubtype,
    landscapeReaderName,
    pathChainKey,
    type LandscapeLayer,
} from "@avesmaps3d/shared";

/**
 * Welche Flächen unter dem Zeiger liegen, und welche ein Klick nimmt (WI-0043 Stufe 2, Betreiber 2026-09-28:
 * „A+B+C“). Vorher gewann die oberste gezeichnete Fläche, und welche das war, entschied die Reihenfolge in
 * der Kachel: für den Menschen der Zufall.
 *
 * 🔴 Die Reihenfolge ist fest: die kleinste Fläche zuerst (ein Tal im Gebirge ist das Tal), bei gleicher Größe
 * die Kennung. Ein zweiter Klick an derselben Stelle nimmt die nächstgrößere, nach der größten wieder die
 * kleinste. Die Größe kommt aus der Kachel (`area`, Migration 0052); fehlt sie, steht die Fläche hinten.
 */

export interface AreaCandidate {
    /**
     * Eine Landschaftsfläche, ein Weg (Straße, Pfad, Pass oder Fluss - WI-0090; davor nur der Fluss, Betreiber
     * 2026-09-28: „flüsse und seen … anklicken“) oder ein Herrschaftsgebiet der politischen Ansicht (WI-0062).
     */
    kind: "landscape" | "path" | "territory";
    /**
     * `region.public_id`; beim Weg der Kettenschlüssel der Suche `name:<Name>`, ohne echten Namen `#<public_id>` (sein Abschnitt,
     * `editorPathGroupKey`); beim Gebiet `territory.public_id`.
     */
    id: string;
    /** Wie ein Leser sie sieht; `null`, wo nur ein Griff steht („Wald-925“). */
    name: string | null;
    type: string;
    /**
     * Die Landschaftsebene (WI-0083): Daran hängt, in welcher Ansicht der Kandidat teilnimmt (`areaLayersInView`).
     * Eine Fläche trägt die ihrer Region, ein Fluss die des WASSERS (WI-0083 Nachtrag); ein Gebiet hat keine.
     */
    layer?: LandscapeLayer;
    /**
     * Fläche des Polygons in E²; ein Weg hat 0.
     *
     * 🪤 Die 0 hielt den Fluss vor jeder Fläche unter ihm, solange beide EINE Kandidatenliste waren. Seit WI-0090
     * entscheidet das der Rang (`path` 45 über `area` 40); die 0 bleibt, weil ein Weg keine Fläche hat.
     */
    area: number;
    /** Nur beim Fluss: ein Bach? Dann heißt er im Zeiger-Schild so. */
    bach?: boolean;
}

/**
 * Die Landschaftsebene einer Fläche (WI-0083).
 *
 * 🪤 Zwei Quellen, eine Antwort: Die Landschaftskacheln führen `region_layer` selbst, die geglättete
 * Wasserquelle (`terrain_water_render`) nur die Art. Wo das Feld fehlt, sagt die Kartografie-Tafel die Ebene
 * zur Art (`see` und `meer` liegen in der Topographie) - keine zweite Liste, die weglaufen kann.
 */
function layerOf(properties: Readonly<Record<string, unknown>>, type: string): LandscapeLayer | undefined {
    const own = properties["region_layer"];
    if (typeof own === "string" && own !== "") return own as LandscapeLayer;
    return type === "" ? undefined : (cartographyForType(type).layer as LandscapeLayer);
}

/** Die Flächen aus gezeichneten Features, je Region einmal, kleinste zuerst; ohne die für Klicks gesperrten. */
export function areaCandidates(
    features: readonly { properties: Readonly<Record<string, unknown>> }[],
): AreaCandidate[] {
    const byId = new Map<string, AreaCandidate>();
    for (const { properties } of features) {
        // Ein Herrschaftsgebiet trägt seine Kennung unter eigenem Namen (`territory_fill_render`, WI-0062).
        const territoryId = properties["territory_public_id"];
        if (typeof territoryId === "string" && territoryId !== "") {
            const raw = Number(properties["area"]);
            const area = Number.isFinite(raw) && raw > 0 ? raw : Number.POSITIVE_INFINITY;
            const known = byId.get(territoryId);
            if (!known || area < known.area) {
                byId.set(territoryId, {
                    kind: "territory",
                    id: territoryId,
                    name: typeof properties["name"] === "string" ? properties["name"] : null,
                    type: typeof properties["territory_type"] === "string" ? properties["territory_type"] : "",
                    area,
                });
            }
            continue;
        }
        const id = properties["region_public_id"];
        if (typeof id !== "string" || id === "") continue;
        // Für Klicks gesperrt (`is_locked`, WI-0178 D1, EDIT-0003 T53): aus Wahl und Liste; im Editor über die Liste des Fensters.
        if (properties["is_locked"] === true) continue;
        const type = typeof properties["region_type"] === "string" ? properties["region_type"] : "";
        const name = typeof properties["name"] === "string" ? landscapeReaderName(properties["name"], type) : null;
        const raw = Number(properties["area"]);
        const area = Number.isFinite(raw) && raw > 0 ? raw : Number.POSITIVE_INFINITY;
        const known = byId.get(id);
        const layer = layerOf(properties, type);
        if (!known || area < known.area)
            byId.set(id, { kind: "landscape", id, name, type, ...(layer ? { layer } : {}), area });
    }
    return [...byId.values()].sort((a, b) => a.area - b.area || a.id.localeCompare(b.id));
}

/**
 * Die Landschaftsebene eines Wegs (WI-0083 Nachtrag, Betreiber 2026-10-05 „ja“: ein Fluss ist Wasser wie ein See -
 * überall sichtbar, wählbar nur in Topographie und „Alle“).
 *
 * 🪤 Ein Fluss ist in unseren Daten ein WEG und trägt keine Landschaftsebene; sie entsteht deshalb über das Wasser:
 * Die Tafel der Wege sagt, welche Wegart Wasser ist (`isWaterPathSubtype`), die Kartografie-Tafel sagt, in welcher
 * Ebene das Wasser liegt (`WATER_CARTOGRAPHY_LAYER`, heute Topographie). Zwei vorhandene Tafeln, keine neue Liste.
 * Ein Weg, der kein Wasser ist, hat keine Ebene und bleibt in jeder Ansicht wählbar, in der er gezeichnet wird.
 */
function pathLayer(subtype: string): LandscapeLayer | undefined {
    return isWaterPathSubtype(subtype) ? (WATER_CARTOGRAPHY_LAYER as LandscapeLayer) : undefined;
}

/**
 * Die Wege aus gezeichneten Weglinien, je Weg einmal: ein Weg ist sein Name (`pathChainKey`, WI-0177 Schritt 2b), über Wegtypen und
 * Kennzeichen hinweg, wie in der Suche und der Wegeliste. Die Art des Kandidaten ist die des obersten Abschnitts. Ohne Namen gibt es
 * keine Kette, die man ganz wählen könnte; solche Läufe bleiben weg.
 *
 * 🔴 **Ein Griff ist kein Name** (Betreiber 2026-11-09, Bild: „Unbezeichneter Weg“, Gold bei Angbar, Gareth und Caldaia zugleich): Ein
 * Abschnitt, der „Pfad-3443“ oder blank nach seiner Art „Weg“ heißt, ist ein Weg für sich, mit dem Schlüssel seines Abschnitts
 * (`editorPathGroupKey`, wie Wegeliste und Rechtsklick). Bis dahin wurde er über den rohen Namen gewählt: Alle „Weg“ der Karte
 * leuchteten, und das Panel nannte den mit der kleinsten Kennung, gleich welcher angeklickt war.
 *
 * 🔴 Seit WI-0090 gilt das für JEDE Wegart, nicht nur für Flüsse: Ein Fluss ist ein Weg (einer ohne eigene
 * Landschaftsebene), und die Funktion hieß nur deshalb `riverCandidates`, weil bis dahin allein Flüsse anklickbar
 * waren. Die REIHENFOLGE kommt bewusst von außen: Die Abfrage der Karte liefert den obersten Weg zuerst, und oben
 * liegt nach der Kartografie-Tafel die Reichsstraße. Hier wird deshalb NICHT sortiert - eine Sortierung nach Namen
 * (so war es beim Fluss) würde an einer Kreuzung den Pfad vor die Reichsstraße ziehen.
 */
export function pathCandidates(
    features: readonly { readonly id?: string | number | undefined; properties: Readonly<Record<string, unknown>> }[],
): AreaCandidate[] {
    const byId = new Map<string, AreaCandidate>();
    for (const { id: featureId, properties } of features) {
        const name = typeof properties["name"] === "string" ? properties["name"].trim() : "";
        const type = typeof properties["subtype"] === "string" ? properties["subtype"] : "";
        if (name === "" || type === "") continue;
        const publicId =
            typeof properties["public_id"] === "string"
                ? properties["public_id"]
                : typeof featureId === "string"
                  ? featureId
                  : "";
        // Ohne Kennung des Abschnitts (in den Kacheln kommt das nicht vor) bleibt nur der Name.
        const id = publicId === "" ? pathChainKey(name) : editorPathGroupKey({ publicId, name, subtype: type });
        const layer = pathLayer(type);
        if (!byId.has(id)) {
            byId.set(id, {
                kind: "path",
                id,
                name,
                type,
                ...(layer ? { layer } : {}),
                area: 0,
                bach: properties["is_bach"] === true,
            });
        }
    }
    return [...byId.values()];
}

/**
 * Was ein Klick hier wählt: die kleinste Fläche, oder, wenn die gewählte schon hier liegt, die nächstgrößere.
 */
export function nextCandidate(
    candidates: readonly AreaCandidate[],
    currentId: string | undefined,
): AreaCandidate | undefined {
    if (candidates.length === 0) return undefined;
    const at = currentId === undefined ? -1 : candidates.findIndex((candidate) => candidate.id === currentId);
    return candidates[(at + 1) % candidates.length];
}
