/** Local OFL display faces. CJK unicode subsets load only for visible/used glyphs. */
export const FONT_OPTIONS = [
  { id: 'serif', name: '高对比衬线 · Bodoni Moda', label: '高对比衬线', labelEn: 'Editorial serif', family: 'Poster Bodoni Moda', weight: 700 },
  { id: 'condensed', name: '窄体刊头 · Barlow Condensed', label: '窄体刊头', labelEn: 'Condensed headline', family: 'Poster Barlow Condensed', weight: 800 },
  { id: 'script', name: '手写签名 · Allura', label: '手写签名', labelEn: 'Handwritten signature', family: 'Poster Allura', weight: 400 },
  { id: 'rounded', name: '柔圆标题 · Fredoka', label: '柔圆标题', labelEn: 'Rounded title', family: 'Poster Fredoka', weight: 600 },
  { id:'xiaowei',name:'小薇宋体 · ZCOOL XiaoWei',label:'小薇宋体',labelEn:'XiaoWei serif',family:'ZCOOL XiaoWei',weight:400 },
  { id:'kuaile',name:'快乐体 · ZCOOL KuaiLe',label:'快乐体',labelEn:'KuaiLe display',family:'ZCOOL KuaiLe',weight:400 },
  { id:'brush',name:'毛笔 · Ma Shan Zheng',label:'毛笔手书',labelEn:'Brush lettering',family:'Ma Shan Zheng',weight:400 },
  { id:'chill',name:'寒蝉全圆体',label:'中文圆体',labelEn:'Chill rounded',family:'寒蝉全圆体',weight:400 },
];
const textLayer = (id, text, font, size, x, y, options = {}) => ({
  id, text, font, size, x, y, color: '#ffffff', rotation: 0, opacity: 1,
  placement: 'front', align: 'left', tracking: 0, lineHeight: 1.05, style: 'fill', ...options,
});

/**
 * Original editable layouts. Actor x/y are NDC camera offsets, not CSS positions.
 * Text x/y are normalized anchor coordinates; size is relative to canvas height.
 * tracking is in em, rotation is in degrees, and lineHeight is a font-size ratio.
 */
