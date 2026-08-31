import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";

const normalizedIssueSchema = z.object({
  code: z.string().optional().describe("Stable provider or MCP error code when available."),
  message: z.string().min(1).describe("Human-readable warning or error message."),
});

const normalizedErrorSchema = normalizedIssueSchema.extend({
  retryable: z.boolean().describe("Whether retrying the same operation may succeed without user changes."),
  status: z.number().int().optional().describe("Upstream HTTP status when the failure came from TripIt."),
});

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const normalizedDataSchema = z.record(z.string(), jsonValueSchema);

// MCP output schemas must have an object at the root. `ok` is the discriminator:
// successful results include `data`, while failed results include `error`.
export const normalizedToolOutputSchema = z.object({
  ok: z.boolean().describe("True for success; false for a normalized tool or TripIt error."),
  operation: z.string().min(1).describe("Name of the tool operation that produced this result."),
  data: normalizedDataSchema.optional().describe("Present when ok is true."),
  error: normalizedErrorSchema.optional().describe("Present when ok is false."),
  warnings: z.array(normalizedIssueSchema).describe("Non-fatal TripIt warnings, if any."),
});

export type NormalizedToolOutput = z.infer<typeof normalizedToolOutputSchema>;

type NormalizedIssue = z.infer<typeof normalizedIssueSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issueMessage(value: Record<string, unknown>): string {
  for (const key of ["message", "description", "error_message", "error_description", "text"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }

  return "TripIt returned an unspecified issue.";
}

function normalizeIssues(value: unknown): NormalizedIssue[] {
  if (value === undefined || value === null) return [];
  const values = Array.isArray(value) ? value : [value];

  return values.map((item) => {
    if (typeof item === "string") return { message: item };
    if (!isRecord(item)) return { message: String(item) };
    const code = item.code ?? item.error_code ?? item.type;
    return {
      code: typeof code === "string" || typeof code === "number" ? String(code) : undefined,
      message: issueMessage(item),
    };
  });
}

function tripItResponse(data: Record<string, unknown>): {
  data: Record<string, unknown>;
  errors: NormalizedIssue[];
  warnings: NormalizedIssue[];
} {
  const { Error: errorValue, Warning: warningValue, ...cleanData } = data;
  return {
    data: cleanData,
    errors: normalizeIssues(errorValue),
    warnings: normalizeIssues(warningValue),
  };
}

function textContent(text: string): CallToolResult["content"] {
  return [{ type: "text", text }];
}

function operationIsSafeToRetry(operation: string): boolean {
  if (!operation.startsWith("tripit_")) return true;
  return /^tripit_(list|get|update|replace)_/.test(operation);
}

export function successResult(
  operation: string,
  data: Record<string, unknown>,
  warnings: NormalizedIssue[] = [],
): CallToolResult {
  const envelope: NormalizedToolOutput = { ok: true, operation, data, warnings };
  // Mirror the payload into the text channel. `structuredContent` alone is not
  // enough: the MCP spec's guidance is that a tool with an outputSchema SHOULD
  // also serialize the equivalent JSON into a text content block, so clients
  // that do not surface structured content still receive the data. Serializing
  // the same envelope keeps both channels from drifting.
  return {
    content: textContent(JSON.stringify(envelope)),
    structuredContent: envelope,
  };
}

export function errorResult(
  operation: string,
  error: unknown,
  warnings: NormalizedIssue[] = [],
): CallToolResult {
  const record = isRecord(error) ? error : undefined;
  const status = typeof record?.status === "number" ? record.status : undefined;
  const message = error instanceof Error ? error.message : isRecord(error) && typeof error.message === "string" ? error.message : String(error);
  const code =
    typeof record?.code === "string"
      ? record.code
      : status === 401 || status === 403
        ? "TRIPIT_AUTHORIZATION_ERROR"
        : status !== undefined
          ? "TRIPIT_API_ERROR"
          : message.startsWith("Missing required environment variable")
            ? "AUTHENTICATION_REQUIRED"
            : "TOOL_EXECUTION_ERROR";
  const transient = status === 408 || status === 429 || (status !== undefined && status >= 500);
  const retryable = transient && operationIsSafeToRetry(operation);
  const envelope: NormalizedToolOutput = {
    ok: false,
    operation,
    error: { code, message, retryable, status },
    warnings,
  };

  return {
    isError: true,
    content: textContent(JSON.stringify(envelope)),
    structuredContent: envelope,
  };
}

export async function toolResult(
  operation: string,
  callback: () => Promise<Record<string, unknown>>,
): Promise<CallToolResult> {
  try {
    const response = tripItResponse(await callback());
    if (response.errors.length > 0) {
      const message = response.errors.map((issue) => issue.message).join("; ");
      return errorResult(
        operation,
        { code: "TRIPIT_RESPONSE_ERROR", message, status: 200 },
        response.warnings,
      );
    }

    return successResult(operation, response.data, response.warnings);
  } catch (error) {
    return errorResult(operation, error);
  }
}
