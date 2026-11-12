<script setup lang="ts">
/**
 * Der Eintrag „Backups“ der Systemsteuerung (WI-0127 SYS-9, SYS-0001 §6.5, §9e). Was die Oberfläche rechnet, steht in `sicherung.ts`;
 * hier steht nur, wie es aussieht.
 *
 * - Oben der Hinweis, dass eine Sicherung ein Geheimnis ist (der Text des früheren Platzhalters, nachgezogen).
 * - **Karte „Sicherung“** mit dem Zustand rechts (`AvmStatus`); ohne Statusdatei eine gestrichelte Fläche „nicht eingerichtet“, kein
 *   Fehler. Darunter die Felder als Feldzeilen wie im Betriebszustand, und „⊕ Sicherung jetzt“ (Backend-Knopf mit abstraktem Zeichen)
 *   mit der Zeile, was gerade geschieht.
 * - **Die Teile** der letzten Sicherung in Legacys Listenform: Name mit Kreis (● außer Haus geprüft, ◐ nur hier), darunter Größe,
 *   gekürzte Prüfsumme und die Prüfung außer Haus; unten die Legende.
 * - **Wiederherstellung beantragen** (WI-0124 K5) neben „Sicherung jetzt“, nur mit `request_restore`; Frage und offener Antrag stehen in
 *   `backup-wiederherstellung.vue`.
 * - **Telefon:** Feldzeilen untereinander, der Knopf nimmt die ganze Breite.
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmStatus from "../controls/avm-status.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import FensterPlatzhalter from "../fenster/fenster-platzhalter.vue";
import { locale, t } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import { groesse } from "../medien/medien-text";
import {
    anstossSatz,
    felder,
    fehlerSatz,
    sperrSatz,
    teilName,
    zustandName,
    zustandTon,
    type Sicherung,
} from "./sicherung";
import { authState } from "./session-state";
import BackupWiederherstellung from "./backup-wiederherstellung.vue";
import VerwaltungLadeproblem from "./verwaltung-ladeproblem.vue";
import VerwaltungMeldung from "./verwaltung-meldung.vue";

const props = defineProps<{
    sicherung: Sicherung;
    telefon: boolean;
}>();

const darf = authState.value.capabilities.includes("run_backup");
const darfAntrag = authState.value.capabilities.includes("request_restore");
const antragOffen = ref(false);

/** Die Uhr für „vor … min“ und „noch nicht abgeholt“; tickt nur, solange der Eintrag zu sehen ist. */
const jetzt = ref(new Date());
let uhr: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
    uhr = setInterval(() => (jetzt.value = new Date()), 15_000);
    props.sicherung.follow(true);
    void props.sicherung.load();
});
onUnmounted(() => {
    if (uhr !== undefined) clearInterval(uhr);
    props.sicherung.follow(false);
});

const stand = computed(() => props.sicherung.stand.value);
const ansicht = computed(() => {
    const s = stand.value;
    if (s === null) return null;
    return {
        zustand: s.zustand,
        name: zustandName(s.zustand),
        ton: zustandTon(s.zustand),
        felder: felder(s, jetzt.value),
        fehler: fehlerSatz(s, jetzt.value),
        satz: anstossSatz(s, props.sicherung.eigene.value, jetzt.value),
        // Liegt ein Auftrag oder läuft eine Sicherung, sagt die Zeile neben dem Knopf schon, warum er ruht: kein zweiter Satz.
        sperre:
            darf && s.anstossen.moeglich && (s.anstossen.wartend !== null || s.zustand === "laeuft")
                ? ""
                : sperrSatz(s, darf),
        /** Die Statusdatei ist da, aber unlesbar: ein Satz statt leerer Felder. */
        unlesbar: s.zustand === "unbekannt" && s.stand === null && s.letzterLauf === null,
        teile: s.teile.map((teil) => ({
            teil,
            name: teilName(teil.kind),
            kreis: teil.offsiteVerifiedAt !== null ? ("voll" as const) : ("halb" as const),
            unter: [
                teil.bytes === null ? t("admin.backup.unknown") : groesse(teil.bytes),
                teil.sha256,
                teil.offsiteVerifiedAt === null
                    ? t("admin.backup.partLocal")
                    : t("admin.backup.partOffsite", {
                          time: relativeTime(new Date(teil.offsiteVerifiedAt), jetzt.value, locale.value, "zeitpunkt"),
                      }),
            ]
                .filter((teil): teil is string => teil !== null && teil !== "")
                .join(" · "),
        })),
        neueresFormat: s.neueresFormat,
    };
});
</script>

