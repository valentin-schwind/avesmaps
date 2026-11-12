import { HEXN, WETTERLESEN, HEAD, COMMON, DUNST, SHADOWVIS, SGRENZE } from "./bausteine";

/** Die Wolken: Dichte, Schatten, Strahlengang, Verlauf über die Zeit (TAA) und Ausgabe. */

// ---- Wolken: Wetterstufen plus Rauschen, dessen Oktaven nach dem Bildpunkt-Fußabdruck ein- und ausblenden
export const CLOUD =
    HEXN +
    WETTERLESEN +
    `uniform sampler3D uNBase,uNDetail;uniform vec2 uOfs;uniform float uThick,uCov,uScale,uSigma,uTime;float gHf=0.,gUeber=0.;
float sat(float x){return clamp(x,0.,1.);}
float rmp(float x,float a,float b,float c,float d){return c+(x-a)/(b-a)*(d-c);}
float shp(vec4 n){float wf=n.g*.625+n.b*.25+n.a*.125;return sat((rmp(n.r,wf-1.,1.,0.,1.)-.5)/.5)*(.66+.62*n.a);}
float cloudBase(vec3 p,float foot){vec4 w=weather(p.xz);float hb=w.g/3.,ht=w.b/3.;gUeber=p.y-ht;float c0=sat(w.r*uCov*.75);if(c0<.012)return 0.;
 float hf=(p.y-hb)/max(ht-hb,.04);if(hf<=0.||hf>=1.)return 0.;gHf=hf;
 float hg=sat(hf/.06)*sat(1.-pow(hf,2.4));if(hg<=0.)return 0.;
 vec3 q=vec3(p.x-uOfs.x+hf*hf*.4,p.y*1.7+uTime*.012,p.z-uOfs.y);
 float P0=170.*uScale,P1=31.*uScale,l1=log2(foot/(P1/128.)),r1=1.-smoothstep(1.,2.5,l1),P2=6.9*uScale,l2=log2(foot/(P2/128.)),r2=1.-smoothstep(1.5,3.5,l2),sh1=.5,mod1=1.;
 vec3 qn=q;
 if(r1>.01){vec4 n0=textureLod(uNBase,q/P0,max(log2(foot/(P0/128.)),0.));q+=vec3(n0.g-.45,0.,n0.b-.45)*P0*.045;vec4 n1=hexTex(uNBase,vec2(q.x*.94-q.z*.34,q.x*.34+q.z*.94)/P1,q.y/P1,max(l1,1.),2.);sh1=shp(n1);mod1=mix(.62,1.2,smoothstep(.3,.6,n1.g));qn=q;}
 float xf=c0+(sh1-.5)*.75*r1;
 if(r2<=.01)return smoothstep(.48,.95,xf)*hg;
 float cov=min(c0*1.35*mix(1.,mod1,r1),1.)*mix(.82,1.,sat(w.r-.4)),sh=shp(hexTex(uNBase,qn.xz/P2,qn.y/P2,max(l2,0.),3.)),lo=1.-cov;
 float u=sat(mix(xf-.48,sh*hg-lo,r2)/mix(.47,cov,r2));
 return mix(u*u*(3.-2.*u)*hg,u*mix(.8,1.15,hf),r2);}
float cloudFull(vec3 p,float b,float foot){float P=.75*uScale,l=log2(foot/(P/64.)),wd=1.-smoothstep(1.5,4.,l),hf=gHf,mx=mix(.6,.4,sat(hf*5.));if(wd<.01)return sat(rmp(b,mx*.45,1.,0.,1.));
vec3 q=vec3(p.x-uOfs.x+hf*hf*.4,p.y*1.15+uTime*.012,p.z-uOfs.y);
 vec2 cw=textureLod(uNBase,q/(3.*uScale),2.).gb-.45;
 vec3 d=textureLod(uNDetail,(q+vec3(cw.x,0.,cw.y)*.096*uScale)/P,max(l,0.)).rgb;float f=d.r*.625+d.g*.25+d.b*.125;return sat(rmp(b,(mx+(mix(f,1.-f,sat(hf*5.))-mx)*wd)*.45,1.,0.,1.));}
`;

export const FS_CLOUDSHADOW =
    HEAD +
    `uniform vec3 uSunDir;uniform float uBase;` +
    CLOUD +
    `in vec2 vUV;out vec4 o;uniform vec2 uCtr;uniform float uExt;
void main(){vec2 xz=uCtr+(vUV-.5)*uExt;float sy=max(uSunDir.y,.08),foot=uExt/512.;vec3 st=vec3(uSunDir.x/sy,1.,uSunDir.z/sy)*2.4/12.;float len=length(st),od=0.;
 for(int i=0;i<12;i++){vec3 p=vec3(xz.x,uBase,xz.y)+st*(float(i)+.5);od+=max(cloudBase(p,foot)-.02,0.);}
 o=vec4(exp(-od*len*uSigma*.15),0.,0.,1.);}`;

