<script setup lang="ts">
import { computed, useId } from "vue";
import type {
    KarteVorschauSperre,
    MediaGalleryDetail,
    MediaSlotSubjectKind,
    MediaTypeImageVariant,
    MediaUsage,
    MediaUsageResult,
    MediaUsageSubject,
} from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import { t, type MessageKey } from "../i18n/i18n";
import type { BindbareRolle } from "./medien-formular-modell";
import {
    BILDBEZUG_STELLUNGEN,
    bezugWert,
    bildbezugSatz,
    bildbezugZeile,
    type BildbezugStellung,
    type BildbezugAnfrage,
    type BildbezugZeile,
} from "./medien-bildbezug-modell";
import { verwendungenGeordnet } from "./medien-inspektor-modell";
import { umSprung, vorschauSperrSatz } from "./medien-karte-vorschau-modell";
import { kreisDerVerwendung, kreisName } from "./medien-kreis";
import { anzeigeName, datum, rolleName, verwendungGrund, zahl } from "./medien-text";
import { liegtAufKarte } from "./medien-zustand";

/**
 * Die Verwendungen im Inspector (Reverse Usage, WI-0068 §8): direkt über eine Bindung, dann über Galerien; je Zeile der Kreis der
 * Entscheidung an genau dieser Stelle (● öffentlich, ◐ verwendet, hier nicht öffentlich, ○ ohne Stelle), das Fachobjekt, die Rolle
 * und der Grund der Policy. Darunter „gleiche Datei“: andere Werke mit denselben Bytes, als Hinweis, nie als Zusammenführung (§21).
 *
 * - **„Auf Karte zeigen“** nur, wo das Fachobjekt eine Lage hat (Ort, Gebiet) und nicht stillgelegt ist; es schließt das Fenster und
 *   fliegt hin (P0 Frage 3). Ein stillgelegtes Fachobjekt trägt die Marke „stillgelegt“ (WI-0068 R4).
 * - Je Zeile steht, seit wann es die Verwendung gibt (`since`), hinter der Entscheidung der Policy.
 * - Der Name des Fachobjekts beschränkt die Treffer auf es („verwendet von“), er führt nicht aus dem Fenster.
 * - Die private Begründung einer Einzelentscheidung steht nur, wenn die Route sie liefert, mit der Marke „intern“.
 * - **Wählen** (WI-0068 P4b, mit `upload_media`): Am Wappen eines Orts oder Gebiets „⇄ anderes Wappen …“, am Titelbild eines Orts
 *   „＋ weiteres Titelbild …“; beides öffnet die Auswahl der Medienverwaltung für genau diesen Platz (`medien-auswahl-fenster.vue`).
 * - **Bildbezug** (Betreiber 2026-10-11): Am Titelbild eines Ortes steht ein Schalter mit DREI Stellungen — „nach der Regel“,
 *   „Ortsansicht“, „Typbild“ — darunter ein Satz, was gilt und warum. Nur dort; jede andere Verwendung hat keinen Bildbezug.
 *   Ohne `upload_media`, während einer laufenden Handlung oder ohne gesicherte Revision steht er gesperrt und sagt, warum.
 * - **Vorschau erzeugen** (WI-0287 Punkt 5, OPS-000091, Entwurf `verwendungsZeile`): An jeder Verwendung einer Karte als Karte eines Eintrags steht „Vorschau: <Titel>“ (Sprung
 *   zum Werk) oder „Noch keine Vorschau.“, dann mit Recht „✚ Vorschau erzeugen“; gesperrt mit Grund (`vorschauSperre` der Karte). Ein stillgelegter Eintrag zeigt nur „stillgelegt“.
 */
