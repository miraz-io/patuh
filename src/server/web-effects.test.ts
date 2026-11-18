import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

// React 19 calls whatever an effect returns as its cleanup: an expression-bodied effect that returns a value crashes the screen on unmount.
test("no useEffect callback returns a non-function by accident", () => {
  for (const f of readdirSync("web").filter((n) => n.endsWith(".tsx")))
    expect(readFileSync(`web/${f}`, "utf8").match(/useEffect\(\(\) => (?!\{)/g) ?? [], f).toEqual([]);
});
