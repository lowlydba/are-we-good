#!/usr/bin/env node
import figlet from "figlet";

const FONT = "ANSI Shadow";

function renderConst(name, text) {
  const lines = figlet
    .textSync(text, { font: FONT })
    .split("\n")
    .filter((line, i, arr) => !(i === arr.length - 1 && line.trim() === ""));

  const body = lines.map((line) => `  ${JSON.stringify(line)},`).join("\n");
  return `const ${name} = [\n${body}\n];`;
}

console.log(renderConst("GOOD_BANNER", "GOOD"));
console.log();
console.log(renderConst("NOT_GOOD_BANNER", "NOT GOOD"));
