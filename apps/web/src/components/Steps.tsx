import "./Steps.css";

interface Step {
  number: number;
  title: string;
  description: string;
}

const steps: Step[] = [
  {
    number: 1,
    title: "Define scenarios",
    description:
      "Create a pickled.yml with questions developers might ask about your tool.",
  },
  {
    number: 2,
    title: "Run check",
    description:
      "Pickled tests AI responses and validates if answers are correct and complete.",
  },
  {
    number: 3,
    title: "Get your score",
    description:
      "See your freshness score and identify where your documentation needs work.",
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
