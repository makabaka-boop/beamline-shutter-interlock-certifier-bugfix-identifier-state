import { describe, expect, it } from 'vitest';
import type { ShutterState, Workspace } from './types';
import { parseWorkspace } from './parser';
import { computeChanges, solveWorkspace } from './sat';
import {
  cloneStateMap,
  emptyStateMap,
  hasState,
} from './maps';
import { serializeTable } from '../lib/export';

/* 用与界面完全相同的映射原语模拟操作员操作（锁定 / 切换 / 改状态）。 */

function toggleLock(
  table: Record<string, ShutterState>,
  locks: Record<string, ShutterState>,
  id: string,
): Record<string, ShutterState> {
  const next = cloneStateMap(locks);
  if (hasState(next, id)) delete next[id];
  else next[id] = table[id];
  return next;
}

function cycleLock(
  locks: Record<string, ShutterState>,
  id: string,
): Record<string, ShutterState> {
  if (!hasState(locks, id)) return locks;
  const next = cloneStateMap(locks);
  next[id] = next[id] === 'OPEN' ? 'CLOSED' : 'OPEN';
  return next;
}

function setTable(
  table: Record<string, ShutterState>,
  id: string,
  state: ShutterState,
): Record<string, ShutterState> {
  const next = cloneStateMap(table);
  next[id] = state;
  return next;
}

const SPECIAL_IMPORT = `
[shutters]
constructor
toString
__proto__
A
[rules]
# constructor 开启，或 toString 关闭
constructor OPEN OR toString CLOSED
# __proto__ 关闭，或 A 开启（OR 可省略）
__proto__ CLOSED A OPEN
`;

function load(): Workspace {
  const r = parseWorkspace(SPECIAL_IMPORT);
  expect(r.ok, r.errors.join('\n')).toBe(true);
  return r.workspace!;
}

function allClosed(ids: string[]): Record<string, ShutterState> {
  const t = emptyStateMap();
  for (const id of ids) t[id] = 'CLOSED';
  return t;
}

