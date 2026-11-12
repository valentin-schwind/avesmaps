import { createFinding, type Finding, type FindingObject } from "../findings.ts";

/**
 * Die Stätten eines Ortes aus dem Kartenexport (WI-0109, Vertrag `staetten.yaml`, D7): reine Umformung, keine Datenbank.
 *
 * 🔴 **KEIN EIGENER ABRUF.** `in_settlement_places` reist in derselben `map-features.json` mit, die I1, I5, I8, I10 und I17 schon
 * lesen (`api/app/map-features.php`, Zeile 610). Der Schritt bekommt dieselbe Datei und holt nichts nach.
 *
 * 🔴 **DIE FALTUNG IST LEGACYS EIGENE** (`avesmapsStaettenSchluessel` in `js/map-features/map-features-settlement-places.js`):
 * `trim().toLowerCase()`, bewusst OHNE Umlaut-Abbildung - Legacy sagt dazu wörtlich, Stadtname und Ortsname stammten aus derselben
 * Quelle, es gehe „nur um Groß-/Kleinschreibung und Ränder". Hier wird nichts dazugerechnet.
 *
 * 🔴 **DER RÜCKFALL „Bauwerk" ENTSTEHT HIER NICHT.** Legacys Leser setzt `art = type || "Bauwerk"`; das ist ein Anzeigewort und
 * steht bei uns in der Sprachtafel. Eine leere Art wird `null` - die Antwort der Datenschicht, den Satz bildet die Oberfläche
 * (dieselbe Trennung wie `apps/web/src/i18n/unnamed.ts`, WI-0105).
 */

/** Ein Eintrag, wie `in_settlement_places` ihn trägt. Nur die ersten vier Felder hat jeder; die letzten zwei nur die Kartenpunkte. */
export interface LegacySettlementPlace {
    name?: unknown;
    settlement?: unknown;
    type?: unknown;
    wiki_url?: unknown;
    public_id?: unknown;
    auf_der_karte?: unknown;
}

/** Eine Stätte, fertig zum Schreiben. */
export interface StaetteRow {
    settlementKey: string;
    settlementName: string;
    name: string;
    placeType: string | null;
    wikiUrl: string | null;
    legacyPublicId: string | null;
    onMap: boolean;
}

export const STAETTEN_CONTRACT_VERSION = "0";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTP = /^https?:\/\//i;
/** Ein Rest des Legacy-Importfehlers in der ART: ein spitzes Klammerzeichen, das kein Mensch getippt hat. */
const HTML_RESIDUE = /[<>]/;
/** Legacys Anhang an den Sitz einer Organisation (`organisation-sync.php`); er steht HINTER dem abgeschnittenen Tag. */
const SEAT_SUFFIX = /\s\(Hauptsitz\)$/u;

const count = (text: string, char: string): number => text.split(char).length - 1;

/**
 * Die Art ohne den Rest von Legacys Importfehler (WI-0122, Betreiber 2026-10-09: „Markup im Import bereinigen“).
 *
 * `organisation-seats.php` schneidet den Wikitext mit `explode('/')` am Schrägstrich des schließenden `</small>` ab; was ab dem
 * ersten spitzen Klammerzeichen folgt, ist darum nie Art, sondern ein halber Zusatz (`<br><small>(ehemals …)<`). Gespeichert
 * wird der Teil DAVOR; eine schließende Klammer ohne öffnende (der Rest eines Zusatzes, dessen Anfang schon fehlte) fällt weg;
 * Legacys „ (Hauptsitz)“ am Ende bleibt. Eine Regel für jede Art, ohne Liste: „Provinzherrliches Garderegiment<br><small>(Leib-
 * regiment)< (Hauptsitz)“ wird „Provinzherrliches Garderegiment (Hauptsitz)“. Bleibt nichts, nennt Legacy keine Art (`null`).
 * Eine Art ohne spitzes Klammerzeichen bleibt Zeichen für Zeichen, wie sie ist.
 */
export function cleanPlaceType(raw: string): string | null {
    const cut = raw.search(HTML_RESIDUE);
    if (cut < 0) return raw === "" ? null : raw;
    let head = raw.slice(0, cut).trim();
    while (head.endsWith(")") && count(head, ")") > count(head, "(")) head = head.slice(0, -1).trim();
    if (head === "") return null;
    return SEAT_SUFFIX.test(raw) ? `${head} (Hauptsitz)` : head;
}

