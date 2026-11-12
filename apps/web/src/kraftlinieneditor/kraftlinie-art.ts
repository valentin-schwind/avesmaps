import {
    EDITOR_POWERLINES_URL,
    editorPowerlineUpdateUrl,
    type EditorPowerlineDetail,
    type EditorPowerlineTargets,
    type PowerlineSegmentBase,
    type PowerlineSegmentNew,
    type PowerlineUpdateBody,
    type WikiArtikel,
} from "@avesmaps3d/shared";
import type { BearbeitungsArt, Stand } from "../fenster/bearbeitung";
import { sende, type SchreibAntwort } from "../fenster/entwurf-senden";
import { herkunftIm, type WikiFelder } from "../fenster/wiki-feld";
import { aufWiki, wikiFelderAus } from "./kraftlinie-wiki-felder";
import type { Aenderung, Punkt, Teil, Ziel } from "../map/geometrie/geometrie";

/**
 * Die Kraftlinie als Art des gemeinsamen Entwurfs (WI-0205 K6, K8 auf O3; `fenster/bearbeitung.ts`; EDIT-0003 T44): was ihre Felder
 * sind, was ihre Form ist, und wie beides als EINE Operation `powerline.update_line` geht (`POST /api/editor/powerlines/:anker/update`).
 *
 * - **Felder:** Name, „Name auf der Karte anzeigen“, Beschreibung und der Wiki-Artikel der LINIE (`wiki`, wie Legacy; Baustein
 *   `fenster/wiki-zuordnung.ts`, verglichen über den Schlüssel). Die Beschriftung steht je Abschnitt; die Linie zeigt sie, sobald
 *   ein Abschnitt sie zeigt, und „Fertig“ setzt sie für alle. Ein leerer Name wird nicht geschrieben (Legacy verlangt einen).
 * - **Form** (`KraftlinieForm`): je Abschnitt der Teil mit beiden Knoten und dem Bogen als Wert des Steuergriffs, dazu seine Enden.
 *   Ein Ende umhängen geht nur an einen Nodix (R6); ins Leere setzt es nichts (R4, `formNach`).
 * - **Nodix herausnehmen** (T28 (5), R5, `ohneKnoten`): In der Mitte verbinden sich die Nachbarn (B–C–D ohne C ist B–D: ein Abschnitt
 *   hängt um, der andere entfällt; es bleibt der vorhandene mit der kleineren Kennung, mit Bogen und Wiki-Zuordnung). An einem Ende und
 *   an einer Verzweigung gehen die Abschnitte mit; der letzte Abschnitt bleibt (die ganze Linie geht mit „Kraftlinie entfernen“).
 * - **Nodix anfügen** (`mitAbschnitt`, Legacy „+ Nodix hinzufügen“: verbinden von einem Knoten der Linie zu einem Nodix): ein neuer
 *   Abschnitt mit vorläufiger Kennung `neu-n`; „Fertig“ legt ihn an (`add`) und er erbt Name, Beschriftung und Beschreibung.
 * - Nach „Fertig“ kann die Linie einen anderen Anker haben (der alte Abschnitt ist herausgenommen): Die Art liest dann unter dem neuen
 *   (`Ankerfolge`, geteilt mit dem Verlauf derselben Linie, dessen ↺ ebenso Abschnitte nimmt oder zurückbringt).
 * - **Revision je Abschnitt:** „Fertig“ nennt alle Abschnitte mit der Revision, die der Entwurf gelesen hat; geändert wird nur, was
 *   gegenüber dem gelesenen Stand anders ist (ein fehlendes Feld bleibt). Gesperrt wird die Linie unter ihrem Anker.
 * - Für Konflikt und Fuß heißen die Teile `name`, `beschriftung`, `beschreibung` und `form`.
 * - **Herkunft** (WI-0225, Modell c; `kraftlinie-wiki-felder.ts`): Name und Beschreibung tragen im Entwurf ihre Herkunft (`herkunft`,
 *   aus den Abschnitten zusammengefasst). „Fertig“ schreibt ein geändertes Feld mit Herkunft wiki als `{ revert: "wiki" }`, sonst den
 *   Wert; der Server setzt die Herkunft an allen Abschnitten.
 */

