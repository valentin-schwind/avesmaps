<script setup lang="ts">
/**
 * Der Eintrag „Inhalte“ der Systemsteuerung (WI-0127 SYS-10, SYS-0001 §6.4; Blatt WI-0119 A2, A5, Z8). Was die Oberfläche rechnet, steht in
 * `inhalte.ts`; hier steht nur, wie es aussieht.
 *
 * - Tafeln je Gruppe (`FensterTafel`): Name mit Unterzeile, „Sichtbar“ als Kästchen, „Was Besucher dann sehen“, „Stand“.
 * - „Notaus nach Rechten“ als eigene Karte mit zwei Listen (Rechtsgrund, Lizenz), je Zeile die Zahl der Bilder, die Besucher gerade sehen.
 * - Umlegen am Kästchen ohne Dialog; der Browser fragt den Passkey. Ohne das Recht ruhen die Kästchen, der Satz steht einmal oben.
 */
import { computed, onMounted, ref } from "vue";
import type { AdminContentSwitchRow } from "@avesmaps3d/shared";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmStatus from "../controls/avm-status.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import FensterTafel from "../fenster/fenster-tafel.vue";
import { formatNumber, t } from "../i18n/i18n";
import { folgeSatz, gruppen, schalterName, schalterUnter, standText, type Inhalte } from "./inhalte";
import { authState } from "./session-state";
import VerwaltungLadeproblem from "./verwaltung-ladeproblem.vue";
import VerwaltungMeldung from "./verwaltung-meldung.vue";

const props = defineProps<{
    inhalte: Inhalte;
    telefon: boolean;
}>();

const darf = authState.value.capabilities.includes("manage_system_settings");
const h = props.inhalte;
const jetzt = ref(new Date());
onMounted(() => {
    jetzt.value = new Date();
    void h.load();
});

const stand = computed(() => h.stand.value);
const ansicht = computed(() => (stand.value === null ? null : gruppen(stand.value)));
/** Gesperrt ohne eigenen Satz (der steht einmal oben), während eine Umschaltung läuft oder solange die Tafel fehlt. */
const gesperrt = computed(() =>
    !darf || h.busy.value !== null || stand.value?.source !== "database" ? "" : undefined,
);
const zahl = (row: AdminContentSwitchRow): string => (row.visible === null ? "–" : formatNumber(row.visible, 0));
const meldung = (rows: readonly AdminContentSwitchRow[]) => {
    const letzte = h.ergebnis.value;
    return letzte !== null && rows.some((row) => row.key === letzte.key) ? letzte.result : undefined;
};
const schalte = (row: AdminContentSwitchRow, checked: boolean): void => {
    void h.schalte(row.key, checked);
};
</script>

