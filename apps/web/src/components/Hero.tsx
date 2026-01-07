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
            <span className="text-gradient">Preserve</span> your visibility in
            AI
          </h1>
          <p className="hero-tagline">
            Track how often AI recommends your developer tool. Get actionable
            insights to stay fresh in the age of AI-assisted discovery.
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
              <T.Prompt>$</T.Prompt> <T.Cmd>pickled check zod</T.Cmd>
            </TerminalLine>
            <TerminalLine>&nbsp;</TerminalLine>
            <TerminalLine>
              <T.Output>🥒 </T.Output>
              <T.Highlight>PICKLED</T.Highlight>
              <T.Output> v1.0.0</T.Output>
            </TerminalLine>
            <TerminalLine>
              <T.Output> Checking your freshness...</T.Output>
            </TerminalLine>
            <TerminalLine>&nbsp;</TerminalLine>
            <TerminalLine>
              <T.Output> </T.Output>
              <T.Success>████████░░</T.Success>
              <T.Output> 80% TypeScript validation</T.Output>
            </TerminalLine>
            <TerminalLine>
              <T.Output> </T.Output>
              <T.Success>Perfectly preserved! 🥒</T.Success>
            </TerminalLine>
            <TerminalLine>&nbsp;</TerminalLine>
            <TerminalLine>
              <T.Output> </T.Output>
              <T.Warning>███░░░░░░░</T.Warning>
              <T.Output> 30% Form validation</T.Output>
            </TerminalLine>
            <TerminalLine>
              <T.Output> </T.Output>
              <T.Warning>Going stale. yup is fresher here.</T.Warning>
            </TerminalLine>
            <TerminalLine>&nbsp;</TerminalLine>
            <TerminalLine>
              <T.Success>🥒 Stay fresh out there!</T.Success>
            </TerminalLine>
          </Terminal>
        </div>
      </div>
    </section>
  );
}
