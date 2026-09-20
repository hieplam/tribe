# Architecture
This project uses C3 docs in `.c3/`.
For architecture questions, changes, audits or file context, invoke the `c3` skill (Skill tool,
skill name `c3`); it resolves its own tooling — there is no `c3` executable on PATH.
Operations: query, audit, change, ref, rule, sweep.
File lookup: ask the `c3` skill to map a file or glob to its components + refs.

# ALWAYS thinking of Progressive disclosure
Always check README file or docs on each sub foler or each plugins to get context on that area
When change content, always update docs to keep that updated

# How to install skills
This is private repo, there is a install.sh script in the root repo that help to install the skills. When add new skills, agents or scripts, must update the script to make it fully install.

