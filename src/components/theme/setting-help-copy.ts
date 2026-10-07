/** Explanations describe the rendered result, including bounds and safeguards that override a control. */
const zh = {
  palette: '改变全站底色、卡片与强调色。图片保持原色；明暗模式仍由日月按钮控制，独立阅读设置不会被覆盖。',
  looks: '一次调整横幅的遮罩、色调与图片滤镜。取景、标题、环境光和页面特效保持当前设置；选中后仍可逐项微调。',
  ambientLooks: '同时调整环境光的强度、柔化、扩散、颜色和底衬。仅改变页面投影，不修改横幅图片或主题预设。',
  fontSize: '调整全站字号及以文字为基准的尺寸。越大越易阅读、占用空间越多；100% 是站点默认基准，设置面板自身保持稳定大小。',
  lineHeight: '调整正文每行之间的距离。越大越疏朗，越小越紧凑；不改变字形大小。',
  font: '选择全站文字风格。跟随主题使用预设字体；其他选项保留你的选择。实际字形取决于设备安装的字体。',
  readingDensity: '同时调整内容卡片内部、卡片之间和区块之间的留白。紧凑容纳更多内容，宽松更舒展。',
  corners: '改变主要内容卡片的圆角。利落更方正、柔和更圆润；圆形头像保持不变。',
  transparency:
    '毛玻璃让浮层透出背景，实色提高遮挡与可读性。实色也会提高环境光的阅读底衬；系统要求更高对比度时优先保障可读性。',
  motion: '对角线展开让主题从右下向左上平滑切换；立即切换减少动画，并暂停页面粒子。系统的减少动态效果设置优先。',
  imageOpacity: '仅调整横幅图片的可见程度。100% 完整显示，越小越透出横幅底色；标题与环境光投影独立控制。',
  mask: '调整横幅遮罩强度。越大遮光或薄雾越明显，越小越接近原图；具体明暗分布由遮罩方式决定。',
  maskStyle: '选择遮罩分布：均匀覆盖、上下渐变、暗角、顶部/底部遮光、中央聚光或薄雾柔光。配合遮罩强度控制，不改变原图。',
  edge: '改变横幅底部与页面的连接形状。波浪、弧形、斜切和山峦更有轮廓；渐隐与雾化消融更柔和。环境光开启时边缘继续渐变融合。',
  tone: '给横幅叠加轻微冷暖色调。暖调偏金粉、冷调偏蓝，自然保留原色；不改变全站主题。',
  brightness: '仅调整横幅图片亮度。100% 保持原值，越大越亮，越小越暗；过高会损失高光细节。',
  contrast: '仅调整横幅明暗反差。100% 保持原值，越大越鲜明，越小越柔和；过高会压暗阴影。',
  saturation: '仅调整横幅色彩浓度。100% 保持原值，0% 为灰度，越大色彩越浓；页面投影有独立的饱和度。',
  blur: '模糊横幅图片。0px 最清晰，越大越柔焦；标题保持清晰。与环境光的柔化程度是两项独立设置。',
  focusX:
    '横幅为了铺满宽屏会裁掉部分原图。0% 优先保留左侧，100% 优先保留右侧，50% 居中；图片未被左右裁切时不会移动。环境光取景同步。',
  focusY: '0% 优先保留原图顶部，100% 优先保留底部，50% 居中。仅在图片被上下裁切时有效；环境光取景同步。',
  ambientLight: '关闭恢复主题背景；四周光晕主要保留边缘光色；全页漫射将当前横幅原色铺成固定背景，向下滚动仍保留。',
  lightOpacity: '调整整层环境光的可见程度。越大越明显，0% 隐藏投影；不会改变横幅图片或文字的不透明度。',
  lightBlur: '柔化页面投影中的色块边界。越大越朦胧，越小越能辨认原图结构；0% 仍保留基础柔化，避免像素格。',
  lightSpread: '放大环境光投影。越大色块越宽、外围图像裁切越多；0% 已覆盖视口，并非关闭。不会放大正文或横幅。',
  lightBrightness: '调整环境光的亮度。100% 保持投影原值，越大越明亮，越小越暗；横幅图片亮度独立。',
  lightContrast: '调整投影色块的明暗差。越大光暗越分明，越小越柔和，100% 保持原值。',
  lightSaturation: '调整环境光色彩浓度。0% 灰度，100% 原色，越大越鲜艳；不会改变内容图片。',
  lightThemeBlend: '在环境光里混入当前主题底色。越大越接近主题配色，0% 不额外混色；页面底衬仍单独提供阅读保护。',
  lightFeather: '扩大光场边缘的渐隐区域。越大边缘越柔和，越小越接近完整覆盖；与四周/方向模式共同决定边缘形状。',
  lightDirection: '选择环境光覆盖全方向、两侧、上方或下方。被弱化的方向以渐变退回主题底色，不改变横幅取景。',
  lightSurface:
    '调整侧栏和正文共用的阅读底色。越大底衬越厚、光色越淡，越小更通透。卡片至少保留 78%、长文至少 88% 的保护；实色模式优先。',
  lightTextShadow:
    '给内容标题、段落等文字加主题色柔光，提高复杂背景上的辨识度。越大越明显，0% 关闭；不改变字体颜色或横幅标题阴影。',
  textOpacity: '仅调整横幅标题与副标题。100% 最清晰，越小越淡，0% 隐藏标题及其链接操作；顶部导航不受影响。',
  textSize: '按当前横幅标题基准缩放。越大越醒目，越小越收敛；不改变正文的全站字号。',
  textFont: '为横幅标题单独选择跟随主题、圆体或衬线字体。不改变正文；字形取决于设备已有字体。',
  textWeight: '调整横幅标题笔画粗细。常规较轻，特粗更醒目；实际支持的字重取决于字体。',
  textColor: '横幅标题使用白色、墨色或当前主题正文色。可配合遮罩、阴影和不透明度保持对比度。',
  textSpacing: '调整横幅标题字距，单位为 1/100 em。越大字间更疏，0 为不额外加间距；长标题可能因此换行。',
  textShadow: '增强横幅标题背后的阴影。越大阴影越明显，0% 关闭；不影响正文的文字柔光。',
  effect: '选择樱花、雪、雨、萤火、星光、落叶、光斑或极光。装饰层不拦截点击，后台和减少动态效果时暂停；关闭可停止绘制。',
  density: '增加粒子数量，越大越密、绘制工作越多；手机使用更低上限。极光不增加光带数量，而是提高光带强度。',
  speed: '改变粒子移动和闪烁的速度。越大越快，越小越舒缓；不改变数量，也不提高绘制帧率。',
  effectOpacity: '改变页面特效的可见程度。越大越明显，越小越轻淡；不影响环境光、横幅或内容图片。',
} as const;
export type HelpKey = keyof typeof zh;
export type HelpLanguage = 'zh' | 'en' | 'ja';
const en: Record<HelpKey, string> = {
  palette:
    'Changes page, card and accent colors, keeping artwork intact. The sun/moon controls light and dark; independent reading choices remain unchanged.',
  looks:
    'Applies banner mask, tone and image filters together. Framing, title, ambient projection and particles keep their settings. Fine-tune afterwards.',
  ambientLooks:
    'Applies projection strength, softness, scale, color and reading backing together. Does not change the banner image or theme palette.',
  fontSize:
    'Scales site text and rem-based sizes. Higher is larger and uses more space; 100% is the site baseline. This settings panel keeps its own size.',
  lineHeight: 'Space between body-text lines. Higher is airier; lower is denser. Glyph size stays the same.',
  font: 'Site typeface. Theme follows the palette; other choices remain independent. Exact glyphs depend on installed fonts.',
  readingDensity:
    'Changes padding inside cards and gaps between cards and sections. Compact fits more; spacious adds breathing room.',
  corners: 'Changes content-card corner rounding, from crisp to soft. Circular avatars stay circular.',
  transparency:
    'Glass reveals the background; solid improves separation and readability, including ambient reading backing. System contrast preferences take priority.',
  motion:
    'Diagonal reveal sweeps from bottom right to top left. Instant reduces animation and pauses particles. System reduced-motion preferences take priority.',
  imageOpacity:
    'Banner image visibility only. 100% is fully visible; lower reveals its backing. Title and ambient projection have separate controls.',
  mask: 'Banner overlay strength. Higher gives stronger shading or mist; lower reveals the original. Mask style determines its distribution.',
  maskStyle:
    'Choose uniform, vertical gradient, vignette, top/bottom shade, central spotlight or mist. Combine with mask strength; the source image is unchanged.',
  edge: 'Banner-to-page boundary: waves, arc, diagonal or layered hills add shape; fade and mist dissolve softly. Ambient light adds continuous blending.',
  tone: 'Subtle warm gold/pink or cool blue tint on the banner. Natural retains its colors. Does not change the site palette.',
  brightness:
    'Banner brightness only. 100% is unchanged; higher brightens, lower darkens. Excess brightness can lose highlight detail.',
  contrast: 'Banner tonal contrast. Higher is punchier, lower softer; 100% is unchanged. High values can crush shadows.',
  saturation: 'Banner color intensity. 0% is grayscale, 100% original, higher more vivid. Projection saturation is separate.',
  blur: 'Banner image defocus. 0px is sharp; higher is softer. Title stays sharp; ambient softness is separate.',
  focusX:
    'When cover fitting crops the image horizontally, 0% keeps the left, 100% the right, 50% the center. No movement without horizontal cropping. Projection uses the same crop.',
  focusY:
    'When cover fitting crops vertically, 0% keeps the top, 100% the bottom, 50% the center. No movement without vertical cropping. Projection follows.',
  ambientLight:
    'Off restores the theme background. Halo emphasizes the edges; wash diffuses the current cover across a fixed background that remains while scrolling.',
  lightOpacity:
    'Visibility of the whole light field. Higher is stronger; 0% hides it. Banner and title opacity stay independent.',
  lightBlur:
    'Softens boundaries between projected colors. Higher is more diffuse; lower retains image structure. Even 0% retains basic smoothing to avoid pixel blocks.',
  lightSpread:
    'Enlarges the projected image. Higher makes broader color fields and crops more edges. 0% already covers the viewport; content and banner size stay unchanged.',
  lightBrightness:
    'Projection brightness only. 100% retains source brightness; higher is brighter, lower darker. Banner brightness is independent.',
  lightContrast: 'Projected light/dark contrast. Higher is stronger, lower softer; 100% is unchanged.',
  lightSaturation: 'Projected color intensity: 0% grayscale, 100% original, higher more vivid. Content images are unaffected.',
  lightThemeBlend:
    'Mixes the current theme background into the light field. Higher is closer to the palette; 0% adds no tint. Reading backing is independent.',
  lightFeather:
    'Widens the light field’s fading edge. Higher is softer, lower fuller. Combines with halo and direction choices.',
  lightDirection:
    'Project on all sides, both sides, above or below. Other regions fade into the theme background. Does not change banner framing.',
  lightSurface:
    'Shared reading backing behind sidebar and content. Higher is more opaque, lower more transparent. Cards retain at least 78%, prose 88%; solid mode takes priority.',
  lightTextShadow:
    'Adds theme-colored soft halos to content headings and paragraphs. Higher is stronger, 0% off. Does not change text color or the banner title shadow.',
  textOpacity:
    'Banner title and subtitle visibility only. Lower is fainter; 0% hides the title and its link. Navigation is unaffected.',
  textSize:
    'Scales the banner title relative to its baseline. Higher is more prominent, lower quieter. Site body-text size is independent.',
  textFont: 'Banner-only theme, rounded or serif typeface. Body text is unaffected; glyphs depend on installed fonts.',
  textWeight: 'Banner title stroke weight, from regular to extra bold. Supported weights depend on the font.',
  textColor: 'White, ink or current theme text color for the banner. Combine with mask, shadow and opacity for contrast.',
  textSpacing: 'Extra banner title spacing in 1/100 em. Higher is wider; 0 adds none. Wider spacing may wrap long titles.',
  textShadow: 'Banner title shadow strength. Higher is stronger, 0% off. Content text halos are independent.',
  effect:
    'Decorative petals, snow, rain, fireflies, stars, leaves, bokeh or aurora. Never intercepts clicks; pauses in the background and under reduced motion. Off stops rendering.',
  density:
    'Higher creates more particles and more drawing work; mobile has a lower cap. Aurora keeps its band count and changes intensity instead.',
  speed:
    'Particle movement and twinkle speed. Higher is faster, lower calmer; particle count and frame-rate cap remain unchanged.',
  effectOpacity:
    'Particle visibility. Higher is stronger, lower subtler. Ambient light, banner and content images are unaffected.',
};
const ja: Record<HelpKey, string> = {
  palette: 'ページ・カード・アクセントの色を変更します。画像と個別の文字設定は維持され、明暗は日月ボタンで変更します。',
  looks:
    'バナーのマスク・色調・画像フィルターをまとめて変更します。構図・タイトル・環境光・粒子は維持され、後から微調整できます。',
  ambientLooks: '環境光の強さ・ぼかし・広がり・色・下地をまとめて変更します。バナー画像とテーマは変更しません。',
  fontSize:
    '全体の文字と rem 基準のサイズを変更します。大きいほど読みやすく、広い領域を使います。100% が標準で、設定パネルは拡大しません。',
  lineHeight: '本文の行間です。大きいほどゆったり、小さいほどコンパクトになります。文字そのものの大きさは変わりません。',
  font: '全体の字体です。テーマに従う以外の選択はテーマ変更後も維持します。実際の字形は端末のフォントによります。',
  readingDensity:
    'カード内の余白、カード間、セクション間の間隔を調整します。コンパクトは情報量を増やし、ゆったりは余白を増やします。',
  corners: '主要カードの角を変更します。シャープから柔らかな丸みへ変化し、円形アバターは維持されます。',
  transparency:
    'ガラスは背景を透かし、単色は読みやすさを優先します。単色は環境光の下地も厚くします。システムのコントラスト設定が優先されます。',
  motion:
    '対角線は右下から左上へテーマを切り替えます。即時切替は動きを減らし粒子も停止します。システムの視差効果軽減が優先です。',
  imageOpacity: 'バナー画像だけの不透明度です。100% は完全表示、小さいほど下地が透けます。タイトルと環境光は独立です。',
  mask: 'バナーのマスク強度です。大きいほど遮光や霧が強く、小さいほど原画に近づきます。分布はマスク方式で決まります。',
  maskStyle: '均一・上下グラデーション・周辺減光・上下遮光・中央の光・薄霧を選びます。強度と組み合わせ、元画像は変更しません。',
  edge: 'バナー下端の形です。波・円弧・斜線・山並みは輪郭があり、フェードと霧は柔らかく溶け込みます。環境光でも境界をなじませます。',
  tone: 'バナーに暖色の金・ピンク、または寒色の青を薄く重ねます。自然は元の色を保ち、全体テーマは変えません。',
  brightness: 'バナー画像の明るさです。100% は元の値、大きいほど明るく、小さいほど暗くなります。上げすぎると白飛びします。',
  contrast: 'バナーの明暗差です。大きいほどくっきり、小さいほど柔らかく、100% が元の値です。上げすぎると暗部が潰れます。',
  saturation: 'バナーの色の濃さです。0% はモノクロ、100% は元の色、大きいほど鮮やかです。環境光は独立です。',
  blur: 'バナー画像のぼかしです。0px は鮮明、大きいほど柔らかくなります。タイトルと環境光のぼかしは独立です。',
  focusX:
    '横方向に画像が切り取られる場合、0% は左、100% は右、50% は中央を残します。切り取りがなければ動きません。環境光も連動します。',
  focusY:
    '縦方向に切り取られる場合、0% は上、100% は下、50% は中央を残します。切り取りがなければ動きません。環境光も連動します。',
  ambientLight: 'オフはテーマ背景に戻します。周辺光は縁を、全面拡散はバナーの色を画面全体に投影し、スクロール後も残ります。',
  lightOpacity: '環境光全体の見え方です。大きいほど強く、0% は非表示です。バナーと文字の不透明度は変えません。',
  lightBlur:
    '投影色の境界をぼかします。大きいほど拡散し、小さいほど原画の形が残ります。0% でも画素の四角を防ぐ最低限のぼかしがあります。',
  lightSpread:
    '投影画像を拡大します。大きいほど色面が広がり周辺が切れます。0% でも画面全体を覆い、本文やバナーは拡大しません。',
  lightBrightness: '環境光だけの明るさです。100% は元の値、大きいほど明るく、小さいほど暗くなります。',
  lightContrast: '環境光の明暗差です。大きいほど強く、小さいほど柔らかくなり、100% は元の値です。',
  lightSaturation: '環境光の色の濃さです。0% はモノクロ、100% は元の色、大きいほど鮮やかです。内容画像は変えません。',
  lightThemeBlend:
    '環境光にテーマ背景色を混ぜます。大きいほどテーマに近づき、0% は追加の混色なしです。読みやすさの下地は別です。',
  lightFeather:
    '環境光の縁のフェード範囲を広げます。大きいほど柔らかく、小さいほど全面的に表示します。方向や周辺光と組み合わさります。',
  lightDirection: '全方向・両側・上・下を選びます。弱めた方向はテーマ背景へ徐々に戻り、バナーの構図は変わりません。',
  lightSurface:
    'サイドバーと本文共通の下地です。大きいほど不透明、小さいほど透けます。カードは最低78%、長文は88%を保護し、単色設定が優先です。',
  lightTextShadow:
    '本文や見出しにテーマ色の柔らかな光を加えます。大きいほど強く、0% はオフです。文字色やバナーの影は変えません。',
  textOpacity: 'バナーのタイトルと副題の不透明度です。小さいほど薄く、0% は文字とリンク操作を隠します。ナビは変えません。',
  textSize:
    'バナータイトルを基準サイズから拡大縮小します。大きいほど目立ち、小さいほど控えめです。本文の文字サイズとは独立です。',
  textFont: 'バナー専用のテーマ字体・丸字・セリフ体です。本文は変わらず、字形は端末のフォントによります。',
  textWeight: 'バナータイトルの線の太さです。標準から極太へ変化し、対応する太さはフォントによります。',
  textColor: 'バナー文字を白・墨色・テーマ本文色から選びます。マスク・影・不透明度と合わせて読みやすさを調整します。',
  textSpacing:
    'バナー文字の追加間隔です。単位は1/100 emで、大きいほど広く、0は追加なしです。長いタイトルは折り返すことがあります。',
  textShadow: 'バナー文字の影です。大きいほど目立ち、0% はオフです。本文の柔らかな光は別の設定です。',
  effect:
    '桜・雪・雨・蛍・星・落葉・玉ぼけ・オーロラを選びます。クリックを妨げず、バックグラウンドや動きを減らす設定では停止します。',
  density: '大きいほど粒子が増え描画負荷も増えます。スマホでは上限を抑えます。オーロラは本数でなく光の強さが変わります。',
  speed: '粒子の移動や点滅の速さです。大きいほど速く、小さいほど穏やかになります。粒子数やフレームレート上限は変えません。',
  effectOpacity: '粒子の不透明度です。大きいほどはっきり、小さいほど控えめです。環境光・バナー・内容画像は変えません。',
};
export const settingHelpCopy = { zh, en, ja };
