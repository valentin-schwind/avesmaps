<script setup lang="ts">
/**
 * Die Tafel der Namensräume (Mockup, Abschnitt „Namensräume“; Vali 2026-10-25: zwei Spalten Kanon und Kartenobjekte einsammeln, Bezeichner frei,
 * „eine tafel je umgebung“). Je Raum eine Zeile mit der echten Pille daneben (`info-canon-pill.vue`), die sich beim Tippen ändert.
 *
 * - **Jede Änderung speichert sofort** (Vali 2026-10-27: „warum muss man speichern, warum speichert der klick nicht?“): Kanon und Einsammeln beim Wechsel, der Bezeichner beim
 *   Verlassen des Felds oder mit Enter (Escape stellt den gespeicherten Wert her), ↺ die Vorgabe, ✕ nimmt einen hinzugefügten Raum heraus. Passkey (`manage_canon_tables`, ab Admin)
 *   fragt das gemeinsame Fenster nur, wenn die Bestätigung nicht mehr frisch ist. Gespeichert wird in `wikisync-sofort.ts`; hier steht, wie die Zeile aussieht und was der Satz danach sagt.
 * - **Ehrlich zur Folge:** Das Speichern rechnet die Etiketten nicht neu (Map Mutation Guard); der Satz danach nennt die Zahl der Objekte, die ihr Etikett wechseln, und sagt, dass es
 *   erst beim Neuberechnen folgt.
 * - **Hinzufügen:** Die neue Zeile wird gespeichert, sobald sie gilt (Nummer und Präfix); bis dahin steht sie als „unvollständig“ mit dem Grund da.
 * - Am Hauptraum sind Kanon und Einsammeln festgelegt, der Bezeichner nicht (Mockup). Das Präfix eines Raums der Vorgabe ist der Name im Wiki und bleibt.
 */
import { computed, nextTick, ref, useId, useTemplateRef, watch } from "vue";
import type { WikiKanon, WikisyncDumpNamensraum } from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmSperrgrund from "../controls/avm-sperrgrund.vue";
import InfoCanonPill from "../info-panel/info-canon-pill.vue";
import { formatList, t } from "../i18n/i18n";
import VerwaltungMeldung from "../auth/verwaltung-meldung.vue";
import type { Wikisync } from "./wikisync";
import WikisyncInfo from "./wikisync-info.vue";
import { nsSofort } from "./wikisync-tafeln-sofort";
import { anzahl, umgebungKurz, zahl } from "./wikisync-text";
import {
    bez,
    bezZuLang,
    nsAufVorgabe,
    nsAusServer,
    nsVorgabe,
    nsWeichtAb,
    pille,
    praefixWort,
    type NsZeile,
} from "./wikisync-tafeln";

const props = defineProps<{
    wikisync: Wikisync;
    umgebung: string;
    /** Warum die Tafel hier nicht änderbar ist; `undefined`, wenn sie es ist. */
    sperre: string | undefined;
    /** Die Seiten je Namensraum aus dem Einlesen des Dumps; leer, solange keins vorliegt. */
    dumpRaeume: readonly WikisyncDumpNamensraum[];
}>();
const emit = defineEmits<{ dumpBericht: [] }>();

const grundId = useId();
const gespeichert = computed((): NsZeile[] => nsAusServer(props.wikisync.tafeln.value?.namensraeume ?? []));
const sofort = nsSofort(props.wikisync, () => props.umgebung);
const tafel = sofort.zeilen;

/** Der Kasten mit Satz und Ablehnung unter der Tafel. Eine Ablehnung steht nie außer Sicht (eine lange Tafel am Telefon): Sie rollt herein, wenn sie sonst verborgen bliebe. */
const stand = useTemplateRef<HTMLElement>("stand");
watch(sofort.fehler, (fehler) => {
    if (fehler !== undefined) void nextTick(() => stand.value?.scrollIntoView({ block: "nearest" }));
});

const KANON_OPTIONEN = computed(() =>
    (["offiziell", "inoffiziell"] as const).map((wert) => ({ wert, text: t(`admin.wikisync.ns.kanon.${wert}`) })),
);
const JA_NEIN = computed(() => [
    { wert: "ja", text: t("admin.wikisync.ja") },
    { wert: "nein", text: t("admin.wikisync.nein") },
]);

