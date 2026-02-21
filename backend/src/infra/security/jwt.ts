import jwt from "jsonwebtoken";
import type { Env } from "../../config/env";
import type { AuthUser } from "../../common/request-context";
import { AppError } from "../../common/errors";

type AccessPayload = {
  sub: string;
  username: string;
  roles: string[];
  sid: string;
};

type RefreshPayload = {
  sub: string;
  sid: string;
  tokenVersion: number;
};

export class JwtService {
  constructor(private readonly env: Env) {}

  signAccess(user: AuthUser): string {
    const payload: AccessPayload = {
      sub: user.userId,
      username: user.username,
      roles: user.roles,
      sid: user.sessionId ?? "",
    };
    return jwt.sign(payload, this.env.JWT_ACCESS_SECRET, {
      expiresIn: this.env.JWT_ACCESS_TTL_SEC,
    });
  }

  signRefresh(payload: RefreshPayload): string {
    return jwt.sign(payload, this.env.JWT_REFRESH_SECRET, {
      expiresIn: this.env.JWT_REFRESH_TTL_SEC,
    });
  }

  verifyAccess(token: string): AuthUser {
    try {
      const parsed = jwt.verify(token, this.env.JWT_ACCESS_SECRET) as AccessPayload;
      return {
        userId: parsed.sub,
        username: parsed.username,
        roles: parsed.roles,
        sessionId: parsed.sid,
      };
    } catch (error) {
      throw new AppError("UNAUTHORIZED", "Invalid access token", { cause: error });
    }
  }

  verifyRefresh(token: string): RefreshPayload {
    try {
      return jwt.verify(token, this.env.JWT_REFRESH_SECRET) as RefreshPayload;
    } catch (error) {
      throw new AppError("UNAUTHORIZED", "Invalid refresh token", { cause: error });
    }
  }
}

export type { RefreshPayload };

