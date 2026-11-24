export type CardKind = 'strike' | 'shield' | 'drain' | 'draw';

export interface Card {
  id: string;
  kind: CardKind;
}

export const CARD_LABEL: Record<CardKind, string> = {
  strike: '斩击',
  shield: '护盾',
  drain: '汲取',
  draw: '过牌',
};

export function buildDeck(): Card[] {
  const cards: Card[] = [];
  for (const kind of ['strike', 'shield', 'drain', 'draw'] as const) {
    for (let index = 0; index < 4; index += 1) cards.push({ id: `${kind}-${index}`, kind });
  }
  return cards;
}

/** Fisher-Yates，随机源由调用方注入，保证测试可复现。 */
export function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [out[index], out[swap]] = [out[swap]!, out[index]!];
  }
  return out;
}
