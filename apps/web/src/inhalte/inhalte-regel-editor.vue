<script setup lang="ts">
import { computed, ref } from "vue";
import {
    INHALTE_VORKOMMEN_BEDINGUNGEN_MAX,
    INHALTE_VORKOMMEN_BEZIEHUNGEN,
    type InhalteVorkommen,
    type InhalteVorkommenBeziehung,
    type InhalteVorkommenFlaeche,
    type InhalteVorkommenLageOrt,
    type InhalteVorkommenUmriss,
    type InhalteVorkommenUrsprung,
} from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import { t, type MessageKey } from "../i18n/i18n";
import WikisyncBedingung from "../wikisync/wikisync-bedingung.vue";
import { verknuepfungName } from "../wikisync/wikisync-regeln-text";
import InhalteRegelBedingung from "./inhalte-regel-bedingung.vue";
import type { EditorBedingung } from "./inhalte-regel-lage";
import { neueBedingung } from "./inhalte-vorkommen-regeln-modell";
import { beziehungName } from "./inhalte-vorkommen-texte";
import { wikiKlartext } from "./wiki-klartext";

/**
 * Der Inhalt des Regeleditors (WI-0254 `--weiter`; Entwurf `d-editor.js`, abgenommen von Vali am 2026-10-28): links die Kette der Bedingungen, rechts, was das Wiki sagt.
 *
 * - **Der Satz steht oben und klebt beim Rollen** („Die Regel liest sich: …“), damit man beim Bauen der Kette liest, was sie sagt. Eine lange Kette hat einen langen Satz: Er klebt
 *   dann nicht, sonst fräße er das Fenster auf.
 * - **Die Kette** liest sich von links nach rechts, ohne Klammern; zwischen zwei Bedingungen wählt man UND, ODER oder OHNE („OHNE“ nimmt das Ergebnis bis dahin ohne diese
 *   Bedingung). Ab fünf Bedingungen steht nur die neueste offen, der Rest als Zeile, sonst wüchse die Kette ins Endlose.
 * - **Rechts „Im Wiki steht“** (der Wortlaut des Wikis, wie die Ableitung ihn las: gelesen, teilweise gelesen, nicht darstellbar) und „Was die Regel trifft“: Der Rechenweg bleibt „—“.
 *   🔴 Die Auswertung der Regeln gibt es noch nicht (WI-0253); der Treffer ist **unbekannt, nicht 0**.
 * - Der Editor hält die Beziehung und die Kette im Modell der Eltern (`relation`, `bedingungen`); „Regel übernehmen“, Löschen und Abbrechen gehören dem Fenster.
 */
const relation = defineModel<InhalteVorkommenBeziehung>("relation", { required: true });
const bedingungen = defineModel<EditorBedingung[]>("bedingungen", { required: true });
const props = defineProps<{
    eintrag: InhalteVorkommen;
    ursprung: InhalteVorkommenUrsprung;
    /** Die Regel von Hand beruht auf einer Fassung des Wikis. */
    mitBasis: boolean;
    /** Die Fassung des Wikis, auf der sie beruht, als Satz; `undefined`, wo sie nicht mehr bekannt ist. */
    basisSatz: string | undefined;
    /** Was das Wiki seitdem sagt, als Satz; nur, wenn es etwas anderes sagt. */
    seitherSatz: string | undefined;
    kannHerstellen: boolean;
    /** Warum „Regel übernehmen“ nicht geht; hier als Zeile über der Kette (auch: eine Lage, der Richtung oder Ort fehlt). */
    grund: string | undefined;
    flaechenTreffer: readonly InhalteVorkommenFlaeche[];
    flaechenLaedt: boolean;
    flaechenMax: number;
    /** Die Orte der Lage zu einer Linie und der Umriss Aventuriens für die Skizze. */
    orteTreffer: readonly InhalteVorkommenLageOrt[];
    orteLaedt: boolean;
    orteMax: number;
    umriss: InhalteVorkommenUmriss | undefined;
}>();
const emit = defineEmits<{ stelleHer: []; suche: [text: string]; orteSuche: [text: string]; umrissLaden: [] }>();

/** Ab so vielen Bedingungen steht nur eine offen. */
const ZU_AB = 5;

