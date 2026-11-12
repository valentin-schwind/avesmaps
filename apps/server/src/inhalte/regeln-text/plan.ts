import type { InhalteVorkommenArt } from "@avesmaps3d/shared";
import { norm } from "./hilfen.ts";
import type { Gelesen, RegelInnen } from "./typen.ts";
import type { Welt } from "./welt.ts";

/**
 * Was „Übernehmen“ jetzt täte (WI-0254 §13; Port von `txPlan` im Entwurf, aber für ALLE Einträge mit Status `ok`, auch die mit `(Kategorie, neu)`, die angelegt werden): je Eintrag die Regeln mit Status `neu` und
 * die Quellen der `Quelle:`-Zeile, die ihm noch fehlen. Mehrere Köpfe desselben Eintrags (oder desselben neuen Namens in derselben Kategorie) sind EIN Eintrag. Rein, ohne Datenbank.
 */

/** Ein Eintrag, an dem „Übernehmen“ etwas tut. */
export interface PlanEintrag {
    /** `lore_entry.public_id`; `null` bei einem Eintrag, der erst angelegt wird. */
    id: string | null;
    name: string;
    kind: InhalteVorkommenArt;
    neuAnlegen: boolean;
    /** Die Zeile des (ersten) Kopfs, für Fehlermeldungen. */
    zeile: number;
    /** Die Regeln mit Status `neu`, in der Folge des Texts. */
    regeln: RegelInnen[];
    /** Die Quellen, die dem Eintrag noch fehlen (`feature_source.public_id`) mit den Seiten der ersten Zeile, die sie nennt. */
    quellen: { id: string; seiten: string }[];
}

export interface Plan {
    eintraege: PlanEintrag[];
    zahlen: { regeln: number; eintraege: number; quellen: number; anlegen: number };
}

export function bauePlan(g: Gelesen, welt: Welt): Plan {
    const je = new Map<string, PlanEintrag>();
    for (const k of g.eintraege) {
        if (k.status !== "ok" || k.kind === null) continue;
        const schluessel = k.id ?? `neu:${norm(k.name)}|${k.kind}`;
        let p = je.get(schluessel);
        if (p === undefined) {
            p = {
                id: k.id,
                name: k.name,
                kind: k.kind,
                neuAnlegen: k.neuAnlegen,
                zeile: k.zeile,
                regeln: [],
                quellen: [],
            };
            je.set(schluessel, p);
        }
        p.regeln.push(...k.regeln.filter((r) => r.status === "neu"));
        const q = k.quelle;
        if (q !== null && q.status === "ok" && q.id !== null) {
            const quelleId = q.id;
            const schonDa = k.id !== null && welt.hatQuelle(k.id, quelleId);
            if (!schonDa && !p.quellen.some((x) => x.id === quelleId))
                p.quellen.push({ id: quelleId, seiten: q.seiten });
        }
    }
    const eintraege = [...je.values()];
    const beruehrt = eintraege.filter((p) => p.regeln.length > 0 || p.quellen.length > 0);
    return {
        eintraege,
        zahlen: {
            regeln: eintraege.reduce((a, p) => a + p.regeln.length, 0),
            eintraege: beruehrt.length,
            quellen: eintraege.reduce((a, p) => a + p.quellen.length, 0),
            anlegen: eintraege.filter((p) => p.neuAnlegen).length,
        },
    };
}

/** Tut „Übernehmen“ etwas? */
export const planLeer = (plan: Plan): boolean =>
    plan.zahlen.regeln === 0 && plan.zahlen.quellen === 0 && plan.zahlen.anlegen === 0;
