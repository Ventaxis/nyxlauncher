// Проверки форматирования: секунды не должны «схлопываться» в часы.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fmtClock,
  fmtDuration,
  fmtHours,
  fmtHoursBig,
  fmtTimer,
} from '../ui/src/format.js';

test('fmtClock показывает часы, минуты и секунды', () => {
  assert.equal(fmtClock(0), '0:00:00');
  assert.equal(fmtClock(59), '0:00:59');
  assert.equal(fmtClock(61), '0:01:01');
  assert.equal(fmtClock(3725), '1:02:05');
  assert.equal(fmtClock(360000), '100:00:00');
});

test('fmtClock не уходит в минус и не отдаёт дробные секунды', () => {
  assert.equal(fmtClock(-5), '0:00:00');
  assert.equal(fmtClock(12.9), '0:00:12');
  assert.equal(fmtClock(undefined), '0:00:00');
});

test('fmtDuration называет секунды в каждой единице', () => {
  assert.equal(fmtDuration(9), '9 с');
  assert.equal(fmtDuration(89), '1 мин 29 с');
  assert.equal(fmtDuration(3669), '1 ч 01 мин 09 с');
});

test('fmtHours не врёт про короткие промежутки', () => {
  // Раньше 12 секунд превращались в «1 мин» — округление вверх.
  assert.equal(fmtHours(12), '12 с');
  assert.equal(fmtHours(90), '1 мин');
  assert.equal(fmtHours(7200), '2 ч');
  assert.equal(fmtHours(0), '0 ч');
});

test('fmtHoursBig ниже часа называет секунды и минуты', () => {
  assert.equal(fmtHoursBig(42), '42 с');
  assert.equal(fmtHoursBig(600), '10 мин');
  assert.equal(fmtHoursBig(5400), '1,5 ч');
});

test('fmtTimer — живой таймер сессии', () => {
  assert.equal(fmtTimer(65), '1:05');
  assert.equal(fmtTimer(3661), '1:01:01');
});
