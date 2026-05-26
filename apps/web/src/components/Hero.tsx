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
            An open-source CLI that runs scenarios across real interfaces,
            sources, and tool paths, then scores each cell with deterministic
            checks. No LLM grades another LLM.
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
              <T.Dim>Scenario: How do I install pickled?</T.Dim>
            </TerminalLine>
            <TerminalLine>
              &nbsp;&nbsp;<T.Success>✓ Well grounded</T.Success>{" "}
              <T.Muted>(92%)</T.Muted> <T.Dim>cited: [readme]</T.Dim>
            </TerminalLine>
            <TerminalLine>&nbsp;</TerminalLine>
            <TerminalLine>
              <T.Dim>Scenario: Basic usage</T.Dim>
            </TerminalLine>
            <TerminalLine>
              &nbsp;&nbsp;<T.Warning>⚠ Partially grounded</T.Warning>{" "}
              <T.Muted>(65%)</T.Muted> <T.Dim>missing: [llms.txt]</T.Dim>
            </TerminalLine>
            <TerminalLine>&nbsp;</TerminalLine>
            <TerminalLine>
              <T.Dim>Scenario: Config format</T.Dim>
            </TerminalLine>
            <TerminalLine>
              &nbsp;&nbsp;<T.Error>✗ Trap fired</T.Error>{" "}
              <T.Muted>(0%)</T.Muted> <T.Dim>old_config_schema</T.Dim>
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
