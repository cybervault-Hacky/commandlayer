import type { SVGProps } from 'react';

/**
 * CommandLayer icon set — custom, stroke-based SVG.
 * Icons are decorative by default (aria-hidden); interactive elements get
 * their accessible names from labels.
 */

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

function svgProps(size: number, rest: SVGProps<SVGSVGElement>): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: 'false',
    ...rest,
  };
}

export function IconSettings(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08A1.7 1.7 0 0 0 10.1 3.1V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51.88Z" />
    </svg>
  );
}

export function IconArrowUp(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

export function IconSpinner(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)} className={`cl-spin ${rest.className ?? ''}`}>
      <path d="M21 12a9 9 0 1 1-6.2-8.56" />
    </svg>
  );
}

export function IconX(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function IconChevronLeft(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function IconCheckCircle(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </svg>
  );
}

export function IconAlertTriangle(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <path d="m10.3 3.9-8 13.9A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.2l-8-13.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function IconRefresh(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

export function IconGlobe(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9Z" />
    </svg>
  );
}

export function IconInfo(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

export function IconShield(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <path d="M12 22s8-3.6 8-9V5l-8-3-8 3v8c0 5.4 8 9 8 9Z" />
    </svg>
  );
}

/* --- Quick action glyphs --- */

export function IconAnalyze(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20.5 20.5-4.6-4.6" />
      <path d="M11 8v6M8 11h6" />
    </svg>
  );
}

export function IconExplain(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <path d="M12 3a7 7 0 0 0-4 12.7V18a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.3A7 7 0 0 0 12 3Z" />
      <path d="M9.5 21h5" />
      <path d="M12 8.5v3.5" />
      <path d="M12 15h.01" />
    </svg>
  );
}

export function IconExtract(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <path d="M4 4h16" />
      <path d="M4 9h16" />
      <path d="m9 15 3 3 3-3" />
      <path d="M12 13v5" />
    </svg>
  );
}

export function IconSummarize(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-5-5Z" />
      <path d="M14 2v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}

export function IconSparkle(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <path d="M12 4.5 13.8 9l4.5 1.8-4.5 1.8L12 17.1l-1.8-4.5-4.5-1.8L10.2 9 12 4.5Z" />
      <path d="M19 3.5v3M17.5 5h3" />
    </svg>
  );
}

export function IconCopy(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function IconTrash(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

/* --- Phase 4: action engine --- */

export function IconReadPage(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M15 3v4h4" />
      <path d="M9.5 12h6M9.5 15.5h6M9.5 19h3.5" />
    </svg>
  );
}

export function IconScrollAction(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <path d="M12 4v16" />
      <path d="m8.5 7.5 3.5-3.5 3.5 3.5" />
      <path d="m8.5 16.5 3.5 3.5 3.5-3.5" />
    </svg>
  );
}

export function IconFindText(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m20 20-5.2-5.2" />
      <path d="M8 9.5h5M8 12h3.5" />
    </svg>
  );
}

export function IconClickAction(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <path d="M10.5 9.5 20 13l-4.2 1.7L14 19z" />
      <path d="M10.5 9.5 5.6 4.6" />
      <path d="M9.2 2.8A7 7 0 0 0 2.8 9.2" />
      <path d="M11.2 21.2A7 7 0 0 0 21.2 11.2" />
    </svg>
  );
}

export function IconTypeAction(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <path d="M9 4h6M12 4v16M9 20h6" />
    </svg>
  );
}

export function IconSelectAction(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <rect x="3.5" y="6" width="17" height="5" rx="1.5" />
      <path d="m10 8.5 2 1.8 2-1.8" />
      <path d="M3.5 14h17M3.5 17.5h17" />
    </svg>
  );
}

export function IconPlay(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );
}

export function IconCircle(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <circle cx="12" cy="12" r="7" />
    </svg>
  );
}

export function IconCircleDot(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconSteps(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <path d="M5 6.5h9" />
      <path d="M5 12h13" />
      <path d="M5 17.5h6" />
    </svg>
  );
}

export function IconShieldCheck(props: IconProps) {
  const { size = 16, ...rest } = props;
  return (
    <svg {...svgProps(size, rest)}>
      <path d="M12 3 5 5.8v5.4c0 4.4 3 7.6 7 8.8 4-1.2 7-4.4 7-8.8V5.8z" />
      <path d="m9.2 11.8 2 2 3.6-3.9" />
    </svg>
  );
}

/* --- Brand --- */

export function BrandMark({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M12 2.6 21.4 8.1 12 13.6 2.6 8.1 12 2.6Z" fill="var(--cl-accent)" />
      <path
        d="M2.6 12.4 12 17.9l9.4-5.5"
        stroke="var(--cl-text-secondary)"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2.6 16.4 12 21.9l9.4-5.5"
        stroke="var(--cl-text-muted)"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
