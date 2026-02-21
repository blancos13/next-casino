import { ObjectId, type Db } from "mongodb";
import { usersCollection } from "./user.model";
import { atomicFromDecimal, formatMoney } from "../common/money";
import { AppError } from "../common/errors";

export class ProfileService {
  constructor(private readonly db: Db) {}

  async getProfile(userId: string): Promise<{
    userId: string;
    username: string;
    roles: string[];
    balance: string;
    bonusBalance: string;
    createdAt: number;
  }> {
    const user = await usersCollection(this.db).findOne({ _id: new ObjectId(userId) });
    if (!user) {
      throw new AppError("NOT_FOUND", "User not found");
    }
    return {
      userId: user._id.toHexString(),
      username: user.username,
      roles: user.roles,
      balance: formatMoney(atomicFromDecimal(user.balances.main)),
      bonusBalance: formatMoney(atomicFromDecimal(user.balances.bonus)),
      createdAt: user.createdAt.getTime(),
    };
  }
}
