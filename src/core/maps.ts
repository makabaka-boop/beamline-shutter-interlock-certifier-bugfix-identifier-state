import type { ShutterState } from './types';

/**
 * 以快门 ID 为键的状态表必须使用**无原型对象**：
 * - ID 为 `constructor` / `toString` 时，普通对象会经由原型链读到继承属性，
 *   导致「未锁定却被判定为已锁定」之类的状态错读；
 * - ID 为 `__proto__` 时，对普通对象赋值会触发原型 setter 而被静默吞掉，
 *   无法形成独立条目（预览、导出缺失）。
 *
 * 全链路（导入后的当前表 / 锁定集合 / 求解赋值 / 导出）统一使用本工厂，
 * 保证任意非空、无空白且不与关键字冲突的 ID 都有相同的身份语义。
 */
export function emptyStateMap(): Record<string, ShutterState> {
  return Object.create(null) as Record<string, ShutterState>;
}

/** 复制状态表，结果仍是无原型对象（避免在普通对象上展开时重新引入上述陷阱）。 */
export function cloneStateMap(
  src: Record<string, ShutterState>,
): Record<string, ShutterState> {
  return Object.assign(emptyStateMap(), src);
}

/** 仅当 id 是该表的自有条目时为真；不读原型链，constructor 等 ID 安全。 */
export function hasState(
  map: Record<string, ShutterState>,
  id: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(map, id);
}
