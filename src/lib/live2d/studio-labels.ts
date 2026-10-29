/** Conservative labels for known model conventions; unknown identifiers remain untouched. */
type Labels = readonly [zh: string, en: string, ja: string];
const actions: Record<string, Labels> = {
  idle: ['待机', 'Idle', '待機'],
  angry: ['生气', 'Angry', '怒り'],
  bsmile: ['大笑', 'Big smile', '大笑い'],
  smile: ['微笑', 'Smile', '笑顔'],
  cry: ['哭泣', 'Crying', '泣く'],
  heart: ['心动', 'Smitten', 'ときめき'],
  sad: ['难过', 'Sad', '悲しい'],
  shy: ['害羞', 'Shy', '照れ'],
  serious: ['认真', 'Serious', '真剣'],
  surprise: ['惊讶', 'Surprised', '驚き'],
  surprised: ['惊讶', 'Surprised', '驚き'],
  worry: ['担心', 'Worried', '心配'],
  think: ['思考', 'Thinking', '考える'],
  thinking: ['思考', 'Thinking', '考える'],
  bye: ['挥手告别', 'Wave goodbye', '手を振る'],
  nod: ['点头', 'Nod', 'うなずく'],
  yes: ['肯定', 'Yes', '肯定'],
  no: ['否定', 'No', '否定'],
  talk: ['说话', 'Talk', '話す'],
  normal: ['平常', 'Normal', '通常'],
  kime: ['帅气', 'Confident', '決め顔'],
  pale: ['脸色苍白', 'Pale', '青ざめ'],
  shadow: ['低落', 'Gloomy', '落ち込み'],
  spin: ['晕头转向', 'Dizzy', '目が回る'],
  sdeprecate: ['自嘲', 'Self-mocking', '自嘲'],
  shame: ['难为情', 'Embarrassed', '恥ずかしい'],
  default: ['默认', 'Default', 'デフォルト'],
  tapbody: ['触碰身体', 'Tap body', '体にタッチ'],
};
const directions: Record<string, Labels> = {
  c: ['正面', 'Front', '正面'],
  l: ['左向', 'Left', '左'],
  r: ['右向', 'Right', '右'],
};
const parameters: Record<string, Labels> = {
  anglex: ['头部左右', 'Head yaw', '顔の左右'],
  angley: ['头部上下', 'Head pitch', '顔の上下'],
  anglez: ['头部倾斜', 'Head tilt', '顔の傾き'],
  bodyanglex: ['身体左右', 'Body yaw', '体の左右'],
  bodyangley: ['身体上下', 'Body pitch', '体の上下'],
  bodyanglez: ['身体倾斜', 'Body tilt', '体の傾き'],
  eyeballx: ['视线左右', 'Gaze horizontal', '視線の左右'],
  eyebally: ['视线上下', 'Gaze vertical', '視線の上下'],
  eyelopen: ['左眼睁合', 'Left eye open', '左目の開閉'],
  eyeropen: ['右眼睁合', 'Right eye open', '右目の開閉'],
  mouthopeny: ['嘴部开合', 'Mouth open', '口の開閉'],
  mouthform: ['嘴形', 'Mouth shape', '口の形'],
  breath: ['呼吸', 'Breathing', '呼吸'],
  cheek: ['脸红', 'Blush', '頬染め'],
  browly: ['左眉高度', 'Left brow height', '左眉の高さ'],
  browry: ['右眉高度', 'Right brow height', '右眉の高さ'],
  browlangley: ['左眉角度', 'Left brow angle', '左眉の角度'],
  browrangley: ['右眉角度', 'Right brow angle', '右眉の角度'],
};
function localize(labels: Labels, locale: string): string {
  return labels[locale === 'en' ? 1 : locale === 'ja' ? 2 : 0];
}

/** Display translations alongside the exact ID so similarly named variants stay distinguishable. */
export function studioActionLabel(id: string, locale: string): string {
  const match = /^(?:mtn_|exp_)?([a-z]+?)(\d+)?(?:_([clr]))?$/i.exec(id);
  if (!match) return id;
  const label = actions[match[1].toLowerCase()];
  if (!label) return id;
  const parts = [localize(label, locale)];
  if (match[2]) parts.push(String(Number(match[2])));
  if (match[3]) parts.push(localize(directions[match[3].toLowerCase()], locale));
  return `${parts.join(' · ')} — ${id}`;
}
export function studioParameterLabel(id: string, locale: string): string {
  const key = id
    .replace(/^param_?/i, '')
    .replaceAll('_', '')
    .toLowerCase();
  return parameters[key] ? `${localize(parameters[key], locale)} — ${id}` : id;
}
