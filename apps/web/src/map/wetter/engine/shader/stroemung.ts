import { HEAD, GUSTS } from "./bausteine";

/** Die Strömung der Luft und des Meeres: Wirbel, Antrieb, Druckschritt (Jacobi) und Projektion. */

// ---- Strömung: Luftschicht mit veränderlicher Tiefe (7,5 km je Zelle), Gelände lenkt und bremst, Symbole treiben an
export const FS_CURL =
    HEAD +
    `in vec2 vUV;out vec4 o;uniform sampler2D uVel;uniform vec2 uPx;uniform float uCell;
void main(){float a=texture(uVel,vUV+vec2(uPx.x,0.)).y-texture(uVel,vUV-vec2(uPx.x,0.)).y,b=texture(uVel,vUV+vec2(0.,uPx.y)).x-texture(uVel,vUV-vec2(0.,uPx.y)).x;o=vec4((a-b)/(2.*uCell));}`;

// Tiefe der Luftschicht je Zelle: R Tiefe (1 frei, klein am Fels), G Höhe in km, B Land. Wo die Schicht dünn wird, weicht die Strömung aus; sie läuft um Kämme und durch Pässe.
export const FS_TIEFE =
    HEAD +
    `in vec2 vUV;out vec4 o;uniform sampler2D uHM;uniform vec3 uD0;uniform float uLod,uSchicht;
void main(){vec2 u=(uD0.xy+vUV*uD0.z)/1024.;vec4 t=(u.x<0.||u.x>1.||u.y<0.||u.y>1.)?vec4(0.):textureLod(uHM,u,uLod);o=vec4(clamp(1.-t.r/uSchicht,.1,1.),t.r,t.a,1.);}`;

export const FS_VEL =
    HEAD +
    GUSTS +
    `in vec2 vUV;out vec4 o;uniform sampler2D uVel,uCurl,uTiefe;uniform vec3 uD0;uniform vec2 uPx;uniform float uDt,uT,uWindK,uConf,uCell,uWellen;
float bump(float x,float c,float w){x=(x-c)/w;return exp(-x*x);}
// Wandernde Wetterlage als drehende Welle: treibt die Luft auch dort über Land, wo die Gürtel schwach sind.
vec2 welle(vec2 p,float t,float n,float m,float w,float ph){float k=6.2832*n/uD0.z,l=6.2832*m/uD0.z,a=k*p.x-w*t+ph,b=l*p.y+ph*1.7,s=1./max(k,l);return vec2(l*s*sin(a)*cos(b),-k*s*cos(a)*sin(b));}
vec2 bg(vec2 p,float t){float lat=p.y/1024.;float U=-3.5*bump(lat,.02,.09)+9.*bump(lat,.33,.24)-7.5*bump(lat,.86,.2);
 float V=1.8*sin(p.x/1280.*12.566+t*.018+lat*9.)+1.1*sin(p.x/1280.*31.416-t*.026+lat*4.);return (vec2(U,V)+uWellen*(6.*welle(p,t,3.,4.,.03,.7)+4.*welle(p,t,5.,7.,.05,2.1)+3.*welle(p,t,2.,5.,-.02,4.3)))*uWindK;}
void main(){vec2 p=uD0.xy+vUV*uD0.z,v0=texture(uVel,vUV).xy;vec2 v=texture(uVel,vUV-v0*uDt/uD0.z).xy;
 v+=(bg(p,uT)-v)*(1.-exp(-uDt*.07));
 float cL=texture(uCurl,vUV-vec2(uPx.x,0.)).r,cR=texture(uCurl,vUV+vec2(uPx.x,0.)).r,cD=texture(uCurl,vUV-vec2(0.,uPx.y)).r,cU=texture(uCurl,vUV+vec2(0.,uPx.y)).r,c=texture(uCurl,vUV).r;
 vec2 e=vec2(abs(cR)-abs(cL),abs(cU)-abs(cD));v+=uConf*uCell*vec2(e.y,-e.x)/(length(e)+1e-3)*c*uDt;
 for(int i=0;i<uGN;i++){vec2 d=p-uG[i].xy;d-=uD0.z*round(d/uD0.z);float f=exp(-dot(d,d)/(uG[i].z*uG[i].z));
  if(uGV[i].z==0.)v+=(uGV[i].xy-v)*(1.-exp(-uDt*1.1))*f;else v+=uGV[i].z*vec2(-d.y,d.x)*f*uDt;}
 vec4 t=texture(uTiefe,vUV);v*=exp(-uDt*(1.6*(1.-smoothstep(.1,.35,t.r))+.03*t.b));
 o=vec4(clamp(v,vec2(-32.),vec2(32.)),0.,1.);}`;

export const FS_DIV =
    HEAD +
    `in vec2 vUV;out vec4 o;uniform sampler2D uVel,uTiefe;uniform vec2 uPx;uniform float uCell;
float F(vec2 uv,int c){return texture(uVel,uv)[c]*texture(uTiefe,uv).r;}
void main(){o=vec4((F(vUV+vec2(uPx.x,0.),0)-F(vUV-vec2(uPx.x,0.),0)+F(vUV+vec2(0.,uPx.y),1)-F(vUV-vec2(0.,uPx.y),1))/(2.*uCell));}`;

