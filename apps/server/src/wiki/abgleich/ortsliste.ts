import type { WikisyncEigentuemer, WikisyncStatus, WikisyncWirkung } from "@avesmaps3d/shared";
import { kuerze, phpTrim } from "../infobox/text.ts";

/**
 * Die Ortsliste eines Werks im WikiSync (WI-0253, Scheibe Ortslisten der Literatur): die Liste `Ort` (Abenteuer, Roman, Kurzgeschichte) oder `Thema` (Spielhilfen) des
 * Produkt-Artikels gegen die Ortsbezüge des Werks (`adventure_place`). REIN: keine Datenbank. Dieselben Funktionen rechnen die Vorschau (`plan.ts`) und, unter der Sperre,
 * die Übernahme (`uebernahme/ortsliste.ts`).
 *
 * Vorbild ist Legacys Abgleich (Mirror a7f2dac86, `api/_internal/wiki/game-literature-sync.php`):
 *
 * - **Die Wunschliste** (`avesmapsGameLiteratureBuildCatalogStep`, `avesmapsGameLiteratureDesiredPlaces`): die Linkziele der Liste in ihrer Reihenfolge, leere weg, je
 *   300 Zeichen, die Stelle von 0 an gezählt; die Rolle folgt der Werkart (`avesmapsGameLiteratureRoleForKind`): Regionalspielhilfe und Spielhilfe `covers`, alles andere
 *   `start` an Stelle 0 und `play` danach.
 * - **Die Identität einer Zeile des Wikis ist ihre Stelle** (`sort_order`, `avesmapsGameLiteraturePlacePlan`): An einer Stelle mit anderem Namen wird umbenannt, eine Stelle,
 *   die das Wiki nicht mehr nennt, fällt weg, eine neue kommt dazu. Zeilen der Redaktion fasst der Abgleich nie an und sieht sie nicht; ein Ort, den die Redaktion aus der
 *   Liste genommen hat (Tombstone, `state = 'suppressed'`), kommt über seinen Namen nie zurück.
 *
 * Wem eine Zeile gehört, sagt ihr Vermerk (`adventure_place.legacy_origin`) wie bei den Feldern (`herkunft.ts`), mit derselben Abweichung von Legacy: Eine Zeile OHNE
 * belegte Herkunft (`unknown`, so stehen alle Zeilen aus dem öffentlichen Katalog da) ist unbelegt; weicht sie ab, ist das ein Befund, nie eine Änderung. Eine Zeile mit
 * `manual`, mit einem Ziel der Redaktion (`target_origin = 'editor'`) oder von der Redaktion angelegt (`source_system = 'editor'`) gehört der Redaktion, und ein Werk der
 * Redaktion (`adventure.source_system = 'editor'`) gehört ihr samt seiner ganzen Liste: Jede Abweichung ist dann eine eigene Entscheidung.
 *
 * Abweichungen von Legacy, mit Grund:
 * - Eine umbenannte Stelle wird nicht an Ort und Stelle umgeschrieben, sondern die alte Zeile still gelegt und eine neue angelegt: In Avesmaps3D gehört der Name zur
 *   Identität einer Zeile (`name_key`, Migration 0068: „ein umbenannter Ort ist eine neue Zeile“). Gelöscht wird nie.
 * - Eine Stelle wird nicht neu angelegt, wenn derselbe Name schon als unbelegte oder eigene Zeile an einer anderen Stelle steht (Befund „steht an anderer Stelle“):
 *   Ohne belegte Herkunft ließe sich sonst eine Liste, die nur umsortiert wurde, verdoppeln.
 */

export const ORTS_ROLLEN = ["start", "play", "covers"] as const;
export type OrtsRolle = (typeof ORTS_ROLLEN)[number];

/** Die Werkarten, deren Orte beschrieben werden (keine Reihenfolge, kein Spoiler): Legacy `AVESMAPS_GAME_LITERATURE_KINDS`, `roles = covers`. */
const OHNE_REIHENFOLGE: ReadonlySet<string> = new Set(["regionalspielhilfe", "spielhilfe"]);

/** Legacy `avesmapsGameLiteratureRoleForKind(avesmapsGameLiteratureKindForProductType($productType), $sortOrder)`. */
export function ortsRolle(productType: string, stelle: number): OrtsRolle {
    if (OHNE_REIHENFOLGE.has(phpTrim(productType.toLowerCase()))) return "covers";
    return stelle === 0 ? "start" : "play";
}

