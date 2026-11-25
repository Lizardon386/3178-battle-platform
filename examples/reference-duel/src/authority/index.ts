import { AuthorityRuntime } from '@bp/authority-runtime';
import type { AuthorityContext } from '@bp/game-sdk-stub';
import type { AuthorityCallbackMessage, GameState, Action } from './types.js';
import { applyAction, createGame, privateView, publicView } from '../core/state.js';

export interface AuthorityOptions {
  stateDir: string;
  sessionId: string;
  epoch: number;
  roundId: string;
  members: Array<{ memberId: string; displayName?: string }>;
  transport: { send(message: unknown): void };
  seed?: number;
}

export function createReferenceAuthority(options: AuthorityOptions): AuthorityRuntime {
  let state: GameState | null = null;

  const publish = async (context: AuthorityContext): Promise<void> => {
    if (!state) return;
    // 先落检查点再投递：崩溃恢复时客户端看到的最后状态不会超前于磁盘。
    await context.checkpoint();
    const items = [{ to: 'all', payload: { type: 'public', view: publicView(state) } }];
    for (const player of state.players) {
      items.push({ to: player.memberId, payload: { type: 'private', view: privateView(state, player.memberId) } });
    }
    context.deliver(items);
    if (state.finished) context.roundClosed({ winner: state.winner, reason: state.reason });
  };

  return new AuthorityRuntime({
    stateDir: options.stateDir,
    sessionId: options.sessionId,
    epoch: options.epoch,
    roundId: options.roundId,
    members: options.members,
    ...(options.seed === undefined ? {} : { seed: options.seed }),
    transport: options.transport,
    hooks: {
      async start(_message, restored, context) {
        state = restored ? (restored as GameState) : createGame(options.roundId, options.members.map((m) => m.memberId), context.random);
        context.ready();
        await publish(context);
      },
      async deliver(message, context) {
        if (!state) return;
        const callback = message as unknown as AuthorityCallbackMessage;
        const action = callback.payload as { action?: Action } | undefined;
        if (!action?.action) {
          context.fail('BADMSG', '缺少 action');
          return;
        }
        const result = applyAction(state, callback.fromMemberId, action.action);
        if (!result.ok) {
          context.deliver([{ to: callback.fromMemberId, payload: { type: 'rejected', code: result.code, message: result.message } }]);
          return;
        }
        state = result.state;
        await publish(context);
      },
      sync(message, context) {
        if (!state) return;
        const memberId = String(message.memberId);
        context.deliver([
          { to: memberId, payload: { type: 'public', view: publicView(state) } },
          { to: memberId, payload: { type: 'private', view: privateView(state, memberId) } },
        ]);
      },
      snapshot() {
        return state;
      },
      validateSnapshot(value) {
        return Boolean(value && typeof value === 'object' && Array.isArray((value as GameState).players));
      },
    },
  });
}