const seitenImDump = (ns: number): string => {
    if (props.dumpRaeume.length === 0) return "—";
    return zahl(props.dumpRaeume.find((raum) => raum.nr === ns)?.seiten ?? 0);
};

/** Räume im Dump ohne Zeile in der gespeicherten Tafel: ein Befund zum Dump. */
const unbekannt = computed(() =>
    props.dumpRaeume.filter((raum) => !gespeichert.value.some((zeile) => zeile.ns === raum.nr)),
);

const praefixText = (zeile: NsZeile): string =>
    zeile.praefix === "" ? t("admin.wikisync.ns.hauptraum") : `${zeile.praefix}:`;

function marke(zeile: NsZeile): { text: string; ton: "warnung" | "neutral"; titel?: string } | null {
    if (sofort.speichert(zeile.ns)) return { text: t("admin.wikisync.marke.speichert"), ton: "neutral" };
    if (nsWeichtAb(zeile))
        return { text: t("admin.wikisync.marke.eigen"), ton: "neutral", titel: vorgabeText(zeile.ns) };
    if (nsVorgabe(zeile.ns) === undefined) return { text: t("admin.wikisync.marke.hinzugefuegt"), ton: "neutral" };
    return null;
}

function vorgabeText(ns: number): string {
    const vorgabe = nsVorgabe(ns);
    if (vorgabe === undefined) return "";
    return t("admin.wikisync.ns.vorgabe", {
        kanon: t(`admin.wikisync.ns.kanon.${vorgabe.kanon}`),
        bezeichner: vorgabe.bezeichner === "" ? t("admin.wikisync.ohneBezeichner") : `„${vorgabe.bezeichner}“`,
        einsammeln: t(vorgabe.einsammeln ? "admin.wikisync.ja" : "admin.wikisync.nein"),
    });
}

/** ↺: die Zeile geht auf die Vorgabe und wird gleich gespeichert. */
const zurueckAufVorgabe = (zeile: NsZeile): void => sofort.ersetze(zeile.ns, nsAufVorgabe(zeile));

const fest = (zeile: NsZeile): string | undefined => (zeile.ns === 0 ? "" : undefined);
const sperreZelle = computed(() => (props.sperre === undefined ? undefined : ""));
const zeilenGrundId = (ns: number): string => `${grundId}-${ns}`;

/** Enter speichert den Text; Escape stellt den gespeicherten her und gilt nur dann dem Feld (sonst schließt es wie überall das Fenster). */
function taste(event: KeyboardEvent, ns: number): void {
    if (event.isComposing) return;
    if (event.key === "Enter") sofort.fertig(ns);
    else if (event.key === "Escape" && sofort.zurueck(ns)) {
        event.preventDefault();
        event.stopPropagation();
    }
}

// ── Namensraum hinzufügen ────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Formular {
    nr: string;
    praefix: string;
    kanon: WikiKanon;
    bezeichner: string;
    einsammeln: boolean;
    /** Die Zeile ist unterwegs: Die Felder stehen still, bis der Server geantwortet hat. */
    speichert: boolean;
}
const form = ref<Formular | null>(null);
const nrFeld = useTemplateRef<InstanceType<typeof AvmEingabe>>("nrFeld");
/** Das Formular öffnet mit dem Fokus in der Nummer (er rollt es auch ins Bild, sonst bliebe es am Telefon unter der langen Tafel verborgen). */
function formOeffnen(): void {
    form.value = { nr: "", praefix: "", kanon: "inoffiziell", bezeichner: "", einsammeln: false, speichert: false };
    void nextTick(() => nrFeld.value?.focus());
}
/** Warum die neue Zeile noch nicht gespeichert wird; `undefined`, wenn sie gilt. */
const formGrund = computed((): string | undefined => {
    const f = form.value;
    if (f === null) return undefined;
    if (!/^\d+$/u.test(f.nr.trim())) return t("admin.wikisync.ns.form.nrFehlt");
    const nr = Number(f.nr.trim());
    if (tafel.value.some((zeile) => zeile.ns === nr)) return t("admin.wikisync.ns.form.nrDa", { nr });
    if (nr !== 0 && praefixWort(f.praefix) === "") return t("admin.wikisync.ns.form.praefixFehlt");
    if (
        tafel.value.some(
            (zeile) => zeile.praefix.toLowerCase() === praefixWort(f.praefix).toLowerCase() && zeile.praefix !== "",
        )
    )
        return t("admin.wikisync.ns.form.praefixDa");
    if (bezZuLang(f.bezeichner)) return t("admin.wikisync.tafel.fehler.bezeichner_zu_lang", { zeile: nr });
    return undefined;
});

