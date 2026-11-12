<script setup lang="ts">
import { computed, onMounted } from "vue";
import { DISCORD_INHALT_MAX } from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmStatus from "../controls/avm-status.vue";
import { label } from "../auth/verwaltung-text";
import { authState } from "../auth/session-state";
import FensterFeldzeilen from "../fenster/fenster-feldzeilen.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import { t } from "../i18n/i18n";
import DiscordEinstellungen from "./discord-einstellungen.vue";
import DiscordZustellungZeile from "./discord-zustellung.vue";
import { betriebsTon, laufTeile, type DiscordVerwaltung } from "./discord";

/**
 * Der Reiter „Discord“ unter Systemsteuerung › Neuigkeiten (WI-0255; Betreiberauftrag 2026-10-25: „Betriebsstatus; Zeitplan/letzter Erfolg;
 * aktive Kanäle; Aktivierung/Deaktivierung der täglichen Routine; Vorschau bzw. kontrollierter Testentwurf; Sendearchiv mit Inhalt, Status und
 * Discord-Message-ID; Fehlerdiagnose; kontrolliertes Wiederholen fehlgeschlagener Sends“).
 *
 * - Vier Karten wie die übrigen Verwaltungsreiter: **Betrieb** (Feldzeilen, Routine mit einem Knopf), **Einstellungen** (Prompt, Uhrzeit und Berichtskanal,
 *   `discord-einstellungen.vue`), **Vorschau** (rechnet auf Knopfdruck, sendet nie), **Sendearchiv** (je Zustellung der Kreis, Kopf, Fehler und der
 *   Inhalt in der Klappbox).
 * - 🔴 Kein Schlüssel im Reiter: Der Server sagt nur „hinterlegt“ oder „fehlt“.
 * - Es gibt nur den Berichtskanal (Vali 2026-10-26). Steht die Umgebung noch auf dem abgeschafften Modus `testkanal`, sagt ein Satz, dass er wie `aus` wirkt.
 * - Knöpfe nur mit `manage_news`; der Server prüft trotzdem jede Anfrage und verlangt den Passkey.
 */
const props = defineProps<{ discord: DiscordVerwaltung }>();

const darf = authState.value.capabilities.includes("manage_news");
const stand = computed(() => props.discord.stand.value);
const vorschau = computed(() => props.discord.vorschau.value);
const beschaeftigt = computed(() => props.discord.busy.value !== null);

onMounted(() => {
    void props.discord.laden();
});

const zeit = (iso: string): string =>
    new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const betriebText = computed(() => {
    const s = stand.value;
    if (s === null) return "";
    if (s.sperre !== null) return t("admin.discord.betrieb.sendetNicht");
    return t("admin.discord.betrieb.sendet");
});

const routineSeit = computed(() => {
    const routine = stand.value?.routine;
    if (routine === undefined || routine.geaendertAt === null) return null;
    return routine.geaendertVon === null
        ? t("admin.discord.routine.seitOhne", { zeit: zeit(routine.geaendertAt) })
        : t("admin.discord.routine.seit", { zeit: zeit(routine.geaendertAt), name: routine.geaendertVon });
});

const lauf = computed(() => {
    const letzter = stand.value?.letzterLauf ?? null;
    if (letzter === null) return t("admin.discord.lauf.nie");
    const { art, detail } = laufTeile(letzter.ergebnis);
    const satz = label("admin.discord.lauf", art);
    return t("admin.discord.lauf.zeile", {
        zeit: zeit(letzter.at),
        ergebnis: detail === null ? satz : `${satz} (${detail})`,
    });
});

const vorschauSatz = computed(() => {
    const v = vorschau.value;
    if (v === null) return null;
    return v.pruefung.ok
        ? t("admin.discord.vorschau.gruen", { zeichen: v.zeichen, max: DISCORD_INHALT_MAX })
        : t("admin.discord.vorschau.rot", { fehler: v.pruefung.fehler.join(", ") });
});
</script>

