import type { RoomPhase, SeatView } from '@bp/protocol';
import { seatColor } from '../palette.js';

export interface ScoreboardRow {
  seatId: string;
  values: Record<string, unknown>;
}

export interface ScoreboardColumn {
  key: string;
  label: string;
  value?: string | ((row: ScoreboardRow) => unknown);
  format?: (value: unknown, row: ScoreboardRow) => string;
  /** 自定义单元格节点；返回 null 时退回 format。 */
  render?: (value: unknown, row: ScoreboardRow) => Node | null;
  sortValue?: (row: ScoreboardRow) => number | string;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  width?: string | number;
}

export interface ScoreboardRoom {
  code: string;
  phase: RoomPhase | 'none';
  seats: SeatView[];
}

export interface ScoreboardSort {
  key: string;
  dir: 'asc' | 'desc';
}

export interface ScoreboardPanelOptions {
  mount?: HTMLElement;
  columns: readonly ScoreboardColumn[];
  rows?: readonly ScoreboardRow[];
  seats?: readonly SeatView[];
  showTeam?: boolean;
  showConnection?: boolean;
  showHost?: boolean;
  emptyText?: string;
  sort?: ScoreboardSort;
  /** 是否监听 window 的 bp:room；有 mount 时默认开。 */
  listen?: boolean;
}

export function normalizeScoreboardRows(rows: readonly unknown[]): ScoreboardRow[] {
  const out: ScoreboardRow[] = [];
  for (const value of rows) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const raw = value as Record<string, unknown>;
    if (typeof raw.seatId !== 'string' || raw.seatId.length === 0) continue;
    const values = raw.values;
    if (values !== undefined && (typeof values !== 'object' || values === null || Array.isArray(values))) continue;
    out.push({ seatId: raw.seatId, values: (values as Record<string, unknown> | undefined) ?? {} });
  }
  return out;
}

export function resolveColumnValue(column: ScoreboardColumn, row: ScoreboardRow): unknown {
  if (typeof column.value === 'function') return column.value(row);
  if (typeof column.value === 'string') return row.values[column.value];
  return row.values[column.key];
}

export function formatColumnValue(column: ScoreboardColumn, row: ScoreboardRow): string {
  const value = resolveColumnValue(column, row);
  if (column.format) return column.format(value, row);
  return value === null || value === undefined ? '—' : String(value);
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'zh-CN');
}

export function sortScoreboardRows(
  rows: readonly ScoreboardRow[],
  columns: readonly ScoreboardColumn[],
  sort: ScoreboardSort | undefined,
): ScoreboardRow[] {
  if (!sort) return [...rows];
  const column = columns.find((item) => item.key === sort.key);
  if (!column) return [...rows];
  const direction = sort.dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const left = column.sortValue ? column.sortValue(a) : resolveColumnValue(column, a);
    const right = column.sortValue ? column.sortValue(b) : resolveColumnValue(column, b);
    const leftMissing = left === null || left === undefined;
    const rightMissing = right === null || right === undefined;
    if (leftMissing || rightMissing) return leftMissing === rightMissing ? 0 : leftMissing ? 1 : -1;
    return compareValues(left, right) * direction;
  });
}

/** 座位表是主列表：没有游戏行的玩家也显示；有行但没座位的排在后面。 */
export function buildScoreboardRows(
  rows: readonly ScoreboardRow[],
  seats: readonly SeatView[],
): ScoreboardRow[] {
  const bySeat = new Map(rows.map((row) => [row.seatId, row]));
  const out: ScoreboardRow[] = [];
  for (const seat of [...seats].sort((a, b) => a.slot - b.slot)) {
    out.push(bySeat.get(seat.seatId) ?? { seatId: seat.seatId, values: {} });
    bySeat.delete(seat.seatId);
  }
  for (const row of rows) {
    if (bySeat.has(row.seatId)) out.push(row);
    bySeat.delete(row.seatId);
  }
  return out;
}

