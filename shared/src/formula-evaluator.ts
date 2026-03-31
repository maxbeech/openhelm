/**
 * Formula evaluator for data table formula columns.
 *
 * Supports:
 * - Column references: prop("Column Name")
 * - Arithmetic: +, -, *, /
 * - Comparisons: >, <, >=, <=, ==, !=
 * - String concatenation (+ on strings)
 * - Functions: if(cond, then, else), length(str), round(n, places),
 *   abs(n), floor(n), ceil(n), now(), empty(val), toNumber(val)
 * - Boolean: and(a, b), or(a, b), not(a)
 */

import type { ASTNode } from "./formula-parser.js";
import { tokenize, parse } from "./formula-parser.js";

type RowData = Record<string, unknown>;
type ColNameToId = Record<string, string>;

interface EvalContext {
  row: RowData;
  colNameToId: ColNameToId;
}

/** Evaluate a formula expression against a row's data. */
export function evaluateFormula(
  expression: string,
  row: RowData,
  colNameToId: ColNameToId,
): unknown {
  try {
    const ctx: EvalContext = { row, colNameToId };
    const tokens = tokenize(expression);
    const ast = parse(tokens);
    return evaluate(ast, ctx);
  } catch {
    return "#ERROR";
  }
}

// ─── Evaluator ───

function evaluate(node: ASTNode, ctx: EvalContext): unknown {
  switch (node.kind) {
    case "literal":
      return node.value;
    case "unary":
      return -(toNum(evaluate(node.operand!, ctx)));
    case "binary":
      return evalBinary(node.op!, evaluate(node.left!, ctx), evaluate(node.right!, ctx));
    case "call":
      return evalCall(node.name!, (node.args ?? []).map((a) => evaluate(a, ctx)), ctx);
    default:
      return null;
  }
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function evalBinary(op: string, left: unknown, right: unknown): unknown {
  if (op === "+") {
    if (typeof left === "string" || typeof right === "string") return String(left ?? "") + String(right ?? "");
    return toNum(left) + toNum(right);
  }
  const l = toNum(left), r = toNum(right);
  switch (op) {
    case "-": return l - r;
    case "*": return l * r;
    case "/": return r === 0 ? "#DIV/0" : l / r;
    case ">": return l > r;
    case "<": return l < r;
    case ">=": return l >= r;
    case "<=": return l <= r;
    case "==": return left === right;
    case "!=": return left !== right;
    default: return null;
  }
}

function evalCall(name: string, args: unknown[], ctx: EvalContext): unknown {
  switch (name.toLowerCase()) {
    case "prop": {
      // Lookup is case-insensitive; colNameToId keys are lowercased at build time.
      const colId = ctx.colNameToId[String(args[0] ?? "").toLowerCase()];
      return colId ? ctx.row[colId] ?? null : null;
    }
    case "if":
      return args[0] ? args[1] : args[2] ?? null;
    case "length":
      return typeof args[0] === "string" ? args[0].length : 0;
    case "round":
      return Math.round(toNum(args[0]) * 10 ** toNum(args[1] ?? 0)) / 10 ** toNum(args[1] ?? 0);
    case "abs":
      return Math.abs(toNum(args[0]));
    case "floor":
      return Math.floor(toNum(args[0]));
    case "ceil":
      return Math.ceil(toNum(args[0]));
    case "now":
      return new Date().toISOString();
    case "empty":
      return args[0] === null || args[0] === undefined || args[0] === "";
    case "tonumber":
      return toNum(args[0]);
    case "and":
      return !!args[0] && !!args[1];
    case "or":
      return !!args[0] || !!args[1];
    case "not":
      return !args[0];
    case "concat":
      return args.map((a) => String(a ?? "")).join("");
    default:
      return null;
  }
}
