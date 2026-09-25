import { describe, expect, it } from 'vitest';
import { parseWorkspace, MAX_SHUTTERS, MAX_RULES } from './parser';

const OK = `
# 注释行
[shutters]
S1
S2
S3

[rules]
S1 OPEN OR S2 CLOSED
S3 OPEN S1 CLOSED
`;

describe('导入解析', () => {
  it('解析合法工作区（OR 关键字可省略）', () => {
    const r = parseWorkspace(OK);
    expect(r.ok).toBe(true);
    expect(r.workspace?.ids).toEqual(['S1', 'S2', 'S3']);
    expect(r.workspace?.rules).toHaveLength(2);
    expect(r.workspace?.rules[0]).toMatchObject({
      a: { id: 'S1', state: 'OPEN' },
      b: { id: 'S2', state: 'CLOSED' },
    });
    // “S3 OPEN S1 CLOSED” 无 OR 也被视为两个文字
    expect(r.workspace?.rules[1]).toMatchObject({
      a: { id: 'S3', state: 'OPEN' },
      b: { id: 'S1', state: 'CLOSED' },
    });
  });

  it('未知 ID 拒绝整份导入且无 workspace', () => {
    const text = `[shutters]\nA\nB\n[rules]\nA OPEN OR X CLOSED\n`;
    const r = parseWorkspace(text);
    expect(r.ok).toBe(false);
    expect(r.workspace).toBeNull();
    expect(r.errors.join('\n')).toContain('未知快门 ID');
  });

  it('非法状态拒绝整份导入', () => {
    const text = `[shutters]\nA\nB\n[rules]\nA OPEN OR B OPENED\n`;
    const r = parseWorkspace(text);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('非法状态');
  });

  it('重复快门 ID 拒绝整份导入', () => {
    const text = `[shutters]\nA\nB\nA\n[rules]\nA OPEN OR B OPEN\n`;
    const r = parseWorkspace(text);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('重复声明');
  });

  it('同一规则内同一快门重复出现（含正反文字）拒绝', () => {
    const text = `[shutters]\nA\nB\n[rules]\nA OPEN OR A CLOSED\n`;
    const r = parseWorkspace(text);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('重复出现');
  });

  it('记号数量不对、缺少小节、快门不足均拒绝', () => {
    expect(parseWorkspace('[shutters]\nA\n[rules]\nA OPEN OR B OPEN\n').ok).toBe(false); // 未知ID + 仅 1 快门
    const onlyOne = parseWorkspace('[shutters]\nA\n[rules]\n');
    expect(onlyOne.ok).toBe(false);
    expect(onlyOne.errors.join('\n')).toContain('至少需要 2');
    const noSections = parseWorkspace('A OPEN OR B CLOSED\n');
    expect(noSections.ok).toBe(false);
    const badLine = parseWorkspace('[shutters]\nA B\n[rules]\n');
    expect(badLine.ok).toBe(false);
    expect(badLine.errors.join('\n')).toContain('空白');
  });

  it('状态关键字不能用作 ID', () => {
    const r = parseWorkspace('[shutters]\nOPEN\nB\n[rules]\n');
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('OPEN');
  });

  it('超限拒绝', () => {
    const many = Array.from({ length: MAX_SHUTTERS + 1 }, (_, i) => `X${i}`).join('\n');
    const r = parseWorkspace(`[shutters]\n${many}\n[rules]\n`);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('最多允许');

    const rules = Array.from({ length: MAX_RULES + 1 }, () => 'X0 OPEN OR X1 OPEN').join('\n');
    const r2 = parseWorkspace(
      `[shutters]\nX0\nX1\n[rules]\n${rules}\n`,
    );
    expect(r2.ok).toBe(false);
    expect(r2.errors.join('\n')).toContain('规则数量');
  });
});
