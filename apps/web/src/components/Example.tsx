import { Button } from "./Button";
import { T, Terminal, TerminalLine } from "./Terminal";
import "./Example.css";

const configSnippet = `# pickled.yml
tool:
  name: zod
  description: TypeScript-first schema validation

docs:
  sources:
    readme: ./README.md
    llms: https://zod.dev/llms.txt

scenarios:
  - name: Error handling
    prompt: How do I get error messages from failed validation?
    requiredSources: [readme, llms]
    traps:
      - id: old_v2_api
        match: "ZodError.format()"
        reason: "Deprecated in Zod 4; use z.treeifyError()"

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
            One config. Your real docs. Your real traps.
          </h2>
          <p className="example-lede">
            Drop a <code className="inline">pickled.yml</code> next to your
            sources. Declare what agents should cite, the scenarios they should
            answer, and the stale patterns you've already moved past. Whether
            agents reach your product through a public API, SDK docs,{" "}
            <code className="inline">llms.txt</code>,{" "}
            <code className="inline">CLAUDE.md</code>,{" "}
            <code className="inline">AGENTS.md</code>, JSDoc, or internal
            runbooks, pickled tests whether they can answer from the sources you
            declared. The example below is a public library.
          </p>
        </div>

        <div className="example-grid">
          <pre className="example-code">{configSnippet}</pre>

          <Terminal label="pickled check · zod">
            <TerminalLine>
              <T.Prompt>$</T.Prompt> pickled check
            </TerminalLine>
            <TerminalLine>&nbsp;</TerminalLine>
            <TerminalLine>
              <T.Dim>Source check</T.Dim>
            </TerminalLine>
            <TerminalLine>
              &nbsp;&nbsp;<T.Success>✓</T.Success>{" "}
              <T.Dim>readme · ./README.md</T.Dim>
            </TerminalLine>
            <TerminalLine>
              &nbsp;&nbsp;<T.Success>✓</T.Success>{" "}
              <T.Dim>llms · https://zod.dev/llms.txt</T.Dim>
            </TerminalLine>
            <TerminalLine>&nbsp;</TerminalLine>
            <TerminalLine>
              <T.Dim>Scenario: Error handling</T.Dim>
            </TerminalLine>
            <TerminalLine>
              &nbsp;&nbsp;<T.Error>✗ Trap fired</T.Error>{" "}
              <T.Muted>(0%)</T.Muted>
            </TerminalLine>
            <TerminalLine>
              <T.Dim>&nbsp;&nbsp;&nbsp;&nbsp;trap: old_v2_api</T.Dim>
            </TerminalLine>
            <TerminalLine>
              <T.Dim>
                {"    reason: Deprecated in Zod 4; use z.treeifyError()"}
              </T.Dim>
            </TerminalLine>
            <TerminalLine>
              <T.Dim>{'    match: "ZodError.format()" in response'}</T.Dim>
            </TerminalLine>
            <TerminalLine>
              <T.Dim>&nbsp;&nbsp;&nbsp;&nbsp;cited: [readme, llms]</T.Dim>
            </TerminalLine>
            <TerminalLine>&nbsp;</TerminalLine>
            <TerminalLine>
              <T.Dim>Overall:</T.Dim> <T.Error>0</T.Error>{" "}
              <T.Muted>/ 100 · threshold 80 · run fails</T.Muted>
            </TerminalLine>
          </Terminal>
        </div>

        <p className="example-receipt-note">
          A grounded answer can still be wrong. The trap caught a deprecated Zod
          4 API that the agent still recommends.
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
