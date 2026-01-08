import { Button } from "./Button";
import { T, Terminal, TerminalLine } from "./Terminal";
import "./Hero.css";

export function Hero() {
  const handleCopy = () => {
    navigator.clipboard.writeText("bun add -g @pickled-dev/cli");
  };

  return (
    <section className="hero">
      <div className="container hero-content">
        <div className="hero-text">
          <h1>
            Is AI getting your <span className="text-gradient">tool</span>{" "}
            right?
          </h1>
          <p className="hero-tagline">
            Test how well AI responds to questions about your developer tool.
            Define scenarios, run checks, and see your freshness score.
          </p>
          <div className="hero-cta">
            <Button as="a" href="#get-started" variant="primary" size="lg">
              Get Started
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
            <span>$</span>
            <code>bun add -g @pickled-dev/cli</code>
            <button
              type="button"
              className="hero-install-copy"
              title="Copy to clipboard"
              onClick={handleCopy}
            >
              📋
            </button>
          </div>
        </div>

        <div className="hero-terminal">
          <Terminal>
            <TerminalLine>
              <T.Prompt>$</T.Prompt> <T.Cmd>pickled check</T.Cmd>
            </TerminalLine>
            <TerminalLine>&nbsp;</TerminalLine>
            <TerminalLine>
              <T.Output>🥒 </T.Output>
              <T.Highlight>Freshness Check</T.Highlight>
            </TerminalLine>
            <TerminalLine>&nbsp;</TerminalLine>
            <TerminalLine>
              <T.Output>Tool: </T.Output>
              <T.Cmd>zod</T.Cmd>
            </TerminalLine>
            <TerminalLine>&nbsp;</TerminalLine>
            <TerminalLine>
              <T.Output> </T.Output>
              <T.Success>✓</T.Success>
              <T.Output> "Installation" - Well preserved (92%)</T.Output>
            </TerminalLine>
            <TerminalLine>
              <T.Output> </T.Output>
              <T.Success>✓</T.Success>
              <T.Output> "Basic parsing" - Fresh (85%)</T.Output>
            </TerminalLine>
            <TerminalLine>
              <T.Output> </T.Output>
              <T.Warning>⚠</T.Warning>
              <T.Output> "Error handling" - Going stale (65%)</T.Output>
            </TerminalLine>
            <TerminalLine>&nbsp;</TerminalLine>
            <TerminalLine>
              <T.Output>Freshness Score: 81% </T.Output>
              <T.Success>🥒🥒🥒🥒</T.Success>
              <T.Output>░</T.Output>
            </TerminalLine>
          </Terminal>
        </div>
      </div>
    </section>
  );
}
