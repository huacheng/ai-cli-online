interface SelectionFloatProps {
  x: number;
  y: number;
  onDelete: () => void;
  onReplace: () => void;
  onComment: () => void;
}

export function SelectionFloat({ x, y, onDelete, onReplace, onComment }: SelectionFloatProps) {
  return (
    <div
      className="plan-selection-float"
      style={{ top: y, left: x }}
    >
      <button
        className="plan-selection-float__delete"
        onMouseDown={(e) => { e.preventDefault(); onDelete(); }}
        title="Delete selection"
      >&minus;</button>
      <button
        className="plan-selection-float__replace"
        onMouseDown={(e) => { e.preventDefault(); onReplace(); }}
        title="Replace selection"
      >&#x21C4;</button>
      <button
        className="plan-selection-float__comment"
        onMouseDown={(e) => { e.preventDefault(); onComment(); }}
        title="Comment on selection"
      >?</button>
    </div>
  );
}
