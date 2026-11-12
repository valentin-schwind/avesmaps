import { DUNST, HEAD, WETTERLESEN, SGRENZE } from "./bausteine";

/** Windpartikel (Stromlinien) und Niederschlag (Regen und Schnee). */

// ---- Partikel: je Stufe ein Schwarm auf der GPU, sichtbar nach Zoom
export const FS_PART =
    HEAD +
    `in vec2 vUV;out vec4 o;uniform sampler2D uPrev,uVel,uHM;uniform vec3 uD0,uEye;uniform float uDt,uT,uNeu,uZug,uNurMeer,uSaat;uniform mat4 uVP,uInvVP;
vec3 rnd(vec2 q){vec3 r=fract(vec3(q.xyx)*vec3(.1031,.1030,.0973));r+=dot(r,r.yxz+33.33);return fract((r.xxy+r.yzz)*r.zyx);}
bool aufLand(vec2 p){vec2 u=p/1024.;return uNurMeer>.5&&u.x>=0.&&u.x<=1.&&u.y>=0.&&u.y<=1.&&textureLod(uHM,u,1.).a>.5;}
void main(){vec4 s=texelFetch(uPrev,ivec2(gl_FragCoord.xy),0);s.xy+=textureLod(uVel,(s.xy-uD0.xy)/uD0.z,0.).xy*uDt*uZug;s.z+=uDt;vec4 c=uVP*vec4(s.x,0.,s.y,1.);
 if(s.z>s.w||c.w<=0.||abs(c.x)>1.15*c.w||abs(c.y)>1.15*c.w||aufLand(s.xy)||rnd(gl_FragCoord.yx+uSaat+fract(uT*.311)*311.).x<uNeu){vec3 r=rnd(gl_FragCoord.xy+uSaat+fract(uT*.137)*917.);vec4 f=uInvVP*vec4((r.xy*2.-1.)*1.1,1.,1.);vec3 d=f.xyz/f.w-uEye;s.w=mix(5.,16.,r.z);
  if(d.y<-1e-5){s.xy=uEye.xz+d.xz*(-uEye.y/d.y);s.z=uDt>0.?0.:s.w*.5;}else{s.xy=uEye.xz;s.z=s.w+1.;}}
 o=s;}`;

// Stromlinie je Partikel: vom Kopf aus zehn Schritte gegen den Wind, dicht am Gelände; so sieht man, wie die Luft einem Kamm ausweicht oder über ihn steigt.
export const VS_SEG =
    HEAD +
    DUNST +
    `uniform sampler2D uPart,uVel,uHM;uniform mat4 uVP;uniform vec2 uRes;uniform vec3 uD0;uniform float uW,uTrail,uHS,uA,uMitte,uFarbe,uMinTempo;out float vA,vS,vH;
const int N=10;
vec2 wind(vec2 p){return textureLod(uVel,(p-uD0.xy)/uD0.z,0.).xy;}
bool draussen(vec2 u){return u.x<0.||u.x>1.||u.y<0.||u.y>1.;}
vec3 boden(vec2 p){vec2 u=p/1024.;return vec3(p.x,(draussen(u)?0.:max(textureLod(uHM,u,0.).r,0.))*(1000./3000.)*uHS+.25,p.y);}
void weg(){gl_Position=vec4(2.,2.,2.,1.);vA=0.;vS=0.;vH=0.;}
void main(){vec4 st=texelFetch(uPart,ivec2(gl_InstanceID%256,gl_InstanceID/256),0);int seg=gl_VertexID/6,i=gl_VertexID%6;bool isB=(i==1||i==2||i==4);float sd=(i==0||i==1||i==3)?-1.:1.;
 vec4 k=uVP*vec4(boden(st.xy),1.);if(k.w<.01){weg();return;}
 float ds=uTrail*sqrt(length(wind(st.xy))*10.)*k.w/uMitte/float(N);
 vec2 p=st.xy;for(int n=0;n<seg;n++){vec2 w=wind(p);p-=w/(length(w)+1e-4)*ds;}
 vec2 w=wind(p),q=p-w/(length(w)+1e-4)*ds;
 vec4 a=uVP*vec4(boden(p),1.),b=uVP*vec4(boden(q),1.);if(a.w<.01||b.w<.01){weg();return;}
 vec2 d=(b.xy/b.w-a.xy/a.w)*uRes*.5;float l=length(d);d=l>1e-4?d/l:vec2(1.,0.);vec4 c=isB?b:a;c.xy+=vec2(-d.y,d.x)*uW/uRes*sd*c.w;gl_Position=c;
 vec2 e=isB?q:p,u=e/1024.;vH=draussen(u)?0.:clamp(dot(wind(e),textureLod(uHM,u,3.).gb)*3.*uFarbe,-1.,1.);
 vS=sd;vA=pow(1.-(float(seg)+(isB?1.:0.))/float(N),.6)*sin(3.1416*clamp(st.z/st.w,0.,1.))*uA*(uMinTempo>0.?smoothstep(uMinTempo*.15,uMinTempo,length(wind(st.xy))):1.)*wetterSicht(boden(st.xy));}`;

// Heller Kern mit dunklem Saum: bleibt auf Meer, Wald, Wüste und Schnee gleich gut lesbar.
export const FS_SEG =
    HEAD +
    `in float vA,vS,vH;out vec4 o;uniform vec3 uTon;void main(){float s=abs(vS),kern=1.-smoothstep(.28,.5,s),a=clamp(vA,0.,1.)*mix(.35*(1.-smoothstep(.6,1.,s)),1.,kern);vec3 hell=vH>0.?mix(uTon,vec3(1.,.55,.12),vH):mix(uTon,vec3(.22,.62,1.),-vH);o=vec4(mix(vec3(.03,.07,.13),hell,kern)*a,a);}`;

