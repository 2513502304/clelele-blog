/**
 * Prototype labels grounded in identifiers collected from 261 locally cached native models.
 * `known` names a standard parameter/convention; `literal` translates an identifier without
 * claiming visual verification; `unknown` deliberately retains the exact input ID.
 */
const groups = {
  neutral: ['待机与基础', 'Idle & basics'],
  positive: ['笑容与好感', 'Smiles & affection'],
  negative: ['低落与不安', 'Sadness & unease'],
  anger: ['生气与对抗', 'Anger & conflict'],
  surprise: ['惊讶与疑惑', 'Surprise & uncertainty'],
  attention: ['视线与思考', 'Gaze & thought'],
  gesture: ['回应与手势', 'Responses & gestures'],
  performance: ['演出与特殊动作', 'Performance & special actions'],
  face: ['面部效果', 'Face effects'],
  head: ['头部与身体', 'Head & body'],
  eyes: ['眼睛与视线', 'Eyes & gaze'],
  brows: ['眉毛', 'Brows'],
  mouth: ['嘴部', 'Mouth'],
  arms: ['手臂与手形', 'Arms & hand poses'],
  hair: ['头发与摆动', 'Hair & movement'],
  clothes: ['服装与配饰', 'Clothing & accessories'],
  unknown: ['待确认', 'Unconfirmed'],
};
const result = (zh, en, group, confidence = 'literal') => ({ zh, en,
  groupZh: groups[group][0], groupEn: groups[group][1], confidence });
const unknown = (id) => result(String(id ?? ''), String(id ?? ''), 'unknown', 'unknown');

