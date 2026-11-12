import { ZAEHLREGELN, type MastodonGrenzen } from "@avesmaps3d/shared";
import * as facebook from "./facebook.ts";
import * as instagram from "./instagram.ts";
import type { MetaKanal, MetaZugang } from "./konfiguration.ts";
import type { GraphDeps } from "./meta-graph.ts";

/**
 * Was Facebook und Instagram gemeinsam haben (WI-0268 C12b): die Grenzen, die der Hub für sie führt, und die Prüfung des Zugangs. Meta nennt seine Grenzen nicht (anders als Mastodon mit `/api/v2/instance`): Die
 * Zahlen stehen mit Quelle und Prüfdatum in `ZAEHLREGELN` (Recherche §2), die Bildgrenzen hier. `kanal_stand.grenzen` führt sie trotzdem, damit `_kanal_bereit` einen Kanal nur freigibt, dessen Zugang einmal gelesen
 * wurde (täglich im Lauf der Pflege, auf Wunsch über „Grenzen neu lesen“).
 */

const MIB = 1024 * 1024;

/**
 * Die Grenzen, die der Hub für einen Meta-Kanal führt. Die Zeichengrenze kommt aus `ZAEHLREGELN` (eine Quelle), die Länge einer Adresse ist 0 (Links zählen als Text), die Bildbeschreibung ist so lang wie die des Hubs
 * (`SOCIAL_GRENZEN.beschreibungMax`, 1000), die Größe die der Recherche (Instagram 8 MB, Facebook 4 MB).
 *
 * 🔴 `bildTypen` und `bildBytes` beschreiben die QUELLE: Der Hub hat nur veröffentlichte WebP-Bilder. Facebook lädt die WebP selbst hoch. **Instagram nimmt über die Graph-Schnittstelle nur JPEG:** Es bekommt nicht die WebP,
 * sondern eine JPEG-Ableitung, die der Versand neben die WebP legt (`social/instagram-bild.ts`: mittig auf 4:5 bis 1,91:1 zugeschnitten, höchstens 1440 Pixel breit, Transparenz auf Weiß, höchstens 8 MiB). Die Größengrenze
 * von Instagram (8 MiB) gilt für diese Ableitung und erzwingt die Umwandlung selbst; die Prüfung der Quelle gegen `bildBytes` im Versand bleibt als zusätzliche Sicherung stehen. Ob Meta die Ableitung annimmt, entscheidet
 * der Prüflauf mit einem Testbild (`social:pruefen --bild`), nicht diese Zeile.
 */
export function metaGrenzen(kanal: MetaKanal): MastodonGrenzen {
    return {
        zeichen: ZAEHLREGELN[kanal].grenze,
        adresse: 0,
        bilder: 1,
        beschreibung: 1000,
        bildBytes: (kanal === "instagram" ? 8 : 4) * MIB,
        bildTypen: ["image/webp", "image/jpeg"],
    };
}

/** Prüft, dass der Schlüssel des Kanals noch gilt und zu seinem Konto gehört (ein lesender Aufruf, nichts wird gesendet). Wirft `MetaFehler`. */
export const leseMetaKonto = (kanal: MetaKanal, zugang: MetaZugang, deps: GraphDeps = {}): Promise<void> =>
    kanal === "facebook" ? facebook.leseKonto(zugang, deps) : instagram.leseKonto(zugang, deps);
