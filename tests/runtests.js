/* Runs the built-in self-tests (the same 47 checks as More > Run the self-test) in Node.
   Run from the tests folder: node runtests.js ../src/core.js */
const fs = require('fs'), vm = require('vm'), path = require('path');
const file = process.argv[2] || path.join(__dirname, '..', 'src', 'core.js');
const ctx = { console, performance, TextEncoder, TextDecoder, btoa, atob, setTimeout, clearTimeout };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(file, 'utf8') + '\nthis.__run = () => [...runAllSelfTests(), ...runClosureSelfTests(), ...runLiteratureSelfTests()]; this.__v = APP_VERSION;', ctx);
const res = ctx.__run();
let fails = 0;
for (const r of res) { if (!r.pass) fails++; console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + r.detail)); }
console.log(`\nMultiplicity Graph Sketchpad ${ctx.__v}: ${res.length - fails} of ${res.length} checks passed`);
process.exit(fails ? 1 : 0);