// These are vocabulary meanings, not a claim that a numbered clip was watched.
const actions = {
  idle: ['待机', 'Idle', 'neutral'], normal: ['平常', 'Neutral', 'neutral'], default: ['默认', 'Default', 'neutral'],
  smile: ['微笑', 'Smile', 'positive'], bsmile: ['灿烂笑容', 'Broad smile', 'positive'],
  happy: ['开心', 'Happy', 'positive'], fun: ['开心', 'Happy', 'positive'], heart: ['心动', 'Smitten', 'positive'],
  cheer: ['欢呼', 'Cheering', 'positive'], grinning: ['咧嘴笑', 'Grinning', 'positive'],
  smirk: ['得意地笑', 'Smirk', 'positive'], motivation: ['干劲十足', 'Motivated', 'positive'],
  kirakira: ['闪亮眼神', 'Sparkling eyes', 'positive'],
  shy: ['害羞', 'Shy', 'negative'], shame: ['难为情', 'Embarrassed', 'negative'],
  sad: ['难过', 'Sad', 'negative'], cry: ['哭泣', 'Crying', 'negative'],
  nervous: ['紧张', 'Nervous', 'negative'], anxiety: ['不安', 'Anxious', 'negative'],
  upset: ['心烦意乱', 'Upset', 'negative'], panic: ['慌张', 'Panicked', 'negative'],
  tired: ['疲惫', 'Tired', 'negative'], pain: ['痛苦', 'In pain', 'negative'],
  dispair: ['绝望', 'Despair', 'negative'], sdeprecate: ['自嘲', 'Self-deprecating', 'negative'],
  absent: ['心不在焉', 'Absent-minded', 'attention'], trance: ['出神', 'In a trance', 'attention'],
  angry: ['生气', 'Angry', 'anger'], mad: ['恼怒', 'Furious', 'anger'],
  envy: ['嫉妒', 'Envious', 'anger'], hatred: ['憎恨', 'Hatred', 'anger'],
  dislike: ['反感', 'Dislike', 'anger'], sneer: ['冷笑', 'Sneer', 'anger'],
  confrict: ['冲突', 'Conflict', 'anger'], kusogaki: ['调皮挑衅', 'Mischievous teasing', 'anger'],
  surprised: ['惊讶', 'Surprised', 'surprise'], surprise: ['惊讶', 'Surprised', 'surprise'],
  amazed: ['惊叹', 'Amazed', 'surprise'], shock: ['震惊', 'Shocked', 'surprise'],
  puzzled: ['困惑', 'Puzzled', 'surprise'], question: ['疑问', 'Questioning', 'surprise'],
  jitome: ['半眯眼', 'Half-lidded gaze', 'eyes'],
  look: ['注视', 'Looking', 'attention'], check: ['确认', 'Checking', 'attention'],
  thinking: ['思考', 'Thinking', 'attention'], think: ['思考', 'Thinking', 'attention'],
  serious: ['认真', 'Serious', 'attention'], gaze: ['凝视', 'Gazing', 'attention'],
  nod: ['点头', 'Nodding', 'gesture'], denial: ['否定回应', 'Denial', 'gesture'],
  affirm: ['肯定回应', 'Affirmation', 'gesture'], yes: ['肯定回应', 'Affirmation', 'gesture'],
  no: ['否定回应', 'Denial', 'gesture'], wink: ['眨单眼', 'Winking', 'gesture'],
  bye: ['挥手告别', 'Waving goodbye', 'gesture'], join: ['待确认动作（join）', 'Unconfirmed motion (join)', 'unknown'],
  talk: ['说话', 'Talking', 'gesture'], hand: ['手部动作', 'Hand gesture', 'gesture'],
  kime: ['自信亮相', 'Striking a pose', 'performance'],
  sing: ['歌唱', 'Singing', 'performance'], play: ['演奏', 'Playing', 'performance'],
  finish: ['收尾动作', 'Finishing', 'performance'], action: ['演出动作', 'Performance action', 'performance'],
  maskoff: ['摘下面具', 'Removing the mask', 'performance'], spray: ['喷洒动作', 'Spraying', 'performance'],
  habit: ['习惯动作', 'Habitual gesture', 'performance'], note: ['笔记相关动作', 'Note-related gesture', 'performance'],
  haruhikage: ['《春日影》相关动作', 'Haruhikage sequence', 'performance'],
  jitabata: ['手忙脚乱', 'Flustered movement', 'performance'], scream: ['喊叫', 'Screaming', 'performance'],
  forget: ['忘记了', 'Forgetting', 'attention'],
  pale: ['脸色发青', 'Pale face', 'face'], shadow: ['面部阴影', 'Facial shadow', 'face'],
  spin: ['晕眩', 'Dizzy', 'face'], nohighlight: ['眼睛无高光', 'Eyes without highlights', 'face'],
  unique: ['角色专属表情', 'Character-specific expression', 'performance'],
  special: ['特殊表情', 'Special expression', 'performance'],
};
const directions = { c: ['正面', 'Front'], l: ['左', 'Left'], r: ['右', 'Right'] };

/** Label a runtime ID (or an exported .exp3 name), keeping every numbered variant distinct. */
export function describeAction(id, kind = 'motion') {
  const raw = String(id ?? '');
  let text = raw.trim().replace(/\.exp3(?:\.json)?$/i, '');
  text = text.replace(/^(?:mtn|exp)_/i, '');
  const suffixes = [];
  const qualifier = /_(old|omit)$/i.exec(text);
  if (qualifier) { suffixes.unshift(qualifier[1].toLowerCase()); text = text.slice(0, qualifier.index); }
  const direction = /_([clr])(\d*)$/i.exec(text);
  if (direction) text = text.slice(0, direction.index);
  const match = /^([a-z]+)(?:_?(\d+))?(?:_(\d+))?$/i.exec(text);
  if (!match) return unknown(raw);
  const key = match[1].toLowerCase();
  const label = actions[key];
  if (!label) return unknown(raw);
  let [zh, en, group] = label;
  if (kind === 'expression' && key === 'idle') { zh = '平常神情'; en = 'Neutral expression'; }
  if (kind === 'expression' && key === 'kime') { zh = '自信神情'; en = 'Confident expression'; }
  const zhParts = [zh], enParts = [en];
  if (match[2]) { zhParts.push(String(Number(match[2]))); enParts.push(String(Number(match[2]))); }
  if (match[3]) { zhParts.push(String(Number(match[3]))); enParts.push(String(Number(match[3]))); }
  if (direction) {
    const facing = directions[direction[1].toLowerCase()];
    zhParts.push(facing[0]); enParts.push(facing[1]);
    if (direction[2]) { zhParts.push(String(Number(direction[2]))); enParts.push(String(Number(direction[2]))); }
  }
  for (const suffix of suffixes) {
    zhParts.push(suffix === 'old' ? '旧版' : '省略版');
    enParts.push(suffix === 'old' ? 'Legacy version' : 'Omitted version');
  }
  // One cached Soyo clip differs only by its trailing space. Keep the two real IDs
  // distinguishable without presenting raw code as the ordinary display name.
  if (raw !== raw.trim()) { zhParts.push('名称含空格的条目'); enParts.push('Entry with spaced name'); }
  return result(zhParts.join(' · '), enParts.join(' · '), group);
}

