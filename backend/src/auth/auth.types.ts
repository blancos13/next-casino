export type RegisterInput = {
  username: string;
  email?: string;
  password: string;
  refCode?: string;
};

export type LoginInput = {
  username: string;
  password: string;
};

export type RefreshInput = {
  refreshToken: string;
};

export type RevokeSessionInput = {
  sessionId: string;
};
