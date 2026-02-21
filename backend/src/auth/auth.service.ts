import { createHash, randomUUID } from "crypto";
import { Decimal128, ObjectId, type Db, type Document } from "mongodb";
import { AppError } from "../common/errors";
import type { AuthUser } from "../common/request-context";
import { hashPassword, verifyPassword } from "../infra/security/password";
import { JwtService } from "../infra/security/jwt";
import { authCollections } from "./auth.model";
import type { LoginInput, RefreshInput, RegisterInput, RevokeSessionInput } from "./auth.types";

type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  expiresInSec: number;
};

const hashToken = (value: string): string => createHash("sha256").update(value).digest("hex");
const asObjectId = (raw: string, code: "UNAUTHORIZED" | "VALIDATION_ERROR" | "INTERNAL_ERROR"): ObjectId => {
  try {
    return new ObjectId(raw);
  } catch (error) {
    throw new AppError(code, "Invalid object id", { cause: error });
  }
};

const normalizeRefCode = (value: string | undefined): string => {
  if (!value) {
    return "";
  }
  return value.trim().toUpperCase();
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const caseInsensitiveEq = (value: string): RegExp => new RegExp(`^${escapeRegex(value)}$`, "i");

const buildAffiliateCode = (userObjectId: ObjectId): string => {
  return userObjectId.toHexString().slice(0, 8).toUpperCase();
};

const SETTINGS_CACHE_TTL_MS = 5_000;
const DEFAULT_REFERRAL_SIGNUP_BONUS = 1;

const pickPreferredRefCode = (user: {
  _id: ObjectId;
  affiliateCode?: string;
  unique_id?: string;
  referralCode?: string;
}): string => {
  const candidates = [user.affiliateCode, user.unique_id, user.referralCode];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const normalized = normalizeRefCode(candidate);
    if (normalized.length > 0) {
      return normalized;
    }
  }
  return buildAffiliateCode(user._id);
};

export class AuthService {
  private referralSignupBonus = DEFAULT_REFERRAL_SIGNUP_BONUS;

  private referralSettingsLoadedAt = 0;

  constructor(
    private readonly db: Db,
    private readonly jwtService: JwtService,
    private readonly accessTtlSec: number,
    private readonly refreshTtlSec: number,
  ) {}

  async resolveAccessToken(token: string): Promise<AuthUser> {
    const decoded = this.jwtService.verifyAccess(token);
    const user = await authCollections(this.db).users.findOne({ _id: asObjectId(decoded.userId, "UNAUTHORIZED") });
    if (!user) {
      throw new AppError("UNAUTHORIZED", "User not found");
    }

    const session = decoded.sessionId
      ? await authCollections(this.db).sessions.findOne({ _id: asObjectId(decoded.sessionId, "UNAUTHORIZED"), revoked: false })
      : null;

    if (decoded.sessionId && !session) {
      throw new AppError("UNAUTHORIZED", "Session is revoked");
    }

    return {
      userId: user._id.toHexString(),
      username: user.username,
      roles: user.roles,
      sessionId: decoded.sessionId,
    };
  }

  async register(input: RegisterInput): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const collections = authCollections(this.db);
    const existing = await collections.users.findOne({ username: input.username });
    if (existing) {
      throw new AppError("CONFLICT", "Username already exists");
    }

    const requestedRefCode = normalizeRefCode(input.refCode);
    let referrer: Awaited<ReturnType<typeof collections.users.findOne>> = null;
    if (requestedRefCode) {
      const codeMatcher = caseInsensitiveEq(requestedRefCode);
      referrer = await collections.users.findOne({
        $or: [
          { affiliateCode: codeMatcher },
          { unique_id: codeMatcher },
          { referralCode: codeMatcher },
        ],
      });
    }

    const now = new Date();
    const passwordHash = await hashPassword(input.password);
    const userObjectId = new ObjectId();
    const affiliateCode = buildAffiliateCode(userObjectId);
    const referredBy = referrer ? pickPreferredRefCode(referrer) : undefined;
    const referralSignupBonus = referrer ? (await this.getReferralSignupBonus()).toFixed(2) : "0";
    const insertResult = await collections.users.insertOne({
      _id: userObjectId,
      username: input.username,
      email: input.email,
      passwordHash,
      roles: ["user"],
      affiliateCode,
      referredBy,
      ref_id: referrer?.unique_id,
      ref_money: Decimal128.fromString("0"),
      ref_money_all: Decimal128.fromString("0"),
      link_trans: 0,
      link_reg: 0,
      affiliateStats: {
        totalReferred: 0,
        totalCommission: Decimal128.fromString("0"),
        transitions: 0,
        clicks: 0,
        registrations: 0,
      },
      balances: {
        main: Decimal128.fromString("100.00"),
        bonus: Decimal128.fromString(referralSignupBonus),
      },
      stateVersion: 1,
      tokenVersion: 0,
      createdAt: now,
      updatedAt: now,
    });

    if (referrer) {
      await collections.users.updateOne(
        { _id: referrer._id },
        {
          $inc: {
            link_reg: 1,
            "affiliateStats.totalReferred": 1,
            "affiliateStats.registrations": 1,
          },
          $set: {
            updatedAt: new Date(),
          },
        },
      );
    }

    const userId = insertResult.insertedId.toHexString();
    const sessionId = await this.createSession(userId);
    const user: AuthUser = {
      userId,
      username: input.username,
      roles: ["user"],
      sessionId,
    };

