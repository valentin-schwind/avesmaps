/**
 * Die Shader des Wassers in 3D (WI-0288 Stufe 5, `wasser-ebene.ts`). Die Wellen sind die des Prototyps (`project-control/discovery/wi-0288-wetter-messung/README.md`,
 * bis Stufe 4 im Bodenpass der Engine): Wellenzüge mit scharfen Kämmen, verbogen von einem glatten Zellrauschen wie in der Engine
 * (`wasser-rauschen.ts`; ein Zufallswert je Bildpunkt faltete sie zu Marmor, 2026-11-09); was kleiner als ein paar Bildpunkte
 * wäre, wird nicht gezeichnet, sondern als Rauheit weitergegeben. Aus der Ferne bleibt ein breiter Glanz, aus der Nähe glitzert es.
 *
 * - **Licht ohne Wetter:** Der Himmel, den das Wasser spiegelt, sind die Kanontöne der Atmosphäre (`DESIGN_CANON.atmosphere`), vom
 *   Horizont zum Zenit; die Sonne ein warmes Weiß. Gerechnet wird in den Farben des Bildschirms, nicht im Licht der Engine.
 * - **Zusammensetzen** wie die Engine: Farbe dazu, die Karte darunter mit dem Rest (`ONE, SRC_ALPHA`). Gedeckt wird höchstens 85 %.
 * - **Tiefe:** Das Wasser rückt um einen kleinen Betrag zur Kamera (`TIEFE_VOR`), sonst flimmerte es mit dem Gelände gleicher Höhe.
 *
 * 🪤 In den Vorlagen unten keine Backticks, auch nicht in Kommentaren: Sie beenden die Zeichenkette.
 */

export const WASSER_VS = `#version 300 es
precision highp float;
layout(location=0) in vec4 aEcke;
uniform mat4 uVP;
uniform float uK;
out vec3 vW;
flat out float vArt;
const float TIEFE_VOR=2e-4;
void main(){
 vW=vec3(aEcke.x,aEcke.z*uK,aEcke.y);
 vArt=aEcke.w;
 gl_Position=uVP*vec4(vW,1.);
 gl_Position.z-=TIEFE_VOR*gl_Position.w;
}`;

export const WASSER_FS = `#version 300 es
precision highp float;
in vec3 vW;
flat in float vArt;
uniform sampler2D uMaske,uRauschen;
uniform vec3 uAuge,uSonne,uZenit,uHorizont;
uniform float uZeit,uGlanz,uPunkt,uStaerke,uPixAng,uLicht;
uniform int uWellen;
out vec4 o;
// Summe der Amplituden aller 18 Wellenzuege des Prototyps (0,84 je Stufe): Was nicht gezeichnet wird, zaehlt als Rauheit.
const float GESAMT=5.979;
// Wie steil die Wellen das Licht kippen (der Prototyp: 0,16 bei Flaute bis 0,42 bei Sturm), wie hell die Sonne glitzert, wie stark Hänge
// zur Sonne heller und von ihr weg dunkler werden und wie breit der Glanz nah und fern ist. Dazu biegt das Rauschen die Wellen mit 0,45 der
// Stärke der Engine (1,35 und 0,1125 statt 3 und 0,25). Werte des Betreibers aus dem Regler-Entwurf (2026-11-09); GLANZ und GLANZ_NAH/GLANZ_FERN tragen seine Standardwerte
// 1,05 und Glanzpunkt 0,6 (Exponent geteilt durch 0,6²), damit die Standardwerte bei 1 sein Bild zeigen.
const float NEIGUNG=.19,SONNE=15.5,HANG_HELL=.32,HANG_DUNKEL=.25,GLANZ=1.05,GLANZ_NAH=500./.36,GLANZ_FERN=145./.36;
vec3 wellen(vec2 p,float fuss){
 p+=(texture(uRauschen,p*.017).rg-.5)*1.35+(texture(uRauschen,p*.11).rg-.5)*.1125;
 vec2 s=vec2(0.);float a=1.,f=7.,win=1.1,sichtbar=0.;
 for(int i=0;i<18;i++){
  if(i>=uWellen)break;
  float sicht=smoothstep(2.,6.,6.283/f/fuss);
  if(sicht<.001)break;
  vec2 d=vec2(cos(win),sin(win));float x=dot(d,p)*f+uZeit*sqrt(f)*.5,de=exp(sin(x)-1.)*cos(x);
  s+=d*de*a*sicht;sichtbar+=a*sicht;p-=d*de*a*.5/f;
  a*=.84;f*=1.27;win+=2.399;
 }
 return vec3(s/GESAMT*3.,1.-sichtbar/GESAMT);
}
void main(){
 vec2 m=texture(uMaske,vW.xz/1024.).rg;float c=vArt<.5?m.r:m.g,w=fwidth(c)*.75+1e-4,deck=smoothstep(.5-w,.5+w,c);
 if(deck<=.001)discard;
 float G=uGlanz*GLANZ;vec3 rd=vW-uAuge;float dist=length(rd);rd/=dist;
 vec3 wl=wellen(vW.xz,dist*uPixAng+.0012);
 vec3 nw=normalize(vec3(-wl.x*NEIGUNG,1.,-wl.y*NEIGUNG));
 float shin=mix(GLANZ_NAH,GLANZ_FERN,sqrt(wl.z))/(uPunkt*uPunkt),cv=max(dot(nw,-rd),0.),F=(.02+.98*pow(1.-cv,5.))*min(G,2.);
 float sp=min(pow(max(dot(nw,normalize(uSonne-rd)),0.),shin)*(shin+8.)*.0016*mix(1.,.12,wl.z),.07)*G*uLicht;
 vec2 sh=normalize(uSonne.xz+vec2(1e-5));float rl=dot(nw.xz,sh);
 vec3 re=reflect(rd,nw);re.y=abs(re.y);
 vec3 himmel=mix(uHorizont,uZenit,sqrt(clamp(re.y,0.,1.)));
 float k=deck*uStaerke,decke=min(F,.85)*k;
 vec3 farbe=himmel*decke+vec3(1.,.96,.88)*sp*SONNE*k+uZenit*max(rl,0.)*HANG_HELL*G*uLicht*k;
 o=vec4(farbe,(1.-decke)*(1.-max(-rl,0.)*HANG_DUNKEL*min(G,1.5)*k));
}`;
