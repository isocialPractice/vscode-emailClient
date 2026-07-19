import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  formatAddress,
  formatAddressList,
  invalidAddresses,
  isValidEmail,
  parseAddressList,
} from '../utils/address';

describe('isValidEmail', () => {
  it('accepts common address forms', () => {
    assert.equal(isValidEmail('jane.doe@example.com'), true);
    assert.equal(isValidEmail('a+tag@sub.example.org'), true);
  });

  it('rejects malformed addresses', () => {
    assert.equal(isValidEmail('not-an-email'), false);
    assert.equal(isValidEmail('missing@domain'), false);
    assert.equal(isValidEmail('two words@example.com'), false);
    assert.equal(isValidEmail(''), false);
  });
});

describe('parseAddressList', () => {
  it('parses bare addresses separated by commas', () => {
    const result = parseAddressList('jane.doe@example.com, bob@example.org');
    assert.deepEqual(result, [
      { email: 'jane.doe@example.com' },
      { email: 'bob@example.org' },
    ]);
  });

  it('parses display-name form', () => {
    const result = parseAddressList('Jane Doe <jane.doe@example.com>');
    assert.deepEqual(result, [{ name: 'Jane Doe', email: 'jane.doe@example.com' }]);
  });

  it('keeps commas inside quoted display names', () => {
    const result = parseAddressList('"Doe, Jane" <jane.doe@example.com>, bob@example.org');
    assert.equal(result.length, 2);
    assert.equal(result[0].email, 'jane.doe@example.com');
    assert.equal(result[1].email, 'bob@example.org');
  });

  it('ignores empty entries', () => {
    assert.deepEqual(parseAddressList('  ,, '), []);
  });
});

describe('invalidAddresses', () => {
  it('reports only the entries that fail validation', () => {
    const parsed = parseAddressList('jane.doe@example.com, broken');
    const invalid = invalidAddresses(parsed);
    assert.equal(invalid.length, 1);
    assert.equal(invalid[0].email, 'broken');
  });
});

describe('formatAddress', () => {
  it('round-trips the display-name form', () => {
    const [parsed] = parseAddressList('Jane Doe <jane.doe@example.com>');
    assert.equal(formatAddress(parsed), 'Jane Doe <jane.doe@example.com>');
  });

  it('formats lists with commas', () => {
    const parsed = parseAddressList('jane.doe@example.com, Bob <bob@example.org>');
    assert.equal(formatAddressList(parsed), 'jane.doe@example.com, Bob <bob@example.org>');
  });
});
