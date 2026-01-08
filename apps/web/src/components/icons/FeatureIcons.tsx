interface IconProps {
  className?: string;
}

export function FreshnessScoreIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Hand-drawn style bar chart with ascending bars */}
      <path
        d="M6 26 L6 20 Q6.5 19.5 7 20 L10 20 Q10.5 19.5 10 20 L10 26"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13 26 L13 14 Q13.5 13.5 14 14 L17 14 Q17.5 13.5 17 14 L17 26"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 26 L20 7 Q20.5 6.5 21 7 L24 7 Q24.5 6.5 24 7 L24 26"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Base line with slight wobble */}
      <path
        d="M4 26 Q16 25.5 28 26"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function JarIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Jar lid */}
      <path
        d="M9 6 Q9 4 11 4 L21 4 Q23 4 23 6 L23 8 L9 8 Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Jar body with organic shape */}
      <path
        d="M9 8 Q7 10 7 13 L7 25 Q7 28 10 28 L22 28 Q25 28 25 25 L25 13 Q25 10 23 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Pickle inside - simple curved shape */}
      <path
        d="M13 14 Q12 17 13 20 Q14 23 16 23 Q18 23 19 20 Q20 17 19 14 Q18 11 16 11 Q14 11 13 14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="currentColor"
        fillOpacity="0.2"
      />
      {/* Pickle bumps */}
      <circle cx="14" cy="16" r="0.8" fill="currentColor" />
      <circle cx="17" cy="18" r="0.8" fill="currentColor" />
      <circle cx="15" cy="20" r="0.8" fill="currentColor" />
    </svg>
  );
}

export function CodeCheckIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Left angle bracket with hand-drawn feel */}
      <path
        d="M11 10 Q10.5 10.5 6 16 Q10.5 21.5 11 22"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Right angle bracket */}
      <path
        d="M21 10 Q21.5 10.5 26 16 Q21.5 21.5 21 22"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Slash in middle */}
      <path
        d="M18 8 Q16 16 14 24"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Small checkmark */}
      <path
        d="M22 5 L25 8 L30 2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ShelfLifeIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Stack of documents with slightly offset, hand-drawn lines */}
      <path
        d="M6 8 Q6 6 8 6 L20 6 Q22 6 22 8 L22 24 Q22 26 20 26 L8 26 Q6 26 6 24 Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Document lines */}
      <path
        d="M9 11 Q13.5 10.8 17 11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M9 15 Q13.5 14.8 19 15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M9 19 Q12 18.8 15 19"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Small clock/timer in corner */}
      <circle
        cx="25"
        cy="23"
        r="5"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
      <path
        d="M25 21 L25 23 L27 24"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
