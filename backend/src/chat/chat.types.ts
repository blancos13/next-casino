export type ChatMessage = {
  id: string;
  userId: string;
  username: string;
  text: string;
  createdAt: number;
};

export type ChatUserCard = {
  userId: string;
  username: string;
  avatar: string;
  betAmount: string;
  totalGames: number;
  wins: number;
  lose: number;
};
