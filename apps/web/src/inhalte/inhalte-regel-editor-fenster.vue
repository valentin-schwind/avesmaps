<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId } from "vue";
import type { InhalteVorkommen, InhalteVorkommenBeziehung, WikisyncRegelBedingung } from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import { t } from "../i18n/i18n";
import { FLAECHEN_LIMIT, ORTE_LIMIT } from "./inhalte-client";
import InhalteRegelEditor from "./inhalte-regel-editor.vue";
import type { EditorBedingung } from "./inhalte-regel-lage";
import {
    neueBedingung,
    regelSatz,
    regelSperre,
    wikiFassungZumHerstellen,
    wikiJetzt,
    type EntwurfRegel,
    type OffenerVorschlag,
} from "./inhalte-vorkommen-regeln-modell";
import type { VorkommenSteuerung } from "./inhalte-vorkommen-steuerung";

/**
 * Das Blatt „Regel bearbeiten“ (WI-0254 `--weiter`; Entwurf `d-editor.js`): ein modales Sekundärfenster über dem Fenster „Inhalte bearbeiten“ mit dem Regeleditor darin
 * (`inhalte-regel-editor.vue`). Es öffnet auf einer Regel des Entwurfs, auf einem Vorschlag des Wikis (dann mit dessen Kette) oder leer.
 *
 * - 🔴 **Es schreibt in den Entwurf, nicht zum Server:** „Regel übernehmen“ legt die Regel in den Entwurf des Fensters (↶ und ↷, Verwerfen gelten), geschrieben wird erst mit „Speichern“
 *   im Fuß von „Inhalte bearbeiten“. Der Fuß hier sagt das.
 * - **„Regel übernehmen“ sperrt mit Grund** (`regelSperre`): eine Lage, der Richtung oder Ort fehlt, eine Bedingung, die nichts einschränkt, oder eine Regel, die es in der Beziehung schon gibt. Der Satz steht im
 *   Fuß, der Knopf zeigt darauf.
 * - **Löschen** gibt es nur an einer Regel, die schon da ist; **↺ Wiki-Fassung** nur an einer Regel von Hand, die auf dem Wiki beruht.
 * - Beziehung und Kette gehören diesem Blatt, solange es offen ist; abgebrochen bleibt der Entwurf, wie er war.
 */
const offen = defineModel<boolean>("offen", { required: true });
const props = defineProps<{
    steuerung: VorkommenSteuerung;
    eintrag: InhalteVorkommen;
    /** Die Regel des Entwurfs, die das Blatt öffnet (`schluessel`); `undefined` bei einer neuen Regel und bei einem Vorschlag. */
    schluessel: string | undefined;
    /** Der Vorschlag des Wikis, aus dem das Blatt ausgeht. */
    vorschlag: OffenerVorschlag | undefined;
    /** Die Regeln des Entwurfs, gegen die „Regel übernehmen“ prüft, ob es die Regel schon gibt. */
    regeln: readonly EntwurfRegel[];
}>();

const s = props.steuerung;
const regel = computed(() =>
    props.schluessel === undefined ? undefined : props.regeln.find((r) => r.schluessel === props.schluessel),
);

const klon = (bedingungen: readonly WikisyncRegelBedingung[]): WikisyncRegelBedingung[] =>
    JSON.parse(JSON.stringify(bedingungen)) as WikisyncRegelBedingung[];
const beginn = ((): {
    relation: InhalteVorkommenBeziehung;
    bedingungen: WikisyncRegelBedingung[];
    ursprung: "wiki" | "manual" | "legacy";
} => {
    const r = regel.value;
    if (r !== undefined) return { relation: r.relation, bedingungen: klon(r.bedingungen), ursprung: r.ursprung };
    const v = props.vorschlag;
    if (v !== undefined) return { relation: v.beziehung, bedingungen: klon(v.bedingungen), ursprung: "wiki" };
    return { relation: "verbreitung", bedingungen: [neueBedingung("und")], ursprung: "manual" };
})();
const relation = ref<InhalteVorkommenBeziehung>(beginn.relation);
const bedingungen = ref<EditorBedingung[]>(beginn.bedingungen);