export interface KraftlinieFelder extends WikiFelder {
    readonly name: string;
    readonly labelVisible: boolean;
    readonly description: string;
    /** Der Artikel der ganzen Linie; `null`: keiner. Den liest auch der Wiki-Feldbaustein (WI-0225). */
    readonly wiki: WikiArtikel | null;
}

/** Die Knoten eines Abschnitts. */
export interface KraftlinieEnden {
    readonly from: string;
    readonly to: string;
}

/** Ein Knoten, den die Linie erst im Entwurf bekommt (Nodix anfügen): Name und Art für das Fenster, Lage für die Karte. */
export interface NeuerKnoten {
    readonly name: string;
    readonly kind: "place" | "label" | "nodix" | "landmark";
    readonly x: number;
    readonly y: number;
}

/** Die Form im Entwurf: je Abschnitt der Teil (Enden und Bogen) und seine Knoten, als JSON sicherbar. */
export interface KraftlinieForm {
    readonly teile: readonly Teil[];
    readonly enden: Readonly<Record<string, KraftlinieEnden>>;
    /** Knoten, die erst der Entwurf an die Linie bringt; fehlt ohne. */
    readonly knoten?: Readonly<Record<string, NeuerKnoten>> | undefined;
}

/** Die vorläufige Kennung eines angefügten Abschnitts, bis „Fertig“ ihn anlegt. */
export const istNeu = (id: string): boolean => id.startsWith("neu-");

export type KraftlinieStand = Stand<KraftlinieFelder, KraftlinieForm>;

export function felderAus(linie: EditorPowerlineDetail): KraftlinieFelder {
    return { ...wikiFelderAus(linie), labelVisible: linie.segments.some((a) => a.labelVisible) };
}

/** Die Form beim Start: je Abschnitt mit beiden Knoten ein Teil, der Bogen als Wert des Steuergriffs. */
export function formAus(linie: EditorPowerlineDetail): KraftlinieForm {
    const lage = new Map(
        linie.nodes.flatMap((k) =>
            k.x !== undefined && k.y !== undefined ? [[k.id, { x: k.x, y: k.y }] as const] : [],
        ),
    );
    const teile: Teil[] = [];
    const enden: Record<string, KraftlinieEnden> = {};
    for (const a of linie.segments) {
        enden[a.id] = { from: a.from, to: a.to };
        const von = lage.get(a.from);
        const nach = lage.get(a.to);
        // Ein Abschnitt mit fehlendem Knoten lässt sich nicht biegen (Befund KL2): Er bleibt in den Feldern, nicht auf der Karte.
        if (von === undefined || nach === undefined) continue;
        teile.push({
            objekt: a.id,
            name: linie.name,
            nr: 0,
            art: "linie",
            punkte: [von, nach],
            revision: a.revision,
            wert: a.curve ?? undefined,
        });
    }
    return { teile, enden };
}

/** Die Ziele zum Einrasten aus den Nodices: Orte und Beschriftungen nach ihrer Art, eine Landmarke wie ein Ort, Kraftlinienpunkte als Ecke. */
export function zieleAus(ziele: EditorPowerlineTargets): Ziel[] {
    return ziele.targets.map((z) => ({
        art: z.kind === "place" || z.kind === "landmark" ? "ort" : z.kind === "label" ? "label" : "ecke",
        at: { x: z.x, y: z.y },
        objekt: z.id,
        name: z.name ?? "",
    }));
}