/**
 * Nach jedem Verlassen eines Felds und jeder Auswahl: Gilt die neue Zeile, geht sie gleich an den Server. Gelingt es, schließt das Formular; sonst bleibt es mit seinen
 * Werten offen, und die Ablehnung steht an der Tafel.
 */
async function formFertig(): Promise<void> {
    const f = form.value;
    if (f === null || f.speichert || formGrund.value !== undefined) return;
    f.speichert = true;
    const ns = Number(f.nr.trim());
    const ergebnis = await sofort.fuegeHinzu(ns, {
        ns,
        praefix: praefixWort(f.praefix),
        kanon: f.kanon,
        einsammeln: f.einsammeln,
        bezeichner: bez(f.bezeichner),
        objekte: null,
    });
    if (ergebnis.ok) form.value = null;
    else f.speichert = false;
}

function formTaste(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.isComposing) void formFertig();
}
</script>

<template>
    <div class="wsync-ns" data-testid="wsync-ns">
        <p class="wsync-ns__satz">
            {{ t("admin.wikisync.ns.jeUmgebung", { umgebung: umgebungKurz(umgebung) })
            }}<WikisyncInfo :text="t('admin.wikisync.ns.jeUmgebungInfo')" />
        </p>
        <p class="wsync-ns__satz">
            <strong>{{ t("admin.wikisync.ns.kopf.kanon") }}:</strong> {{ t("admin.wikisync.ns.kanonSatz")
            }}<WikisyncInfo :text="t('admin.wikisync.ns.kanonInfo')" />
        </p>
        <p class="wsync-ns__satz">
            <strong>{{ t("admin.wikisync.ns.kopf.bezeichner") }}:</strong> {{ t("admin.wikisync.ns.bezeichnerSatz")
            }}<WikisyncInfo :text="t('admin.wikisync.ns.bezeichnerInfo')" />
        </p>
        <p class="wsync-ns__satz">
            <strong>{{ t("admin.wikisync.ns.kopf.einsammeln") }}:</strong> {{ t("admin.wikisync.ns.einsammelnSatz")
            }}<WikisyncInfo :text="t('admin.wikisync.ns.einsammelnInfo')" />
        </p>
        <!-- Ohne „Speichern“ gibt es keinen Augenblick vor dem Speichern, an dem diese Warnung stehen könnte: Auf Production steht sie dauernd da. -->
        <AvmHinweis v-if="umgebung === 'production'" ton="warnung" testid="wsync-ns-production">{{
            t("admin.wikisync.wirkung.production")
        }}</AvmHinweis>
        <AvmHinweis v-if="unbekannt.length > 0" ton="warnung" testid="wsync-ns-unbekannt">
            {{
                t("admin.wikisync.ns.unbekannt", {
                    raeume: formatList(
                        unbekannt.map((raum) =>
                            t("admin.wikisync.ns.unbekanntRaum", {
                                nr: raum.nr,
                                name: raum.name ?? "?",
                                seiten: anzahl.seiten(raum.seiten),
                            }),
                        ),
                    ),
                })
            }}
            <button type="button" class="wsync-ns__link" @click="emit('dumpBericht')">
                {{ t("admin.wikisync.ns.imBericht") }}
            </button>
        </AvmHinweis>
        <AvmSperrgrund v-if="sperre !== undefined" :id="grundId" :text="sperre" />

        <div class="wsync-ns__tafel" role="table" :aria-label="t('admin.wikisync.ns.titel')">
            <div class="wsync-ns__raster wsync-ns__kopf" role="row">
                <span role="columnheader">{{ t("admin.wikisync.ns.kopf.nr") }}</span>
                <span role="columnheader">{{ t("admin.wikisync.ns.kopf.praefix") }}</span>
                <span role="columnheader">{{ t("admin.wikisync.ns.kopf.kanon") }}</span>
                <span role="columnheader">{{ t("admin.wikisync.ns.kopf.einsammeln") }}</span>
                <span role="columnheader">{{ t("admin.wikisync.ns.kopf.bezeichner") }}</span>
                <span role="columnheader">{{ t("admin.wikisync.ns.kopf.vorschau") }}</span>
                <span role="columnheader" class="wsync-ns__zahl" :title="t('admin.wikisync.ns.objekteTitel')">{{
                    t("admin.wikisync.ns.kopf.objekte")
                }}</span>
                <span role="columnheader" class="wsync-ns__zahl">{{ t("admin.wikisync.ns.kopf.seiten") }}</span>
                <span role="columnheader"></span>
            </div>
            <div
                v-for="zeile in tafel"
                :key="zeile.ns"
                class="wsync-ns__raster wsync-ns__zeile"
                :class="{ 'is-speichert': sofort.speichert(zeile.ns) }"
                role="row"
                :data-ns="zeile.ns"
            >
                <span role="cell" class="wsync-ns__nr z-nr">{{ zeile.ns }}</span>
                <span role="cell" class="z-pf" :class="{ 'wsync-ns__leise': zeile.praefix === '' }">{{
                    praefixText(zeile)
                }}</span>
                <span role="cell" class="wsync-ns__wahl z-wahl" :data-l="t('admin.wikisync.ns.kopf.kanon')">
                    <AvmAuswahl
                        :model-value="zeile.kanon"
                        :optionen="KANON_OPTIONEN"
                        groesse="zeile"
                        :gesperrt="sperreZelle ?? fest(zeile)"
                        :title="sperre ?? (zeile.ns === 0 ? t('admin.wikisync.ns.festKanon') : undefined)"
                        :aria-label="t('admin.wikisync.ns.kanonVon', { nr: zeile.ns })"
                        :aria-describedby="sperre === undefined ? undefined : grundId"
                        :testid="`wsync-ns-${zeile.ns}-kanon`"
                        @update:model-value="(wert: string) => sofort.aendere(zeile.ns, { kanon: wert as WikiKanon })"
                    />
                    <AvmPille v-if="marke(zeile) !== null" :ton="marke(zeile)!.ton" :title="marke(zeile)!.titel">{{
                        marke(zeile)!.text
                    }}</AvmPille>
                </span>
                <span role="cell" class="wsync-ns__wahl z-sam" :data-l="t('admin.wikisync.ns.kopf.einsammeln')">
                    <AvmAuswahl
                        :model-value="zeile.einsammeln ? 'ja' : 'nein'"
                        :optionen="JA_NEIN"
                        groesse="zeile"
                        :gesperrt="sperreZelle ?? fest(zeile)"
                        :title="sperre ?? (zeile.ns === 0 ? t('admin.wikisync.ns.festEinsammeln') : undefined)"
                        :aria-label="t('admin.wikisync.ns.einsammelnVon', { nr: zeile.ns })"
                        :aria-describedby="sperre === undefined ? undefined : grundId"
                        :testid="`wsync-ns-${zeile.ns}-einsammeln`"
                        @update:model-value="(wert: string) => sofort.aendere(zeile.ns, { einsammeln: wert === 'ja' })"
                    />
                </span>
                <span role="cell" class="z-bez" :data-l="t('admin.wikisync.ns.kopf.bezeichner')">
                    <AvmEingabe
                        :model-value="sofort.text(zeile.ns, zeile)"
                        :gesperrt="sperre"
                        :grund-bei="sperre === undefined ? undefined : grundId"
                        :ungueltig="sofort.textGrund(zeile.ns) !== undefined"
                        :placeholder="t('admin.wikisync.ohneBezeichner')"
                        :aria-label="t('admin.wikisync.ns.bezeichnerVon', { nr: zeile.ns })"
                        :aria-describedby="
                            sofort.textGrund(zeile.ns) === undefined ? undefined : zeilenGrundId(zeile.ns)
                        "
                        maxlength="80"
                        autocomplete="off"
                        :testid="`wsync-ns-${zeile.ns}-bezeichner`"
                        @update:model-value="(wert: string) => sofort.tippe(zeile.ns, wert)"
                        @blur="sofort.fertig(zeile.ns)"
                        @keydown="(event: KeyboardEvent) => taste(event, zeile.ns)"
                    />
                </span>
                <span role="cell" class="wsync-ns__pille z-et" :data-l="t('admin.wikisync.ns.kopf.vorschau')">
                    <InfoCanonPill :pill="pille(zeile.kanon, sofort.text(zeile.ns, zeile))" />
                </span>
                <span
                    role="cell"
                    class="wsync-ns__zahl z-ob"
                    :data-l="t('admin.wikisync.ns.kopf.objekte')"
                    :title="t('admin.wikisync.ns.objekteTitel')"
                    >{{ zeile.objekte === null ? "—" : zahl(zeile.objekte) }}</span
                >
                <span role="cell" class="wsync-ns__zahl z-sp" :data-l="t('admin.wikisync.ns.kopf.seiten')">{{
                    seitenImDump(zeile.ns)
                }}</span>
                <span role="cell" class="wsync-ns__aktion z-akt">
                    <AvmKnopf
                        v-if="sperre === undefined && nsWeichtAb(zeile)"
                        groesse="zeile"
                        :aria-label="
                            t('admin.wikisync.ns.aufVorgabe', { nr: zeile.ns, vorgabe: vorgabeText(zeile.ns) })
                        "
                        :title="t('admin.wikisync.ns.aufVorgabe', { nr: zeile.ns, vorgabe: vorgabeText(zeile.ns) })"
                        :testid="`wsync-ns-${zeile.ns}-vorgabe`"
                        @click="zurueckAufVorgabe(zeile)"
                        ><span aria-hidden="true">↺</span></AvmKnopf
                    >
                    <AvmKnopf
                        v-if="sperre === undefined && nsVorgabe(zeile.ns) === undefined"
                        groesse="zeile"
                        :aria-label="t('admin.wikisync.ns.entfernen', { nr: zeile.ns })"
                        :title="t('admin.wikisync.ns.entfernen', { nr: zeile.ns })"
                        :testid="`wsync-ns-${zeile.ns}-entfernen`"
                        @click="sofort.entferne(zeile.ns)"
                        ><span aria-hidden="true">✕</span></AvmKnopf
                    >
                </span>
                <span
                    v-if="sofort.textGrund(zeile.ns) !== undefined"
                    :id="zeilenGrundId(zeile.ns)"
                    role="cell"
                    class="wsync-ns__grund"
                    :data-testid="`wsync-ns-${zeile.ns}-grund`"
                    >{{ sofort.textGrund(zeile.ns) }}</span
                >
            </div>
        </div>
        <!-- Unter der Tafel, nicht darüber: Eine Meldung über den Zeilen schöbe sie nach dem ersten Klick unter dem Zeiger weg. -->
        <div ref="stand" class="wsync-ns__stand">
            <AvmHinweis v-if="sofort.meldung.value !== null" rolle="status" testid="wsync-ns-meldung">{{
                sofort.meldung.value
            }}</AvmHinweis>
            <VerwaltungMeldung :ergebnis="sofort.fehler.value" testid="wsync-ns-fehler" />
        </div>
        <p class="wsync-ns__satz">{{ t("admin.wikisync.ns.ohneZeile") }}</p>

        <!-- Namensraum hinzufügen: gespeichert wird, sobald die Zeile gilt -->
        <div
            v-if="form !== null"
            class="wsync-ns__neu"
            role="group"
            :aria-label="t('admin.wikisync.ns.hinzufuegen')"
            data-testid="wsync-ns-form"
        >
            <p class="wsync-ns__satz wsync-ns__formstand" data-testid="wsync-ns-form-stand">
                <AvmPille v-if="form.speichert" ton="neutral">{{ t("admin.wikisync.marke.speichert") }}</AvmPille>
                <AvmPille v-else-if="formGrund !== undefined" ton="warnung">{{
                    t("admin.wikisync.marke.unvollstaendig")
                }}</AvmPille>
                <span data-testid="wsync-ns-form-grund">{{ formGrund ?? t("admin.wikisync.ns.form.sofort") }}</span>
            </p>
            <label class="wsync-ns__feld"
                ><span class="wsync-ns__etikett">{{ t("admin.wikisync.ns.form.nr") }}</span
                ><AvmEingabe
                    ref="nrFeld"
                    v-model="form.nr"
                    :gesperrt="form.speichert ? '' : undefined"
                    :placeholder="t('admin.wikisync.ns.form.nrPlatz')"
                    inputmode="numeric"
                    autocomplete="off"
                    testid="wsync-ns-form-nr"
                    @blur="formFertig()"
                    @keydown="formTaste"
            /></label>
            <label class="wsync-ns__feld"
                ><span class="wsync-ns__etikett">{{ t("admin.wikisync.ns.kopf.praefix") }}</span
                ><AvmEingabe
                    v-model="form.praefix"
                    :gesperrt="form.speichert ? '' : undefined"
                    :placeholder="t('admin.wikisync.ns.form.praefixPlatz')"
                    maxlength="41"
                    autocomplete="off"
                    testid="wsync-ns-form-praefix"
                    @blur="formFertig()"
                    @keydown="formTaste"
            /></label>
            <label class="wsync-ns__feld"
                ><span class="wsync-ns__etikett">{{ t("admin.wikisync.ns.kopf.kanon") }}</span
                ><AvmAuswahl
                    :model-value="form.kanon"
                    :optionen="KANON_OPTIONEN"
                    :gesperrt="form.speichert ? '' : undefined"
                    testid="wsync-ns-form-kanon"
                    @update:model-value="
                        (wert: string) => {
                            if (form !== null) form.kanon = wert as WikiKanon;
                            void formFertig();
                        }
                    "
            /></label>
            <label class="wsync-ns__feld"
                ><span class="wsync-ns__etikett">{{ t("admin.wikisync.ns.kopf.bezeichner") }}</span
                ><AvmEingabe
                    v-model="form.bezeichner"
                    :gesperrt="form.speichert ? '' : undefined"
                    :placeholder="t('admin.wikisync.ns.form.bezeichnerPlatz')"
                    maxlength="80"
                    autocomplete="off"
                    testid="wsync-ns-form-bezeichner"
                    @blur="formFertig()"
                    @keydown="formTaste"
            /></label>
            <span class="wsync-ns__feld"
                ><span class="wsync-ns__etikett">{{ t("admin.wikisync.ns.kopf.vorschau") }}</span
                ><span class="wsync-ns__pille"><InfoCanonPill :pill="pille(form.kanon, form.bezeichner)" /></span
            ></span>
            <label class="wsync-ns__feld"
                ><span class="wsync-ns__etikett">{{ t("admin.wikisync.ns.kopf.einsammeln") }}</span
                ><AvmAuswahl
                    :model-value="form.einsammeln ? 'ja' : 'nein'"
                    :optionen="JA_NEIN"
                    :gesperrt="form.speichert ? '' : undefined"
                    testid="wsync-ns-form-einsammeln"
                    @update:model-value="
                        (wert: string) => {
                            if (form !== null) form.einsammeln = wert === 'ja';
                            void formFertig();
                        }
                    "
            /></label>
            <span class="wsync-ns__formknoepfe">
                <AvmKnopf groesse="zeile" :gesperrt="form.speichert ? '' : undefined" @click="form = null">{{
                    t("admin.wikisync.abbrechen")
                }}</AvmKnopf>
            </span>
        </div>
        <div v-else>
            <AvmKnopf
                groesse="zeile"
                :gesperrt="sperre === undefined ? undefined : ''"
                :title="sperre"
                testid="wsync-ns-hinzu"
                @click="formOeffnen()"
                >{{ t("admin.wikisync.ns.hinzufuegen") }}</AvmKnopf
            >
        </div>
    </div>
