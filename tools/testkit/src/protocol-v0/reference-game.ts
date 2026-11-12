import type { MockSessionService } from './mock-session-service.js';
import type { PlatformToAuthorityMessage } from './generated/messages.js';

/** 最小参考游戏：一个公共计数 + 每成员私密最近动作；不含真实玩法、UI、socket 或计时器。 */
export class ReferenceGame {
  private count = 0;
  private hostMemberId = '';
  private epoch = 0;
  private gameSequence = 0;
  private closed = false;
  private readonly lastAction = new Map<string, unknown>();
  readonly received: PlatformToAuthorityMessage[] = [];

  constructor(private readonly platform: MockSessionService) {}

  receive(message: PlatformToAuthorityMessage): void {
    this.received.push(message);
    switch (message.type) {
      case 'start':
        this.count = 0;
        this.hostMemberId = message.hostMemberId;
        this.epoch = message.authorityEpoch;
        this.gameSequence = 0;
        this.lastAction.clear();
        this.platform.receiveFromAuthority({ type: 'authorityReady', authorityEpoch: this.epoch, processStatus: 'running' });
        break;
      case 'deliver': {
        const action = message.payload;
        this.count += 1;
        this.gameSequence += 1;
        this.lastAction.set(message.fromMemberId, action);
        this.platform.receiveFromAuthority({
          type: 'deliver',
          gameSequence: this.gameSequence,
          authorityEpoch: this.epoch,
          items: [
            { to: 'all', payload: { count: this.count } },
            { to: message.fromMemberId, payload: { privateLastAction: action } },
          ],
        });
        break;
      }
      case 'sync': {
        this.platform.receiveFromAuthority({
          type: 'deliver',
          gameSequence: this.gameSequence,
          authorityEpoch: this.epoch,
          items: [{ to: message.memberId, payload: { privateLastAction: this.lastAction.get(message.memberId) ?? null } }],
        });
        break;
      }
      case 'memberLeave':
        if (message.reason !== 'disconnected') this.lastAction.delete(message.memberId);
        break;
      case 'hostChanged': this.hostMemberId = message.hostMemberId; break;
      case 'closeSession': this.closed = true; break;
      case 'memberJoin':
      case 'memberResume':
      case 'memberUpdate':
      case 'ping': break;
    }
  }

  get currentHostMemberId(): string { return this.hostMemberId; }
  get currentEpoch(): number { return this.epoch; }
  get isClosed(): boolean { return this.closed; }
  get currentCount(): number { return this.count; }
}
