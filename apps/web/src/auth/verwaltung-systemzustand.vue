<script setup lang="ts">
/**
 * Der Eintrag „Systemzustand“ der Systemsteuerung (WI-0127 SYS-8, SYS-0001 §6.3; Blatt WI-0119 A7, A9, Z7). Was die Oberfläche rechnet,
 * steht in `systemzustand.ts`; hier steht nur, wie es aussieht.
 *
 * - **Komponenten** als Tafel (Kopfband, Zebra, `FensterTafel`): Name, Aufgabe in Alltagssprache, Zustand mit Statuspunkt, seit wann,
 *   Version. Am Telefon wandern Aufgabe, Seit und Version unter den Namen.
 * - **Auslastung** als Feldzeilen mit je einem Verlauf über 24 h rechts (`AvmVerlauf`), darunter Platte und Laufzeit.
 * - **Datenbank** und **Auf der Platte** nebeneinander, am Telefon untereinander.
 * - 🔴 Fehlt ein Wert, steht „unbekannt“, nie eine Null.
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import AvmStatus from "../controls/avm-status.vue";
import AvmVerlauf from "../controls/avm-verlauf.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import FensterTafel from "../fenster/fenster-tafel.vue";
import { t } from "../i18n/i18n";
import {
    auslastung,
    bytes,
    komponentenZeile,
    schemastandZeile,
    verbindungenText,
    verlauf,
    type Systemzustand,
} from "./systemzustand";
import VerwaltungLadeproblem from "./verwaltung-ladeproblem.vue";

const props = defineProps<{
    systemzustand: Systemzustand;
    telefon: boolean;
}>();

const jetzt = ref(new Date());
let uhr: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
    uhr = setInterval(() => (jetzt.value = new Date()), 15_000);
    props.systemzustand.follow(true);
    void props.systemzustand.load();
});
onUnmounted(() => {
    if (uhr !== undefined) clearInterval(uhr);
    props.systemzustand.follow(false);
});

const stand = computed(() => props.systemzustand.stand.value);
const ansicht = computed(() => {
    const s = stand.value;
    if (s === null) return null;
    const groessen = s.groessen;
    const medien =
        groessen === null || (groessen.medienVeroeffentlicht === null && groessen.medienPrivat === null)
            ? null
            : (groessen.medienVeroeffentlicht ?? 0) + (groessen.medienPrivat ?? 0);
    return {
        zeilen: s.komponenten.map((entry) => komponentenZeile(entry, jetzt.value)),
        datei: s.datei,
        schema: schemastandZeile(s.migrationen),
        last: auslastung(s, jetzt.value),
        verlauf: verlauf(s),
        datenbank: {
            groesse: bytes(s.datenbank.groesse),
            verbindungen: verbindungenText(s),
            tabellen: s.datenbank.tabellen,
        },
        platte: [
            { id: "kacheln" as const, wert: bytes(groessen?.kacheln ?? null), zusatz: null },
            {
                id: "medien" as const,
                wert: bytes(medien),
                zusatz:
                    groessen === null || medien === null
                        ? null
                        : t("admin.health.size.medienDetail", {
                              pub: bytes(groessen.medienVeroeffentlicht),
                              priv: bytes(groessen.medienPrivat),
                          }),
            },
            { id: "sicherungen" as const, wert: bytes(groessen?.sicherungenLokal ?? null), zusatz: null },
        ],
    };
});
</script>

<template>
    <div class="zustand" :class="{ 'zustand--telefon': props.telefon }" data-testid="systemzustand">
        <VerwaltungLadeproblem
            :problems="props.systemzustand.loadProblems.value"
            :fehlt="props.systemzustand.unconfirmed.value"
            testid="systemzustand-ladefehler"
            ><span class="zustand__block">{{ t("admin.health.loadFailed") }}</span></VerwaltungLadeproblem
        >
        <p v-if="ansicht === null && props.systemzustand.loading.value" class="zustand__leise">
            {{ t("admin.loading") }}
        </p>

        <template v-if="ansicht !== null">
            <FensterTafel :beschriftung="t('admin.health.components')" art="text" grund="fenster">
                <table data-testid="systemzustand-komponenten">
                    <thead>
                        <tr>
                            <th scope="col">{{ t("admin.health.col.component") }}</th>
                            <th v-if="!props.telefon" scope="col">{{ t("admin.health.col.task") }}</th>
                            <th scope="col">{{ t("admin.health.col.state") }}</th>
                            <template v-if="!props.telefon">
                                <th scope="col">{{ t("admin.health.col.since") }}</th>
                                <th scope="col">{{ t("admin.health.col.version") }}</th>
                            </template>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="zeile in ansicht.zeilen" :key="zeile.id" :data-testid="`systemzustand-${zeile.id}`">
                            <th scope="row">
                                <span :class="{ 'zustand__ohne-umbruch': !props.telefon }">{{ zeile.name }}</span>
                                <template v-if="props.telefon">
                                    <span class="fenster-tafel__zusatz" data-testid="systemzustand-aufgabe">{{
                                        zeile.aufgabe
                                    }}</span>
                                    <span class="fenster-tafel__zusatz">{{ zeile.seit }} · {{ zeile.version }}</span>
                                </template>
                            </th>
                            <td v-if="!props.telefon">
                                <span class="zustand__aufgabe" data-testid="systemzustand-aufgabe">{{
                                    zeile.aufgabe
                                }}</span>
                            </td>
                            <td><AvmStatus :ton="zeile.ton" :text="zeile.zustand" /></td>
                            <template v-if="!props.telefon">
                                <td>
                                    <span class="zustand__ohne-umbruch">{{ zeile.seit }}</span>
                                </td>
                                <td>
                                    <span class="zustand__ohne-umbruch">{{ zeile.version }}</span>
                                </td>
                            </template>
                        </tr>
                    </tbody>
                </table>
            </FensterTafel>
            <p
                v-if="ansicht.datei.zustand === 'veraltet' || ansicht.datei.zustand === 'unlesbar'"
                class="zustand__warnung"
                data-testid="systemzustand-datei"
            >
                {{ t(`admin.health.file.${ansicht.datei.zustand}`) }}
            </p>
            <p v-else-if="ansicht.datei.neueresFormat" class="zustand__leise">{{ t("admin.health.file.newer") }}</p>

            <!-- Der Schemastand: bei fehlenden Migrationen eine Warnung, sonst leise die eingespielte Nummer. -->
            <p
                v-if="ansicht.schema !== null"
                :class="ansicht.schema.warnung ? 'zustand__warnung' : 'zustand__leise'"
                data-testid="systemzustand-schema"
            >
                {{ ansicht.schema.text }}
            </p>

            <FensterKarte :titel="t('admin.health.card.load')" data-testid="systemzustand-auslastung">
                <dl class="zustand__felder">
                    <dt>{{ t("admin.health.field.cpu") }}</dt>
                    <dd class="zustand__mit-verlauf">
                        <span>
                            <span class="zustand__haupt" data-testid="systemzustand-last">{{
                                ansicht.last.prozessor.haupt
                            }}</span>
                            <span class="zustand__zusatz">{{ ansicht.last.prozessor.zusatz }}</span>
                        </span>
                        <AvmVerlauf
                            :werte="ansicht.verlauf.last"
                            :text="ansicht.verlauf.lastSatz"
                            :spanne="t('admin.health.history.span')"
                            :prozent="ansicht.last.prozessor.prozent"
                            gross
                            testid="systemzustand-verlauf-last"
                        />
                    </dd>
                    <dt>{{ t("admin.health.field.mem") }}</dt>
                    <dd class="zustand__mit-verlauf">
                        <span>
                            <span class="zustand__haupt" data-testid="systemzustand-speicher">{{
                                ansicht.last.speicher.haupt
                            }}</span>
                            <span class="zustand__zusatz">{{ ansicht.last.speicher.zusatz }}</span>
                            <span
                                v-for="zeile in ansicht.last.speicher.prozesse"
                                :key="zeile"
                                class="zustand__zeile zustand__zusatz"
                                data-testid="systemzustand-prozess"
                                >{{ zeile }}</span
                            >
                        </span>
                        <AvmVerlauf
                            :werte="ansicht.verlauf.speicher"
                            :text="ansicht.verlauf.speicherSatz"
                            :spanne="t('admin.health.history.span')"
                            :oben="1"
                            :prozent="ansicht.last.speicher.prozent"
                            art="flaeche"
                            gross
                            testid="systemzustand-verlauf-speicher"
                        />
                    </dd>
                    <dt>{{ t("admin.health.field.disk") }}</dt>
                    <dd data-testid="systemzustand-platten">
                        <span v-if="ansicht.last.platten.length === 0" class="zustand__haupt">{{
                            t("admin.health.unknown")
                        }}</span>
                        <span v-for="platte in ansicht.last.platten" :key="platte.name" class="zustand__zeile">
                            <AvmStatus v-if="platte.ton === 'warnung'" ton="warnung" :text="platte.text" />
                            <span v-else class="zustand__haupt">{{ platte.text }}</span>
                            <span class="zustand__zusatz">{{ platte.name }}</span>
                        </span>
                    </dd>
                    <dt>{{ t("admin.health.field.uptime") }}</dt>
                    <dd class="zustand__haupt">{{ ansicht.last.laufzeit }}</dd>
                </dl>
            </FensterKarte>

            <div class="zustand__paar">
                <FensterKarte :titel="t('admin.health.card.db')" data-testid="systemzustand-datenbank">
                    <dl class="zustand__felder">
                        <dt>{{ t("admin.health.db.size") }}</dt>
                        <dd class="zustand__haupt">{{ ansicht.datenbank.groesse }}</dd>
                        <dt>{{ t("admin.health.db.connectionsLabel") }}</dt>
                        <dd class="zustand__haupt" data-testid="systemzustand-verbindungen">
                            {{ ansicht.datenbank.verbindungen }}
                        </dd>
                    </dl>
                    <FensterTafel
                        v-if="ansicht.datenbank.tabellen.length > 0"
                        :beschriftung="t('admin.health.db.tables')"
                        dicht
                    >
                        <table data-testid="systemzustand-tabellen">
                            <thead>
                                <tr>
                                    <th scope="col">{{ t("admin.health.db.tables") }}</th>
                                    <th scope="col">{{ t("admin.health.db.colSize") }}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="tabelle in ansicht.datenbank.tabellen" :key="tabelle.name">
                                    <th scope="row">{{ tabelle.name }}</th>
                                    <td>{{ bytes(tabelle.bytes) }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </FensterTafel>
                </FensterKarte>
                <FensterKarte :titel="t('admin.health.card.disk')" data-testid="systemzustand-platte">
                    <dl class="zustand__felder">
                        <template v-for="eintrag in ansicht.platte" :key="eintrag.id">
                            <dt>{{ t(`admin.health.size.${eintrag.id}`) }}</dt>
                            <dd>
                                <span class="zustand__haupt">{{ eintrag.wert }}</span>
                                <span v-if="eintrag.zusatz !== null" class="zustand__zusatz">{{ eintrag.zusatz }}</span>
                            </dd>
                        </template>
                    </dl>
                </FensterKarte>
            </div>
        </template>
    </div>
</template>

<style scoped>
.zustand {
    display: flex;
    flex-direction: column;
    gap: var(--divider-gap);
    min-width: 0;
}

.zustand__block,
.zustand__zeile {
    display: block;
}

/* Die Aufgabe erklärt, sie ist kein Messwert: leise wie die Achsen. Nur sie bricht um; Name, Seit und Version bleiben einzeilig. */
.zustand__aufgabe {
    color: var(--color-text-muted);
}