const props = defineProps<{
    verwendung: MediaUsageResult;
    darfBinden?: boolean | undefined;
    /** Das Asset, dessen Verwendungen hier stehen; die Operation des Bildbezugs braucht seine Kennung. */
    assetId?: string | undefined;
    /** Die geladenen Galerien des Assets: aus ihnen kommt die Revision der Galerie (`medien-bildbezug-modell.ts`). */
    galerien?: readonly MediaGalleryDetail[] | undefined;
    /** Läuft gerade ein Wechsel des Bildbezugs? Dann sind die Schalter gesperrt. */
    bezugLaeuft?: boolean | undefined;
    /**
     * Nur die Verweise auf die Objekte, ohne „Auf der Karte“: im Hinweis „Dieses Bild gibt es bereits!“ des Hochladens, das über der
     * Karte liegt (Betreiber 2026-10-17). Die Namen bleiben Verweise, nie nur eine Zahl.
     */
    nurVerweise?: boolean | undefined;
    /** An einer Karte: warum „Vorschau erzeugen“ gesperrt ist (`null`: es geht; WI-0287 Punkt 5). */
    vorschauSperre?: KarteVorschauSperre | null | undefined;
    /** Läuft „Vorschau erzeugen“ gerade? Dann sind die Knöpfe gesperrt. */
    erzeugenLaeuft?: boolean | undefined;
}>();
const emit = defineEmits<{
    /** „✚ Vorschau erzeugen“ an der Verwendung als Karte eines Eintrags (WI-0287 Punkt 5). */
    vorschauErzeugen: [usage: MediaUsage];
    aufKarte: [subjekt: MediaUsageSubject];
    von: [subjekt: MediaUsageSubject];
    waehleAsset: [id: string];
    waehlen: [platz: { subjekt: { kind: MediaSlotSubjectKind; id: string; name: string }; rolle: BindbareRolle }];
    bezug: [anfrage: BildbezugAnfrage, wert: ReturnType<typeof bezugWert>];
    zusammenfuehren: [];
    /** Ein Typbild (★): zur Kategorie in der Liste der Typbilder. */
    /** Zur Kategorie und Variante (WI-0281; ohne Angabe die KI-Variante) in der Liste der Typbilder. */
    typbild: [kategorie: string, variante: MediaTypeImageVariant];
    /** Eine Karte der Kartensammlung: zur Karte in der Medienverwaltung (WI-0068 R5). */
    karte: [id: string];
}>();

const WEG: Readonly<Record<MediaUsage["via"], MessageKey>> = {
    binding: "medien.verwendung.direkt",
    gallery: "medien.verwendung.galerie",
    type_image: "medien.verwendung.typbild",
};

/** Der Platz, an dem man ein anderes Asset wählen kann: das Wappen eines Orts oder Gebiets, die Titelbilder eines Orts. */
function platz(
    usage: MediaUsage,
): { subjekt: { kind: MediaSlotSubjectKind; id: string; name: string }; rolle: BindbareRolle } | undefined {
    if (props.darfBinden !== true || usage.subject === null) return undefined;
    const { kind, id, name } = usage.subject;
    if (usage.role === "coat" && (kind === "place" || kind === "territory"))
        return { subjekt: { kind, id, name }, rolle: "coat" };
    if (usage.role === "header" && kind === "place") return { subjekt: { kind, id, name }, rolle: "header" };
    return undefined;
}

const zeilen = computed(() => verwendungenGeordnet(props.verwendung.usages));

/** Der Bildbezug einer Verwendung, oder `undefined`, wo es keinen gibt (jede Rolle außer dem Titelbild eines Ortes). */
function bezug(usage: MediaUsage): BildbezugZeile | undefined {
    return props.assetId === undefined ? undefined : bildbezugZeile(usage, props.assetId, props.galerien ?? []);
}

/**
 * Warum der Schalter nicht geht: fehlendes Recht, laufende Handlung, oder eine Revision, die wir nicht sicher kennen.
 * 🔴 Ohne gesicherte Revision der Galerie wird NICHT gesendet: ein erfundener Wert erzeugte einen Konflikt aus dem Nichts.
 */
