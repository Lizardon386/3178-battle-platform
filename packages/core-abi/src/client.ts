export interface GameClientContract {
  /** 把对局状态渲染进容器；返回的视图要能在下一次 mount 时替换。 */
  mount(host: HTMLElement, view: unknown, actions: GameActions): void;
  unmount?(host: HTMLElement): void;
  onEvent?(event: { name: string; payload?: unknown }, actions: GameActions): void;
}

export interface GameActions {
  send(name: string, payload?: unknown): void;
  seatId(): string | null;
}
