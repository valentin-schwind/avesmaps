<script setup lang="ts">
import { computed } from "vue";
import type {
    InhalteRegelTextEintrag,
    InhalteRegelTextProblem,
    InhalteRegelTextRegel,
    InhalteRegelTextRegelStatus,
} from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import EditorZeichen from "../controls/editor-zeichen.vue";
import { formatNumber, t, type MessageKey } from "../i18n/i18n";
import InhalteRegelSatz from "./inhalte-regel-satz.vue";
import InhalteRegelnTextBefund from "./inhalte-regeln-text-befund.vue";
import {
    eintraegeText,
    fehlerText,
    planLeer,
    planZusaetze,
    rueckfragenText,
    uebernehmenText,
    type TextErsatz,
} from "./inhalte-regeln-text-modell";
import type { RegelTextSteuerung } from "./inhalte-regeln-text-steuerung";
import InhalteRegelnTextZeilenknopf from "./inhalte-regeln-text-zeilenknopf.vue";
import { bedingungAusServer } from "./inhalte-vorkommen-regeln-modell";
import { zeichenDerArt } from "./inhalte-vorkommen-modell";
import { artName, beziehungName } from "./inhalte-vorkommen-texte";

/**
 * Die Vorschau von „Regeln als Text“ (WI-0254 §13; Entwurf `txVorschauHtml`): was das letzte „Prüfen“ aus dem Text macht, und der Knopf „Übernehmen“.
 *
 * - **Die Zahlen** (Einträge, neu, gibt es schon, Rückfragen, Fehler) stehen als Pillen oben; Rückfragen und Fehler zählen Befunde, nicht Regeln. Darunter der Knopf mit dem, was er täte (`plan` des Servers), und
 *   die Meldung zum letzten Schritt.
 * - 🔴 **Die Vorschau gehört zum Text der Prüfung.** Ist der Text seither anders, sagt es ein Hinweis, „Übernehmen“ ist gesperrt und die Antworten auf Rückfragen auch: Ihr Ersatz zielt auf die Stellen des
 *   geprüften Texts. „Übernehmen“ geht nur mit dem Recht, Inhalte zu pflegen; „Prüfen“ und „Als Text“ stehen jedem offen, der das Fenster sieht.
 * - **Je Eintrag eine Karte** (Zeichen der Kategorie, Name, Kategorie, Quelle, „Z. n“), darin je Regel Beziehung, Status (neu, gibt es schon, Rückfrage, Fehler), „Z. n“, der Satz der Regel (derselbe Baustein wie
 *   an der Regelkarte) und die Befunde mit ihren Antworten. Befunde ohne Eintrag (`lose`: eine Quelle-Zeile, eine Regel ohne Kopf) stehen als eigene Karten an ihrer Zeile.
 * - Die Sätze der Befunde und die Antworten kommen vom Server und stehen unverändert da.
 */
const props = defineProps<{
    steuerung: RegelTextSteuerung;
    darfSchreiben: boolean;
}>();
const s = props.steuerung;
const erg = computed(() => s.ergebnis.value);

const STATUS_NAMEN: Readonly<Record<InhalteRegelTextRegelStatus, MessageKey>> = {
    neu: "inhalte.vorkommen.text.status.neu",
    schon: "inhalte.vorkommen.text.status.schon",
    rueckfrage: "inhalte.vorkommen.text.status.rueckfrage",
    fehler: "inhalte.vorkommen.text.status.fehler",
};
const STATUS_TON = { neu: "erfolg", schon: "neutral", rueckfrage: "warnung", fehler: "gefahr" } as const;

/** Warum die Antworten auf Rückfragen gerade nicht gehen (der Text hat sich geändert, eine Anfrage läuft). */
const antwortSperre = computed<string | undefined>(() =>
    s.beschaeftigt.value || !s.aktuell.value ? t("inhalte.vorkommen.text.antwortGesperrt") : undefined,
);

