export type ChatMessageTone = "default" | "win" | "loss";

export type ChatMessage = {
  id: string;
  userId?: string;
  avatar?: string;
  message: string;
  time: string;
  tone: ChatMessageTone;
  user: string;
};

export type GameHistoryRow = {
  id: string;
  user: string;
  bet: number;
  chance: number;
  multiplier: number;
  roll: number;
  result: number;
  win: boolean;
};
