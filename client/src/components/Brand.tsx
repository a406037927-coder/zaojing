import { Blocks } from "lucide-react";

export function Brand() {
  return (
    <div className="brand" aria-label="造境 AI">
      <span className="brand-mark"><Blocks size={19} strokeWidth={2.3} /></span>
      <span>造境 AI</span>
    </div>
  );
}