const uebernehmenSperre = computed<string | undefined>(() => {
    if (!props.darfSchreiben) return t("inhalte.nurLesen");
    const e = erg.value;
    // Die Gründe „Text geändert“ und „nichts Neues“ stehen schon im Hinweis und in der Aufschrift.
    return e === undefined || !s.aktuell.value || planLeer(e.plan) || s.beschaeftigt.value ? "" : undefined;
});
const uebernehmenAufschrift = computed(() =>
    s.uebernimmtGerade.value
        ? t("inhalte.vorkommen.text.uebernehmen.laeuft")
        : erg.value === undefined
          ? t("inhalte.vorkommen.text.uebernehmen.nichts")
          : uebernehmenText(erg.value.plan),
);
const zusaetze = computed(() => (erg.value === undefined ? [] : planZusaetze(erg.value.plan)));

/** Die Karten in der Folge des Texts: Einträge und lose Befunde nach ihrer Zeile. */
type Posten =
    | { zeile: number; art: "eintrag"; eintrag: InhalteRegelTextEintrag }
    | { zeile: number; art: "lose"; problem: InhalteRegelTextProblem };
const posten = computed<Posten[]>(() => {
    const e = erg.value;
    if (e === undefined) return [];
    return [
        ...e.eintraege.map((eintrag): Posten => ({ zeile: eintrag.zeile, art: "eintrag", eintrag })),
        ...e.lose.map((problem): Posten => ({ zeile: problem.zeile, art: "lose", problem })),
    ].sort((a, b) => a.zeile - b.zeile);
});

const kategorieName = (e: InhalteRegelTextEintrag): string =>
    e.kategorie === undefined ? t("inhalte.vorkommen.text.karte.kategorieOffen") : artName(e.kategorie);

/** Die Zeile zur Quelle: „Quelle: Titel · S. 12“, dazu was daran offen oder schon erledigt ist. */
function quelleText(e: InhalteRegelTextEintrag): string | undefined {
    const q = e.quelle;
    if (q === undefined) return undefined;
    const teile = [t("inhalte.vorkommen.text.karte.quelle", { titel: q.titel === "" ? "–" : q.titel })];
    if (q.seiten !== undefined && q.seiten !== "")
        teile.push(t("inhalte.vorkommen.text.karte.seiten", { seiten: q.seiten }));
    if (q.status !== "ok") teile.push(t("inhalte.vorkommen.text.karte.quelleOffen"));
    else if (q.vorhanden) teile.push(t("inhalte.vorkommen.text.karte.quelleVorhanden"));
    return teile.join(" · ");
}

/** Der Satz zu einer Regel, die nichts anlegt: warum sie übersprungen wird, oder dass der Eintrag noch aussteht. */
function regelHinweis(e: InhalteRegelTextEintrag, r: InhalteRegelTextRegel): string | undefined {
    if (r.status === "schon") {
        return r.schon?.grund === "stapel" && r.schon.zeile !== undefined
            ? t("inhalte.vorkommen.text.regel.schonStapel", { n: formatNumber(r.schon.zeile + 1, 0) })
            : t("inhalte.vorkommen.text.regel.schonBestehend");
    }
    if (e.status !== "ok" && r.status === "neu") return t("inhalte.vorkommen.text.regel.wartetEintrag");
    return undefined;
}
const bedingungen = (r: InhalteRegelTextRegel) => r.bedingungen?.map(bedingungAusServer) ?? [];

function waehle(ersatz: TextErsatz): void {
    void s.wendeAn(ersatz);
}
const markiere = (von: number, bis: number): void => s.markiere(von, bis);
</script>

