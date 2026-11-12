"""Bausteine der HTML-Seite des Berichts (WI-0250 Phase A5): eine einzige statische Datei, Bilder eingebettet, kein Server, kein Framework, kein JavaScript."""

from __future__ import annotations

import html
import math
from typing import Any, Iterable, Sequence

from .grafik import data_uri

CSS = """
:root { color-scheme: light; --text:#1d1f23; --grau:#5b6169; --rand:#d5d9df; --flaeche:#f5f7fa; --akzent:#2f6db5; --warn:#b4531a; --gut:#2e7d4f; }
* { box-sizing: border-box; }
body { font: 14px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: var(--text); background: #fff; margin: 0; }
main { max-width: 1240px; margin: 0 auto; padding: 24px 20px 80px; }
h1 { font-size: 1.7rem; margin: 0 0 4px; } h2 { font-size: 1.3rem; margin: 40px 0 8px; padding-top: 10px; border-top: 2px solid var(--rand); }
h3 { font-size: 1.05rem; margin: 26px 0 6px; } h4 { font-size: .95rem; margin: 18px 0 4px; color: var(--grau); }
p, li { max-width: 78ch; } .klein { font-size: .85rem; color: var(--grau); } .hinweis { background: var(--flaeche); border-left: 4px solid var(--akzent); padding: 8px 12px; margin: 10px 0; max-width: 100ch; }
.warn { border-left-color: var(--warn); } .gut { color: var(--gut); font-weight: 600; } .schlecht { color: var(--warn); font-weight: 600; }
table { border-collapse: collapse; margin: 8px 0 14px; font-size: .86rem; } caption { text-align: left; font-weight: 600; padding: 4px 0; color: var(--grau); }
th, td { border: 1px solid var(--rand); padding: 3px 8px; vertical-align: top; } th { background: var(--flaeche); text-align: left; }
td.z, th.z { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.scroll { overflow-x: auto; max-width: 100%; }
figure { margin: 10px 0; } figure img { max-width: 100%; height: auto; border: 1px solid var(--rand); } figcaption { font-size: .82rem; color: var(--grau); margin-top: 3px; max-width: 90ch; }
.reihe { display: flex; gap: 14px; align-items: flex-start; overflow-x: auto; padding-bottom: 6px; } .reihe figure { flex: none; margin: 0; } .reihe img { max-width: none; }
nav ol { columns: 2; max-width: 780px; padding-left: 20px; } nav a { color: var(--akzent); text-decoration: none; } nav a:hover { text-decoration: underline; }
code, pre { font: .84rem/1.4 Consolas, "Courier New", monospace; background: var(--flaeche); } pre { padding: 10px; overflow-x: auto; max-height: 420px; }
details { margin: 8px 0; } summary { cursor: pointer; color: var(--akzent); }
@media print { main { max-width: none; } nav { display: none; } h2 { page-break-before: auto; } }
"""


def h(text: Any) -> str:
    return html.escape("" if text is None else str(text), quote=True)


def z(x: Any, stellen: int = 3) -> str:
    """Zahl mit Dezimalkomma; ``-`` für fehlende Werte."""
    if x is None or (isinstance(x, float) and not math.isfinite(x)):
        return "-"
    if isinstance(x, bool):
        return "ja" if x else "nein"
    if isinstance(x, int):
        return f"{x:,}".replace(",", " ")
    return f"{x:.{stellen}f}".replace(".", ",")


def prozent(x: Any, stellen: int = 1) -> str:
    return "-" if x is None or (isinstance(x, float) and not math.isfinite(x)) else f"{100 * x:.{stellen}f} %".replace(".", ",")


def sekunden(ms: Any, stellen: int = 1) -> str:
    return "-" if ms is None else z(float(ms) / 1000.0, stellen) + " s"


def urteil_klasse(wahr: bool | None) -> str:
    return "" if wahr is None else ("gut" if wahr else "schlecht")


def zelle(wert: Any, rechts: bool = False, klasse: str = "", roh: bool = False) -> str:
    cls = " ".join(c for c in (("z" if rechts else ""), klasse) if c)
    text = str(wert) if roh else h(wert)
    return f"<td{f' class=\"{cls}\"' if cls else ''}>{text}</td>"


def tabelle(kopf: Sequence[str], zeilen: Iterable[Sequence[Any]], rechts: Sequence[int] = (), titel: str = "", roh: Sequence[int] = ()) -> str:
    """Eine Tabelle; ``rechts`` nennt die Spalten, die rechtsbündig stehen (Zahlen), ``roh`` die, deren Inhalt schon HTML ist."""
    k = "".join(f"<th{' class=\"z\"' if i in rechts else ''}>{h(t)}</th>" for i, t in enumerate(kopf))
    z_ = []
    for r in zeilen:
        z_.append("<tr>" + "".join(zelle(c, i in rechts, roh=i in roh) for i, c in enumerate(r)) + "</tr>")
    cap = f"<caption>{h(titel)}</caption>" if titel else ""
    return f'<div class="scroll"><table>{cap}<thead><tr>{k}</tr></thead><tbody>{"".join(z_)}</tbody></table></div>'


def bild(png: bytes, alt: str, unterschrift: str = "", breite: int | None = None) -> str:
    stil = f' width="{breite}"' if breite else ""
    cap = f"<figcaption>{h(unterschrift)}</figcaption>" if unterschrift else ""
    return f'<figure><img src="{data_uri(png)}" alt="{h(alt)}"{stil}>{cap}</figure>'


def reihe(*figuren: str) -> str:
    return f'<div class="reihe">{"".join(figuren)}</div>'


def hinweis(text: str, warn: bool = False) -> str:
    return f'<div class="hinweis{" warn" if warn else ""}">{text}</div>'


def abschnitt(nr: int, kennung: str, titel: str, inhalt: str) -> str:
    return f'<section id="{h(kennung)}"><h2>{nr}  {h(titel)}</h2>{inhalt}</section>'


def seite(titel: str, untertitel: str, abschnitte: Sequence[tuple[str, str, str]], fuss: str = "") -> str:
    """Die ganze Seite. ``abschnitte`` = (Kennung, Titel, Inhalt als HTML)."""
    nav = "".join(f'<li><a href="#{h(k)}">{h(t)}</a></li>' for k, t, _ in abschnitte)
    teile = "".join(abschnitt(i + 1, k, t, inhalt) for i, (k, t, inhalt) in enumerate(abschnitte))
    return (
        f'<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{h(titel)}</title>'
        f"<style>{CSS}</style></head><body><main><header><h1>{h(titel)}</h1><p class=\"klein\">{h(untertitel)}</p></header><nav><ol>{nav}</ol></nav>{teile}"
        f'<footer class="klein"><hr>{h(fuss)}</footer></main></body></html>'
    )