// ---- Regen und Schnee: Jedes Teilchen fällt einmal von der Wolkenbasis zum Boden und taucht danach woanders auf. Das Raster verdoppelt sich mit dem Zoom und blendet über, damit nichts beim Zoomen schwimmt.
export const VS_NS =
    HEAD +
    DUNST +
    WETTERLESEN +
    SGRENZE +
    `uniform sampler2D uHM,uVel;uniform mat4 uVP;uniform vec2 uRes,uCam;uniform float uExt,uFade,uUhr,uK,uTN,uTS,uA,uGross,uMass,uMitte;out vec2 vP;out float vA,vS,vR;
vec4 zufall(float i,float s){vec4 r=fract(vec4(i,i+s,i-s,s)*vec4(.1031,.1030,.0973,.1099));r+=dot(r,r.wzxy+33.33);return fract((r.xxyz+r.yzzw)*r.zywx);}
void weg(){gl_Position=vec4(2.,2.,2.,1.);vP=vec2(0.);vA=0.;vS=0.;vR=0.;}
void main(){float id=float(gl_InstanceID)+uExt;vec4 h=zufall(id,7.);bool schnee=h.w>.55;float dauer=schnee?mix(3.,5.5,h.y):mix(.45,.7,h.y),lauf=uUhr/dauer+h.x,phase=fract(lauf);vec4 r=zufall(id,floor(lauf)+11.);
 vec2 p=uCam+(fract(r.xy-uCam/uExt)-.5)*uExt;vec4 w=weather(p);if(r.z>=clamp(w.a*2.5,0.,1.)){weg();return;}
 vec2 u=p/1024.;bool drin=u.x>=0.&&u.x<=1.&&u.y>=0.&&u.y<=1.;float km=drin?max(textureLod(uHM,u,2.).r,0.):0.,T0=mix(uTN,uTS,clamp(u.y,0.,1.));if(schnee!=(km*1000.>=sgrenze(p,T0/6.5*1000.-250.))){weg();return;}
 float boden=km*uK,hoch=max(w.g/3.-boden,uExt*.02);vec2 v=textureLod(uVel,(p-uD0.xy)/uD0.z,0.).xy,schraeg=clamp(v*(schnee?.16:.07),vec2(-2.),vec2(2.));
 vec2 q=p+schraeg*hoch*(phase-.5);if(schnee)q+=vec2(sin(uUhr*1.7+r.w*6.28),cos(uUhr*1.3+r.w*9.))*hoch*.03;
 float lang=uExt*(schnee?.001:.011*uGross);vec3 kopf=vec3(q.x,boden+hoch*(1.-phase),q.y),ende=kopf+vec3(-schraeg.x*lang,lang,-schraeg.y*lang);
 vec4 a=uVP*vec4(kopf,1.),b=uVP*vec4(ende,1.);if(a.w<.01||b.w<.01){weg();return;}
 vec2 d=(b.xy/b.w-a.xy/a.w)*uRes*.5;float l=length(d);d=l>1e-3?d/l:vec2(0.,1.);int i=gl_VertexID%6;bool isB=(i==1||i==2||i==4);float sd=(i==0||i==1||i==3)?-1.:1.,roh=(schnee?(3.5+3.*r.w)*uGross*clamp(uMitte/a.w,.7,3.):1.+.6*r.w)*uMass,breit=max(roh,1.);
 vec4 c=schnee?a:(isB?b:a);vec2 versatz=vec2(-d.y,d.x)*sd+(schnee?d*(isB?1.:-1.):vec2(0.));c.xy+=versatz*breit*2./uRes*c.w;gl_Position=c;
 vP=vec2(isB?1.:-1.,sd);vS=schnee?1.:0.;vR=r.w*6.28+uUhr*(h.z-.5)*1.2;vA=uA*uFade*smoothstep(0.,.08,phase)*(1.-smoothstep(.9,1.,phase))*(schnee?.95:.75)*min(roh*roh,1.)*wetterSicht(kopf);}`;

// Flocke: sechs Arme mit Ästen und kleinem Sechseck in der Mitte; aus der Ferne wird daraus ein weicher Punkt.
export const FS_NS =
    HEAD +
    `in vec2 vP;in float vA,vS,vR;out vec4 o;
float strecke(vec2 p,vec2 a,vec2 b){vec2 ab=b-a,ap=p-a;return length(ap-ab*clamp(dot(ap,ab)/dot(ab,ab),0.,1.));}
void main(){float a;vec3 c;if(vS>.5){float rr=length(vP),aa=fwidth(vP.x)*1.2,wk=atan(vP.y,vP.x)+vR;wk=mod(wk+.5236,1.0472)-.5236;vec2 q=rr*vec2(cos(wk),abs(sin(wk)));
 float e=min(strecke(q,vec2(0.),vec2(.92,0.)),min(strecke(q,vec2(.5,0.),vec2(.74,.2)),abs(dot(q,vec2(.866,.5))-.28)));a=mix(1.-smoothstep(.1,.1+aa,e),(1.-smoothstep(.15,1.,rr))*.85,smoothstep(.24,.5,aa));c=vec3(.97,.98,1.);}
 else{a=(1.-smoothstep(.1,1.,abs(vP.y)))*pow(.5-.5*vP.x,.7);c=vec3(.78,.87,1.);}a*=clamp(vA,0.,1.);o=vec4(c*a,a);}`;