function bezugGesperrt(zeile: BildbezugZeile): string | undefined {
    if (props.darfBinden !== true) return t("medien.bezug.keinRecht");
    if (props.bezugLaeuft === true) return t("medien.bezug.laeuft");
    return zeile.anfrage === undefined ? t("medien.bezug.laedt") : undefined;
}

/** Die drei Stellungen; ist der Schalter gesperrt, trägt jede den Grund als Hinweis (`AvmSegmente` sperrt je Option). */
function bezugStellungen(zeile: BildbezugZeile): { value: string; label: string; gesperrt?: boolean }[] {
    const grund = bezugGesperrt(zeile);
    return BILDBEZUG_STELLUNGEN.map((wert) => ({
        value: wert,
        label: t(`medien.bezug.${wert}`),
        ...(grund === undefined ? {} : { gesperrt: true }),
    }));
}

function bezugSatz(zeile: BildbezugZeile): string {
    const { schluessel, orte } = bildbezugSatz(zeile);
    return t(`medien.bezug.satz.${schluessel}`, {
        n: zahl(orte),
        gilt: t(`medien.bezug.${zeile.gilt}`),
        regel: t(`medien.bezug.${zeile.regel}`),
    });
}

function setzeBezug(zeile: BildbezugZeile, stellung: string): void {
    const anfrage = zeile.anfrage;
    if (anfrage === undefined || !(BILDBEZUG_STELLUNGEN as readonly string[]).includes(stellung)) return;
    emit("bezug", anfrage, bezugWert(stellung as BildbezugStellung));
}

function rolle(usage: MediaUsage): string {
    return usage.role === null ? "" : rolleName(usage.role);
}

/** Die zweite Zeile: die Entscheidung der Policy und seit wann es die Verwendung gibt (WI-0068 R4), getrennt durch „ · “. */
function grund(usage: MediaUsage): string | undefined {
    const teile = [
        usage.publication === null
            ? undefined
            : t(usage.publication.public ? "medien.freigabe.ja" : "medien.freigabe.nein", {
                  grund: verwendungGrund(usage.role, usage.publication),
              }),
        usage.since === undefined ? undefined : t("medien.verwendung.seit", { am: datum(usage.since) }),
    ].filter((teil): teil is string => teil !== undefined);
    return teile.length === 0 ? undefined : teile.join(" · ");
}

/** Ein stillgelegtes Fachobjekt (in Legacy entfernt) bleibt eine Verwendung, steht aber so da und hat keine Lage zum Hinfliegen. */
function stillgelegt(usage: MediaUsage): boolean {
    return usage.subject !== null && !usage.subject.active;
}

function einzeln(usage: MediaUsage): string | undefined {
    const override = usage.override;
    if (override.state === "none") return undefined;
    const am = override.decidedOn === null ? "" : ` (${datum(override.decidedOn)})`;
    return `${t(`medien.einzeln.${override.state}`)}${am}`;
}

function begruendung(usage: MediaUsage): string | undefined {
    const override = usage.override;
    if (override.state === "none") return undefined;
    const teile = [override.decidedBy?.displayName, override.reason, override.operatorQuote].filter(
        (teil): teil is string => typeof teil === "string" && teil !== "",
    );
    return teile.length === 0 ? undefined : teile.join(" · ");
}

// --- Vorschau erzeugen (WI-0287 Punkt 5) ---

const sperrId = useId();
const sperrSatz = computed(() => vorschauSperrSatz(props.vorschauSperre));
/** Die Verwendung als Karte eines aktiven Eintrags, an der „Vorschau erzeugen“ steht; ein stillgelegter Eintrag zeigt nur „stillgelegt“. */
function anEintrag(usage: MediaUsage): NonNullable<MediaUsage["citymap"]> | undefined {
    return usage.citymap !== undefined && !stillgelegt(usage) ? usage.citymap : undefined;
}
const vorschauSprung = computed(() => umSprung("medien.karten.vorschau.verwendung", "titel"));

