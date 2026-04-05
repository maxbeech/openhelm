const PLACEHOLDERS = [
  "What's on the horizon?",
  "Chart your next course...",
  "Signal the bridge...",
  "Any orders, Captain?",
  "Set sail with a question...",
  "What winds are you chasing?",
  "Drop anchor on a thought...",
  "Ready to navigate...",
  "Plotting a new heading?",
  "Steady as she goes... what's next?",
  "All hands on deck — what do you need?",
  "Where shall we steer?",
];

export function pickNauticalPlaceholder(): string {
  return PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)];
}