function teamText(team: string | number | null): string {
  return team === null || team === undefined ? '—' : String(team);
}

export function connectionLabel(seat: SeatView | undefined): string {
  if (!seat) return '—';
  if (seat.role === 'ai') return '电脑';
  if (seat.role === 'spectator') return '观战';
  return seat.connected ? '在线' : '离线';
}

function styleCell(cell: HTMLTableCellElement, align: 'left' | 'center' | 'right' | undefined, width: string | number | undefined): void {
  cell.style.padding = '6px 8px';
  cell.style.borderTop = '1px solid rgba(127,127,127,.22)';
  cell.style.textAlign = align ?? 'left';
  if (width !== undefined) cell.style.width = typeof width === 'number' ? `${width}px` : width;
}

/** 记分板只提供壳：列和值完全由游戏定义，平台只补座位元数据。 */
export class ScoreboardPanel {
  private readonly options: ScoreboardPanelOptions;
  private readonly columns: ScoreboardColumn[];
  private readonly root: HTMLDivElement | null = null;
  private readonly head: HTMLTableSectionElement | null = null;
  private readonly body: HTMLTableSectionElement | null = null;
  private readonly onRoom: ((event: Event) => void) | null = null;
  private rows: ScoreboardRow[] = [];
  private seats: SeatView[] = [];
  private sort: ScoreboardSort | undefined;

  constructor(options: ScoreboardPanelOptions) {
    this.options = options;
    this.columns = options.columns.filter((column) => typeof column.key === 'string' && column.key.length > 0);
    this.rows = normalizeScoreboardRows(options.rows ?? []);
    this.seats = [...(options.seats ?? [])];
    this.sort = options.sort;
    if (options.mount) {
      const doc = options.mount.ownerDocument;
      const root = doc.createElement('div');
      root.className = 'bp-scoreboard';
      root.style.cssText = 'overflow-x:auto;font:13px/1.5 system-ui, "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
      const table = doc.createElement('table');
      table.className = 'bp-scoreboard-table';
      table.setAttribute('aria-label', '记分板');
      table.style.cssText = 'width:100%;border-collapse:collapse;min-width:360px';
      const head = doc.createElement('thead');
      const body = doc.createElement('tbody');
      table.append(head, body);
      root.append(table);
      options.mount.replaceChildren(root);
      this.root = root;
      this.head = head;
      this.body = body;
    }
    if (options.listen ?? Boolean(options.mount)) {
      if (typeof window !== 'undefined') {
        this.onRoom = (event: Event) => {
          const room = (event as CustomEvent).detail as ScoreboardRoom | null;
          this.seats = room && Array.isArray(room.seats) ? [...room.seats] : [];
          this.render();
        };
        window.addEventListener('bp:room', this.onRoom);
      }
    }
    this.render();
  }

  setRows(rows: readonly ScoreboardRow[]): void {
    this.rows = normalizeScoreboardRows(rows);
    this.render();
  }

  setSeats(seats: readonly SeatView[]): void {
    this.seats = [...seats];
    this.render();
  }

  setRoom(room: ScoreboardRoom | null): void {
    this.setSeats(room?.seats ?? []);
  }

  setSort(sort: ScoreboardSort | undefined): void {
    this.sort = sort;
    this.render();
  }

  clear(): void {
    this.rows = [];
    this.seats = [];
    this.render();
  }

  destroy(): void {
    if (typeof window !== 'undefined' && this.onRoom) window.removeEventListener('bp:room', this.onRoom);
    this.options.mount?.replaceChildren();
    this.rows = [];
    this.seats = [];
  }

  private toggleSort(key: string): void {
    const current = this.sort;
    this.sort = current?.key === key
      ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' };
    this.render();
  }