/** Legacys Faltung, Zeichen für Zeichen. */
export const foldSettlement = (value: string): string => value.trim().toLowerCase();

const asText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * 🔴 **DIE EINE STELLE für den Schlüssel einer Stätte**: Siedlung, Name und die Kennung des Kartenpunkts - genau die Spalten von
 * `settlement_place_key_unique` (`NULLS NOT DISTINCT`, darum zählt die fehlende Kennung als leer). Der Abgleich nimmt denselben
 * Schlüssel aus den ZELLEN (`staetteKey` in `staetten-import.ts`); laufen die zwei auseinander, legt der Import bei jedem Zug
 * Zeilen neu an und still, statt sie wiederzuerkennen - darum rechnen beide hier.
 */
export const staetteKeyParts = (settlementKey: string, name: string, legacyPublicId: string | null): string =>
    `${settlementKey}\u001f${name}\u001f${legacyPublicId ?? ""}`;

/** Der Schlüssel einer Zeile, wie der Abgleich und das Schema ihn führen. */
export const staetteKeyOf = (row: StaetteRow): string =>
    staetteKeyParts(row.settlementKey, row.name, row.legacyPublicId);

export interface StaettenCounts {
    /** Einträge in der Antwort. */
    delivered: number;
    /** Verschiedene Arten, wie sie gespeichert werden (bereinigt; die leere zählt mit). */
    types: number;
    /** Verschiedene Siedlungen. */
    settlements: number;
    /** Einträge mit eigener Kennung (innerorts-Punkte). */
    withId: number;
    /** Davon die, die auf der Karte stehen. */
    onMap: number;
}

export interface StaettenTransform {
    /** Der Block fehlt, ist keine Liste oder ist leer: nichts schreiben, nichts stilllegen. */
    skipped: boolean;
    rows: StaetteRow[];
    counts: StaettenCounts;
    /** Gelieferte Zeilen, die nicht gespeichert werden, je Befundcode. */
    notStored: Record<string, number>;
    findings: Finding[];
}

const bump = (into: Record<string, number>, code: string): void => {
    into[code] = (into[code] ?? 0) + 1;
};

/**
 * Formt den Block `in_settlement_places` in Zeilen um und meldet, was nicht trägt.
 *
 * 🔴 **Ein fehlender, kaputter oder leerer Block hält den Zug NICHT an** (Betreiber 2026-10-03: nur selbst definierte Prüfungen
 * halten an). Er lässt den Schritt entfallen - und das ist hier nicht Nachlässigkeit, sondern der einzige richtige Weg: Legacys
 * Erzeuger ist ausdrücklich fail-open (drei eigene `try`-Netze, `return []` bei jedem Fehler). Ein leerer Block heißt „Legacy
 * konnte nicht antworten", nicht „es gibt keine Stätten mehr"; ohne diesen Riegel legte ein Ausfall dort alle 4.092 Zeilen hier
 * still.
 */
