import { HEAD, HEXN, GUSTS, HMAT, SGRENZE } from "./bausteine";

/** Die Wetterstufen, die Schneedecke und das Nachziehen der feinen Fenster. */

// ---- Wetterstufe (eine Fassung für alle drei). Anzeige A: Wolkenwasser g/kg, Basis km, Oberkante km, Regen. Zustand Z: Dampf g/kg, Temperatur auf Meereshöhe bezogen (°C), mitgeführte Struktur, Hebung km.
// Luft steigt am Gelände, in Wirbeln und an Fronten, kühlt mit 9,8 °C je km, kondensiert über der Sättigung und erwärmt sich dabei. Was abregnet, fehlt beim Absinken: Dahinter ist es trockener und wärmer (Föhn).
export const FS_WX =
    HEAD +
    HEXN +
    GUSTS +
    `in vec2 vUV;layout(location=0)out vec4 oA;layout(location=1)out vec4 oZ;layout(location=2)out vec4 oV;uniform sampler2D uPrevA,uPrevZ,uParA,uParZ,uVel,uCurl,uHM,uVeg;uniform sampler3D uNBase;uniform vec3 uD0,uPar;uniform vec2 uC,uOfs;uniform float uKern,uAuge,uE,uDt,uT,uTN,uTS,uEvap,uEvapMeer,uOro,uRegen,uFront,uTief,uFeucht,uMacht,uMF,uMR,uStart,uLodH,uCellW;uniform int uLevel;
float qs(float T,float z){return 3.8*exp(17.27*T/max(T+237.3,40.))*exp(z/8.);}
float glocke(float x,float c,float w){x=(x-c)/w;return exp(-x*x);}
float tl(vec2 q){return textureLod(uPrevZ,q,0.).g-2.5*textureLod(uPrevA,q,0.).r;}
void main(){vec2 p=uC+(vUV-.5)*uE,uv0=(p-uD0.xy)/uD0.z,v=textureLod(uVel,uv0,0.).xy,v0=v;float conv=0.,daempf=1.,klar=0.,zufuhr=0.,trichter=1.,wz=textureLod(uCurl,uv0,0.).r;
 for(int i=0;i<uGN;i++){if(uGV[i].z==0.)continue;vec2 d=p-uG[i].xy;d-=uD0.z*round(d/uD0.z);float r=uG[i].z,rr=dot(d,d)/(r*r),x=sqrt(rr),f=exp(-rr),S=uGV[i].w,dreh=sign(uGV[i].z),th=atan(d.y,d.x),arm=smoothstep(-.15,.75,cos(2.*th+dreh*(5.*log(x+.08)-uT*.15))),xa=.045*uAuge*smoothstep(11.,16.,S)*(1.+.05*sin(3.*th+uT*.2)+.03*sin(5.*th-uT*.31)),kern=uKern*(1.-smoothstep(.25,.9,x)),xw=(x<.4&&wz*dreh>0.)?2.*length(v0)/abs(wz)/r:x,q=(xw-xa*1.5)/(max(xa,.01)*.6),wand=xa>.005?exp(-q*q):0.,loch=xa>.005?1.-smoothstep(xa*.8,xa*1.2,xw):0.;if(xa>.005)trichter=min(trichter,smoothstep(xa*.9,xa*2.4,xw));
  v-=d/r*S*.3*f*smoothstep(xa,xa*2.+.001,xw);conv+=S*(.034*f*mix(arm*2.1-.5,.7+.6*arm,kern)+.025*wand);daempf*=1.-f*.85;klar=max(klar,loch);zufuhr=max(zufuhr,kern);}
 vec2 uh=vUV-v*uDt/uE;vec4 a=textureLod(uPrevA,uh,0.),s=textureLod(uPrevZ,uh,0.),pz=vec4(0.);
 if(uLevel>0){vec2 ep=(p-uPar.xy)/uPar.z+.5;vec4 pa=textureLod(uParA,ep,0.);pz=textureLod(uParZ,ep,0.);vec2 eg=smoothstep(vec2(0.),vec2(.06),vUV)*(1.-smoothstep(vec2(.94),vec2(1.),vUV));float k=eg.x*eg.y,n=1.-exp(-uDt*.12);a=mix(pa,a,k);s=mix(pz,s,k);a.r=mix(a.r,pa.r,n);s.rg=mix(s.rg,pz.rg,n);}
 vec2 u=p/1024.;bool im=u.x>=0.&&u.x<=1.&&u.y>=0.&&u.y<=1.;vec4 t=im?textureLod(uHM,u,max(uLodH,4.)):vec4(0.);vec2 gm=im?textureLod(uHM,u,4.).gb:vec2(0.);
 float lat=clamp(p.y/1024.,-.1,1.1),Teq=mix(uTN,uTS,lat),land=t.a,h=max(t.r,0.)*uOro;
 if(uStart>.5){s=vec4(uFeucht*qs(Teq,0.),Teq,.42,0.);a=vec4(0.,1.,1.,0.);}
 s.g+=(Teq-s.g)*(1.-exp(-uDt*mix(.07,.04,land)));
 // Wie viel Wasser das Land hergibt, sagt die Vegetation (Faktor 0 bis 1): Wüste kaum, Wald viel, Sumpf fast wie offenes Wasser. Dschungel und Sumpf kommen nahe ans Meer heran (0,07), Land ohne Fläche (0,56) liegt bei 0,033 statt früher 0,02.
 float veg=im?textureLod(uVeg,u,0.).r:.56;
 s.r+=max(uFeucht*mix(1.,.2+.8*veg,land)*qs(Teq-6.5*h,h)-s.r,0.)*(1.-exp(-uDt*mix(.07*uEvapMeer,.07*pow(veg,1.3)*uEvap,land)*(1.+6.*zufuhr)));
 vec2 pw=p-uOfs;float n=pz.b;if(uLevel==0){vec4 nn=hexTex(uNBase,pw*uMF,.37,1.,1.5),nm=hexTex(uNBase,vec2(pw.x*.8-pw.y*.6,pw.x*.6+pw.y*.8)*uMF*1.63,.71,1.,1.5);n=(nn.g*.5+nn.b*.3+nn.a*.2)*.6+(nm.g*.5+nm.b*.3+nm.a*.2)*.4;}float big=textureLod(uNBase,vec3(pw/733.,.61),2.).g*.6+textureLod(uNBase,vec3(vec2(pw.x*.8-pw.y*.6,pw.x*.6+pw.y*.8)/457.,.23),2.).g*.4;
 s.b+=(n-s.b)*(1.-exp(-uDt*uMR));
 float dg=24./uE;vec2 gt=vec2(tl(vUV+vec2(dg,0.))-tl(vUV-vec2(dg,0.)),tl(vUV+vec2(0.,dg))-tl(vUV-vec2(0.,dg)))/48.;
 float w=uTief*.35*(-textureLod(uCurl,uv0,0.).r)*daempf*mix(.55,1.45,smoothstep(.32,.5,s.b))+uFront*.3*clamp(-dot(v,gt),-.8,.8)+conv-.13*glocke(lat,.62,.1)+.07*glocke(lat,.3,.14)+.05*glocke(lat,.97,.09);
 s.a=clamp(s.a+(w*(1.-klar)-s.a/8.)*uDt,-1.5,7.);
 if(klar>0.){float k=1.-exp(-uDt*6.*klar);s.a=mix(s.a,-1.5,k);s.g=mix(s.g,Teq+10.,k);a.r*=1.-k;}
 float z=h+.8+max(s.a,-.7)+(s.b-.42)*.6+(big-.42)*.5,T=s.g-9.8*z,Q=qs(T,z),gam=2.5*.0655*Q,dc=s.r>Q?(s.r-Q)/(1.+gam):-min(a.r,(Q-s.r)/(1.+gam));
 s.r-=dc;a.r+=dc;s.g+=2.5*dc;
 if(uLevel==0){vec2 e=vec2(uCellW/uE,0.);float m=(textureLod(uPrevA,uh+e,0.).r+textureLod(uPrevA,uh-e,0.).r+textureLod(uPrevA,uh+e.yx,0.).r+textureLod(uPrevA,uh-e.yx,0.).r)*.25;a.r=max(mix(a.r,m,min(.22,8.*uDt/(uCellW*uCellW)*clamp(a.b/5.,.1,1.))),0.);}
 float pr=uRegen*1.2*max(a.r-.5,0.),fall=min(pr*uDt,a.r);a.r-=fall;s.r+=fall*.15;a.a+=(pr-a.a)*(1.-exp(-uDt*2.));
 float qt=s.r+a.r,x=log(max(qt,.05)/3.8),Td=237.3*x/(17.27-x),base=max((s.g-2.5*a.r-Td)/8.,h+.1);
 float ziel=base+(1.2+1.6*min(a.r,3.))*uMacht+1.6*max(s.a,0.)+3.*max(dot(v,gm),0.)*uOro*uMacht;
 ziel=mix(base+.5,ziel,trichter);
 a.g=base;a.b=clamp(a.b+(ziel-a.b)*(1.-exp(-uDt*(ziel>a.b?1.5:mix(4.,.35,trichter)))),base+.2,13.);
 oA=a;oZ=s;oV=a;}`;