export const POSTER_PRESETS = [
  {
    id: 'duo', name: '粉雾双人封面', nameEn: 'Pink mist duet', description: '粉雾与淡紫，大幅衬线刊头藏在人物身后。', descriptionEn: 'Pink and lavender with a large serif masthead behind the portraits.', ratio: '4:5',
    background: { type: 'gradient', color: '#f5e4ed', color2: '#ded6f1', image: null, scale: 1, x: 0, y: 0 },
    actors: [{ zoom: 2.15, x: -0.43, y: -1.0524 }, { zoom: 2.152529, x: 0.42, y: -1.067177 }],
    layers: [
      { id: 'pink-title', text: 'OUR\nMOMENT', font: 'serif', color: '#735267', size: 0.166, x: 0.06, y: 0.075, rotation: 0, opacity: 0.88, placement: 'back', align: 'left', tracking: -0.035, lineHeight: 0.86, style: 'fill' },
      { id: 'pink-issue', text: 'THE PORTRAIT ISSUE    /    VOL. 01', font: 'condensed', color: '#715566', size: 0.017, x: 0.068, y: 0.034, rotation: 0, opacity: 1, placement: 'front', align: 'left', tracking: 0.13, style: 'fill' },
      { id: 'pink-signature', text: 'a quiet duet', font: 'script', color: '#fffafc', size: 0.074, x: 0.9, y: 0.805, rotation: -8, opacity: 1, placement: 'front', align: 'right', tracking: 0, style: 'shadow' },
      { id: 'pink-footer', text: 'SMALL DAYS, SHARED WITH YOU', font: 'rounded', color: '#705367', size: 0.017, x: 0.5, y: 0.943, rotation: 0, opacity: 1, placement: 'front', align: 'center', tracking: 0.1, style: 'fill' },
    ],
  },
  {
    id: 'solo', name: '薄荷独奏', nameEn: 'Mint solo', description: '留白、细长字形与偏右人物，一张轻盈的独奏唱片。', descriptionEn: 'A light solo cover with open space and a condensed title.', ratio: '3:4',
    background: { type: 'gradient', color: '#d5eee7', color2: '#f2faf3', image: null, scale: 1, x: 0, y: 0 },
    actors: [{ zoom: 2.3, x: 0.3, y: -1.12 }],
    layers: [
      { id: 'mint-title', text: 'MINT\nDAY', font: 'condensed', color: '#426f64', size: 0.245, x: 0.065, y: 0.075, rotation: 0, opacity: 0.87, placement: 'back', align: 'left', tracking: -0.025, lineHeight: 0.82, style: 'fill' },
      { id: 'mint-side', text: 'A SOLO PORTRAIT    /    02', font: 'rounded', color: '#52796d', size: 0.015, x: 0.945, y: 0.08, rotation: 90, opacity: 0.9, placement: 'front', align: 'left', tracking: 0.12, style: 'fill' },
      { id: 'mint-signature', text: 'softly, now', font: 'script', color: '#fafff8', size: 0.08, x: 0.88, y: 0.805, rotation: -8, opacity: 1, placement: 'front', align: 'right', tracking: 0, style: 'shadow' },
      { id: 'mint-footer', text: 'A LITTLE SPACE TO BREATHE', font: 'condensed', color: '#426f64', size: 0.018, x: 0.07, y: 0.943, rotation: 0, opacity: 1, placement: 'front', align: 'left', tracking: 0.16, style: 'fill' },
    ],
  },
  {
    id: 'editorial', name: '奶油双人刊物', nameEn: 'Cream portrait journal', description: '奶油纸色、酒红刊头与柔圆小字，像一册私藏的人物杂志。', descriptionEn: 'Cream paper, a burgundy masthead and rounded cover lines.', ratio: '4:5',
    background: { type: 'gradient', color: '#f7eee7', color2: '#eee2cf', image: null, scale: 1, x: 0, y: 0 },
    actors: [{ zoom: 1.8, x: -0.40, y: -0.8048 }, { zoom: 1.802118, x: 0.37, y: -0.817171 }],
    layers: [
      { id: 'cream-title', text: 'SUNDAY', font: 'serif', color: '#a04b60', size: 0.151, x: 0.5, y: 0.065, rotation: 0, opacity: 1, placement: 'back', align: 'center', tracking: -0.035, style: 'fill' },
      { id: 'cream-issue', text: 'A JOURNAL OF LITTLE THINGS    •    NO. 03', font: 'condensed', color: '#a04b60', size: 0.015, x: 0.5, y: 0.037, rotation: 0, opacity: 1, placement: 'front', align: 'center', tracking: 0.12, style: 'fill' },
      { id: 'cream-round', text: 'Better\ntogether.', font: 'rounded', color: '#fff7ef', size: 0.063, x: 0.08, y: 0.73, rotation: -5, opacity: 1, placement: 'front', align: 'left', tracking: -0.025, lineHeight: 1.02, style: 'shadow' },
      { id: 'cream-signature', text: 'with love', font: 'script', color: '#a04b60', size: 0.072, x: 0.91, y: 0.865, rotation: -8, opacity: 1, placement: 'front', align: 'right', tracking: 0, style: 'fill' },
    ],
  },
  {
    id: 'nocturne', name: '午夜演出', nameEn: 'After hours', description: '靛蓝舞台、荧光描边刊头与一行手写安可。', descriptionEn: 'An indigo stage, an outlined masthead and a handwritten encore.', ratio: '4:5',
    filter: 'night', filterStrength: .45, filterParams: { depth: .6, rim: .32, tint: '#609ccc' },
    background: { type: 'gradient', color: '#172b3e', color2: '#3a2550', image: null, scale: 1, x: 0, y: 0 },
    actors: [{ zoom: 2.05, x: -0.42, y: -1.0688 }, { zoom: 2.052412, x: .42, y: -1.08289 }],
    layers: [
      textLayer('night-title','AFTER\nHOURS','condensed',.207,.055,.07,{ placement:'back', color:'#8fe3d9',style:'outline',tracking:.035,lineHeight:.82 }),
      textLayer('night-issue','LIVE PORTRAITS     /     SIDE B','condensed',.017,.06,.035,{ color:'#c8ede6',tracking:.18 }),
      textLayer('night-signature','one more song','script',.082,.91,.825,{ align:'right',rotation:-7,color:'#faefff',style:'shadow' }),
      textLayer('night-footer','THE LIGHTS GO DOWN. WE STAY.','rounded',.015,.5,.953,{align:'center',tracking:.1,color:'#b1d7df'}),
    ],
  },
  {
    id: 'citrus', name: '柑橘晨光', nameEn: 'Citrus morning', description: '奶橙色的大块留白与圆润标题，适合轻快独照。', descriptionEn: 'Creamy orange space and rounded lettering for an upbeat solo.', ratio: '3:4',
    background: { type: 'gradient', color: '#ffd27a', color2: '#f8e9ac', image: null, scale: 1, x: 0, y: 0 },
    actors: [{ zoom: 2.15, x: .2, y: -1.05 }],
    layers: [
      textLayer('citrus-title','HELLO\nSUNSHINE','rounded',.123,.065,.075,{placement:'back',color:'#b96232',tracking:-.045,lineHeight:.91}),
      textLayer('citrus-number','MORNING CLUB   •   06','condensed',.018,.07,.035,{color:'#a5572d',tracking:.16}),
      textLayer('citrus-script','slow mornings','script',.082,.08,.835,{color:'#fff9e9',rotation:-8,style:'shadow'}),
      textLayer('citrus-footer','TAKE THE SCENIC ROUTE','condensed',.019,.92,.95,{align:'right',color:'#9b5730',tracking:.12}),
    ],
  },
  {
    id: 'monochrome', name: '黑白人物志', nameEn: 'Off-stage zine', description: '大号描边字体、纵向索引与克制的黑白刊物层级。', descriptionEn: 'An oversized outline, vertical index and restrained zine typography.', ratio: '4:5',
    filter: 'noir', filterStrength: 1, filterParams: { contrast: 1.3, grain: .12, vignette: .22 },
    background: { type: 'gradient', color: '#e4e1da', color2: '#f3f2ed', image: null, scale: 1, x: 0, y: 0 },
    actors: [{ zoom: 2.15, x: .13, y: -1.05 }],
    layers: [
      textLayer('mono-title','OFF\nSTAGE','condensed',.235,.055,.065,{placement:'back',color:'#343139',style:'outline',lineHeight:.8,tracking:.03}),
      textLayer('mono-index','PORTRAIT STUDY     /     NO. 07','condensed',.015,.945,.08,{rotation:90,color:'#504b51',tracking:.15}),
      textLayer('mono-caption','THE PERSON\nBEHIND THE SONG.','serif',.044,.07,.81,{color:'#fffaf0',style:'shadow',tracking:-.015,lineHeight:1.08}),
      textLayer('mono-footer','A PERSONAL ARCHIVE','rounded',.014,.93,.956,{color:'#504b51',align:'right',tracking:.18}),
    ],
  },
  {
    id: 'spring-letter', name: '春日来信', nameEn: 'A spring letter', description: '层叠的手写大字、樱粉纸色与简短中文题签。', descriptionEn: 'Layered script, blossom paper and a short Chinese cover line.', ratio: '4:5',
    background: { type: 'gradient', color: '#f4dfe1', color2: '#f5eee1', image: null, scale: 1, x: 0, y: 0 },
    actors: [{ zoom: 2, x: -.4, y: -1.072 }, { zoom: 2.002353, x: .41, y: -1.085746 }],
    layers: [
      textLayer('spring-title','dear,\nspring','script',.225,.085,.045,{placement:'back',color:'#aa6174',lineHeight:.73,rotation:-5}),
      textLayer('spring-tag','LETTERS FROM A SMALL SEASON','condensed',.015,.91,.044,{align:'right',color:'#956375',tracking:.12}),
      textLayer('spring-note','春日来信','rounded',.054,.5,.855,{align:'center',color:'#fff8ed',style:'shadow',tracking:.14}),
      textLayer('spring-footer','SOME MOMENTS ARE WORTH KEEPING.','condensed',.016,.5,.951,{align:'center',color:'#956375',tracking:.1}),
    ],
  },
  {
    id: 'gallery', name: '留白画廊', nameEn: 'A still life', description: '横向画幅、左侧文字栏与右侧人物，像一张展览邀请。', descriptionEn: 'A landscape invitation with a left type column and a right portrait.', ratio: '4:3',
    background: { type: 'gradient', color: '#ede7dc', color2: '#d9ded5', image: null, scale: 1, x: 0, y: 0 },
    actors: [{ zoom: 1.85, x: .52, y: -.65 }],
    layers: [
      textLayer('gallery-title','A\nSTILL\nLIFE','serif',.157,.06,.11,{placement:'back',color:'#48534a',lineHeight:.83,tracking:-.035}),
      textLayer('gallery-rule','PORTRAIT EXHIBITION    /    08','condensed',.023,.06,.055,{color:'#5c665b',tracking:.16}),
      textLayer('gallery-script','ordinary beauty','script',.09,.07,.835,{color:'#677361',rotation:-5}),
      textLayer('gallery-footer','OPEN DAILY.\nSTAY A LITTLE.','rounded',.021,.94,.865,{align:'right',color:'#48534a',tracking:.08,lineHeight:1.3}),
    ],
  },
  {
    id:'blue-note',name:'蓝调独白',nameEn:'Blue note',description:'蓝白窄体刊头与偏左肖像，右侧保留纵向题签。',descriptionEn:'A blue-white masthead, left portrait and a vertical signature.',ratio:'3:4',
    background:{type:'gradient',color:'#b6d5e2',color2:'#dce8ef'},actors:[{zoom:2.2,x:-.17,y:-1.07}],
    layers:[
      textLayer('blue-title','BLUE','condensed',.27,.5,.045,{align:'center',placement:'back',color:'#38738c',tracking:.035}),
      textLayer('blue-side','a note to myself','serif',.066,.94,.26,{rotation:90,color:'#4a8195'}),
      textLayer('blue-issue','PORTRAIT STUDIES    /    09','condensed',.017,.07,.025,{color:'#41677b',tracking:.15}),
      textLayer('blue-footer','In my own time.','script',.087,.08,.85,{color:'#f3faff',style:'shadow'})
    ]
  },
  {
    id:'contrast-duet',name:'冷暖对话',nameEn:'Cool / warm',description:'青绿与砖红对照，人物前后穿插的大字与底部签名。',descriptionEn:'Teal and brick-red type for a two-person conversation.',ratio:'4:5',
    background:{type:'gradient',color:'#e5d5d1',color2:'#c4ddd7'},actors:[{zoom:2.1,x:-.38,y:-1.02},{zoom:2.1,x:.42,y:-1.04}],
    layers:[
      textLayer('contrast-title','YOU\n& ME','serif',.19,.06,.07,{placement:'back',color:'#24625e',tracking:-.05,lineHeight:.8}),
      textLayer('contrast-line','TWO DIFFERENT WAYS TO SHINE','condensed',.016,.08,.035,{color:'#8c4a46',tracking:.13}),
      textLayer('contrast-sign','a conversation','script',.096,.9,.81,{align:'right',rotation:-8,color:'#fff8f0',style:'shadow'}),
      textLayer('contrast-foot','IN GOOD COMPANY   /   10','condensed',.018,.5,.948,{align:'center',color:'#8c4a46',tracking:.1})
    ]
  },
  {
    id:'together',name:'三人合刊',nameEn:'All together',description:'三位人物高低错落，中央主角与大幅刊头组成合刊封面。',descriptionEn:'Three offset portraits with a central lead and an editorial masthead.',ratio:'4:5',
    background:{type:'gradient',color:'#eddfd4',color2:'#dfd7ea'},actors:[{zoom:1.65,x:-.61,y:-.65},{zoom:1.65,x:.6,y:-.65},{zoom:2.0,x:0,y:-1.02}],
    layers:[
      textLayer('trio-title','TOGETHER','condensed',.155,.5,.055,{align:'center',placement:'back',color:'#786078',tracking:.01}),
      textLayer('trio-number','THE COLLECTIVE ISSUE     •     11','condensed',.017,.5,.028,{align:'center',color:'#786078',tracking:.14}),
      textLayer('trio-sign','our kind of days','script',.094,.5,.83,{align:'center',color:'#fff6ed',style:'shadow',rotation:-6}),
      textLayer('trio-foot','MORE THAN THE SUM OF US.','rounded',.017,.5,.952,{align:'center',color:'#786078',tracking:.1})
    ]
  },
  {
    id:'ensemble',name:'横幅群像',nameEn:'The ensemble',description:'宽画幅中的三人群像，底部衬线刊头与小号演出索引。',descriptionEn:'Three portraits in a landscape frame with a serif headline below.',ratio:'16:9',
    background:{type:'gradient',color:'#243a3a',color2:'#776966'},actors:[{zoom:1.8,x:-.64,y:-.7},{zoom:1.8,x:0,y:-.72},{zoom:1.8,x:.64,y:-.7}],
    layers:[
      textLayer('ensemble-issue','PORTRAITS, IN HARMONY.','condensed',.024,.045,.05,{color:'#e3d9b9',tracking:.2}),
      textLayer('ensemble-title','THE ENSEMBLE','serif',.13,.5,.82,{align:'center',color:'#fff1db',tracking:-.025,style:'shadow'}),
      textLayer('ensemble-date','LIVE / 2026','condensed',.022,.95,.05,{align:'right',color:'#e3d9b9',tracking:.12})
    ]
  },

  {
    id:'lavender-duet',name:'紫调合奏',nameEn:'Lavender duet',description:'紫绿对色，错位的衬线大字与柔和双人近景。',descriptionEn:'Offset serif type and violet-green contrast around two close portraits.',ratio:'3:4',
    background:{type:'gradient',color:'#e8c9f5',color2:'#f6e9fb'},actors:[{zoom:2.2,x:-.39,y:-1.12},{zoom:2.2,x:.4,y:-1.07}],
    layers:[textLayer('lavender-head','SOFT','serif',.19,.045,.035,{placement:'back',color:'#315135',tracking:-.035}),textLayer('lavender-second','POWER','serif',.15,.96,.15,{placement:'back',align:'right',color:'#8072bf',tracking:-.03}),textLayer('lavender-sign','in harmony','script',.095,.9,.78,{align:'right',rotation:-9,color:'#946bb8',gradient:true,gradientColor:'#e17dcd'}),textLayer('lavender-foot','TWO VOICES. ONE MOMENT.','condensed',.018,.07,.953,{color:'#315135',tracking:.13})]
  },
  {
    id:'matinee',name:'午后电影票',nameEn:'A matinee',description:'横幅的电影片名、圆角纸签和安静的暖色人物肖像。',descriptionEn:'A warm landscape portrait with cinema titles and a paper label.',ratio:'16:9',
    background:{type:'gradient',color:'#ddae88',color2:'#f2dfb5'},actors:[{zoom:1.75,x:.48,y:-.63}],
    layers:[textLayer('matinee-title','A LITTLE\nAFTERNOON','condensed',.2,.055,.16,{color:'#754834',lineHeight:.88,tracking:-.025}),textLayer('matinee-label','PORTRAIT THEATRE   /   02:30 PM','rounded',.025,.065,.07,{color:'#754834',backgroundShape:'rounded',backgroundColor:'#fff2d7',padding:.25}),textLayer('matinee-sign','stay for a while','script',.12,.06,.79,{color:'#754834'}),textLayer('matinee-date','ONE ADMISSION','condensed',.025,.94,.91,{align:'right',color:'#754834',tracking:.13})]
  },
  {
    id:'electric-zine',name:'电光小志',nameEn:'Electric zine',description:'深墨紫、荧光柠檬黄与海报式粗大字形，搭配三人群像。',descriptionEn:'Ink-violet, electric yellow and oversized typography for three portraits.',ratio:'4:5',
    background:{type:'gradient',color:'#292039',color2:'#5b416b'},actors:[{zoom:1.7,x:-.58,y:-.62},{zoom:1.7,x:.6,y:-.62},{zoom:2.1,x:.02,y:-1.07}],
    layers:[textLayer('zine-title','LOUD','condensed',.3,.5,.03,{placement:'back',align:'center',color:'#e8ef79',tracking:.01}),textLayer('zine-label','IN OUR OWN WAY','rounded',.035,.07,.78,{rotation:-7,color:'#2e203c',backgroundShape:'box',backgroundColor:'#e8ef79',padding:.2}),textLayer('zine-sign','alive, together.','script',.09,.92,.86,{align:'right',color:'#f4c7ee'}),textLayer('zine-index','INDEPENDENT PORTRAITS   /   VOL. 16','condensed',.016,.5,.955,{align:'center',color:'#e8ef79',tracking:.12})]
  },
  {
    id:'sea-letter',name:'海边手札',nameEn:'A sea letter',description:'青蓝留白、右侧小诗与柔和渐变字，给单人肖像留出呼吸。',descriptionEn:'Sea-blue space, a small poem and gradient type around a single portrait.',ratio:'3:4',
    background:{type:'gradient',color:'#b9e2df',color2:'#e8e5ef'},actors:[{zoom:2.1,x:-.25,y:-1.02}],
    layers:[textLayer('sea-title','STILL','condensed',.24,.06,.035,{placement:'back',color:'#458d98',gradient:true,gradientColor:'#8ac4b9'}),textLayer('sea-side','somewhere\nbetween\nthe sea\nand me.','serif',.047,.94,.44,{align:'right',color:'#6c9da6',lineHeight:1.4}),textLayer('sea-sign','a quiet tide','script',.095,.93,.84,{align:'right',color:'#7ca7b3',rotation:-6}),textLayer('sea-index','FIELD NOTES   /   017','condensed',.015,.07,.96,{color:'#537f8a',tracking:.15})]
  },

];

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const bounded = (value, min, max, fallback) => Math.min(max, Math.max(min, finite(value, fallback)));
const fontOption = (id) => FONT_OPTIONS.find((font) => font.id === id) ?? FONT_OPTIONS[0];
const fontString = (font, size, bold=false) => `${bold?Math.max(700,font.weight):font.weight} ${size}px "${font.family}", "寒蝉全圆体", "PingFang SC", sans-serif`;