export function transformStaetten(payload: unknown): StaettenTransform {
    const block = (payload as { in_settlement_places?: unknown } | null)?.in_settlement_places;
    const counts: StaettenCounts = { delivered: 0, types: 0, settlements: 0, withId: 0, onMap: 0 };
    const notStored: Record<string, number> = {};
    const findings: Finding[] = [];
    if (!Array.isArray(block) || block.length === 0) {
        findings.push(
            createFinding(
                "source_block_missing",
                Array.isArray(block)
                    ? "der Kartenexport trägt `in_settlement_places` als LEERE Liste: Legacys Erzeuger ist fail-open und liefert bei jedem Fehler eine leere Liste, darum wird nichts geschrieben und nichts stillgelegt"
                    : "der Kartenexport trägt keinen Block `in_settlement_places`: nichts geschrieben, nichts stillgelegt",
                { eintraege: Array.isArray(block) ? 0 : -1 },
            ),
        );
        return { skipped: true, rows: [], counts, notStored, findings };
    }

    const entries = block as LegacySettlementPlace[];
    counts.delivered = entries.length;
    const rows: StaetteRow[] = [];
    const byKey = new Map<string, StaetteRow>();
    const types = new Set<string>();
    const settlements = new Set<string>();
    const duplicates: FindingObject[] = [];
    const residueByType = new Map<string, number>();
    const badId: FindingObject[] = [];
    const badUrl: FindingObject[] = [];

    for (const entry of entries) {
        const name = asText(entry.name);
        const settlementName = asText(entry.settlement);
        // Legacys Leser lässt genau diese zwei Fälle fallen (`avesmapsStaettenBaueIndex`): ohne Stadt oder ohne Namen gibt es
        // keinen Eimer und keine Zeile.
        if (name === "" || settlementName === "") {
            bump(notStored, name === "" ? "entry_without_name" : "entry_without_settlement");
            continue;
        }
        const typeText = asText(entry.type);
        const placeType = cleanPlaceType(typeText);
        types.add(placeType ?? "");
        const settlementKey = foldSettlement(settlementName);
        settlements.add(settlementKey);
        if (typeText !== "" && HTML_RESIDUE.test(typeText)) {
            residueByType.set(typeText, (residueByType.get(typeText) ?? 0) + 1);
        }

        const rawId = asText(entry.public_id);
        let legacyPublicId: string | null = null;
        if (rawId !== "") {
            if (UUID.test(rawId)) legacyPublicId = rawId.toLowerCase();
            else badId.push({ table: "settlement_place", publicId: rawId, name: `${name} in ${settlementName}` });
        }
        if (legacyPublicId !== null) counts.withId += 1;

        const rawUrl = asText(entry.wiki_url);
        let wikiUrl: string | null = null;
        if (rawUrl !== "") {
            if (HTTP.test(rawUrl)) wikiUrl = rawUrl;
            else badUrl.push({ table: "settlement_place", publicId: rawId || name, name: rawUrl });
        }

        // `auf_der_karte` ist eine Aussage über einen Kartenpunkt: ohne Kennung gibt es keinen (CHECK im Schema).
        const onMap = entry.auf_der_karte === true && legacyPublicId !== null;
        if (onMap) counts.onMap += 1;

        const row: StaetteRow = {
            settlementKey,
            settlementName,
            name,
            placeType,
            wikiUrl,
            legacyPublicId,
            onMap,
        };
        const key = staetteKeyOf(row);
        const seen = byKey.get(key);
        if (seen !== undefined) {
            // 🪤 Heute leer (gemessen 2026-10-08: 0 von 4.092), aber möglich: Legacy entdoppelt die Kartenpunkte ausdrücklich
            // NICHT gegeneinander. Zwei Zeilen mit demselben Schlüssel würden den Abgleich abbrechen - darum sichtbar fallen
            // lassen statt den ganzen Zug zu verlieren.
            duplicates.push({ table: "settlement_place", publicId: key, name: `${name} in ${settlementName}` });
            bump(notStored, "duplicate_key");
            continue;
        }
        byKey.set(key, row);
        rows.push(row);
    }

    counts.types = types.size;
    counts.settlements = settlements.size;

    if (duplicates.length > 0) {
        findings.push(
            createFinding(
                "staette_duplicate_key",
                `${String(duplicates.length)} gelieferte Stätten tragen einen Schlüssel (Siedlung, Name, Kennung), den eine frühere Zeile desselben Satzes schon trägt; die späteren sind nicht gespeichert`,
                { zeilen: duplicates.length },
                duplicates,
            ),
        );
    }
    if (badId.length > 0) {
        findings.push(
            createFinding(
                "jump_id_not_uuid",
                `${String(badId.length)} Stätten tragen eine Kennung, die keine UUID ist; sie sind gespeichert, aber ohne Kennung und damit ohne Sprung auf die Karte`,
                { zeilen: badId.length },
                badId,
            ),
        );
    }
    if (badUrl.length > 0) {
        findings.push(
            createFinding(
                "link_scheme_rejected",
                `${String(badUrl.length)} Stätten tragen eine Adresse, die nicht mit http oder https beginnt; sie sind gespeichert, aber ohne Adresse (der Name bleibt Text)`,
                { zeilen: badUrl.length },
                badUrl,
            ),
        );
    }
    if (residueByType.size > 0) {
        const ordered = [...residueByType.entries()].sort(([, left], [, right]) => right - left);
        findings.push(
            createFinding(
                "redaktionsbefund_html_in_arten",
                `${String(ordered.length)} Arten mit zusammen ${String(ordered.reduce((sum, [, n]) => sum + n, 0))} Stätten tragen in Legacy HTML-Reste; Ursache ist Legacys Import (api/_internal/wiki/organisation-seats.php schneidet mit explode('/') am Schrägstrich des schließenden </small>). BEREINIGT GESPEICHERT (WI-0122, Betreiber 2026-10-09): der Teil vor dem ersten Tag, „(Hauptsitz)“ bleibt; die Quelle trägt den Fehler weiter`,
                { arten: ordered.length, zeilen: ordered.reduce((sum, [, n]) => sum + n, 0) },
                ordered.map(([type, n]) => ({ table: "settlement_place", publicId: String(n), name: type })),
                ordered.length,
                ordered
                    .slice(0, 20)
                    .map(([type, n]) => `${String(n)}× ${type} → ${cleanPlaceType(type) ?? "(keine Art)"}`),
            ),
        );
    }

    return { skipped: false, rows, counts, notStored, findings };
}

