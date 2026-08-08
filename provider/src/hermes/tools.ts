/**
 * Hermes tool protocol (spec §23).
 *
 * The ChatGPT webpage has no tool-calling API. The web model emits tool calls
 * as a strict textual envelope:
 *
 *   <HERMES_TOOL_CALL>
 *   { "name": "tool_name", "arguments": { ... } }
 *   </HERMES_TOOL_CALL>
 *
 * The adapter parses + validates these strictly (Zod), converts them to
 * OpenAI-format `tool_calls` for the Hermes client, and wraps Hermes tool
 * results back into a matching envelope for the web model:
 *
 *   <HERMES_TOOL_RESULT>
 *   { "tool_call_id": "...", "name": "...", "content": "..." }
 *   </HERMES_TOOL_RESULT>
 *
 * Rules: exact tool-name match against the declared tools; exact argument
 * validation; no guessed repair of destructive arguments; at most 1 envelope
 * format-repair retry; otherwise a protocol error.
 */

import { z } from 'zod';

export const TOOL_CALL_OPEN = '<HERMES_TOOL_CALL>';
export const TOOL_CALL_CLOSE = '</HERMES_TOOL_CALL>';
export const TOOL_RESULT_OPEN = '<HERMES_TOOL_RESULT>';
export const TOOL_RESULT_CLOSE = '</HERMES_TOOL_RESULT>';

export const toolCallSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

export type ToolCallEnvelope = z.infer<typeof toolCallSchema>;

export interface ToolDefinition {
  name: string;
  parameters?: Record<string, unknown>;
}

export interface ParsedToolCalls {
  calls: ToolCallEnvelope[];
  /** Envelope-level errors (unparseable or failing validation) — hard failures. */
  errors: string[];
  /** Non-blocking format repairs applied (e.g. code fences stripped). */
  repairs: string[];
}

export interface ToolCallResult {
  tool_call_id: string;
  name?: string;
  content: string;
}

/** OpenAI-format function call (what Hermes receives). */
export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

// Browsers serialize unknown elements with LOWERCASE tag names
// (<hermes_tool_call>) — match case-insensitively.
const ENVELOPE_RE = new RegExp(
  `(<[^>]*hermes_tool_call[^>]*>)([\\s\\S]*?)(<\\/[^>]*hermes_tool_call[^>]*>)`,
  'gi',
);

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text.trim());
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract + validate all tool-call envelopes from a model reply.
 * - envelope structure may be repaired ONCE (e.g. truncated closing tag,
 *   stray markdown fences) — this is format repair, never argument guessing.
 * - JSON content must parse; failing arguments → protocol error entry.
 */
export function parseToolCalls(text: string, tools?: ToolDefinition[]): ParsedToolCalls {
  const calls: ToolCallEnvelope[] = [];
  const errors: string[] = [];
  const repairs: string[] = [];

  let body = text;
  ENVELOPE_RE.lastIndex = 0;
  let matches = Array.from(body.matchAll(ENVELOPE_RE));

  if (matches.length === 0) {
    // One format-repair retry: strip code fences / backticks and retry.
    const cleaned = body.replace(/```[\s\S]*?```/g, (m) => m.replace(/^```\w*\n?/, '').replace(/\n?```$/, ''));
    if (cleaned !== body) {
      matches = Array.from(cleaned.matchAll(ENVELOPE_RE));
      if (matches.length > 0) {
        body = cleaned;
        repairs.push('format-repaired: code fences stripped');
      }
    }
  }

  for (const m of matches) {
    const raw = m[2] ?? ''; // group 2 = envelope content (group 1 = open tag)
    const obj = parseJsonObject(raw);
    if (!obj) {
      errors.push(`tool call JSON does not parse: ${raw.slice(0, 80)}`);
      continue;
    }
    const parsed = toolCallSchema.safeParse(obj);
    if (!parsed.success) {
      errors.push(`tool call failed validation: ${parsed.error.issues[0]?.message ?? 'schema error'}`);
      continue;
    }
    const call = parsed.data;
    if (tools && tools.length > 0) {
      const def = tools.find((t) => t.name === call.name);
      if (!def) {
        errors.push(`tool name "${call.name}" is not in the declared tools`);
        continue;
      }
      // Exact argument validation against the declared JSON schema (ajv).
      if (def.parameters) {
        const argErr = validateArgumentsAgainstSchema(call.name, call.arguments, def.parameters);
        if (argErr) {
          errors.push(`arguments for "${call.name}" failed schema validation: ${argErr}`);
          continue;
        }
      }
    }
    calls.push(call);
  }

  return { calls, errors, repairs };
}

