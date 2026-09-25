import { test, expect } from '@playwright/test';

/**
 * 特殊编号验收：普通 ID（A）与 constructor / toString / __proto__ 混合导入，
 * 逐个锁定、切换状态，核对可满足性、锁数量、改动清单与导出行是否一一对应。
 * 另验证 OR 在导入阶段被一致、可定位地拒绝，且不进入执行。
 */

const IMPORT = [
  '[shutters]',
  'constructor',
  'toString',
  '__proto__',
  'A',
  '[rules]',
  'constructor OPEN OR toString CLOSED',
  '__proto__ CLOSED A OPEN',
].join('\n');

const FINAL_LINES = [
  'A CLOSED',
  '__proto__ CLOSED',
  'constructor CLOSED',
  'toString CLOSED',
];

test('特殊编号：导入→分别锁定/切换→求解预览→采纳→导出一一对应', async ({ page }) => {
  await page.goto('/');

  // 1. 导入特殊 ID 混合工作区
  await page.getByTestId('import-text').fill(IMPORT);
  await page.getByTestId('import-btn').click();
  await expect(page.getByTestId('import-ok')).toBeVisible();

  // 快门行全部存在，且初始无锁定（constructor/toString 不得误判为已锁定）
  for (const id of ['A', '__proto__', 'constructor', 'toString']) {
    await expect(page.getByTestId(`shutter-row-${id}`)).toBeVisible();
    await expect(page.getByTestId(`lock-${id}`)).toHaveText('锁定');
  }
  await expect(page.locator('.lock-summary')).toContainText('已锁定 0 个快门');

  // 2. 无锁认证：全 CLOSED 是字典序最小方案，无改动
  await page.getByTestId('run-certify').click();
  await expect(page.getByTestId('result-sat')).toBeVisible();
  await expect(page.getByTestId('changes-summary')).toContainText('无需改动');

  // 3. 锁定 constructor=CLOSED（初始表即 CLOSED）：可满足，toString 被迫 OPEN，1 处改动
  await page.getByTestId('lock-constructor').click();
  await expect(page.locator('.lock-summary')).toContainText('已锁定 1 个快门');
  await expect(page.getByTestId('lock-state-constructor')).toContainText('CLOSED');
  await page.getByTestId('run-certify').click();
  await expect(page.getByTestId('result-sat')).toBeVisible();
  await expect(page.getByTestId('change-toString')).toHaveText('toString：CLOSED→OPEN');

  // 4. 再锁 toString=OPEN（先切换表值再锁定）：仍可满足
  await page.getByTestId('state-toString-OPEN').check();
  await page.getByTestId('lock-toString').click();
  await expect(page.locator('.lock-summary')).toContainText('已锁定 2 个快门');
  await page.getByTestId('run-certify').click();
  await expect(page.getByTestId('result-sat')).toBeVisible();

  // 5. 将 constructor 的锁定值切到 OPEN 再切回 CLOSED：CLOSED+OPEN 组合违反规则 0 → 无解
  await page.getByTestId('lock-state-constructor').click();
  await expect(page.getByTestId('lock-state-constructor')).toContainText('OPEN');
  await page.getByTestId('lock-state-constructor').click();
  await expect(page.getByTestId('lock-state-constructor')).toContainText('CLOSED');
  await page.getByTestId('run-certify').click();
  await expect(page.getByTestId('result-unsat')).toBeVisible();
  await expect(page.getByTestId('result-unsat')).toContainText('快门「constructor」');
  await expect(page.getByTestId('adopt-plan')).toBeDisabled();
  await expect(page.getByTestId('download-plan')).toBeDisabled();

  // 6. 解锁 constructor（保留 toString=OPEN 锁）：恢复可行
  await page.getByTestId('lock-constructor').click();
  await expect(page.locator('.lock-summary')).toContainText('已锁定 1 个快门');
  await page.getByTestId('run-certify').click();
  await expect(page.getByTestId('result-sat')).toBeVisible();
  // constructor OPEN ∨ toString CLOSED：toString=OPEN ⇒ constructor=OPEN
  await expect(page.getByTestId('plan-row-constructor')).toContainText('OPEN');

  // 7. 锁 __proto__=OPEN：A 被迫 OPEN
  await page.getByTestId('state-__proto__-OPEN').check();
  await page.getByTestId('lock-__proto__').click();
  await expect(page.locator('.lock-summary')).toContainText('已锁定 2 个快门');
  await page.getByTestId('run-certify').click();
  await expect(page.getByTestId('result-sat')).toBeVisible();
  await expect(page.getByTestId('plan-row-A')).toContainText('OPEN');
  await expect(page.getByTestId('plan-row-__proto__')).toContainText('OPEN');

  // 8. 再锁 A=CLOSED 与 __proto__=OPEN 冲突 → 无解；解锁 A 后恢复
  await page.getByTestId('state-A-CLOSED').check();
  await page.getByTestId('lock-A').click();
  await expect(page.locator('.lock-summary')).toContainText('已锁定 3 个快门');
  await page.getByTestId('run-certify').click();
  await expect(page.getByTestId('result-unsat')).toBeVisible();
  await expect(page.getByTestId('result-unsat')).toContainText('快门「A」');
  await page.getByTestId('lock-A').click();
  await page.getByTestId('run-certify').click();
  await expect(page.getByTestId('result-sat')).toBeVisible();

  // 9. 全部解锁并认证：回到全 CLOSED 最小方案（表中 toString/__proto__ 仍为 OPEN，故有 2 处改动）
  await page.getByTestId('lock-toString').click();
  await page.getByTestId('lock-__proto__').click();
  await expect(page.locator('.lock-summary')).toContainText('已锁定 0 个快门');
  await page.getByTestId('run-certify').click();
  await expect(page.getByTestId('result-sat')).toBeVisible();
  await expect(page.getByTestId('changes-summary')).toContainText('共 2 处改动');
  await expect(page.getByTestId('change-toString')).toHaveText('toString：OPEN→CLOSED');
  await expect(page.getByTestId('change-__proto__')).toHaveText('__proto__：OPEN→CLOSED');

  // 10. 采纳并下载：每个快门一行，顺序与屏幕表一致（含 __proto__ 行）
  await page.getByTestId('adopt-plan').click();
  await expect(page.getByTestId('adopted-banner')).toBeVisible();
  for (const state of ['A-CLOSED', '__proto__-CLOSED', 'constructor-CLOSED', 'toString-CLOSED']) {
    await expect(page.getByTestId(`state-${state}`)).toBeChecked();
  }

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('download-plan').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('shutter-table.txt');
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  const { readFileSync } = await import('node:fs');
  const content = readFileSync(filePath!, 'utf-8');
  expect(content).toBe(FINAL_LINES.join('\n') + '\n');
  expect(content.trim().split('\n')).toHaveLength(4);
});

test('OR 作为快门编号在导入阶段被一致拒绝且带行号，不进入执行', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-text').fill(
    ['[shutters]', 'OR', 'B', '[rules]', 'OR OPEN OR B CLOSED'].join('\n'),
  );
  await page.getByTestId('import-btn').click();
  const errorBox = page.getByTestId('import-errors');
  await expect(errorBox).toBeVisible();
  await expect(errorBox).toContainText('第 2 行');
  await expect(errorBox).toContainText('OR');
  // 工作区保持空，错误表不参与执行
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await expect(page.getByTestId('shutter-panel')).toHaveCount(0);
});