/** Wie die Siedlungsnamen des Satzes auf unsere Orte treffen - nur ein Befund, keine Spalte. */
export interface StaettenResolution {
    /** Siedlungen, deren gefalteter Name genau einen aktiven Ort trifft. */
    resolved: number;
    /** Siedlungen, deren gefalteter Name mehrere aktive Orte trifft (alle zeigen dieselben Stätten, wie in Legacy). */
    ambiguous: number;
    /** Siedlungen ohne aktiven Ort: ihre Stätten sind gespeichert, aber kein Panel findet sie. */
    unmatched: number;
    /** Stätten an Siedlungen ohne aktiven Ort. */
    unmatchedRows: number;
}

/**
 * Rechnet die Auflösung der Siedlungsnamen und meldet sie. 🔴 **Es wird nichts verworfen und nichts entschieden:** Eine Stätte an
 * einer unbekannten Siedlung wird gespeichert wie jede andere - sie steht nur in keinem Panel, bis die Siedlung auftaucht. Das ist
 * Legacys Verhalten (dort ist der Eimer einfach leer) und es hält den Befund sichtbar statt ihn wegzufiltern.
 */
export function resolveStaetten(
    rows: readonly StaetteRow[],
    activePlaceKeys: ReadonlyMap<string, number>,
): { resolution: StaettenResolution; findings: Finding[] } {
    const rowsPerSettlement = new Map<string, { name: string; rows: number }>();
    for (const row of rows) {
        const seen = rowsPerSettlement.get(row.settlementKey);
        if (seen === undefined) rowsPerSettlement.set(row.settlementKey, { name: row.settlementName, rows: 1 });
        else seen.rows += 1;
    }
    const resolution: StaettenResolution = { resolved: 0, ambiguous: 0, unmatched: 0, unmatchedRows: 0 };
    const unmatched: FindingObject[] = [];
    const ambiguous: FindingObject[] = [];
    for (const [key, entry] of rowsPerSettlement) {
        const hits = activePlaceKeys.get(key) ?? 0;
        if (hits === 1) resolution.resolved += 1;
        else if (hits > 1) {
            resolution.ambiguous += 1;
            ambiguous.push({ table: "settlement_place", publicId: key, name: `${entry.name} (${String(hits)} Orte)` });
        } else {
            resolution.unmatched += 1;
            resolution.unmatchedRows += entry.rows;
            unmatched.push({
                table: "settlement_place",
                publicId: key,
                name: `${entry.name} (${String(entry.rows)} Stätten)`,
            });
        }
    }
    const findings: Finding[] = [];
    if (unmatched.length > 0) {
        findings.push(
            createFinding(
                "settlement_unmatched",
                `${String(unmatched.length)} Siedlungen des Satzes mit zusammen ${String(resolution.unmatchedRows)} Stätten treffen keinen aktiven Ort; die Zeilen sind gespeichert, aber kein Panel zeigt sie`,
                { siedlungen: unmatched.length, zeilen: resolution.unmatchedRows },
                unmatched,
            ),
        );
    }
    if (ambiguous.length > 0) {
        findings.push(
            createFinding(
                "settlement_ambiguous",
                `${String(ambiguous.length)} Siedlungen des Satzes treffen mehrere aktive Orte gleichen Namens; alle zeigen dieselben Stätten, genau wie in Legacy (der Eimer hängt am Namen)`,
                { siedlungen: ambiguous.length },
                ambiguous,
            ),
        );
    }
    return { resolution, findings };
}