/** Legacys `PlaceNameKey`: klein und getrimmt (`avesmapsGameLiteraturePlaceNameKey`, `adventure_place.name_key`). */
export const ortsSchluessel = (name: string): string => phpTrim(name).toLowerCase();

export interface OrtsWunsch {
    stelle: number;
    name: string;
    rolle: OrtsRolle;
}

/** Die Wunschliste aus den Linkzielen des Artikels (`leseProdukt(...).orte`) und der Werkart des Wikis (`product_type`). */
export function wunschliste(orte: readonly string[], productType: string): OrtsWunsch[] {
    const liste: OrtsWunsch[] = [];
    for (const roh of orte) {
        const name = phpTrim(roh);
        if (name === "") continue;
        const stelle = liste.length;
        liste.push({ stelle, name: kuerze(name, 300), rolle: ortsRolle(productType, stelle) });
    }
    return liste;
}

/** Wem eine Zeile gehört, nach ihrem Vermerk. */
export type OrtsHerkunft = "wiki" | "manual" | "unbekannt";

/** Eine Zeile der Ortsliste, so weit der Abgleich sie braucht. */
export interface OrtsZeile {
    /** `adventure_place.id`. */
    id: string;
    stelle: number;
    schluessel: string;
    name: string;
    rolle: string;
    zustand: "active" | "retired" | "suppressed";
    herkunft: OrtsHerkunft;
}

export interface OrtsBestand {
    zeilen: readonly OrtsZeile[];
    /** Das Werk gehört der Redaktion (`adventure.source_system = 'editor'`): die ganze Liste mit. */
    redaktion: boolean;
}

/** Ein Ort der Liste, wie die Zeile des Berichts ihn nennt. */
export interface OrtsWert {
    name: string;
    rolle: string;
}

/** Was die Vorschau über eine Stelle sagt (eine Zeile des Berichts, Feld `ort_<Stelle>`). */
export interface OrtsEntscheidung {
    stelle: number;
    alt: OrtsWert | null;
    neu: OrtsWert | null;
    eigentuemer: WikisyncEigentuemer;
    wirkung: WikisyncWirkung;
    status: WikisyncStatus;
    grund: string | null;
}

/** Das Feld einer Stelle in der Zeile des Berichts. */
export const ortsFeld = (stelle: number): string => `ort_${String(stelle)}`;

/** Die Stelle eines Felds `ort_<n>`; `null`, wenn das Feld keines der Ortsliste ist. */
export function ortsStelle(feld: string | null): number | null {
    const treffer = feld === null ? null : /^ort_(\d{1,6})$/u.exec(feld);
    return treffer === null ? null : Number(treffer[1]);
}

/** Der Wert einer Stelle im Bericht: der Name und, in Klammern, die Rolle (`Punin (start)`). Eine Zeichenkette, die `leseOrtsWert` wieder zerlegt. */
export const ortsWert = (wert: OrtsWert): string => `${wert.name} (${wert.rolle})`;

export function leseOrtsWert(text: string | null): OrtsWert | null {
    const treffer = text === null ? null : /^([\s\S]*) \((start|play|covers)\)$/u.exec(text);
    return treffer === null ? null : { name: treffer[1] as string, rolle: treffer[2] as string };
}

export const GRUND_UNTERDRUECKT = "Die Redaktion hat diesen Ort aus der Liste genommen";
export const GRUND_ANDERE_STELLE = "Der Ort steht schon an einer anderen Stelle der Liste";

/** Wem der Wert an einer Stelle gehört: einer Zeile nach ihrer Herkunft, einer leeren Stelle dem Wiki. */
function eigentuemerVon(
    herkunft: OrtsHerkunft | "frei",
    bestand: OrtsBestand,
    bereichBeiLegacy: boolean,
): WikisyncEigentuemer {
    if (bestand.redaktion || herkunft === "manual") return "manual";
    if (herkunft === "unbekannt") return "unbekannt";
    return bereichBeiLegacy ? "legacy" : "wiki";
}

const wirkungVon = (eigentuemer: WikisyncEigentuemer): WikisyncWirkung =>
    eigentuemer === "wiki" ? "uebernommen" : eigentuemer === "manual" ? "eigen" : "befund";

const nachStelle = (a: OrtsZeile, b: OrtsZeile): number => a.stelle - b.stelle || Number(a.id) - Number(b.id);

