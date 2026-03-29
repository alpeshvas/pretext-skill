# pretext-skill

Claude Code skill for building with [@chenglou/pretext](https://github.com/chenglou/pretext) — a pure JS library for multiline text measurement and layout without DOM reflows.

## Install

Clone into your Claude Code skills directory:

```bash
cd ~/.claude/skills
git clone git@github.com:alpeshvas/pretext-skill.git pretext
```

## What it does

Activates automatically when Claude detects you're working with `@chenglou/pretext` — importing it, rendering canvas text, or mentioning "pretext" / "text layout without DOM".

Provides Claude with knowledge of:

- Two-phase `prepare()` + `layout()` architecture
- Canvas text rendering patterns with character positioning
- Variable-width reflow with `layoutNextLine`
- HiDPI setup and font-matching gotchas
- Full API reference with types