.zustand__ohne-umbruch {
    white-space: nowrap;
}

.zustand__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.zustand__warnung {
    margin: 0;
    color: var(--color-warning-soft-text);
    font-size: var(--font-size-small);
}

/* Feldzeilen wie im Betriebszustand: Beschriftung links leise, Wert rechts; die Zahl hell, der Zusatz gedämpft. */
.zustand__felder {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--space-6) var(--space-12);
    align-items: baseline;
    margin: 0;
    font-size: var(--font-size-small);
}

.zustand__felder > dt {
    color: var(--color-text-muted);
}

.zustand__felder > dd {
    min-width: 0;
    margin: 0;
    color: var(--color-text);
}

.zustand__haupt {
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
    font-variant-numeric: tabular-nums;
}

.zustand__zusatz {
    margin-left: var(--space-6);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.zustand__zeile.zustand__zusatz {
    margin-left: 0;
}

/* Wert links, der Verlauf groß rechts daneben (Betreiber 2026-10-11): er bekommt den größeren Teil der Zeile. */
.zustand__mit-verlauf {
    display: grid;
    grid-template-columns: minmax(12rem, 2fr) minmax(0, 3fr);
    align-items: center;
    gap: var(--space-12);
}

.zustand__paar {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--divider-gap);
    align-items: start;
}

.zustand--telefon .zustand__felder {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
}

.zustand--telefon .zustand__felder > dd + dt {
    margin-top: var(--space-6);
}

.zustand--telefon .zustand__mit-verlauf {
    grid-template-columns: minmax(0, 1fr);
}

.zustand--telefon .zustand__paar {
    grid-template-columns: minmax(0, 1fr);
}
</style>