export const FS_CLOUD =
    HEAD +
    COMMON +
    DUNST +
    SHADOWVIS +
    CLOUD +
    SGRENZE +
    `in vec2 vUV;layout(location=0)out vec4 oC;layout(location=1)out float oD;
uniform vec2 uJit;uniform float uUhr,uSchneeHang,uFrame,uSteps,uMaxD,uShafts,uPixAng,uK,uOben,uHang,uHS,uTN,uTS,uSchnee,uLinie,uSchatten,uWolken,uSchleier,uRegenKarte;uniform sampler2D uHM,uSnow;vec4 hmAt(vec2 p){vec2 u=p/1024.;return (u.x<0.||u.x>1.||u.y<0.||u.y>1.)?vec4(0.):textureLod(uHM,u,0.);}
float ign(vec2 p){return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715))));}
float hg(float c,float g){float g2=g*g;return (1.-g2)/(4.*PI*pow(max(1.+g2-2.*g*c,1e-4),1.5));}
// Lichtstrahl in sechs Schritten zur Sonne. Die beiden ersten (mit Feinform) rechnet jede Probe neu, von den vier weiteren nur Schritt rr+2, die anderen bleiben
// aus den Proben davor (alle: alles neu). Ab einer optischen Tiefe von 48 trägt auch die weichste Streuordnung unter 0,1 % bei (exp(-48·0,144)): Der Rest bleibt stehen.
float lo[6]=float[6](0.,0.,0.,0.,0.,0.);
float lightOD(vec3 p,float foot,float w6,bool alle,int rr){float od=0.,s=0.,dl=.093,tp=uBase+uThick;bool oben=false;
 for(int i=0;i<6;i++){s+=dl*.5;
  if(alle||i<2||i-2==rr){if(oben||(i>2&&w6<=0.))lo[i]=0.;else if(od*uSigma<=48.){vec3 q=p+uSunDir*s;if(q.y>tp){oben=true;lo[i]=0.;}else{float f=foot*(1.+float(i)),b=cloudBase(q,f);if(b>0.&&i<2)b=cloudFull(q,b,f*2.);lo[i]=max(b,0.)*dl*(i>2?w6:1.);}}}
  else if(oben||(i>2&&w6<=0.))lo[i]=0.;
  od+=lo[i];s+=dl*.5;dl*=1.55;}
 return od*uSigma;}
float bodenY(vec2 xz){return max(hmAt(xz).r,0.)*uK;}
// Strahl gegen das Höhenfeld: So weit vorrücken, wie der Abstand zum Boden bei der größten Steigung erlaubt, den ersten Durchstoß dann halbieren. Flach über einen Kamm hinweg findet das auch den vordersten Hang.
float bodenTreffer(vec3 rd){if(rd.y>=-1e-4)return 1e7;float tb=-uEye.y/rd.y;if(tb<=0.)return 1e7;if(uK<=0.)return tb;
 float t=max((uOben-uEye.y)/rd.y,0.),tv=t,kegel=-rd.y+uHang*length(rd.xz);
 for(int i=0;i<64;i++){vec3 g=uEye+rd*t;float d=g.y-bodenY(g.xz);if(d<=0.){for(int k=0;k<5;k++){float m=.5*(tv+t);vec3 q=uEye+rd*m;if(q.y<bodenY(q.xz))t=m;else tv=m;}return t;}if(t>=tb)break;tv=t;t=min(t+max(d/kegel,max(.08,t*.012)),tb);}
 return tb;}
void main(){vec2 nd=vUV*2.-1.+uJit;vec3 rd=rayDir(nd);float tS=bodenTreffer(rd);
 float j=fract(ign(gl_FragCoord.xy)+uFrame*.61803398),tp=uBase+uThick,t0=0.,t1=-1.;
 if(abs(rd.y)>1e-5){float a=(uBase-uEye.y)/rd.y,b=(tp-uEye.y)/rd.y;t0=max(min(a,b),0.);t1=max(a,b);}else if(uEye.y>uBase&&uEye.y<tp){t1=1e7;}
 t1=min(t1,min(min(tS,uMaxD),dunstEnde(uEye,rd)));float flach=1.-smoothstep(uDF.x,uDF.y,-rd.y);if(flach>.999)t1=min(t1,uDF.w);vec3 L=vec3(0.);float T=1.,sW=0.,sD=0.,tHit=-1.,cs=dot(rd,uSunDir);
 if(uWolken>.5&&t1>t0){float ph[3];{float c=1.;for(int o=0;o<3;o++){ph[o]=mix(hg(cs,.8*c),hg(cs,-.25*c),.32);c*=.5;}}
  float pwW=.25+.75*(1.-sat(cs*.5+.5)),qs=40./uSteps,len=t1-t0,t=t0;int zero=0,maxS=int(uSteps)*2,rr=0;bool fine=false,lneu=true;float upH=0.;
  float dC0=min(max(.08,t0*.012),len/10.)*qs,dL=dC0;t+=j*dC0;
  for(int i=0;i<maxS;i++){if(T<.012||t>=t1)break;
   float rest=(t1-t)/float(maxS-i),dC=max(min(max(.08,t*.012),len/10.)*qs,rest),dF=max(min(max(.022,t*.0028),len/28.)*qs,rest),foot=t*uPixAng+.0012;
   vec3 p=uEye+rd*t;float b=cloudBase(p,foot);
   if(!fine){lneu=true;if(b>0.){fine=true;zero=0;t=max(t0,t-dL*.8+dF*j);}else{dL=dC;if(rd.y<0.&&gUeber>0.)dL=max(dC,min(gUeber/-rd.y,.5+t*.02));t+=dL;}continue;}
   if(b<=0.){zero++;lneu=true;if(zero>5)fine=false;t+=dF*1.6;continue;}
   zero=0;float d=cloudFull(p,b,foot),dt=min(min(dF,max(dF*.2,1.5/(max(d,.01)*uSigma))),t1-t)+1e-5;
   if(d>.001){d*=(1.-smoothstep(uMaxD*.55,uMaxD,t))*wolkenSicht(p);bool alle=lneu||dF>.1;float hf=gHf,od=lightOD(p,foot*2.,1.-smoothstep(150.,260.,t),alle,rr);if(alle||rr==4)upH=cloudBase(p+vec3(0.,.29,0.),foot*2.)*.29*uSigma;float up=upH;lneu=false;rr=rr==4?0:rr+1;
    float lum=0.,a=1.,k=1.;for(int o=0;o<3;o++){lum+=a*exp(-od*k)*ph[o];a*=.72;k*=.38;}lum=mix(lum,ph[0]+.72*ph[1]+.52*ph[2],.35*smoothstep(.3,.8,hf));
    float pw=mix(1.,1.-exp(-d*uSigma*.115),pwW),vert=mix(.62,1.,sat(hf*3.2));
    vec3 amb=(mix(uAmbBot,uAmbTop*.8,sat(hf*1.25))+uAmbTop*.22)*mix(.5,1.,exp(-up*.5))+uSun*.012;
    float mw=smoothstep(1.5,3.5,log2(foot/(6.9*uScale/128.))),mk=1.;if(mw>0.){vec2 mq=vec2((p.x-uOfs.x)*.86-(p.z-uOfs.y)*.5,(p.x-uOfs.x)*.5+(p.z-uOfs.y)*.86);float mv=hexTex(uNBase,mq/(61.*uScale),.3,max(log2(foot/(61.*uScale/128.))+1.,0.),1.5).g*.55+hexTex(uNBase,vec2(mq.y,-mq.x)/(23.7*uScale),.6,max(log2(foot/(23.7*uScale/128.))+1.5,0.),1.5).b*.45+.03;mk=mix(1.,mix(.55,1.12,smoothstep(.22,.62,mv)),mw);}float sE=max(d*uSigma,1e-4);vec3 S=sE*(uSun*lum*pw*vert*mk+amb);float e=exp(-sE*dt);L+=T*(S-S*e)/sE;float dT=T*(1.-e);if(tHit<0.&&dT>.02)tHit=t;sD+=t*dT;sW+=dT;T*=e;}else lneu=true;
   t+=dt;}
 }
 // Flach gesehene Wolken (wetter-dunst.ts) gehen nach ihrer mittleren Tiefe in der Deckung zurück, nicht in der Dichte: Streifende Strahlen laufen so lang durch
 // sie, dass auch ein Rest an Dichte noch deckt.
 if(sW>1e-3){float dm=sD/sW,f=1.-flach*smoothstep(uDF.z,uDF.w,dm);L=mix(L,fogColor(rd)*(1.-T),dunstAnteil(uEye+rd*dm))*f;T=1.-(1.-T)*f;}
 // Lichtstrahlen weichen wie die Wolken dem Dunst und dem flachen Blick: Am Horizont summierten sie sonst über 80 Einheiten Sonnenlicht zu hellen Strichen.
 if(uWolken>.5&&uShafts>0.&&uSunDir.y>0.&&uEye.y<tp*2.&&flach<.999){float tE=min(min(min(tHit>0.?tHit:tS,uMaxD*.7),80.),dunstEnde(uEye,rd)),dS=tE/10.,sum=0.;
  for(int i=0;i<10;i++){vec3 p=uEye+rd*((float(i)+j)*dS);if(p.y>tp)continue;sum+=cloudVis(p)*exp(-max(p.y,0.)*.4)*wolkenSicht(p);}
  L+=uSun*hg(cs,.62)*sum*dS*uShafts*.0028*(1.-flach);}
 if(uWolken>.5&&uSchleier>0.){float tr=min(min(tS,uMaxD*.8),dunstEnde(uEye,rd)),ta=rd.y<0.?max((uEye.y-1.6)/-rd.y,0.):0.;if(tr>ta){float dS=(tr-ta)/8.,rs=0.;for(int i=0;i<8;i++){vec3 p=uEye+rd*(ta+(float(i)+j)*dS);vec4 w=weather(p.xz);if(p.y<w.g/3.&&w.a>.02)rs+=w.a;}float e=exp(-rs*dS*uSchleier*.09*(1.-flach));L+=T*(1.-e)*(uAmbTop*.35+uSun*.01);T*=e;}}
 if(tS<1e6){vec3 g=uEye+rd*tS;vec4 t=hmAt(g.xz);float vis=uWolken>.5&&(uSchatten>0.||uShafts>0.)?cloudVis(g):1.,hm=t.r*1000.,dg=dunstAnteil(g);
  if(uRegenKarte>.5){float r=sat(weather(g.xz).a*1.6)*.8;L+=T*vec3(.06,.3,.95)*r;T*=1.-r;}
  // Die Schneedecke beginnt 260 m unter der Schneefallgrenze der Wegfindung und ist 260 m darüber voll; Sonnenhang, Rand und Hangneigung kommen vom Wetter.
  if((uSchnee>0.||uLinie>.5)&&t.a>.5){vec2 mu=g.xz/1024.;float T0=mix(uTN,uTS,clamp(mu.y,0.,1.)),fall=max(sgrenze(g.xz,T0/6.5*1000.-250.),0.),line0=fall-260.,gl0=length(t.gb),south=gl0>1e-3?-t.b/gl0:0.;
   float lodS=max(log2((tS*uPixAng+.0012)*.12*64.),0.);vec3 n3=hexTex(uNBase,g.xz*.047+vec2(.31,.77),.63,max(lodS-.35,0.),2.5).rgb,n1=hexTex(uNDetail,g.xz*.12+(n3.gb-.45)*.35,.21,lodS,2.5).rgb;float line=line0+260.*south*smoothstep(.02,.25,gl0)+560.*(n1.r-.5);
   float sf=textureLod(uSnow,(g.xz-uD0.xy)/uD0.z,0.).r*(.3+1.4*sat((n3.r*.55+n1.r*.25+n1.g*.2-.38)/.4));
   // Auf steilen Hängen hält kein Schnee, dort schaut das Gestein heraus. Die Grenze ist unruhig, damit keine glatte Linie entsteht.
   vec3 n2=hexTex(uNDetail,g.xz*.7+(n1.gb-.45)*.3,.37,lodS+2.54,2.5).rgb;float halt=uSchneeHang+(n2.r-.55)*14.+(n1.g-.55)*10.+clamp((hm-line-500.)/120.,0.,18.),snow=max(smoothstep(line,line+520.,hm),smoothstep(.1,.5,sf))*(1.-smoothstep(halt-4.,halt+4.,atan(gl0)*57.3));
   if(snow>0.){vec3 n=normalize(vec3(-t.g*uHS,1.,-t.b*uHS));vec3 sky=mix(uAmbTop,vec3(dot(uAmbTop,vec3(.33))),.6);vec3 lit=uSun*max(dot(n,uSunDir),0.)*vis/PI+sky*1.8;float sd=snow*.82*uSchnee;L+=T*mix(vec3(.5,.52,.56)*lit,fogColor(rd),dg)*sd;T*=1.-sd;}
   if(uLinie>.5&&fall>0.){float w=max(fwidth(hm)*1.5,4.),li=(1.-smoothstep(w*.5,w,abs(hm-fall)))*.85;L+=T*vec3(1.6,.25,.15)*li;T*=1.-li;}}
  T*=mix(1.,vis,uSchatten*wolkenSicht(g));}
 oC=vec4(L,T);oD=sW>.01?sD/sW:min(tS,1e6);}`;