<template>
    <div class="inhalte" :class="{ 'inhalte--telefon': props.telefon }" data-testid="inhalte">
        <VerwaltungLadeproblem :problems="h.loadProblems.value" :fehlt="h.unconfirmed.value" testid="inhalte-ladefehler"
            ><span class="inhalte__block">{{ t("admin.content.loadFailed") }}</span></VerwaltungLadeproblem
        >
        <p v-if="stand === null && h.loading.value" class="inhalte__leise">{{ t("admin.loading") }}</p>
        <template v-if="stand !== null && ansicht !== null">
            <p v-if="stand.source !== 'database'" class="inhalte__warnung" data-testid="inhalte-quelle">
                {{ t(`admin.content.source.${stand.source}`) }}
            </p>
            <p v-if="stand.pending === true" class="inhalte__warnung" data-testid="inhalte-unterwegs">
                {{ t("admin.content.pending") }}
            </p>
            <p v-if="!darf" class="inhalte__leise" data-testid="inhalte-nur-lesen">
                {{ t("admin.content.readOnly", { recht: t("auth.capability.manage_system_settings") }) }}
            </p>

            <!-- Bilder nach Art -->
            <FensterTafel :beschriftung="t('admin.content.group.media_role')" art="text" grund="fenster">
                <table data-testid="inhalte-art">
                    <thead>
                        <tr>
                            <th scope="col">{{ t("admin.content.group.media_role") }}</th>
                            <th scope="col">{{ t("admin.content.col.visible") }}</th>
                            <th v-if="!props.telefon" scope="col">{{ t("admin.content.col.visitor") }}</th>
                            <th scope="col">{{ t("admin.content.col.state") }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in ansicht.art" :key="row.key" :data-testid="`inhalte-${row.key}`">
                            <th scope="row">
                                {{ schalterName(row.key) }}
                                <span v-if="schalterUnter(row.key)" class="fenster-tafel__zusatz">{{
                                    schalterUnter(row.key)
                                }}</span>
                            </th>
                            <td>
                                <AvmKaestchen
                                    art="checkbox"
                                    :checked="row.enabled"
                                    :gesperrt="gesperrt"
                                    :hinweis="schalterName(row.key)"
                                    :testid="`inhalte-kaestchen-${row.key}`"
                                    @change="schalte(row, $event)"
                                />
                            </td>
                            <td v-if="!props.telefon">{{ folgeSatz(row.key) }}</td>
                            <td>
                                <AvmStatus v-if="!row.enabled" ton="warnung" :text="standText(row, jetzt) ?? ''" />
                            </td>
                        </tr>
                    </tbody>
                </table>
            </FensterTafel>
            <VerwaltungMeldung :ergebnis="meldung(ansicht.art)" testid="inhalte-meldung-art" />

            <!-- Notaus nach Rechten -->
            <FensterKarte :titel="t('admin.content.group.media_rights')" data-testid="inhalte-rechte">
                <template #etikett>
                    <span class="inhalte__etikett">{{ t("admin.content.rightsNote") }}</span>
                </template>
                <div class="inhalte__listen">
                    <div v-for="liste in ['rechte', 'lizenzen'] as const" :key="liste" class="inhalte__liste">
                        <p class="inhalte__kopf">
                            <span>{{ t(`admin.content.list.${liste}`) }}</span>
                            <span>{{ t("admin.content.col.visibleCount") }}</span>
                        </p>
                        <ul :data-testid="`inhalte-liste-${liste}`">
                            <li v-for="row in ansicht[liste]" :key="row.key" :data-testid="`inhalte-${row.key}`">
                                <AvmKaestchen
                                    art="checkbox"
                                    :checked="row.enabled"
                                    :gesperrt="gesperrt"
                                    :testid="`inhalte-kaestchen-${row.key}`"
                                    @change="schalte(row, $event)"
                                    >{{ schalterName(row.key) }}</AvmKaestchen
                                >
                                <span
                                    class="inhalte__zahl"
                                    :title="row.visible === null ? t('admin.content.countLater') : undefined"
                                    >{{ zahl(row) }}</span
                                >
                                <span v-if="!row.enabled" class="inhalte__stand">{{ standText(row, jetzt) }}</span>
                            </li>
                        </ul>
                    </div>
                </div>
                <VerwaltungMeldung
                    :ergebnis="meldung([...ansicht.rechte, ...ansicht.lizenzen])"
                    testid="inhalte-meldung-rechte"
                />
            </FensterKarte>

            <!-- Infopanel -->
            <FensterTafel :beschriftung="t('admin.content.group.panel')" art="text" grund="fenster">
                <table data-testid="inhalte-panel">
                    <thead>
                        <tr>
                            <th scope="col">{{ t("admin.content.group.panel") }}</th>
                            <th scope="col">{{ t("admin.content.col.visible") }}</th>
                            <th v-if="!props.telefon" scope="col">{{ t("admin.content.col.visitor") }}</th>
                            <th scope="col">{{ t("admin.content.col.state") }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in ansicht.panel" :key="row.key" :data-testid="`inhalte-${row.key}`">
                            <th scope="row">
                                {{ schalterName(row.key) }}
                                <span v-if="schalterUnter(row.key)" class="fenster-tafel__zusatz">{{
                                    schalterUnter(row.key)
                                }}</span>
                            </th>
                            <td>
                                <AvmKaestchen
                                    art="checkbox"
                                    :checked="row.enabled"
                                    :gesperrt="gesperrt"
                                    :hinweis="schalterName(row.key)"
                                    :testid="`inhalte-kaestchen-${row.key}`"
                                    @change="schalte(row, $event)"
                                />
                            </td>
                            <td v-if="!props.telefon">{{ folgeSatz(row.key) }}</td>
                            <td>
                                <AvmStatus v-if="!row.enabled" ton="warnung" :text="standText(row, jetzt) ?? ''" />
                            </td>
                        </tr>
                        <tr v-if="ansicht.vorkommen.length > 0" data-testid="inhalte-vorkommen">
                            <th scope="row">
                                {{ t("admin.content.name.lore") }}
                                <span class="fenster-tafel__zusatz">{{ t("admin.content.sub.lore") }}</span>
                            </th>
                            <td />
                            <td :colspan="props.telefon ? 2 : 2">
                                <span v-if="!props.telefon" class="inhalte__zeile">{{
                                    t("admin.content.visitor.lore")
                                }}</span>
                                <span class="inhalte__arten">
                                    <AvmKaestchen
                                        v-for="row in ansicht.vorkommen"
                                        :key="row.key"
                                        art="checkbox"
                                        :checked="row.enabled"
                                        :gesperrt="gesperrt"
                                        :testid="`inhalte-kaestchen-${row.key}`"
                                        @change="schalte(row, $event)"
                                        >{{ schalterName(row.key) }}</AvmKaestchen
                                    >
                                </span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </FensterTafel>
            <VerwaltungMeldung
                :ergebnis="meldung([...ansicht.panel, ...ansicht.vorkommen])"
                testid="inhalte-meldung-panel"
            />

            <!-- Karte -->
            <FensterTafel
                v-if="ansicht.karte.length > 0"
                :beschriftung="t('admin.content.group.map')"
                art="text"
                grund="fenster"
            >
                <table data-testid="inhalte-karte">
                    <thead>
                        <tr>
                            <th scope="col">{{ t("admin.content.group.map") }}</th>
                            <th scope="col">{{ t("admin.content.col.visible") }}</th>
                            <th v-if="!props.telefon" scope="col">{{ t("admin.content.col.visitor") }}</th>
                            <th scope="col">{{ t("admin.content.col.state") }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in ansicht.karte" :key="row.key" :data-testid="`inhalte-${row.key}`">
                            <th scope="row">{{ schalterName(row.key) }}</th>
                            <td>
                                <AvmKaestchen
                                    art="checkbox"
                                    :checked="row.enabled"
                                    :gesperrt="gesperrt"
                                    :hinweis="schalterName(row.key)"
                                    :testid="`inhalte-kaestchen-${row.key}`"
                                    @change="schalte(row, $event)"
                                />
                            </td>
                            <td v-if="!props.telefon">{{ folgeSatz(row.key) }}</td>
                            <td>
                                <AvmStatus v-if="!row.enabled" ton="warnung" :text="standText(row, jetzt) ?? ''" />
                            </td>
                        </tr>
                    </tbody>
                </table>
            </FensterTafel>
            <VerwaltungMeldung :ergebnis="meldung(ansicht.karte)" testid="inhalte-meldung-karte" />

            <!-- Betrieb (WI-0138 V7, WI-0272 S2): die Besucherzählung und die Annahme neuer Reisebilder. Die Zahlen selbst stehen im Editorpanel, hier nur die Schalter. -->
            <FensterTafel
                v-if="ansicht.betrieb.length > 0"
                :beschriftung="t('admin.content.group.betrieb')"
                art="text"
                grund="fenster"
            >
                <table data-testid="inhalte-betrieb">
                    <thead>
                        <tr>
                            <th scope="col">{{ t("admin.content.group.betrieb") }}</th>
                            <th scope="col">{{ t("admin.content.col.on") }}</th>
                            <th v-if="!props.telefon" scope="col">{{ t("admin.content.col.visitor") }}</th>
                            <th scope="col">{{ t("admin.content.col.state") }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in ansicht.betrieb" :key="row.key" :data-testid="`inhalte-${row.key}`">
                            <th scope="row">{{ schalterName(row.key) }}</th>
                            <td>
                                <AvmKaestchen
                                    art="checkbox"
                                    :checked="row.enabled"
                                    :gesperrt="gesperrt"
                                    :hinweis="schalterName(row.key)"
                                    :testid="`inhalte-kaestchen-${row.key}`"
                                    @change="schalte(row, $event)"
                                />
                            </td>
                            <td v-if="!props.telefon">{{ folgeSatz(row.key) }}</td>
                            <td>
                                <AvmStatus v-if="!row.enabled" ton="warnung" :text="standText(row, jetzt) ?? ''" />
                            </td>
                        </tr>
                    </tbody>
                </table>
                <p class="inhalte__hinweis">{{ t("admin.content.betriebVerweis") }}</p>
            </FensterTafel>
            <VerwaltungMeldung :ergebnis="meldung(ansicht.betrieb)" testid="inhalte-meldung-betrieb" />

            <p class="inhalte__hinweis">{{ t("admin.content.note") }}</p>
        </template>
    </div>
</template>

<style scoped>
.inhalte {
    display: flex;
    flex-direction: column;
    gap: var(--divider-gap);
    min-width: 0;
}

.inhalte__block,
.inhalte__zeile {
    display: block;
}

.inhalte__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.inhalte__warnung {
    margin: 0;
    color: var(--color-warning-soft-text);
    font-size: var(--font-size-small);
}

.inhalte__etikett {
    margin-left: auto;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.inhalte__listen {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-12) var(--space-16, 16px);
}

.inhalte--telefon .inhalte__listen {
    grid-template-columns: minmax(0, 1fr);
}

.inhalte__kopf {
    display: flex;
    justify-content: space-between;
    margin: 0 0 var(--space-2);
    padding: 0 var(--space-6);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.inhalte__liste ul {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
}

.inhalte__liste li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0 var(--space-12);
    align-items: center;
    padding: var(--space-4) var(--space-6);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-small);
}

.inhalte__liste li:nth-child(odd) {
    background: var(--color-panel);
}

.inhalte__zahl {
    color: var(--color-text-strong);
    font-variant-numeric: tabular-nums;
    text-align: right;
}

.inhalte__stand {
    grid-column: 1 / -1;
    padding-left: calc(14px + var(--space-4));
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.inhalte__arten {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-12);
    margin-top: var(--space-2);
}

.inhalte__hinweis {
    margin: 0;
    padding: var(--space-8) var(--space-12);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}
</style>
