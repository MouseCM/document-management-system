---
name: vdt:fix
description: "Fix bugs with single-agent reasoning loop. Demonstrates Pattern 1: Single Agent Architecture."
user-invocable: true
when_to_use: "Invoke when there is a concrete bug to fix. One-shot reasoning loop."
category: utilities
keywords: [bugfix, single-agent, reasoning-loop, pattern-1]
argument-hint: "[error description]"
metadata:
  author: vdt-demo
  version: "1.0.0"
---

# Fix — Single Agent Reasoning Loop (Pattern 1)

One-shot bug fix using a reasoning loop: Read → Reason → Fix → Test → Done.

## Usage

```
/vdt:fix "TypeError: Cannot read property 'email' of null at auth/login.ts:45"
```

## Workflow

### Step 1: Read

- Read the file at the error location
- Read related test files
- Understand the surrounding context

### Step 2: Reason

- Analyze the root cause (NOT just the symptom)
- Form hypothesis: "user can be null when not found in DB, but code assumes it exists"
- Identify the minimal fix that resolves the issue

### Step 3: Fix

- Apply targeted edit (minimal change, maximum correctness)
- Write a regression test if none exists
- Delegate to `debugger` agent if root cause is unclear

### Step 4: Test

- Run `npm test` to verify fix
- Confirm no regressions introduced
- If test passes → DONE

## Key Principle

This is a SINGLE agent with a reasoning loop — no delegation to multiple agents, no retry loops, no conditional routing. Just: read, think, fix, verify.

## Demo Annotation

```
🧠 Reason: "I need to read the file to understand context"
📖 Read: src/auth/login.ts — see null access at line 45
🧠 Reason: "user can be null, need early return with 401"
🔧 Fix: Add null check before accessing user.email
🧪 Test: npm test → All pass ✅
```
