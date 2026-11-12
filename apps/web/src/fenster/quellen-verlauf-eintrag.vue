<script setup lang="ts">
import { computed } from "vue";
import type { MapHistoryEntry } from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import { t } from "../i18n/i18n";
import { quellenZeilen, type Kennungen, type QuellenZeile } from "./quellen-verlauf-modell";
import type { QuellenVerlauf } from "./quellen-verlauf-steuerung";
import { zeilenText } from "./quellen-verlauf-texte";

/**
 * Die Änderungen an den Quellen EINES Eintrags im Verlauf (WI-0254 §12), mit ↺: Eine Operation kann mehrere Verknüpfungen ändern; jede steht als Zeile da (bei nur einer nennt sie schon die Überschrift des Eintrags,
 * `kopfText`), und ↺ nimmt jede einzeln zurück (`quellen-verlauf-steuerung.ts`). Der Knopf ist frei, solange die Verknüpfung so dasteht wie nach der Änderung, sonst gesperrt mit einem Satz; wo man die Quellen des
 * Objekts nicht ändern darf, gibt es keinen. Eine Abweisung steht als Satz an der Zeile.
 */
const props = defineProps<{
    eintrag: MapHistoryEntry;
    /** Die öffentliche Kennung des Objekts, dessen Verlauf gezeigt wird (beim Weg die Kennungen aller Abschnitte der Straße). */
    traegerId: Kennungen;
    verlauf: QuellenVerlauf;
    kennung: string;
}>();

const zeilen = computed(() => quellenZeilen(props.eintrag, props.traegerId));
/** Der Satz, warum ↺ an der Zeile gerade nicht geht; `undefined`, wo es geht. */
const sperrSatz = (zeile: QuellenZeile): string | undefined => {
    const plan = props.verlauf.plan(zeile);
    return plan?.art === "gesperrt" ? plan.satz : undefined;
};
</script>

<template>
    <div v-if="zeilen.length > 0" class="qv" :data-testid="`${kennung}-verlauf-quellen`">
        <div
            v-for="zeile in zeilen"
            :key="zeile.schluessel"
            class="qv__zeile"
            :data-testid="`${kennung}-verlauf-quelle`"
        >
            <p v-if="zeilen.length > 1" class="qv__text">{{ zeilenText(zeile) }}</p>
            <div v-if="verlauf.plan(zeile) !== undefined" class="qv__knoepfe">
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="sperrSatz(zeile)"
                    :testid="`${kennung}-verlauf-quelle-zurueck`"
                    @click="void verlauf.zuruecknehmen(zeile)"
                >
                    {{ t("verlauf.zurueck") }}
                </AvmKnopf>
            </div>
            <p
                v-if="verlauf.meldung.value?.schluessel === zeile.schluessel"
                class="qv__meldung"
                role="alert"
                :data-testid="`${kennung}-verlauf-quelle-meldung`"
            >
                {{ verlauf.meldung.value.satz }}
            </p>
        </div>
    </div>
</template>

<style scoped>
.qv {
    display: grid;
    gap: var(--space-4);
}

.qv__zeile {
    display: grid;
    gap: var(--space-4);
}

.qv__text {
    margin: 0;
}

.qv__knoepfe {
    display: flex;
    gap: var(--space-8);
}

.qv__meldung {
    margin: 0;
    color: var(--color-danger);
}
</style>
