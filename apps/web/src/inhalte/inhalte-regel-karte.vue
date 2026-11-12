<script setup lang="ts">
import { computed } from "vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import { t, type MessageKey } from "../i18n/i18n";
import { TYP_TON, regelStatusName, typName } from "../wikisync/wikisync-regeln-text";
import InhalteRegelSatz from "./inhalte-regel-satz.vue";
import { satzGruppen, satzText } from "./inhalte-regel-satz";
import { regelStatus, regelWartet, type EntwurfRegel, type OffenerVorschlag } from "./inhalte-vorkommen-regeln-modell";
import { beziehungName } from "./inhalte-vorkommen-texte";

/**
 * Eine Karte im Abschnitt „Regelvorkommen“ (WI-0254 `--weiter`; Entwurf `c-fenster.js`, `regelKarte`): eine Regel des Entwurfs oder, gestrichelt, ein Vorschlag des Wikis.
 *
 * - **Die Regel** steht als Satz da (Bedingungen mit UND, ODER und OHNE, gleiche ODER-Bedingungen zusammengefasst, eine wartende Fläche mit „!“), darunter die Zahl der Bedingungen
 *   und die Pillen: Beziehung, Herkunft (Wiki, manuell), „neu“ oder „geändert“ gegenüber dem gespeicherten Stand und „wartet auf Fläche“. Ein Klick öffnet den Editor.
 * - **Eine Regel von Hand, die auf dem Wiki beruht**, nennt die Fassung, von der sie ausging, und sagt, wenn das Wiki seitdem etwas anderes sagt („Wiki geändert“, „Das Wiki sagt seitdem …“).
 *   „↺ Wiki-Fassung“ holt die Fassung des Wikis zurück.
 * - **Ein Vorschlag** schreibt nichts: „Übernehmen“ legt die Regel in den Entwurf, „Bearbeiten“ öffnet sie erst im Editor. Er nennt, was er ersetzt, was sich nicht abbilden lässt und warum
 *   der WikiSync ihn nicht vorgewählt hat.
 * - Die Karte rechnet nichts: Treffer gibt es erst mit der Regelauswertung (WI-0253), bis dahin steht der Satz da.
 */
const props = defineProps<{
    regel?: EntwurfRegel | undefined;
    vorschlag?: OffenerVorschlag | undefined;
    /** Die Wiki-Fassung, auf der die Regel von Hand beruht, als Satz. */
    basisSatz?: string | undefined;
    /** Was das Wiki seitdem sagt, als Satz (nur, wenn es etwas anderes sagt). */
    seitherSatz?: string | undefined;
    kannHerstellen?: boolean | undefined;
    darfSchreiben: boolean;
    /** Der Satz, warum nichts änderbar ist; hier still (`""`), der Grund steht einmal in der Spalte Stammdaten. */
    gesperrt: string | undefined;
}>();
const emit = defineEmits<{ oeffne: []; uebernehmen: []; bearbeiten: []; stelleHer: [] }>();

const bedingungen = computed(() => props.regel?.bedingungen ?? props.vorschlag?.bedingungen ?? []);
const relation = computed(() => props.regel?.relation ?? props.vorschlag?.beziehung ?? "verbreitung");
const status = computed(() => (props.regel === undefined ? "" : regelStatus(props.regel)));
const wartet = computed(() => regelWartet({ bedingungen: bedingungen.value }));
const klickbar = computed(() => props.regel !== undefined && props.darfSchreiben && props.gesperrt === undefined);

const satz = computed(() => satzText(satzGruppen(bedingungen.value)));

const anzahlText = computed(() =>
    t("inhalte.vorkommen.regeleditor.bedingungenN", { n: String(bedingungen.value.length) }),
);
const ursprungName = (ursprung: string): string => t(`inhalte.ursprung.${ursprung}` as MessageKey);
const nichtAbbildbar = computed(() => (props.vorschlag?.teile ?? []).filter((teil) => teil.art === "nicht_abbildbar"));
const ariaLabel = computed(() => `${t("inhalte.vorkommen.regeleditor.regel")}: ${satz.value.trim()}`);

