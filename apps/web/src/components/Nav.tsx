import { Logo } from "./Logo";
import "./Nav.css";

interface NavLink {
  label: string;
  href: string;
}

const navLinks: NavLink[] = [
  { label: "Docs", href: "https://docs.pickled.dev/" },
  { label: "GitHub", href: "https://github.com/caiopizzol/pickled" },
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
