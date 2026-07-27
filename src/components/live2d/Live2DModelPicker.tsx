import { Live2DPanel } from '@components/live2d/Live2DPanel';
import { Icon } from '@iconify/react';
import type { Live2DCatalog } from '@lib/live2d/types';
import { useEffect, useMemo, useState } from 'react';

const CHARACTERS_PER_PAGE = 5;
const COSTUMES_PER_PAGE = 6;

interface Props {
  catalog: Live2DCatalog;
  locale: string;
  selected: { characterId: string; costumeId: string };
  title: string;
  labels: Record<string, string>;
  onSelect: (selection: { characterId: string; costumeId: string }) => void;
  onClose: () => void;
}

function label(values: Record<string, string>, locale: string): string {
  return values[locale] ?? values.zh ?? values.en ?? Object.values(values)[0] ?? '';
}

function clampPage(page: number, count: number): number {
  return Math.max(0, Math.min(page, Math.max(0, count - 1)));
}

function Pager({
  page,
  pages,
  labels,
  onPage,
}: {
  page: number;
  pages: number;
  labels: Record<string, string>;
  onPage: (page: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <nav className="live2d-pagination" aria-label={labels.pagination}>
      <button
        type="button"
        disabled={page === 0}
        aria-label={labels.previousPage}
        title={labels.previousPage}
        onClick={() => onPage(page - 1)}
      >
        <Icon icon="ri:arrow-left-s-line" aria-hidden="true" />
      </button>
      <span>{labels.pageStatus.replace('{current}', String(page + 1)).replace('{total}', String(pages))}</span>
      <button
        type="button"
        disabled={page === pages - 1}
        aria-label={labels.nextPage}
        title={labels.nextPage}
        onClick={() => onPage(page + 1)}
      >
        <Icon icon="ri:arrow-right-s-line" aria-hidden="true" />
      </button>
    </nav>
  );
}

export function Live2DModelPicker({ catalog, locale, selected, title, labels, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [expandedCharacter, setExpandedCharacter] = useState(selected.characterId);
  const [characterPage, setCharacterPage] = useState(0);
  const [costumePages, setCostumePages] = useState<Record<string, number>>({});

  const filteredCharacters = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return catalog.characters;
    return catalog.characters.filter((character) => {
      const characterLabels = Object.values(character.label);
      const costumeLabels = character.costumes.flatMap((costume) => Object.values(costume.label));
      return [...characterLabels, ...costumeLabels].some((value) => value.toLocaleLowerCase().includes(normalized));
    });
  }, [catalog.characters, query]);

  const characterPageCount = Math.max(1, Math.ceil(filteredCharacters.length / CHARACTERS_PER_PAGE));
  const visibleCharacters = filteredCharacters.slice(
    characterPage * CHARACTERS_PER_PAGE,
    (characterPage + 1) * CHARACTERS_PER_PAGE,
  );

  useEffect(() => {
    setCharacterPage(0);
    if (query) setExpandedCharacter(filteredCharacters[0]?.id ?? '');
  }, [filteredCharacters, query]);

  useEffect(() => {
    if (query) return;
    const selectedIndex = catalog.characters.findIndex((character) => character.id === selected.characterId);
    setExpandedCharacter(selected.characterId);
    if (selectedIndex >= 0) setCharacterPage(Math.floor(selectedIndex / CHARACTERS_PER_PAGE));
  }, [catalog.characters, query, selected.characterId]);

  useEffect(() => {
    setCharacterPage((page) => clampPage(page, characterPageCount));
  }, [characterPageCount]);

  return (
    <Live2DPanel title={title} closeLabel={labels.close} onClose={onClose}>
      <label className="live2d-search">
        <Icon icon="ri:search-line" aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder={labels.searchPlaceholder}
          aria-label={labels.search}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>

      <div className="live2d-picker-list">
        {visibleCharacters.map((character) => {
          const characterName = label(character.label, locale);
          const expanded = expandedCharacter === character.id;
          const selectedCharacter = selected.characterId === character.id;
          const costumePageCount = Math.max(1, Math.ceil(character.costumes.length / COSTUMES_PER_PAGE));
          const costumePage = clampPage(costumePages[character.id] ?? 0, costumePageCount);
          const visibleCostumes = character.costumes.slice(
            costumePage * COSTUMES_PER_PAGE,
            (costumePage + 1) * COSTUMES_PER_PAGE,
          );
          return (
            <section key={character.id} className="live2d-picker-group" data-selected={selectedCharacter || undefined}>
              <button
                type="button"
                className="live2d-character-row"
                aria-expanded={expanded}
                onClick={() => setExpandedCharacter(expanded ? '' : character.id)}
              >
                <span className="live2d-character-mark" aria-hidden="true">
                  {characterName.slice(0, 1)}
                </span>
                <span className="live2d-character-copy">
                  <strong>{characterName}</strong>
                  <small>{labels.costumeCount.replace('{count}', String(character.costumes.length))}</small>
                </span>
                <Icon icon={expanded ? 'ri:arrow-up-s-line' : 'ri:arrow-down-s-line'} aria-hidden="true" />
              </button>
              {expanded && (
                <div className="live2d-costume-list">
                  {visibleCostumes.map((costume) => {
                    const active = selectedCharacter && selected.costumeId === costume.id;
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
                  <Pager
                    page={costumePage}
                    pages={costumePageCount}
                    labels={labels}
                    onPage={(page) => setCostumePages((current) => ({ ...current, [character.id]: page }))}
                  />
                </div>
              )}
            </section>
          );
        })}
        {filteredCharacters.length === 0 && <p className="live2d-empty">{labels.noResults}</p>}
      </div>
      <Pager page={characterPage} pages={characterPageCount} labels={labels} onPage={setCharacterPage} />
    </Live2DPanel>
  );
}
