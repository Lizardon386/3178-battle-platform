/**
 * 自绘下拉：Windows Chrome 的 `<select>` 展开层是**原生控件**，CSS 只能管每行底色和
 * 选中行，鼠标划过那条会落回系统浅蓝，跟主题打架（用户截图问过"这个颜色怎么这个样子"）。
 *
 * 做法是**不删原生 select**：它继续当唯一数据源（options 与 value），app.ts 里
 * `select.value` 的读写和 `replaceChildren(...)` 重建全部照旧；上面盖一个按钮 + 弹层，
 * 选择时写回 select 并派发 change。每帧从 select 同步一次，所以 app.ts 重建选项不需要通知这里。
 */

export interface ListboxRow {
  value: string;
  label: string;
  disabled: boolean;
}

/** 键盘导航：只算下一个高亮下标，纯函数好测。 */
export function nextIndex(current: number, count: number, key: string): number {
  if (count <= 0) return -1;
  if (key === 'ArrowDown') return current < 0 ? 0 : (current + 1) % count;
  if (key === 'ArrowUp') return current < 0 ? count - 1 : (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return current;
}

/** 把 select 的选项读成行数据（value 缺省时浏览器给的是文本，这里对齐那个行为）。 */
export function rowsOf(options: { value: string; textContent: string | null; disabled: boolean }[]): ListboxRow[] {
  return options.map((o) => ({ value: o.value, label: (o.textContent ?? '').trim(), disabled: o.disabled }));
}

export function signatureOf(rows: ListboxRow[]): string {
  return rows.map((r) => `${r.disabled ? '!' : ''}${r.value}\u0000${r.label}`).join('\u0001');
}

interface Bound {
  select: HTMLSelectElement;
  root: HTMLElement;
  button: HTMLButtonElement;
  labelNode: HTMLElement;
  list: HTMLElement;
  rows: ListboxRow[];
  signature: string;
  active: number;
  open: boolean;
}

export class SelectListboxes {
  private readonly bounds: Bound[] = [];
  private docListener: ((event: Event) => void) | null = null;

  constructor(private readonly doc: Document) {}

  /** 给页面上每个 select.form-select 套一层按钮 + 弹层。幂等：已套过的跳过。 */
  attachAll(): void {
    const selects = [...this.doc.querySelectorAll('select.form-select')] as HTMLSelectElement[];
    for (const select of selects) {
      if (this.bounds.some((b) => b.select === select)) continue;
      this.bounds.push(this.wrap(select));
    }
    this.ensureDocListener();
    this.syncAll();
  }

  private wrap(select: HTMLSelectElement): Bound {
    const root = this.doc.createElement('div');
    root.className = 'bp-listbox';

    const button = this.doc.createElement('button');
    button.type = 'button';
    // 把原生 select 的类抄过来（form-select / form-select-lg），尺寸与描边就自动跟其它控件一致
    button.className = ['btn', ...select.classList, 'bp-listbox-trigger'].join(' ');
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');

    const labelNode = this.doc.createElement('span');
    labelNode.className = 'bp-listbox-label';
    const caret = this.doc.createElement('span');
    caret.className = 'bp-listbox-caret';
    caret.setAttribute('aria-hidden', 'true');
    button.append(labelNode, caret);

    const list = this.doc.createElement('ul');
    list.className = 'bp-listbox-list hidden';
    list.setAttribute('role', 'listbox');

    select.classList.add('bp-native-select');
    select.setAttribute('tabindex', '-1');
    select.setAttribute('aria-hidden', 'true');

    const bound: Bound = { select, root, button, labelNode, list, rows: [], signature: '', active: -1, open: false };

    const anchor = select.parentElement;
    anchor?.insertBefore(root, select);
    root.append(button, list);
    // 原生 select 留在 DOM 里当数据源，只是看不见：app.ts 还要读它的 value、重建它的选项
    root.append(select);

    button.addEventListener('click', () => (bound.open ? this.close(bound) : this.open(bound)));
    button.addEventListener('keydown', (event) => this.onKey(bound, event));
    // 故意不挂 blur→close：真实鼠标按在选项上时，焦点会先从按钮移走，blur 会在那一瞬间
    // 把列表 display:none 掉，于是 mouseup 落在隐藏元素上，click 永远不会触发——选项点不动。
    // 收起交给三条：点外面（下面的 pointerdown 捕获）、Esc、Tab（onKey 里按选中处理）。
    return bound;
  }

  /** 每帧调用：从原生 select 把选项与当前值同步到可见部分。选项没变就不重建 DOM。 */
  syncAll(): void {
    for (const b of this.bounds) this.sync(b);
  }

  private sync(b: Bound): void {
    const rows = rowsOf([...b.select.options] as HTMLOptionElement[]);
    const sig = signatureOf(rows);
    if (sig !== b.signature) {
      b.signature = sig;
      b.rows = rows;
      const nodes = rows.map((row, index) => {
        const li = this.doc.createElement('li');
        li.className = 'bp-listbox-option';
        li.setAttribute('role', 'option');
        li.dataset.index = String(index);
        li.textContent = row.label;
        if (row.disabled) li.classList.add('is-disabled');
        li.addEventListener('click', () => this.choose(b, index));
        li.addEventListener('mousemove', () => this.highlight(b, index));
        b.list.append(li);
        return li;
      });
      b.list.replaceChildren(...nodes);
    }
    const selected = rows.findIndex((r) => r.value === b.select.value);
    b.labelNode.textContent = selected >= 0 ? rows[selected]?.label ?? '' : rows[0]?.label ?? '';
    [...b.list.children].forEach((node, index) => {
      const li = node as HTMLElement;
      li.setAttribute('aria-selected', String(index === selected));
      li.classList.toggle('is-active', index === b.active);
    });
  }

  private open(b: Bound): void {
    this.closeOthers(b);
    b.open = true;
    b.active = Math.max(0, b.rows.findIndex((r) => r.value === b.select.value));
    b.list.classList.remove('hidden');
    b.button.setAttribute('aria-expanded', 'true');
    b.button.focus();
    this.scrollActiveIntoView(b);
    this.sync(b);
  }

  private close(b: Bound): void {
    b.open = false;
    b.active = -1;
    b.list.classList.add('hidden');
    b.button.setAttribute('aria-expanded', 'false');
  }

  private closeOthers(except: Bound): void {
    for (const b of this.bounds) if (b !== except && b.open) this.close(b);
  }

  closeAll(): void {
    for (const b of this.bounds) if (b.open) this.close(b);
  }

  private highlight(b: Bound, index: number): void {
    if (index === b.active) return;
    b.active = index;
    this.sync(b);
  }

  private choose(b: Bound, index: number): void {
    const row = b.rows[index];
    if (!row || row.disabled) return;
    b.select.value = row.value;
    b.select.dispatchEvent(new Event('change', { bubbles: true }));
    this.close(b);
    this.sync(b);
    b.button.focus();
  }

  private onKey(b: Bound, event: Event): void {
    const key = (event as KeyboardEvent).key;
    if (!b.open) {
      if (key === 'ArrowDown' || key === 'Enter' || key === ' ') {
        event.preventDefault();
        this.open(b);
      }
      return;
    }
    if (key === 'Escape') {
      event.preventDefault();
      this.close(b);
      return;
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      this.choose(b, b.active);
      return;
    }
    if (key === 'Tab') {
      // 键盘用户 Tab 走开时按"选中当前高亮"处理，跟原生行为一致
      this.choose(b, b.active);
      return;
    }
    const moved = nextIndex(b.active, b.rows.length, key);
    if (moved !== b.active) {
      event.preventDefault();
      b.active = moved;
      this.sync(b);
      this.scrollActiveIntoView(b);
    }
  }

  private scrollActiveIntoView(b: Bound): void {
    const node = b.list.children[b.active] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest' });
  }

  private ensureDocListener(): void {
    if (this.docListener) return;
    this.docListener = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      for (const b of this.bounds) {
        if (b.open && !b.root.contains(target)) this.close(b);
      }
    };
    this.doc.addEventListener('pointerdown', this.docListener, true);
  }

  /** 测试与猴测用：现在有没有展开着的下拉。 */
  get openCount(): number {
    return this.bounds.filter((b) => b.open).length;
  }
}