/**
 * Await this after linking poster-fonts.css and before thumbnails or PNG export.
 * Only requested display faces and the Chinese characters actually used load.
 * No canvas state or module-level loading state is retained.
 */
export async function ensurePosterFonts(layers = []) {
  if (typeof document === 'undefined' || !document.fonts) return;
  const fonts = [...new Set(layers.length ? layers.map((layer) => fontOption(layer.font)) : FONT_OPTIONS)];
  await Promise.all(fonts.map(async (font) => {
    const sample=layers.filter(layer=>layer.font===font.id).map(layer=>layer.text).join('')||'文字 Aa';
    const faces = await document.fonts.load(`${font.weight} 64px "${font.family}"`, sample);
    if (!faces.length) throw new Error(`海报字体尚未注册：${font.family}，请先引用 poster-fonts.css。`);
  }));
  const chinese = [...new Set(layers.map((layer) => String(layer.text ?? '')).join('').match(/[\u3400-\u9fff]/gu) ?? [])].join('');
  if (chinese) await document.fonts.load('400 64px "寒蝉全圆体"', chinese);
}

/**
 * Paint only the requested layer placement. Coordinates and effects scale with
 * the output size, so preview and a rerendered export share the same composition.
 * Rotation is around the text's top anchor; each layer fully restores ctx state.
 */
