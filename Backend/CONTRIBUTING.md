# Contributing to Solus Protocol

## Coding Standards

All code in Solus Protocol follows these standards without exception. Consistency is not optional on a judged submission.

### File Naming
All TypeScript files: `kebab-case.ts`

### Variable and Function Naming
All variables and functions: `camelCase`

### Class and Interface Naming
All classes and interfaces: `PascalCase`

### Constants
All module-level constants: `UPPER_SNAKE_CASE`

### File Header Comments
Every file opens with a block comment describing its responsibility. This is not optional.

```typescript
/**
 * guardian-service.ts
 * Implements the adversarial second opinion for agent decisions using Google Gemini.
 * Receives the Strategist's full decision output and returns APPROVE, VETO, or MODIFY.
 * Runs after the Strategist (Layer 2) and before the Policy Engine (Layer 4).
 */
```

### Inline Comment Style
- Complete sentences, professional tone
- No emoji anywhere in code or comments
- Comments explain WHY, not WHAT

```typescript
// Correct
// Zero out the buffer immediately after signing to minimize the window during
// which the private key material exists in heap memory.
buffer.fill(0);

// Incorrect
// zero buffer
buffer.fill(0);
```

### General Rules
- No `any` types — use proper TypeScript types or `unknown` with a type guard
- All async functions have explicit return types
- All external inputs validated with Zod before use
- No `console.log` in production paths — use the winston audit logger
- Every `try/catch` logs the error and handles the failure state explicitly
