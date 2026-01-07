import "./Steps.css";

interface Step {
  number: number;
  title: string;
  description: string;
}

const steps: Step[] = [
  {
    number: 1,
    title: "Point to your repo",
    description:
      "Provide your GitHub URL. We extract info and discover competitors automatically.",
  },
  {
    number: 2,
    title: "Check freshness",
    description:
      "We query AI models with real questions and track which tools get recommended.",
  },
  {
    number: 3,
    title: "Stay fresh",
    description:
      "Get actionable tips to improve visibility. Update docs, add examples, extend shelf life.",
  },
];

export function Steps() {
  return (
    <section className="steps section section-divider" id="how">
      <div className="container">
        <div className="section-label">How it works</div>
        <h2 className="section-title">Three steps to stay fresh</h2>
        <div className="steps-grid">
          {steps.map((step) => (
            <div key={step.number} className="step">
              <div className="step-number">{step.number}</div>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
