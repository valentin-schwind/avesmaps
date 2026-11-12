<script setup lang="ts">
import { computed, ref } from "vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { formatNumber, t } from "../i18n/i18n";
import InhalteRegelEditorFenster from "./inhalte-regel-editor-fenster.vue";
import InhalteRegelKarte from "./inhalte-regel-karte.vue";
import {
    aktiveRegeln,
    offeneVorschlaege,
    regelSatz,
    wikiFassungZumHerstellen,
    wikiJetzt,
    type EntwurfRegel,
    type OffenerVorschlag,
} from "./inhalte-vorkommen-regeln-modell";
import type { VorkommenSteuerung } from "./inhalte-vorkommen-steuerung";

/**
 * Der Abschnitt „Regelvorkommen“ in der Spalte „Verbreitung und Herkunft“ (WI-0254 `--weiter`, Regeleditor; Entwurf `c-fenster.js`, `regelnAbschnitt`): die Regeln des Eintrags als Karten,
 * dazu die Vorschläge des Wikis, die noch niemand übernommen hat, und der Weg in den Editor.
 *
 * - 🔴 **Alles wirkt im Entwurf und erst mit „Speichern“ des Fensters** (↶ und ↷, Verwerfen und der Konflikt 409 gelten wie bei den Ortszeilen). Ändern heißt dabei: Die Regel wird eine Regel von
 *   Hand, die alte wird beim Speichern still gelegt; die Wiki-Fassung bleibt wiederherstellbar.
 * - **Die Vorschläge des Wikis** stehen gestrichelt unter den Regeln, wenn der WikiSync sie nicht vorgewählt hat (sonst übernimmt sie das Fenster der Regelvorschläge): „Übernehmen“ legt die Regel
 *   in den Entwurf, „Bearbeiten“ öffnet sie erst im Editor. Der Vorschlag schreibt nichts und ändert nie den Eintrag selbst (R6: Nur die Regel gehört dann der Redaktion).
 * - **Der Server lehnt eine Regel ab, die es in der Beziehung schon gibt** (400 `regel_besteht`, z. B. wenn jemand sie zwischen Laden und Speichern angelegt hat und der Fingerabdruck
 *   gleich ist): Der Satz steht hier, gespeichert wurde nichts, der Entwurf bleibt. Andere Ablehnungen (`validation_failed`) zeigt die Spalte der Stammdaten mit dem Satz des Servers.
 * - Nur Regeln, die gelten, stehen hier; die stillen (unterdrückt, gelöst) liegen beim Server.
 * - Eine Regel trifft hier noch nichts: Die Regelauswertung gibt es nicht (WI-0253), auf den Karten steht, dass Treffer erst mit ihr kommen.
 * - **„Als Text“** (WI-0254 §13): holt die GESPEICHERTEN Regeln des Eintrags als Block der Schreibweise in die Ansicht „Regeln als Text“ (`alsText`; das Fenster hängt ihn an den Text). Er steht jedem offen, der das Fenster sieht;
 *   ohne Regeln ist er gesperrt. Ungespeicherte Regeln des Entwurfs zeigt er nicht.
 */
const props = defineProps<{
    steuerung: VorkommenSteuerung;
    darfSchreiben: boolean;
    /** Der Satz, warum nichts änderbar ist; still (`""`), der Grund steht einmal in der Spalte Stammdaten. */
    gesperrt: string | undefined;
}>();

const emit = defineEmits<{ alsText: [] }>();

const s = props.steuerung;
const eintrag = computed(() => s.eintrag.value);
const alle = computed<readonly EntwurfRegel[]>(() => s.stand.value?.regeln ?? []);
const regeln = computed(() => aktiveRegeln(alle.value));
const vorschlaege = computed<OffenerVorschlag[]>(() => offeneVorschlaege(eintrag.value?.wikiVorschlag, alle.value));
/** Der Server lehnt eine Regel ab, deren Fingerabdruck in der Beziehung schon gilt (400 `regel_besteht`); gespeichert wurde dann nichts, der Entwurf bleibt. */
const besteht = computed(() => {
    const z = s.zustand.value;
    return z.art === "abgelehnt" && z.code === "regel_besteht";
});
const darfNeu = computed(() => props.darfSchreiben && props.gesperrt === undefined);

