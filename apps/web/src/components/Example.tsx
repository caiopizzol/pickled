import { Button } from "./Button";
import { T, Terminal, TerminalLine } from "./Terminal";
import "./Example.css";

const configSnippet = `# pickled.yml
product:
  name: zod
  description: TypeScript-first schema validation

sources:
  readme: ./README.md
  llms: https://zod.dev/llms.txt

agents:
  quick:
    provider: claude-code
    model: claude-haiku-4-5

access:
  injected: { source: llms, tools: none }

tasks:
  - id: error-handling
    prompt: How do I get error messages from failed validation?
    agents: [quick]
    access: [injected]
    checks:
      mustMention: ["z.treeifyError"]
      mustNotMention: ["ZodError.format()"]

  - id: add-validation
    kind: build
    prompt: Add Zod validation to the signup form.
    agents: [quick]
    access: [injected]
    trials: 3
    workspace: { path: ./fixtures/app }
    verify: [bun test]

threshold: 80`;

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
                &nbsp;&nbsp;<T.Error>✗ Ungrounded</T.Error>{" "}
                <T.Muted>(0%)</T.Muted>
              </TerminalLine>
              <TerminalLine>
                <T.Dim>
                  {'    reason: missing includes: "z.treeifyError"'}
                </T.Dim>
              </TerminalLine>
              <TerminalLine>
                <T.Dim>{'    hit excludes: "ZodError.format()"'}</T.Dim>
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
                &nbsp;&nbsp;<T.Warning>⚠ Partially built</T.Warning>{" "}
                <T.Muted>2/3</T.Muted>
              </TerminalLine>
              <TerminalLine>
                <T.Dim>{"    changed: src/signup.tsx"}</T.Dim>
              </TerminalLine>
              <TerminalLine>
                <T.Dim>{"    command: bun test -> exit 1"}</T.Dim>
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
