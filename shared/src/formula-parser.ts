/**
 * Tokenizer and parser for formula expressions.
 * Produces an AST consumed by the evaluator.
 */

// ─── Types ───

export type TokenType =
  | "number" | "string" | "ident" | "lparen" | "rparen"
  | "comma" | "op" | "eof";

export interface Token { type: TokenType; value: string }

export interface ASTNode {
  kind: "literal" | "call" | "binary" | "unary";
  value?: unknown;
  name?: string;
  args?: ASTNode[];
  op?: string;
  left?: ASTNode;
  right?: ASTNode;
  operand?: ASTNode;
}

// ─── Tokenizer ───

export function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "(") { tokens.push({ type: "lparen", value: "(" }); i++; continue; }
    if (ch === ")") { tokens.push({ type: "rparen", value: ")" }); i++; continue; }
    if (ch === ",") { tokens.push({ type: "comma", value: "," }); i++; continue; }

    // Two-char operators
    if (i + 1 < expr.length) {
      const two = expr.slice(i, i + 2);
      if ([">=", "<=", "==", "!="].includes(two)) {
        tokens.push({ type: "op", value: two }); i += 2; continue;
      }
    }
    if (["+", "-", "*", "/", ">", "<"].includes(ch)) {
      tokens.push({ type: "op", value: ch }); i++; continue;
    }

    // String literal
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let s = "";
      i++;
      while (i < expr.length && expr[i] !== quote) {
        if (expr[i] === "\\" && i + 1 < expr.length) { s += expr[i + 1]; i += 2; }
        else { s += expr[i]; i++; }
      }
      if (i >= expr.length) throw new Error("Unterminated string literal");
      i++; // closing quote
      tokens.push({ type: "string", value: s });
      continue;
    }

    // Number — consume digits and at most one decimal point
    if (/[0-9.]/.test(ch)) {
      let num = "";
      let seenDot = false;
      while (i < expr.length && /[0-9.]/.test(expr[i])) {
        if (expr[i] === ".") {
          if (seenDot) break; // stop at second dot; let it be parsed as a separate token or error
          seenDot = true;
        }
        num += expr[i]; i++;
      }
      tokens.push({ type: "number", value: num });
      continue;
    }

    // Identifier
    if (/[a-zA-Z_]/.test(ch)) {
      let id = "";
      while (i < expr.length && /[a-zA-Z_0-9]/.test(expr[i])) { id += expr[i]; i++; }
      tokens.push({ type: "ident", value: id });
      continue;
    }

    i++; // skip unknown chars
  }
  tokens.push({ type: "eof", value: "" });
  return tokens;
}

// ─── Parser (recursive descent) ───

class Parser {
  tokens: Token[];
  pos = 0;
  peek(): Token { return this.tokens[this.pos]; }
  next(): Token { return this.tokens[this.pos++]; }
  expect(type: TokenType): Token {
    const t = this.next();
    if (t.type !== type) throw new Error(`Expected ${type}, got ${t.type}`);
    return t;
  }
  constructor(tokens: Token[]) { this.tokens = tokens; }

  parseExpr(): ASTNode { return this.parseComparison(); }

  parseComparison(): ASTNode {
    let left = this.parseAddSub();
    while (this.peek().type === "op" && ["==", "!=", ">", "<", ">=", "<="].includes(this.peek().value)) {
      const op = this.next().value;
      const right = this.parseAddSub();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  parseAddSub(): ASTNode {
    let left = this.parseMulDiv();
    while (this.peek().type === "op" && ["+", "-"].includes(this.peek().value)) {
      const op = this.next().value;
      const right = this.parseMulDiv();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  parseMulDiv(): ASTNode {
    let left = this.parseUnary();
    while (this.peek().type === "op" && ["*", "/"].includes(this.peek().value)) {
      const op = this.next().value;
      const right = this.parseUnary();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  parseUnary(): ASTNode {
    if (this.peek().type === "op" && this.peek().value === "-") {
      this.next();
      return { kind: "unary", op: "-", operand: this.parsePrimary() };
    }
    return this.parsePrimary();
  }

  parsePrimary(): ASTNode {
    const t = this.peek();
    if (t.type === "number") {
      this.next();
      return { kind: "literal", value: parseFloat(t.value) };
    }
    if (t.type === "string") {
      this.next();
      return { kind: "literal", value: t.value };
    }
    if (t.type === "ident") {
      const name = this.next().value;
      if (name === "true") return { kind: "literal", value: true };
      if (name === "false") return { kind: "literal", value: false };
      // Function call
      if (this.peek().type === "lparen") {
        this.next();
        const args: ASTNode[] = [];
        if (this.peek().type !== "rparen") {
          args.push(this.parseExpr());
          while (this.peek().type === "comma") {
            this.next();
            args.push(this.parseExpr());
          }
        }
        this.expect("rparen");
        return { kind: "call", name, args };
      }
      // Bare identifier → column reference shorthand
      return { kind: "call", name: "prop", args: [{ kind: "literal", value: name }] };
    }
    if (t.type === "lparen") {
      this.next();
      const node = this.parseExpr();
      this.expect("rparen");
      return node;
    }
    throw new Error(`Unexpected token: ${t.type} "${t.value}"`);
  }
}

export function parse(tokens: Token[]): ASTNode {
  const parser = new Parser(tokens);
  return parser.parseExpr();
}