  private render(): void {
    const head = this.head;
    const body = this.body;
    if (!head || !body || !this.root) return;
    const doc = this.root.ownerDocument;
    const seats = new Map(this.seats.map((seat) => [seat.seatId, seat]));
    const rows = sortScoreboardRows(buildScoreboardRows(this.rows, this.seats), this.columns, this.sort);
    head.replaceChildren();
    body.replaceChildren();

    const headerRow = doc.createElement('tr');
    const playerTh = doc.createElement('th');
    playerTh.scope = 'col';
    playerTh.textContent = '玩家';
    styleCell(playerTh, 'left', undefined);
    playerTh.style.textAlign = 'left';
    headerRow.append(playerTh);
    if (this.options.showTeam ?? true) {
      const th = doc.createElement('th');
      th.scope = 'col';
      th.textContent = '队伍';
      styleCell(th, 'left', undefined);
      headerRow.append(th);
    }
    if (this.options.showConnection ?? true) {
      const th = doc.createElement('th');
      th.scope = 'col';
      th.textContent = '连接';
      styleCell(th, 'left', undefined);
      headerRow.append(th);
    }
    for (const column of this.columns) {
      const th = doc.createElement('th');
      th.scope = 'col';
      if (column.sortable !== false) {
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'bp-scoreboard-sort';
        button.style.cssText = 'all:unset;cursor:pointer;font-weight:600';
        const active = this.sort?.key === column.key;
        button.textContent = `${column.label}${active ? (this.sort?.dir === 'asc' ? ' ↑' : ' ↓') : ''}`;
        button.addEventListener('click', () => this.toggleSort(column.key));
        th.append(button);
      } else {
        th.textContent = column.label;
      }
      th.style.fontWeight = '600';
      styleCell(th, column.align, column.width);
      headerRow.append(th);
    }
    head.append(headerRow);

    if (rows.length === 0) {
      const row = doc.createElement('tr');
      const cell = doc.createElement('td');
      cell.colSpan = 1 + (this.options.showTeam ?? true ? 1 : 0) + (this.options.showConnection ?? true ? 1 : 0) + this.columns.length;
      cell.textContent = this.options.emptyText ?? '暂无数据';
      cell.style.cssText = 'padding:12px 8px;opacity:.6;text-align:center';
      row.append(cell);
      body.append(row);
      return;
    }

    for (const row of rows) {
      const seat = seats.get(row.seatId);
      const tr = doc.createElement('tr');
      tr.dataset.seatId = row.seatId;

      const player = doc.createElement('td');
      const dot = doc.createElement('span');
      dot.className = 'bp-scoreboard-color';
      dot.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:${seatColor({ seatId: row.seatId, slot: seat?.slot, team: seat?.team }).value}`;
      const name = doc.createElement('span');
      name.textContent = seat?.name ?? row.seatId;
      player.append(dot, name);
      if (seat?.isHost && (this.options.showHost ?? true)) {
        const host = doc.createElement('span');
        host.className = 'bp-scoreboard-host';
        host.textContent = '房主';
        host.style.cssText = 'margin-left:6px;padding:0 4px;border:1px solid currentColor;border-radius:4px;font-size:11px;opacity:.75';
        player.append(host);
      }
      styleCell(player, 'left', undefined);
      tr.append(player);

      if (this.options.showTeam ?? true) {
        const team = doc.createElement('td');
        team.textContent = teamText(seat?.team ?? null);
        styleCell(team, 'left', undefined);
        tr.append(team);
      }
      if (this.options.showConnection ?? true) {
        const connection = doc.createElement('td');
        connection.textContent = connectionLabel(seat);
        connection.style.opacity = seat && (seat.role === 'ai' || seat.connected) ? '1' : '0.6';
        styleCell(connection, 'left', undefined);
        tr.append(connection);
      }
      for (const column of this.columns) {
        const cell = doc.createElement('td');
        const rendered = column.render?.(resolveColumnValue(column, row), row) ?? null;
        if (rendered && typeof rendered.nodeType === 'number') cell.append(rendered);
        else cell.textContent = formatColumnValue(column, row);
        styleCell(cell, column.align, column.width);
        tr.append(cell);
      }
      body.append(tr);
    }
  }
}