const beziehungen = computed(() => INHALTE_VORKOMMEN_BEZIEHUNGEN.map((wert) => ({ wert, text: beziehungName(wert) })));
const alsBeziehung = (wert: string): InhalteVorkommenBeziehung =>
    (INHALTE_VORKOMMEN_BEZIEHUNGEN as readonly string[]).includes(wert)
        ? (wert as InhalteVorkommenBeziehung)
        : "verbreitung";

// --- Die Kette ---
const zu = ref<ReadonlySet<number>>(
    new Set(bedingungen.value.length >= ZU_AB ? bedingungen.value.map((_, i) => i).filter((i) => i > 0) : []),
);
const n = computed(() => bedingungen.value.length);
const voll = computed(() => n.value >= INHALTE_VORKOMMEN_BEDINGUNGEN_MAX);

function aktualisiere(index: number, bedingung: EditorBedingung): void {
    bedingungen.value = bedingungen.value.map((b, i) => (i === index ? bedingung : b));
}
function umschalten(index: number): void {
    const neu = new Set(zu.value);
    if (neu.has(index)) neu.delete(index);
    else neu.add(index);
    zu.value = neu;
}
function dazu(): void {
    if (voll.value) return;
    bedingungen.value = [...bedingungen.value, neueBedingung("oder")];
    const letzte = bedingungen.value.length - 1;
    // Ab fünf Bedingungen klappt alles außer der neuen zu.
    zu.value = new Set(
        bedingungen.value.length >= ZU_AB ? bedingungen.value.map((_, i) => i).filter((i) => i < letzte) : [],
    );
}
function weg(index: number): void {
    if (n.value < 2) return;
    const rest = bedingungen.value.filter((_, i) => i !== index);
    // Die erste Bedingung hat keine Verknüpfung davor.
    bedingungen.value = rest.map((b, i) => (i === 0 ? { ...b, verknuepfung: "und" } : b));
    zu.value = new Set(
        rest.length < ZU_AB ? [] : [...zu.value].filter((i) => i !== index).map((i) => (i > index ? i - 1 : i)),
    );
}
function verknuepfe(index: number, wert: EditorBedingung["verknuepfung"]): void {
    bedingungen.value = bedingungen.value.map((b, i) => (i === index ? { ...b, verknuepfung: wert } : b));
}

const VERKNUEPFUNGEN = ["und", "oder", "ohne"] as const;
const verknuepfungen = computed(() => VERKNUEPFUNGEN.map((wert) => ({ value: wert, label: verknuepfungName(wert) })));
const alsVerknuepfung = (wert: string): EditorBedingung["verknuepfung"] =>
    (VERKNUEPFUNGEN as readonly string[]).includes(wert) ? (wert as EditorBedingung["verknuepfung"]) : "und";

// --- Rechts: Was das Wiki sagt ---
const original = computed(() => props.eintrag.wikiVorschlag?.original ?? []);
const lebensraum = computed(() => wikiKlartext(props.eintrag.lebensraum ?? ""));
const ursprungName = computed(() => t(`inhalte.ursprung.${props.ursprung}` as MessageKey));
const herkunftHinweis = computed(() => {
    if (props.mitBasis) return t("inhalte.vorkommen.regeleditor.herkunftHinweisErsetzt");
    return props.ursprung === "manual"
        ? t("inhalte.vorkommen.regeleditor.herkunftHinweisManuell")
        : t("inhalte.vorkommen.regeleditor.herkunftHinweisWiki");
});
</script>