/** Ein Schritt aus einer Handbewegung; `undefined`, wenn sie nichts setzt (ein Ende ins Leere, R4). */
export function formNach(form: KraftlinieForm, aenderung: Aenderung): KraftlinieForm | undefined {
    const neu = aenderung.teile.find((t) => t.objekt === aenderung.stelle.objekt);
    if (neu === undefined) return undefined;
    const teile = form.teile.map((t) => (t.objekt === neu.objekt ? neu : t));
    if (aenderung.art === "steuern") return { ...form, teile };
    if (aenderung.art !== "ziehen" || aenderung.treffer === undefined) return undefined;
    const alt = form.enden[neu.objekt];
    if (alt === undefined) return undefined;
    const knoten = aenderung.treffer.ziel.objekt;
    const ende = aenderung.stelle.index === 0 ? { ...alt, from: knoten } : { ...alt, to: knoten };
    return { teile, enden: { ...form.enden, [neu.objekt]: ende } };
}

/** Warum ein Nodix nicht herausgenommen wird: Er gehört nicht zur Linie, oder es wäre der letzte Abschnitt. */
export type Herausnehmen = { readonly form: KraftlinieForm } | { readonly grund: "fremd" | "letzter" };

const anderesEnde = (e: KraftlinieEnden, knoten: string): string => (e.from === knoten ? e.to : e.from);

/** Nodix herausnehmen (R5): in der Mitte verbinden sich die Nachbarn, an Ende und Verzweigung gehen die Abschnitte mit. */
export function ohneKnoten(form: KraftlinieForm, knoten: string): Herausnehmen {
    const an = Object.entries(form.enden).filter(([, e]) => e.from === knoten || e.to === knoten);
    if (an.length === 0) return { grund: "fremd" };
    const enden: Record<string, KraftlinieEnden> = { ...form.enden };
    let teile = [...form.teile];
    const weg = (id: string): void => {
        delete enden[id];
        teile = teile.filter((t) => t.objekt !== id);
    };
    if (an.length === 2) {
        // Der vorhandene vor dem angefügten, dann die kleinere Kennung: So bleibt meist der Anker und mit ihm die Wiki-Zuordnung.
        const rang = (id: string): string => (istNeu(id) ? `~${id}` : id);
        const [bleibt, geht] = [...an].sort(([x], [y]) => (rang(x) < rang(y) ? -1 : 1)) as [
            [string, KraftlinieEnden],
            [string, KraftlinieEnden],
        ];
        const [bid, be] = bleibt;
        const [gid, ge] = geht;
        const nachbar = anderesEnde(be, knoten);
        const ziel = anderesEnde(ge, knoten);
        const schonVerbunden = Object.entries(form.enden).some(
            ([id, e]) =>
                id !== bid &&
                id !== gid &&
                ((e.from === nachbar && e.to === ziel) || (e.from === ziel && e.to === nachbar)),
        );
        if (nachbar !== ziel && !schonVerbunden) {
            const tg = teile.find((t) => t.objekt === gid);
            const fern: Punkt | undefined =
                tg === undefined ? undefined : ge.from === knoten ? tg.punkte[1] : tg.punkte[0];
            weg(gid);
            enden[bid] = be.from === knoten ? { ...be, from: ziel } : { ...be, to: ziel };
            teile = teile.flatMap((t) => {
                if (t.objekt !== bid) return [t];
                // Ohne die Lage des fernen Endes lässt sich der verbundene Abschnitt nicht zeichnen; er bleibt in den Feldern.
                if (fern === undefined) return [];
                return [{ ...t, punkte: be.from === knoten ? [fern, t.punkte[1]!] : [t.punkte[0]!, fern] }];
            });
            return { form: { ...form, teile, enden } };
        }
    }
    for (const [id] of an) weg(id);
    if (Object.keys(enden).length === 0) return { grund: "letzter" };
    return { form: { ...form, teile, enden } };
}