</template>

<style scoped>
.wsync-ns {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
    container: wsync-ns / inline-size;
}

.wsync-ns__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wsync-ns__satz strong {
    color: var(--color-text-strong);
    font-weight: var(--font-weight-regular);
}

.wsync-ns__link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
}

.wsync-ns__link:focus-visible {
    outline: none;
    border-radius: var(--radius-sm);
    box-shadow: var(--focus-ring);
}

/* Leer nimmt der Kasten keinen Platz ein (die Lücke der Spalte käme sonst dazu). */
.wsync-ns__stand {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.wsync-ns__stand:empty {
    display: none;
}

.wsync-ns__tafel {
    min-width: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
}

.wsync-ns__raster {
    box-sizing: border-box;
    display: grid;
    grid-template-columns:
        minmax(0, 34px) minmax(0, 0.7fr) minmax(120px, 1fr) minmax(84px, 0.7fr) minmax(112px, 1fr) minmax(150px, 1.3fr)
        minmax(0, 56px) minmax(0, 60px) minmax(0, 52px);
    column-gap: var(--space-6);
    align-items: center;
    padding: var(--space-4) var(--space-8);
}

.wsync-ns__kopf {
    border-bottom: 1px solid var(--color-divider);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.wsync-ns__zeile {
    border-bottom: 1px solid var(--color-divider);
    font-size: var(--font-size-small);
}

.wsync-ns__zeile:last-child {
    border-bottom: 0;
}

.wsync-ns__zeile.is-speichert {
    background: var(--color-panel-soft);
}

.wsync-ns__zeile > * {
    min-width: 0;
    overflow-wrap: anywhere;
}

.wsync-ns__nr {
    color: var(--color-text-strong);
    font-variant-numeric: tabular-nums;
}

.wsync-ns__leise {
    color: var(--color-text-muted);
}

.wsync-ns__zahl {
    text-align: right;
    font-variant-numeric: tabular-nums;
}

.wsync-ns__wahl {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
}

.wsync-ns__pille {
    display: flex;
    align-items: center;
    min-width: 0;
    min-height: var(--avm-control-h);
}

.wsync-ns__aktion {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-4);
}

/* Warum der getippte Bezeichner nicht gespeichert wird: eine Zeile unter der Zeile, über deren ganze Breite (in der Zelle ist kein Platz). */
.wsync-ns__grund {
    grid-column: 1 / -1;
    color: var(--color-danger-soft-text);
}

.wsync-ns__formknoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-8);
    align-items: center;
}