/** Separate semantic name, number and facing so the UI never needs one enormous select. */
export function parseAction(id, kind = 'motion') {
  const text = String(id).trim().replace(/\.exp3(?:\.json)?$/i, '').replace(/^(?:mtn|exp)_/i, '');
  const match = /^([a-z]+)(?:_?(\d+))?(?:_(\d+))?(?:_([clr])(\d*)?)?(?:_(old|omit))?$/i.exec(text);
  const label = describeAction(id, kind);
  const stem = match?.[1]?.toLowerCase();
  const name = stem && actions[stem] ? describeAction(`${kind === 'expression' ? 'exp' : 'mtn'}_${stem}`, kind) : label;
  return { id, key: name.confidence === 'unknown' ? String(id) : stem,
    zh: name.zh, en: name.en, groupZh: label.groupZh, groupEn: label.groupEn, confidence: label.confidence,
    number: match?.[2] ? Number(match[2]) : null, sequence: match?.[3] ? Number(match[3]) : null,
    direction: match?.[4]?.toUpperCase() ?? null, detailZh: label.zh, detailEn: label.en };
}

export function groupActions(ids, kind = 'motion') {
  const grouped = new Map();
  for (const id of ids) {
    const item = parseAction(id, kind);
    if (!grouped.has(item.key)) grouped.set(item.key, { ...item, items: [] });
    grouped.get(item.key).items.push(item);
  }
  for (const group of grouped.values()) group.items.sort((a, b) => (a.number ?? 0) - (b.number ?? 0) ||
    ['C', 'L', 'R', null].indexOf(a.direction) - ['C', 'L', 'R', null].indexOf(b.direction));
  return [...grouped.values()];
}