function taste(event: KeyboardEvent): void {
    if (!klickbar.value || event.target !== event.currentTarget) return;
    event.preventDefault();
    emit("oeffne");
}
function klick(event: MouseEvent): void {
    if (!klickbar.value) return;
    // Ein Knopf in der Karte hat seine eigene Wirkung.
    if ((event.target as HTMLElement).closest("button") !== null) return;
    emit("oeffne");
}
</script>

<template>
    <li
        class="karte"
        :class="{
            'is-vorschlag': vorschlag !== undefined,
            'is-klickbar': klickbar,
            'is-neu': status === 'neu',
            'is-geaendert': status === 'geaendert',
        }"
        :tabindex="klickbar ? 0 : undefined"
        :role="klickbar ? 'button' : undefined"
        :aria-label="ariaLabel"
        :data-state="regel?.state"
        :data-rule="regel?.ruleId"
        :data-regel="regel?.schluessel"
        :data-testid="vorschlag === undefined ? 'inhalte-regel' : 'inhalte-regel-vorschlag'"
        @click="klick"
        @keydown.enter="taste"
        @keydown.space="taste"
    >
        <div class="karte__haupt">
            <div v-if="vorschlag" class="karte__kopfzeile">
                <span class="regel__vorschlagwort avm-versalmitte">{{
                    t("inhalte.vorkommen.regeleditor.vorschlag")
                }}</span>
            </div>
            <div class="karte__titel" data-testid="inhalte-regel-satz">
                <InhalteRegelSatz :bedingungen="bedingungen" />
            </div>
            <div class="karte__meta">{{ t("inhalte.vorkommen.regeleditor.regel") }} · {{ anzahlText }}</div>
            <div v-if="vorschlag && vorschlag.ersetzt > 0" class="karte__meta">
                {{ t("inhalte.vorkommen.regeleditor.vorschlagErsetzt", { n: String(vorschlag.ersetzt) }) }}
            </div>
            <template v-if="regel && basisSatz !== undefined">
                <div class="karte__meta" data-testid="inhalte-regel-basis">
                    {{ t("inhalte.vorkommen.regeleditor.ersetztWiki", { satz: basisSatz }) }}
                </div>
                <div
                    v-if="seitherSatz !== undefined"
                    class="karte__meta karte__meta--warn"
                    data-testid="inhalte-regel-seither"
                >
                    {{ t("inhalte.vorkommen.regeleditor.wikiSeither", { satz: seitherSatz }) }}
                </div>
            </template>
            <div v-if="nichtAbbildbar.length > 0" class="karte__meta">
                {{
                    nichtAbbildbar
                        .map((teil) => t("inhalte.vorkommen.regeleditor.vorschlagTeile", { text: teil.text }))
                        .join(" · ")
                }}
            </div>
            <div v-if="vorschlag" class="karte__meta">
                {{ t("inhalte.vorkommen.regeleditor.vorschlagNicht", { grund: typName(vorschlag.typ) }) }}
            </div>
            <div class="karte__treffer">{{ t("inhalte.vorkommen.regeleditor.treffer") }}</div>
            <div class="karte__chips">
                <AvmPille>{{ beziehungName(relation) }}</AvmPille>
                <AvmPille :ton="regel?.ursprung === 'manual' ? 'warnung' : 'neutral'">{{
                    ursprungName(regel?.ursprung ?? "wiki")
                }}</AvmPille>
                <AvmPille
                    v-if="seitherSatz !== undefined"
                    ton="warnung"
                    :title="t('inhalte.vorkommen.regeleditor.wikiGeaendertTitel')"
                    >{{ t("inhalte.vorkommen.regeleditor.wikiGeaendert") }}</AvmPille
                >
                <AvmPille v-if="status !== ''" ton="lokal">{{ regelStatusName(status) }}</AvmPille>
                <AvmPille
                    v-if="wartet && !(vorschlag && vorschlag.typ === 'wartet')"
                    ton="warnung"
                    :title="t('inhalte.vorkommen.regeleditor.wartetErst')"
                    >! {{ typName("wartet") }}</AvmPille
                >
                <AvmPille
                    v-if="vorschlag"
                    :ton="TYP_TON[vorschlag.typ]"
                    :title="vorschlag.typ === 'wartet' ? t('inhalte.vorkommen.regeleditor.wartetErst') : undefined"
                    >{{ vorschlag.typ === "wartet" ? "! " : "" }}{{ typName(vorschlag.typ) }}</AvmPille
                >
            </div>
            <div v-if="vorschlag && darfSchreiben" class="karte__fuss karte__fuss--knoepfe">
                <AvmKnopf
                    art="gefuellt"
                    groesse="zeile"
                    :gesperrt="gesperrt"
                    testid="inhalte-regel-vorschlag-uebernehmen"
                    @click="emit('uebernehmen')"
                    >{{ t("inhalte.vorkommen.regeleditor.vorschlagUebernehmen") }}</AvmKnopf
                >
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="gesperrt"
                    testid="inhalte-regel-vorschlag-bearbeiten"
                    @click="emit('bearbeiten')"
                    >{{ t("inhalte.vorkommen.regeleditor.bearbeiten") }}</AvmKnopf
                >
            </div>
            <div v-else-if="regel && darfSchreiben" class="karte__fuss karte__fuss--knoepfe">
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="gesperrt"
                    testid="inhalte-regel-bearbeiten"
                    @click="emit('bearbeiten')"
                    >✎ {{ t("inhalte.vorkommen.regeleditor.bearbeiten") }}</AvmKnopf
                >
                <AvmKnopf
                    v-if="kannHerstellen"
                    groesse="zeile"
                    :gesperrt="gesperrt"
                    :title="t('inhalte.vorkommen.regeleditor.wikiWiederherstellen')"
                    testid="inhalte-regel-wiederherstellen"
                    @click="emit('stelleHer')"
                    >{{ t("inhalte.vorkommen.regeleditor.wikiWiederherstellenKurz") }}</AvmKnopf
                >
            </div>
        </div>
    </li>
