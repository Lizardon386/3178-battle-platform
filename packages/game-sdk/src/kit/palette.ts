import type { SeatLike } from './shared.js';

export interface SeatColor {
  index: number;
  name: string;
  value: string;
}

const PALETTE: ReadonlyArray<{ name: string; value: string }> = [
  { name: 'red', value: '#e05d5d' },
  { name: 'blue', value: '#5d9ce0' },
  { name: 'green', value: '#5dbe7a' },
  { name: 'yellow', value: '#d6b85d' },
  { name: 'purple', value: '#a98ae0' },
  { name: 'teal', value: '#5dc9c9' },
  { name: 'orange', value: '#e09a5d' },
  { name: 'pink', value: '#d98ab8' },
];

function mod(value: number): number {
  return ((value % PALETTE.length) + PALETTE.length) % PALETTE.length;
}

function hashTeam(team: string): number {
  let hash = 0;
  for (let i = 0; i < team.length; i += 1) hash = (hash * 31 + team.charCodeAt(i)) | 0;
  return hash;
}

/** 队伍优先，其次座位号；同一输入永远得到同一种颜色。 */
export function seatColor(seat: SeatLike): SeatColor {
  let index: number;
  if (typeof seat.team === 'number' && Number.isFinite(seat.team)) {
    index = mod(Math.trunc(seat.team) - 1);
  } else if (typeof seat.team === 'string' && seat.team.length > 0) {
    index = mod(hashTeam(seat.team));
  } else if (typeof seat.slot === 'number' && Number.isFinite(seat.slot)) {
    index = mod(Math.trunc(seat.slot) - 1);
  } else {
    index = 0;
  }
  const color = PALETTE[index]!;
  return { index, ...color };
}