/** Nodix anfügen: ein neuer Abschnitt von einem Knoten der Linie zu einem Nodix; `undefined`, wenn beide derselbe sind. */
export function mitAbschnitt(
    form: KraftlinieForm,
    von: { readonly id: string; readonly x: number; readonly y: number },
    nach: { readonly id: string } & NeuerKnoten,
    name: string,
): KraftlinieForm | undefined {
    if (von.id === nach.id) return undefined;
    const nummern = Object.keys(form.enden)
        .filter(istNeu)
        .map((id) => Number(id.slice(4)) || 0);
    const id = `neu-${String(Math.max(0, ...nummern) + 1)}`;
    return {
        teile: [
            ...form.teile,
            {
                objekt: id,
                name,
                nr: 0,
                art: "linie",
                punkte: [
                    { x: von.x, y: von.y },
                    { x: nach.x, y: nach.y },
                ],
                revision: 0,
            },
        ],
        enden: { ...form.enden, [id]: { from: von.id, to: nach.id } },
        knoten: { ...form.knoten, [nach.id]: { name: nach.name, kind: nach.kind, x: nach.x, y: nach.y } },
    };
}

const bogenVon = (form: KraftlinieForm | undefined, id: string): number | null | undefined => {
    const teil = form?.teile.find((t) => t.objekt === id);
    return teil === undefined ? undefined : (teil.wert ?? null);
};

/** Was die Form an einem Abschnitt gegenüber dem gelesenen Stand ändert, in der Form von `powerline.update_line`. */
function abschnittAenderung(
    a: EditorPowerlineDetail["segments"][number],
    form: KraftlinieForm | undefined,
): Omit<PowerlineSegmentBase, "id" | "baseRevision"> {
    if (form === undefined) return {};
    const enden = form.enden[a.id];
    // Im Entwurf nicht mehr da: herausgenommen.
    if (enden === undefined) return { remove: true };
    const bogen = bogenVon(form, a.id);
    return {
        ...(bogen !== undefined && bogen !== a.curve ? { curve: bogen } : {}),
        ...(enden !== undefined && enden.from !== a.from ? { from: enden.from } : {}),
        ...(enden !== undefined && enden.to !== a.to ? { to: enden.to } : {}),
    };
}

/** Die angefügten Abschnitte des Entwurfs, in der Form von `powerline.update_line`. */
function angefuegt(form: KraftlinieForm | undefined): PowerlineSegmentNew[] {
    if (form === undefined) return [];
    return Object.entries(form.enden)
        .filter(([id]) => istNeu(id))
        .map(([id, e]) => {
            const bogen = bogenVon(form, id);
            return { from: e.from, to: e.to, ...(bogen !== undefined && bogen !== null ? { curve: bogen } : {}) };
        });
}

const formGeaendert = (d: EditorPowerlineDetail, form: KraftlinieForm | undefined): boolean =>
    d.segments.some((a) => Object.keys(abschnittAenderung(a, form)).length > 0) || angefuegt(form).length > 0;

/** Die Form zweier gelesener Stände: Abschnitte, Bögen und Enden. */
const formSchluessel = (d: EditorPowerlineDetail): string =>
    d.segments.map((a) => `${a.id}:${a.from}>${a.to}:${String(a.curve)}`).join("|");

/** Die Felder, in denen sich zwei Feldstände unterscheiden. */
function felderUnterschied(a: KraftlinieFelder, b: KraftlinieFelder): string[] {
    const raus: string[] = [];
    if (a.name.trim() !== b.name.trim()) raus.push("name");
    if (a.labelVisible !== b.labelVisible) raus.push("beschriftung");
    if (a.description.trim() !== b.description.trim()) raus.push("beschreibung");
    if ((a.wiki?.key ?? null) !== (b.wiki?.key ?? null)) raus.push("wiki");
    return raus;
}

/**
 * Unter welchem Abschnitt die Linie nach dem letzten Schreiben heißt (ihrem kleinsten, D19); `undefined`: unter der Kennung der
 * Bearbeitung. Bearbeitung und Verlauf einer Linie teilen sie.
 */
