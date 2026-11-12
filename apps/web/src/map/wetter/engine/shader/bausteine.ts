/**
 * Die Bausteine der Wetter-Shader (WI-0288): Kopf, Vollbild-Dreieck und die Stücke, die mehrere Programme teilen. Der GLSL-Text steht
 * unverändert wie im Prototyp; 🪤 keine Backticks in GLSL-Kommentaren, sie beenden das Template-Literal (brach schon einmal den Vite-Parser).
 */

export const HEAD = `#version 300 es
precision highp float;precision highp int;precision highp sampler2D;precision highp sampler3D;
`;

export const VS_TRI =
    HEAD +
    `out vec2 vUV;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vUV=p;gl_Position=vec4(p*2.-1.,0.,1.);}`;

// Der Dunst der Wolken ist der Dunst der Karte (WI-0290, mit WI-0288 abgestimmt): uDunstL ist der Ton von Horizont und Dunst aus dem Kanon
// (atmosphere.skyHorizon), zurückgerechnet durch Belichtung und ACES, damit die fernen Wolken in denselben Ton laufen wie Gelände und Kulisse.
export const COMMON = `const float PI=3.14159265359;
uniform vec3 uEye,uSunDir,uSun,uAmbTop,uAmbBot,uDunstL;uniform mat4 uInvVP;uniform vec2 uSunH;uniform sampler2D uSky;
vec3 rayDir(vec2 n){vec4 f=uInvVP*vec4(n,1.,1.);return normalize(f.xyz/f.w-uEye);}
vec3 skyL(vec3 d){float y=clamp(d.y,0.,1.),l=length(d.xz),ca=l>1e-4?dot(d.xz/l,uSunH):1.;
 return textureLod(uSky,vec2(sqrt(acos(clamp(ca,-1.,1.))/PI),sqrt(asin(y)/(PI*.5))),0.).rgb;}
vec3 fogColor(vec3 rd){return uDunstL;}
`;

// Der Dunst des Geländes an einer Stelle der Welt, dieselbe Rechnung wie dunst-tiefe.ts, die Kulisse und MapLibres Nebel (WI-0290): uDZ die w-Zeile der
// Matrix, uDL nah, fern, beginn, Deckkraft. Das Wetter weicht ihm (Betreiber 2026-11-08: „auf distanz aus- und den dunst einzublenden“): uDW sind der
// Höchstwert des Dunsts und die Spanne seines Anteils daran, über die Wolken, Teilchen und Bodeneffekte vergehen (wetter-dunst.ts). dunstEnde ist der
// Abstand längs eines Strahls, ab dem von den Wolken nichts mehr übrig ist: Dort endet der Marsch durch die Wolken. uDC ist die eigene, kürzere Spanne der
// Wolken samt Schatten, Lichtstrahlen und Regenschleier (Betreiber 2026-11-09 „Ja, früher weg“).
export const DUNST = `uniform vec4 uDZ,uDL,uDF;uniform vec3 uDW;uniform vec2 uDC;
float dunstAnteil(vec3 p){if(uDL.w<=0.)return 0.;float w=dot(uDZ.xyz,p)+uDZ.w,tiefe=uDL.y/(uDL.y-uDL.x)*(1.-uDL.x/max(w,1e-3)),k=max(tiefe-uDL.z,0.)/(1.-uDL.z);return min(k*k*uDL.w,1.);}
float wetterSicht(vec3 p){return uDW.x<=0.?1.:1.-smoothstep(uDW.y,uDW.z,dunstAnteil(p)/uDW.x);}
float wolkenSicht(vec3 p){return uDW.x<=0.?1.:1.-smoothstep(uDC.x,uDC.y,dunstAnteil(p)/uDW.x);}
float dunstEnde(vec3 ro,vec3 rd){if(uDL.w<=0.||uDW.x<=0.)return 1e7;float kk=uDC.y*uDW.x/uDL.w;if(kk>=1.)return 1e7;
 float tiefe=uDL.z+sqrt(kk)*(1.-uDL.z),nenn=1.-tiefe*(uDL.y-uDL.x)/uDL.y;if(nenn<=1e-4)return 1e7;
 float w=uDL.x/nenn,w0=dot(uDZ.xyz,ro)+uDZ.w,dw=dot(uDZ.xyz,rd);return dw>1e-6?max((w-w0)/dw,0.):1e7;}
`;

export const SHADOWVIS = `uniform sampler2D uCloudShadow;uniform vec2 uShadowCtr;uniform float uShadowExt,uBase;
float cloudVis(vec3 p){vec2 q=p.xz+uSunDir.xz/max(uSunDir.y,.08)*(uBase-p.y);vec2 uv=(q-uShadowCtr)/uShadowExt+.5;
 vec2 e=smoothstep(vec2(0.),vec2(.05),uv)*(1.-smoothstep(vec2(.95),vec2(1.),uv));
 return mix(1.,textureLod(uCloudShadow,uv,0.).r,e.x*e.y);}
`;

