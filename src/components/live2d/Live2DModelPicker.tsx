import type { Live2DCatalog } from '@lib/live2d/types';

interface Props {
  catalog: Live2DCatalog;
  locale: string;
  selected: { characterId: string; costumeId: string };
  title: string;
  onSelect: (selection: { characterId: string; costumeId: string }) => void;
}

function label(values: Record<string, string>, locale: string): string {
  return values[locale] ?? values.zh ?? values.en ?? Object.values(values)[0] ?? '';
}

export function Live2DModelPicker({ catalog, locale, selected, title, onSelect }: Props) {
  return (
    <section className="live2d-panel" aria-label={title}>
      <h2>{title}</h2>
      <div className="live2d-picker-list">
        {catalog.characters.map((character) => (
          <div key={character.id} className="live2d-picker-group">
            <strong>{label(character.label, locale)}</strong>
            <div>
              {character.costumes.map((costume) => {
                const active = selected.characterId === character.id && selected.costumeId === costume.id;
                return (
                  <button
                    key={costume.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelect({ characterId: character.id, costumeId: costume.id })}
                  >
                    {label(costume.label, locale)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
