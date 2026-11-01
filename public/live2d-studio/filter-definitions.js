/** Original effect definitions. Numeric controls map to p0..p3 in their declared order. */
const range = (key, label, labelEn, min, max, step, value) => ({ key, label, labelEn, type: 'range', min, max, step, default: value });
const color = (key, label, labelEn, value) => ({ key, label, labelEn, type: 'color', default: value });
export const FILTER_DEFINITIONS = [
  { id: 'original', name: '原色', nameEn: 'Original', description: '保留原始细节；曝光和饱和度仍可单独调整。', descriptionEn: 'Original detail, with independent exposure and saturation.', controls: [] },
  { id: 'soft', name: '柔光人像', nameEn: 'Soft portrait', description: '邻域柔化与柔和高光，保留透明轮廓。', descriptionEn: 'Local diffusion and soft highlights, preserving the silhouette.', controls: [range('radius','柔化半径','Diffusion radius',.5,5,.1,2.1),range('glow','高光柔晕','Highlight glow',0,1,.01,.45),range('warmth','暖粉色调','Warm pink tone',-1,1,.01,.16)] },
  { id: 'film', name: '暖调胶片', nameEn: 'Warm film', description: '压低黑位、暖肤色、细颗粒与画幅暗角。', descriptionEn: 'Lifted blacks, warm skin, fine grain and frame vignette.', controls: [range('grain','胶片颗粒','Film grain',0,1,.01,.28),range('fade','黑位褪色','Black lift',0,1,.01,.25),range('warmth','冷暖','Warmth',-1,1,.01,.35),range('vignette','暗角','Vignette',0,1,.01,.25)] },
  { id: 'manga', name: '漫画网点', nameEn: 'Manga dots', description: '以明暗驱动真实网点，纸色和墨色独立可调。', descriptionEn: 'Luminance-driven halftone dots with independent paper and ink.', controls: [range('dotSize','网点尺寸','Dot size',2,12,.25,5.5),range('contrast','明暗对比','Contrast',.3,2,.01,1.35),color('paper','纸色','Paper','#fbf5e9'),color('ink','墨色','Ink','#241d2b')] },
  { id: 'pixel', name: '像素游戏', nameEn: 'Pixel game', description: '整齐的像素采样和有限色阶；不降低导出画布分辨率。', descriptionEn: 'Pixel sampling and limited levels, without reducing output resolution.', controls: [range('blockSize','像素块尺寸','Pixel block size',2,16,.25,6),range('levels','每通道色阶','Levels per channel',3,16,1,8)] },
  { id: 'night', name: '蓝夜轮廓', nameEn: 'Blue hour', description: '深蓝阴影与亮边，营造夜间舞台。', descriptionEn: 'Deep blue shadows and luminous edges for a night stage.', controls: [range('depth','夜色深度','Night depth',0,1,.01,.55),range('rim','轮廓亮度','Rim light',0,1,.01,.3),color('tint','夜色','Night color','#476fba')] },
  { id: 'noir', name: '黑白银盐', nameEn: 'Silver noir', description: '高反差黑白、细密银盐颗粒与收束暗角。', descriptionEn: 'Contrasty monochrome, silver grain and a focused vignette.', controls: [range('contrast','黑白对比','Contrast',.5,2,.01,1.4),range('grain','银盐颗粒','Silver grain',0,1,.01,.18),range('vignette','暗角','Vignette',0,1,.01,.4)] },
  { id: 'duotone', name: '双色海报', nameEn: 'Duotone', description: '将阴影与高光映射为两种专色，适合刊物封面。', descriptionEn: 'Map shadows and highlights to two poster inks.', controls: [range('balance','明暗分界','Tonal balance',0,1,.01,.5),range('contrast','专色对比','Ink contrast',.5,2,.01,1.15),color('shadow','阴影色','Shadow ink','#242c50'),color('highlight','高光色','Highlight ink','#ffc7a4')] },
  { id: 'sketch', name: '铅笔速写', nameEn: 'Pencil sketch', description: '提取局部轮廓与排线，带轻微纸面颗粒。', descriptionEn: 'Local contour extraction and hatching over fine paper grain.', controls: [range('lineWidth','线条宽度','Line width',.5,3,.1,1.2),range('inkStrength','线条浓度','Ink strength',0,1,.01,.85),range('paperGrain','纸纹','Paper grain',0,1,.01,.22),color('ink','铅笔色','Pencil color','#393744')] },
  { id: 'watercolor', name: '水彩纸感', nameEn: 'Watercolor paper', description: '局部色彩晕染、边缘积色与纸面明暗；轻量水彩化。', descriptionEn: 'Local color wash, edge pigment and paper variation.', controls: [range('wash','晕染柔度','Color wash',0,1,.01,.5),range('edgeBleed','边缘积色','Edge pigment',0,1,.01,.32),range('paper','纸面纹理','Paper texture',0,1,.01,.24),range('colorfulness','水彩饱和度','Pigment saturation',.5,1.5,.01,.92)] },
  { id: 'neon', name: '霓虹描边', nameEn: 'Neon edge', description: '暗化人物底色，保留高亮彩色边缘与邻域光晕。', descriptionEn: 'Darkened fills with colored contour light and a local glow.', controls: [range('edgeStrength','边缘发光','Edge light',0,2,.01,1.2),range('glow','邻域光晕','Local glow',0,1,.01,.5),range('darken','底色压暗','Darken fill',0,1,.01,.65),color('neon','霓虹颜色','Neon color','#f87bda')] },
  { id: 'toon', name: '赛璐璐', nameEn: 'Cel shading', description: '将色彩分层并叠加局部轮廓线，形成平涂动画感。', descriptionEn: 'Posterized color bands and local contour lines.', controls: [range('levels','平涂层数','Color bands',3,10,1,5),range('edgeStrength','轮廓浓度','Contour strength',0,1,.01,.55),range('lineWidth','轮廓宽度','Contour width',.5,3,.1,1.2)] },
  { id: 'riso', name: '双色孔版', nameEn: 'Riso print', description: '双色墨版错位、网格密度与纸面颗粒，保留原始透明轮廓。', descriptionEn: 'Offset ink plates and print grain inside the original silhouette.', controls: [range('offset','套印偏移','Plate offset',0,6,.1,2.4),range('grain','印刷颗粒','Print grain',0,1,.01,.35),range('paperMix','留白比例','Paper mix',0,1,.01,.2),color('inkA','第一墨色','First ink','#c95c6d'),color('inkB','第二墨色','Second ink','#347f83')] },
];
export const getFilterDefinition = (id) => FILTER_DEFINITIONS.find((filter) => filter.id === id) ?? FILTER_DEFINITIONS[0];
export const getFilterDefaults = (id) => Object.fromEntries(getFilterDefinition(id).controls.map((control) => [control.key, control.default]));
/** Ignore unknown keys and sanitize restored draft values before touching GLSL uniforms. */
export function normalizeFilterParams(id, values = {}) {
  return Object.fromEntries(getFilterDefinition(id).controls.map((control) => {
    const value = values?.[control.key];
    return [control.key, control.type === 'color'
      ? (/^#[0-9a-f]{6}$/i.test(value) ? value : control.default)
      : Number.isFinite(Number(value)) ? Math.max(control.min, Math.min(control.max, Number(value))) : control.default];
  }));
}
