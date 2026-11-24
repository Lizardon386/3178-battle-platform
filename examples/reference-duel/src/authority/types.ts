export type { Action, GameState } from '../core/state.js';

export interface AuthorityCallbackMessage {
  type: string;
  fromMemberId: string;
  payload?: unknown;
}