<template>
    <div class="re-huelle" data-testid="inhalte-regel-editor">
        <div class="re">
            <div class="re__links">
                <div class="re__kopf">
                    <label class="re__beziehung">
                        <span class="re-hinweis">{{ t("inhalte.vorkommen.regeleditor.beziehung") }}</span>
                        <AvmAuswahl
                            :model-value="relation"
                            groesse="zeile"
                            :optionen="beziehungen"
                            testid="inhalte-regel-beziehung"
                            @update:model-value="(wert: string) => (relation = alsBeziehung(wert))"
                        />
                    </label>
                    <span class="re__herkunft">
                        <span class="re-hinweis">{{ t("inhalte.vorkommen.regeleditor.herkunft") }}</span>
                        <AvmPille
                            :ton="ursprung === 'manual' ? 'warnung' : 'neutral'"
                            testid="inhalte-regel-herkunft"
                            >{{ ursprungName }}</AvmPille
                        >
                    </span>
                    <p class="re-hinweis re__herkunfthinweis" data-testid="inhalte-regel-herkunfthinweis">
                        {{ herkunftHinweis }}
                    </p>
                </div>

                <div v-if="mitBasis" class="re__fassung" data-testid="inhalte-regel-fassung">
                    <div class="re__fassung-text">
                        <p v-if="basisSatz !== undefined" class="re-hinweis">
                            {{ t("inhalte.vorkommen.regeleditor.ersetztWiki", { satz: basisSatz }) }}
                        </p>
                        <p
                            v-if="seitherSatz !== undefined"
                            class="re-hinweis re-hinweis--warn"
                            data-testid="inhalte-regel-seither"
                        >
                            {{ t("inhalte.vorkommen.regeleditor.wikiSeither", { satz: seitherSatz }) }}
                        </p>
                    </div>
                    <AvmKnopf
                        v-if="kannHerstellen"
                        :title="
                            seitherSatz !== undefined
                                ? t('inhalte.vorkommen.regeleditor.wikiGeaendertTitel')
                                : undefined
                        "
                        testid="inhalte-regel-herstellen"
                        @click="emit('stelleHer')"
                        >{{ t("inhalte.vorkommen.regeleditor.wikiWiederherstellen") }}</AvmKnopf
                    >
                </div>

                <p class="re-hinweis">{{ t("inhalte.vorkommen.regeleditor.leerHinweis") }}</p>

                <div class="re__satzbox" :class="{ 're__satzbox--lang': n > 5 }">
                    <AvmHinweis class="re__satzhinweis">
                        <span class="re__satzlabel avm-versalmitte">{{ t("inhalte.vorkommen.regeleditor.satz") }}</span>
                        <p class="re__satz" data-testid="inhalte-regel-satz">
                            <template v-for="(b, i) in bedingungen" :key="i"
                                ><span v-if="i > 0" class="re__op">{{ ` ${verknuepfungName(b.verknuepfung)} ` }}</span
                                ><WikisyncBedingung :bedingung="b" /></template
                            >.
                        </p>
                    </AvmHinweis>
                </div>
                <p v-if="grund !== undefined" class="re-hinweis re-hinweis--warn" data-testid="inhalte-regel-grund">
                    {{ grund }}
                </p>

                <div class="re__kette" data-testid="inhalte-regel-kette">
                    <template v-for="(b, i) in bedingungen" :key="i">
                        <template v-if="i > 0">
                            <div class="re__verknuepfung" data-testid="inhalte-regel-verknuepfung">
                                <AvmSegmente
                                    class="re__wahl"
                                    :model-value="b.verknuepfung"
                                    :options="verknuepfungen"
                                    :label="t('inhalte.vorkommen.regeleditor.verknuepfungMit', { n: i })"
                                    :testid="`inhalte-regel-verknuepfung-${String(i)}`"
                                    @update:model-value="(wert: string) => verknuepfe(i, alsVerknuepfung(wert))"
                                />
                            </div>
                            <p v-if="b.verknuepfung === 'ohne'" class="re__ohne">
                                {{ t("inhalte.vorkommen.regeleditor.ohneHinweis") }}
                            </p>
                        </template>
                        <InhalteRegelBedingung
                            :bedingung="b"
                            :nummer="i + 1"
                            :zu="zu.has(i)"
                            :darf-weg="n > 1"
                            :flaechen-treffer="flaechenTreffer"
                            :flaechen-laedt="flaechenLaedt"
                            :flaechen-max="flaechenMax"
                            :orte-treffer="orteTreffer"
                            :orte-laedt="orteLaedt"
                            :orte-max="orteMax"
                            :umriss="umriss"
                            @update:bedingung="(neu: EditorBedingung) => aktualisiere(i, neu)"
                            @umschalten="umschalten(i)"
                            @entfernen="weg(i)"
                            @suche="(text: string) => emit('suche', text)"
                            @orte-suche="(text: string) => emit('orteSuche', text)"
                            @umriss-laden="emit('umrissLaden')"
                        />
                    </template>
                </div>

                <div class="re__plus">
                    <AvmKnopf
                        groesse="zeile"
                        :gesperrt="
                            voll
                                ? t('inhalte.vorkommen.regeleditor.bedingungenMax', {
                                      n: INHALTE_VORKOMMEN_BEDINGUNGEN_MAX,
                                  })
                                : undefined
                        "
                        testid="inhalte-regel-bedingung-neu"
                        @click="dazu"
                        >{{ t("inhalte.vorkommen.regeleditor.bedingungPlus") }}</AvmKnopf
                    >
                    <span class="re-hinweis" data-testid="inhalte-regel-anzahl">{{
                        t("inhalte.vorkommen.regeleditor.bedingungenN", { n })
                    }}</span>
                </div>
                <p class="re-hinweis">{{ t("admin.wikisync.regeln.vonLinksNachRechts") }}</p>
            </div>

            <aside class="re__rechts">
                <section class="re__panel" data-testid="inhalte-regel-wiki">
                    <h3 class="re__panel-titel avm-versalmitte">{{ t("inhalte.vorkommen.regeleditor.wiki") }}</h3>
                    <dl v-if="original.length > 0" class="re-wiki">
                        <template v-for="feld in original" :key="feld.feld">
                            <dt>{{ beziehungName(feld.feld) }}</dt>
                            <dd>
                                <template v-for="(teil, k) in feld.teile" :key="k"
                                    ><span class="re-teil" :class="`re-teil--${teil.zustand}`">{{ teil.text }}</span
                                    >{{ k < feld.teile.length - 1 ? teil.trenner : "" }}</template
                                >
                            </dd>
                        </template>
                    </dl>
                    <dl v-else-if="lebensraum !== ''" class="re-wiki">
                        <dt>{{ t("inhalte.vorkommen.feld.lebensraum") }}</dt>
                        <dd>{{ lebensraum }}</dd>
                    </dl>
                    <p v-if="original.length > 0" class="re-hinweis">
                        {{ t("inhalte.vorkommen.regeleditor.originalHinweis") }}
                    </p>
                </section>
                <section class="re__panel" data-testid="inhalte-regel-trifft">
                    <h3 class="re__panel-titel avm-versalmitte">{{ t("inhalte.vorkommen.regeleditor.wasTrifft") }}</h3>
                    <table class="re-rechen">
                        <thead>
                            <tr>
                                <th></th>
                                <th>{{ t("inhalte.vorkommen.regeleditor.rechenFlaechen") }}</th>
                                <th>{{ t("inhalte.vorkommen.regeleditor.rechenSiedlungen") }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <template v-for="(b, i) in bedingungen" :key="i">
                                <tr v-if="i > 0" class="re-rechen__op">
                                    <td colspan="3">{{ verknuepfungName(b.verknuepfung) }}</td>
                                </tr>
                                <tr>
                                    <td>{{ t("inhalte.vorkommen.regeleditor.bedingung", { n: i + 1 }) }}</td>
                                    <td class="re-rechen__leer" :title="t('inhalte.vorkommen.regeleditor.treffer')">
                                        —
                                    </td>
                                    <td class="re-rechen__leer" :title="t('inhalte.vorkommen.regeleditor.treffer')">
                                        —
                                    </td>
                                </tr>
                            </template>
                            <tr class="re-rechen__summe">
                                <td>{{ t("inhalte.vorkommen.regeleditor.ergebnis") }}</td>
                                <td class="re-rechen__leer">—</td>
                                <td class="re-rechen__leer">—</td>
                            </tr>
                        </tbody>
                    </table>
                    <p class="re__treffer" data-testid="inhalte-regel-treffer-unbekannt">
                        <b>{{ t("inhalte.vorkommen.regeleditor.trefferUnbekannt") }}</b>
                    </p>
                    <p class="re-hinweis">
                        {{ t("inhalte.vorkommen.regeleditor.treffer") }}
                        {{ t("inhalte.vorkommen.regeleditor.trefferGrund") }}
                    </p>
                </section>
            </aside>
        </div>
    </div>
</template>

<style scoped>
.re-huelle {
    container: re-huelle / inline-size;
}

.re {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(14em, 1fr);
    gap: var(--space-12);
    align-items: start;
}

.re__links,
.re__rechts {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
}

.re__links {
    container: re-links / inline-size;
}

.re__rechts {
    position: sticky;
    top: 0;
}

@media (max-height: 44em) {
    .re__rechts {
        position: static;
    }
}

@container re-huelle (max-width: 42em) {
    .re {
        grid-template-columns: minmax(0, 1fr);
    }

    .re__rechts {
        position: static;
    }
}

.re-hinweis {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
}

.re-hinweis--warn {
    color: var(--color-warning-soft-text);
}

.re__kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-4) var(--space-12);
}

