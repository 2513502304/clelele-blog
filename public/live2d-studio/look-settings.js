/** Shared recipe vocabulary. Zero is neutral; old documents therefore retain their exact appearance. */
export const LOOK_CONTROLS = [
 ['color','色彩',[['contrast','对比度',-1,2,0],['warmth','色温',-1,1,0],['tint','青绿 / 洋红',-1,1,0]]],
 ['light','光感',[['bloom','高光柔晕',0,1,0],['bottomLight','底部染光',0,1,0],['topLight','顶部柔光',0,1,0],['rim','轮廓发光',0,1,0]]],
 ['texture','质感',[['vignette','暗角 / 四周提亮',-1,1,0],['chroma','色彩分离',0,1,0],['grain','胶片颗粒',0,1,0],['scan','扫描线',0,1,0],['dust','灰尘划痕',0,1,0],['halftone','网点',0,1,0],['posterize','色阶分离',0,1,0],['pixel','像素块',0,1,0]]],
 ['glass','镜头介质',[['drops','玻璃雨痕',0,1,0],['frost','边缘冰晶',0,1,0]]],
];
export const LOOK_DEFAULTS = Object.freeze({ mix:1,contrast:0,warmth:0,tint:0,bloom:0,bottomLight:0,topLight:0,rim:0,vignette:0,chroma:0,grain:0,scan:0,dust:0,halftone:0,posterize:0,pixel:0,lightColor:'#ec87b8',rimColor:'#79e1ec' });
export function normalizeLook(value={}) {
 const result={...LOOK_DEFAULTS};
 for(const [key,,min,max,def] of [...LOOK_CONTROLS.flatMap(g=>g[2]),['mix','',0,1,1]]) result[key]=Number.isFinite(Number(value[key]))?Math.max(min,Math.min(max,Number(value[key]))):def;
 for(const key of ['lightColor','rimColor','ground','ground2']) if(/^#[a-f\d]{6}$/i.test(value[key]))result[key]=value[key];
 result.groundEnabled=value.groundEnabled===true;result.ground??='#171b2a';result.ground2??='#342737';
 return result;
}
/** Recipes only set common controls; every component remains independently editable. */
export const LOOK_RECIPES = [
 {id:'blossom',name:'春樱日记',color:'#f0d3de',filter:'soft',params:{radius:2.8,glow:.45,warmth:.2},look:{groundEnabled:true,ground:'#d5ddef',ground2:'#f5cadd',warmth:.08,bloom:.18,vignette:-.18},effects:['sakura','bokeh'],strength:.8},
 {id:'rainroom',name:'冷雨放映室',color:'#263d54',filter:'night',params:{depth:.75,rim:.28,tint:'#789dc7'},look:{groundEnabled:true,ground:'#080e1b',ground2:'#242436',warmth:-.15,contrast:.12,topLight:.1,drops:.85,vignette:.35},effects:['rain'],effectSettings:{count:100,speed:1.2,strength:.85,details:{rain:{length:1.8,wind:.55,ripples:.45}}},strength:.85},
 {id:'moon',name:'雪夜来信',color:'#c6cced',filter:'night',look:{groundEnabled:true,ground:'#0a1325',ground2:'#202b49',frost:.9,bloom:.18,topLight:.12,rim:.22,lightColor:'#789ad2'},effects:['snow','bokeh'],effectSettings:{colors:{bokeh:'#a7c9ef'},count:46,speed:.45,strength:.7},strength:.8},
 {id:'arcade',name:'千禧电玩',color:'#7d51bb',filter:'original',look:{groundEnabled:true,ground:'#181226',ground2:'#45315b',contrast:.35,chroma:.5,scan:.65,posterize:.35,bottomLight:.4},effects:['crt','neon'],strength:1},
 {id:'impact',name:'漫画一瞬',color:'#efdfaa',filter:'manga',look:{contrast:.25,grain:.15},effects:['speedlines'],strength:1},
 {id:'polaroid',name:'日落拍立得',color:'#deaa85',filter:'film',look:{warmth:.55,grain:.3,vignette:.35,dust:.28},effects:['leak'],strength:.8},
 {id:'dream',name:'紫雾梦境',color:'#d2bcdf',filter:'soft',look:{groundEnabled:true,ground:'#c9b0e1',ground2:'#edd8e8',tint:.3,bloom:.7,vignette:-.55,bottomLight:.45,lightColor:'#c090ed'},effects:['bokeh','sparkle'],strength:.85},
 {id:'signal',name:'失联信号',color:'#536173',filter:'original',look:{groundEnabled:true,ground:'#11131c',ground2:'#352238',contrast:.25,chroma:.14,scan:.24,grain:.18},effects:['glitch','crt'],effectSettings:{count:30,speed:.8,strength:1,details:{glitch:{chroma:2.5,jitter:3},crt:{scan:2}}},strength:1},
 {id:'aurora',name:'极光回声',color:'#34828c',filter:'night',look:{groundEnabled:true,ground:'#071d32',ground2:'#291e45',rim:.42,rimColor:'#64eddb',bloom:.15},effects:['aurora','sparkle'],effectSettings:{color:'#63dac9',count:28,speed:.45,strength:.9},strength:.65},
 {id:'confetti',name:'彩纸安可',color:'#de6f91',filter:'original',look:{groundEnabled:true,ground:'#f4c1d3',ground2:'#f8e4a3',warmth:.1,bloom:.12},effects:['confetti'],effectSettings:{count:94,speed:.65,strength:1},strength:1},
 {id:'print',name:'独立印刷',color:'#b4c8bd',filter:'original',look:{groundEnabled:true,ground:'#eee4cc',ground2:'#d8cdb3',contrast:.35,halftone:.88,grain:.1,posterize:.25},effects:['speedlines'],effectSettings:{color:'#344d48',count:38,speed:.4,strength:.65,details:{speedlines:{gap:.42,size:2.4,pulse:.4}}},strength:1},
 {id:'nightstage',name:'安可之后',color:'#94579e',filter:'night',look:{groundEnabled:true,ground:'#170f28',ground2:'#402348',bottomLight:.24,lightColor:'#df58ac',rim:.65,rimColor:'#77ece3',bloom:.25},effects:['neon','bokeh'],effectSettings:{count:24,speed:.55,strength:.8,colors:{bokeh:'#e967c2'}},strength:.55},
];
