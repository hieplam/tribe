# Readable Code — write down what you know (any language)

## Rule

**Code is hard to read when understanding a line requires knowledge that is not at that line.**
The writer had the knowledge — what the empty value means here, which function ran earlier,
which of two ids this is, why the order matters — and did not write it down. Every reader after
them must reconstruct it, and reconstruction is where wrong inferences come from, for humans and
for AI agents alike.

This is **cognitive load**: the amount a reader must hold in their head that the code does not
say. It is the real source of complexity, and it is the only measure of readability that matters:

> **How much must the reader carry that the code does not state? Push that to zero.**

Fewer lines, more functions, more patterns, cleverer syntax — none of these is a goal. Each is
good only when it lowers what the reader must carry, and harmful when it raises it.

## Why

A reader who reconstructs the writer's knowledge will sometimes reconstruct it wrongly, and the
code gives no signal that they did.

Real case (C#, but the trap exists everywhere): a guard written as

```csharp
if (lead.ConsentForCreditCheck == true) return false;   // field is a nullable boolean
```

was inlined **by the code's own owner, with full ticket context,** as

```csharp
if (lead.ConsentForCreditCheck == false) { ...apply consent... }
```

It compiled, read naturally, and broke 7 tests: the "not set yet" state no longer passed. The
unwritten fact was *"unset and false both mean not yet consented; only true is final."*

**The refactor test:** if a behaviour-preserving rewrite of a piece of code is easy to get
wrong, that code was unreadable. Treat every such slip as a finding about the code, not about
the person.

Legacy codebases compound this. Tech debt that nobody fixed becomes the de-facto standard with no
comment saying it was an accident, and readers then infer *design intent* from what was only
inertia.

## Symptoms → cause → fix

Each symptom is the moment you know the code is hard to read. When you notice one — in code you
are writing, or code you are about to change — apply the fix.

### 1. An empty or magic value carries domain meaning

`null` / `None` / `nil` / `undefined`, `""`, `0`, `-1`, an empty list — standing for a business
concept ("no id means the primary applicant", "0 means unlimited", "empty means all").

```python
# ❌ reader must know what None means here
if member is None or member.is_applying_customer: ...

# ✅ the concept gets a name at the point of use
is_primary_applicant = member is None or member.is_applying_customer
if is_primary_applicant: ...
```

**Fix:** give the concept a name — a named boolean first (cheapest, almost always enough), then
an enum / union / small type if it spreads beyond one function.

### 2. Three-state logic hiding inside a two-state check

The value can be *yes*, *no*, or *absent*, but the check reads as yes/no. Every language has its
version:

| Language | The trap |
|---|---|
| C# / Kotlin / Swift | `bool?`: `== true`, `== false`, `!= true` each put `null` on a different side. `list?.Any() == false` is *false* for a null list |
| JavaScript / TypeScript | truthiness: `if (!count)` also fires for a legitimate `0`; `if (!name)` for `""` |
| Python | `if not items:` conflates `None`, `[]`, `0`, `""` |
| Go | zero values: `0` / `""` / `false` are indistinguishable from "never set" |
| SQL | `NULL = x` is neither true nor false; `NOT IN` with a `NULL` returns nothing |

**Fix:** prefer positive conditions. Wherever an absent state is possible, say — in a name or a
one-line comment — which side "absent" falls on. Check for absence explicitly (`is None`,
`=== undefined`, `is not true`) rather than by truthiness. Never pair a negated condition with a
negative return (`if (x == true) return false`).

### 3. N cases encoded in fewer, overlapping conditions

Two `if`s that are not an either/or pair force the reader to build the truth table themselves.

```ts
// ❌ three cases hidden in two overlapping ifs
if (!member || member.isApplyingCustomer) { writeToLead() }
if (member) { writeToMember() }

// ✅ name the cases, then branch on the names
const isPrimaryApplicant = !member || member.isApplyingCustomer
const hasMemberRow = member !== undefined   // Legacy: a primary sent as a member is written twice
```

**Fix:** name each case first, branch on the names. If a case exists only for a legacy reason,
say so on that branch.

### 4. An extracted function that does not let the reader skip it

Signs: one caller; the name promises more than it does (`applyX` that may not apply); it returns
a boolean meaning "I changed something"; the caller cannot be understood without opening it.

**The test for extraction:** *does the name let the reader NOT open the function?* If yes,
extract. If the reader must read the body anyway, the split added a hop and removed nothing —
inline it. Keep commands and queries separate: a function either changes state or answers a
question, not both.

Splitting is not free. Every extraction trades local reading for a jump; it pays off only when
the name is a truthful, complete summary.

### 5. Correctness depends on something that happened elsewhere

Function B is only right because function A filtered, validated, sorted, or locked first, and
nothing at B says so. Same for statement order that matters ("call the remote system before
saving, or a retry can never heal").

**Fix:** state the dependency *at the point that relies on it*, in one line. Better when cheap:
make it structural — accept the already-validated type, return the filtered collection, so the
wrong order cannot compile or cannot be expressed.

### 6. One word for several things, or several words for one thing

`consent` being a stored field on one type and a computed property on another; a request's
`memberId` matching `member.correlationId` while `member.id` is a different system's id.

**Fix:** one concept, one name, everywhere. Where legacy names already collide and a rename is
out of scope, put a one-line comment at the crossing point saying which is which.

### 7. The deciding fact is an absence, or lives somewhere else

"The primary applicant has no contact record in the CRM" cannot be seen in any code that handles
the primary applicant — it is a thing that does *not* exist, decided in another file, service, or
team.

**Fix:** one line at the decision point stating the fact. This is the highest-value comment there
is, because no amount of reading the local code can recover it.

### 8. Comments that are history, or far from their code

Ticket numbers, "per owner Q5", who detected what and when; a comment in function A explaining
the internals of function C.

**Fix:** a comment states **the rule and the reason**, in domain words, **on the line it
governs**. History belongs in the commit message or the ticket. When tech debt has become the
standard, label it `Legacy:` so nobody mistakes it for design.

### 9. Dense syntax where plain syntax exists

Nested ternaries, boolean accumulators (`ok &= await ...`), long optional-chaining / null-
coalescing chains, comprehensions or pipelines doing branching work, regex where two string
checks would do.

**Fix:** prefer plain `if / else if` and named intermediate values. Two more lines that read
top-to-bottom beat one line the reader has to evaluate in their head.

### 10. Indirection the reader must chase

Behaviour reached only through reflection, decorators/attributes with side effects, dynamic
dispatch by string, deep inheritance, config-driven wiring, global or ambient state. Each is a
jump the reader cannot follow by reading.

**Fix:** prefer a direct call over a clever mechanism. Where the mechanism is warranted, say at
the use site what it resolves to and where that is decided.

## How to avoid it while writing

1. **Write the domain sentence first.** Before the code, say the rule in one plain sentence
   ("the primary applicant's consent lives on the lead; everyone else's on their member row").
   Every noun in that sentence should appear as a name in the code. If the code has no place for
   a noun, the concept is hiding in a sentinel or a condition.
2. **Name, then branch.** Compute named booleans for the cases, then write the `if`s.
3. **Try the name before the comment.** A good name removes load everywhere it is used; a comment
   only where it sits. Comment what no name can carry: absences, ordering, legacy, the *why*.
4. **Extract last.** Write it inline and correct first; extract only what passes the test in §4.

## Self-check before you finish

1. Could someone who knows the language but **not this domain** say what each branch is for,
   without opening another file or function?
2. Does every empty / absent / nullable check say what the absent case means?
3. For each function with a single caller: does its name let the reader skip the body? If not,
   inline.
4. Is every ordering or "already filtered / validated" assumption stated where it is relied on?
5. Does every comment state a rule or a reason — not history — next to the line it governs?
6. Would a careful colleague get a behaviour-preserving rewrite of this right on the first try?

## Pragmatism — and how reviewers grade it

Apply this to the code you write and the code you touch; do not rename or restructure unrelated
code in passing. A couple of precise comments that remove cognitive load are welcome; narration
of what the syntax already says is noise and adds load.

- A sentinel, three-state check, or hidden precondition that makes a branch's meaning
  unrecoverable from the local code → **Should-fix**.
- A single-caller extraction whose name does not let the reader skip it; nested ternaries;
  history-comments; avoidable indirection → **Should-fix / Optional**, by how central the logic is.
- Pure style preference with no change in what the reader must carry → **not a finding**.