<template>
    <div class="discord" data-testid="discord-verwaltung">
        <p v-if="props.discord.fehler.value" class="satz satz--fehler" role="alert">{{ t("admin.discord.failed") }}</p>

        <FensterKarte v-if="stand" :titel="t('admin.discord.title')">
            <p class="satz">
                {{ t("admin.discord.lead", { uhrzeit: stand.zeitplan.uhrzeit, zone: stand.zeitplan.zone }) }}
            </p>
            <AvmHinweis
                v-if="stand.sperre !== null"
                :ton="stand.sperre === 'ohne_schluessel' || stand.sperre === 'ohne_kanal' ? 'warnung' : 'neutral'"
                testid="discord-sperre"
                >{{ t(`admin.discord.sperre.${stand.sperre}`) }}</AvmHinweis
            >
            <AvmHinweis v-if="stand.modusVeraltet" ton="warnung" testid="discord-modus-veraltet">{{
                t("admin.discord.modusVeraltet")
            }}</AvmHinweis>
            <FensterFeldzeilen testid="discord-betrieb">
                <dt>{{ t("admin.discord.field.betrieb") }}</dt>
                <dd><AvmStatus :ton="betriebsTon(stand)" :text="betriebText" testid="discord-betrieb-status" /></dd>
                <dt>{{ t("admin.discord.field.routine") }}</dt>
                <dd class="routine">
                    <AvmStatus
                        :ton="stand.routine.aktiv ? 'erfolg' : 'ruhe'"
                        :text="t(stand.routine.aktiv ? 'admin.discord.routine.an' : 'admin.discord.routine.aus')"
                        testid="discord-routine-status"
                    />
                    <span v-if="routineSeit" class="leise">{{ routineSeit }}</span>
                    <AvmKnopf
                        v-if="darf"
                        groesse="zeile"
                        :art="stand.routine.aktiv ? 'weich' : 'gefuellt'"
                        :gesperrt="beschaeftigt ? '' : undefined"
                        testid="discord-routine-schalten"
                        @click="props.discord.setzeRoutine(!stand.routine.aktiv)"
                        >{{
                            t(
                                stand.routine.aktiv
                                    ? "admin.discord.routine.ausschalten"
                                    : "admin.discord.routine.einschalten",
                            )
                        }}</AvmKnopf
                    >
                </dd>
                <dt>{{ t("admin.discord.field.zeitplan") }}</dt>
                <dd>
                    {{
                        t("admin.discord.zeitplan", {
                            uhrzeit: stand.zeitplan.uhrzeit,
                            zone: stand.zeitplan.zone,
                            von: stand.zeitplan.fensterVon,
                            bis: stand.zeitplan.fensterBis,
                        })
                    }}
                </dd>
                <dt>{{ t("admin.discord.field.kanal") }}</dt>
                <dd data-testid="discord-kanal">
                    {{
                        stand.kanal === null
                            ? t("admin.discord.kanal.keiner")
                            : t("admin.discord.kanal.bericht", { id: stand.kanal })
                    }}
                </dd>
                <dt>{{ t("admin.discord.field.schluessel") }}</dt>
                <dd>{{ t(stand.schluessel ? "admin.discord.schluessel.da" : "admin.discord.schluessel.fehlt") }}</dd>
                <dt>{{ t("admin.discord.field.lauf") }}</dt>
                <dd data-testid="discord-lauf">{{ lauf }}</dd>
                <dt>{{ t("admin.discord.field.erfolg") }}</dt>
                <dd>
                    {{
                        stand.letzterErfolg === null
                            ? t("admin.discord.erfolg.keiner")
                            : t("admin.discord.erfolg.zeile", {
                                  tag: stand.letzterErfolg.tag,
                                  id: stand.letzterErfolg.messageId,
                              })
                    }}
                </dd>
            </FensterFeldzeilen>
            <template v-if="props.discord.problemWer.value !== 'einstellungen'">
                <p
                    v-for="problem in props.discord.problems.value"
                    :key="problem.key"
                    class="satz satz--fehler"
                    role="alert"
                >
                    {{ t(problem.key, problem.params) }}
                </p>
            </template>
        </FensterKarte>

        <FensterKarte v-if="stand" :titel="t('admin.discord.einstellungen.title')">
            <DiscordEinstellungen :discord="props.discord" :stand="stand" :darf="darf" />
        </FensterKarte>

        <FensterKarte v-if="stand" :titel="t('admin.discord.vorschau.title')">
            <div class="leiste">
                <p class="satz">{{ t("admin.discord.vorschau.lead") }}</p>
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="beschaeftigt ? '' : undefined"
                    testid="discord-vorschau"
                    @click="props.discord.rechneVorschau()"
                    >{{ t("admin.discord.vorschau.rechnen") }}</AvmKnopf
                >
            </div>
            <p v-if="props.discord.vorschauFehler.value" class="satz satz--fehler" role="alert">
                {{ t("admin.discord.vorschau.failed") }}
            </p>
            <template v-else-if="vorschau">
                <AvmHinweis
                    :ton="vorschau.pruefung.ok ? 'neutral' : 'gefahr'"
                    :rolle="vorschau.pruefung.ok ? 'status' : 'alert'"
                    testid="discord-vorschau-pruefung"
                    >{{ vorschauSatz }}</AvmHinweis
                >
                <pre class="text" data-testid="discord-vorschau-text">{{ vorschau.text }}</pre>
            </template>
        </FensterKarte>

        <FensterKarte v-if="stand" :titel="t('admin.discord.archiv.title')">
            <p v-if="stand.archiv.length === 0" class="satz" data-testid="discord-archiv-leer">
                {{ t("admin.discord.archiv.leer") }}
            </p>
            <ul v-else class="liste" data-testid="discord-archiv">
                <DiscordZustellungZeile
                    v-for="zustellung in stand.archiv"
                    :key="zustellung.id"
                    :zustellung="zustellung"
                    :darf="darf"
                    :gesperrt="beschaeftigt"
                    @wiederholen="props.discord.wiederhole(zustellung.id)"
                />
            </ul>
            <p class="satz leise">{{ t("admin.discord.fuss") }}</p>
        </FensterKarte>
    </div>
</template>

<style scoped>
.discord {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
}

.satz {
    margin: 0;
    color: var(--color-text-muted);
}

.satz--fehler {
    color: var(--color-danger-soft-text);
}

.leise {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.routine {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
}

.leiste {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-6) var(--space-10);
}

.leiste .satz {
    flex: 1 1 auto;
    min-width: 0;
}

/* Der Text, wie er hinausgeht: Zeilenumbrüche bleiben, Markdown bleibt sichtbar (Discord macht daraus Fett und Liste). */
.text {
    margin: 0;
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    color: var(--color-text);
    font-family: inherit;
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    margin: 0;
    padding: 0;
    list-style: none;
}
</style>