<template>
    <div class="tx-vorschau" data-testid="inhalte-text-vorschau" :aria-busy="s.prueftGerade.value">
        <AvmHinweis v-if="s.meldung.value?.ton === 'gefahr'" ton="gefahr" rolle="alert" testid="inhalte-text-fehler">{{
            s.meldung.value.satz
        }}</AvmHinweis>

        <p v-if="erg === undefined" class="tx-leise" data-testid="inhalte-text-ungeprueft">
            {{
                s.prueftGerade.value ? t("inhalte.vorkommen.text.prueftGerade") : t("inhalte.vorkommen.text.ungeprueft")
            }}
        </p>

        <template v-else>
            <AvmHinweis v-if="!s.aktuell.value" ton="warnung" testid="inhalte-text-veraltet">{{
                t("inhalte.vorkommen.text.veraltet")
            }}</AvmHinweis>

            <div class="tx-zahlen" data-testid="inhalte-text-zahlen">
                <AvmPille>{{ eintraegeText(erg.zahlen.eintraege) }}</AvmPille>
                <AvmPille :ton="erg.zahlen.neu > 0 ? 'erfolg' : 'neutral'">{{
                    t("inhalte.vorkommen.text.pille.neu", { n: formatNumber(erg.zahlen.neu, 0) })
                }}</AvmPille>
                <AvmPille>{{
                    t("inhalte.vorkommen.text.pille.schon", { n: formatNumber(erg.zahlen.schon, 0) })
                }}</AvmPille>
                <AvmPille :ton="erg.zahlen.rueckfragen > 0 ? 'warnung' : 'neutral'">{{
                    rueckfragenText(erg.zahlen.rueckfragen)
                }}</AvmPille>
                <AvmPille :ton="erg.zahlen.fehler > 0 ? 'gefahr' : 'neutral'">{{
                    fehlerText(erg.zahlen.fehler)
                }}</AvmPille>
            </div>
        </template>

        <AvmHinweis v-if="s.meldung.value?.ton === 'neutral'" rolle="status" testid="inhalte-text-meldung">{{
            s.meldung.value.satz
        }}</AvmHinweis>

        <template v-if="erg !== undefined">
            <div class="tx-uebernehmen">
                <AvmKnopf
                    art="gefuellt"
                    :gesperrt="uebernehmenSperre"
                    testid="inhalte-text-uebernehmen"
                    @click="void s.uebernimm()"
                    >{{ uebernehmenAufschrift }}</AvmKnopf
                >
                <p class="tx-hinweis">{{ t("inhalte.vorkommen.text.uebernehmenHinweis") }}</p>
                <p v-for="satz in zusaetze" :key="satz" class="tx-hinweis">{{ satz }}</p>
            </div>

            <p v-if="posten.length === 0" class="tx-leise" data-testid="inhalte-text-leer">
                {{ t("inhalte.vorkommen.text.leer") }}
            </p>
            <ul v-else class="tx-karten" data-testid="inhalte-text-karten">
                <template v-for="p in posten" :key="`${p.art}:${String(p.zeile)}`">
                    <li
                        v-if="p.art === 'eintrag'"
                        class="tx-karte"
                        :class="`tx-karte--${p.eintrag.status}`"
                        data-testid="inhalte-text-karte"
                    >
                        <span class="tx-karte__zeichen" aria-hidden="true" :title="kategorieName(p.eintrag)"
                            ><EditorZeichen
                                :name="
                                    p.eintrag.kategorie === undefined
                                        ? 'bearbeiten'
                                        : zeichenDerArt(p.eintrag.kategorie)
                                "
                        /></span>
                        <div class="tx-karte__haupt">
                            <div class="tx-karte__kopf">
                                <span class="tx-karte__name">{{ p.eintrag.name }}</span>
                                <span class="tx-karte__art">{{ kategorieName(p.eintrag) }}</span>
                                <AvmPille v-if="p.eintrag.neuAnlegen" ton="lokal">{{
                                    t("inhalte.vorkommen.text.karte.neuAnlegen")
                                }}</AvmPille>
                                <span class="tx-karte__zeile"
                                    ><InhalteRegelnTextZeilenknopf
                                        :von="p.eintrag.zeile"
                                        :bis="p.eintrag.zeile"
                                        @markiere="markiere"
                                /></span>
                            </div>
                            <p v-if="quelleText(p.eintrag)" class="tx-meta" data-testid="inhalte-text-quelle">
                                {{ quelleText(p.eintrag) }}
                            </p>
                            <p v-else class="tx-meta">{{ t("inhalte.vorkommen.text.karte.ohneQuelle") }}</p>
                            <InhalteRegelnTextBefund
                                v-for="(problem, i) in p.eintrag.probleme"
                                :key="`p${String(i)}`"
                                :problem="problem"
                                :mit-pille="true"
                                :mit-zeile="problem.zeile !== p.eintrag.zeile"
                                :gesperrt="antwortSperre"
                                @waehle="waehle"
                                @markiere="markiere"
                            />
                            <ul v-if="p.eintrag.regeln.length > 0" class="tx-regeln">
                                <li
                                    v-for="(r, i) in p.eintrag.regeln"
                                    :key="`r${String(i)}`"
                                    class="tx-regel"
                                    :class="`tx-regel--${r.status}`"
                                    :data-status="r.status"
                                    data-testid="inhalte-text-regel"
                                >
                                    <div class="tx-regel__kopf">
                                        <AvmPille v-if="r.relation !== undefined">{{
                                            beziehungName(r.relation)
                                        }}</AvmPille>
                                        <AvmPille :ton="STATUS_TON[r.status]">{{ t(STATUS_NAMEN[r.status]) }}</AvmPille>
                                        <span class="tx-regel__zeile"
                                            ><InhalteRegelnTextZeilenknopf
                                                :von="r.zeile"
                                                :bis="r.zeileBis"
                                                @markiere="markiere"
                                        /></span>
                                    </div>
                                    <p class="tx-regel__satz">
                                        <InhalteRegelSatz
                                            v-if="bedingungen(r).length > 0"
                                            :bedingungen="bedingungen(r)"
                                        />
                                        <span
                                            v-else
                                            class="tx-roh"
                                            :title="t('inhalte.vorkommen.text.regel.ungelesen')"
                                            >{{ r.text }}</span
                                        >
                                    </p>
                                    <p v-if="regelHinweis(p.eintrag, r)" class="tx-meta">
                                        {{ regelHinweis(p.eintrag, r) }}
                                    </p>
                                    <InhalteRegelnTextBefund
                                        v-for="(problem, k) in r.probleme"
                                        :key="`b${String(k)}`"
                                        :problem="problem"
                                        :mit-pille="false"
                                        :mit-zeile="problem.zeile !== r.zeile"
                                        :gesperrt="antwortSperre"
                                        @waehle="waehle"
                                        @markiere="markiere"
                                    />
                                </li>
                            </ul>
                            <p v-else class="tx-meta">{{ t("inhalte.vorkommen.text.karte.keineRegel") }}</p>
                        </div>
                    </li>
                    <li v-else class="tx-karte tx-karte--lose" data-testid="inhalte-text-lose">
                        <div class="tx-karte__haupt">
                            <p class="tx-meta">{{ t("inhalte.vorkommen.text.lose.kopf") }}</p>
                            <InhalteRegelnTextBefund
                                :problem="p.problem"
                                :mit-pille="true"
                                :mit-zeile="true"
                                :gesperrt="antwortSperre"
                                @waehle="waehle"
                                @markiere="markiere"
                            />
                        </div>
                    </li>
                </template>
            </ul>
        </template>
    </div>