export function paintTextLayers(ctx, width, height, layers, placement) {
  if (!ctx || width <= 0 || height <= 0 || !Array.isArray(layers)) return;
  for (const layer of layers) {
    if (layer.placement !== placement || layer.hidden || !String(layer.text ?? '').trim()) continue;
    const size = bounded(layer.size, 0.001, 2, 0.08) * height;
    const opacity = bounded(layer.opacity, 0, 1, 1);
    if (opacity === 0) continue;
    const font = fontOption(layer.font);
    const tracking = bounded(layer.tracking, -0.2, 2, 0) * size;
    const lineHeight = bounded(layer.lineHeight, 0.5, 3, font.id === 'script' ? 1.05 : 1.12) * size;
    const align = ['left', 'center', 'right'].includes(layer.align) ? layer.align : 'left';
    const lines = String(layer.text).split(/\r?\n/);
    ctx.save();
    try {
      ctx.translate(finite(layer.x, 0.1) * width, finite(layer.y, 0.1) * height);
      ctx.rotate(finite(layer.rotation, 0) * Math.PI / 180);
      ctx.font = (layer.italic?'italic ':'')+fontString(font, size,layer.bold);
      ctx.textBaseline = 'top';
      ctx.textAlign = align;
      ctx.globalAlpha *= opacity;
      ctx.fillStyle = layer.color || '#ffffff';
      if(layer.gradient){const gradient=ctx.createLinearGradient(0,0,0,size+(lines.length-1)*lineHeight);gradient.addColorStop(0,layer.color||'#fff');gradient.addColorStop(1,layer.gradientColor||'#8785df');ctx.fillStyle=gradient;}
      // Background geometry follows measured line width, alignment and output resolution.
      if(layer.backgroundShape && layer.backgroundShape!=='none'){
        const textWidth=Math.max(...lines.map(line=>ctx.measureText(line).width+Math.max(0,Array.from(line).length-1)*tracking));
        const pad=bounded(layer.padding,0,.5,.16)*size, x=(align==='center'?-textWidth/2:align==='right'?-textWidth:0)-pad;
        const h=size+(lines.length-1)*lineHeight+2*pad,w=textWidth+2*pad;
        ctx.save();ctx.fillStyle=layer.backgroundColor||'#fff0cc';ctx.globalAlpha*=bounded(layer.backgroundOpacity,0,1,.9);
        if(layer.backgroundShape==='marker')ctx.fillRect(x,size*.38,w,h-size*.44);
        else{ctx.beginPath();ctx.roundRect(x,-pad,w,h,layer.backgroundShape==='box'?0:size*.16);ctx.fill();if(layer.backgroundShape==='bubble'){ctx.beginPath();ctx.moveTo(x+w*.17,h-pad);ctx.lineTo(x+w*.17+size*.19,h-pad+size*.24);ctx.lineTo(x+w*.17+size*.38,h-pad);ctx.fill();}}ctx.restore();
      }
      ctx.strokeStyle = layer.color || '#ffffff';
      ctx.lineJoin = 'round';
      const stroke = size * bounded(layer.stroke,0,.25,layer.style==='outline'?.018:.06);
      // Canvas ignores lineWidth=0; skip the stroke call explicitly for a zero-width outline.
      ctx.lineWidth = Math.max(.001, stroke);
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      if (layer.style === 'shadow') {
        ctx.shadowColor = 'rgba(59, 30, 48, 0.27)';
        ctx.shadowBlur = size * 0.095;
        ctx.shadowOffsetX = size * 0.014;
        ctx.shadowOffsetY = size * 0.024;
      }
      if(layer.style==='comic'){ctx.strokeStyle=layer.accent||'#362633';ctx.lineWidth*=2;}
      if(layer.style==='neon'){ctx.shadowColor=layer.accent||layer.color;ctx.shadowBlur=size*bounded(layer.glow,0,.5,.18);}
      if(layer.shadowOpacity>0){ctx.shadowColor=hexShadow(layer.accent||'#362633',bounded(layer.shadowOpacity,0,1,0));ctx.shadowBlur=size*bounded(layer.shadowBlur,0,.6,.1);const angle=finite(layer.shadowAngle,45)*Math.PI/180,distance=size*bounded(layer.shadowDistance,0,.6,.03);ctx.shadowOffsetX=Math.cos(angle)*distance;ctx.shadowOffsetY=Math.sin(angle)*distance;}
      const paint = (text, x, y) => {
        if(layer.style==='comic'&&stroke>0)ctx.strokeText(text,x,y);
        if (layer.style === 'outline') { if(stroke>0)ctx.strokeText(text, x, y); }
        else ctx.fillText(text, x, y);
      };
      lines.forEach((line, lineIndex) => {
        if (!tracking) {
          // A single fillText preserves connected script ligatures and kerning.
          paint(line, 0, lineIndex * lineHeight);
          return;
        }
        const characters = typeof Intl.Segmenter === 'function'
          ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(line), (part) => part.segment)
          : Array.from(line);
        const lengths = characters.map((character) => ctx.measureText(character).width);
        const lineWidth = lengths.reduce((total, length) => total + length, 0) + Math.max(0, characters.length - 1) * tracking;
        let x = align === 'center' ? -lineWidth / 2 : align === 'right' ? -lineWidth : 0;
        ctx.textAlign = 'left';
        characters.forEach((character, index) => {
          paint(character, x, lineIndex * lineHeight);
          x += lengths[index] + tracking;
        });
        ctx.textAlign = align;
      });
    } finally {
      ctx.restore();
    }
  }
}

