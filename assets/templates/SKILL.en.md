---
name: my-skill
description: 'Complete [specific task] and produce [deliverable]. Use when the user requests [trigger scenario], mentions [keywords], or provides [relevant input].'
---

# [Skill name]

> Template instructions: Fill in “Skill name” and “Purpose and triggers” above in MD, replace the [placeholders] below with specific instructions, and remove this paragraph before use. Use lowercase letters, digits, and hyphens for the skill name, up to 64 characters. Keep the filename SKILL.md when saving. Describe what the skill does and when to use it; avoid broad claims such as “use for every task.”

## Goal and scope

Complete [one clear task] and produce [a specific output format].

- Use for: [typical requests that should trigger this skill].
- Do not use for: [similar requests that should not trigger this skill].
- Completion criteria: [checkable results, such as file contents, layout, or interface behavior].

## Inputs and defaults

- Required: [information needed to complete the task reliably].
- Optional: [preferences, dimensions, formats, or constraints].
- Defaults: [reasonable values to use when the user does not specify them].
- Clarification: [only questions whose answers would materially change the result].

## Steps

1. Read [specified files, sources, or tool state] and verify [facts relevant to the task].
2. Check whether the inputs meet [necessary conditions]. Ask about [critical missing information] if needed; otherwise continue.
3. Use [specific tools or methods] to perform [the core task], following [task-specific constraints].
4. Create [deliverables] using [file naming, directory, or content rules].
5. Run the checks below. Fix any problems and repeat the affected checks.
6. Deliver the result and explain [limitations or next steps the user needs to know].

## Output format

- Location: [the user’s requested directory, or an explicit default].
- File type and name: [for example, report.md; include only formats this skill needs].
- Structure: [key sections or components the deliverable must contain].
- Response: [link to the result first, followed by brief usage instructions].

## Verification and errors

- Content checks: [checks that demonstrate the result is correct].
- Run or preview: [commands, tools, or inspection steps, if needed].
- Unavailable sources: [fallbacks and limitations to report].
- Failed checks: [how to fix problems, or what to preserve and report if they cannot be fixed].

Report a check as passed only after running it successfully. Clearly identify checks that were not run.

## Supporting resources (keep only as needed)

Create and reference these resources only when necessary. Remove this section for a simple skill.

- scripts/: [repeatable operations or deterministic checks; include how to run them].
- references/: [longer specifications or background material; state when to read them].
- assets/: [templates, images, or other resources used to produce the deliverable].

Use relative paths to resources that exist, such as references/format.md. Do not create empty directories or duplicate prose here.

## Trial cases (fill in and run before release)

- Normal request: [a realistic request that should trigger this skill]; expected result: [a checkable deliverable].
- Edge case: [missing inputs or an error]; expected behavior: [ask, use a default, or report a limitation].
- Out-of-scope request: [a request that should not trigger this skill]; expected behavior: [do not use the skill].

Passing structure checks confirms the file format, not the skill’s effectiveness.
