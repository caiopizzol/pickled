import { Logo } from "./Logo";
import "./Footer.css";

interface FooterLink {
  label: string;
  href: string;
}

const footerLinks: FooterLink[] = [
  { label: "Docs", href: "https://docs.pickled.dev/docs" },
  { label: "GitHub", href: "https://github.com/caiopizzol/pickled" },
];

export function Footer() {
  return (
    <footer className="footer section-divider">
      <div className="container footer-inner">
        <Logo size="sm" />
        <ul className="footer-links">
          {footerLinks.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
            </li>
          ))}
        </ul>
        <span className="footer-tagline">Stay fresh.</span>
      </div>
    </footer>
  );
}
