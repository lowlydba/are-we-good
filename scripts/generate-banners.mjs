#!/usr/bin/env node
/**
 * One-off codegen helper for the console banners printed in src/main.ts.
 *
 * `figlet` is a devDependency used only here — this script prints the
 * generated ASCII art as TypeScript source, which is then pasted by hand
 * into src/main.ts as static string arrays. figlet itself is never imported
 * at runtime, so it adds nothing to dist/main.js.
 *
 * Usage: npm run generate:banners
 */

import figlet from "figlet";

const FONT = "ANSI Shadow";

function renderConst(name, text) {
  const lines = figlet
    .textSync(text, { font: FONT })
    .split("\n")
    .filter((line, i, arr) => !(i === arr.length - 1 && line.trim() === "")); // drop trailing blank row

  const body = lines.map((line) => `  ${JSON.stringify(line)},`).join("\n");
  return `const ${name} = [\n${body}\n];`;
}

console.log(renderConst("GOOD_BANNER", "GOOD"));
console.log();
console.log(renderConst("NOT_GOOD_BANNER", "NOT GOOD"));
