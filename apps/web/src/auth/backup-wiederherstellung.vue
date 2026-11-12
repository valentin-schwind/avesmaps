<script setup lang="ts">
import { computed, inject, ref } from "vue";
import {
    WIEDERHERSTELLUNG_GRUND_MAX,
    WIEDERHERSTELLUNG_UMFAENGE,
    type WiederherstellungSicherung,
    type WiederherstellungUmfang,
} from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import { t } from "../i18n/i18n";
import { antragSatz, sicherungWahl, type Sicherung } from "./sicherung";
import { ZEIGE_VORGANG } from "./verwaltung";
import VerwaltungMeldung from "./verwaltung-meldung.vue";

/**
 * „Wiederherstellung beantragen“ unter „Backups“ (WI-0124 KANAL-0001 W10, K5; Blatt WI-0124 Nachtrag F1, F2): die Frage an der Stelle mit
 * welcher Sicherung, welchem Umfang und dem Grund (Pflicht), beantragt mit Passkey; darunter der offene Antrag mit seiner OPS-Nummer. Der
 * Knopf steht neben „Sicherung jetzt“ in `verwaltung-backup.vue`. Aus der App wird nie zurückgespielt.
 */
const props = defineProps<{ sicherung: Sicherung; jetzt: Date }>();
const offen = defineModel<boolean>("offen", { required: true });

/** Die OPS-Nummer öffnet den Vorgang im Kanal, wenn das Fenster ihn trägt (nur Betreiber). */
const zeigeVorgang = inject(ZEIGE_VORGANG, null);

const welche = ref<WiederherstellungSicherung>("letzte");
const umfang = ref<WiederherstellungUmfang>("datenbank");
const grund = ref("");

const wahl = computed(() => sicherungWahl(props.sicherung.stand.value, props.jetzt));
const umfaenge = WIEDERHERSTELLUNG_UMFAENGE.map((wert) => ({ value: wert, label: t(`admin.restore.umfang.${wert}`) }));
const antrag = computed(() => {
    const w = props.sicherung.stand.value?.wiederherstellung ?? null;
    return w === null ? null : { ops: w.ops, ...antragSatz(w, props.jetzt) };
});

async function senden(): Promise<void> {
    if (grund.value.trim() === "") return;
    const ergebnis = await props.sicherung.beantragen({
        sicherung: welche.value,
        umfang: umfang.value,
        grund: grund.value,
    });
    if (ergebnis.ok) {
        grund.value = "";
        offen.value = false;
    }
}
</script>

<template>
    <AvmBestaetigung
        v-if="offen"
        :frage="t('admin.restore.ask')"
        :folge="t('admin.restore.follows')"
        :bestaetigen="t('admin.restore.confirm')"
        :gesperrt="
            props.sicherung.antragBusy.value ? '' : grund.trim() === '' ? t('admin.restore.needsReason') : undefined
        "
        testid="wiederherstellung-frage"
        @bestaetigen="senden()"
        @abbrechen="offen = false"
    >
        <div class="antrag__felder">
            <span class="antrag__name">{{ t("admin.restore.which") }}</span>
            <AvmAuswahl
                v-model="welche"
                :optionen="wahl"
                groesse="zeile"
                :aria-label="t('admin.restore.which')"
                testid="wiederherstellung-sicherung"
            />
            <span class="antrag__name">{{ t("admin.restore.scope") }}</span>
            <AvmSegmente
                v-model="umfang"
                :options="umfaenge"
                :label="t('admin.restore.scope')"
                testid="wiederherstellung-umfang"
            />
            <span class="antrag__name">{{ t("admin.restore.reason") }}</span>
            <AvmTextbereich
                v-model="grund"
                :zeilen="3"
                :maxlength="String(WIEDERHERSTELLUNG_GRUND_MAX)"
                :aria-label="t('admin.restore.reason')"
                testid="wiederherstellung-grund"
            />
        </div>
    </AvmBestaetigung>
    <VerwaltungMeldung
        :ergebnis="props.sicherung.antragErgebnis.value ?? undefined"
        testid="wiederherstellung-meldung"
    />
    <p v-if="antrag !== null" class="antrag__stand" role="status" data-testid="wiederherstellung-stand">
        <AvmPille ton="warnung">{{ t("admin.restore.pill") }}</AvmPille>
        <span>{{ antrag.zeile }}</span>
        <span class="antrag__trenner" aria-hidden="true">·</span>
        <button
            v-if="zeigeVorgang !== null"
            type="button"
            class="antrag__ops"
            :aria-label="t('admin.restore.openCase', { ops: antrag.ops })"
            data-testid="wiederherstellung-ops"
            @click="zeigeVorgang(antrag.ops)"
        >
            {{ antrag.ops }}
        </button>
        <span v-else class="antrag__ops-text">{{ antrag.ops }}</span>
        <span class="antrag__trenner" aria-hidden="true">·</span>
        <span>{{ antrag.stand }}</span>
    </p>
</template>

<style scoped>
.antrag__felder {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--space-6) var(--space-10);
    align-items: center;
    margin-top: var(--space-4);
    font-size: var(--font-size-small);
}

.antrag__name {
    color: var(--color-text-muted);
}

.antrag__stand {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-6);
    margin: var(--space-4) 0 0;
    padding: var(--space-4) var(--space-8);
    border-left: 3px solid var(--color-accent);
    border-radius: var(--radius-sm);
    background: var(--color-panel-soft);
    color: var(--color-text);
    font-size: var(--font-size-small);
}

.antrag__trenner {
    color: var(--color-text-muted);
}

.antrag__ops,
.antrag__ops-text {
    font-variant-numeric: tabular-nums;
}

.antrag__ops {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    font: inherit;
    cursor: pointer;
}

.antrag__ops:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.antrag__ops:focus-visible {
    border-radius: var(--radius-sm);
    outline: none;
    box-shadow: var(--focus-ring);
}
</style>