.re__herkunfthinweis {
    flex: 1 1 14em;
    min-width: 0;
    padding-bottom: var(--space-2);
}

.re__beziehung,
.re__herkunft {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
}

.re__fassung {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
}

.re__fassung-text {
    display: flex;
    flex: 1 1 16em;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

/* Der Satz steht oben und klebt beim Rollen, damit man beim Bauen der Kette liest, was sie sagt. */
.re__satzbox {
    position: sticky;
    top: 0;
    z-index: 3;
    margin: 0 calc(-1 * var(--space-2));
    padding: var(--space-2);
    background: var(--color-panel);
}

/* Eine lange Kette hat einen langen Satz: Er klebt nicht, sonst fräße er das Fenster auf. */
.re__satzbox--lang {
    position: static;
}

@container re-links (max-width: 30em) {
    .re__satzbox {
        position: static;
    }
}

.re__satzhinweis {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    color: var(--color-text);
}

.re__satzlabel {
    color: var(--color-accent-brown);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.re__satz {
    margin: 0;
    color: var(--color-text);
    font-size: var(--font-size-body);
    line-height: var(--leading-normal);
    overflow-wrap: anywhere;
}

.re__op {
    color: var(--color-accent-brown);
    font-size: var(--font-size-caption);
    letter-spacing: 0.04em;
}

.re__kette {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

/* Die Verknüpfung zwischen zwei Bedingungen: eine Wahl auf der Trennlinie. */
.re__verknuepfung {
    display: flex;
    align-items: center;
    gap: var(--space-6);
}

.re__verknuepfung::before,
.re__verknuepfung::after {
    content: "";
    flex: 1 1 auto;
    border-top: 1px solid var(--color-divider);
}

/* Die Wahl sitzt auf der Trennlinie und ist so breit wie ihre Wörter, die Segmente etwas niedriger als ein Bedienelement. */
.re__wahl {
    flex: none;
    grid-auto-columns: auto;
}

.re__wahl :deep(.segmente__segment) {
    height: var(--space-20);
    padding: 0 var(--space-8);
    font-size: var(--font-size-small);
    letter-spacing: 0.04em;
}

.re__ohne {
    margin: calc(-1 * var(--space-2)) 0 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    text-align: center;
}

.re__plus {
    display: flex;
    align-items: center;
    gap: var(--space-6);
}

.re__panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.re__panel-titel {
    margin: 0;
    color: var(--color-accent-brown);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.re-wiki {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
}

.re-wiki dt {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.re-wiki dd {
    margin: 0 0 var(--space-4);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
    overflow-wrap: anywhere;
}

.re-teil--ok {
    text-decoration: underline;
    text-decoration-color: var(--color-success);
    text-decoration-thickness: 2px;
    text-underline-offset: 3px;
}

.re-teil--offen {
    padding: 0 var(--space-2);
    border: 1px solid var(--color-warning-soft-border);
    border-radius: var(--radius-sm);
    background: var(--color-warning-soft);
    color: var(--color-warning-soft-text);
}

.re-teil--fehler {
    padding: 0 var(--space-2);
    border: 1px solid var(--color-danger-soft-border);
    border-radius: var(--radius-sm);
    background: var(--color-danger-soft);
    color: var(--color-danger-soft-text);
}

.re__treffer {
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.re-rechen {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-small);
}

.re-rechen th {
    padding: 0 0 var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    text-align: right;
}

.re-rechen td {
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--color-divider);
}

.re-rechen td:nth-child(n + 2) {
    text-align: right;
}

.re-rechen__leer {
    color: var(--color-text-muted);
}

.re-rechen__op td {
    padding: 0;
    border: 0;
    color: var(--color-accent-brown);
    font-size: var(--font-size-caption);
    letter-spacing: 0.04em;
}

.re-rechen__summe td {
    border-bottom: 0;
    color: var(--color-text-strong);
}
</style>