    const tokens = await this.issueTokens(user, 0);
    return { user, tokens };
  }

  async login(input: LoginInput): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const collections = authCollections(this.db);
    const user = await collections.users.findOne({ username: input.username });
    if (!user) {
      throw new AppError("UNAUTHORIZED", "Invalid username or password");
    }

    const valid = await verifyPassword(input.password, user.passwordHash);
    if (!valid) {
      throw new AppError("UNAUTHORIZED", "Invalid username or password");
    }

    const sessionId = await this.createSession(user._id.toHexString());
    const authUser: AuthUser = {
      userId: user._id.toHexString(),
      username: user.username,
      roles: user.roles,
      sessionId,
    };
    const tokens = await this.issueTokens(authUser, user.tokenVersion);
    return { user: authUser, tokens };
  }

  async refresh(input: RefreshInput): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const payload = this.jwtService.verifyRefresh(input.refreshToken);
    const hashed = hashToken(input.refreshToken);
    const session = await authCollections(this.db).sessions.findOne({
      _id: asObjectId(payload.sid, "UNAUTHORIZED"),
      refreshTokenHash: hashed,
      revoked: false,
      expiresAt: { $gt: new Date() },
    });

    if (!session) {
      throw new AppError("UNAUTHORIZED", "Invalid refresh session");
    }

    const user = await authCollections(this.db).users.findOne({ _id: asObjectId(payload.sub, "UNAUTHORIZED") });
    if (!user || user.tokenVersion !== payload.tokenVersion) {
      throw new AppError("UNAUTHORIZED", "Session expired");
    }

    const authUser: AuthUser = {
      userId: user._id.toHexString(),
      username: user.username,
      roles: user.roles,
      sessionId: session._id.toHexString(),
    };
    const tokens = await this.issueTokens(authUser, user.tokenVersion, session._id.toHexString());
    return { user: authUser, tokens };
  }

  async logout(authUser: AuthUser): Promise<void> {
    if (!authUser.sessionId) {
      return;
    }
    await authCollections(this.db).sessions.updateOne(
      { _id: asObjectId(authUser.sessionId, "VALIDATION_ERROR"), userId: authUser.userId },
      {
        $set: {
          revoked: true,
          updatedAt: new Date(),
        },
      },
    );
  }

  async me(authUser: AuthUser): Promise<{ userId: string; username: string; roles: string[] }> {
    return {
      userId: authUser.userId,
      username: authUser.username,
      roles: authUser.roles,
    };
  }

  async listSessions(authUser: AuthUser): Promise<
    Array<{ sessionId: string; createdAt: number; expiresAt: number; revoked: boolean }>
  > {
    const sessions = await authCollections(this.db)
      .sessions.find({ userId: authUser.userId })
      .sort({ createdAt: -1 })
      .toArray();

    return sessions.map((session) => ({
      sessionId: session._id.toHexString(),
      createdAt: session.createdAt.getTime(),
      expiresAt: session.expiresAt.getTime(),
      revoked: session.revoked,
    }));
  }

  async revokeSession(authUser: AuthUser, input: RevokeSessionInput): Promise<void> {
    await authCollections(this.db).sessions.updateOne(
      { _id: asObjectId(input.sessionId, "VALIDATION_ERROR"), userId: authUser.userId },
      {
        $set: {
          revoked: true,
          updatedAt: new Date(),
        },
      },
    );
  }

  private async createSession(userId: string): Promise<string> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.refreshTtlSec * 1000);
    const sessionObjectId = new ObjectId();
    const insertResult = await authCollections(this.db).sessions.insertOne({
      _id: sessionObjectId,
      userId,
      refreshTokenHash: randomUUID(),
      revoked: false,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    return insertResult.insertedId.toHexString();
  }

  private async issueTokens(user: AuthUser, tokenVersion: number, forcedSessionId?: string): Promise<AuthTokens> {
    const sessionId = forcedSessionId ?? user.sessionId;
    if (!sessionId) {
      throw new AppError("INTERNAL_ERROR", "Missing session id");
    }

    const accessToken = this.jwtService.signAccess({
      ...user,
      sessionId,
    });
    const refreshToken = this.jwtService.signRefresh({
      sub: user.userId,
      sid: sessionId,
      tokenVersion,
    });

    await authCollections(this.db).sessions.updateOne(
      { _id: asObjectId(sessionId, "INTERNAL_ERROR"), userId: user.userId },
      {
        $set: {
          refreshTokenHash: hashToken(refreshToken),
          revoked: false,
          expiresAt: new Date(Date.now() + this.refreshTtlSec * 1000),
          updatedAt: new Date(),
        },
      },
    );

    return {
      accessToken,
      refreshToken,
      sessionId,
      expiresInSec: this.accessTtlSec,
    };
  }

  private async getReferralSignupBonus(force = false): Promise<number> {
    const now = Date.now();
    if (!force && now - this.referralSettingsLoadedAt < SETTINGS_CACHE_TTL_MS) {
      return this.referralSignupBonus;
    }

    const settings = await this.db.collection<Document>("settings").findOne(
      {},
      {
        sort: { id: 1, _id: 1 },
        projection: {
          ref_sum: 1,
        },
      },
    );

    const parsed = Number(settings?.ref_sum);
    if (Number.isFinite(parsed) && parsed > 0) {
      this.referralSignupBonus = Number(parsed.toFixed(2));
    } else {
      this.referralSignupBonus = DEFAULT_REFERRAL_SIGNUP_BONUS;
    }
    this.referralSettingsLoadedAt = now;
    return this.referralSignupBonus;
  }
}
