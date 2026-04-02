/**
 * OpenHelmIcon — monochrome version of the OpenHelm logo mark.
 * Used to badge system/AI-generated items in the sidebar.
 */

interface Props {
  className?: string;
}

export function OpenHelmIcon({ className }: Props) {
  return (
    <svg
      viewBox="0 0 570 570"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path d="M549.5 231L123 439.5C234.5 549.5 397.5 518 465.5 392L549.5 231Z" />
      <path d="M114.5 424L259 353L21 268L114.5 424Z" />
      <path d="M443.5 264.5L290.5 338V233L502.5 109.5L443.5 264.5Z" />
      <path d="M376.5 166L290.5 213.5V130.5L396 73L376.5 166Z" />
      <path d="M272 64V338L68 264.5C97.1647 128.441 143.563 86.522 272 64Z" />
    </svg>
  );
}