describe('特殊 ID（constructor / toString / __proto__）跨解析-状态-求解-导出一致性', () => {
  it('按 UTF-8 字节序排序：A < __proto__ < constructor < toString', () => {
    const ws = load();
    const outcome = solveWorkspace(ws, emptyStateMap());
    expect(outcome.kind).toBe('sat');
    if (outcome.kind !== 'sat') return;
    expect(outcome.orderedIds).toEqual([
      'A',
      '__proto__',
      'constructor',
      'toString',
    ]);
  });

  it('初始无锁定时不把继承属性当作锁定；锁定集合计数准确', () => {
    const ws = load();
    let table = allClosed(ws.ids);
    let locks = emptyStateMap();

    for (const id of ws.ids) {
      expect(hasState(locks, id)).toBe(false);
    }
    expect(Object.keys(locks)).toHaveLength(0);

    // 分别锁定三个特殊 ID 与普通 ID，每步锁数量 +1，屏幕提示一致
    for (const [n, id] of ws.ids.entries()) {
      locks = toggleLock(table, locks, id);
      expect(hasState(locks, id)).toBe(true);
      expect(locks[id]).toBe('CLOSED'); // 初始表全 CLOSED
      expect(Object.keys(locks)).toHaveLength(n + 1);
    }
    expect(Object.keys(locks).sort()).toEqual(
      ['__proto__', 'A', 'constructor', 'toString'].sort(),
    );

    // 逐个解锁
    for (const id of ws.ids) {
      locks = toggleLock(table, locks, id);
      expect(hasState(locks, id)).toBe(false);
    }
    expect(Object.keys(locks)).toHaveLength(0);
    // 防止未使用告警：table 在下方场景继续使用
    table = setTable(table, 'A', 'OPEN');
    expect(table['A']).toBe('OPEN');
  });

  it('__proto__ 的设置、求解赋值形成独立快门条目', () => {
    const ws = load();
    const table = setTable(allClosed(ws.ids), '__proto__', 'OPEN');

    // 手工设置必须落为自有数据属性，而不是改写原型
    expect(Object.getOwnPropertyNames(table)).toContain('__proto__');
    expect(table['__proto__']).toBe('OPEN');

    const outcome = solveWorkspace(ws, emptyStateMap());
    expect(outcome.kind).toBe('sat');
    if (outcome.kind !== 'sat') return;
    // 无锁定时全 CLOSED 可行（R0: constructor OPEN∨toString CLOSED；
    // R1: __proto__ CLOSED∨A OPEN），是字典序最小方案
    expect(outcome.assignment['__proto__']).toBe('CLOSED');
    expect(Object.getOwnPropertyNames(outcome.assignment)).toContain('__proto__');
    expect(Object.keys(outcome.assignment)).toHaveLength(4);

    const changes = computeChanges(outcome.orderedIds, outcome.assignment, table);
    expect(changes).toEqual([
      { id: '__proto__', from: 'OPEN', to: 'CLOSED' },
    ]);

    const text = serializeTable(ws, outcome.assignment);
    expect(text).toBe(
      [
        'A CLOSED',
        '__proto__ CLOSED',
        'constructor CLOSED',
        'toString CLOSED',
        '',
      ].join('\n'),
    );
  });

  it('锁定 __proto__=OPEN 强制 A=OPEN，其余仍 CLOSED 优先', () => {
    const ws = load();
    const locks = emptyStateMap();
    locks['__proto__'] = 'OPEN'; // 直接对无原型表赋值，自有属性
    expect(Object.getOwnPropertyNames(locks)).toContain('__proto__');

    const outcome = solveWorkspace(ws, locks);
    expect(outcome.kind).toBe('sat');
    if (outcome.kind !== 'sat') return;
    expect(Object.keys(outcome.assignment)).toHaveLength(4);
    expect(outcome.assignment).toMatchObject({
      A: 'OPEN',
      __proto__: 'OPEN',
      constructor: 'CLOSED',
      toString: 'CLOSED',
    });
  });

  it('分别锁定特殊 ID 并切换锁定值：constructor/toString 冲突判定准确', () => {
    const ws = load();

    // constructor=CLOSED 且 toString=OPEN：规则 constructor OPEN∨toString CLOSED 被违反
    let locks = emptyStateMap();
    locks['constructor'] = 'CLOSED';
    locks['toString'] = 'OPEN';
    let r = solveWorkspace(ws, locks);
    expect(r.kind).toBe('unsat');
    if (r.kind === 'unsat') {
      // constructor(0x63) < toString(0x74)，矛盾见证取字节序最小者
      expect(r.witness.id).toBe('constructor');
      expect(r.witness.openToClosed.length).toBeGreaterThan(0);
      expect(r.witness.closedToOpen.length).toBeGreaterThan(0);
    }

    // 将 constructor 的锁定值切回 OPEN：可满足
    locks = cycleLock(locks, 'constructor');
    expect(locks['constructor']).toBe('OPEN');
    r = solveWorkspace(ws, locks);
    expect(r.kind).toBe('sat');
    if (r.kind === 'sat') {
      expect(Object.keys(r.assignment)).toHaveLength(4);
      expect(r.assignment['constructor']).toBe('OPEN');
      expect(r.assignment['toString']).toBe('OPEN');
    }
  });

  it('锁定 __proto__=OPEN 与 A=CLOSED 冲突，见证为字节序最小的 A', () => {
    const ws = load();
    const locks = emptyStateMap();
    locks['__proto__'] = 'OPEN';
    locks['A'] = 'CLOSED';
    const r = solveWorkspace(ws, locks);
    expect(r.kind).toBe('unsat');
    if (r.kind === 'unsat') {
      expect(r.witness.id).toBe('A');
    }
  });

  it('解锁后恢复可行，改动清单与导出行和快门一一对应', () => {
    const ws = load();
    const table = allClosed(ws.ids);
    let locks = emptyStateMap();
    locks['toString'] = 'OPEN';
    locks['A'] = 'OPEN';

    // 有锁定：toString=OPEN 迫使 constructor=OPEN
    const locked = solveWorkspace(ws, locks);
    expect(locked.kind).toBe('sat');
    if (locked.kind !== 'sat') return;
    expect(locked.assignment['constructor']).toBe('OPEN');

    // 解锁（分别解锁），重新认证回到全 CLOSED
    locks = toggleLock(table, locks, 'toString');
    locks = toggleLock(table, locks, 'A');
    expect(Object.keys(locks)).toHaveLength(0);
    const free = solveWorkspace(ws, locks);
    expect(free.kind).toBe('sat');
    if (free.kind !== 'sat') return;
    for (const id of ws.ids) expect(free.assignment[id]).toBe('CLOSED');

    const changes = computeChanges(free.orderedIds, free.assignment, table);
    expect(changes).toEqual([]);

    // 导出行数 == 快门数，且每行都能在屏幕（assignment）中找到同一状态
    const lines = serializeTable(ws, free.assignment)
      .trim()
      .split('\n');
    expect(lines).toHaveLength(ws.ids.length);
    const seen = new Set<string>();
    for (const line of lines) {
      const [id, state] = line.split(' ');
      expect(ws.ids).toContain(id);
      expect(free.assignment[id]).toBe(state);
      seen.add(id);
    }
    expect(seen.size).toBe(ws.ids.length);
  });
});