const parameters = {
  anglex: ['头部左右转动', 'Head turn', 'head'], angley: ['头部上下转动', 'Head pitch', 'head'],
  anglez: ['头部左右倾斜', 'Head tilt', 'head'], bodyanglex: ['身体左右转动', 'Body turn', 'head'],
  bodyangley: ['身体前后倾斜', 'Body pitch', 'head'], bodyanglez: ['身体左右倾斜', 'Body tilt', 'head'],
  bodypositionx: ['身体横向位置', 'Body horizontal position', 'head'], bodypositiony: ['身体纵向位置', 'Body vertical position', 'head'],
  bodyangleupdown: ['身体上下变化', 'Body vertical movement', 'head'], breath: ['呼吸起伏', 'Breathing', 'head'],
  position: ['整体位置', 'Overall position', 'head'], chestx: ['胸部横向变化', 'Chest horizontal movement', 'head'],
  chesty: ['胸部纵向变化', 'Chest vertical movement', 'head'],
  eyeballx: ['视线左右', 'Horizontal gaze', 'eyes'], eyebally: ['视线上下', 'Vertical gaze', 'eyes'],
  eyeoff: ['眼睛隐藏', 'Hide eyes', 'eyes'], eyehighlight: ['眼睛高光', 'Eye highlights', 'eyes'],
  eyehilight: ['眼睛高光', 'Eye highlights', 'eyes'], eyeheart: ['爱心眼', 'Heart-shaped eyes', 'eyes'],
  eyeguruguru: ['圈圈眼', 'Spiral eyes', 'eyes'], guruguru: ['圈圈眼效果', 'Spiral-eye effect', 'eyes'],
  gurugurulr: ['左右圈圈眼效果', 'Left/right spiral-eye effect', 'eyes'],
  eyelighton: ['眼睛高光显示', 'Show eye highlights', 'eyes'],
  eyeblowoff: ['眉毛隐藏', 'Hide brows', 'brows'], eyebrowscenterpos: ['眉心位置', 'Brow center position', 'brows'],
  mouthopeny: ['嘴巴开合', 'Mouth opening', 'mouth'], mouthform: ['嘴形变化', 'Mouth shape', 'mouth'],
  mouthside: ['嘴巴左右变化', 'Mouth horizontal movement', 'mouth'], mouthupdawn: ['嘴巴上下变化', 'Mouth vertical movement', 'mouth'],
  mouthstrength: ['嘴部力度', 'Mouth strength', 'mouth'], teethon: ['牙齿显示', 'Show teeth', 'mouth'],
  mouthwidth: ['嘴巴宽度', 'Mouth width', 'mouth'], mouthheight: ['嘴巴高度', 'Mouth height', 'mouth'],
  mouthpositionx: ['嘴巴横向位置', 'Mouth horizontal position', 'mouth'], mouthpositiony: ['嘴巴纵向位置', 'Mouth vertical position', 'mouth'],
  cheek: ['脸红', 'Blush', 'face'], cheekoff: ['关闭脸红', 'Disable blush', 'face'],
  cheekon: ['脸红显示', 'Show blush', 'face'], cheekonoff: ['脸红开关', 'Blush toggle', 'face'],
  sweat: ['汗滴', 'Sweat drops', 'face'], tear: ['眼泪', 'Tears', 'face'], tears: ['眼泪', 'Tears', 'face'],
  tearbig: ['大颗眼泪', 'Large tears', 'face'], faceshadow: ['面部阴影', 'Facial shadow', 'face'],
  pale: ['脸色发青', 'Pale face', 'face'], aozame: ['脸色发青', 'Pale face', 'face'],
  sekimen: ['面部泛红', 'Facial flush', 'face'], sekimenn: ['面部泛红', 'Facial flush', 'face'],
  tearspuru: ['泪滴颤动', 'Tear trembling', 'face'],
  angry: ['生气表情', 'Angry expression', 'face'], cry: ['哭泣表情', 'Crying expression', 'face'],
  sad: ['难过表情', 'Sad expression', 'face'], smile: ['微笑表情', 'Smile expression', 'face'],
  bsmile: ['灿烂笑容', 'Broad smile', 'face'], shy: ['害羞表情', 'Shy expression', 'face'],
  heart: ['心动效果', 'Smitten effect', 'face'], fun: ['开心表情', 'Happy expression', 'face'],
  panic: ['慌张表情', 'Panicked expression', 'face'], thinking: ['思考表情', 'Thinking expression', 'face'],
  serious: ['认真表情', 'Serious expression', 'face'], surprised: ['惊讶表情', 'Surprised expression', 'face'],
  anxiety: ['不安表情', 'Anxious expression', 'face'], tired: ['疲惫表情', 'Tired expression', 'face'],
  kime: ['自信神情', 'Confident expression', 'face'],
  emo: ['表情混合通道', 'Expression blend channel', 'face'],
  clothes: ['服装变化', 'Clothing deformation', 'clothes'], necklace: ['项链摆动', 'Necklace movement', 'clothes'],
  fluffy: ['蓬松摆动', 'Soft movement', 'hair'],
};

