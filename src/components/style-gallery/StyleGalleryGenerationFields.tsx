import {
  acceptsNegative,
  backgroundsFor,
  type GenerationSettings,
  generationCaption,
  modesFor,
  openAIModels,
  outputFormats,
  pixAIModels,
  pixAIRatios,
  pixAISizes,
  pixAIVersions,
  qualitiesFor,
  sizesFor,
} from '@lib/style-gallery-generation-settings';
import { Fragment } from 'react';
import { RiEqualizer2Line } from 'react-icons/ri';
import type { StyleGalleryImageRef } from '@/types/style-gallery';
export const studioLanguage = (locale: string) => (zh: string, ja: string, en: string) =>
  locale.startsWith('zh') ? zh : locale.startsWith('ja') ? ja : en;
type Translate = ReturnType<typeof studioLanguage>;
function Choice<T extends string>({
  label,
  value,
  options,
  change,
}: {
  label: string;
  value: T;
  options: readonly T[];
  change: (value: T) => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => change(event.target.value as T)}>
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

/** The same capability tables drive the controls and server validation. Switching models removes incompatible parameters. */
export function GenerationFields({
  settings: s,
  change,
  refs,
  l,
}: {
  settings: GenerationSettings;
  change: (s: GenerationSettings) => void;
  refs: StyleGalleryImageRef[];
  l: Translate;
}) {
  const model = l('模型', 'モデル', 'Model'),
    size = l('尺寸', 'サイズ', 'Size'),
    quality = l('质量', '品質', 'Quality'),
    count = l('生成数量', '生成枚数', 'Image count');
  return (
    <>
      <div className="studio-param-row">
        {s.platform === 'gpt-image' ? (
          <>
            <Choice
              label={model}
              value={s.model}
              options={openAIModels}
              change={(model) =>
                change({
                  ...s,
                  model,
                  size: sizesFor(model).includes(s.size) ? s.size : '1024x1024',
                  quality: qualitiesFor(model).includes(s.quality) ? s.quality : 'medium',
                  background: backgroundsFor(model, s.format ?? 'png').includes(s.background ?? 'auto') ? s.background : 'auto',
                })
              }
            />
            <Choice label={size} value={s.size} options={sizesFor(s.model)} change={(size) => change({ ...s, size })} />
            <Choice
              label={quality}
              value={s.quality}
              options={qualitiesFor(s.model)}
              change={(quality) => change({ ...s, quality })}
            />
            <Choice
              label={count}
              value={String(s.count ?? 1)}
              options={['1', '2', '3', '4']}
              change={(n) => change({ ...s, count: Number(n) })}
            />
          </>
        ) : (
          <>
            <Choice
              label={model}
              value={s.model}
              options={pixAIModels}
              change={(model) =>
                change({
                  ...s,
                  model,
                  mode: modesFor(model).includes(s.mode) ? s.mode : 'pro',
                  contextImages: model === 'Tsubaki.3' ? s.contextImages : undefined,
                })
              }
            />
            <Choice
              label={l('画幅', '縦横比', 'Aspect ratio')}
              value={s.ratio}
              options={pixAIRatios}
              change={(ratio) => change({ ...s, ratio })}
            />
            <Choice label={size} value={s.size} options={pixAISizes} change={(size) => change({ ...s, size })} />
            <Choice
              label={count}
              value={String(s.count ?? 1)}
              options={['1', '4']}
              change={(n) => change({ ...s, count: n === '4' ? 4 : 1 })}
            />
          </>
        )}
      </div>
      <details className="studio-advanced">
        <summary>
          <RiEqualizer2Line />
          {l('更多参数', '詳細設定', 'More settings')}
        </summary>
        <div className="studio-advanced-grid">
          {s.platform === 'gpt-image' ? (
            <>
              <label>
                {l('参考图输入', '参照画像', 'Reference input')}
                <select
                  value={s.referenceHash ?? ''}
                  onChange={(e) => change({ ...s, referenceHash: e.target.value || undefined })}
                >
                  <option value="">{l('仅使用提示词', 'テキストのみ', 'Text only')}</option>
                  {refs.map((ref, i) => (
                    <option key={ref.imageHash} value={ref.imageHash}>
                      {l('编辑条目参考图', '参照画像を編集', 'Edit reference')} {i + 1}
                    </option>
                  ))}
                </select>
              </label>
              <Choice
                label={l('输出格式', '出力形式', 'Output format')}
                value={s.format ?? 'png'}
                options={outputFormats}
                change={(format) =>
                  change({
                    ...s,
                    format,
                    compression: format === 'png' ? undefined : (s.compression ?? 100),
                    background: format === 'jpeg' && s.background === 'transparent' ? 'auto' : s.background,
                  })
                }
              />
              <Choice
                label={l('背景', '背景', 'Background')}
                value={s.background ?? 'auto'}
                options={backgroundsFor(s.model, s.format ?? 'png')}
                change={(background) => change({ ...s, background })}
              />
              {s.format && s.format !== 'png' && (
                <label>
                  {l('输出压缩', '圧縮率', 'Output compression')} · {s.compression ?? 100}%
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={s.compression ?? 100}
                    onChange={(e) => change({ ...s, compression: Number(e.target.value) })}
                  />
                </label>
              )}
            </>
          ) : (
            <>
              <Choice
                label={l('推理档位', '推論モード', 'Inference profile')}
                value={s.mode}
                options={modesFor(s.model)}
                change={(mode) => change({ ...s, mode, negativePrompt: acceptsNegative(mode) ? s.negativePrompt : undefined })}
              />
              <Choice
                label={l('提示词辅助', 'プロンプト補助', 'Prompt helper')}
                value={s.helper ?? 'disable'}
                options={['disable', 'low', 'medium', 'enable'] as const}
                change={(helper) => change({ ...s, helper })}
              />
              <label>
                {l('随机种子', 'シード', 'Seed')}
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="4294967295"
                  placeholder={l('随机', 'ランダム', 'Random')}
                  value={s.seed ?? ''}
                  onChange={(e) => change({ ...s, seed: e.target.value === '' ? undefined : Number(e.target.value) })}
                />
              </label>
              {s.model === 'Tsubaki.3' && (
                <label>
                  {l('参考图 Media ID（最多 3 张）', '参照画像の Media ID（最大 3 枚）', 'Reference media IDs (up to 3)')}
                  <input
                    key={s.contextImages?.join(',')}
                    defaultValue={s.contextImages?.join(', ')}
                    placeholder="ID, ID, ID"
                    onBlur={(e) => change({ ...s, contextImages: e.target.value.split(/[,，\s]+/).filter(Boolean) })}
                  />
                </label>
              )}
              {acceptsNegative(s.mode) && (
                <label className="studio-wide">
                  {l('负向提示词', 'ネガティブプロンプト', 'Negative prompt')}
                  <textarea
                    rows={2}
                    maxLength={32000}
                    value={s.negativePrompt ?? ''}
                    onChange={(e) => change({ ...s, negativePrompt: e.target.value })}
                  />
                </label>
              )}
            </>
          )}
        </div>
      </details>
    </>
  );
}

/** Show the stored recipe on a published example, including optional settings specific to its provider. */
export function GenerationDetails({ settings: s, locale }: { settings: GenerationSettings; locale: string }) {
  const l = studioLanguage(locale);
  const rows: ReadonlyArray<readonly [string, string | number | undefined]> = [
    [l('批次数量', '生成枚数', 'Batch size'), s.count ?? 1],
    ...(s.platform === 'gpt-image'
      ? ([
          [l('输出格式', '形式', 'Format'), s.format ?? 'png'],
          [l('背景', '背景', 'Background'), s.background ?? 'auto'],
          [l('输出压缩', '圧縮率', 'Compression'), s.compression === undefined ? undefined : `${s.compression}%`],
          [l('参考图 SHA-256', '参照 SHA-256', 'Reference SHA-256'), s.referenceHash],
        ] as const)
      : ([
          [l('模型版本 ID', 'モデル ID', 'Model version ID'), pixAIVersions[s.model]],
          [l('随机种子', 'シード', 'Seed'), s.seed ?? l('随机', 'ランダム', 'Random')],
          [l('提示词辅助', 'プロンプト補助', 'Prompt helper'), s.helper ?? 'disable'],
          [l('负向提示词', 'ネガティブプロンプト', 'Negative prompt'), s.negativePrompt],
          [l('参考图 Media ID', '参照 Media ID', 'Reference media IDs'), s.contextImages?.join(', ')],
        ] as const)),
  ];
  return (
    <details className="mb-2 text-muted-foreground text-xs">
      <summary className="cursor-pointer">{generationCaption(s)}</summary>
      <dl className="my-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        {rows
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([key, value]) => (
            <Fragment key={key}>
              <dt>{key}</dt>
              <dd className="whitespace-pre-wrap break-all text-foreground">{value}</dd>
            </Fragment>
          ))}
      </dl>
    </details>
  );
}
