// Minimal ambient declaration for jsdom — the agent package reuses the root's
// jsdom install without pulling in @types/jsdom. Only the surface used by
// web-fetch.ts is declared.

declare module "jsdom" {
  export class JSDOM {
    constructor(html: string, options?: Record<string, unknown>);
    readonly window: {
      readonly document: Document;
    };
  }
}
