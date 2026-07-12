import assert from "node:assert/strict";
import test from "node:test";
import { hasValidDeveloperIdApplicationSignature } from "../electron/mac-signature.mjs";

const validDetails = [
  "Authority=Developer ID Application: Luma Studio (ABCDE12345)",
  "Authority=Developer ID Certification Authority",
  "Authority=Apple Root CA",
  "TeamIdentifier=ABCDE12345",
  'designated => identifier "com.luma.wallpaper" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */ and certificate leaf[subject.OU] = ABCDE12345',
].join("\n");

function codesignRunner({ verifyStatus = 0, details = validDetails } = {}) {
  return (_executable, args) =>
    args.includes("--verify")
      ? { status: verifyStatus, signal: null, stdout: "", stderr: "" }
      : { status: 0, signal: null, stdout: "", stderr: details };
}

test("accepts only an intact Developer ID Application signature and requirement", () => {
  assert.equal(
    hasValidDeveloperIdApplicationSignature("/Applications/Luma.app", codesignRunner()),
    true,
  );
});

test("rejects a damaged signature before trusting certificate metadata", () => {
  assert.equal(
    hasValidDeveloperIdApplicationSignature(
      "/Applications/Luma.app",
      codesignRunner({ verifyStatus: 1 }),
    ),
    false,
  );
});

test("rejects Apple Development and signatures without the Developer ID requirement", () => {
  assert.equal(
    hasValidDeveloperIdApplicationSignature(
      "/Applications/Luma.app",
      codesignRunner({
        details: validDetails
          .replace("Developer ID Application:", "Apple Development:")
          .replace("1.2.840.113635.100.6.1.13", "1.2.840.113635.100.6.1.2"),
      }),
    ),
    false,
  );
});
