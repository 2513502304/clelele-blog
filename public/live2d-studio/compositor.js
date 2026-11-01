import { normalizeLook } from './look-settings.js';
import { normalizeEffects, effectDetails } from './effects.js';
import { FILTER_DEFINITIONS, getFilterDefinition, getFilterDefaults, normalizeFilterParams } from './filter-definitions.js';

/**
 * Shared GPU composition for the editor preview and deterministic exports.
 * Source frames upload another canvas; cached FX reuse the graded texture: this is a visual experiment, not the final
 * single-context production renderer. The caller owns rendering and scheduling.
 */
export function createCompositor({ canvas }) {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error('创作台需要浏览器支持 WebGL 2。');

  const vertexSource = `#version 300 es
    layout(location=0) in vec2 aPosition;
    out vec2 vUv;
    void main() {
      vUv = aPosition * 0.5 + 0.5;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;
  // All layer samples and the final framebuffer use premultiplied alpha. Color
  // operations temporarily unpremultiply, so transparent texture borders cannot
  // introduce black fringes during blur, grading, or compositing.
  const fragmentSource = `#version 300 es
    precision highp float;
    in vec2 vUv;
    out vec4 outColor;
    uniform sampler2D uModel;
    uniform sampler2D uBackground;
    uniform sampler2D uUnderlay;
    uniform sampler2D uLayerBlur;
    uniform bool uHasLayerBlur;
    uniform vec2 uResolution;
    uniform vec2 uImageSize;
    uniform vec3 uColor;
    uniform vec3 uColor2;
    uniform vec2 uPan;
    uniform float uScale;
    uniform float uStrength;
    uniform float uExposure;
    uniform float uSaturation;
    uniform int uFilter;
    uniform int uBackgroundType;
    uniform bool uGradeBackground;
    uniform bool uHasUnderlay;
    uniform vec4 uParams;
    uniform vec3 uInkA;
    uniform vec3 uInkB;
    uniform int uFx;
    uniform float uFxTime;
    uniform float uFxStrength;
    uniform float uFxDensity;

    vec4 backgroundAt(vec2 uv) {
      if (uBackgroundType == 0) return vec4(0.0);
      if (uBackgroundType == 1) return vec4(uColor, 1.0);
      if (uBackgroundType == 2) {
        float t = clamp((1.0 - uv.y) * 0.85 + uv.x * 0.15, 0.0, 1.0);
        return vec4(mix(uColor, uColor2, t), 1.0);
      }
      float cover = max(uResolution.x / uImageSize.x, uResolution.y / uImageSize.y);
      vec2 displayed = uImageSize * cover * uScale;
      vec2 overflow = max(displayed - uResolution, vec2(0.0));
      // Pan is expressed as a fraction of available cropping, never exposing
      // empty strips. Positive x moves the image right; positive y moves it down.
      vec2 offset = vec2(uPan.x, -uPan.y) * overflow * 0.5;
      vec2 imageUv = ((uv - 0.5) * uResolution - offset) / displayed + 0.5;
      vec4 image = texture(uBackground, imageUv);
      return image + vec4(uColor, 1.0) * (1.0 - image.a);
    }
    vec4 baseAt(vec2 uv, bool backgroundOnly) {
      if (backgroundOnly) return backgroundAt(uv);
      vec4 model = texture(uModel, clamp(uv, 0.0, 1.0));
      // Poster typography keeps its own colors. With an underlay, grade the
      // background and actor separately before inserting the title between them.
      if (!uGradeBackground || uHasUnderlay) return model;
      return model + backgroundAt(uv) * (1.0 - model.a);
    }
    vec3 straight(vec4 sampleColor) {
      return sampleColor.a > 0.00001 ? sampleColor.rgb / sampleColor.a : vec3(0.0);
    }
    float luminance(vec3 color) { return dot(color, vec3(0.2126, 0.7152, 0.0722)); }
    float noise(vec2 p) { return fract(sin(dot(p, vec2(17.13, 93.71))) * 43758.391); }
    vec3 basicGrade(vec3 color) {
      color *= exp2(uExposure);
      return mix(vec3(luminance(color)), color, uSaturation);
    }
    vec4 blurAt(vec2 uv, bool backgroundOnly, float radius) {
      if (uHasLayerBlur && !backgroundOnly) return texture(uLayerBlur,uv);
      vec2 stepUv = vec2(radius / 600.0 * uResolution.y) / uResolution;
      vec4 value = baseAt(uv, backgroundOnly) * 4.0;
      value += baseAt(uv + vec2(stepUv.x, 0.0), backgroundOnly) * 2.0;
      value += baseAt(uv - vec2(stepUv.x, 0.0), backgroundOnly) * 2.0;
      value += baseAt(uv + vec2(0.0, stepUv.y), backgroundOnly) * 2.0;
      value += baseAt(uv - vec2(0.0, stepUv.y), backgroundOnly) * 2.0;
      value += baseAt(uv + stepUv, backgroundOnly);
      value += baseAt(uv - stepUv, backgroundOnly);
      value += baseAt(uv + vec2(stepUv.x, -stepUv.y), backgroundOnly);
      value += baseAt(uv + vec2(-stepUv.x, stepUv.y), backgroundOnly);
      return value / 16.0;
    }
    vec2 edgesAt(vec2 uv, bool backgroundOnly, float radius) {
      vec2 d = vec2(radius / 600.0 * uResolution.y) / uResolution;
      vec4 l = baseAt(uv - vec2(d.x, 0.0), backgroundOnly);
      vec4 r = baseAt(uv + vec2(d.x, 0.0), backgroundOnly);
      vec4 a = baseAt(uv - vec2(0.0, d.y), backgroundOnly);
      vec4 b = baseAt(uv + vec2(0.0, d.y), backgroundOnly);
      vec2 gradient = vec2(luminance(straight(r)) - luminance(straight(l)), luminance(straight(b)) - luminance(straight(a)));
      return vec2(length(gradient), length(vec2(r.a-l.a, b.a-a.a)));
    }
    vec4 filteredAt(vec2 uv, bool backgroundOnly) {
      vec4 original = baseAt(uv, backgroundOnly);
      vec4 sampled = original;
      vec2 logicalPixel = uv * uResolution / uResolution.y * 600.0;
      if (uFilter == 4) {
        float block = max(1.0, uResolution.y * uParams.x / 600.0);
        vec2 pixelUv = (floor(uv * uResolution / block) + 0.5) * block / uResolution;
        sampled = baseAt(pixelUv, backgroundOnly);
      }
      vec3 color = basicGrade(straight(sampled));
      vec3 effect = color;
      if (uFilter == 1) {
        vec3 blurred = basicGrade(straight(blurAt(uv, backgroundOnly, uParams.x)));
        vec3 highlight = max(blurred - 0.48, 0.0);
        effect = mix(color, blurred, 0.18);
        // Screen-like highlight diffusion rolls off near white instead of
        // clipping pale hair/skin into a featureless white patch.
        effect = 1.0 - (1.0 - effect) * (1.0 - highlight * uParams.y * 0.55);
        effect += vec3(0.06, -0.012, -0.025) * uParams.z;
      } else if (uFilter == 2) {
        effect = color * (vec3(1.0) + vec3(.14, -.012, -.19) * uParams.z);
        effect = mix(vec3(0.11, 0.085, 0.073), effect, 1.0 - uParams.y * .24);
        effect = (effect - 0.5) * 1.08 + 0.5;
        float grain = (noise(floor(logicalPixel * 1.2)) - 0.5) * uParams.x * .16;
        effect += grain;
        effect *= 1.0 - uParams.w * .7 * smoothstep(.2, .72, length((uv-.5) * vec2(1.0,.85)));
      } else if (uFilter == 3) {
        float light = clamp((luminance(color) - 0.5) * uParams.y + 0.5, 0.0, 1.0);
        vec2 grid = fract(logicalPixel / uParams.x) - 0.5;
        float radius = sqrt(1.0 - light) * 0.7;
        float distanceToDot = length(grid);
        float feather = max(fwidth(distanceToDot), 0.015);
        float paper = smoothstep(radius - feather, radius + feather, distanceToDot);
        effect = mix(uInkB, uInkA, paper);
      } else if (uFilter == 4) {
        float steps = max(2.0, uParams.y - 1.0);
        effect = floor(clamp(color, 0.0, 1.0) * steps + 0.5) / steps;
      } else if (uFilter == 5) {
        float light = luminance(color);
        vec2 edge = edgesAt(uv, backgroundOnly, 1.4);
        effect = color * mix(vec3(1.0), vec3(.43,.63,.92), uParams.x);
        effect += uInkA * ((1.0-light) * .11 + max(edge.x,edge.y)*uParams.y*.85);
      } else if (uFilter == 6) {
        float grey = clamp((luminance(color)-.5)*uParams.x+.5,0.0,1.0);
        grey += (noise(floor(logicalPixel*1.4))-.5)*uParams.y*.18;
        grey *= 1.0-uParams.z*.75*smoothstep(.2,.72,length((uv-.5)*vec2(1.0,.85)));
        effect = vec3(grey);
      } else if (uFilter == 7) {
        float light = clamp((luminance(color)-uParams.x)*uParams.y+.5,0.0,1.0);
        effect = mix(uInkA,uInkB,smoothstep(.03,.97,light));
      } else if (uFilter == 8) {
        vec2 edge = edgesAt(uv,backgroundOnly,uParams.x);
        float light = luminance(color);
        float hatch = smoothstep(.62,.82,fract((logicalPixel.x+logicalPixel.y*.58)/4.4));
        float ink = clamp(edge.x*3.4*uParams.y + hatch*max(0.0,.55-light)*.65,0.0,1.0);
        float paper = 1.0-(noise(floor(logicalPixel))-.25)*uParams.z*.13;
        effect = mix(vec3(.985,.971,.946)*paper,uInkA,ink);
      } else if (uFilter == 9) {
        vec3 wash = straight(blurAt(uv,backgroundOnly,1.0+uParams.x*3.5));
        wash = basicGrade(wash);
        vec2 edge = edgesAt(uv,backgroundOnly,1.6);
        effect = mix(color,wash,uParams.x*.75);
        effect = mix(vec3(luminance(effect)),effect,uParams.w);
        effect *= 1.0-edge.x*uParams.y*.6;
        float paperNoise = (noise(floor(logicalPixel*.55)) + noise(floor(logicalPixel*1.7)) - 1.0);
        effect = mix(effect,vec3(.99,.975,.94),.07+uParams.x*.08) + paperNoise*uParams.z*.12;
      } else if (uFilter == 10) {
        vec2 edge = edgesAt(uv,backgroundOnly,1.4);
        vec2 wide = edgesAt(uv,backgroundOnly,3.8);
        float glow = max(edge.x,edge.y*.7)*uParams.x + max(wide.x,wide.y*.7)*uParams.y*.65;
        vec3 halo = straight(blurAt(uv,backgroundOnly,4.0));
        effect = color*(1.0-uParams.z*.92) + uInkA*glow + uInkA*max(0.0,luminance(halo)-.2)*uParams.y*.45;
      } else if (uFilter == 11) {
        float steps = max(2.0,uParams.x-1.0);
        effect = floor(clamp(color,0.0,1.0)*steps+.5)/steps;
        float edge = edgesAt(uv,backgroundOnly,uParams.z).x;
        effect *= 1.0-smoothstep(.07,.35,edge)*uParams.y;
      } else if (uFilter == 12) {
        vec2 offset = vec2(uParams.x/600.0*uResolution.y)/uResolution;
        vec3 plateA = straight(baseAt(uv+vec2(offset.x,0.0),backgroundOnly));
        vec3 plateB = straight(baseAt(uv-vec2(offset.x,offset.y*.35),backgroundOnly));
        float grain = (noise(floor(logicalPixel))-.5)*uParams.y*.22;
        float densityA = clamp((1.0-luminance(plateA))*.95+(plateA.r-plateA.b)*.25+grain,0.0,1.0);
        float densityB = clamp((1.0-luminance(plateB))*.85+(plateB.b-plateB.r)*.25-grain,0.0,1.0);
        effect = vec3(.98,.95,.87)*mix(vec3(1.0),uInkA,densityA)*mix(vec3(1.0),uInkB,densityB);
        effect = mix(effect,vec3(.98,.95,.87),uParams.z*.5);
      }
      vec4 gradedOriginal = vec4(clamp(basicGrade(straight(original)), 0.0, 1.0) * original.a, original.a);
      vec4 gradedEffect = vec4(clamp(effect, 0.0, 1.0) * sampled.a, sampled.a);
      return mix(gradedOriginal, gradedEffect, uStrength);
    }
    vec4 compositeAt(vec2 uv) {
      vec4 result = filteredAt(uv, false);
      if (uHasUnderlay) {
        vec4 background = uGradeBackground ? filteredAt(uv, true) : backgroundAt(uv);
        vec4 title = texture(uUnderlay, uv);
        vec4 under = title + background * (1.0 - title.a);
        result += under * (1.0 - result.a);
      } else if (!uGradeBackground) {
        result += backgroundAt(uv) * (1.0 - result.a);
      }
      return result;
    }

    void main() { outColor = compositeAt(vUv); }
  `;

  const fxSource = `#version 300 es
    precision highp float;
    in vec2 vUv; out vec4 outColor;
    uniform sampler2D uBase;
    uniform int uFx; uniform float uFxTime; uniform float uFxStrength; uniform float uFxDensity;
    uniform vec4 uFxDetail; uniform vec2 uNeonDetail; uniform vec3 uFxColor;
    uniform vec4 uLookColor; uniform vec4 uLookLight; uniform vec4 uLookTexture; uniform vec4 uLookPrint;
    uniform vec3 uLightColor; uniform vec3 uRimColor; uniform vec2 uTexel; uniform vec3 uFxEnabled; uniform vec2 uGlass;

    vec3 straight(vec4 v) { return v.a > .00001 ? v.rgb / v.a : vec3(0.0); }
    float noise(vec2 p) { return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    float iceSegment(vec2 p,vec2 a,vec2 b){vec2 v=b-a;return length(p-a-v*clamp(dot(p-a,v)/dot(v,v),0.0,1.0));}
    void main() {
      vec2 uv = vUv;
      vec4 original = texture(uBase,uv);
      if(uLookPrint.w*uLookColor.w>0.0){float block=1.0+uLookPrint.w*uLookColor.w*60.0;uv=(floor(uv*vec2(600.0*uTexel.y/uTexel.x,600.0)/block)+.5)*block/vec2(600.0*uTexel.y/uTexel.x,600.0);}
      vec4 sampled=texture(uBase,uv);
      vec3 rgb = straight(sampled);
      if ((uFxEnabled.x>0.0 || uFxEnabled.y>0.0) && uFxStrength>0.0) {
        bool glitch=uFxEnabled.y>0.0;
        float beat = floor(uFxTime * 12.0);
        float band = floor(uv.y * (18.0 + uFxDensity * 42.0));
        float pulse = step(glitch ? .68 : .96, noise(vec2(band, beat)));
        float shift = (noise(vec2(beat,band))-.5)*pulse*(glitch ? .035 : .004)*uFxStrength*uFxDetail.y;
        vec2 offset = vec2(shift + sin(uFxTime * 1.2) * .0008*uFxDetail.y, 0.0);
        vec4 moved = texture(uBase,clamp(uv+offset,0.0,1.0));
        rgb = mix(rgb,straight(moved),step(.01,moved.a));
        float chroma = (glitch ? .004 : .0013) * uFxStrength * (.4+pulse)*uFxDetail.x;
        vec4 left = texture(uBase,clamp(uv+offset+vec2(chroma,0.0),0.0,1.0));
        vec4 right = texture(uBase,clamp(uv+offset-vec2(chroma,0.0),0.0,1.0));
        rgb.r = mix(rgb.r,straight(left).r,step(.01,left.a));
        rgb.b = mix(rgb.b,straight(right).b,step(.01,right.a));
        if (uFxEnabled.x>0.0) {
          float scan = .5+.5*sin((uv.y*600.0+uFxTime*7.0)*3.14159);
          rgb *= 1.0-scan*.13*uFxStrength*uFxDetail.z;
          float roll = exp(-pow((fract(uv.y+uFxTime*.09)-.5)/.08,2.0));
          rgb += roll*.035*uFxStrength*uFxDetail.z;
        }
      }
      if(uFxEnabled.z>0.0 && uFxStrength>0.0) {
        float wave = .5+.5*sin(uv.x*3.5+uv.y*2.0+uFxTime*.85);
        vec3 tint = mix(uFxColor.brg,uFxColor,.5+(wave-.5)*uNeonDetail.y);
        float rim = smoothstep(.16,.65,length((uv-.5)*vec2(1.0,.8))*uNeonDetail.x);
        rgb = mix(rgb,rgb*tint*1.25,(.08+.15*rim)*uFxStrength);
        rgb += tint * rim * (.08+.04*sin(uFxTime*.6+uv.x*4.0)*uNeonDetail.y)*uFxStrength;
      }
      // Shared adjustments use the same pass in the preview and encoder; no CSS-only effects.
      vec3 before=rgb; float mixAmount=uLookColor.w;
      vec2 stepUv=vec2(.006*uTexel.x/uTexel.y,.006);
      if(uLookTexture.y>0.0){
        vec2 d=vec2(.025*uLookTexture.y,0.0);
        vec4 l=texture(uBase,clamp(uv+d,0.0,1.0)),r=texture(uBase,clamp(uv-d,0.0,1.0));
        rgb.r=mix(rgb.r,straight(l).r,step(.01,l.a));rgb.b=mix(rgb.b,straight(r).b,step(.01,r.a));
      }
      rgb=(rgb-.5)*exp2(uLookColor.x*1.5)+.5;
      rgb+=vec3(.28,.025,-.28)*uLookColor.y+vec3(.14,-.14,.14)*uLookColor.z;
      if(uLookLight.x>0.0 || uLookLight.w>0.0){
        vec4 a=texture(uBase,clamp(uv+stepUv,0.0,1.0)),b=texture(uBase,clamp(uv-stepUv,0.0,1.0));
        vec4 c=texture(uBase,clamp(uv+vec2(stepUv.x,-stepUv.y),0.0,1.0)),d=texture(uBase,clamp(uv+vec2(-stepUv.x,stepUv.y),0.0,1.0));
        vec3 blur=(straight(a)+straight(b)+straight(c)+straight(d))*.25;
        // Screen light rolls off near white instead of erasing pale skin and clothes.
        rgb=1.0-(1.0-rgb)*(1.0-clamp(max(blur-.38,0.0)*uLookLight.x*1.6,0.0,.95));
        float edge=length(straight(a)-straight(b))+abs(a.a-b.a)+length(straight(c)-straight(d));
        rgb=1.0-(1.0-rgb)*(1.0-clamp(uRimColor*edge*uLookLight.w*1.6,0.0,.95));
      }
      rgb=mix(rgb,uLightColor,(1.0-smoothstep(0.0,.45,uv.y))*uLookLight.y*.85);
      rgb=mix(rgb,vec3(1.0),smoothstep(.45,1.0,uv.y)*uLookLight.z*.75);
      float vignette=smoothstep(.12,.7,length((uv-.5)*vec2(1.0,.85)));
      rgb=mix(rgb,uLookTexture.x>0.0?vec3(0):vec3(1),vignette*abs(uLookTexture.x));
      rgb+=(noise(floor(uv/uTexel))-.5)*uLookTexture.z*.6;
      rgb*=1.0-(.5+.5*sin(uv.y*600.0*3.14159))*uLookTexture.w*.8;
      if(uLookPrint.x>0.0){float dust=step(.997,noise(floor(uv*600.0)));float scratch=step(.998,noise(vec2(floor(uv.x*900.0),3.0)));rgb+=vec3((dust+scratch)*uLookPrint.x);}
      if(uLookPrint.y>0.0){float light=dot(rgb,vec3(.2126,.7152,.0722));float dotSize=3.0+uLookPrint.y*7.0;vec2 grid=fract(uv*vec2(600.0*uTexel.y/uTexel.x,600.0)/dotSize)-.5;float radius=sqrt(clamp(1.0-light,0.0,1.0))*.7;float ink=smoothstep(radius-.04,radius+.04,length(grid));rgb=mix(rgb,vec3(ink),uLookPrint.y);}
      if(uLookPrint.z>0.0){float levels=max(2.0,24.0-uLookPrint.z*22.0);rgb=floor(clamp(rgb,0.0,1.0)*levels+.5)/levels;}
      // Procedural glass uses fixed scene coordinates: no image downloads, extra RAF,
      // or frame-sized CPU textures. The unobstructed centre keeps faces readable.
      if(uGlass.x>0.0){
        vec2 p=uv*vec2(24.0*uTexel.y/uTexel.x,24.0),cell=floor(p);
        vec2 q=fract(p)-vec2(.25+.5*noise(cell),.25+.5*noise(cell+9.0));
        float d=length(q*vec2(1.6,.82));
        float bead=smoothstep(.29,.25,d)-smoothstep(.25,.19,d);
        float trail=(1.0-smoothstep(.015,.04,abs(q.x)))*smoothstep(-.48,-.2,q.y)*(1.0-smoothstep(-.18,0.0,q.y));
        float edge=smoothstep(.15,.55,length((uv-.5)*vec2(1.0,.7)));
        rgb+=vec3(.64,.82,1.0)*(bead*.32+trail*.1)*step(.35,noise(cell+3.0))*uGlass.x*(.2+.8*edge);
      }
      if(uGlass.y>0.0){
        float edge=1.0-smoothstep(0.0,.2,min(min(uv.x,1.0-uv.x),min(uv.y,1.0-uv.y)));
        vec2 p=uv*vec2(12.0*uTexel.y/uTexel.x,12.0),cell=floor(p);
        vec2 q=fract(p)-.5-vec2(noise(cell)-.5,noise(cell+2.0)-.5)*.3;
        float angle=mod(atan(q.y,q.x)+noise(cell+5.0)*6.28,1.0472)-.5236;
        q=vec2(cos(angle),abs(sin(angle)))*length(q);
        float radius=.22+noise(cell+7.0)*.2;
        float d=iceSegment(q,vec2(0),vec2(radius,0));
        for(int i=1;i<4;i++){float root=radius*float(i)/4.0;d=min(d,iceSegment(q,vec2(root,0),vec2(root+.07,.08)));}
        float crystal=1.0-smoothstep(.003,.012,d);
        float frost=edge*edge*(.06+crystal*.75)*(.4+.6*noise(cell))*uGlass.y;
        rgb=mix(rgb,vec3(.88,.95,1.0),clamp(frost,0.0,.85));
      }
      rgb=mix(before,rgb,mixAmount);
      // Keep the original silhouette/alpha; chromatic samples never darken transparent edges.
      outColor = vec4(clamp(rgb,0.0,1.0)*original.a,original.a);
    }
`;

  const shaders = [];
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`合成着色器编译失败：${message}`);
    }
    shaders.push(shader);
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program);
    shaders.forEach((shader) => gl.deleteShader(shader));
    gl.deleteProgram(program);
    throw new Error(`合成程序链接失败：${message}`);
  }
  shaders.forEach((shader) => gl.deleteShader(shader));

  // Reuse a graded framebuffer for animated FX while the character is paused.
  // Keeping the pass separate avoids inlining the large static filter graph four times.
  const fxProgram = gl.createProgram(); shaders.length = 0;
  gl.attachShader(fxProgram, compile(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(fxProgram, compile(gl.FRAGMENT_SHADER, fxSource)); gl.linkProgram(fxProgram);
  if (!gl.getProgramParameter(fxProgram, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(fxProgram));
  shaders.forEach(shader => gl.deleteShader(shader));
  const fxUniform = Object.fromEntries(['uBase','uFx','uFxTime','uFxStrength','uFxDensity','uFxDetail','uNeonDetail','uFxColor','uFxEnabled','uLookColor','uLookLight','uLookTexture','uLookPrint','uGlass','uLightColor','uRimColor','uTexel'].map(name => [name,gl.getUniformLocation(fxProgram,name)]));
  // Two separable quarter-resolution passes make diffusion continuous instead of
  // sampling a visibly sparse cross. Paused actors reuse the result by revision.
  const blurSource=`#version 300 es
    precision highp float;in vec2 vUv;out vec4 outColor;
    uniform sampler2D uSource;uniform vec2 uStep;
    void main(){
      outColor=texture(uSource,vUv)*.227027;
      outColor+=(texture(uSource,vUv+uStep*1.384615)+texture(uSource,vUv-uStep*1.384615))*.316216;
      outColor+=(texture(uSource,vUv+uStep*3.230769)+texture(uSource,vUv-uStep*3.230769))*.070270;
    }`;
  const blurProgram=gl.createProgram();shaders.length=0;
  gl.attachShader(blurProgram,compile(gl.VERTEX_SHADER,vertexSource));gl.attachShader(blurProgram,compile(gl.FRAGMENT_SHADER,blurSource));gl.linkProgram(blurProgram);
  if(!gl.getProgramParameter(blurProgram,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(blurProgram));
  shaders.forEach(shader=>gl.deleteShader(shader));
  const blurUniform={source:gl.getUniformLocation(blurProgram,'uSource'),step:gl.getUniformLocation(blurProgram,'uStep')};
  const blurFramebuffer=gl.createFramebuffer();
  const vao = gl.createVertexArray();
  const vertices = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'aPosition');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const createTexture = () => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    return texture;
  };
  const baseTexture = createTexture(), framebuffer = gl.createFramebuffer();
  let baseDirty = true, bufferWidth = 0, bufferHeight = 0;
  const modelTexture = createTexture();
  const backgroundTexture = createTexture();
  const underlayTexture = createTexture();
  const uniform = Object.fromEntries([
    'uModel', 'uBackground', 'uUnderlay', 'uLayerBlur','uHasLayerBlur', 'uHasUnderlay', 'uResolution', 'uImageSize', 'uColor', 'uColor2', 'uPan',
    'uScale', 'uStrength', 'uExposure', 'uSaturation', 'uFilter', 'uBackgroundType', 'uGradeBackground', 'uParams', 'uInkA', 'uInkB', 'uFx', 'uFxTime', 'uFxStrength', 'uFxDensity',
  ].map((name) => [name, gl.getUniformLocation(program, name)]));
  const filters = FILTER_DEFINITIONS.map((filter) => filter.id);
  const backgroundTypes = ['transparent', 'color', 'gradient', 'image'];
  const scene = {
    filter: 'original', strength: 1, exposure: 0, saturation: 1, gradeBackground: false,
    look:normalizeLook(), filterParams: {}, effects: normalizeEffects(), effectTime: 0,
    underlay: null, underlayVersion: 0,
    background: { type: 'transparent', color: '#ffffff', color2: '#d9d4ef', image: null, scale: 1, x: 0, y: 0 },
  };
  let disposed = false, draws = 0, modelUploads = 0, blurPasses = 0;
  const layerTextures = new Map(), blank = document.createElement('canvas'); blank.width = blank.height = 1;
  let lastStack = null;
  let sourceWidth = 0;
  let sourceHeight = 0;
  let backgroundImage = null;
  let backgroundWidth = 0;
  let backgroundHeight = 0;
  let underlayDirty = false;
  let underlayWidth = 0;
  let underlayHeight = 0;

  const clamp = (value, min, max, fallback) => Number.isFinite(Number(value))
    ? Math.min(max, Math.max(min, Number(value))) : fallback;
  const color = (hex) => {
    let text = String(hex).replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(text)) text = [...text].map((digit) => digit + digit).join('');
    if (!/^[0-9a-f]{6}$/i.test(text)) text = 'ffffff';
    return [0, 2, 4].map((offset) => Number.parseInt(text.slice(offset, offset + 2), 16) / 255);
  };

  /** Width and height are backing-buffer pixels; the UI owns CSS dimensions. */
  function resize(width, height) {
    if (disposed) return;
    const limit = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    const w = Math.max(1, Math.round(Number(width) || 1));
    const h = Math.max(1, Math.round(Number(height) || 1));
    const ratio = Math.min(1, limit / w, limit / h);
    const nextWidth = Math.max(1, Math.floor(w * ratio));
    const nextHeight = Math.max(1, Math.floor(h * ratio));
    if (canvas.width !== nextWidth) canvas.width = nextWidth;
    if (canvas.height !== nextHeight) canvas.height = nextHeight;
    if (bufferWidth !== canvas.width || bufferHeight !== canvas.height) {
      bufferWidth = canvas.width; bufferHeight = canvas.height;
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, baseTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, bufferWidth, bufferHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, baseTexture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('画面缓存未能分配，请降低预览尺寸。');
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); baseDirty = true;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  /**
   * Merge a scene patch, including partial background updates. A changed underlay
   * reference/version uploads once on the next draw. Passing only { underlay }
   * explicitly refreshes that canvas, even if its identity has not changed.
   */
  function setScene(partial = {}) {
    if (disposed) return;
    if (filters.includes(partial.filter) && partial.filter !== scene.filter) {
      scene.filter = partial.filter; scene.filterParams = getFilterDefaults(scene.filter);
    }
    if (Object.keys(partial).some(key => !['effects','effectTime','look'].includes(key))) baseDirty = true;
    if (partial.look) {
      const next=normalizeLook(partial.look);
      if(['groundEnabled','ground','ground2'].some(key=>next[key]!==scene.look[key]))baseDirty=true;
      scene.look=next;
    }
    if (partial.effects) scene.effects = normalizeEffects(partial.effects);
    if (Number.isFinite(partial.effectTime)) scene.effectTime = partial.effectTime;
    if (partial.filterParams) scene.filterParams = normalizeFilterParams(scene.filter, { ...scene.filterParams, ...partial.filterParams });
    for (const [name, min, max] of [['strength', 0, 1], ['exposure', -3, 3], ['saturation', 0, 3]]) {
      if (name in partial) scene[name] = clamp(partial[name], min, max, scene[name]);
    }
    if ('gradeBackground' in partial) scene.gradeBackground = Boolean(partial.gradeBackground);
    if ('underlay' in partial) {
      const changed = partial.underlay !== scene.underlay;
      scene.underlay = partial.underlay ?? null;
      if (changed || !('underlayVersion' in partial)) underlayDirty = true;
    }
    if ('underlayVersion' in partial && partial.underlayVersion !== scene.underlayVersion) {
      scene.underlayVersion = partial.underlayVersion;
      underlayDirty = true;
    }
    if (partial.background) {
      const patch = partial.background;
      if (backgroundTypes.includes(patch.type)) scene.background.type = patch.type;
      for (const name of ['color', 'color2', 'image']) if (name in patch) scene.background[name] = patch[name];
      for (const [name, min, max] of [['scale', 1, 4], ['x', -1, 1], ['y', -1, 1]]) {
        if (name in patch) scene.background[name] = clamp(patch[name], min, max, scene.background[name]);
      }
    }
  }

  /**
   * Draw synchronously after the source renderer finishes its frame. Images must
   * be local or CORS-readable; no asynchronous decoding or animation is started.
   */
  function draw(sourceCanvas, pass = {}) {
    if (!pass.deferFX) lastStack = null;
    if (disposed || (!sourceCanvas && !sourceWidth) || gl.isContextLost()) return;
    draws++;
    if (!sourceCanvas && !baseDirty) { drawEffectPass(); return; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    if (pass.overlay) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); } else gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.activeTexture(gl.TEXTURE0);
    let cached = pass.cacheId && layerTextures.get(pass.cacheId);
    if (pass.cacheId && !cached) { cached = { texture: createTexture(),width:0,height:0 }; layerTextures.set(pass.cacheId, cached); }
    gl.bindTexture(gl.TEXTURE_2D, cached?.texture || modelTexture);
    if (sourceCanvas && (!cached || cached.revision !== pass.revision || cached.width !== sourceCanvas.width || cached.height !== sourceCanvas.height)) {
    modelUploads++;
    if ((cached?.width ?? sourceWidth) !== sourceCanvas.width || (cached?.height ?? sourceHeight) !== sourceCanvas.height) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
      sourceWidth = sourceCanvas.width;
      sourceHeight = sourceCanvas.height;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
    }
      if (cached) Object.assign(cached, {revision:pass.revision,width:sourceCanvas.width,height:sourceCanvas.height});
    }
    const diffuse = cached && !pass.ungraded && scene.strength > 0 && ['soft','watercolor','neon'].includes(scene.filter);
    if(diffuse) prepareDiffusion(cached);
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.useProgram(program);gl.bindVertexArray(vao);
    if(pass.overlay){gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);}else gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,cached?.texture || modelTexture);
    gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,diffuse ? cached.blurB : modelTexture);
    gl.uniform1i(uniform.uLayerBlur,4);gl.uniform1i(uniform.uHasLayerBlur,diffuse ? 1 : 0);
    const bg = pass.overlay ? {...scene.background,type:'transparent'} : scene.look.groundEnabled
      ? {...scene.background,type:'gradient',color:scene.look.ground,color2:scene.look.ground2,image:null} : scene.background;
    const image = bg.image;
    const imageReady = image && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, backgroundTexture);
    if (imageReady && (backgroundImage !== image || backgroundWidth !== image.naturalWidth || backgroundHeight !== image.naturalHeight)) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      backgroundImage = image;
      backgroundWidth = image.naturalWidth;
      backgroundHeight = image.naturalHeight;
    }
    const underlay = scene.underlay;
    const hasUnderlay = !pass.overlay && !pass.backgroundOnly && Boolean(underlay?.width && underlay?.height);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, underlayTexture);
    // Size changes also invalidate a reused canvas, including high-resolution
    // export typography. Static titles add no per-frame texture upload.
    if (hasUnderlay && (underlayDirty || underlayWidth !== underlay.width || underlayHeight !== underlay.height)) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, underlay);
      underlayWidth = underlay.width;
      underlayHeight = underlay.height;
      underlayDirty = false;
    }
    const fx = scene.effects;
    gl.uniform1i(uniform.uFx, ['none','crt','glitch','neon'].indexOf(fx.type) > 0 ? ['none','crt','glitch','neon'].indexOf(fx.type) : 0);
    gl.uniform1f(uniform.uFxTime, scene.effectTime * fx.speed);
    gl.uniform1f(uniform.uFxStrength, fx.strength);
    gl.uniform1f(uniform.uFxDensity, fx.count / 64);
    gl.uniform1i(uniform.uModel, 0);
    gl.uniform1i(uniform.uBackground, 1);
    gl.uniform1i(uniform.uUnderlay, 2);
    gl.uniform1i(uniform.uHasUnderlay, hasUnderlay ? 1 : 0);
    gl.uniform2f(uniform.uResolution, canvas.width, canvas.height);
    gl.uniform2f(uniform.uImageSize, backgroundWidth || 1, backgroundHeight || 1);
    gl.uniform3fv(uniform.uColor, color(bg.color));
    gl.uniform3fv(uniform.uColor2, color(bg.color2));
    gl.uniform2f(uniform.uPan, bg.x, bg.y);
    gl.uniform1f(uniform.uScale, bg.scale);
    gl.uniform1f(uniform.uStrength, scene.strength);
    gl.uniform1f(uniform.uExposure, pass.ungraded ? 0 : scene.exposure);
    gl.uniform1f(uniform.uSaturation, pass.ungraded ? 1 : scene.saturation);
    gl.uniform1i(uniform.uFilter, pass.ungraded ? 0 : filters.indexOf(scene.filter));
    const controls = getFilterDefinition(scene.filter).controls;
    const values = controls.filter((control) => control.type === 'range').map((control) => scene.filterParams[control.key] ?? control.default);
    const inks = controls.filter((control) => control.type === 'color').map((control) => color(scene.filterParams[control.key] ?? control.default));
    gl.uniform4fv(uniform.uParams, [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0]);
    gl.uniform3fv(uniform.uInkA, inks[0] ?? [1, 1, 1]);
    gl.uniform3fv(uniform.uInkB, inks[1] ?? [0, 0, 0]);
    gl.uniform1i(uniform.uBackgroundType, bg.type === 'image' && !imageReady ? 1 : backgroundTypes.indexOf(bg.type));
    gl.uniform1i(uniform.uGradeBackground, !pass.overlay && scene.gradeBackground ? 1 : 0);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    baseDirty = false; if (!pass.deferFX) drawEffectPass();
  }

  function prepareDiffusion(layer) {
    const w=Math.max(1,Math.ceil(canvas.width/4)),h=Math.max(1,Math.ceil(canvas.height/4));
    const radius=scene.filter==='soft' ? scene.filterParams.radius*1.6 : scene.filter==='watercolor' ? 1+scene.filterParams.wash*5 : 5;
    const key=`${layer.revision}/${w}/${h}/${radius}`;if(layer.blurKey===key)return;
    gl.disable(gl.BLEND);gl.useProgram(blurProgram);gl.bindVertexArray(vao);
    if(!layer.blurA){layer.blurA=createTexture();layer.blurB=createTexture();}
    if(layer.blurW!==w||layer.blurH!==h){
      for(const texture of [layer.blurA,layer.blurB]){gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);}
      layer.blurW=w;layer.blurH=h;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,blurFramebuffer);gl.viewport(0,0,w,h);gl.uniform1i(blurUniform.source,0);
    for(const [source,target,x,y] of [[layer.texture,layer.blurA,radius/600*canvas.height/canvas.width,0],[layer.blurA,layer.blurB,0,radius/600]]){
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,source);gl.uniform2f(blurUniform.step,x,y);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);blurPasses++;
    }
    layer.blurKey=key;
  }
  function releaseLayer(layer){for(const texture of [layer.texture,layer.blurA,layer.blurB])if(texture)gl.deleteTexture(texture);}

  /** One GPU compositor, arbitrary actor/text order. Static layer textures upload only on revision. */
  function drawLayers(layers) {
    if (disposed) return;
    lastStack = layers;
    const wanted = new Set(layers.map(layer => layer.id));
    for (const [id, cached] of layerTextures) if (!wanted.has(id)) { releaseLayer(cached); layerTextures.delete(id); }
    draw(blank, {deferFX:true,backgroundOnly:true});
    for (const layer of layers) draw(layer.canvas, {deferFX:true,overlay:true,ungraded:layer.kind === 'text',cacheId:layer.id,revision:layer.revision});
    drawEffectPass();
  }

  function drawEffectPass() {
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.useProgram(fxProgram); gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, baseTexture);
    const fx = scene.effects, mode = ['none','crt','glitch','neon'].indexOf(fx.type);
    gl.uniform1i(fxUniform.uBase, 3); gl.uniform1i(fxUniform.uFx, Math.max(0, mode));
    gl.uniform1f(fxUniform.uFxTime, scene.effectTime * fx.speed);
    gl.uniform1f(fxUniform.uFxStrength, fx.strength); gl.uniform1f(fxUniform.uFxDensity, fx.count / 64);
    const enabled=fx.enabled??[fx.type];
    const analog=effectDetails({...fx,type:enabled.includes('glitch')?'glitch':'crt'}), crt=effectDetails({...fx,type:'crt'}), neon=effectDetails({...fx,type:'neon'});
    gl.uniform4f(fxUniform.uFxDetail,analog.chroma,analog.jitter,crt.scan,0);
    gl.uniform2f(fxUniform.uNeonDetail,neon.spread,neon.pulse);
    gl.uniform3fv(fxUniform.uFxColor,color(fx.colors?.neon??(fx.type==='neon'?fx.color:'#ef8dd1')));
    gl.uniform3f(fxUniform.uFxEnabled,...['crt','glitch','neon'].map(id=>enabled.includes(id)?1:0));
    const l=scene.look;
    gl.uniform4f(fxUniform.uLookColor,l.contrast,l.warmth,l.tint,l.mix);
    gl.uniform4f(fxUniform.uLookLight,l.bloom,l.bottomLight,l.topLight,l.rim);
    gl.uniform4f(fxUniform.uLookTexture,l.vignette,l.chroma,l.grain,l.scan);
    gl.uniform4f(fxUniform.uLookPrint,l.dust,l.halftone,l.posterize,l.pixel);
    gl.uniform2f(fxUniform.uGlass,l.drops,l.frost);
    gl.uniform3fv(fxUniform.uLightColor,color(l.lightColor));gl.uniform3fv(fxUniform.uRimColor,color(l.rimColor));
    gl.uniform2f(fxUniform.uTexel,1/canvas.width,1/canvas.height);
    gl.viewport(0,0,canvas.width,canvas.height); gl.drawArrays(gl.TRIANGLE_STRIP,0,4); gl.flush();
  }

  function getScene() { return { ...scene, filterParams: { ...scene.filterParams }, background: { ...scene.background } }; }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const cached of layerTextures.values()) releaseLayer(cached); layerTextures.clear();
    gl.deleteTexture(modelTexture);
    gl.deleteTexture(backgroundTexture);
    gl.deleteTexture(underlayTexture);
    gl.deleteBuffer(vertices);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(program); gl.deleteProgram(fxProgram);gl.deleteProgram(blurProgram);gl.deleteFramebuffer(blurFramebuffer); gl.deleteTexture(baseTexture); gl.deleteFramebuffer(framebuffer);
  }

  resize(canvas.width || 1, canvas.height || 1);
  return { resize, setScene, draw, drawLayers, drawCached(time) { if (Number.isFinite(time)) scene.effectTime = time; if (lastStack && baseDirty) drawLayers(lastStack); else if (lastStack) { draws++; drawEffectPass(); } else draw(null); }, dispose, getScene, getStats: () => ({ draws, modelUploads, blurPasses, cachedLayers:layerTextures.size }) };
}
