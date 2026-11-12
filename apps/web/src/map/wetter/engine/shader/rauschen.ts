import { HEAD } from "./bausteine";

/** Das Rauschvolumen der Wolken, scheibenweise auf der GPU erzeugt (`../rauschen.ts`). */

export const FS_NOISE =
    HEAD +
    `in vec2 vUV;out vec4 o;uniform float uZ;uniform int uMode;
vec3 h33(vec3 p){uvec3 q=uvec3(ivec3(p))*uvec3(1597334673U,3812015801U,2798796415U);q=(q.x^q.y^q.z)*uvec3(1597334673U,3812015801U,2798796415U);return -1.+2.*vec3(q)*(1./float(0xffffffffU));}
float gr(vec3 p,vec3 w,vec3 c,float f){return dot(h33(mod(p+c,f)),w-c);}
float gn(vec3 x,float f){vec3 p=floor(x),w=fract(x),u=w*w*w*(w*(w*6.-15.)+10.);
 float a=gr(p,w,vec3(0,0,0),f),b=gr(p,w,vec3(1,0,0),f),c=gr(p,w,vec3(0,1,0),f),d=gr(p,w,vec3(1,1,0),f),e=gr(p,w,vec3(0,0,1),f),g=gr(p,w,vec3(1,0,1),f),h=gr(p,w,vec3(0,1,1),f),i=gr(p,w,vec3(1,1,1),f);
 return mix(mix(mix(a,b,u.x),mix(c,d,u.x),u.y),mix(mix(e,g,u.x),mix(h,i,u.x),u.y),u.z);}
float wn(vec3 v,float f){vec3 id=floor(v),p=fract(v);float m=1e4;
 for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)for(int z=-1;z<=1;z++){vec3 c=vec3(x,y,z);vec3 h=h33(mod(id+c,vec3(f)))*.5+.5;vec3 d=p-(h+c);m=min(m,dot(d,d));}
 return 1.-sqrt(m);}
float pf(vec3 p,float f,int n){float g=exp(-.85),a=1.,s=0.;for(int i=0;i<n;i++){s+=a*gn(p*f,f);f*=2.;a*=g;}return s;}
float wf(vec3 p,float f){return wn(p*f,f)*.625+wn(p*f*2.,f*2.)*.25+wn(p*f*4.,f*4.)*.125;}
void main(){vec3 p=vec3(vUV,uZ);
 if(uMode==0){float q=mix(1.,pf(p,4.,7),.5);q=abs(q*2.-1.);float g=wf(p,4.),b=wf(p,8.),a=wf(p,16.);float r=g+(q)*(1.-g);o=vec4(r,g,b,a);}
 else{o=vec4(wf(p,4.),wf(p,8.),wf(p,16.),1.);}
}`;
