import "./Features.css";
import {
  CodeCheckIcon,
  FreshnessScoreIcon,
  JarIcon,
  ShelfLifeIcon,
} from "./icons/FeatureIcons";

interface Feature {
  icon: React.ReactNode;
  title: string;
  description: string;
}

const features: Feature[] = [
  {
    icon: <FreshnessScoreIcon />,
    title: "Freshness Score",
    description:
      "Get a score based on how well AI can answer questions about your tool. Track your freshness over time.",
  },
  {
    icon: <JarIcon />,
    title: "Scenario Testing",
    description:
      "Define scenarios developers might ask about. Test AI responses against real-world questions.",
  },
  {
    icon: <CodeCheckIcon />,
    title: "CI/CD Ready",
    description:
      "Set thresholds and fail builds if AI can't answer correctly. Stay fresh automatically.",
  },
  {
    icon: <ShelfLifeIcon />,
    title: "Multi-Target",
    description:
      "Test across different AI tools and models. Coming soon: Gemini CLI, Cursor, and more.",
  },
];

export function Features() {
  return (
    <section className="features section" id="features">
      <div className="container">
        <div className="section-label">Features</div>
        <h2 className="section-title">Everything you need to stay fresh</h2>
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