/** Die Regel mit dem, was ihre Karte über die Wiki-Fassung weiß, die einer Regel von Hand zugrunde liegt. */
const karten = computed(() => {
    const vorschlag = eintrag.value?.wikiVorschlag;
    return regeln.value.map((regel) => {
        const basis = regel.ursprung === "manual" ? regel.wikiBasis?.bedingungen : undefined;
        const jetzt = wikiJetzt(regel, vorschlag);
        return {
            regel,
            basis: basis === undefined ? undefined : regelSatz(basis),
            seither: jetzt?.geaendert === true ? regelSatz(jetzt.bedingungen) : undefined,
            herstellbar: wikiFassungZumHerstellen(regel, vorschlag) !== undefined,
        };
    });
});

// --- Der Editor ---
interface Offen {
    schluessel: string | undefined;
    vorschlag: OffenerVorschlag | undefined;
}
const editor = ref<Offen | undefined>();
const offen = computed({
    get: () => editor.value !== undefined,
    set: (wert: boolean) => {
        if (!wert) editor.value = undefined;
    },
});
const oeffneNeu = (): void => {
    editor.value = { schluessel: undefined, vorschlag: undefined };
};
const oeffneRegel = (regel: EntwurfRegel): void => {
    editor.value = { schluessel: regel.schluessel, vorschlag: undefined };
};
const oeffneVorschlag = (vorschlag: OffenerVorschlag): void => {
    editor.value = { schluessel: undefined, vorschlag };
};
</script>

<template>
    <section class="regeln" data-testid="inhalte-regeln">
        <div class="regeln__kopf">
            <h4 class="regeln__titel avm-versalmitte">
                {{ t("inhalte.vorkommen.regeln.titel") }} ({{ formatNumber(regeln.length, 0) }})
            </h4>
            <span class="regeln__aktionen">
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="regeln.length > 0 ? undefined : ''"
                    :title="
                        regeln.length > 0
                            ? t('inhalte.vorkommen.text.alsTextTitel')
                            : t('inhalte.vorkommen.text.alsTextKeine')
                    "
                    testid="inhalte-regel-als-text"
                    @click="emit('alsText')"
                    >{{ t("inhalte.vorkommen.text.alsText") }}</AvmKnopf
                >
                <AvmKnopf
                    v-if="darfSchreiben"
                    groesse="zeile"
                    :gesperrt="darfNeu ? undefined : ''"
                    testid="inhalte-regel-neu"
                    @click="oeffneNeu"
                    >{{ t("inhalte.vorkommen.regeleditor.neueRegel") }}</AvmKnopf
                >
            </span>
        </div>

        <AvmHinweis v-if="besteht" ton="gefahr" rolle="alert" testid="inhalte-regel-besteht">{{
            t("inhalte.vorkommen.regeleditor.besteht")
        }}</AvmHinweis>

        <ul
            v-if="regeln.length > 0 || vorschlaege.length > 0"
            class="regeln__karten"
            data-testid="inhalte-regeln-liste"
        >
            <InhalteRegelKarte
                v-for="k in karten"
                :key="k.regel.schluessel"
                :regel="k.regel"
                :basis-satz="k.basis"
                :seither-satz="k.seither"
                :kann-herstellen="k.herstellbar"
                :darf-schreiben="darfSchreiben"
                :gesperrt="gesperrt"
                @oeffne="oeffneRegel(k.regel)"
                @bearbeiten="oeffneRegel(k.regel)"
                @stelle-her="s.stelleRegelWikiHer(k.regel.schluessel)"
            />
            <InhalteRegelKarte
                v-for="v in vorschlaege"
                :key="`vorschlag:${String(v.index)}`"
                :vorschlag="v"
                :darf-schreiben="darfSchreiben"
                :gesperrt="gesperrt"
                @uebernehmen="s.uebernimmVorschlag(v.index)"
                @bearbeiten="oeffneVorschlag(v)"
            />
        </ul>
        <p v-else class="regeln__leise" data-testid="inhalte-regeln-keine">
            {{ t("inhalte.vorkommen.regeln.keine") }}
        </p>

        <InhalteRegelEditorFenster
            v-if="editor !== undefined && eintrag !== undefined"
            v-model:offen="offen"
            :steuerung="steuerung"
            :eintrag="eintrag"
            :schluessel="editor.schluessel"
            :vorschlag="editor.vorschlag"
            :regeln="alle"
        />
    </section>
</template>

<style scoped>
.regeln {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding-top: var(--space-8);
    border-top: 1px solid var(--color-divider);
}

.regeln__kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4) var(--space-6);
}

.regeln__aktionen {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

.regeln__titel {
    margin: 0;
    color: var(--color-accent-brown);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    hyphens: none;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
    white-space: nowrap;
}

.regeln__karten {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    margin: 0;
    padding: 0;
    list-style: none;
}

.regeln__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}
</style>