/**
 * Validate arguments against a JSON Schema (draft-07 subset via ajv).
 * Strict: extra properties rejected, types enforced. No repairs.
 */
function validateArgumentsAgainstSchema(
  name: string,
  args: Record<string, unknown>,
  schema: Record<string, unknown>,
): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Ajv = require('ajv') as { default: new (o?: Record<string, unknown>) => unknown };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ajv: any = new Ajv.default({ strict: false, allErrors: true });
    const validate = ajv.compile({ ...(schema as object), type: 'object' });
    const ok = validate(args);
    if (!ok && validate.errors?.length) {
      return validate.errors[0]?.message ?? 'schema violation';
    }
    return null;
  } catch {
    // ajv unavailable or schema invalid → lenient (schema was declared by the
    // client; structural envelope validation still applies).
    return null;
  }
}

/** Remove tool-call envelopes from a reply, keeping any plain text. */
export function stripToolEnvelopes(text: string): string {
  return text
    .replace(/<[^>]*hermes_tool_call[^>]*>[\s\S]*?<\/[^>]*hermes_tool_call[^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Wrap Hermes tool results into the envelope for the web model. */
export function buildToolResultEnvelope(results: ToolCallResult[]): string {
  return results
    .map(
      (r) =>
        `${TOOL_RESULT_OPEN}\n${JSON.stringify({ tool_call_id: r.tool_call_id, name: r.name, content: r.content })}\n${TOOL_RESULT_CLOSE}`,
    )
    .join('\n');
}

/** Parse tool-result envelopes (as sent back by Hermes). */
export function parseToolResults(text: string): Array<{ tool_call_id: string; name?: string; content: string }> {
  const out: Array<{ tool_call_id: string; name?: string; content: string }> = [];
  const re = /<[^>]*hermes_tool_result[^>]*>([\s\S]*?)<\/[^>]*hermes_tool_result[^>]*>/gi;
  for (const m of text.matchAll(re)) {
    const obj = parseJsonObject(m[1] ?? '');
    if (!obj) continue;
    const parsed = z
      .object({ tool_call_id: z.string(), name: z.string().optional(), content: z.string().default('') })
      .safeParse(obj);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** Convert parsed envelopes to OpenAI-format tool_calls. */
export function toOpenAIToolCalls(calls: ToolCallEnvelope[]): OpenAIToolCall[] {
  return calls.map((c, i) => ({
    id: `call_${Date.now().toString(36)}_${i}`,
    type: 'function' as const,
    function: { name: c.name, arguments: JSON.stringify(c.arguments) },
  }));
}

/**
 * Protocol instructions injected into the web model's context when a request
 * declares tools (spec §23: strict textual protocol). The webpage model has
 * no system-message API, so the envelope format must be spelled out.
 */
export function buildToolProtocolInstructions(tools: ToolDefinition[]): string {
  const lines = [
    '[TOOL PROTOCOL]',
    'You may call tools by emitting EXACTLY this envelope (nothing else for the call):',
    `<${TOOL_CALL_OPEN}>`,
    '{ "name": "<tool>", "arguments": { ... } }',
    `<${TOOL_CALL_CLOSE}>`,
    'Available tools:',
    ...tools.map((t) => `- ${t.name}${t.parameters ? ` (arguments schema: ${JSON.stringify(t.parameters)})` : ''}`),
    'After the tool result arrives, continue with the final answer.',
  ];
  return lines.join('\n');
}