function parameterResult(label, suffix = '', confidence = 'literal') {
  const zh = label[0] + (suffix ? ` · ${suffix}` : '');
  const en = label[1] + (suffix ? ` · ${suffix}` : '');
  return result(zh, en, label[2], confidence);
}

/** Preserve unidentified numeric controls; name hand presets without inventing their hand shape. */
export function describeParameter(id) {
  const raw = String(id ?? '');
  const key = raw.replace(/^param_?/i, '').replace(/_/g, '').toLowerCase();
  const exact = parameters[key];
  if (exact) return parameterResult(exact, '', /^(?:angle[xyz]|bodyangle[xyz]|eyeball[xy]|mouth(?:openy|form)|breath)$/.test(key) ? 'known' : 'literal');
  const hand = /^(?:param)?hand_?([lr])_?(\d+)$/i.exec(raw);
  if (hand) return result(`${hand[1].toLowerCase() === 'l' ? '左' : '右'}手形 · 预设 ${Number(hand[2])}`,
    `${hand[1].toLowerCase() === 'l' ? 'Left' : 'Right'} hand pose · Preset ${Number(hand[2])}`, 'arms');
  const arm = /^arm([lr])(?:(layer)_?(\d*)|(\d+)(contraction)?)$/i.exec(key);
  if (arm) {
    const zhSide = arm[1] === 'l' ? '左' : '右', enSide = arm[1] === 'l' ? 'Left' : 'Right';
    if (arm[2]) {
      // Soyo contains both layer3 and layer_3; these are different controls, not aliases.
      const separate = /layer_\d+$/i.test(raw);
      return result(`${zhSide}臂层级${arm[3] ? ` · ${Number(arm[3])}` : ''}${separate ? ' · 独立通道' : ''}`,
        `${enSide} arm layer${arm[3] ? ` · ${Number(arm[3])}` : ''}${separate ? ' · Separate channel' : ''}`, 'arms');
    }
    const number=Number(arm[4]);
    const names={1:['抬起','Raise'],2:['弯曲','Bend'],3:['手腕旋转','Wrist rotation'],4:['手部透视','Hand perspective']};
    const label=arm[5] ? [number===1?'上臂收缩':'前臂收缩',number===1?'Upper arm foreshortening':'Forearm foreshortening'] : names[number] || [`细节 ${number}`,`Detail ${number}`];
    return result(`${zhSide}臂 · ${label[0]}`,`${enSide} arm · ${label[1]}`,'arms');
  }
  const bodyArm = /^bodyanglex([lr])armadd(\d*)$/i.exec(key);
  if (bodyArm) return result(`身体转动 · ${bodyArm[1] === 'l' ? '左' : '右'}臂补偿${bodyArm[2] ? ` ${Number(bodyArm[2])}` : ''}`,
    `Body turn · ${bodyArm[1] === 'l' ? 'Left' : 'Right'} arm correction${bodyArm[2] ? ` ${Number(bodyArm[2])}` : ''}`, 'arms');
  const shoulder = /^shoulder([lr])(\d*)$/.exec(key);
  if (shoulder) return result(`${shoulder[1] === 'l' ? '左' : '右'}肩变化${shoulder[2] ? ` ${Number(shoulder[2])}` : ''}`,
    `${shoulder[1] === 'l' ? 'Left' : 'Right'} shoulder movement${shoulder[2] ? ` ${Number(shoulder[2])}` : ''}`, 'head');
  const eye = /^eye([lr])(open|smile|scsle|scale|highlight|form|shaking[xy])(\d*)$/.exec(key);
  if (eye) {
    const meanings = { open: ['睁合', 'opening'], smile: ['笑意', 'smile'], scsle: ['缩放', 'scale'],
      scale: ['缩放', 'scale'], highlight: ['高光', 'highlight'], form: ['形状', 'shape'],
      shakingx: ['横向颤动', 'horizontal trembling'], shakingy: ['纵向颤动', 'vertical trembling'] };
    const [zh, en] = meanings[eye[2]];
    return result(`${eye[1] === 'l' ? '左' : '右'}眼${zh}${eye[3] ? ` · 通道 ${Number(eye[3])}` : ''}`,
      `${eye[1] === 'l' ? 'Left' : 'Right'} eye ${en}${eye[3] ? ` · Channel ${Number(eye[3])}` : ''}`, 'eyes', eye[2] === 'open' ? 'known' : 'literal');
  }
  const eyelid = /^eyelid([lr])([xy]|\d*)$/.exec(key);
  if (eyelid) return result(`${eyelid[1] === 'l' ? '左' : '右'}眼睑${eyelid[2] ? ` · ${eyelid[2].toUpperCase()}` : ''}`,
    `${eyelid[1] === 'l' ? 'Left' : 'Right'} eyelid${eyelid[2] ? ` · ${eyelid[2].toUpperCase()}` : ''}`, 'eyes');
  const lash = /^eye([lr])lashshaking([xy])$/.exec(key);
  if (lash) return result(`${lash[1] === 'l' ? '左' : '右'}睫毛${lash[2] === 'x' ? '横' : '纵'}向颤动`,
    `${lash[1] === 'l' ? 'Left' : 'Right'} eyelash ${lash[2] === 'x' ? 'horizontal' : 'vertical'} trembling`, 'eyes');
  const brow = /^brow([lr])(x|y|angle|form)$/.exec(key);
  if (brow) {
    const terms = { x: ['横向位置', 'horizontal position'], y: ['高度', 'height'], angle: ['角度', 'angle'], form: ['形状', 'shape'] };
    return result(`${brow[1] === 'l' ? '左' : '右'}眉${terms[brow[2]][0]}`,
      `${brow[1] === 'l' ? 'Left' : 'Right'} brow ${terms[brow[2]][1]}`, 'brows', 'known');
  }
  const browEmotion = /^(smile|angry|sad|thinking|fun)(?:eye)?eyebrows(\d*)$/.exec(key);
  if (browEmotion) return result(`${actions[browEmotion[1]][0]}眉形${browEmotion[2] ? ` · 变体 ${Number(browEmotion[2])}` : ''}`,
    `${actions[browEmotion[1]][1]} brows${browEmotion[2] ? ` · Variant ${Number(browEmotion[2])}` : ''}`, 'brows');
  const angleVariant = /^anglex(plus|minus)(\d+)$/.exec(key);
  if (angleVariant) return result(`头部左右转动 · ${angleVariant[1] === 'plus' ? '正' : '负'}向辅助 ${Number(angleVariant[2])}`,
    `Head turn · ${angleVariant[1] === 'plus' ? 'Positive' : 'Negative'} helper ${Number(angleVariant[2])}`, 'head');
  const hair = /^hair(front|side|back)([xy]?)(\d*)$/.exec(key);
  if (hair) {
    const part = { front: ['前发', 'Front hair'], side: ['侧发', 'Side hair'], back: ['后发', 'Back hair'] }[hair[1]];
    const axis = hair[2] ? (hair[2] === 'x' ? ['横向', 'horizontal'] : ['纵向', 'vertical']) : ['', ''];
    return result(`${part[0]}${axis[0]}摆动${hair[3] ? ` · 通道 ${Number(hair[3])}` : ''}`,
      `${part[1]} ${axis[1] ? axis[1] + ' ' : ''}movement${hair[3] ? ` · Channel ${Number(hair[3])}` : ''}`, 'hair');
  }
  const numbered = /^(.*?)(\d+)([ab]?)$/.exec(key);
  if (numbered && parameters[numbered[1]]) return parameterResult(parameters[numbered[1]], `${Number(numbered[2])}${numbered[3].toUpperCase()}`);
  return unknown(raw);
}
