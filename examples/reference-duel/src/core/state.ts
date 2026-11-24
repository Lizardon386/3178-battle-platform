import { buildDeck, shuffle, type Card } from './cards.js';

export const MAX_HP = 12;
export const MAX_ROUNDS = 40;

export interface PlayerState {
  memberId: string;
  hp: number;
  shield: number;
  deck: Card[];
  hand: Card[];
  fatigue: number;
}

export interface GameState {
  roundId: string;
  players: PlayerState[];
  turnIndex: number;
  turnNumber: number;
  log: string[];
  finished: boolean;
  winner?: string;
  reason?: string;
}

export type Action = { type: 'play'; cardId: string } | { type: 'concede' } | { type: 'pass' };

export interface PublicPlayer {
  memberId: string;
  hp: number;
  shield: number;
  deckCount: number;
  handCount: number;
}

export interface PublicView {
  roundId: string;
  turnNumber: number;
  currentMemberId: string;
  players: PublicPlayer[];
  log: string[];
  finished: boolean;
  winner?: string;
  reason?: string;
}

export interface PrivateView extends PublicView {
  you: string;
  hand: Card[];
}

export type ApplyResult = { ok: true; state: GameState } | { ok: false; code: string; message: string };

const drawCard = (player: PlayerState): void => {
  if (player.deck.length === 0) {
    player.fatigue += 1;
    player.hp -= player.fatigue;
    return;
  }
  player.hand.push(player.deck.pop()!);
};

const beginTurn = (state: GameState): void => {
  const player = state.players[state.turnIndex]!;
  player.shield = 0;
  drawCard(player);
};

export function createGame(roundId: string, memberIds: string[], random: () => number): GameState {
  if (memberIds.length !== 2) throw new Error('reference-duel 需要两名玩家');
  const players = memberIds.map((memberId) => {
    const deck = shuffle(buildDeck(), random);
    const hand = deck.splice(0, 3);
    return { memberId, hp: MAX_HP, shield: 0, deck, hand, fatigue: 0 };
  });
  const state: GameState = {
    roundId,
    players,
    turnIndex: 0,
    turnNumber: 1,
    log: ['对局开始'],
    finished: false,
  };
  beginTurn(state);
  return state;
}

const current = (state: GameState): PlayerState => state.players[state.turnIndex]!;
const opponent = (state: GameState): PlayerState => state.players[(state.turnIndex + 1) % 2]!;

const finish = (state: GameState, winner: string | undefined, reason: string): void => {
  state.finished = true;
  state.winner = winner;
  state.reason = reason;
  state.log.push(reason);
};

const checkFinish = (state: GameState): void => {
  const dead = state.players.find((player) => player.hp <= 0);
  if (dead) {
    const winner = state.players.find((player) => player.memberId !== dead.memberId)!;
    finish(state, winner.memberId, `${dead.memberId} 倒下`);
  }
};

export function applyAction(input: GameState, memberId: string, action: Action): ApplyResult {
  const state = structuredClone(input);
  if (state.finished) return { ok: false, code: 'FINISHED', message: '对局已结束' };
  const actor = current(state);
  if (actor.memberId !== memberId) return { ok: false, code: 'TURN', message: '还没轮到你' };

  if (action.type === 'concede') {
    finish(state, opponent(state).memberId, `${memberId} 认输`);
    return { ok: true, state };
  }

  if (action.type === 'play') {
    const index = actor.hand.findIndex((card) => card.id === action.cardId);
    if (index < 0) return { ok: false, code: 'CARD', message: '手牌不存在' };
    const [card] = actor.hand.splice(index, 1);
    const other = opponent(state);
    if (card!.kind === 'strike') {
      other.hp -= 3;
      state.log.push(`${memberId} 斩击造成 3 点伤害`);
    } else if (card!.kind === 'shield') {
      actor.shield += 3;
      state.log.push(`${memberId} 获得 3 点护盾`);
    } else if (card!.kind === 'drain') {
      other.hp -= 2;
      actor.hp = Math.min(MAX_HP, actor.hp + 2);
      state.log.push(`${memberId} 汲取 2 点伤害并回复 2 点`);
    } else {
      drawCard(actor);
      drawCard(actor);
      state.log.push(`${memberId} 抽 2 张牌`);
    }
    checkFinish(state);
    if (state.finished) return { ok: true, state };
  }

  state.turnIndex = (state.turnIndex + 1) % 2;
  state.turnNumber += 1;
  if (state.turnNumber > MAX_ROUNDS) {
    const [left, right] = state.players;
    const winner = left!.hp === right!.hp ? undefined : left!.hp > right!.hp ? left!.memberId : right!.memberId;
    finish(state, winner, winner ? `回合上限，${winner} 血量领先` : '回合上限，平局');
    return { ok: true, state };
  }
  beginTurn(state);
  checkFinish(state);
  return { ok: true, state };
}

export function publicView(state: GameState): PublicView {
  return {
    roundId: state.roundId,
    turnNumber: state.turnNumber,
    currentMemberId: current(state).memberId,
    players: state.players.map((player) => ({
      memberId: player.memberId, hp: player.hp, shield: player.shield,
      deckCount: player.deck.length, handCount: player.hand.length,
    })),
    log: state.log.slice(-50),
    finished: state.finished,
    ...(state.winner === undefined ? {} : { winner: state.winner }),
    ...(state.reason === undefined ? {} : { reason: state.reason }),
  };
}

export function privateView(state: GameState, memberId: string): PrivateView {
  const player = state.players.find((item) => item.memberId === memberId);
  return { ...publicView(state), you: memberId, hand: player?.hand ?? [] };
}
