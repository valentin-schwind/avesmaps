/**
 * Die Kopfgrafik der Art: die Zuordnung steht seit WI-0068 Typbilder in `@avesmaps3d/shared` (`header-graphics.ts`), hier nur noch die
 * Adresse der eingebauten Datei.
 */
export {
    HEADER_GRAPHICS,
    headerGraphicOf,
    headerGraphicOfLandscape,
    headerGraphicOfPath,
    headerGraphicOfPlace,
    headerGraphicOfPoint,
    type HeaderGraphic,
} from "@avesmaps3d/shared";
import type { HeaderGraphic } from "@avesmaps3d/shared";

/** Die Adresse der Datei; Vite liefert `public/` unter der Wurzel aus. */
export const headerGraphicUrl = (graphic: HeaderGraphic): string => `/icons/header/${graphic}.webp`;