function anderesName(eintrag: MediaUsageResult["sameFile"][number]): string {
    const erste = eintrag.usages[0];
    return anzeigeName(
        eintrag.asset,
        erste === undefined
            ? null
            : {
                  subject: erste.subject,
                  role: erste.role,
                  gallery: erste.gallery,
                  ...(erste.typeImage === undefined ? {} : { typeImage: erste.typeImage }),
              },
    );
}
</script>

<template>
    <div class="medien-verwendungen" data-testid="medien-verwendungen">
        <p v-if="zeilen.length === 0" class="medien-verwendungen__satz" data-testid="medien-unbenutzt">
            {{ t("medien.verwendung.keine") }}
        </p>
        <ul v-else class="medien-verwendungen__liste">
            <li
                v-for="(usage, index) in zeilen"
                :key="index"
                class="medien-verwendungen__zeile"
                data-testid="medien-verwendung"
            >
                <AvmKreis :fuellung="kreisDerVerwendung(usage)" :name="kreisName(kreisDerVerwendung(usage))" />
                <span class="medien-verwendungen__text">
                    <span class="medien-verwendungen__l1">
                        <span class="medien-verwendungen__weg">{{ t(WEG[usage.via]) }}</span>
                        <button
                            v-if="usage.subject !== null"
                            type="button"
                            class="medien-verwendungen__subjekt"
                            :title="t('medien.verwendung.vonTitel', { name: usage.subject.name })"
                            data-testid="medien-verwendung-subjekt"
                            @click="emit('von', usage.subject)"
                        >
                            {{ usage.subject.name }}
                        </button>
                        <button
                            v-else-if="usage.typeImage !== undefined"
                            type="button"
                            class="medien-verwendungen__subjekt"
                            :title="t('medien.verwendung.typbildTitel', { art: usage.typeImage.label })"
                            data-testid="medien-verwendung-typbild"
                            @click="emit('typbild', usage.typeImage.category, usage.typeImage.variant ?? 'ki')"
                        >
                            ★ {{ usage.typeImage.label }}
                            <span
                                class="medien-verwendungen__variante"
                                data-testid="medien-verwendung-typbild-variante"
                                >{{ t(`medien.typbild.variante.kurz.${usage.typeImage.variant ?? "ki"}`) }}</span
                            >
                        </button>
                        <span v-else>{{ t("medien.verwendung.ohneObjekt") }}</span>
                        <span v-if="rolle(usage) !== ''">→ {{ rolle(usage) }}</span>
                        <span v-if="usage.gallery !== null" class="medien-verwendungen__galerie">{{
                            t("medien.verwendung.position", {
                                titel: usage.gallery.title ?? t("medien.galerie.ohneTitel"),
                                n: zahl(usage.gallery.position),
                            })
                        }}</span>
                        <span
                            v-if="stillgelegt(usage)"
                            class="medien-verwendungen__galerie"
                            data-testid="medien-verwendung-stillgelegt"
                            >{{ t("medien.verwendung.stillgelegt") }}</span
                        >
                    </span>
                    <span v-if="grund(usage)" class="medien-verwendungen__l2">{{ grund(usage) }}</span>
                    <!-- Die Vorschau des Eintrags (WI-0287 Punkt 5): ihr Titel als Sprung, sonst „Noch keine Vorschau.“ und, mit Recht, der Grund einer Sperre. -->
                    <template v-if="anEintrag(usage)">
                        <span
                            v-if="anEintrag(usage)!.preview"
                            class="medien-verwendungen__l2"
                            data-testid="medien-verwendung-vorschau"
                            >{{ vorschauSprung.davor
                            }}<button
                                type="button"
                                class="medien-verwendungen__subjekt"
                                data-testid="medien-verwendung-vorschau-sprung"
                                @click="emit('waehleAsset', anEintrag(usage)!.preview!.assetId)"
                            >
                                {{ anEintrag(usage)!.preview!.title ?? t("medien.karten.platz.kopfVorschau") }}</button
                            >{{ vorschauSprung.danach }}</span
                        >
                        <template v-else>
                            <span class="medien-verwendungen__l2" data-testid="medien-verwendung-vorschau">{{
                                t("medien.karten.vorschau.keine")
                            }}</span>
                            <span
                                v-if="darfBinden && sperrSatz"
                                :id="`${sperrId}-${index}`"
                                class="medien-verwendungen__l2"
                                data-testid="medien-verwendung-vorschau-sperre"
                                >{{ sperrSatz }}</span
                            >
                        </template>
                    </template>
                    <span v-if="einzeln(usage)" class="medien-verwendungen__l2">
                        {{ einzeln(usage) }}
                        <template v-if="begruendung(usage)">
                            · <span class="medien-verwendungen__intern">{{ t("medien.intern") }}</span>
                            {{ begruendung(usage) }}
                        </template>
                    </span>
                </span>
                <span class="medien-verwendungen__knoepfe">
                    <AvmKnopf
                        v-if="
                            !nurVerweise &&
                            usage.subject !== null &&
                            !stillgelegt(usage) &&
                            liegtAufKarte(usage.subject.kind)
                        "
                        groesse="zeile"
                        class="medien-verwendungen__karte"
                        testid="medien-auf-karte"
                        @click="emit('aufKarte', usage.subject)"
                    >
                        {{ t("medien.verwendung.aufKarte") }}
                    </AvmKnopf>
                    <AvmKnopf
                        v-if="!nurVerweise && usage.subject !== null && usage.subject.kind === 'citymap'"
                        groesse="zeile"
                        testid="medien-verwendung-karte"
                        @click="emit('karte', usage.subject.id)"
                    >
                        {{ t("medien.verwendung.karteOeffnen") }}
                    </AvmKnopf>
                    <AvmKnopf
                        v-if="!nurVerweise && darfBinden && anEintrag(usage) && !anEintrag(usage)!.preview"
                        art="gefuellt"
                        groesse="zeile"
                        :gesperrt="sperrSatz ?? (erzeugenLaeuft ? t('medien.bearbeiten.sendet') : undefined)"
                        :grund-bei="sperrSatz === undefined ? undefined : `${sperrId}-${index}`"
                        testid="medien-verwendung-vorschau-erzeugen"
                        @click="emit('vorschauErzeugen', usage)"
                    >
                        <template #zeichen>✚</template>
                        {{ t("medien.karten.vorschau.erzeugen") }}
                    </AvmKnopf>
                    <AvmKnopf
                        v-if="platz(usage)"
                        groesse="zeile"
                        :testid="`medien-waehlen-${platz(usage)?.rolle}`"
                        @click="emit('waehlen', platz(usage)!)"
                    >
                        <template #zeichen>{{ platz(usage)?.rolle === "coat" ? "⇄" : "＋" }}</template>
                        {{
                            t(
                                platz(usage)?.rolle === "coat"
                                    ? "medien.auswahl.oeffnenWappen"
                                    : "medien.auswahl.oeffnenBild",
                            )
                        }}
                    </AvmKnopf>
                </span>
                <!-- Der Bildbezug: nur am Titelbild eines Ortes, drei Stellungen (Betreiber 2026-10-11). Eine eigene Zeile unter Text UND Knöpfen: In der Textspalte
                 neben „Auf Karte zeigen“ und „＋ anderes Titelbild …“ schrumpften die Segmente auf „nac…“, „Orts…“, „Typ…“ (Fund 2026-11-09). -->
                <span v-if="bezug(usage)" class="medien-verwendungen__bezug" data-testid="medien-bildbezug">
                    <AvmSegmente
                        :model-value="bezug(usage)!.stellung"
                        :options="bezugStellungen(bezug(usage)!)"
                        :label="t('medien.bezug.label')"
                        gestapelt="auto"
                        testid="medien-bildbezug-schalter"
                        @update:model-value="(wert: string) => setzeBezug(bezug(usage)!, wert)"
                    />
                    <span class="medien-verwendungen__l2">{{ bezugSatz(bezug(usage)!) }}</span>
                    <span v-if="bezugGesperrt(bezug(usage)!)" class="medien-verwendungen__l2">{{
                        bezugGesperrt(bezug(usage)!)
                    }}</span>
                </span>
            </li>
        </ul>
        <p v-if="verwendung.retired > 0" class="medien-verwendungen__satz">
            {{ t("medien.verwendung.zurueckgezogen", { n: zahl(verwendung.retired) }) }}
        </p>
        <div
            v-if="verwendung.sameFile.length > 0"
            class="medien-verwendungen__gleich"
            data-testid="medien-gleiche-datei"
        >
            <h5 class="medien-verwendungen__kopf">
                {{ t("medien.verwendung.gleicheDatei", { n: zahl(verwendung.sameFile.length) }) }}
            </h5>
            <ul class="medien-verwendungen__liste">
                <li v-for="eintrag in verwendung.sameFile" :key="eintrag.asset.id">
                    <button
                        type="button"
                        class="medien-verwendungen__subjekt"
                        data-testid="medien-gleiche-datei-asset"
                        @click="emit('waehleAsset', eintrag.asset.id)"
                    >
                        {{ anderesName(eintrag) }}
                    </button>
                </li>
            </ul>
            <p class="medien-verwendungen__satz">{{ t("medien.verwendung.gleicheDateiSatz") }}</p>
            <!-- 🔴 Von hier führt der Weg zum Zusammenführen (WI-0068 D1): Dieselben Bytes zweimal sind ein Werk zu viel. Ein schon
                 aufgegangenes Werk führt nichts mehr zusammen (OPS-000096); aufgegangene Werke nennt der Server hier gar nicht. -->
            <AvmKnopf
                v-if="darfBinden && verwendung.aufgegangen !== true"
                groesse="zeile"
                testid="medien-merge-oeffnen"
                @click="emit('zusammenfuehren')"
                >{{ t("medien.merge.oeffnen") }}</AvmKnopf
            >
        </div>
    </div>
