import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../packaging/green/GreenExtractor.cs", import.meta.url), "utf8");

test("green extractor stages the embedded tar before invoking Windows tar", () => {
  assert.match(source, /Path\.GetTempPath\(\)/);
  assert.match(source, /new FileStream\(temporaryPayload, FileMode\.CreateNew/);
  assert.match(source, /"-xf \\"" \+ temporaryPayload/);
  assert.match(source, /WorkingDirectory = destination/);
  assert.doesNotMatch(source, /temporaryPayload[\s\S]{0,120}" -C /);
  assert.match(source, /File\.Delete\(temporaryPayload\)/);
  assert.doesNotMatch(source, /RedirectStandardInput/);
  assert.doesNotMatch(source, /StandardInput\.BaseStream\.Write/);
});