</template>

<style scoped>
.tx-vorschau {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
}

.tx-leise,
.tx-meta,
.tx-hinweis {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.tx-meta {
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
}

.tx-zahlen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

.tx-uebernehmen {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
}

.tx-karten {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    margin: 0;
    padding: 0;
    list-style: none;
}

/* Eine Karte wie jede Karte des Hauses (Regelkarte, Ortszeile): Kante, Fläche `panel-soft`, das Zeichen der Kategorie links. */
.tx-karte {
    display: flex;
    align-items: flex-start;
    gap: var(--space-8);
    min-width: 0;
    padding: var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.tx-karte--lose {
    background: transparent;
}

.tx-karte__zeichen {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: var(--space-24);
    height: var(--space-24);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    color: var(--color-accent-strong);
}

.tx-karte__haupt {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
}

.tx-karte__kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-6);
}

.tx-karte__name {
    min-width: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
    line-height: var(--leading-normal);
    overflow-wrap: anywhere;
}

.tx-karte__art {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.tx-karte__zeile,
.tx-regel__zeile {
    margin-left: auto;
}

.tx-regeln {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin: var(--space-4) 0 0;
    padding: 0;
    list-style: none;
}

.tx-regel {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-4) var(--space-6);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
}

.tx-regel--rueckfrage {
    border-color: var(--color-warning-soft-border);
}

.tx-regel--fehler {
    border-color: var(--color-danger-soft-border);
}

.tx-regel--schon .tx-regel__satz {
    color: var(--color-text-muted);
}

.tx-regel__kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
}

.tx-regel__satz {
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
    line-height: var(--leading-normal);
    overflow-wrap: anywhere;
}

.tx-roh {
    border-bottom: 1px dashed var(--color-border-strong);
    color: var(--color-text-muted);
}
</style>
