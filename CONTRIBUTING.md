# Contributing

This project is a rental bookkeeping worker and operating playbook. Improvements to financial controls, evidence handling, setup, tests and documentation are welcome. Discuss a new bookkeeping model, provider integration or other substantial change in an issue before implementation. The [improvement queue](https://github.com/Burns-Capital-Partners/ai-bookkeeper/issues/1) lists planned work and the current capability limits.

## Keep real books private

Use fictional identities, account IDs and synthetic fixtures. Never include credentials, real statements, tenant or taxpayer details, production configuration, databases, backups or live transaction history in code, issues, pull requests, screenshots or CI logs. Local deployment files belong in each entity's private storage; the ignore rules are a guardrail, not a privacy review. Report suspected sensitive-data exposure privately to the maintainers without copying the values into a public issue.

## Make a small, verified change

1. Read [AGENTS.md](AGENTS.md), the [README](README.md) and relevant operating guides.
2. Work on a feature branch and keep the change focused. Explain the problem and intended behavior.
3. Use Node.js 24 or later and the committed dependency lockfile:

   ```sh
   npm ci --ignore-scripts
   npm test
   npm run typecheck
   git diff --check
   ```

4. Add meaningful regression coverage when changing financial controls or provider matching. Tests must use synthetic data and mocks; passing tests do not prove production books are correct.
5. Open a pull request with the change, verification results and any remaining limitations. Live posting, migrations, schedules and deployments need their own owner authorization and acceptance evidence.

The code and documentation are covered by the [MIT license](LICENSE). Contributions are submitted under that license.