/** Measure the actual glyph rectangle and rotate its corners into canvas pixels. */
export function getTextLayerBounds(ctx, width, height, layer) {
  if (!ctx || !layer || !String(layer.text ?? '').trim() || layer.hidden || layer.opacity === 0) return null;
  const font = fontOption(layer.font);
  const size = bounded(layer.size, 0.001, 2, 0.08) * height;
  const spacing = bounded(layer.tracking, -0.2, 2, 0) * size;
  const leading = bounded(layer.lineHeight, 0.5, 3, font.id === 'script' ? 1.05 : 1.12) * size;
  const align = ['left', 'center', 'right'].includes(layer.align) ? layer.align : 'left';
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  ctx.save();
  try {
    ctx.font = (layer.italic?'italic ':'')+fontString(font, size,layer.bold); ctx.textBaseline = 'top';
    String(layer.text).split(/\r?\n/).forEach((line, index) => {
      if (!line) return;
      const characters = typeof Intl.Segmenter === 'function'
        ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(line), (part) => part.segment)
        : Array.from(line);
      const widths = characters.map((character) => ctx.measureText(character).width);
      const total = spacing ? widths.reduce((sum, value) => sum + value, 0) + Math.max(0, characters.length - 1) * spacing : ctx.measureText(line).width;
      let x = align === 'right' ? -total : align === 'center' ? -total / 2 : 0;
      ctx.textAlign = 'left';
      const record = (text, at) => {
        const metrics = ctx.measureText(text);
        left = Math.min(left, at - metrics.actualBoundingBoxLeft);
        right = Math.max(right, at + metrics.actualBoundingBoxRight);
        top = Math.min(top, index * leading - metrics.actualBoundingBoxAscent);
        bottom = Math.max(bottom, index * leading + metrics.actualBoundingBoxDescent);
      };
      if (!spacing) record(line, x);
      else characters.forEach((character, characterIndex) => { record(character, x); x += widths[characterIndex] + spacing; });
    });
  } finally { ctx.restore(); }
  if (!Number.isFinite(left)) return null;
  let padding = layer.style === 'shadow' ? size * 0.16 : layer.style==='neon'?size*bounded(layer.glow,0,.5,.18):layer.style==='comic'?size*bounded(layer.stroke,0,.25,.06):layer.style==='outline'?size*bounded(layer.stroke,0,.25,.018)/2:0;
  if(layer.shadowOpacity>0)padding=Math.max(padding,size*(bounded(layer.shadowBlur,0,.6,.1)+bounded(layer.shadowDistance,0,.6,.03)));
  if(layer.backgroundShape&&layer.backgroundShape!=='none')padding=Math.max(padding,size*(bounded(layer.padding,0,.5,.16)+(layer.backgroundShape==='bubble'?.24:0)));
  left -= padding; right += padding; top -= padding; bottom += padding;
  const angle = finite(layer.rotation, 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const corners = [[left, top], [right, top], [right, bottom], [left, bottom]].map(([x, y]) => ({
    x: finite(layer.x, 0.1) * width + x * c - y * s,
    y: finite(layer.y, 0.1) * height + x * s + y * c,
  }));
  const x = Math.min(...corners.map((point) => point.x)), y = Math.min(...corners.map((point) => point.y));
  return { x, y, width: Math.max(...corners.map((point) => point.x)) - x,
    height: Math.max(...corners.map((point) => point.y)) - y, corners, layerId: layer.id, rotation: finite(layer.rotation, 0) };
}

/** Canvas accepts only a bounded RGBA alpha; artwork colors remain independent. */
function hexShadow(hex,alpha){const normalized=/^#[0-9a-f]{6}$/i.test(hex)?hex:'#362633';return `rgba(${parseInt(normalized.slice(1,3),16)},${parseInt(normalized.slice(3,5),16)},${parseInt(normalized.slice(5,7),16)},${alpha})`;}
