import type {
    InhalteRegelTextEintrag,
    InhalteRegelTextErgebnis,
    InhalteRegelTextQuelle,
    InhalteRegelTextRegel,
} from "@avesmaps3d/shared";
import { kategorieVon, lies } from "./lies.ts";
import { bauePlan, type Plan } from "./plan.ts";
import { restText } from "./rest.ts";
import { bedingungVertrag } from "./schluessel.ts";
import type { EintragInnen, Gelesen, QuelleInnen, RegelInnen } from "./typen.ts";
import type { Welt } from "./welt.ts";

/**
 * Das Ergebnis des Prüfens in der Vertragsform (`InhalteRegelTextErgebnis`, `packages/shared/src/inhalte-regeln-text.ts`): aus dem, was `lies` innen führt, die Einträge mit Regeln, Quellen und Befunden, die Zahlen für die
 * Pillen, der Plan (was „Übernehmen“ jetzt täte) und der Text, der danach stehen bliebe (`rest`). Rein, ohne Datenbank.
 */

function regelVertrag(r: RegelInnen, welt: Welt): InhalteRegelTextRegel {
    return {
        zeile: r.zeile,
        zeileBis: r.zeileBis,
        ...(r.relation === null ? {} : { relation: r.relation }),
        status: r.status,
        ...(r.schon === null
            ? {}
            : { schon: { grund: r.schon.grund, ...(r.schon.zeile === undefined ? {} : { zeile: r.schon.zeile }) } }),
        text: r.text,
        // Die Kette steht nur da, wo jedes Glied lesbar war.
        ...(r.bedingungen.length > 0 && r.bedingungen.every((b) => b.ok)
            ? { bedingungen: r.bedingungen.map((b) => bedingungVertrag(b, welt)) }
            : {}),
        probleme: r.probleme,
    };
}

function quelleVertrag(k: EintragInnen, q: QuelleInnen, welt: Welt): InhalteRegelTextQuelle {
    return {
        zeile: q.zeile,
        titel: q.titel,
        ...(q.seiten === "" ? {} : { seiten: q.seiten }),
        status: q.status,
        ...(q.id === null ? {} : { kennung: q.id }),
        vorhanden: k.id !== null && q.id !== null && welt.hatQuelle(k.id, q.id),
    };
}

function eintragVertrag(k: EintragInnen, welt: Welt): InhalteRegelTextEintrag {
    const kategorie = kategorieVon(k, welt);
    return {
        zeile: k.zeile,
        name: k.name,
        ...(kategorie === undefined ? {} : { kategorie }),
        ...(k.id === null ? {} : { kennung: k.id }),
        neuAnlegen: k.neuAnlegen,
        status: k.status,
        ...(k.quelle === null ? {} : { quelle: quelleVertrag(k, k.quelle, welt) }),
        probleme: k.probleme,
        regeln: k.regeln.map((r) => regelVertrag(r, welt)),
    };
}

/** Das Ergebnis eines gelesenen Texts. `plan` ist, was „Übernehmen“ daraus anlegte (`bauePlan`). */
export function alsErgebnis(text: string, gelesen: Gelesen, plan: Plan, welt: Welt): InhalteRegelTextErgebnis {
    // Außerhalb eines Eintrags: Befunde der `Quelle:`-Zeilen und was keinen Kopf oder keine Zeile davor hat, in der Folge des Texts.
    const lose = [...gelesen.lose, ...gelesen.quellen.flatMap((q) => q.probleme)].sort((a, b) => a.zeile - b.zeile);
    return {
        zahlen: gelesen.zahlen,
        plan: plan.zahlen,
        eintraege: gelesen.eintraege.map((k) => eintragVertrag(k, welt)),
        lose,
        rest: restText(text, gelesen),
    };
}

/** Text lesen und gegen die Welt auflösen: `lies`, der Plan und das Ergebnis in einem Zug (das Prüfen; das Übernehmen liest dieselben Teile einzeln). */
export function pruefeText(
    text: string,
    welt: Welt,
): { gelesen: Gelesen; plan: Plan; ergebnis: InhalteRegelTextErgebnis } {
    const gelesen = lies(text, welt);
    const plan = bauePlan(gelesen, welt);
    return { gelesen, plan, ergebnis: alsErgebnis(text, gelesen, plan, welt) };
}
