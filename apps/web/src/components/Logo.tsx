import "./Logo.css";

interface LogoProps {
  size?: "sm" | "md" | "lg";
}

export function Logo({ size = "md" }: LogoProps) {
  return (
    <a href="/" className={`logo logo-${size}`}>
      <span className="logo-mark" aria-hidden="true"></span>
      <span className="logo-text">pickled</span>
    </a>
  );
}