<template>
    <div class="sicherung" :class="{ 'sicherung--telefon': props.telefon }" data-testid="sicherung">
        <AvmHinweis testid="sicherung-geheim">
            <strong class="sicherung__erst">{{ t("admin.backup.secretFirst") }}</strong>
            {{ t("admin.backup.secret") }}
        </AvmHinweis>
        <VerwaltungLadeproblem
            :problems="props.sicherung.loadProblems.value"
            :fehlt="props.sicherung.unconfirmed.value"
            testid="sicherung-ladefehler"
            @bestaetigen="props.sicherung.confirmAgain()"
            ><span class="sicherung__block">{{ t("admin.backup.loadFailed") }}</span></VerwaltungLadeproblem
        >
        <p v-if="ansicht === null && props.sicherung.loading.value" class="sicherung__leise">
            {{ t("admin.loading") }}
        </p>

        <FensterKarte v-if="ansicht !== null" :titel="t('admin.backup.card')">
            <template #etikett>
                <AvmStatus
                    class="sicherung__zustand"
                    :ton="ansicht.ton"
                    :text="ansicht.name"
                    testid="sicherung-zustand"
                />
            </template>
            <FensterPlatzhalter v-if="ansicht.zustand === 'nicht_eingerichtet'">{{
                t("admin.backup.notSetUp")
            }}</FensterPlatzhalter>
            <p v-else-if="ansicht.unlesbar" class="sicherung__leise" data-testid="sicherung-unlesbar">
                {{ t("admin.backup.unreadable") }}
            </p>
            <template v-else>
                <p v-if="ansicht.fehler !== null" class="sicherung__fehler" data-testid="sicherung-fehler">
                    {{ ansicht.fehler }}
                </p>
                <dl class="sicherung__felder" data-testid="sicherung-felder">
                    <template v-for="feld in ansicht.felder" :key="feld.id">
                        <dt>{{ feld.name }}</dt>
                        <dd :data-testid="`sicherung-${feld.id}`">{{ feld.wert }}</dd>
                    </template>
                </dl>
                <p v-if="ansicht.neueresFormat" class="sicherung__leise" data-testid="sicherung-neuer">
                    {{ t("admin.backup.newerFormat") }}
                </p>
            </template>
            <div class="sicherung__anstoss">
                <AvmKnopf
                    art="weich"
                    groesse="zeile"
                    :gesperrt="props.sicherung.busy.value ? '' : ansicht.sperre"
                    :breit="props.telefon"
                    testid="sicherung-jetzt"
                    @click="props.sicherung.start()"
                    ><span aria-hidden="true">⊕ </span>{{ t("admin.backup.start") }}</AvmKnopf
                >
                <AvmKnopf
                    v-if="darfAntrag"
                    art="weich"
                    groesse="zeile"
                    :gesperrt="antragOffen ? '' : undefined"
                    :breit="props.telefon"
                    testid="wiederherstellung-beantragen"
                    @click="antragOffen = true"
                    ><span aria-hidden="true">↶ </span>{{ t("admin.restore.open") }}</AvmKnopf
                >
                <span
                    v-if="ansicht.satz !== null"
                    class="sicherung__satz"
                    :class="`sicherung__satz--${ansicht.satz.ton}`"
                    role="status"
                    data-testid="sicherung-satz"
                    >{{ ansicht.satz.text }}</span
                >
            </div>
            <VerwaltungMeldung :ergebnis="props.sicherung.ergebnis.value ?? undefined" testid="sicherung-meldung" />
            <BackupWiederherstellung
                v-if="darfAntrag"
                v-model:offen="antragOffen"
                :sicherung="props.sicherung"
                :jetzt="jetzt"
            />
        </FensterKarte>

        <template v-if="ansicht !== null && ansicht.teile.length > 0">
            <ul class="sicherung__teile" :aria-label="t('admin.backup.parts')" data-testid="sicherung-teile">
                <li
                    v-for="{ teil, name, kreis, unter } in ansicht.teile"
                    :key="teil.kind"
                    class="sicherung__teil"
                    :data-testid="`sicherung-teil-${teil.kind}`"
                >
                    <span class="sicherung__name">
                        <span>{{ name }}</span>
                        <AvmKreis :fuellung="kreis" :name="t(`admin.backup.circle.${kreis}`)" />
                    </span>
                    <span class="sicherung__unter">{{ unter }}</span>
                </li>
            </ul>
            <p class="sicherung__legende" data-testid="sicherung-legende">
                <span class="sicherung__legende-teil">
                    <AvmKreis fuellung="halb" :name="t('admin.backup.circle.halb')" />{{
                        t("admin.backup.circle.halb")
                    }}
                </span>
                <span class="sicherung__legende-teil">
                    <AvmKreis fuellung="voll" :name="t('admin.backup.circle.voll')" />{{
                        t("admin.backup.circle.voll")
                    }}
                </span>
            </p>
        </template>
    </div>
</template>

<style scoped>
.sicherung {
    display: flex;
    flex-direction: column;
    gap: var(--divider-gap);
    min-width: 0;
}

.sicherung__erst {
    color: var(--color-text-strong);
    font-weight: 400;
}

.sicherung__block {
    display: block;
}

.sicherung__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.sicherung__zustand {
    margin-left: auto;
}

.sicherung__fehler {
    margin: 0;
    color: var(--color-danger-soft-text);
    font-size: var(--font-size-small);
}

/* Feldzeilen wie im Betriebszustand: Beschriftung links leise, Wert rechts. */
.sicherung__felder {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--space-4) var(--space-12);
    margin: 0;
    font-size: var(--font-size-small);
}

.sicherung__felder > dt {
    color: var(--color-text-muted);
}

.sicherung__felder > dd {
    min-width: 0;
    margin: 0;
    color: var(--color-text);
}

.sicherung--telefon .sicherung__felder {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
}

.sicherung--telefon .sicherung__felder > dd + dt {
    margin-top: var(--space-6);
}

.sicherung__anstoss {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-6) var(--space-10);
    margin-top: var(--space-4);
}

.sicherung__satz {
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.sicherung__satz--gut {
    color: var(--color-success-soft-text);
}

.sicherung__satz--warnung {
    color: var(--color-warning-soft-text);
}

/* Legacys Liste: Name mit Kreis, darunter die Unterzeile; eine Haarlinie zwischen den Zeilen. */
.sicherung__teile {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    list-style: none;
}

.sicherung__teil {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-8) var(--space-10);
}

.sicherung__teil + .sicherung__teil {
    border-top: 1px solid var(--color-divider);
}

.sicherung__name {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.sicherung__unter {
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    overflow-wrap: anywhere;
}

.sicherung__legende {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-12);
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.sicherung__legende-teil {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
}
</style>
