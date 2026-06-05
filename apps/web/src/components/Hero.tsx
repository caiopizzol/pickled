import { Button } from "./Button";
import { T, Terminal, TerminalLine } from "./Terminal";
import "./Hero.css";

export function Hero() {
  return (
    <section className="hero">
      <div className="container hero-grid">
        <div className="hero-text">
          <h1>
            Test what agents <span className="text-gradient">actually</span>{" "}
            understand.
          </h1>
          <p className="hero-lede">
            <span className="hero-lede-hook">
              For products developers and agents read.
            </span>{" "}
            An open-source CLI that tests whether agents can answer and build
            with your product across context paths, scored by deterministic
            evidence. No LLM grades another LLM.
          </p>
          <div className="hero-actions">
            <Button as="a" href="#start" variant="primary" size="lg">
              Run the check
            </Button>
            <Button
              as="a"
              href="https://github.com/caiopizzol/pickled"
              variant="secondary"
              size="lg"
            >
              View on GitHub
            </Button>
          </div>
          <div className="hero-install">
            <span className="prompt">$</span>
            <code>bun add -g @pickled-dev/cli</code>
          </div>
        </div>

        <div className="hero-terminal">
          <Terminal label="pickled check">
            <TerminalLine>
              <T.Prompt>$</T.Prompt> pickled check
            </TerminalLine>
            <TerminalLine>&nbsp;</TerminalLine>
            <TerminalLine>
              <T.Dim>Task: How do I install pickled?</T.Dim>
            </TerminalLine>
            <TerminalLine>
              &nbsp;&nbsp;<T.Muted>[quick · given_docs]</T.Muted>{" "}
              <T.Success>✓ Well grounded 1/1</T.Success>
            </TerminalLine>
            <TerminalLine>&nbsp;</TerminalLine>
            <TerminalLine>
              <T.Dim>Task: Basic usage</T.Dim>
            </TerminalLine>
            <TerminalLine>
              &nbsp;&nbsp;<T.Muted>[quick · memory]</T.Muted>{" "}
              <T.Warning>⚠ Partially grounded 0/1 (50% facts)</T.Warning>
            </TerminalLine>
            <TerminalLine>
              <T.Dim>{"    reason: missing facts: run_command"}</T.Dim>
            </TerminalLine>
            <TerminalLine>&nbsp;</TerminalLine>
            <TerminalLine>
              <T.Dim>Task: Config format</T.Dim>
            </TerminalLine>
            <TerminalLine>
              &nbsp;&nbsp;<T.Muted>[quick · web_open]</T.Muted>{" "}
              <T.Error>✗ Ungrounded 0/1</T.Error>
            </TerminalLine>
            <TerminalLine>
              <T.Dim>{"    reason: tool path not used (provenance)"}</T.Dim>
            </TerminalLine>
            <TerminalLine>&nbsp;</TerminalLine>
            <TerminalLine>
              <T.Dim>Overall:</T.Dim> <T.Warning>42</T.Warning>{" "}
              <T.Muted>/ 100 · threshold 80 · run fails</T.Muted>
            </TerminalLine>
          </Terminal>
        </div>
      </div>
    </section>
  );
}