// Rauschen in zufällig versetzten Waben: Wetterfeld, Wolkenform und Schneerand lesen den Rauschwürfel ohne Kachelmuster.
export const HEXN = `vec2 hexZufall(vec2 id){vec3 r=fract(vec3(id.xyx)*vec3(.1031,.1030,.0973));r+=dot(r,r.yzx+33.33);return fract((r.xx+r.yz)*r.zy);}
vec4 hexTex(sampler3D t,vec2 uv,float z,float lod,float sp){vec2 g=uv*2.;vec2 s=vec2(g.x,g.y*1.1547-g.x*.57735),b=floor(s),f=fract(s);float c=1.-f.x-f.y;vec3 w;vec2 v1,v2,v3;
 if(c>0.){w=vec3(c,f.y,f.x);v1=b;v2=b+vec2(0.,1.);v3=b+vec2(1.,0.);}else{w=vec3(-c,1.-f.y,1.-f.x);v1=b+vec2(1.,1.);v2=b+vec2(1.,0.);v3=b+vec2(0.,1.);}
 w=pow(w,vec3(sp));w/=w.x+w.y+w.z;
 if(w.x>.96)return textureLod(t,vec3(uv+hexZufall(v1),z).xzy,lod);if(w.y>.96)return textureLod(t,vec3(uv+hexZufall(v2),z).xzy,lod);if(w.z>.96)return textureLod(t,vec3(uv+hexZufall(v3),z).xzy,lod);
 const vec4 mw=vec4(.62,.45,.45,.45);vec4 n=w.x*(textureLod(t,vec3(uv+hexZufall(v1),z).xzy,lod)-mw)+w.y*(textureLod(t,vec3(uv+hexZufall(v2),z).xzy,lod)-mw)+w.z*(textureLod(t,vec3(uv+hexZufall(v3),z).xzy,lod)-mw);
 return clamp(mw+n/sqrt(dot(w,w)),0.,1.);}
`;

export const GUSTS = `uniform int uGN;uniform vec4 uG[8];uniform vec4 uGV[8];`;

export const HMAT = `uniform sampler2D uHM;vec4 hmAt(vec2 p){vec2 u=p/1024.;return (u.x<0.||u.x>1.||u.y<0.||u.y>1.)?vec4(0.):textureLod(uHM,u,0.);}`;

// Schneefallgrenze der Wegfindung (WI-0288 Stufe 5): je Klimazone ihre Grenze aus uSG, gewichtet mit dem weichgezeichneten Anteil der Zone an der
// Stelle (uKW0 bis uKW2, `uploadKlima`; Betreiber 2026-11-08: „der übergang der klima zonen ist ziemlich hart“). Kanal 0 ist „keine Zone“: dort gilt die eigene des Wetters.
export const SGRENZE = `uniform sampler2D uKW0,uKW1,uKW2;uniform vec4 uSG[3];
float sgW(float s,float eigene){return s<0.?eigene:s;}
float sgrenze(vec2 p,float eigene){vec2 u=clamp(p/1024.,0.,1.);vec4 a=texture(uKW0,u),b=texture(uKW1,u),c=texture(uKW2,u);float w=dot(a+b+c,vec4(1.));if(w<1e-3)return eigene;
 float s=a.x*eigene+a.y*sgW(uSG[0].y,eigene)+a.z*sgW(uSG[0].z,eigene)+a.w*sgW(uSG[0].w,eigene)+b.x*sgW(uSG[1].x,eigene)+b.y*sgW(uSG[1].y,eigene)+b.z*sgW(uSG[1].z,eigene)+b.w*sgW(uSG[1].w,eigene)
  +c.x*sgW(uSG[2].x,eigene)+c.y*sgW(uSG[2].y,eigene)+c.z*sgW(uSG[2].z,eigene)+c.w*sgW(uSG[2].w,eigene);return s/w;}
`;

// Das Wetterfeld an einer Stelle für Wolken und Niederschlag: das Grundfeld, darüber die feineren Fenster mit weichem Rand.
export const WETTERLESEN = `uniform sampler2D uW0,uW1,uW2;uniform vec3 uD0,uL1,uL2;uniform vec2 uLw;
vec4 weather(vec2 xz){vec4 w=textureLod(uW0,(xz-uD0.xy)/uD0.z,0.);
 if(uLw.x>0.){vec2 a=(xz-uL1.xy)/uL1.z+.5,ea=smoothstep(vec2(0.),vec2(.14),a)*(1.-smoothstep(vec2(.86),vec2(1.),a));float wa=ea.x*ea.y*uLw.x;
  if(wa>0.){w=mix(w,textureLod(uW1,a,0.),wa);if(uLw.y>0.){vec2 b=(xz-uL2.xy)/uL2.z+.5,eb=smoothstep(vec2(0.),vec2(.14),b)*(1.-smoothstep(vec2(.86),vec2(1.),b));float wb=eb.x*eb.y*uLw.y;if(wb>0.)w=mix(w,textureLod(uW2,b,0.),wb);}}}
 return w;}
`;