</template>

<style scoped>
.karte {
    display: flex;
    align-items: flex-start;
    gap: var(--space-8);
    padding: var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.karte.is-klickbar {
    cursor: pointer;
}

.karte.is-klickbar:hover {
    border-color: var(--color-border-strong);
    background-image: linear-gradient(var(--color-hover-wash), var(--color-hover-wash));
}

.karte:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

/* Ein Vorschlag ist noch keine Regel: gestrichelt, ohne Fläche, leiser. */
.karte.is-vorschlag {
    border-style: dashed;
    border-color: var(--color-border-strong);
    background: transparent;
}

.karte.is-vorschlag .karte__titel,
.karte.is-vorschlag .karte__meta,
.karte.is-vorschlag .karte__treffer {
    opacity: 0.86;
}

.karte__haupt {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.karte__kopfzeile {
    margin-bottom: var(--space-2);
}

.regel__vorschlagwort {
    color: var(--color-accent-brown);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.karte__titel {
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
    line-height: var(--leading-normal);
    overflow-wrap: anywhere;
}

.karte__meta {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.karte__meta--warn {
    color: var(--color-warning-soft-text);
}

/* Die Treffer-Vorschau: abgesetzt von den Angaben zur Regel. */
.karte__treffer {
    margin-top: var(--space-2);
    color: var(--color-text);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
}

.karte__chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
    margin-top: var(--space-4);
}

.karte__fuss {
    margin-top: var(--space-6);
}

.karte__fuss--knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-6);
}

@media (prefers-reduced-motion: reduce) {
    .karte {
        transition: none;
    }
}
</style>