// Kantengewichte des Druckschritts (Ost, West, Nord, Süd) als Tafel: Sie ändern sich nur mit der Luftschicht, der Schritt liest dann sechs statt zehn Werte und rechnet dieselbe Formel.
export const FS_GEWICHT =
    HEAD +
    `in vec2 vUV;out vec4 o;uniform sampler2D uTiefe;uniform vec2 uPx;
void main(){vec2 a=vec2(uPx.x,0.),b=vec2(0.,uPx.y);float d=texture(uTiefe,vUV).r;o=vec4(d+texture(uTiefe,vUV+a).r,d+texture(uTiefe,vUV-a).r,d+texture(uTiefe,vUV+b).r,d+texture(uTiefe,vUV-b).r);}`;

export const FS_JAC =
    HEAD +
    `out vec4 o;uniform sampler2D uP,uDiv,uW;uniform int uN,uWrap;uniform float uCell;
ivec2 q(ivec2 x){return uWrap==1?(x&(uN-1)):clamp(x,ivec2(0),ivec2(uN-1));}
void main(){ivec2 x=ivec2(gl_FragCoord.xy);vec4 k=texelFetch(uW,x,0);float e=k.x,w=k.y,n=k.z,s=k.w;
 o=vec4((e*texelFetch(uP,q(x+ivec2(1,0)),0).r+w*texelFetch(uP,q(x-ivec2(1,0)),0).r+n*texelFetch(uP,q(x+ivec2(0,1)),0).r+s*texelFetch(uP,q(x-ivec2(0,1)),0).r-2.*texelFetch(uDiv,x,0).r*uCell*uCell)/(e+w+n+s));}`;

export const FS_PROJ =
    HEAD +
    `in vec2 vUV;out vec4 o;uniform sampler2D uVel,uP;uniform vec2 uPx;uniform float uCell;
void main(){vec2 g=vec2(texture(uP,vUV+vec2(uPx.x,0.)).r-texture(uP,vUV-vec2(uPx.x,0.)).r,texture(uP,vUV+vec2(0.,uPx.y)).r-texture(uP,vUV-vec2(0.,uPx.y)).r)/(2.*uCell);o=vec4(texture(uVel,vUV).xy-g,0.,1.);}`;

// ---- Meeresströmung: eigene flache Rechnung auf 512² (9 km je Zelle). Das Land ist Wand, die Symbole treiben, Rückströmungen entstehen von selbst.
export const FS_MEERTIEFE =
    HEAD +
    `in vec2 vUV;out vec4 o;uniform sampler2D uHM;uniform vec3 uD0;
void main(){vec2 u=(uD0.xy+vUV*uD0.z)/1024.;float land=(u.x<0.||u.x>1.||u.y<0.||u.y>1.)?0.:textureLod(uHM,u,2.).a;o=vec4(mix(1.,.02,smoothstep(.35,.65,land)),0.,0.,1.);}`;

/**
 * Das Feld der Meeresströmung. Eine Strömung (`uMV.z == 0`) zieht das Wasser zu ihrer Geschwindigkeit `uMV.xy`, unverändert. Ein Mahlstrom (`uMV.z` = Drehsinn mal
 * Stärke, `uMV.w` = Stärke; WI-0288, Betreiber 2026-11-08) ist ein Strudel: Seine Zielgeschwindigkeit dreht das Wasser wie einen starren Körper um die Mitte (am Rand der
 * Reichweite genau die Stärke) und zieht es leicht nach innen. Eine Zielgeschwindigkeit statt eines Aufsummierens bleibt stabil, auch bei langem Schritt.
 */
export const FS_MEER =
    HEAD +
    `in vec2 vUV;out vec4 o;uniform sampler2D uVel,uTiefe;uniform vec3 uD0;uniform float uDt;uniform int uMN;uniform vec4 uM[8];uniform vec4 uMV[8];
void main(){vec2 p=uD0.xy+vUV*uD0.z,v0=texture(uVel,vUV).xy,v=texture(uVel,vUV-v0*uDt/uD0.z).xy;v*=exp(-uDt*.05);
 for(int i=0;i<uMN;i++){vec2 d=p-uM[i].xy;float f=exp(-dot(d,d)/(uM[i].z*uM[i].z));
  if(uMV[i].z==0.){v+=(uMV[i].xy-v)*(1.-exp(-uDt*1.2))*f;}
  else{vec2 t=(uMV[i].z*vec2(-d.y,d.x)-.25*uMV[i].w*d)/uM[i].z;v+=(t-v)*(1.-exp(-uDt*1.2))*f;}}
 v*=smoothstep(.1,.9,texture(uTiefe,vUV).r);o=vec4(clamp(v,vec2(-20.),vec2(20.)),0.,1.);}`;
