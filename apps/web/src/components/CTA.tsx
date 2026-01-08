import { Button } from "./Button";
import "./CTA.css";

export function CTA() {
  return (
    <section className="cta section section-divider" id="get-started">
      <div className="container">
        <h2>Ready to check your freshness?</h2>
        <p>Open source. Free forever. Start in 30 seconds.</p>
        <Button
          as="a"
          href="https://github.com/caiopizzol/pickled#quick-start"
          variant="primary"
        >
          Get Started
        </Button>
      </div>
    </section>
  );
}