export interface Ankerfolge {
    anker: string | undefined;
}

/** Nach einem Schreiben: Der neue Anker ist der kleinste Abschnitt, den die Quittung nennt. */
export function folgeAnker(folge: Ankerfolge, antwort: SchreibAntwort): void {
    if (!antwort.ok) return;
    const [neu] = antwort.quittung.affected
        .filter((a) => a.kind === "powerline")
        .map((a) => a.id)
        .sort();
    if (neu !== undefined) folge.anker = neu;
}

export type KraftlinieArt = BearbeitungsArt<
    EditorPowerlineDetail,
    KraftlinieFelder,
    KraftlinieForm,
    PowerlineUpdateBody
>;

export function createKraftlinieArt(
    fetcher: typeof fetch = (eingabe, init) => fetch(eingabe, init),
    folge: Ankerfolge = { anker: undefined },
): KraftlinieArt {
    return {
        sperrArt: "powerline",
        async lade(id, signal) {
            // Der Editor liest immer den Stand von jetzt, nicht den Zwischenspeicher des Browsers (E19).
            const antwort = await fetcher(`${EDITOR_POWERLINES_URL}/${folge.anker ?? id}`, {
                signal,
                cache: "no-store",
                headers: { accept: "application/json" },
            });
            if (antwort.status === 404) return null;
            if (!antwort.ok) throw new Error(`Kraftlinie ${id}: ${String(antwort.status)}`);
            return (await antwort.json()) as EditorPowerlineDetail;
        },
        felder: felderAus,
        operation(d, _start, jetzt, operationId) {
            const alt = felderAus(d);
            const name = jetzt.felder.name.trim();
            const beschreibung = jetzt.felder.description.trim();
            const segments = d.segments.map((a) => ({
                id: a.id,
                baseRevision: a.revision,
                ...abschnittAenderung(a, jetzt.form),
            }));
            // Ein geändertes Feld mit Herkunft wiki geht als ↺ (WI-0225), sonst als Wert.
            const zurWiki = (feld: "name" | "description"): boolean => herkunftIm(jetzt.felder, feld) === "wiki";
            const body: PowerlineUpdateBody = {
                operationId,
                segments,
                ...(name !== "" && name !== alt.name.trim()
                    ? { name: zurWiki("name") ? { revert: "wiki" } : name }
                    : {}),
                ...(jetzt.felder.labelVisible !== alt.labelVisible ? { labelVisible: jetzt.felder.labelVisible } : {}),
                ...(beschreibung !== alt.description.trim()
                    ? {
                          description: zurWiki("description")
                              ? { revert: "wiki" }
                              : beschreibung === ""
                                ? null
                                : beschreibung,
                      }
                    : {}),
            };
            const neue = angefuegt(jetzt.form);
            if (neue.length > 0) body.add = neue;
            const formAenderung = segments.some((a) => Object.keys(a).length > 2) || neue.length > 0;
            // Der Artikel: nur, wenn er sich gegenüber dem gelesenen Stand ändert (zuweisen oder lösen).
            if ((jetzt.felder.wiki?.key ?? null) !== (alt.wiki?.key ?? null))
                body.wiki = jetzt.felder.wiki === null ? null : { key: jetzt.felder.wiki.key };
            const felderAenderung =
                body.name !== undefined ||
                body.labelVisible !== undefined ||
                body.description !== undefined ||
                body.wiki !== undefined;
            return formAenderung || felderAenderung ? body : undefined;
        },
        async schreibe(id, body) {
            const antwort = await sende(editorPowerlineUpdateUrl(folge.anker ?? id), body, "POST", fetcher);
            // Die Linie heißt nach ihrem kleinsten Abschnitt; war das der herausgenommene, liest die Art unter dem neuen weiter.
            folgeAnker(folge, antwort);
            return antwort;
        },
        geaendert(d, stand) {
            const raus = felderUnterschied(felderAus(d), stand.felder);
            if (formGeaendert(d, stand.form)) raus.push("form");
            return raus;
        },
        fremde(vorher, jetzt) {
            const raus = felderUnterschied(felderAus(vorher), felderAus(jetzt));
            if (formSchluessel(vorher) !== formSchluessel(jetzt)) raus.push("form");
            return raus;
        },
        aufNeuenStand(vorher, jetzt, stand) {
            const alt = felderAus(vorher);
            const neu = felderAus(jetzt);
            const eigene = new Set(felderUnterschied(alt, stand.felder));
            const felder: KraftlinieFelder = {
                name: eigene.has("name") ? stand.felder.name : neu.name,
                labelVisible: eigene.has("beschriftung") ? stand.felder.labelVisible : neu.labelVisible,
                description: eigene.has("beschreibung") ? stand.felder.description : neu.description,
                wiki: eigene.has("wiki") ? stand.felder.wiki : neu.wiki,
                // Die Herkunft geht mit dem eigenen Wert.
                herkunft: {
                    ...neu.herkunft,
                    ...(eigene.has("name") ? { name: stand.felder.herkunft["name"] } : {}),
                    ...(eigene.has("beschreibung") ? { description: stand.felder.herkunft["description"] } : {}),
                },
            };
            if (stand.form === undefined) return { felder, form: undefined };
            // Die Form: je Abschnitt, den man selbst geändert hat, der eigene Teil; sonst der neue Stand.
            const frisch = formAus(jetzt);
            const vorherVon = new Map(vorher.segments.map((a) => [a.id, a] as const));
            const selbst = new Set(
                [...vorherVon.values()]
                    .filter((a) => Object.keys(abschnittAenderung(a, stand.form)).length > 0)
                    .map((a) => a.id),
            );
            // Selbst herausgenommen bleibt herausgenommen, selbst angefügt kommt dazu.
            const eigenesForm = stand.form;
            const teile = [
                ...frisch.teile.flatMap((t) => {
                    if (!selbst.has(t.objekt)) return [t];
                    const meins = eigenesForm.teile.find((x) => x.objekt === t.objekt);
                    return meins === undefined ? [] : [meins];
                }),
                ...eigenesForm.teile.filter((t) => istNeu(t.objekt)),
            ];
            const enden: Record<string, KraftlinieEnden> = {};
            for (const [id, e] of Object.entries(frisch.enden)) {
                if (!selbst.has(id)) enden[id] = e;
                else if (eigenesForm.enden[id] !== undefined) enden[id] = eigenesForm.enden[id];
            }
            for (const [id, e] of Object.entries(eigenesForm.enden)) if (istNeu(id)) enden[id] = e;
            return {
                felder,
                form: { teile, enden, ...(eigenesForm.knoten !== undefined ? { knoten: eigenesForm.knoten } : {}) },
            };
        },
        aufWiki,
        herkunft: herkunftIm,
        sicherung: {
            // Fassung 3: mit der Herkunft je Feld (WI-0225). Fassung 2 kannte sie nicht, Fassung 1 auch den Wiki-Artikel nicht.
            version: 3,
            aus: (stand) => stand,
            ein(wert) {
                const s = wert as Partial<KraftlinieStand> | null;
                const f = s?.felder;
                if (s === null || typeof s !== "object" || f === undefined) return undefined;
                if (typeof f.name !== "string" || typeof f.labelVisible !== "boolean") return undefined;
                if (typeof f.description !== "string") return undefined;
                if (f.wiki !== null && (typeof f.wiki !== "object" || typeof f.wiki.key !== "string")) return undefined;
                if (typeof f.herkunft !== "object" || f.herkunft === null) return undefined;
                const form = s.form ?? undefined;
                if (form !== undefined && (!Array.isArray(form.teile) || typeof form.enden !== "object"))
                    return undefined;
                return { felder: f, form };
            },
        },
    };
}
