import { computed } from "vue";
import type { KanonObjektart } from "@avesmaps3d/shared";
import { formatList, t } from "../i18n/i18n";
import type { Wikisync } from "./wikisync";
import { sofortTafel, type Sofort } from "./wikisync-sofort";
import { anzahl, artName, umgebungKurz } from "./wikisync-text";
import {
    bez,
    bezZuLang,
    gleichNs,
    gleichOhne,
    nsAenderungen,
    nsAusServer,
    nsKoerperZeile,
    nsSumme,
    ohneAenderungen,
    ohneAusServer,
    ohneKoerperZeile,
    ohneSumme,
    type NsSumme,
    type NsZeile,
    type OhneZeile,
} from "./wikisync-tafeln";

/**
 * Die zwei Tafeln des Kanon-Etiketts mit dem Speichern jeder Änderung (WI-0253, Vali 2026-10-27), ohne Dom: Welche Zeile, was geschickt wird, wann ein Text gilt und
 * der Satz zur Wirkung danach. Das Speichern selbst (Wunsch, Reihe, Rücksprung) steht in `wikisync-sofort.ts`; die Bauteile `wikisync-namensraeume.vue` und
 * `wikisync-ohne.vue` zeigen nur, was hier herauskommt.
 */

// ── Ohne Wiki-Artikel und ohne Quelle ─────────────────────────────────────────────────────────────────────────────────────────────

/** Der Satz zur Wirkung, aus den Zahlen des Servers: je Art die Objekte ohne Kanon-Zeile (bei Wegen eine Obergrenze). */
export function ohneWirkungSatz(summe: ReturnType<typeof ohneSumme>): string {
    const vor = (n: number): string =>
        summe.obergrenze ? t("admin.wikisync.ohne.bisZu", { objekte: anzahl.objekte(n) }) : anzahl.objekte(n);
    const teile = [
        summe.bekommen > 0 ? t("admin.wikisync.ohne.bekommen", { objekte: vor(summe.bekommen) }) : "",
        summe.verlieren > 0 ? t("admin.wikisync.ohne.verlieren", { objekte: vor(summe.verlieren) }) : "",
        summe.nurBez > 0 ? t("admin.wikisync.ohne.nurBez", { objekte: vor(summe.nurBez) }) : "",
    ].filter((teil) => teil !== "");
    return teile.length === 0 ? t("admin.wikisync.ohne.keinWechsel") : formatList(teile);
}

/** Der Satz nach dem Speichern einer Art, gerechnet aus dem Stand davor. */
export function ohneSatz(alt: OhneZeile | undefined, neu: OhneZeile | null, umgebung: string): string {
    if (alt === undefined || neu === null) return "";
    const kopf = t("admin.wikisync.ohne.gespeichert", { art: artName(neu.art), umgebung: umgebungKurz(umgebung) });
    const aenderung = ohneAenderungen([alt], [neu])[0];
    if (aenderung?.wirkung === "still") return `${kopf} ${t("admin.wikisync.ohne.still")}`;
    return `${kopf} ${ohneWirkungSatz(ohneSumme(aenderung === undefined ? [] : [aenderung]))}.`;
}

export function ohneSofort(ws: Wikisync, umgebung: () => string): Sofort<OhneZeile, KanonObjektart> {
    const gespeichert = computed((): OhneZeile[] => ohneAusServer(ws.tafeln.value?.objektarten ?? []));
    return sofortTafel<OhneZeile, KanonObjektart>({
        wikisync: ws,
        wo: "ohne",
        schluessel: (zeile) => zeile.art,
        gespeichert: () => gespeichert.value,
        gleich: gleichOhne,
        koerper: (zeile) => ({ objektarten: zeile === null ? [] : [ohneKoerperZeile(zeile)] }),
        satz: (alt, neu) => ohneSatz(alt, neu, umgebung()),
        textVon: (zeile) => zeile.bezeichner,
        mitText: (zeile, text) => ({ ...zeile, bezeichner: bez(text) }),
        grund: (zeile) =>
            bezZuLang(zeile.bezeichner)
                ? t("admin.wikisync.tafel.fehler.bezeichner_zu_lang", { zeile: artName(zeile.art) })
                : undefined,
    });
}