// --- Die Wiki-Fassung, auf der eine Regel von Hand beruht ---
const vorschlagDesEintrags = computed(() => props.eintrag.wikiVorschlag);
const mitBasis = computed(() => regel.value?.ursprung === "manual" && regel.value.wikiBasis !== undefined);
const basisSatz = computed(() => {
    const basis = regel.value?.wikiBasis?.bedingungen;
    return basis === undefined || !mitBasis.value ? undefined : regelSatz(basis);
});
const jetzt = computed(() =>
    regel.value === undefined ? undefined : wikiJetzt(regel.value, vorschlagDesEintrags.value),
);
const seitherSatz = computed(() => (jetzt.value?.geaendert === true ? regelSatz(jetzt.value.bedingungen) : undefined));
const kannHerstellen = computed(
    () => regel.value !== undefined && wikiFassungZumHerstellen(regel.value, vorschlagDesEintrags.value) !== undefined,
);

// --- Warum „Regel übernehmen“ nicht geht ---
const sperre = computed(() =>
    regelSperre(
        { schluessel: props.schluessel, relation: relation.value, bedingungen: bedingungen.value },
        props.regeln,
    ),
);
const grund = computed<string | undefined>(() => {
    const g = sperre.value;
    if (g === undefined) return undefined;
    if (g.art === "doppelt") return t("inhalte.vorkommen.regeleditor.doppelt");
    if (g.art === "lage") return t("inhalte.vorkommen.regeleditor.lageFehlt", { n: g.n });
    return g.nurEine
        ? t("inhalte.vorkommen.regeleditor.leerWarnungEine")
        : t("inhalte.vorkommen.regeleditor.leerWarnung", { n: g.n });
});
const grundId = useId();

const titel = computed(() =>
    props.schluessel === undefined && props.vorschlag === undefined
        ? t("inhalte.vorkommen.regeleditor.titelNeu")
        : t("inhalte.vorkommen.regeleditor.titelBearbeiten"),
);

function uebernehmen(): void {
    if (grund.value !== undefined) return;
    s.uebernimmRegel({
        schluessel: props.schluessel,
        vorschlag: props.vorschlag?.index,
        relation: relation.value,
        bedingungen: bedingungen.value,
    });
    offen.value = false;
}
function loeschen(): void {
    if (props.schluessel === undefined) return;
    s.loescheRegel(props.schluessel);
    offen.value = false;
}
function stelleHer(): void {
    if (props.schluessel === undefined) return;
    s.stelleRegelWikiHer(props.schluessel);
    offen.value = false;
}

onBeforeUnmount(() => {
    s.leereFlaechen();
    s.leereOrte();
});
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="tafel"
        :titel="titel"
        :zusatz="eintrag.name"
        testid="inhalte-regel-fenster"
    >
        <InhalteRegelEditor
            v-model:relation="relation"
            v-model:bedingungen="bedingungen"
            :eintrag="eintrag"
            :ursprung="beginn.ursprung"
            :mit-basis="mitBasis"
            :basis-satz="basisSatz"
            :seither-satz="seitherSatz"
            :kann-herstellen="kannHerstellen"
            :grund="grund"
            :flaechen-treffer="s.flaechenTreffer.value"
            :flaechen-laedt="s.flaechenLaedt.value"
            :flaechen-max="FLAECHEN_LIMIT"
            :orte-treffer="s.orteTreffer.value"
            :orte-laedt="s.orteLaedt.value"
            :orte-max="ORTE_LIMIT"
            :umriss="s.umriss.value"
            @suche="(text: string) => (s.flaechenText.value = text)"
            @orte-suche="(text: string) => s.sucheOrte(text)"
            @umriss-laden="s.ladeUmriss()"
            @stelle-her="stelleHer"
        />
        <template #fuss-hinweis>
            <span :id="grundId" data-testid="inhalte-regel-fusshinweis">{{
                grund ?? t("inhalte.vorkommen.regeleditor.fussGilt")
            }}</span>
        </template>
        <template #fuss-haupt>
            <span class="fuss">
                <AvmKnopf v-if="regel !== undefined" art="gefahr" testid="inhalte-regel-loeschen" @click="loeschen">{{
                    t("inhalte.vorkommen.regeleditor.regelLoeschen")
                }}</AvmKnopf>
                <AvmKnopf testid="inhalte-regel-abbrechen" @click="offen = false">{{
                    t("inhalte.vorkommen.regeleditor.abbrechen")
                }}</AvmKnopf>
                <AvmKnopf
                    art="gefuellt"
                    :gesperrt="grund"
                    :grund-bei="grundId"
                    testid="inhalte-regel-uebernehmen"
                    @click="uebernehmen"
                    >{{ t("inhalte.vorkommen.regeleditor.regelUebernehmen") }}</AvmKnopf
                >
            </span>
        </template>
    </AvmFenster>
</template>

<style scoped>
.fuss {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-6);
}
</style>
