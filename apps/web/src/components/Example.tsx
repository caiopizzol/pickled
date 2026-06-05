import { Button } from "./Button";
import { T, Terminal, TerminalLine } from "./Terminal";
import "./Example.css";

const configSnippet = `# pickled.yml
schemaVersion: 2

product:
  name: zod
  description: TypeScript-first schema validation

sources:
  llms: { url: https://zod.dev/llms.txt }

agents:
  quick:
    provider: claude-code
    model: claude-haiku-4-5

contexts:
  injected: { mode: inject, source: llms }

facts:
  error_api:
    statement: Errors are read with z.treeifyError.
    match:
      allOf: ["z.treeifyError"]

misstatements:
  deprecated_format:
    statement: Recommends the removed ZodError.format().
    match:
      anyOf: ["ZodError.format()"]

questions:
  - id: error-handling
    question: How do I get error messages from failed validation?
    agents: [quick]
    contexts: [injected]
    expects: [error_api]
    rejects: [deprecated_format]
    examples:
      pass: ["Read issues with z.treeifyError(err)."]
      fail: ["Call ZodError.format() on the error."]

builds:
  - id: add-validation
    goal: Add Zod validation to the signup form.
    agents: [quick]
    contexts: [injected]
    trials: 3
    workspace: { path: ./fixtures/app }
    verifier:
      failToPass:
        - { run: bun test }
      passToPass:
        - { run: bun run typecheck }
    referenceSolution:
      patch: ./fixtures/solutions/add-validation.patch

thresholds:
  questions: 80
  builds: 80`;

export function Example() {
  return (
    <section className="example section-divider">
      <div className="container">
        <div className="example-head">
          <div className="example-eyebrow">
            Developers aren't your only readers anymore
          </div>
          <h2 className="example-title">
            One config. Your real docs. Your real checks.
          </h2>
          <p className="example-lede">
            Drop a <code className="inline">pickled.yml</code> next to your
            sources. Declare the sources agents should use, the tasks they
            should complete, and how each one is checked. Whether agents reach
            your product through a public API, SDK docs,{" "}
            <code className="inline">llms.txt</code>,{" "}
            <code className="inline">CLAUDE.md</code>,{" "}
            <code className="inline">AGENTS.md</code>, JSDoc, or internal
            runbooks, pickled tests whether they can answer and build from the
            sources you declared. The example below is a public library.
          </p>
        </div>

        <div className="example-grid">
          <pre className="example-code">{configSnippet}</pre>

          <div className="example-terminal-stack">
            <Terminal label="pickled check · zod">
              <TerminalLine>
                <T.Prompt>$</T.Prompt> pickled check
              </TerminalLine>
              <TerminalLine>&nbsp;</TerminalLine>
              <TerminalLine>
                <T.Dim>Task: error-handling</T.Dim>
              </TerminalLine>
              <TerminalLine>
                &nbsp;&nbsp;<T.Muted>[quick · injected]</T.Muted>{" "}
                <T.Error>✗ Ungrounded 0/1</T.Error>
              </TerminalLine>
              <TerminalLine>
                <T.Dim>
                  {
                    "    reason: misstatement: deprecated_format; missing facts: error_api"
                  }
                </T.Dim>
              </TerminalLine>
              <TerminalLine>
                <T.Dim>Overall:</T.Dim> <T.Error>0</T.Error>{" "}
                <T.Muted>/ 100 · threshold 80 · run fails</T.Muted>
              </TerminalLine>
            </Terminal>

            <Terminal label="pickled build · app">
              <TerminalLine>
                <T.Prompt>$</T.Prompt> pickled build
              </TerminalLine>
              <TerminalLine>&nbsp;</TerminalLine>
              <TerminalLine>
                <T.Dim>Task: add-validation</T.Dim>
              </TerminalLine>
              <TerminalLine>
                &nbsp;&nbsp;<T.Muted>[quick · injected]</T.Muted>{" "}
                <T.Warning>⚠ Partially built 2/3 (verifier proven)</T.Warning>
              </TerminalLine>
              <TerminalLine>
                <T.Dim>{"    failed: bun test (failToPass)"}</T.Dim>
              </TerminalLine>
              <TerminalLine>
                <T.Dim>Overall:</T.Dim> <T.Warning>67</T.Warning>{" "}
                <T.Muted>/ 100 · threshold 80 · run fails</T.Muted>
              </TerminalLine>
            </Terminal>
          </div>
        </div>

        <p className="example-receipt-note">
          A plausible answer can still be wrong, and a plausible edit can still
          fail verification. Pickled keeps both receipts deterministic.
        </p>

        <div className="example-foot">
          <p className="example-note">
            Pickled runs locally. Runs in CI. Each run leaves a receipt you can
            diff and threshold. No dashboard required.
          </p>
          <Button
            as="a"
            href="https://docs.pickled.dev/pickled-yml"
            variant="secondary"
          >
            See the full example
          </Button>
        </div>
      </div>
    </section>
  );
}
