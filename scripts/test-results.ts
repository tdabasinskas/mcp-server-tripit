import assert from "node:assert/strict";
import { successResult, errorResult, toolResult } from "../src/results";

function textOf(result: { content?: Array<{ type: string; text?: string }> }): string {
  const block = result.content?.find((item) => item.type === "text");
  assert.ok(block?.text, "result must include a text content block");
  return block.text;
}

// Both channels cross the wire as JSON, which drops `undefined`-valued keys.
// Normalize structuredContent the same way before comparing.
function overWire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

// Success payloads must be mirrored into the text channel, not just structuredContent.
// A client that only reads text content should still receive the full envelope.
{
  const data = { Trip: [{ id: "123", display_name: "Vilnius" }] };
  const result = successResult("tripit_list_trips", data, []);

  const parsed = JSON.parse(textOf(result)) as Record<string, any>;
  assert.deepEqual(parsed, overWire(result.structuredContent), "text content must equal structuredContent");
  assert.equal(parsed.ok, true);
  assert.equal(parsed.operation, "tripit_list_trips");
  assert.deepEqual(parsed.data, data, "trip list must survive in the text channel");
}

// Warnings ride along in both channels.
{
  const result = successResult("tripit_list_trips", { Trip: [] }, [{ message: "heads up" }]);
  const parsed = JSON.parse(textOf(result)) as Record<string, any>;
  assert.deepEqual(parsed.warnings, [{ message: "heads up" }]);
}

// Error results are also machine-parseable JSON, not a prose sentence.
{
  const result = errorResult("tripit_get_trip", new Error("boom"));
  const parsed = JSON.parse(textOf(result)) as Record<string, any>;
  assert.equal(result.isError, true);
  assert.deepEqual(parsed, overWire(result.structuredContent));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.message, "boom");
}

// End-to-end through toolResult: a TripIt Error payload becomes a JSON error envelope.
{
  const result = await toolResult("tripit_list_trips", async () => ({
    Error: { code: "999", description: "bad request" },
  }));
  const parsed = JSON.parse(textOf(result)) as Record<string, any>;
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.message, "bad request");
}

console.log("test-results: all assertions passed");