/* Der Stand der neuen Zeile (unvollständig mit Grund, speichert) über die ganze Breite des Formulars. */
.wsync-ns__formstand {
    display: flex;
    flex: 1 1 100%;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
}

.wsync-ns__neu {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-6) var(--space-8);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.wsync-ns__feld {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.wsync-ns__etikett {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* Schmal: Karten statt Raster (Guide §13.13), jede Zelle mit ihrem Namen davor */
@container wsync-ns (max-width: 860px) {
    .wsync-ns__kopf {
        display: none;
    }

    .wsync-ns__raster.wsync-ns__zeile {
        grid-template-columns: 34px minmax(0, 1fr) auto;
        grid-template-areas:
            "nr pf akt"
            ". wahl wahl"
            ". sam sam"
            ". bez bez"
            ". et et"
            ". ob sp";
        row-gap: var(--space-4);
        padding: var(--space-6) var(--space-8);
    }

    .wsync-ns__zeile > .z-nr {
        grid-area: nr;
    }

    .wsync-ns__zeile > .z-pf {
        grid-area: pf;
    }

    .wsync-ns__zeile > .z-wahl {
        grid-area: wahl;
    }

    .wsync-ns__zeile > .z-sam {
        grid-area: sam;
    }

    .wsync-ns__zeile > .z-bez {
        grid-area: bez;
        display: flex;
        align-items: center;
        gap: var(--space-4);
    }

    .wsync-ns__zeile > .z-et {
        grid-area: et;
        gap: var(--space-4);
    }

    .wsync-ns__zeile > .z-ob {
        grid-area: ob;
        text-align: left;
    }

    .wsync-ns__zeile > .z-sp {
        grid-area: sp;
        text-align: right;
    }

    .wsync-ns__zeile > .z-akt {
        grid-area: akt;
    }

    .wsync-ns__zeile > [data-l]::before {
        content: attr(data-l) ": " / "";
        color: var(--color-text-muted);
        flex: none;
    }
}
</style>
