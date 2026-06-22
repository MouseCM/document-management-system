---
name: vdt:loop
description: "Assess, route, fix, and verify in a loop until tests pass. Demonstrates Pattern 5: Conditional + Loop."
user-invocable: true
when_to_use: "Invoke when tests are failing and need iterative fix-verify cycles."
category: utilities
keywords: [conditional, loop, incident-response, self-healing, pattern-5]
argument-hint: "[issue description]"
metadata:
  author: vdt-demo
  version: "1.0.0"
---

# Loop — Conditional + Loop Pattern (Pattern 5)

Iterative fix cycle: ASSESS → ROUTE → EXECUTE → VERIFY → LOOP (max 3 iterations).

## Usage

```
/vdt:loop "Tests are failing. Fix until all tests pass."
```

## Workflow

### Step 1: ASSESS

Run the test suite and capture the failure:
```bash
npm test 2>&1
```
Parse the output: error type, file, line number, stack trace.

### Step 2: ROUTE (Conditional)

Classify the error and pick a fix strategy:

| Error Type | Strategy | Agent |
|-----------|----------|-------|
| Null/undefined reference | Add null check, early return | debugger |
| Type mismatch | Fix type casting or validation | debugger |
| Missing import/module | Add import statement | (self) |
| Logic error | Rewrite logic block | debugger |
| Test assertion wrong | Fix test expectation | tester |
| Config/env issue | Fix configuration | (self) |

### Step 3: EXECUTE

Apply the fix based on the routed strategy:
1. Delegate to appropriate agent if needed
2. Make targeted code change
3. Ensure change matches codebase conventions

### Step 4: VERIFY

Run test suite again:
```bash
npm test
```

- If ALL PASS → **DONE** (exit loop)
- If STILL FAILING → continue to Step 5

### Step 5: LOOP

- Increment iteration counter
- If iteration < 3 → go back to Step 1 (ASSESS)
- If iteration >= 3 → **STOP** and report to user:
  - What was tried
  - What still fails
  - Suggested next steps

## Safety

- **Max 3 iterations** — prevents infinite loops
- Each iteration must make progress (different fix than previous)
- If same error appears twice → escalate, don't retry same approach

## Demo Annotation

```
🔍 ASSESS: npm test → "TypeError: Cannot read property 'email' of null"
🧠 ROUTE: Null reference → add null check strategy
🔧 EXECUTE: Add early return if user is null
🧪 VERIFY: npm test → ✅ All pass!
✅ DONE (1 iteration)
```

Or multi-iteration:
```
🔍 ASSESS: npm test → 2 failures
🧠 ROUTE: Null ref + missing validation
🔧 EXECUTE: Fix null check
🧪 VERIFY: npm test → 1 still failing
🔄 LOOP (iteration 2)
🔍 ASSESS: "ValidationError: email format invalid"
🧠 ROUTE: Validation error → fix input sanitization
🔧 EXECUTE: Add email validation
🧪 VERIFY: npm test → ✅ All pass!
✅ DONE (2 iterations)
```
