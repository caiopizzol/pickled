import "./Features.css";

interface Feature {
  icon: string;
  title: string;
  description: string;
}

const features: Feature[] = [
  {
    icon: "📊",
    title: "Freshness Score",
    description:
      "Track AI recommendations across topics. Know where you're preserved and where you're going stale.",
  },
  {
    icon: "🫙",
    title: "The Jar",
    description:
      "See competitors on the shelf. Compare freshness and identify opportunities.",
  },
  {
    icon: "🔍",
    title: "Code Check",
    description:
      "Verify AI generates correct code for your API. Catch issues before users do.",
  },
  {
    icon: "📚",
    title: "Shelf Life",
    description:
      "Analyze documentation coverage. Find gaps that hurt AI comprehension.",
  },
];

export function Features() {
  return (
    <section className="features section" id="features">
      <div className="container">
        <div className="section-label">Features</div>
        <h2 className="section-title">
          Everything you need to preserve visibility
        </h2>
        <div className="features-grid">
          {features.map((feature) => (
            <div key={feature.title} className="feature-card card">
              <div className="feature-icon">{feature.icon}</div>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