// ── Namensräume ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Der Satz zur Zahl der Objekte, die ihr Etikett wechseln. */
export function etikettSatz(summe: NsSumme): string {
    if (summe.etikettRaeume === 0 || summe.kanonObjekte + summe.bezObjekte === 0)
        return t("admin.wikisync.ns.keinWechsel");
    if (summe.kanonObjekte > 0 && summe.bezObjekte > 0)
        return t("admin.wikisync.ns.wechselBeide", {
            kanon: anzahl.objekte(summe.kanonObjekte),
            bez: anzahl.objekte(summe.bezObjekte),
        });
    if (summe.bezObjekte > 0) return t("admin.wikisync.ns.wechselBez", { objekte: anzahl.objekte(summe.bezObjekte) });
    return t("admin.wikisync.ns.wechselKanon", { objekte: anzahl.objekte(summe.kanonObjekte) });
}

/** Der Satz nach dem Speichern eines Raums, aus dem Stand davor: Die Zahlen sind die des Servers (Objekte mit Wiki-Zuweisung im Raum). */
export function nsSatz(alt: NsZeile | undefined, neu: NsZeile | null, ns: number, umgebung: string): string {
    if (neu === null) return `${t("admin.wikisync.ns.wirkung.weg", { nr: ns, praefix: alt?.praefix ?? "" })}.`;
    if (alt === undefined) {
        const teile = [
            `${t("admin.wikisync.ns.wirkung.neu", {
                nr: ns,
                praefix: neu.praefix,
                kanon: t(`admin.wikisync.ns.kanon.${neu.kanon}`),
                einsammeln: t(neu.einsammeln ? "admin.wikisync.ja" : "admin.wikisync.nein"),
            })}.`,
        ];
        if (neu.einsammeln) teile.push(t("admin.wikisync.ns.gespeichertEinsammeln"));
        return teile.join(" ");
    }
    const summe = nsSumme(nsAenderungen([alt], [neu]));
    const teile = [
        t("admin.wikisync.ns.gespeichert", { nr: ns, umgebung: umgebungKurz(umgebung) }),
        etikettSatz(summe),
    ];
    // Das Speichern rechnet die Etiketten nicht neu (Map Mutation Guard): Sie folgen beim Neuberechnen.
    if (summe.kanonObjekte + summe.bezObjekte > 0) teile.push(t("admin.wikisync.ns.gespeichertEtikett"));
    if (summe.einsammelnRaeume > 0) teile.push(t("admin.wikisync.ns.gespeichertEinsammeln"));
    return teile.join(" ");
}

export function nsSofort(ws: Wikisync, umgebung: () => string): Sofort<NsZeile, number> {
    const gespeichert = computed((): NsZeile[] => nsAusServer(ws.tafeln.value?.namensraeume ?? []));
    return sofortTafel<NsZeile, number>({
        wikisync: ws,
        wo: "namensraeume",
        schluessel: (zeile) => zeile.ns,
        gespeichert: () => gespeichert.value,
        gleich: gleichNs,
        koerper: (zeile, ns) => (zeile === null ? { entfernen: [ns] } : { namensraeume: [nsKoerperZeile(zeile)] }),
        satz: (alt, neu, ns) => nsSatz(alt, neu, ns, umgebung()),
        textVon: (zeile) => zeile.bezeichner,
        mitText: (zeile, text) => ({ ...zeile, bezeichner: bez(text) }),
        grund: (zeile) =>
            bezZuLang(zeile.bezeichner)
                ? t("admin.wikisync.tafel.fehler.bezeichner_zu_lang", { zeile: zeile.ns })
                : undefined,
    });
}
