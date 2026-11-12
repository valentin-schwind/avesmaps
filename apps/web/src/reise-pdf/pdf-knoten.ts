/**
 * Die Teile einer pdfmake-Beschreibung, soweit „Reise als PDF“ sie braucht (WI-0306). pdfmake 0.3 bringt keine Typen mit; diese Datei
 * beschreibt nur, was `dokument.ts` schreibt, damit der Typcheck es prüft. Maße in Punkten (1/72 Zoll).
 */

export type Rand = [number, number, number, number];

export interface Stil {
    font?: string;
    fontSize?: number;
    color?: string;
    lineHeight?: number;
    characterSpacing?: number;
    alignment?: "left" | "right" | "center" | "justify";
    margin?: Rand;
    sup?: boolean;
    noWrap?: boolean;
    opacity?: number;
}

export type Vektor =
    | {
          type: "line";
          x1: number;
          y1: number;
          x2: number;
          y2: number;
          lineWidth?: number;
          lineColor?: string;
          dash?: { length: number; space?: number };
          lineCap?: "butt" | "round" | "square";
      }
    | {
          type: "rect";
          x: number;
          y: number;
          w: number;
          h: number;
          r?: number;
          color?: string;
          lineColor?: string;
          lineWidth?: number;
          fillOpacity?: number;
      }
    | {
          type: "ellipse";
          x: number;
          y: number;
          r1: number;
          r2: number;
          color?: string;
          lineColor?: string;
          lineWidth?: number;
      }
    | {
          type: "polyline";
          points: { x: number; y: number }[];
          closePath?: boolean;
          color?: string;
          lineColor?: string;
          lineWidth?: number;
          fillOpacity?: number;
          strokeOpacity?: number;
          lineJoin?: "miter" | "round" | "bevel";
          dash?: { length: number; space?: number };
      };

export interface TabellenLayout {
    hLineWidth?: (zeile: number, knoten: unknown) => number;
    vLineWidth?: (spalte: number, knoten: unknown) => number;
    hLineColor?: (zeile: number, knoten: unknown) => string;
    vLineColor?: (spalte: number, knoten: unknown) => string;
    paddingLeft?: (spalte: number, knoten: unknown) => number;
    paddingRight?: (spalte: number, knoten: unknown) => number;
    paddingTop?: (zeile: number, knoten: unknown) => number;
    paddingBottom?: (zeile: number, knoten: unknown) => number;
    fillColor?: (zeile: number, knoten: unknown, spalte: number) => string | null;
}

export interface Knoten extends Stil {
    text?: string | (string | Knoten)[];
    stack?: Inhalt[];
    columns?: Inhalt[];
    columnGap?: number;
    width?: number | "auto" | "*";
    table?: {
        widths: (number | "auto" | "*")[];
        body: Inhalt[][];
        headerRows?: number;
        dontBreakRows?: boolean;
        keepWithHeaderRows?: number;
    };
    layout?: TabellenLayout | "noBorders";
    colSpan?: number;
    fillColor?: string;
    image?: string;
    height?: number;
    /** Bilder: das Feld, in das sie passen; QR-Codes: die Kantenlänge. */
    fit?: number | [number, number];
    cover?: {
        width: number;
        height: number;
        align?: "left" | "center" | "right";
        valign?: "top" | "center" | "bottom";
    };
    canvas?: Vektor[];
    qr?: string;
    foreground?: string;
    background?: string;
    eccLevel?: "L" | "M" | "Q" | "H";
    unbreakable?: boolean;
    pageBreak?: "before" | "after";
    headlineLevel?: number;
    relativePosition?: { x: number; y: number };
    ul?: Inhalt[];
    ol?: Inhalt[];
    type?: "none";
    markerColor?: string;
}

export type Inhalt = string | Knoten;

export interface Seitengroesse {
    width: number;
    height: number;
}

export interface PdfDokument {
    pageSize: Seitengroesse;
    pageMargins: Rand;
    info: { title: string; author: string; subject: string; creator: string; producer: string };
    language?: string;
    defaultStyle: Stil & { font: string };
    background?: (seite: number, groesse: Seitengroesse) => Inhalt | null;
    header?: (seite: number, seiten: number, groesse: Seitengroesse) => Inhalt | null;
    footer?: (seite: number, seiten: number, groesse: Seitengroesse) => Inhalt | null;
    pageBreakBefore?: (knoten: { headlineLevel?: number }, folgende: { followingNodesOnPage: unknown[] }) => boolean;
    content: Inhalt[];
    images: Record<string, string>;
}
