import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
} from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

interface BaseButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

type ButtonAsButton = BaseButtonProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    as?: "button";
    href?: never;
  };

type ButtonAsLink = BaseButtonProps &
  AnchorHTMLAttributes<HTMLAnchorElement> & {
    as: "a";
    href: string;
  };

type ButtonProps = ButtonAsButton | ButtonAsLink;

export function Button({
  variant = "primary",
  size = "md",
  children,
  ...props
}: ButtonProps) {
  const className = `btn btn-${variant} btn-${size}`;

  if (props.as === "a") {
    const { as: _, ...linkProps } = props;
    return (
      <a className={className} {...linkProps}>
        {children}
      </a>
    );
  }

  const { as: _, ...buttonProps } = props as ButtonAsButton;
  return (
    <button className={className} {...buttonProps}>
      {children}
    </button>
  );
}
