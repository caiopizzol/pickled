import { Button } from "./Button";
import "./CTA.css";

export function CTA() {
  return (
    <section className="cta section section-divider" id="get-started">
      <div className="container">
        <h2>Ready to preserve your visibility?</h2>
        <p>Open source. Free forever. Start in 30 seconds.</p>
        <Button as="a" href="/docs" variant="primary">
          Get Started
        </Button>
      </div>
    </section>
  );
}
