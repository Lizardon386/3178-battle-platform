import type { MockSessionService } from './mock-session-service.js';
import type { PlatformToAuthorityMessage } from './generated/messages.js';

/** 最小参考游戏：一个公共计数 + 每座私密最近动作；不含真实玩法、UI、socket 或计时器。 */
export class ReferenceGame {
  private count = 0;
  private hostSeatId = 0;
  private closed = false;
  private readonly lastAction = new Map<number, unknown>();
  readonly received: PlatformToAuthorityMessage[] = [];

  constructor(private readonly platform: MockSessionService) {}

  receive(message: PlatformToAuthorityMessage): void {
    this.received.push(message);
    switch (message.type) {
      case 'start':
        this.count = 0;
        this.hostSeatId = message.hostSeatId;
        this.lastAction.clear();
        this.platform.receiveFromAuthority({ type: 'authorityReady', processStatus: 'running' });
        break;
      case 'deliver': {
        const action = message.payload;
        this.count += 1;
        this.lastAction.set(message.fromSeat, action);
        this.platform.receiveFromAuthority({
          type: 'deliver',
          items: [
            { to: 'all', payload: { count: this.count } },
            { to: message.fromSeat, payload: { privateLastAction: action } },
          ],
        });
        break;
      }
      case 'memberResume': {
        const privateLastAction = this.lastAction.get(message.seatId);
        this.platform.receiveFromAuthority({
          type: 'deliver',
          items: [{ to: message.seatId, payload: { privateLastAction: privateLastAction ?? null } }],
        });
        break;
      }
      case 'memberLeave':
        if (message.reason !== 'disconnected') this.lastAction.delete(message.seatId);
        break;
      case 'hostChanged': this.hostSeatId = message.hostSeatId; break;
      case 'closeSession': this.closed = true; break;
      case 'memberJoin':
      case 'memberUpdate':
      case 'ping': break;
    }
  }

  get currentHostSeatId(): number { return this.hostSeatId; }
  get isClosed(): boolean { return this.closed; }
  get currentCount(): number { return this.count; }
}
