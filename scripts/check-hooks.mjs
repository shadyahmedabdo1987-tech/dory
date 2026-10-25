// Fails CI when a component calls a hook after an early `return` (React then sees a
// different number of hooks between renders and the whole app goes blank / crashes —
// this is what broke sign-out in 2.58–2.61).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.tsx')) files.push(p);
  }
};
walk('app');
walk('src');

const problems = [];
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  let inComp = false;
  let ret = -1;
  let inIf = false;
  lines.forEach((l, i) => {
    if (/^(export )?(default )?function [A-Z]/.test(l)) return void ((inComp = true), (ret = -1), (inIf = false));
    if (/^\}/.test(l)) return void (inComp = false);
    if (!inComp) return;
    if (/^ {2}if \(.*\{\s*$/.test(l)) return void (inIf = true);
    if (inIf && /^ {2}\}/.test(l)) return void (inIf = false);
    if (ret < 0 && (/^ {2}(if \(.*\) return\b|return\b)/.test(l) && !l.startsWith('  return (') || (inIf && /^ {4}return\b/.test(l)))) ret = i;
    if (ret >= 0 && /^ {2}\S/.test(l) && /\buse[A-Z]\w*\(/.test(l)) problems.push(`${f}:${i + 1} hook after the early return on line ${ret + 1}`);
  });
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`hooks order ok (${files.length} files)`);
