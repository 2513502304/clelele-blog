import { z } from 'zod';
import type { Live2DCatalog } from './types';

const entrySchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  group: z
    .string()
    .regex(/^[a-zA-Z0-9_]+$/)
    .optional(),
  names: z.record(z.string(), z.string()).optional(),
  label: z.string().optional(),
});
export interface OurNotesModel extends z.infer<typeof entrySchema> {
  site: string;
}

/** Later (story) sources supply smaller native files; earlier localized names are retained. */
export function mergeOurNotesIndexes(sources: Array<{ site: string; models: unknown[] }>): OurNotesModel[] {
  const models = new Map<string, OurNotesModel>();
  for (const source of sources) {
    for (const value of source.models) {
      const model = entrySchema.parse(value);
      const previous = models.get(model.id);
      models.set(model.id, { ...previous, ...model, names: model.names ?? previous?.names, site: source.site });
    }
  }
  const namesByCharacter = new Map<string, Record<string, string>>();
  for (const model of models.values())
    if (model.group && model.names) namesByCharacter.set(model.group.replace(/_(adv|live)$/, ''), model.names);
  return [...models.values()]
    .map((model) => ({ ...model, names: model.names ?? namesByCharacter.get(model.group?.replace(/_(adv|live)$/, '') ?? '') }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

const costumeWords: Record<string, string> = {
  casual: '便服',
  spring: '春',
  summer: '夏',
  winter: '冬',
  school: '制服',
  hs: '高中',
  jhs: '初中',
  live: '演出',
  roomwear: '居家',
  arbeit: '打工',
  glasses: '眼镜',
  child: '幼年',
  low: '轻量版',
  halloween: '万圣节',
  birthday2627: '生日',
  hairdown: '散发',
  twintails: '双马尾',
  still: '静态差分',
};

/** Merge the same person across games, while source-prefixed costume IDs never collide. */
export function ourNotesIdentity(model: OurNotesModel, catalog: Live2DCatalog) {
  const normalized = (name: string) => name.replace(/\s/g, '').toLocaleLowerCase();
  // Ave Mujica source labels include stage names (e.g. "Doloris / 三角初华").
  // Match each explicit alias, never a substring, to avoid duplicating the GBP character.
  const names = Object.values(model.names ?? {}).flatMap((name) => name.split('/').map(normalized));
  const match = catalog.characters.find((character) =>
    Object.values(character.label).some((name) => name.split('/').some((alias) => names.includes(normalized(alias)))),
  );
  const group = model.group ?? model.id.replace(/^(?:adv_)?live2d_/, '').replace(/_\d{3}_.*/, '');
  const fallback = group.replace(/^sub_/, '').replace(/_/g, ' ');
  const characterLabels = match?.label ?? {
    zh: model.names?.['zh-Hans'] ?? model.names?.['zh-Hant'] ?? model.label ?? fallback,
    en: model.names?.en ?? fallback,
    ja: model.names?.ja ?? model.label ?? fallback,
  };
  const costume = model.id.replace(/^(?:adv_)?live2d_(?:sub_)?/, '').replace(/^.*?_\d{3}_/, '');
  const words = costume.split('_').filter((part) => part !== '01');
  return {
    characterId:
      match?.id ??
      `our-notes-${group
        .replace(/_(adv|live)$/, '')
        .replace(/_/g, '-')
        .toLowerCase()}`,
    characterLabels,
    costumeId: `our-notes-${model.id.replace(/_/g, '-')}`,
    costumeLabels: {
      zh: `Our Notes · ${words.map((word) => costumeWords[word] ?? word).join(' · ')}`,
      en: `Our Notes · ${words.join(' ')}`,
      ja: `Our Notes · ${words.join(' ')}`,
    },
  };
}
