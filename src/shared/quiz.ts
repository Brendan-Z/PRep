// The single source of truth for the quiz shape: the zod schema below derives
// the TS type (z.infer), the runtime validator (safeParse) and the JSON Schema
// passed to the model as a tool definition (z.toJSONSchema).

import { z } from "zod";

export const QuizSchema = z.strictObject({
  question: z.string().min(1).describe("One question asking what the code DOES."),
  options: z
    .array(z.string().min(1))
    .length(4)
    .describe("Exactly four answer options; exactly one is correct."),
  correctIndex: z.number().int().min(0).max(3).describe("Index of the correct option."),
  explanation: z
    .string()
    .min(1)
    .describe(
      "Plain-language, junior-friendly breakdown of exactly what the code does and why the correct option is right.",
    ),
});

export type Quiz = z.infer<typeof QuizSchema>;

export function validateQuiz(value: unknown): Quiz | null {
  const result = QuizSchema.safeParse(value);
  return result.success ? result.data : null;
}

// JSON Schema for the Portkey/Claude tool-call parameters. Strip the $schema
// marker — Portkey wants a bare parameters object.
function buildJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(QuizSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

export const QUIZ_JSON_SCHEMA = buildJsonSchema();
