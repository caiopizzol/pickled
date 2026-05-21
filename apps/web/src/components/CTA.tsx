import { Button } from "./Button";
import "./CTA.css";

export function CTA() {
  return (
    <section className="cta section-divider" id="start">
      <div className="container">
        <h2>
          Find out what AI <span className="text-gradient">thinks</span> your
          product does.
        </h2>
        <p className="cta-lede">
          Open source. MIT. Install in 30 seconds. See your first score in two
          minutes.
        </p>
        <div className="cta-install">
          <span className="prompt">$</span>
          <code>bun add -g @pickled-dev/cli</code>
        </div>
        <div className="cta-actions">
          <Button
            as="a"
            href="https://github.com/caiopizzol/pickled#quick-start"
            variant="primary"
            size="lg"
          >
            Quickstart
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
        <p className="cta-pickler">
          A pickle isn't fresh. A pickle is preserved. Same idea for your
          product context.
        </p>
      </div>
    </section>
  );
}