// Verlauf in voller Bildgröße. Bei 100 % Wolkenauflösung wie bisher: Bildpunkt gegen Verlauf, Verlauf in den Rahmen der 3×3-Nachbarn geklemmt.
// Darunter rechnet der Verlauf hoch: Die nächste verwackelte Probe zählt nach ihrem Abstand zum Bildpunkt (Gauß, Radius `uRad` Bildpunkte), geteilt durch
// das mittlere Gewicht `uWn`; so frischt jedes Bild im Mittel so viel auf wie bei voller Auflösung. Ohne Verlauf gilt das weich hochgerechnete aktuelle Bild.
export const FS_TAA =
    HEAD +
    COMMON +
    `in vec2 vUV;out vec4 o;uniform sampler2D uCur,uCurD,uHist;uniform mat4 uPrevVP;uniform vec2 uRes,uCloudRes,uJit;uniform float uReset,uWn,uRad;
vec4 cat(vec2 uv){vec2 s=uv*uCloudRes-.5,f=fract(s);s-=f;
 vec2 w0=f*(-.5+f*(1.-.5*f)),w1=1.+f*f*(-2.5+1.5*f),w2=f*(.5+f*(2.-1.5*f)),w3=f*f*(-.5+.5*f),w12=w1+w2,off=w2/w12;
 vec2 a=(s-.5)/uCloudRes,b=(s+.5+off)/uCloudRes,c=(s+2.5)/uCloudRes;
 return textureLod(uCur,vec2(a.x,a.y),0.)*w0.x*w0.y+textureLod(uCur,vec2(b.x,a.y),0.)*w12.x*w0.y+textureLod(uCur,vec2(c.x,a.y),0.)*w3.x*w0.y
  +textureLod(uCur,vec2(a.x,b.y),0.)*w0.x*w12.y+textureLod(uCur,vec2(b.x,b.y),0.)*w12.x*w12.y+textureLod(uCur,vec2(c.x,b.y),0.)*w3.x*w12.y
  +textureLod(uCur,vec2(a.x,c.y),0.)*w0.x*w3.y+textureLod(uCur,vec2(b.x,c.y),0.)*w12.x*w3.y+textureLod(uCur,vec2(c.x,c.y),0.)*w3.x*w3.y;}
void main(){ivec2 px=ivec2(gl_FragCoord.xy),m=ivec2(uCloudRes)-1;bool eins=all(equal(uCloudRes,uRes));vec2 sp=vUV*uCloudRes-.5-uJit*uCloudRes*.5;
 ivec2 k=eins?px:clamp(ivec2(floor(sp+.5)),ivec2(0),m);vec4 c=texelFetch(uCur,k,0),m1=vec4(0.),m2=vec4(0.);
 for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec4 s=texelFetch(uCur,clamp(k+ivec2(x,y),ivec2(0),m),0);m1+=s;m2+=s*s;}
 m1/=9.;m2/=9.;vec4 sd=sqrt(max(m2-m1*m1,vec4(0.)));
 vec4 pc=uPrevVP*vec4(uEye+rayDir(vUV*2.-1.)*texelFetch(uCurD,k,0).r,1.);vec2 p=pc.xy/pc.w*.5+.5;
 if(uReset>.5||pc.w<=0.||p.x<0.||p.x>1.||p.y<0.||p.y>1.){o=eins?c:max(cat(vUV-uJit*.5),vec4(0.));return;}
 vec4 h=clamp(textureLod(uHist,p,0.),m1-sd*1.5,m1+sd*1.5);float a=mix(.055,.4,clamp(length((p-vUV)*uCloudRes)/12.,0.,1.));
 if(eins){o=mix(h,c,a);return;}
 vec2 dd=(sp-vec2(k))*uRes/uCloudRes;o=mix(h,c,min(a*exp(-2.29*dot(dd,dd)/(uRad*uRad))/uWn,1.));}`;

export const FS_AUS =
    HEAD +
    COMMON +
    `in vec2 vUV;out vec4 o;uniform sampler2D uCloud;uniform float uExposure;
vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
void main(){vec4 c=texelFetch(uCloud,ivec2(gl_FragCoord.xy),0);c.rgb=max(c.rgb,vec3(0.));c.a=clamp(c.a,0.,1.);o=vec4(pow(aces(c.rgb*uExposure),vec3(1./2.2)),c.a);}`;
