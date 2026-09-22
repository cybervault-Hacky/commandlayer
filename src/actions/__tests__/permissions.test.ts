import { afterEach, describe, expect, it } from 'vitest';
import { ACTION_LIMITS } from '../limits';
import { permissionLedger } from '../permissions';
import { ActionErrorCode } from '../types';

const PLAN = 'plan-1';
const HASH = 'hash-abc';

afterEach(() => {
  permissionLedger.setClock(Date.now);
  permissionLedger.clear();
});

describe('permission ledger (Phase 4)', () => {
  it('grants exactly one consumption per explicit approval', () => {
    permissionLedger.approve(PLAN, HASH);
    const first = permissionLedger.consume(PLAN, HASH);
    expect(first.ok).toBe(true);

    const second = permissionLedger.consume(PLAN, HASH);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe(ActionErrorCode.ACTION_PERMISSION_DENIED);
    }
  });

  it('never grants without an approval', () => {
    const result = permissionLedger.consume('never-approved', HASH);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ActionErrorCode.ACTION_PERMISSION_REQUIRED);
    }
  });

  it('rejects execution of a different hash than approved (plan binding)', () => {
    permissionLedger.approve(PLAN, HASH);
    const result = permissionLedger.consume(PLAN, 'tampered-hash');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ActionErrorCode.ACTION_PLAN_CHANGED);
    }
  });

  it('expires approvals after the time box', () => {
    let clock = 1_000_000;
    permissionLedger.setClock(() => clock);

    permissionLedger.approve(PLAN, HASH);
    clock += ACTION_LIMITS.PLAN_TTL_MS + 1;

    const result = permissionLedger.consume(PLAN, HASH);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ActionErrorCode.ACTION_PERMISSION_EXPIRED);
    }
  });

  it('consumes within the time box', () => {
    let clock = 1_000_000;
    permissionLedger.setClock(() => clock);

    permissionLedger.approve(PLAN, HASH);
    clock += ACTION_LIMITS.PLAN_TTL_MS - 1000;
    expect(permissionLedger.consume(PLAN, HASH).ok).toBe(true);
  });

  it('revokes approval on cancel', () => {
    permissionLedger.approve(PLAN, HASH);
    expect(permissionLedger.has(PLAN)).toBe(true);
    permissionLedger.revoke(PLAN);
    expect(permissionLedger.has(PLAN)).toBe(false);
    expect(permissionLedger.consume(PLAN, HASH).ok).toBe(false);
  });

  it('sweeps stale approvals during consume', () => {
    let clock = 1_000_000;
    permissionLedger.setClock(() => clock);
    permissionLedger.approve(PLAN, HASH);
    clock += ACTION_LIMITS.PLAN_TTL_MS * 2;
    expect(permissionLedger.has(PLAN)).toBe(false);
  });
});
