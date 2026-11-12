import type { ProtocolMessage } from './generated/messages.js';

export interface MockClient {
  readonly id: string;
  /** 本机控制面连接：只有它能调用 sessionCreate / listGames。 */
  local: boolean;
  channel: 'session' | 'game';
  connected: boolean;
  memberId?: string;
  ticket?: string;
  gameTicket?: string;
  readonly inbox: ProtocolMessage[];
}

/** 只记录投递，不模拟真实网络；连接身份由 MockSessionService 管理。 */
export class MockTransport {
  private sequence = 0;

  connect(options: { local?: boolean } = {}): MockClient {
    this.sequence += 1;
    return {
      id: `conn-${this.sequence}`,
      local: options.local === true,
      channel: 'session',
      connected: true,
      inbox: [],
    };
  }

  deliver(client: MockClient, message: ProtocolMessage): void {
    if (client.connected) client.inbox.push(message);
  }

  disconnect(client: MockClient): void {
    client.connected = false;
  }
}
