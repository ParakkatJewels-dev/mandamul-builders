import { describe, expect, test } from 'bun:test';
import { toPaise, sumPaise, formatINR, formatCompact, pct, parseRupees } from '../../src/lib/money';
import { classify } from '../../src/lib/api';

describe('money is exact', () => {
  test('numbers, strings and negatives become whole paise', () => {
    expect(toPaise(0.1)).toBe(10n);
    expect(toPaise('24.19')).toBe(2419n);
    expect(toPaise('-5.5')).toBe(-550n);
    expect(toPaise(12345678901.23)).toBe(1234567890123n);
    expect(toPaise('abc')).toBeNull();
    expect(toPaise(null)).toBeNull();
  });
  test('0.1 + 0.2 adds to exactly 0.30', () => { expect(sumPaise([toPaise(0.1), toPaise(0.2)])).toBe(30n); });
  test('the B05 case: two receipts of ₹12.10 and one remainder sum to the order total ₹24.19', () => {
    expect(sumPaise([toPaise('12.10'), toPaise('12.09')])).toBe(toPaise('24.19')!);
  });
  test('summing a thousand ₹0.01 lines gives ₹10.00, not 9.99999', () => {
    expect(formatINR(sumPaise(Array.from({ length: 1000 }, () => toPaise(0.01))))).toBe('₹10.00');
  });
});

describe('Indian formatting', () => {
  test('lakh and crore grouping', () => {
    expect(formatINR(toPaise('12345678.9'))).toBe('₹1,23,45,678.90');
    expect(formatINR(toPaise('999'))).toBe('₹999.00');
    expect(formatINR(toPaise('-1500'))).toBe('−₹1,500.00');
    expect(formatINR(null)).toBe('—');
  });
  test('compact amounts round half up', () => {
    expect(formatCompact(toPaise('42500000'))).toBe('₹4.25 Cr');
    expect(formatCompact(toPaise('3860000'))).toBe('₹38.6 L');
    expect(formatCompact(toPaise('9500'))).toBe('₹9,500');
    expect(formatCompact(toPaise('149999'))).toBe('₹1.5 L');
  });
  test('percentages', () => { expect(pct(toPaise(1), toPaise(3))).toBe('33.3%'); expect(pct(toPaise(1), 0n)).toBe('—'); });
  test('typed amounts are validated', () => {
    expect(parseRupees('1,25,000.5')).toBe('125000.50');
    expect(parseRupees('₹ 99')).toBe('99.00');
    expect(parseRupees('12.345')).toBeNull();
    expect(parseRupees('-3')).toBeNull();
  });
});

describe('errors are classified for people', () => {
  test('MFA requirement', () => expect(classify(400, { code: '42501', message: 'multi-factor sign-in required for procurement:approve' }).kind).toBe('mfa'));
  test('permission, in words', () => { const e = classify(403, { code: '42501', message: 'permission denied: approve on budget' }); expect(e.kind).toBe('permission'); expect(e.message).toBe('Your role does not have the "approve" right for budget.'); });
  test('duplicate', () => expect(classify(409, { code: '23505', message: 'a report for 2026-11-19 is already submitted for this site' }).kind).toBe('conflict'));
  test('expired session', () => expect(classify(401, {}).kind).toBe('auth'));
  test('server error says nothing was saved', () => expect(classify(500, {}).message).toMatch(/Nothing was saved/));
});
