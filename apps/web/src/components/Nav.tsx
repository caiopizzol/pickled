import { Logo } from "./Logo";
import "./Nav.css";

interface NavLink {
  label: string;
  href: string;
}

const navLinks: NavLink[] = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how" },
  { label: "Docs", href: "/docs" },
  { label: "GitHub", href: "https://github.com/pickled" },
];

export function Nav() {
  return (
    <nav className="nav">
      <div className="container nav-inner">
        <Logo />
        <ul className="nav-links">
          {navLinks.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
