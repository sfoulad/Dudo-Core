# agents/ — Agent rules, prompts, and task specifications

**Owner: `architecture-agent`** (Team Lead owns the boundary itself)

Dudo is built by a team of AI agents working under explicit written rules. This directory
holds the **public, versioned** record of how that works: the standards agents are held
to, the reusable prompt and task-specification formats, and the specifications for work
in flight.

> The agents' private operating configuration lives outside this repository and is not
> published. What is here is the part that belongs in the open: the rules the work is
> judged against.

## Contents

| Path | Purpose |
|---|---|
| `rules/` | Binding engineering standards agents must follow |
| `prompts/` | Reusable prompt and task-specification formats |
| `tasks/` | Specifications for individual units of work |

## The task pod

No significant task goes to a single agent. Every task forms a pod:

1. **Architecture** — understands the requirement, defines contracts, checks Core/App
   boundaries, identifies events, permissions, and security considerations. Does not
   implement.
2. **Implementation** — builds to the approved contract, inside its assigned paths.
3. **Test** — works independently of implementation.
4. **Security & architecture review** — authentication, authorization, tenant isolation,
   data exposure, cross-module access, secrets, contracts, architecture rules.
5. **Integration** — compatibility with existing Apps, events, SDK, API, MCP, regression.

**The agent that writes the implementation is never the final approving agent.** No
self-review. That rule is why the review roles hold no write access at all.

## Task specification

Before code starts, a task receives: objective · affected App or service · business
requirement · architecture · API changes · event changes · permission changes · data
changes · UI changes · MCP changes · **files allowed to change** · acceptance criteria ·
test requirements · security requirements.

Agents do not casually expand scope. An ambiguous "files allowed to change" list is how
scope creep starts, so it is stated explicitly.

## File ownership

Two agents never hold the same file at once. Ownership is assigned per task and follows
the boundaries in `docs/architecture/boundaries.md`. An agent needing a file outside its
ownership stops and asks rather than editing it.

*Empty. Populated during Phase 0, alongside the standards and registries.*