export const FS_SNOW =
    HEAD +
    HMAT +
    SGRENZE +
    `in vec2 vUV;out vec4 o;uniform sampler2D uPrev,uW;uniform vec3 uD0;uniform float uDt,uTN,uTS;
void main(){vec2 p=uD0.xy+vUV*uD0.z;float s=texture(uPrev,vUV).r,pr=texture(uW,vUV).a;vec4 t=hmAt(p);
 // Wie warm es gegen die Schneefallgrenze ist: 1 an der Grenze, je 1.000 m tiefer 6,5 mehr. Darüber fällt Schnee, darunter taut er.
 float T0=mix(uTN,uTS,clamp(p.y/1024.,0.,1.)),T=1.+6.5*(max(sgrenze(p,T0/6.5*1000.-250.),0.)/1000.-t.r);
 s+=(T<=1.?pr*.1:0.)*uDt-(.004+.012*max(T,0.))*uDt;o=vec4(clamp(s,0.,1.)*t.a);}`;

export const FS_SCROLL =
    HEAD +
    `in vec2 vUV;layout(location=0)out vec4 oA;layout(location=1)out vec4 oZ;layout(location=2)out vec4 oV;uniform sampler2D uPrevA,uPrevZ,uParA,uParZ;uniform vec3 uFrom,uTo,uPar;
void main(){vec2 w=uTo.xy+(vUV-.5)*uTo.z,u=(w-uFrom.xy)/uFrom.z+.5;if(u.x<0.||u.x>1.||u.y<0.||u.y>1.){vec2 e=(w-uPar.xy)/uPar.z+.5;oA=textureLod(uParA,e,0.);oZ=textureLod(uParZ,e,0.);}else{oA=textureLod(uPrevA,u,0.);oZ=textureLod(uPrevZ,u,0.);}oV=oA;}`;
