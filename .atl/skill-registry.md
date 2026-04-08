# Skill Registry — condominium-server

## Project Stack
- Runtime: Bun
- Framework: Elysia
- Language: TypeScript (strict)
- Database: Supabase (PostgreSQL)
- Architecture: Modular Clean Architecture

## User Skills

| Skill | Trigger | Path |
|-------|---------|------|
| go-testing | Go tests, Bubbletea TUI testing | `~/.claude/skills/go-testing/SKILL.md` |
| skill-creator | Creating new AI skills | `~/.claude/skills/skill-creator/SKILL.md` |
| judgment-day | Adversarial review protocol | `~/.claude/skills/judgment-day/SKILL.md` |
| branch-pr | PR creation workflow | `~/.claude/skills/branch-pr/SKILL.md` |
| issue-creation | Issue creation workflow | `~/.claude/skills/issue-creation/SKILL.md` |

## Compact Rules

### branch-pr
- Follow issue-first enforcement: every PR must reference an issue
- Use conventional commits format

### issue-creation
- Create GitHub issues before PRs
- Use structured templates with labels

## Project Conventions

No project-level CLAUDE.md, .cursorrules, or agents.md found.
Global CLAUDE.md rules apply (conventional commits, no Co-Authored-By, use bat/rg/fd/sd/eza).
