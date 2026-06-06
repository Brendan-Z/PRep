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

// A set of 1–3 questions for one file change. The model picks the count from the
// size/complexity of the change — a one-line tweak gets 1, a large multi-function
// change gets up to 3.
export const QuizSetSchema = z.strictObject({
  questions: z
    .array(QuizSchema)
    .min(1)
    .max(3)
    .describe(
      "Ordered questions. DEFAULT TO EXACTLY 1 — most changes warrant a single question. Add a 2nd " +
        "or 3rd ONLY for genuinely distinct behaviours that each deserve their own question; a small " +
        "or single-purpose change MUST get exactly 1. At most 3, and never pad to reach 3.",
    ),
});

export type QuizSet = z.infer<typeof QuizSetSchema>;

export function validateQuizSet(value: unknown): QuizSet | null {
  const result = QuizSetSchema.safeParse(value);
  return result.success ? result.data : null;
}

// Learn-mode output: a teaching breakdown of the selected line(s) for a junior.
export const ExplanationSchema = z.strictObject({
  summary: z
    .string()
    .min(1)
    .describe("One or two plain sentences: what this code does overall, for a junior engineer."),
  lines: z
    .array(
      z.strictObject({
        code: z.string().min(1).describe("The exact line or short fragment being explained."),
        explanation: z
          .string()
          .min(1)
          .describe("Plain-language explanation of what this line does and why it matters."),
      }),
    )
    .min(1)
    .describe("Line-by-line breakdown, in source order, of the provided code."),
});

export type Explanation = z.infer<typeof ExplanationSchema>;

export function validateExplanation(value: unknown): Explanation | null {
  const result = ExplanationSchema.safeParse(value);
  return result.success ? result.data : null;
}

// Whole-file learn output: a sectioned overview of what the file does, rather than
// a line-by-line breakdown (which is unreadable for a full file).
export const FileOverviewSchema = z.strictObject({
  summary: z
    .string()
    .min(1)
    .describe(
      "One or two plain sentences: what this file does overall and its role, for a junior engineer.",
    ),
  sections: z
    .array(
      z.strictObject({
        title: z
          .string()
          .min(1)
          .describe("Short label for this logical section — a function name, type, or responsibility."),
        explanation: z
          .string()
          .min(1)
          .describe("Plain-language explanation of what this section does and why it matters."),
      }),
    )
    .min(1)
    .max(8)
    .describe(
      "A handful of logical sections (grouped by function/type/responsibility), in source order — " +
        "NOT one entry per line. Aim for the few sections that matter most.",
    ),
});

export type FileOverview = z.infer<typeof FileOverviewSchema>;

export function validateFileOverview(value: unknown): FileOverview | null {
  const result = FileOverviewSchema.safeParse(value);
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

export const QUIZ_SET_JSON_SCHEMA = ((): Record<string, unknown> => {
  const schema = z.toJSONSchema(QuizSetSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
})();

export const EXPLANATION_JSON_SCHEMA = ((): Record<string, unknown> => {
  const schema = z.toJSONSchema(ExplanationSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
})();

export const FILE_OVERVIEW_JSON_SCHEMA = ((): Record<string, unknown> => {
  const schema = z.toJSONSchema(FileOverviewSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
})();
