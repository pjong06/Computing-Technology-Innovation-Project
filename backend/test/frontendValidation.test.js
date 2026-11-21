'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '..', '..');

function loadFunctions(file, names) {
  const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
  const declarations = names.map(name => {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} must exist in ${file}`);

    const openBrace = source.indexOf('{', start);
    let depth = 0;
    for (let index = openBrace; index < source.length; index++) {
      if (source[index] === '{') {
        depth++;
      } else if (source[index] === '}' && --depth === 0) {
        return source.slice(start, index + 1);
      }
    }

    assert.fail(`${name} must have a complete function body`);
  });
  const context = {};
  vm.runInNewContext(declarations.join('\n'), context);
  return context;
}

test('reset email validation keeps the previous format acceptance rules', () => {
  const { isValidResetEmail } = loadFunctions(
    'frontend/js/forgot-password.js',
    ['isValidResetEmail']
  );
  const originalCheck = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const cases = [
    '',
    'person@example.com',
    'first.last+tag@sub.example.co',
    '.@..',
    'a@b..c',
    'a@b.c\n',
    'a@b.c\r\n',
    'a@b.c\u2028',
    '@b.c',
    'a@b',
    'a@@b.c',
    'a b@b.c',
    'a@b .c',
    'a@b.c ',
    'a@b.c\nx',
  ];

  for (const email of cases) {
    assert.equal(
      isValidResetEmail(email),
      originalCheck(email),
      JSON.stringify(email)
    );
  }
});