/**
 * Die Ortsliste eines Werks gegen die Wunschliste: je Stelle, an der etwas zu sagen ist, eine Entscheidung (in der Reihenfolge der Stellen, die entfallenden danach).
 * Eine Stelle, die schon stimmt, ergibt nichts.
 */
export function planeOrtsliste(
    wunsch: readonly OrtsWunsch[],
    bestand: OrtsBestand,
    bereichBeiLegacy: boolean,
): OrtsEntscheidung[] {
    const aktiv = bestand.zeilen.filter((zeile) => zeile.zustand === "active").sort(nachStelle);
    const unterdrueckt = new Set(
        bestand.zeilen.filter((zeile) => zeile.zustand === "suppressed").map((zeile) => zeile.schluessel),
    );
    const verbraucht = new Set<string>();
    const aus: OrtsEntscheidung[] = [];
    const zeile = (
        stelle: number,
        alt: OrtsWert | null,
        neu: OrtsWert | null,
        herkunft: OrtsHerkunft | "frei",
        status: WikisyncStatus,
        grund: string | null = null,
    ): void => {
        const eigentuemer = eigentuemerVon(herkunft, bestand, bereichBeiLegacy);
        aus.push({
            stelle,
            alt: alt === null ? null : { name: alt.name, rolle: alt.rolle },
            neu: neu === null ? null : { name: neu.name, rolle: neu.rolle },
            eigentuemer,
            wirkung: wirkungVon(eigentuemer),
            status,
            grund,
        });
    };

    for (const w of wunsch) {
        const schluessel = ortsSchluessel(w.name);
        const anDerStelle = aktiv.filter((kandidat) => kandidat.stelle === w.stelle && !verbraucht.has(kandidat.id));
        const derselbe = anDerStelle.find((kandidat) => kandidat.schluessel === schluessel);
        if (derselbe !== undefined) {
            verbraucht.add(derselbe.id);
            if (derselbe.name !== w.name || derselbe.rolle !== w.rolle)
                zeile(w.stelle, derselbe, w, derselbe.herkunft, "geaendert");
            continue;
        }
        if (unterdrueckt.has(schluessel)) {
            // Legacy überspringt den Ort still und lässt die Stelle stehen; hier ist es ein Befund mit Grund, nie ein Wiederbeleben.
            aus.push({
                stelle: w.stelle,
                alt: null,
                neu: { name: w.name, rolle: w.rolle },
                eigentuemer: "unterdrueckt",
                wirkung: "befund",
                status: "unterdrueckt",
                grund: GRUND_UNTERDRUECKT,
            });
            continue;
        }
        // Die Zeile, mit der die Stelle verglichen wird: eine des Wikis, sonst eine unbelegte; in einem Werk der Redaktion auch ihre eigene (sie sieht dort jede Zeile).
        const vorhanden =
            anDerStelle.find((kandidat) => kandidat.herkunft === "wiki") ??
            anDerStelle.find((kandidat) => kandidat.herkunft === "unbekannt") ??
            (bestand.redaktion ? anDerStelle[0] : undefined);
        if (vorhanden !== undefined) {
            verbraucht.add(vorhanden.id);
            zeile(w.stelle, vorhanden, w, vorhanden.herkunft, "geaendert");
            continue;
        }
        const anderswo = aktiv.find(
            (kandidat) =>
                kandidat.schluessel === schluessel && kandidat.stelle !== w.stelle && kandidat.herkunft !== "wiki",
        );
        if (anderswo !== undefined) {
            zeile(w.stelle, null, w, anderswo.herkunft, "neu", GRUND_ANDERE_STELLE);
            continue;
        }
        zeile(w.stelle, null, w, "frei", "neu");
    }

    // Was das Wiki an keiner Stelle mehr nennt. Eine Zeile an einer Stelle, die das Wiki noch nennt, bleibt (Legacy: Die Stelle ist gewünscht).
    const stellen = new Set(wunsch.map((w) => w.stelle));
    for (const rest of aktiv) {
        if (verbraucht.has(rest.id) || stellen.has(rest.stelle)) continue;
        // Eine Zeile der Redaktion in einem fremden Werk sieht der Abgleich nicht (Legacy: „manual/community -> untouched, invisible to the plan“).
        if (rest.herkunft === "manual" && !bestand.redaktion) continue;
        zeile(rest.stelle, rest, null, rest.herkunft, "zu_entfernen");
    }
    return aus;
}
