<script setup lang="ts">
/**
 * Eine Bedingung einer Regel in Worten (WI-0253 §24, Mockup „Die Regel liest sich …“): „Wald oder Urwald innerhalb von Aranien“, „Steppe, überall“, „die Fläche Aranien selbst“,
 * dazu die Lage zu einer Linie (WI-0254: „Wald innerhalb von Aventurien südlich von Festum“, „der Teil von Aventurien nördlich der Linie Havena–Perricum“, ohne Art und Fläche „alles südlich von
 * Festum“; bei einer Lage entfällt das „überall“) und das Klima. Die Wörter stehen fett, die Verbindung in der Sprache der Seite. Eine Fläche, die es noch nicht gibt (F4, Vali 2026-10-27), trägt „!“ und „wartet“; der Name im Wiki
 * steht dabei, und eine Fläche gleichen Namens ohne Wiki-Schlüssel wird genannt, nie angenommen. Gibt es genau eine solche Fläche, steht daneben der Knopf, der ihr den Artikel zuweist (§25); die Rückfrage
 * und das Senden gehören dem Fenster (Ereignis `zuweisen`).
 *
 * 🪤 Ein Leerzeichen am Anfang oder Ende eines `<template>` entfernt der Vue-Compiler („SteppeoderWüsteinnerhalb“); die Verbindungswörter stehen darum samt Leerzeichen in einem Ausdruck.
 */
import { computed } from "vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import { t } from "../i18n/i18n";
import type { WikisyncRegelBedingung, WikisyncRegelOffeneFlaeche } from "@avesmaps3d/shared";
import { bedingungTeile, grundName, lageTeile, offeneFlaecheFuer } from "./wikisync-regeln-text";

const props = defineProps<{
    bedingung: WikisyncRegelBedingung;
    /** Die offenen Flächen mit Kandidat, wie der Server sie kennt (aus dem Fenster); ohne sie gibt es keinen Knopf. */
    flaechen?: readonly WikisyncRegelOffeneFlaeche[] | undefined;
    /** Warum der Knopf gerade nicht geht (fehlendes Recht, andere Handlung unterwegs); `undefined`: er geht. */
    zuweisenSperre?: string | undefined;
}>();
const emit = defineEmits<{ zuweisen: [eintrag: WikisyncRegelOffeneFlaeche] }>();
const teile = computed(() => bedingungTeile(props.bedingung));
/** Die Lage in Stücken: Die Namen der Orte stehen fett, die Wörter dazwischen sind die der Sprache. */
const lageStuecke = computed(() => (props.bedingung.lage === undefined ? [] : lageTeile(props.bedingung.lage)));
/** Was vor der Lage steht: ohne Art und Fläche „alles“, sonst nur der Abstand zum Satzteil davor. */
const lageDavor = computed(() =>
    teile.value.form === "lage" || teile.value.form === "klima" ? `${t("admin.wikisync.regeln.alles")} ` : " ",
);
const offeneFlaeche = computed(() => offeneFlaecheFuer(props.bedingung, props.flaechen ?? []));
</script>

<template>
    <span class="wsync-bed">
        <template v-if="teile.form === 'flaeche_arten' || teile.form === 'ueberall_arten'">
            <template v-for="(art, i) in teile.arten" :key="art + String(i)"
                ><template v-if="i > 0">{{ ` ${t("admin.wikisync.regeln.oder")} ` }}</template
                ><b>{{ art }}</b></template
            ><template v-if="teile.form === 'ueberall_arten'"
                ><template v-if="teile.lage === null">, {{ t("admin.wikisync.regeln.ueberall") }}</template></template
            >
            <template v-else>
                {{ ` ${t("admin.wikisync.regeln.innerhalb")} ` }}<b>{{ teile.flaeche!.name }}</b></template
            >
        </template>
        <template v-else-if="teile.form === 'flaeche'">
            <template v-if="teile.lage !== null"
                >{{ t("admin.wikisync.regeln.derTeil") }} <b>{{ teile.flaeche!.name }}</b></template
            >
            <template v-else>
                {{ t("admin.wikisync.regeln.dieFlaeche") }} <b>{{ teile.flaeche!.name }}</b>
                {{ t("admin.wikisync.regeln.selbst") }}
            </template>
        </template>
        <template v-if="teile.lage !== null"
            >{{ lageDavor
            }}<template v-for="(teil, i) in lageStuecke" :key="i"
                ><b v-if="teil.ort">{{ teil.text }}</b
                ><template v-else>{{ teil.text }}</template></template
            ></template
        >
        <template v-if="teile.klima !== null"
            >{{ teile.form === "klima" && teile.lage === null ? "" : " " }}{{ t("admin.wikisync.regeln.imKlima") }}
            <b>{{ teile.klima.von }}</b> {{ t("admin.wikisync.regeln.bis") }} <b>{{ teile.klima.bis }}</b></template
        >
        <template v-if="teile.form === 'leer'">{{ t("admin.wikisync.regeln.ohneAngabe") }}</template>
        <AvmPille v-if="teile.flaeche?.offen === true" ton="warnung" testid="wsync-bed-wartet"
            ><span aria-hidden="true">! </span>{{ t("admin.wikisync.regeln.wartet") }}</AvmPille
        >
        <span v-if="teile.flaeche?.offen === true" class="wsync-bed__leise">
            {{
                t(
                    teile.flaeche.kandidat === null
                        ? "admin.wikisync.regeln.flaecheFehlt"
                        : "admin.wikisync.regeln.flaecheKandidat",
                    {
                        name: teile.flaeche.titel ?? teile.flaeche.name,
                        kandidat: teile.flaeche.kandidat ?? "",
                    },
                )
            }}
        </span>
        <AvmKnopf
            v-if="offeneFlaeche?.zustand === 'zuweisbar'"
            class="wsync-bed__zuweisen"
            groesse="zeile"
            :gesperrt="zuweisenSperre"
            testid="wsync-bed-zuweisen"
            @click="emit('zuweisen', offeneFlaeche)"
            >{{ t("admin.wikisync.regeln.flaechen.zuweisen", { name: offeneFlaeche.name }) }}</AvmKnopf
        >
        <span
            v-else-if="offeneFlaeche?.zustand === 'zugewiesen'"
            class="wsync-bed__leise"
            data-testid="wsync-bed-zugewiesen"
        >
            {{ t("admin.wikisync.regeln.flaechen.istZugewiesen", { name: offeneFlaeche.name }) }}
        </span>
        <span
            v-else-if="offeneFlaeche?.zustand === 'mehrdeutig'"
            class="wsync-bed__leise"
            data-testid="wsync-bed-mehrdeutig"
        >
            {{ t("admin.wikisync.regeln.flaechen.mehrdeutig") }}
        </span>
        <AvmPille v-for="frage in bedingung.rueckfragen" :key="frage" ton="warnung">{{ grundName(frage) }}</AvmPille>
    </span>
</template>

<style scoped>
.wsync-bed {
    display: inline;
    line-height: var(--leading-normal);
}

.wsync-bed b {
    color: var(--color-text-strong);
    font-weight: var(--font-weight-regular);
}

.wsync-bed :deep(.pille) {
    margin-inline: var(--space-2);
    vertical-align: middle;
}

.wsync-bed__leise {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wsync-bed__zuweisen {
    margin-inline: var(--space-4);
    vertical-align: middle;
}
</style>
