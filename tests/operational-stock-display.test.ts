import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { operationalIssueUnit, operationalStockQuantity, validateOperationalOpeningStock } from '../src/utils/operationalStock';
import { OperationalStockBalance } from '../src/components/inventory/OperationalStockBalance';

test('legacy zero balances and numeric issue units cannot render as 01', () => {
  for (const quantity of [0, '0', '00', '', undefined]) {
    const html = renderToStaticMarkup(React.createElement(OperationalStockBalance, { quantity, unit: '1' }));
    assert.match(html, />0<\/span>/);
    assert.match(html, /Out of stock/);
    assert.match(html, /Unit not specified/);
    assert.doesNotMatch(html, />01</);
  }
});

test('real quantities retain their value and corrupt quantities remain visible', () => {
  assert.equal(operationalStockQuantity('01'), 1);
  assert.equal(operationalStockQuantity('12.5'), 12.5);
  for (const value of ['oops', Infinity, NaN, -1, {}, true]) {
    assert.equal(operationalStockQuantity(value), null);
    assert.throws(() => validateOperationalOpeningStock(value), /non-negative/);
  }
  assert.equal(validateOperationalOpeningStock(0), 0);
  assert.equal(validateOperationalOpeningStock('2'), 2);
});

test('unit labels accept named units including custom labels but never numeric quantities', () => {
  for (const value of ['1', '01', '1.0', ' ', 1, undefined]) assert.equal(operationalIssueUnit(value), null);
  assert.equal(operationalIssueUnit(' rolls '), 'rolls');
  assert.equal(operationalIssueUnit('A4 sheets'), 'A4 sheets');
  const html = renderToStaticMarkup(React.createElement(OperationalStockBalance, { quantity: 12, unit: 'pens' }));
  assert.match(html, />12<\/span>/);
  assert.match(html, />pens<\/span>/);
  assert.doesNotMatch(html, /Out of stock/);
});
