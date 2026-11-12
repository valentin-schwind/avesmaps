/**
 * Die Shader der Kulisse (WI-0290, `kulisse.ts`): ein Bild über den ganzen Schirm, je Bildpunkt ein Strahl.
 *
 * - **Über dem Horizont** der Himmel in zwei Tönen: Dunst am Horizont, über `uVerlauf` (Sinus des Blickwinkels) ins Blau oben.
 * - **Unter dem Horizont** liegt jenseits der Karte eine Fläche auf Höhe 0 bis zum Horizont. Innerhalb der Karte deckt sie das Gelände.
 * - **Dunst** genau nach MapLibres Nebel auf dem Gelände (Shader `terrain` in maplibre-gl): Tiefe aus der Nebelmatrix (nah = Abstand zur
 *   Meereshöhe, fern = `farZ`), ab `beginn` quadratisch zum Dunstton, mal der Deckkraft aus der Neigung. So trägt die Fläche am
 *   Kartenrand denselben Dunst wie das Gelände daneben. 🔴 Dieselbe Rechnung steht in `dunst-tiefe.ts` (TS, für Icons und Kulisse) und
 *   als `DUNST` in `wetter/engine/shader/bausteine.ts` (Wolken, Teilchen, Bodeneffekte): eine Änderung an allen dreien zugleich.
 * - **Randblende** (`uRand` > 0): dieselbe Rechnung als zweite Ebene über dem Gelände; über die letzten `uRand` Karteneinheiten läuft die
 *   Karte in die Fläche aus.
 *
 * 🪤 In den Vorlagen unten keine Backticks, auch nicht in Kommentaren: Sie beenden die Zeichenkette.
 */

export const KULISSE_VS = `#version 300 es
out vec2 vUV;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vUV=p;gl_Position=vec4(p*2.-1.,1.,1.);}`;

export const KULISSE_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 o;
uniform mat4 uInvVP;
uniform vec4 uTiefe;
uniform vec3 uAuge,uDunst,uZenit,uMeer;
uniform float uVerlauf,uRand;
uniform vec4 uNebel;
vec3 lin(vec3 c){return pow(c,vec3(2.2));}
vec3 gam(vec3 c){return pow(max(c,0.),vec3(1./2.2));}
void main(){
 vec4 f=uInvVP*vec4(vUV*2.-1.,1.,1.);
 vec3 rd=normalize(f.xyz/f.w-uAuge),c;
 float a=1.;
 if(rd.y>=0.){
  if(uRand>0.)discard;
  c=mix(uDunst,uZenit,pow(clamp(rd.y/uVerlauf,0.,1.),.7));
 }else{
  vec3 p=uAuge+rd*(-uAuge.y/rd.y);
  if(uRand>0.){vec2 q=min(p.xz,1024.-p.xz);a=1.-smoothstep(0.,uRand,min(q.x,q.y));if(a<=0.)discard;}
  float w=dot(uTiefe.xyz,p)+uTiefe.w,tiefe=uNebel.y/(uNebel.y-uNebel.x)*(1.-uNebel.x/max(w,1e-3));
  float k=max(tiefe-uNebel.z,0.)/(1.-uNebel.z);
  c=gam(mix(lin(uMeer),lin(uDunst),min(k*k*uNebel.w,1.)));
 }
 o=vec4(c*a,a);
}`;
