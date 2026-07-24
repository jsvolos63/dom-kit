# @jfs/dom-kit — working notes for Claude

Shared, dependency-free DOM/escaping primitives (HTML escaping, URL +
image-src guards, dual innerHTML/setAttribute URL sanitizers, whitelist
HTML sanitizer, and an auto-escaping `el()` element builder) extracted
from the JFS family of buildless static sites. Consumers vendor this kit
via its own CLI rather than installing it at runtime, so a change here
reaches an app only once that app bumps its pin and re-runs
`vendor:sync`.

## Pull requests

Open pull requests **ready for review — never as drafts.** This applies to
PRs opened by automated Claude Code sessions too: some hosted environments
default to creating drafts, so mark the PR ready as part of opening it
rather than leaving it for a follow-up.