</template>

<style scoped>
/* Unter Text und Knöpfen, ab der Spalte des Textes: Der Schalter hat die ganze Breite der Zeile. */
.medien-verwendungen__bezug {
    display: flex;
    grid-column: 2 / -1;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    min-width: 0;
}

.medien-verwendungen__knoepfe {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-2);
}

.medien-verwendungen {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.medien-verwendungen__liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
}

/* Kreis, Text, Knöpfe; darunter, wo es ihn gibt, der Bildbezug über Text und Knöpfe. */
.medien-verwendungen__zeile {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: start;
    gap: var(--space-2) var(--space-4);
}

/* Der Kreis sitzt auf der Mitte der ersten Zeile. */
.medien-verwendungen__zeile > :first-child {
    margin-top: var(--space-2);
}

.medien-verwendungen__text {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.medien-verwendungen__l1 {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-4);
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.medien-verwendungen__weg,
.medien-verwendungen__galerie,
.medien-verwendungen__variante {
    color: var(--color-text-muted);
}

.medien-verwendungen__l2,
.medien-verwendungen__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.medien-verwendungen__intern {
    color: var(--color-accent-strong);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

/* Der Name des Fachobjekts: ein Verweis innerhalb des Fensters (goldbraun, ohne ↗ - er führt nicht hinaus). */
.medien-verwendungen__subjekt {
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    text-align: left;
    text-decoration: underline;
    transition:
        color 120ms ease,
        box-shadow 120ms ease;
}

.medien-verwendungen__subjekt:hover {
    color: var(--color-link-hover);
}

.medien-verwendungen__subjekt:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.medien-verwendungen__karte {
    flex: none;
}

.medien-verwendungen__kopf {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-bold);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

@media (prefers-reduced-motion: reduce) {
    .medien-verwendungen__subjekt {
        transition: none;
    }
}
</style>
