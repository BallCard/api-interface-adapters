import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const contractDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(contractDirectory);
const manifestPath = path.join(contractDirectory, "manifest.json");
const forbiddenKey = /^(api[_-]?key|authorization|cookie|password|secret|token)$/i;
const forbiddenValue = /(?:sk|key)-[a-z0-9_-]{12,}/i;

function getPath(value, dottedPath) {
  return dottedPath.split(".").reduce((current, part) => (
    current !== null && typeof current === "object" && part in current
      ? current[part]
      : undefined
  ), value);
}

function assertCredentialFree(value, location = "fixture") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertCredentialFree(item, `${location}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      assert(!forbiddenKey.test(key), `${location} contains forbidden credential key: ${key}`);
      assertCredentialFree(item, `${location}.${key}`);
    }
    return;
  }
  if (typeof value === "string") {
    assert(!forbiddenValue.test(value), `${location} contains a credential-shaped value`);
  }
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(repositoryRoot, relativePath), "utf8"));
}

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
assert.equal(manifest.version, 1, "unsupported contract manifest version");
assert.equal(manifest.contracts.length, 4, "expected four primary adapter contracts");

const ids = new Set();
for (const contract of manifest.contracts) {
  assert(!ids.has(contract.id), `duplicate contract id: ${contract.id}`);
  ids.add(contract.id);
  assert(["GET", "POST", "PUT", "DELETE"].includes(contract.method), `${contract.id}: invalid method`);
  assert(contract.path.startsWith("/"), `${contract.id}: path must be absolute`);

  const source = await fs.readFile(path.join(repositoryRoot, contract.source), "utf8");
  assert(source.includes(`"${contract.method}"`), `${contract.id}: method not found in source`);
  assert(source.includes(`"${contract.path}"`), `${contract.id}: route not found in source`);

  const request = await readJson(contract.requestFixture);
  const response = await readJson(contract.responseFixture);
  assertCredentialFree(request, contract.requestFixture);
  assertCredentialFree(response, contract.responseFixture);

  for (const field of contract.requiredRequest) {
    assert.notEqual(getPath(request, field), undefined, `${contract.id}: request is missing ${field}`);
  }
  for (const field of contract.requiredResponse) {
    assert.notEqual(getPath(response, field), undefined, `${contract.id}: response is missing ${field}`);
  }
  assert(Number.isInteger(contract.failure.status), `${contract.id}: failure status must be an integer`);
  assert(contract.failure.status >= 400 && contract.failure.status < 600, `${contract.id}: failure status must be 4xx or 5xx`);
  assert(contract.failure.reason.trim(), `${contract.id}: failure reason is required`);

  console.log(`PASS ${contract.method} ${contract.path} (${contract.id})`);
}

console.log(`Verified ${manifest.contracts.length} offline adapter contracts; no network or credentials used.`);
