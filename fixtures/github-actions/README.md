# Pickled CI fixture

This fixture models a small repository that already has a `pickled.yml` and wants Pickled wired into GitHub Actions.

Add `.github/workflows/pickled.yml`.

The workflow should:

- run `bunx @pickled-dev/cli test .` on pull requests
- run `bunx @pickled-dev/cli check . --plan` on pull requests
- run `bunx @pickled-dev/cli build . --plan` on pull requests
- put real agent runs behind `workflow_dispatch`, `schedule`, or another trusted non-PR path
- pass `ANTHROPIC_API_KEY` through GitHub secrets only in the real-agent job
- cap real agent runs with `--max-cells`
- avoid `pull_request_target`

The verifier checks workflow shape. It does not execute GitHub Actions.
